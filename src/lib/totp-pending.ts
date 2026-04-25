/**
 * Cookie-bound 2FA-pending session.
 *
 * Set after step-1 (email + password) verifies AND the user has 2FA enrolled.
 * Carries the userId so /login/2fa knows whose TOTP secret to verify against.
 * Server-only; HMAC-signed with AUTH_SECRET (mirrors vault-pin pattern).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const TWOFA_PENDING_COOKIE = "__Host-2fa-pending";
/** 60 seconds — long enough to enter a code, short enough that an abandoned
 * step-1 doesn't leave a usable handle if someone walks up to the browser. */
export const TWOFA_PENDING_TTL_SECONDS = 60;

type PendingPayload = {
  userId: string;
  expiresAt: number;
};

function getSecret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — cannot sign 2fa-pending tokens");
  return Buffer.from(s, "utf8");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function issuePendingToken(userId: string, ttlSeconds = TWOFA_PENDING_TTL_SECONDS): string {
  const payload: PendingPayload = {
    userId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPendingToken(
  token: string | undefined | null,
): { ok: true; userId: string; expiresAt: number } | { ok: false } {
  if (!token || typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, sig] = parts;
  if (!body || !sig) return { ok: false };
  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const given = base64urlDecode(sig);
  if (given.length !== expected.length) return { ok: false };
  if (!timingSafeEqual(given, expected)) return { ok: false };
  let payload: PendingPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8")) as PendingPayload;
  } catch {
    return { ok: false };
  }
  if (typeof payload.userId !== "string" || typeof payload.expiresAt !== "number") {
    return { ok: false };
  }
  if (payload.expiresAt < Date.now()) return { ok: false };
  return { ok: true, userId: payload.userId, expiresAt: payload.expiresAt };
}

/** Set the cookie. Call from server actions / route handlers only. */
export async function setPendingCookie(userId: string): Promise<void> {
  const c = await cookies();
  c.set({
    name: TWOFA_PENDING_COOKIE,
    value: issuePendingToken(userId),
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: TWOFA_PENDING_TTL_SECONDS,
  });
}

/**
 * Delete by overwriting with maxAge=0 + matching attributes — bare c.delete()
 * can silently no-op on __Host- cookies if attributes don't line up.
 */
export async function clearPendingCookie(): Promise<void> {
  const c = await cookies();
  c.set({
    name: TWOFA_PENDING_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

/** Read + verify the cookie. Returns the userId if the token is valid, else null. */
export async function readPendingUserId(): Promise<string | null> {
  const c = await cookies();
  const token = c.get(TWOFA_PENDING_COOKIE)?.value;
  const v = verifyPendingToken(token);
  return v.ok ? v.userId : null;
}
