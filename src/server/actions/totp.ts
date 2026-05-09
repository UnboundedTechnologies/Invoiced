"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verify as argon2Verify } from "@node-rs/argon2";
import { db } from "@/lib/db/client";
import { users, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  verifyTotp,
  buildOtpAuthUri,
  qrDataUri,
  generateBackupCodes,
  hashBackupCode,
} from "@/lib/totp";

type ActionResult = { ok?: string; error?: string };

const TOTP_ISSUER = "Invoiced — Unbounded Technologies";

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function getEncryptionKey(): string {
  const k = process.env.TOTP_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY is not set. Add a 32-byte base64 value to .env.local + Vercel before enrolling.",
    );
  }
  return k;
}

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits."),
});

const revokeSchema = z.object({
  password: z.string().min(1, "Password is required."),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits."),
});

/**
 * Step 1 of enrollment. Generates a fresh secret + 10 backup codes, persists
 * the encrypted secret + hashed backup codes with totpEnabledAt = null. The
 * cleartext secret + base32 + backup codes are returned to the caller exactly
 * once — the client must capture and display them; they cannot be recovered.
 *
 * Idempotent: re-running overwrites any in-progress enrollment. (Won't run
 * when 2FA is already verified-active, since the UI shows the status card
 * instead of the wizard in that state.)
 */
export async function enrollStart(): Promise<
  | { ok: true; qrDataUri: string; base32Secret: string; backupCodes: string[] }
  | { ok: false; error: string }
> {
  try {
    const email = await requireAuth();
    const key = getEncryptionKey();

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user) return { ok: false, error: "User not found." };

    const secret = generateSecret();
    const encrypted = encryptSecret(secret, key);
    const backupCodes = generateBackupCodes(10);
    const hashedCodes = await Promise.all(backupCodes.map((c) => hashBackupCode(c)));

    await db
      .update(users)
      .set({
        totpSecretEncrypted: encrypted,
        totpBackupCodesHashed: hashedCodes,
        totpEnabledAt: null,
        totpFailedCount: 0,
        totpLockedUntil: null,
      })
      .where(eq(users.id, user.id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `users:${user.id}:2fa-enrollment-started`,
      metadata: { event: "enroll-start" },
    });

    const otpAuthUri = buildOtpAuthUri(email, secret, TOTP_ISSUER);
    const qr = await qrDataUri(otpAuthUri);

    return { ok: true, qrDataUri: qr, base32Secret: secret, backupCodes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Enroll failed." };
  }
}

/**
 * Step 2 of enrollment. User enters a code from their app to prove the secret
 * round-tripped successfully. On success, totpEnabledAt is stamped — login +
 * vault gates start enforcing 2FA from this point.
 */
export async function enrollVerify(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const key = getEncryptionKey();
    const parsed = codeSchema.safeParse({ code: String(fd.get("code") ?? "").replace(/\s+/g, "") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid code." };
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user?.totpSecretEncrypted) {
      return { error: "No enrollment in progress. Click Enable 2FA to start over." };
    }
    if (user.totpEnabledAt) {
      return { error: "2FA is already enabled. Revoke it first to re-enroll." };
    }

    const secret = decryptSecret(user.totpSecretEncrypted, key);
    if (!verifyTotp(secret, parsed.data.code)) {
      return { error: "That code didn't match. Check your authenticator app and try again." };
    }

    await db.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, user.id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `users:${user.id}:2fa-enabled`,
      metadata: { event: "enroll-verify-success" },
    });

    revalidatePath("/settings");
    return { ok: "2FA is now active. Keep your backup codes somewhere safe." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Verify failed." };
  }
}

/**
 * Wipes 2FA for the current user. Requires re-prompt of password AND a
 * current TOTP code so a stolen session alone can't disable the second
 * factor. Backup codes are also nuked.
 */
export async function revoke(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const key = getEncryptionKey();
    const parsed = revokeSchema.safeParse({
      password: String(fd.get("password") ?? ""),
      code: String(fd.get("code") ?? "").replace(/\s+/g, ""),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user || !user.totpEnabledAt || !user.totpSecretEncrypted) {
      return { error: "2FA isn't currently enabled." };
    }

    const passwordOk = await argon2Verify(user.passwordHash, parsed.data.password);
    if (!passwordOk) return { error: "Password didn't match." };

    const secret = decryptSecret(user.totpSecretEncrypted, key);
    if (!verifyTotp(secret, parsed.data.code)) {
      return { error: "That code didn't match. Check your authenticator app and try again." };
    }

    await db
      .update(users)
      .set({
        totpSecretEncrypted: null,
        totpBackupCodesHashed: null,
        totpEnabledAt: null,
        totpFailedCount: 0,
        totpLockedUntil: null,
      })
      .where(eq(users.id, user.id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `users:${user.id}:2fa-revoked`,
      metadata: { event: "revoke" },
    });

    revalidatePath("/settings");
    return { ok: "2FA has been removed. Re-enroll any time from this page." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Revoke failed." };
  }
}
