/**
 * PII / secret leakage guard for the audit_log.metadata JSONB column.
 *
 * Scans every audit_log row's metadata object for keys that look like
 * they might contain sensitive data we've promised NEVER to log.
 * Catches accidents from future code where a dev dumps a whole request
 * body or user row into metadata.
 *
 * Fails the process (exit 1) on any hit so this can run in verify-all
 * and eventually CI. Safe to run against prod — read-only.
 *
 * Usage:
 *   pnpm dlx dotenv-cli -e .env.local                -- tsx scripts/verify-audit-metadata.ts
 *   pnpm dlx dotenv-cli -e .env.production.local     -- tsx scripts/verify-audit-metadata.ts
 *
 * Also wired into `pnpm verify-all` via the --env-file dev path so
 * local dev catches regressions without needing prod creds.
 */
import { db } from "../src/lib/db/client";
import { auditLog } from "../src/lib/db/schema";

// Forbidden tokens — must match as a whole word in the key after tokenizing
// by underscore / hyphen / camelCase boundary. This avoids false positives
// like "sin" inside "business" or "pin" inside "pinned".
const FORBIDDEN_TOKENS = new Set([
  "password",
  "passwd",
  "pwd",
  "passhash",
  "hash",           // matches pinHash, passwordHash, hashValue — never a token we want in metadata
  "secret",
  "credential",
  "credentials",
  "token",
  "bearer",
  "apikey",
  "sin",
  "socialinsurance",
  "pin",            // matches vaultPin, pinValue — PIN values should never be logged
]);

// Tokens that would otherwise trip FORBIDDEN_TOKENS but are context-specific
// false positives we've reviewed and deemed safe. Keep the list short; each
// entry is effectively an argument that the key name is misleading but not
// carrying sensitive data.
const ALLOWLISTED_EXACT_KEYS = new Set<string>([
  // Add as discovered. Empty for now — no live rows need this.
]);

function tokenizeKey(key: string): string[] {
  return key
    .split(/[_-]|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

function keyIsForbidden(key: string): string | null {
  if (ALLOWLISTED_EXACT_KEYS.has(key)) return null;
  for (const token of tokenizeKey(key)) {
    if (FORBIDDEN_TOKENS.has(token)) return token;
  }
  return null;
}

function walkObjectForForbidden(
  obj: unknown,
  path: string,
  hits: { rowId: string; path: string; key: string; matched: string; preview: string }[],
  rowId: string,
): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkObjectForForbidden(v, `${path}[${i}]`, hits, rowId));
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key;
    const matched = keyIsForbidden(key);
    if (matched) {
      const preview = typeof value === "string" ? value.slice(0, 20) + "…" : JSON.stringify(value).slice(0, 40);
      hits.push({ rowId, path: fullPath, key, matched, preview });
    }
    walkObjectForForbidden(value, fullPath, hits, rowId);
  }
}

async function main() {
  console.log("→ Scanning audit_log.metadata for forbidden keys…");
  const rows = await db
    .select({ id: auditLog.id, metadata: auditLog.metadata })
    .from(auditLog);
  console.log(`  ${rows.length} rows to scan`);

  const hits: { rowId: string; path: string; key: string; matched: string; preview: string }[] = [];
  for (const r of rows) {
    if (r.metadata === null) continue;
    walkObjectForForbidden(r.metadata, "", hits, r.id);
  }

  if (hits.length === 0) {
    console.log("✓ No forbidden metadata keys found.");
    process.exit(0);
  }

  console.log(`✘ Found ${hits.length} forbidden key(s):`);
  for (const h of hits) {
    console.log(`  row=${h.rowId}  path=${h.path}  matched=${h.matched}  preview=${h.preview}`);
  }
  console.log("\n  Remediation: update the offending action to strip/omit these");
  console.log("  keys before inserting into audit_log.metadata.");
  process.exit(1);
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
