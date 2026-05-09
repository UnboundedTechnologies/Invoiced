"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { decryptSecret, verifyTotp, verifyAndConsumeBackupCode } from "@/lib/totp";
import { setVault2faCookie } from "@/lib/vault-2fa-session";

type ActionResult = { ok?: string; error?: string };

const VAULT_2FA_LOCKOUT_THRESHOLD = 5;
const VAULT_2FA_LOCKOUT_MINUTES = 15;

const codeSchema = z.object({
  code: z.string().min(6).max(9),
  mode: z.enum(["totp", "backup"]).optional(),
});

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email.toLowerCase();
}

/**
 * Verify the second-factor code on a vault unlock. Reuses the same encrypted
 * secret + backup-code arrays as login 2FA — no separate enrolment for the
 * vault. Lockout state is shared via the same totpFailedCount + totpLockedUntil
 * columns on users.
 */
export async function verifyVault2fa(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = codeSchema.safeParse({
      code: String(fd.get("code") ?? "").replace(/\s+/g, ""),
      mode: String(fd.get("mode") ?? "totp"),
    });
    if (!parsed.success) return { error: "Invalid code." };

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !user.totpEnabledAt || !user.totpSecretEncrypted) {
      return { error: "2FA isn't enabled on this account." };
    }
    if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
      return { error: "Too many wrong codes. Try again in a few minutes." };
    }

    const key = process.env.TOTP_ENCRYPTION_KEY;
    if (!key) return { error: "Server is missing TOTP_ENCRYPTION_KEY. Contact admin." };

    let ok = false;
    let usedBackup = false;
    if (parsed.data.mode === "backup") {
      const remaining = await verifyAndConsumeBackupCode(
        parsed.data.code,
        user.totpBackupCodesHashed ?? [],
      );
      if (remaining !== null) {
        ok = true;
        usedBackup = true;
        await db
          .update(users)
          .set({ totpBackupCodesHashed: remaining })
          .where(eq(users.id, user.id));
      }
    } else {
      try {
        const secret = decryptSecret(user.totpSecretEncrypted, key);
        ok = /^\d{6}$/.test(parsed.data.code) && verifyTotp(secret, parsed.data.code);
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      const newCount = (user.totpFailedCount ?? 0) + 1;
      const locked =
        newCount >= VAULT_2FA_LOCKOUT_THRESHOLD
          ? new Date(Date.now() + VAULT_2FA_LOCKOUT_MINUTES * 60 * 1000)
          : null;
      await db
        .update(users)
        .set({ totpFailedCount: newCount, totpLockedUntil: locked })
        .where(eq(users.id, user.id));
      await db.insert(auditLog).values({
        actorEmail: email,
        action: "login",
        target: `users:${user.id}:vault-2fa-failed`,
        metadata: { step: "vault-2fa", mode: parsed.data.mode ?? "totp" },
      });
      return { error: "That code didn't match. Try again." };
    }

    await db
      .update(users)
      .set({ totpFailedCount: 0, totpLockedUntil: null })
      .where(eq(users.id, user.id));
    await setVault2faCookie();
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "login",
      target: `users:${user.id}:vault-2fa-verified`,
      metadata: { step: "vault-2fa", mode: parsed.data.mode ?? "totp", usedBackup },
    });

    revalidatePath("/vault");
    return { ok: "Vault unlocked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Verification failed." };
  }
}
