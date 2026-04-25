/**
 * Vault 2FA session — second cookie that stacks on top of the existing
 * vault PIN cookie when the user has 2FA enrolled.
 *
 * Same shape as the vault-pin token: HMAC-signed `{expiresAt}` payload,
 * 60s non-sliding TTL, httpOnly + __Host- prefix. Cleared in lockVaultSession
 * and on logout alongside the PIN cookie.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const VAULT_2FA_COOKIE = "__Host-vault-2fa";
export const VAULT_2FA_TTL_SECONDS = 60;

type TokenPayload = { expiresAt: number };

function getSecret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — cannot sign vault-2fa tokens");
  return Buffer.from(s, "utf8");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function issueVault2faToken(ttlSeconds = VAULT_2FA_TTL_SECONDS): string {
  const payload: TokenPayload = { expiresAt: Date.now() + ttlSeconds * 1000 };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyVault2faToken(token: string | undefined | null): {
  ok: boolean;
  expiresAt?: number;
} {
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

export async function hasVault2faSession(): Promise<boolean> {
  const c = await cookies();
  const token = c.get(VAULT_2FA_COOKIE)?.value;
  return verifyVault2faToken(token).ok;
}

export async function requireVault2faSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(VAULT_2FA_COOKIE)?.value;
  if (!verifyVault2faToken(token).ok) {
    throw new Error("Vault 2FA required. Enter your code to continue.");
  }
}

export async function setVault2faCookie(): Promise<void> {
  const c = await cookies();
  c.set({
    name: VAULT_2FA_COOKIE,
    value: issueVault2faToken(),
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: VAULT_2FA_TTL_SECONDS,
  });
}

export async function clearVault2faCookie(): Promise<void> {
  const c = await cookies();
  c.set({
    name: VAULT_2FA_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
