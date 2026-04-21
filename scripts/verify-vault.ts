/**
 * Verifies pure logic behind `/vault`: category whitelist, uploadable
 * subset, tone map completeness, `formatBytes`, and version-badge predicate.
 *
 * DB-level coherence invariants (documents.category='invoice' count ===
 * COUNT(*) FROM invoices WHERE pdfBlobUrl IS NOT NULL, etc.) are not
 * checked here — they require a live database and would make the pure
 * verification suite environment-dependent.
 *
 * Run: `pnpm verify-vault`. Fails the process (exit 1) on any mismatch.
 */

import {
  VAULT_CATEGORIES,
  USER_UPLOADABLE,
  PARENT_OWNED,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  CATEGORY_HINT,
  isVaultCategory,
  isUserUploadable,
  type VaultCategory,
} from "../src/lib/vault-categories";
import { formatBytes } from "../src/lib/utils";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

// ——— Test 1: category whitelist sanity ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "VAULT_CATEGORIES count", VAULT_CATEGORIES.length, 8);
  const uniq = new Set(VAULT_CATEGORIES);
  expectEq(failures, "no duplicates", uniq.size, VAULT_CATEGORIES.length);
  // USER_UPLOADABLE ∩ PARENT_OWNED = ∅ AND union = VAULT_CATEGORIES
  const overlap = USER_UPLOADABLE.filter((c) => (PARENT_OWNED as readonly string[]).includes(c));
  expectEq(failures, "user-uploadable ∩ parent-owned is empty", overlap.length, 0);
  const union = new Set<string>([...USER_UPLOADABLE, ...PARENT_OWNED]);
  expectEq(failures, "user-uploadable ∪ parent-owned covers all categories", union.size, VAULT_CATEGORIES.length);
  record("Category whitelist: 8 unique values, user-uploadable and parent-owned partition cleanly", failures);
})();

// ——— Test 2: label / tone / hint completeness ———
(() => {
  const failures: string[] = [];
  for (const c of VAULT_CATEGORIES) {
    if (!CATEGORY_LABEL[c]) failures.push(`missing label for ${c}`);
    if (!CATEGORY_TONE[c]) failures.push(`missing tone for ${c}`);
    if (!CATEGORY_HINT[c]) failures.push(`missing hint for ${c}`);
  }
  record("Tone + label + hint maps cover every category", failures);
})();

// ——— Test 3: isVaultCategory gatekeeps bad values ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "known value accepted", isVaultCategory("contract"), true);
  expectEq(failures, "unknown value rejected", isVaultCategory("paystubby"), false);
  expectEq(failures, "empty string rejected", isVaultCategory(""), false);
  expectEq(failures, "case-sensitive", isVaultCategory("Contract"), false);
  record("isVaultCategory: only the whitelisted values pass", failures);
})();

// ——— Test 4: isUserUploadable precisely matches the allowlist ———
(() => {
  const failures: string[] = [];
  for (const c of VAULT_CATEGORIES) {
    const expected = (USER_UPLOADABLE as readonly string[]).includes(c);
    expectEq(failures, `isUserUploadable("${c}")`, isUserUploadable(c), expected);
  }
  // And the set specifically includes the roadmap-mentioned values
  const required: VaultCategory[] = ["incorporation", "nda", "tax_return", "other"];
  for (const c of required) {
    if (!(USER_UPLOADABLE as readonly string[]).includes(c)) {
      failures.push(`user-uploadable must include ${c}`);
    }
  }
  // And parent-owned categories are NEVER user-uploadable
  for (const c of PARENT_OWNED) {
    if (isUserUploadable(c)) {
      failures.push(`parent-owned ${c} must not be user-uploadable`);
    }
  }
  record("User-uploadable allowlist: exactly {incorporation, nda, tax_return, other}", failures);
})();

// ——— Test 5: formatBytes across magnitudes ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "0 bytes", formatBytes(0), "0 B");
  expectEq(failures, "1023 bytes", formatBytes(1023), "1023 B");
  expectEq(failures, "1024 bytes", formatBytes(1024), "1.0 KB");
  expectEq(failures, "1 MB", formatBytes(1024 * 1024), "1.0 MB");
  expectEq(failures, "1.5 MB", formatBytes(Math.round(1.5 * 1024 * 1024)), "1.5 MB");
  expectEq(failures, "negative falls to em-dash", formatBytes(-1), "—");
  expectEq(failures, "NaN falls to em-dash", formatBytes(Number.NaN), "—");
  record("formatBytes: B / KB / MB thresholds + invalid input handling", failures);
})();

// ——— Test 6: version-badge predicate (shown when version > 1 OR supersedesId set) ———
(() => {
  const failures: string[] = [];
  type Row = { version: number; supersedesDocumentId: string | null };
  const show = (r: Row) => r.version > 1 || !!r.supersedesDocumentId;
  expectEq(failures, "v1 + no supersedes → hidden", show({ version: 1, supersedesDocumentId: null }), false);
  expectEq(failures, "v2 + no supersedes → shown", show({ version: 2, supersedesDocumentId: null }), true);
  expectEq(failures, "v1 + supersedes → shown", show({ version: 1, supersedesDocumentId: "uuid" }), true);
  expectEq(failures, "v3 + supersedes → shown", show({ version: 3, supersedesDocumentId: "uuid" }), true);
  record("Version badge: shown when version>1 OR supersedes_document_id is set", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Vault pure-logic verification ===\n");
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
