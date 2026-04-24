/**
 * Operational-data wipe — DESTRUCTIVE.
 *
 * Deletes every row of every operational table while preserving the identity
 * + configuration baseline (users, settings, psb_checklist_items,
 * prescribed_rate_periods). The vault blob store is NOT touched here — run
 * `pnpm cleanup-blobs --apply` after this script to purge orphaned blobs.
 *
 * Gated three ways:
 *   1. Dry-run by default; requires `--apply` flag.
 *   2. Requires typed confirmation phrase `WIPE OPERATIONAL DATA`.
 *   3. Requires DATABASE_URL (via --env-file=.env.production.local or
 *      .env.local — caller decides which DB to target, no auto-detection).
 *
 * Usage:
 *   pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/wipe-operational-data.ts
 *   pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/wipe-operational-data.ts --apply
 *
 * ALWAYS create a Neon branch of the target database before running --apply.
 */
import { sql } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { db } from "../src/lib/db/client";
import {
  auditLog,
  ccaPools,
  clients,
  contracts,
  deadlines,
  dividends,
  documents,
  expenses,
  hstReturns,
  invoiceLines,
  invoices,
  paycheques,
  plannerScenarios,
  psbSnapshots,
  remittances,
  sessions,
  shareholderLoanEntries,
  slips,
  t1Returns,
  t2Returns,
  taxPools,
  vaultPinAttempts,
} from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");
const CONFIRM_PHRASE = "WIPE OPERATIONAL DATA";

// Delete order matters: tables with inbound FK restrictions must be emptied
// BEFORE the tables they reference. Drizzle emits SQL DELETEs so we respect
// the FK graph explicitly rather than relying on cascades.
//
// Notes on the graph in schema.ts:
//  - invoice_lines → invoices (cascade)   → delete invoice_lines first (explicit for safety)
//  - invoices → contracts (restrict)
//  - contracts → clients (restrict)
//  - sessions → users (cascade)           → delete sessions to force re-login
//  - contracts.documentId is a plain uuid (no FK constraint), so documents can
//    be deleted after contracts without a trap
//  - slips.documentId is a plain uuid (no FK constraint)
const DELETE_ORDER: Array<{ label: string; exec: () => Promise<unknown> }> = [
  { label: "invoice_lines",              exec: () => db.delete(invoiceLines) },
  { label: "invoices",                   exec: () => db.delete(invoices) },
  { label: "contracts",                  exec: () => db.delete(contracts) },
  { label: "clients",                    exec: () => db.delete(clients) },
  { label: "paycheques",                 exec: () => db.delete(paycheques) },
  { label: "dividends",                  exec: () => db.delete(dividends) },
  { label: "expenses",                   exec: () => db.delete(expenses) },
  { label: "remittances",                exec: () => db.delete(remittances) },
  { label: "shareholder_loan_entries",   exec: () => db.delete(shareholderLoanEntries) },
  { label: "hst_returns",                exec: () => db.delete(hstReturns) },
  { label: "t2_returns",                 exec: () => db.delete(t2Returns) },
  { label: "t1_returns",                 exec: () => db.delete(t1Returns) },
  { label: "cca_pools",                  exec: () => db.delete(ccaPools) },
  { label: "tax_pools",                  exec: () => db.delete(taxPools) },
  { label: "planner_scenarios",          exec: () => db.delete(plannerScenarios) },
  { label: "slips",                      exec: () => db.delete(slips) },
  { label: "deadlines",                  exec: () => db.delete(deadlines) },
  { label: "psb_snapshots",              exec: () => db.delete(psbSnapshots) },
  { label: "documents",                  exec: () => db.delete(documents) },
  { label: "vault_pin_attempts",         exec: () => db.delete(vaultPinAttempts) },
  { label: "sessions",                   exec: () => db.delete(sessions) },
  { label: "audit_log",                  exec: () => db.delete(auditLog) },
];

const PRESERVED_TABLES = [
  "users",
  "settings",
  "psb_checklist_items",
  "prescribed_rate_periods",
];

async function rowCount(table: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table}`));
  // Drizzle's execute() returns { rows: [{ n: number }] } for neon-http
  const rows = (r as unknown as { rows?: Array<{ n: number }> }).rows
    ?? (r as unknown as Array<{ n: number }>);
  return rows?.[0]?.n ?? 0;
}

async function printCounts(label: string) {
  console.log(`\n— ${label} —`);
  const allTables = [...DELETE_ORDER.map((d) => d.label), ...PRESERVED_TABLES];
  for (const t of allTables) {
    const n = await rowCount(t);
    const tag = PRESERVED_TABLES.includes(t) ? "  [preserved]" : "";
    console.log(`  ${t.padEnd(30)} ${String(n).padStart(6)}${tag}`);
  }
}

async function maskedDbUrl(): Promise<string> {
  const url = process.env.DATABASE_URL ?? "(unset)";
  // Strip password but show host for operator verification
  return url.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("✘ DATABASE_URL not set. Run via:");
    console.error("    pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/wipe-operational-data.ts");
    process.exit(1);
  }

  console.log("======================================================");
  console.log(" OPERATIONAL-DATA WIPE");
  console.log("======================================================");
  console.log(`Target DB:  ${await maskedDbUrl()}`);
  console.log(`Mode:       ${APPLY ? "🔥 APPLY (destructive)" : "DRY RUN (no deletes)"}`);
  console.log(`Preserves:  ${PRESERVED_TABLES.join(", ")}`);
  console.log("======================================================");

  await printCounts("BEFORE");

  if (!APPLY) {
    console.log("\nDry-run complete. Re-run with --apply to execute.");
    process.exit(0);
  }

  // Interactive typed-confirm gate
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `\n⚠  About to DELETE every row in:\n   ${DELETE_ORDER.map((d) => d.label).join(", ")}\n\n` +
    `Type ${CONFIRM_PHRASE} (exactly) to continue, anything else to abort: `,
  );
  rl.close();
  if (answer.trim() !== CONFIRM_PHRASE) {
    console.log("✘ Aborted — confirmation did not match.");
    process.exit(1);
  }

  console.log("\n→ Executing deletes in FK-safe order…");
  let totalDeleted = 0;
  for (const step of DELETE_ORDER) {
    const before = await rowCount(step.label);
    await step.exec();
    const after = await rowCount(step.label);
    const deleted = before - after;
    totalDeleted += deleted;
    console.log(`  ${step.label.padEnd(30)} -${String(deleted).padStart(5)}  (now ${after})`);
  }

  // Re-insert a single audit_log entry documenting the wipe. The freshly-
  // emptied audit_log becomes a clean log whose first entry is this wipe
  // record.
  await db.insert(auditLog).values({
    actorEmail: "system:wipe-operational-data",
    action: "delete",
    target: "operational-data:all",
    metadata: {
      mode: "APPLY",
      rowsDeleted: totalDeleted,
      preserved: PRESERVED_TABLES,
      executedAt: new Date().toISOString(),
    },
  });

  await printCounts("AFTER");

  console.log("\n✅ Wipe complete. Next steps:");
  console.log("   1. pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/cleanup-blobs.ts --apply");
  console.log("      (purges orphaned blobs now that documents table is empty)");
  console.log("   2. Redeploy Vercel (optional — no code change required).");
}

main().catch((err) => {
  console.error("✘ Wipe failed:", err);
  process.exit(1);
});
