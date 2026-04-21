/**
 * Cookie-bound PIN session gates. Split out from `./vault-pin.ts` so the
 * pure crypto primitives don't pull in `next/headers` (which breaks tsx
 * verify scripts).
 *
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 * These are NOT `"use server"` exports — calling them runs inline, no RPC.
 */
import { cookies } from "next/headers";
import {
  VAULT_PIN_COOKIE,
  VAULT_PIN_TTL_SECONDS,
  issueToken,
  verifyToken,
} from "./vault-pin";

async function writePinCookie(): Promise<void> {
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

/**
 * Refreshes the sliding TTL. Server Components cannot set cookies — if the
 * caller is one, the write throws and we swallow it. Writers (Route Handlers,
 * Server Actions) succeed.
 */
async function safeRefreshCookie(): Promise<void> {
  try {
    await writePinCookie();
  } catch {
    // Server Components can't set cookies — the existing token stays valid
    // until its absolute expiry, so a missed refresh isn't a security issue.
  }
}

/** Non-throwing check. Use for render-time decisions. */
export async function hasVaultPinSession(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  return verifyToken(token).ok;
}

/** Throwing gate for mutation paths (Route Handlers, Server Actions). */
export async function requireVaultPinSession(opts?: { refresh?: boolean }): Promise<void> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  const v = verifyToken(token);
  if (!v.ok) throw new Error("Vault locked. Enter your PIN to continue.");
  if (opts?.refresh !== false) await safeRefreshCookie();
}
