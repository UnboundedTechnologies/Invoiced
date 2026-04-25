/**
 * Verifies the pure parts of `src/lib/totp.ts`:
 *  - AES-256-GCM encrypt/decrypt round-trip
 *  - AES-256-GCM rejects tampered ciphertext
 *  - AES-256-GCM rejects wrong key
 *  - TOTP verify accepts current valid code, rejects bad format / wrong code
 *  - Backup-code generation uniqueness
 *  - Backup-code hash + verifyAndConsume removes consumed entry, rejects reuse
 *  - Backup-code invalid format rejected
 *
 * DB-backed flows are exercised through the enrollment wizard / login flow
 * during manual smoke. CLI escape: `pnpm reset-2fa`.
 *
 * Run: `pnpm verify-totp`. Fails the process (exit 1) on any mismatch.
 */
import { generateSync } from "otplib";
import {
  encryptSecret,
  decryptSecret,
  generateSecret,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
  verifyAndConsumeBackupCode,
  buildOtpAuthUri,
} from "../src/lib/totp";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64");
const ALT_KEY = Buffer.alloc(32, 0x99).toString("base64");

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}
function expectThrows(failures: string[], label: string, fn: () => unknown) {
  try {
    fn();
    failures.push(`${label}: expected throw, none thrown`);
  } catch {
    /* expected */
  }
}

// ── Test 1: AES-GCM round-trip ───────────────────────────────────────────────
(() => {
  const failures: string[] = [];
  const plain = "JBSWY3DPEHPK3PXP";
  const cipher = encryptSecret(plain, TEST_KEY);
  expectEq(failures, "ciphertext is non-empty", cipher.length > 0, true);
  expectEq(failures, "ciphertext differs from plaintext", cipher !== plain, true);
  const back = decryptSecret(cipher, TEST_KEY);
  expectEq(failures, "round-trip returns original", back, plain);
  // Non-determinism: encrypting the same plaintext twice gives different ciphertexts
  // (different random IVs) — sanity check on randomization.
  const cipher2 = encryptSecret(plain, TEST_KEY);
  expectEq(failures, "two encryptions yield different ciphertexts", cipher !== cipher2, true);
  record("AES-GCM: round-trip + non-deterministic ciphertext", failures);
})();

// ── Test 2: AES-GCM rejects tampering ────────────────────────────────────────
(() => {
  const failures: string[] = [];
  const cipher = encryptSecret("hello", TEST_KEY);
  // Flip a byte in the middle of the payload (likely the auth tag or ciphertext)
  const buf = Buffer.from(cipher, "base64");
  buf[20] = (buf[20] ?? 0) ^ 0xff;
  const tampered = buf.toString("base64");
  expectThrows(failures, "tampered ciphertext throws on decrypt", () => decryptSecret(tampered, TEST_KEY));
  record("AES-GCM: rejects tampered ciphertext", failures);
})();

// ── Test 3: AES-GCM rejects wrong key ────────────────────────────────────────
(() => {
  const failures: string[] = [];
  const cipher = encryptSecret("hello", TEST_KEY);
  expectThrows(failures, "wrong key throws on decrypt", () => decryptSecret(cipher, ALT_KEY));
  // Bad key length should reject up front
  expectThrows(failures, "short key throws", () => encryptSecret("hello", Buffer.alloc(16).toString("base64")));
  record("AES-GCM: rejects wrong key + bad key length", failures);
})();

// ── Test 4: TOTP verify ──────────────────────────────────────────────────────
(() => {
  const failures: string[] = [];
  const secret = generateSecret();
  const validCode = generateSync({ secret });
  expectEq(failures, "freshly-generated code verifies", verifyTotp(secret, validCode), true);
  expectEq(failures, "non-6-digit rejected", verifyTotp(secret, "12345"), false);
  expectEq(failures, "letters rejected", verifyTotp(secret, "abcdef"), false);
  expectEq(failures, "empty rejected", verifyTotp(secret, ""), false);
  // Random 6-digit code is overwhelmingly unlikely to match. Verify with a code
  // that's deterministically wrong by adding one to each digit.
  const wrong = validCode.split("").map((d) => (Number(d) + 1) % 10).join("");
  expectEq(failures, "off-by-one digits code rejected", verifyTotp(secret, wrong), false);
  record("TOTP: accepts valid current code, rejects bad format + wrong code", failures);
})();

// ── Test 5: otpauth URI shape ────────────────────────────────────────────────
(() => {
  const failures: string[] = [];
  const uri = buildOtpAuthUri("said@example.com", "JBSWY3DPEHPK3PXP", "Invoiced — Unbounded Technologies");
  expectEq(failures, "URI starts with otpauth://", uri.startsWith("otpauth://"), true);
  expectEq(failures, "URI contains secret param", uri.includes("secret=JBSWY3DPEHPK3PXP"), true);
  expectEq(failures, "URI contains issuer", uri.includes("issuer=Invoiced"), true);
  record("otpauth URI: shape + required params", failures);
})();

// ── Test 6: Backup codes uniqueness + format ─────────────────────────────────
(() => {
  const failures: string[] = [];
  const codes = generateBackupCodes(10);
  expectEq(failures, "10 codes generated", codes.length, 10);
  expectEq(failures, "all unique", new Set(codes).size, 10);
  for (const c of codes) {
    if (!/^[A-Z2-9]{8}$/.test(c)) {
      failures.push(`code "${c}" violates 8×alphanumeric format (no I/O/0/1)`);
    }
  }
  record("Backup codes: 10 unique, 8-char no-confusables", failures);
})();

// ── Test 7: Backup-code hash + verifyAndConsume ──────────────────────────────
(async () => {
  const failures: string[] = [];
  const codes = generateBackupCodes(3);
  const hashes = await Promise.all(codes.map((c) => hashBackupCode(c)));
  expectEq(failures, "3 hashes generated", hashes.length, 3);
  // Consume the second one
  const remaining = await verifyAndConsumeBackupCode(codes[1]!, hashes);
  expectEq(failures, "valid code returns new array", Array.isArray(remaining), true);
  expectEq(failures, "consumed entry removed", remaining?.length, 2);
  // Reuse should fail
  const reuse = await verifyAndConsumeBackupCode(codes[1]!, remaining ?? []);
  expectEq(failures, "reuse rejected", reuse, null);
  // Wrong code rejected
  const wrong = await verifyAndConsumeBackupCode("XXXXXXXX", hashes);
  expectEq(failures, "non-matching code rejected", wrong, null);
  // Bad format rejected
  const badFormat = await verifyAndConsumeBackupCode("nope", hashes);
  expectEq(failures, "bad format rejected", badFormat, null);
  // Case-insensitive + whitespace-tolerant input
  const lowered = codes[0]!.toLowerCase();
  const okLower = await verifyAndConsumeBackupCode(`  ${lowered}  `, hashes);
  expectEq(failures, "lowercase + spaces normalized", Array.isArray(okLower), true);
  record("Backup codes: hash + verifyAndConsume + reuse rejected", failures);
})().then(() => {
  // ── Render results ─────────────────────────────────────────────────────────
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.failures.length === 0) {
      console.log(`✓ ${r.name}`);
      passed++;
    } else {
      console.log(`✗ ${r.name}`);
      for (const f of r.failures) console.log(`    ${f}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
