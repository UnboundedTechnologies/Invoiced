/**
 * Verifies the pure logic behind the optimistic-locking helper:
 * parseExpectedVersion(fd), versionConflictError(label, expected, current),
 * and bumpVersion() returning a SQL fragment that increments by 1.
 *
 * Concurrent-update behavior (atomic UPDATE WHERE version = expected) is not
 * exercised here — that requires a live DB and is environment-dependent.
 * Smoke-test in the browser by opening /dividends in two tabs and editing the
 * same row; the second submit should surface "updated in another tab".
 *
 * Run: `pnpm verify-optimistic-lock`. Fails the process (exit 1) on any mismatch.
 */

import {
  parseExpectedVersion,
  versionConflictError,
  bumpVersion,
  VERSION_CONFLICT_CODE,
} from "../src/lib/optimistic-lock";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}
function expectMatch(failures: string[], label: string, s: string, re: RegExp) {
  if (!re.test(s)) failures.push(`${label}: ${JSON.stringify(s)} did not match ${re}`);
}

function fdWith(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

(() => {
  const failures: string[] = [];
  expectEq(failures, "missing field → null", parseExpectedVersion(fdWith({})), null);
  expectEq(failures, "empty string → null", parseExpectedVersion(fdWith({ expectedVersion: "" })), null);
  expectEq(failures, "valid '1' → 1", parseExpectedVersion(fdWith({ expectedVersion: "1" })), 1);
  expectEq(failures, "valid '42' → 42", parseExpectedVersion(fdWith({ expectedVersion: "42" })), 42);
  record("parseExpectedVersion: returns null on missing/empty, integer on valid input", failures);
})();

(() => {
  const failures: string[] = [];
  expectEq(failures, "non-numeric → null", parseExpectedVersion(fdWith({ expectedVersion: "abc" })), null);
  expectEq(failures, "decimal → null", parseExpectedVersion(fdWith({ expectedVersion: "1.5" })), null);
  expectEq(failures, "negative → null", parseExpectedVersion(fdWith({ expectedVersion: "-1" })), null);
  expectEq(failures, "zero → null", parseExpectedVersion(fdWith({ expectedVersion: "0" })), null);
  expectEq(failures, "Infinity → null", parseExpectedVersion(fdWith({ expectedVersion: "Infinity" })), null);
  expectEq(failures, "scientific notation parses as integer (1e2 → 100)", parseExpectedVersion(fdWith({ expectedVersion: "1e2" })), 100);
  record("parseExpectedVersion: rejects invalid + non-positive integers", failures);
})();

(() => {
  const failures: string[] = [];
  const msg = versionConflictError("dividend", 3, 5);
  expectMatch(failures, "mentions label", msg, /dividend/);
  expectMatch(failures, "mentions expected version", msg, /v3/);
  expectMatch(failures, "mentions current version", msg, /v5/);
  expectMatch(failures, "tells user to refresh", msg, /[Rr]efresh/);
  expectMatch(failures, "explains another tab", msg, /another tab/i);
  record("versionConflictError: human-readable, names label + expected + current + suggests refresh", failures);
})();

(() => {
  const failures: string[] = [];
  const a = versionConflictError("dividend", 1, 2);
  const b = versionConflictError("dividend", 1, 2);
  const c = versionConflictError("paycheque", 1, 2);
  expectEq(failures, "deterministic for same inputs", a, b);
  if (a === c) failures.push("different label should produce different message");
  record("versionConflictError: deterministic + label-distinguishing", failures);
})();

(() => {
  const failures: string[] = [];
  const expr = bumpVersion();
  // Drizzle's sql`...` returns an SQL chunk. The template body is on .queryChunks.
  const chunks = (expr as unknown as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) {
    failures.push(`expected queryChunks array, got: ${typeof chunks}`);
  } else {
    const literal = chunks
      .map((c) => (c && typeof c === "object" && "value" in c ? (c as { value: unknown }).value : c))
      .filter((v) => Array.isArray(v) || typeof v === "string")
      .flat()
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    expectMatch(failures, "expression contains 'version'", literal, /version/);
    expectMatch(failures, "expression increments by 1", literal, /\+\s*1/);
  }
  record("bumpVersion: produces 'version + 1' SQL fragment", failures);
})();

(() => {
  const failures: string[] = [];
  expectEq(failures, "code constant value", VERSION_CONFLICT_CODE, "version_conflict");
  record("VERSION_CONFLICT_CODE: stable string discriminator", failures);
})();

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Optimistic-lock pure-logic verification ===\n");
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

main();
