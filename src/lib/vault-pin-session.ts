/**
 * Cookie-bound PIN session gates. Split out from `./vault-pin.ts` so the
 * pure crypto primitives don't pull in `next/headers` (which breaks tsx
 * verify scripts).
 *
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 * These are NOT `"use server"` exports — calling them runs inline, no RPC.
 */
import { cookies } from "next/headers";
import { VAULT_PIN_COOKIE, VAULT_PIN_TTL_SECONDS, issueToken, verifyToken } from "./vault-pin";
import { setVault2faCookie } from "./vault-2fa-session";

/** Non-throwing check. Use for render-time decisions. */
export async function hasVaultPinSession(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  return verifyToken(token).ok;
}

/**
 * Throwing gate for mutation paths (Route Handlers, Server Actions).
 * Sliding: callers who reach this gate AND go on to do work should call
 * `refreshVaultSession()` after the work succeeds — that re-issues both
 * PIN + 2FA cookies with a fresh 60s window so an active session doesn't
 * silently lock mid-task. Idle for 60s = next action fails (intended).
 */
export async function requireVaultPinSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  const v = verifyToken(token);
  if (!v.ok) throw new Error("Vault locked. Enter your PIN to continue.");
}

/** Re-issue the PIN cookie. Internal — called from refreshVaultSession. */
async function setPinCookie(): Promise<void> {
  const c = await cookies();
  c.set({
    name: VAULT_PIN_COOKIE,
    value: issueToken(),
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: VAULT_PIN_TTL_SECONDS,
  });
}

/**
 * Sliding refresh: after a vault server action / route handler succeeds,
 * re-issue both PIN and 2FA cookies with fresh 60s windows. Caller is
 * responsible for ensuring the user already passed both gates this request
 * (this helper is fire-and-forget; it does NOT verify state itself).
 *
 * Always sets both cookies. Setting a 2FA cookie for a user without 2FA
 * enrolled is harmless — the 2FA gate checks `users.totpEnabledAt`, not
 * the cookie alone.
 */
export async function refreshVaultSession(): Promise<void> {
  await setPinCookie();
  await setVault2faCookie();
}
