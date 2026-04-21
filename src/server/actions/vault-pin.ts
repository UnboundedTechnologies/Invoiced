"use server";

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { settings, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import {
  VAULT_PIN_COOKIE,
  VAULT_PIN_TTL_SECONDS,
  hashPin,
  verifyPin,
  issueToken,
  getLockoutState,
  getPinHash,
  recordAttempt,
  weakPinReason,
  formatRetryAfter,
} from "@/lib/vault-pin";

type ActionResult = { ok?: string; error?: string; warning?: string; retryAfter?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function requestMeta() {
  const h = await headers();
  return {
    ipAddress:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null,
    userAgent: h.get("user-agent") || null,
  };
}

async function setPinCookie() {
  const c = await cookies();
  c.set({
    name: VAULT_PIN_COOKIE,
    value: issueToken(),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: VAULT_PIN_TTL_SECONDS,
  });
}

async function clearPinCookie() {
  const c = await cookies();
  // Delete by overwriting with maxAge=0 + the exact same attributes used at
  // set time. `__Host-` cookies require matching path/secure/sameSite for the
  // browser to accept the delete — bare c.delete(name) can silently no-op.
  c.set({
    name: VAULT_PIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

const pinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits."),
});

export async function setupVaultPin(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = pinSchema.safeParse({ pin: fd.get("pin") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid PIN" };

    const existing = await getPinHash();
    if (existing) return { error: "A PIN is already set. Use the Change PIN flow instead." };

    const warning = weakPinReason(parsed.data.pin);
    const hash = await hashPin(parsed.data.pin);
    await db
      .update(settings)
      .set({ vaultPinHash: hash, vaultPinSetAt: new Date(), updatedAt: new Date() })
      .where(eq(settings.id, 1));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: "vault_pin:setup",
      metadata: { hadWeakWarning: !!warning },
    });

    await setPinCookie();
    revalidatePath("/vault");
    revalidatePath("/settings");
    return { ok: "Vault PIN set.", warning: warning ?? undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Setup failed" };
  }
}

export async function verifyVaultPin(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = pinSchema.safeParse({ pin: fd.get("pin") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid PIN" };

    const meta = await requestMeta();

    // Lockout gate — check BEFORE hashing/verifying so brute-forcers can't DoS Argon2.
    const lockout = await getLockoutState();
    if (lockout.locked && lockout.retryAfterMs) {
      await db.insert(auditLog).values({
        actorEmail: email,
        action: "login",
        target: "vault_pin:verify:locked",
        metadata: { failedCount: lockout.failedCount, retryAfterMs: lockout.retryAfterMs },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return {
        error: `Too many failed attempts. Try again in ${formatRetryAfter(lockout.retryAfterMs)}.`,
        retryAfter: formatRetryAfter(lockout.retryAfterMs),
      };
    }

    const hash = await getPinHash();
    if (!hash) return { error: "Vault PIN not set. Refresh to run setup." };

    const ok = await verifyPin(hash, parsed.data.pin);
    await recordAttempt(ok, meta);
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "login",
      target: ok ? "vault_pin:verify:success" : "vault_pin:verify:fail",
      metadata: {},
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (!ok) {
      // Re-check lockout after recording — surface the countdown if this attempt crossed the line.
      const after = await getLockoutState();
      if (after.locked && after.retryAfterMs) {
        return {
          error: `Too many failed attempts. Try again in ${formatRetryAfter(after.retryAfterMs)}.`,
          retryAfter: formatRetryAfter(after.retryAfterMs),
        };
      }
      return { error: "Incorrect PIN." };
    }

    await setPinCookie();
    revalidatePath("/vault");
    return { ok: "Vault unlocked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Verification failed" };
  }
}

const changeSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, "Current PIN must be 6 digits."),
  newPin: z.string().regex(/^\d{6}$/, "New PIN must be 6 digits."),
});

export async function changeVaultPin(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = changeSchema.safeParse({
      currentPin: fd.get("currentPin"),
      newPin: fd.get("newPin"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    if (parsed.data.currentPin === parsed.data.newPin) {
      return { error: "New PIN must differ from current." };
    }

    const lockout = await getLockoutState();
    if (lockout.locked && lockout.retryAfterMs) {
      return { error: `Locked out. Try again in ${formatRetryAfter(lockout.retryAfterMs)}.` };
    }

    const hash = await getPinHash();
    if (!hash) return { error: "No PIN on file. Run setup first." };

    const meta = await requestMeta();
    const ok = await verifyPin(hash, parsed.data.currentPin);
    await recordAttempt(ok, meta);
    if (!ok) {
      await db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: "vault_pin:change:current-wrong",
        metadata: {},
      });
      return { error: "Current PIN is incorrect." };
    }

    const warning = weakPinReason(parsed.data.newPin);
    const newHash = await hashPin(parsed.data.newPin);
    await db
      .update(settings)
      .set({ vaultPinHash: newHash, vaultPinSetAt: new Date(), updatedAt: new Date() })
      .where(eq(settings.id, 1));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: "vault_pin:change",
      metadata: { hadWeakWarning: !!warning },
    });

    // Re-issue the cookie on the new hash so the current browser stays unlocked.
    await setPinCookie();
    revalidatePath("/vault");
    revalidatePath("/settings");
    return { ok: "Vault PIN changed.", warning: warning ?? undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Change failed" };
  }
}

export async function lockVaultSession(): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await clearPinCookie();
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "logout",
      target: "vault_pin:lock",
      metadata: {},
    });
    revalidatePath("/vault");
    return { ok: "Vault locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Lock failed" };
  }
}
