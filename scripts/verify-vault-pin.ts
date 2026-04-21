/**
 * Verifies the pure parts of `src/lib/vault-pin.ts`:
 *  - weak-PIN classifier
 *  - token sign + verify + tamper-resistance
 *  - hashPin / verifyPin round-trip
 *  - formatRetryAfter wording
 *
 * DB-backed bits (getLockoutState, recordAttempt, getPinHash) require a
 * live database and are exercised via the Settings → Security tab during
 * manual smoke. See `pnpm reset-vault-pin` for the CLI reset escape hatch.
 *
 * Run: `pnpm verify-vault-pin`. Fails the process (exit 1) on any mismatch.
 */

// AUTH_SECRET is needed for HMAC — stub it before importing the lib.
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "test-secret-for-verify-vault-pin-do-not-use-in-prod";
}

import {
  weakPinReason,
  issueToken,
  verifyToken,
  hashPin,
  verifyPin,
  formatRetryAfter,
} from "../src/lib/vault-pin";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

// ——— Test 1: weakPinReason flags obvious bad PINs and lets good ones through ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "111111 is weak", weakPinReason("111111") !== null, true);
  expectEq(failures, "000000 is weak", weakPinReason("000000") !== null, true);
  expectEq(failures, "123456 is weak", weakPinReason("123456") !== null, true);
  expectEq(failures, "654321 is weak", weakPinReason("654321") !== null, true);
  expectEq(failures, "012345 is weak", weakPinReason("012345") !== null, true);
  expectEq(failures, "739204 is fine", weakPinReason("739204"), null);
  expectEq(failures, "482917 is fine", weakPinReason("482917"), null);
  // Non-6-digit inputs return null (upstream schema rejects them first)
  expectEq(failures, "empty returns null", weakPinReason(""), null);
  expectEq(failures, "letters return null", weakPinReason("abcdef"), null);
  record("weakPinReason: flags repeats + strict runs, leaves random PINs alone", failures);
})();

// ——— Test 2: token sign+verify round-trip + expiry ———
(() => {
  const failures: string[] = [];
  const t = issueToken(60); // 60s TTL
  const v = verifyToken(t);
  expectEq(failures, "fresh token is valid", v.ok, true);
  expectEq(failures, "no token → invalid", verifyToken(null).ok, false);
  expectEq(failures, "empty string → invalid", verifyToken("").ok, false);
  expectEq(failures, "bogus string → invalid", verifyToken("not-a-token").ok, false);

  // Tampered signature
  const parts = t.split(".");
  const tampered = `${parts[0]}.${Buffer.from("deadbeef", "hex").toString("base64url")}`;
  expectEq(failures, "tampered signature → invalid", verifyToken(tampered).ok, false);

  // Tampered body (flip a char)
  const badBody = (parts[0] ?? "").replace(/^./, "x") + "." + (parts[1] ?? "");
  expectEq(failures, "tampered body → invalid", verifyToken(badBody).ok, false);
  record("Token: valid round-trip, rejects bogus + tampered inputs", failures);
})();

// ——— Test 3: expired token fails ———
(() => {
  const failures: string[] = [];
  const t = issueToken(-1); // already expired
  expectEq(failures, "expired token rejected", verifyToken(t).ok, false);
  record("Token: already-expired tokens are rejected", failures);
})();

// ——— Test 4: signature key binding — different AUTH_SECRET → invalid ———
(() => {
  const failures: string[] = [];
  const t = issueToken();
  const originalSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "different-secret-completely";
  const v = verifyToken(t);
  process.env.AUTH_SECRET = originalSecret;
  expectEq(failures, "token signed with old secret rejected under new secret", v.ok, false);
  record("Token: HMAC key is load-bearing — wrong secret rejects valid tokens", failures);
})();

// ——— Test 5: hashPin / verifyPin round-trip ———
(async () => {
  const failures: string[] = [];
  const pin = "482917";
  const hash = await hashPin(pin);
  // Argon2id encoded hashes start with $argon2id$
  if (!hash.startsWith("$argon2id$")) failures.push(`hash missing argon2id prefix: ${hash.slice(0, 20)}`);
  const okRight = await verifyPin(hash, pin);
  const okWrong = await verifyPin(hash, "482918");
  expectEq(failures, "correct PIN verifies", okRight, true);
  expectEq(failures, "wrong PIN rejected", okWrong, false);
  // Two hashes of the same PIN must differ (random salt)
  const hash2 = await hashPin(pin);
  if (hash === hash2) failures.push("hashes of same PIN should differ (salt required)");
  record("Argon2id: round-trip verifies, wrong PIN rejected, salting is non-deterministic", failures);
  runAll();
})().catch((e) => {
  console.error("✘ test 5 threw", e);
  process.exit(1);
});

// ——— Test 6: formatRetryAfter wording ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "1s", formatRetryAfter(1_000), "1s");
  expectEq(failures, "59s", formatRetryAfter(59_000), "59s");
  expectEq(failures, "60s rounds to 1 min", formatRetryAfter(60_000), "1 min");
  expectEq(failures, "5 min", formatRetryAfter(5 * 60_000), "5 min");
  expectEq(failures, "15 min", formatRetryAfter(15 * 60_000), "15 min");
  record("formatRetryAfter: seconds under a minute, rounded minutes above", failures);
})();

// ——— runner ———
// Kicked off by test 5's async completion so we don't print before the
// round-trip resolves. The synchronous tests have all pushed into `results`
// by the time we get here.

function runAll() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Vault PIN pure-logic verification ===\n");
  for (const r of results) {
    if (r.failures.length === 0) {
      console.log(`✓ ${r.name}`);
      pass++;
    } else {
      console.log(`✗ ${r.name}`);
      r.failures.forEach((f) => console.log(`    ${f}`));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}
