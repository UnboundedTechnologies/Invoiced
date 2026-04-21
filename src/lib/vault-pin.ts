/**
 * Vault PIN primitives (server-safe, pure-ish).
 *
 * Second wall in front of /vault + /api/documents/[id] on top of Auth.js
 * login. The PIN session is a separate httpOnly cookie with a 15-minute
 * sliding TTL — independent of the main session so vault-vs-parent flows
 * can diverge (parent flows stay session-only; vault requires both).
 *
 * Everything here is server-only; keep client code out.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { and, count, gte, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings, vaultPinAttempts } from "@/lib/db/schema";

export const VAULT_PIN_COOKIE = "__Host-vault-pin";
/**
 * Cookie lifetime: 60 seconds, NON-sliding. Kept intentionally tight so
 * that each /vault visit requires a fresh PIN entry. The 60s window is
 * just enough to let a PIN entry + a couple of downloads-in-the-same-tick
 * succeed before the cookie expires. The vault UI also fires a
 * `lockVaultSession` call when the user navigates away from /vault, so in
 * practice the cookie rarely reaches the 60s cap on its own.
 */
export const VAULT_PIN_TTL_SECONDS = 60;
export const VAULT_PIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const VAULT_PIN_LOCKOUT_THRESHOLD = 5;

// Argon2id params — same cost as the login password.
const ARGON2 = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 65_536,    // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export function hashPin(pin: string): Promise<string> {
  return argon2Hash(pin, ARGON2);
}

export function verifyPin(hash: string, pin: string): Promise<boolean> {
  return argon2Verify(hash, pin);
}

/** Soft-strength classifier — returns a user-facing warning, never blocks. */
export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return null;
  // All-same digit: 000000, 111111, …
  if (/^(\d)\1{5}$/.test(pin)) return "All-same digits are easy to guess. You can still save it, but a mixed PIN is stronger.";
  // Strict ascending / descending run: 012345, 123456, …, 987654
  const digits = pin.split("").map((d) => Number(d));
  const strictlyAsc = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const strictlyDesc = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  if (strictlyAsc || strictlyDesc) return "Sequential PINs are easy to guess. You can still save it, but a mixed PIN is stronger.";
  return null;
}

// Session JWT — short signed payload in the cookie. We don't use a full JWT
// library here; HMAC-SHA256 over a compact JSON-ish payload is enough and keeps
// the dependency count down. `expiresAt` is absolute epoch ms.
type TokenPayload = { expiresAt: number };

function getSecret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — cannot sign vault-pin tokens");
  return Buffer.from(s, "utf8");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function issueToken(ttlSeconds = VAULT_PIN_TTL_SECONDS): string {
  const payload: TokenPayload = { expiresAt: Date.now() + ttlSeconds * 1000 };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null): { ok: boolean; expiresAt?: number } {
  if (!token || typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, sig] = parts;
  if (!body || !sig) return { ok: false };
  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const given = base64urlDecode(sig);
  if (given.length !== expected.length) return { ok: false };
  if (!timingSafeEqual(given, expected)) return { ok: false };
  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false };
  }
  if (typeof payload.expiresAt !== "number") return { ok: false };
  if (payload.expiresAt < Date.now()) return { ok: false };
  return { ok: true, expiresAt: payload.expiresAt };
}

/**
 * Lockout state — "≥ threshold failed attempts in the rolling window".
 * retryAfter is computed from the Nth most recent failure: lockout lifts
 * when that row rolls off the window.
 */
export async function getLockoutState(): Promise<{
  locked: boolean;
  failedCount: number;
  retryAfterMs: number | null;
}> {
  const windowStart = new Date(Date.now() - VAULT_PIN_LOCKOUT_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(vaultPinAttempts)
    .where(and(gte(vaultPinAttempts.attemptedAt, windowStart), eq(vaultPinAttempts.success, false)));
  const failedCount = Number(row?.n ?? 0);

  if (failedCount < VAULT_PIN_LOCKOUT_THRESHOLD) {
    return { locked: false, failedCount, retryAfterMs: null };
  }

  const recent = await db
    .select({ attemptedAt: vaultPinAttempts.attemptedAt })
    .from(vaultPinAttempts)
    .where(and(gte(vaultPinAttempts.attemptedAt, windowStart), eq(vaultPinAttempts.success, false)))
    .orderBy(desc(vaultPinAttempts.attemptedAt));
  const pivotRow = recent[VAULT_PIN_LOCKOUT_THRESHOLD - 1] ?? recent[recent.length - 1];
  const pivotMs = pivotRow ? new Date(pivotRow.attemptedAt).getTime() : Date.now();
  const retryAfterMs = Math.max(0, pivotMs + VAULT_PIN_LOCKOUT_WINDOW_MS - Date.now());
  return { locked: retryAfterMs > 0, failedCount, retryAfterMs: retryAfterMs > 0 ? retryAfterMs : null };
}

export async function recordAttempt(success: boolean, meta?: { ipAddress?: string | null; userAgent?: string | null }) {
  await db.insert(vaultPinAttempts).values({
    success,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });
}

/** Read the current PIN hash (null if not set). */
export async function getPinHash(): Promise<string | null> {
  const [row] = await db
    .select({ h: settings.vaultPinHash })
    .from(settings)
    .where(eq(settings.id, 1));
  return row?.h ?? null;
}

/** Format a retryAfter millisecond count as a short user-facing hint. */
export function formatRetryAfter(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m} min`;
}
