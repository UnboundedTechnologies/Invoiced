/**
 * Phase 5-5d helper — print row counts for tables we expect to be unchanged
 * between prod-now and the drill branch (created from a point-in-time ~1h ago).
 *
 * Usage:
 *   pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/drill-row-counts.ts
 *   DATABASE_URL=<drill-branch-url> pnpm dlx tsx scripts/drill-row-counts.ts
 *
 * Read-only. Safe to run against any branch.
 */
import { db } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

const TABLES = [
  "users",
  "settings",
  "invoices",
  "invoice_lines",
  "contracts",
  "clients",
  "paycheques",
  "dividends",
  "expenses",
  "remittances",
  "documents",
  "audit_log",
  "slips",
];

async function main() {
  const masked = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":***@");
  console.log(`→ Counting rows on:  ${masked}`);
  for (const t of TABLES) {
    const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t}`));
    const n = (r as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    console.log(`  ${t.padEnd(22)} ${n}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
