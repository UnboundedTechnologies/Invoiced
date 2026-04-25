/**
 * Pure TOTP / 2FA primitives. No env access at module load — every function
 * that needs a key takes it as an explicit parameter so verify scripts can
 * exercise the full crypto path with a literal test key.
 *
 * Threat model: AES-256-GCM ciphertext at rest under TOTP_ENCRYPTION_KEY,
 * so a DB dump alone doesn't expose TOTP secrets. Backup codes are argon2id
 * hashed and consumed on use.
 *
 * otplib v13 functional API: generateSecret / generateURI / verifySync.
 * Default strategy is TOTP, default step is 30s, default digits is 6,
 * default algorithm is SHA1 — exactly what every consumer-grade authenticator
 * app expects (Google, Authy, 1Password).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from "otplib";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import QRCode from "qrcode";

/** ±30s tolerance = ±1 step at the 30s default. RFC 6238 standard. */
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

/** Argon2id params — match the existing login + vault PIN cost so we don't
 * accidentally introduce a weaker hash on a parallel auth surface. */
const ARGON2_PARAMS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

/** Generate a fresh base32 secret. Default 20 bytes (160 bits). */
export function generateSecret(): string {
  return otpGenerateSecret();
}

/** Verify a 6-digit code against a base32 secret. ±30s drift. */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({
      secret,
      token: code,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/** Build the otpauth:// URI consumed by authenticator app QR scanners. */
export function buildOtpAuthUri(email: string, secret: string, issuer: string): string {
  return generateURI({
    issuer,
    label: email,
    secret,
  });
}

/** Render an otpauth:// URI as a base64 PNG data URI for an <img> tag. */
export async function qrDataUri(otpAuthUri: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

// ── AES-256-GCM ───────────────────────────────────────────────────────────────
// Output format: base64(iv | tag | ciphertext). 12-byte IV, 16-byte auth tag.
// Key is 32 raw bytes, supplied as a base64 string by the caller.

function decodeKey(keyB64: string): Buffer {
  const buf = Buffer.from(keyB64, "base64");
  if (buf.length !== 32) {
    throw new Error(`TOTP encryption key must be 32 bytes (got ${buf.length})`);
  }
  return buf;
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = decodeKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(payloadB64: string, keyB64: string): string {
  const key = decodeKey(keyB64);
  const buf = Buffer.from(payloadB64, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ── Backup codes ──────────────────────────────────────────────────────────────
// 10 codes of 8 alphanumeric characters (uppercase, easy to read aloud).
// Each shown ONCE at enrollment, hashed at rest, consumed on use.

const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

export function generateBackupCodes(count = 10): string[] {
  const out: string[] = [];
  while (out.length < count) {
    const bytes = randomBytes(8);
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += BACKUP_CODE_ALPHABET[bytes[i]! % BACKUP_CODE_ALPHABET.length];
    }
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export async function hashBackupCode(code: string): Promise<string> {
  return argon2Hash(code.toUpperCase(), ARGON2_PARAMS);
}

/** Returns the new hash array (with the consumed entry removed) on success,
 * or null if the code didn't match anything. Callers persist the new array. */
export async function verifyAndConsumeBackupCode(
  code: string,
  hashes: string[],
): Promise<string[] | null> {
  const normalized = code.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(normalized)) return null;
  for (let i = 0; i < hashes.length; i++) {
    if (await argon2Verify(hashes[i]!, normalized)) {
      return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
  }
  return null;
}
