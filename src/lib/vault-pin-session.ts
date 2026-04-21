/**
 * Cookie-bound PIN session gates. Split out from `./vault-pin.ts` so the
 * pure crypto primitives don't pull in `next/headers` (which breaks tsx
 * verify scripts).
 *
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 * These are NOT `"use server"` exports — calling them runs inline, no RPC.
 */
import { cookies } from "next/headers";
import { VAULT_PIN_COOKIE, verifyToken } from "./vault-pin";

/** Non-throwing check. Use for render-time decisions. */
export async function hasVaultPinSession(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  return verifyToken(token).ok;
}

/**
 * Throwing gate for mutation paths (Route Handlers, Server Actions).
 * Non-sliding: the cookie has a fixed 60s TTL set at issue time and is NOT
 * refreshed on verification. Combined with the auto-lock on navigation-away
 * hook in /vault, this gives "PIN every access" behaviour.
 */
export async function requireVaultPinSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(VAULT_PIN_COOKIE)?.value;
  const v = verifyToken(token);
  if (!v.ok) throw new Error("Vault locked. Enter your PIN to continue.");
}
