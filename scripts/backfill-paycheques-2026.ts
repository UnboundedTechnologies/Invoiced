/**
 * One-off backfill: recomputes every issued 2026 paycheque against the
 * corrected Jan 1 2026 T4127 constants in src/lib/payroll-2026.ts.
 *
 * Context: the prior version of payroll-2026.ts encoded 2025 indexation
 * values (YMPE 71,300 / YAMPE 81,200 / old brackets + BPA). Paycheques
 * already issued were stored with those wrong deductions. Phase 4D's T1
 * box-identity checks need the paycheque columns to match the corrected
 * PDOC formulas — hence this backfill.
 *
 * Safety:
 * - Dry-run by default. Prints a per-row before/after diff and totals.
 * - `--apply` flag is required to actually UPDATE rows.
 * - Void paycheques are skipped (don't rewrite history on voided rows).
 * - Draft paycheques are skipped (they recompute on next save anyway).
 * - Audit-log entry per updated row with {old, new}.
 *
 *   Dry run:      pnpm backfill-paycheques-2026
 *   Actually run: pnpm backfill-paycheques-2026 --apply
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { paycheques, settings, auditLog } from "../src/lib/db/schema";
import { computePayroll, payPeriodsFromCadence } from "../src/lib/payroll-2026";
import { formatCAD } from "../src/lib/utils";

const APPLY = process.argv.includes("--apply");
const ALLOWED_EMAIL = process.env.ALLOWED_LOGIN_EMAIL?.toLowerCase() ?? "cli:backfill-paycheques-2026";

function fmtDelta(oldV: number, newV: number): string {
  const diff = newV - oldV;
  const sign = diff > 0 ? "+" : diff < 0 ? "" : " ";
  return `${formatCAD(oldV).padStart(11)} → ${formatCAD(newV).padStart(11)}  (${sign}${formatCAD(diff)})`;
}

async function main() {
  console.log(APPLY ? "=== Paycheque 2026 backfill (APPLY) ===\n" : "=== Paycheque 2026 backfill (dry run) ===\n");

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) {
    console.error("settings row missing — run `pnpm seed` first.");
    process.exit(1);
  }
  const periods = payPeriodsFromCadence(s.payCadence);

  // Process by pay date ASC so CPP/CPP2 YTD accumulators match chronological order.
  const rows = await db
    .select()
    .from(paycheques)
    .where(eq(paycheques.status, "issued"))
    .orderBy(asc(paycheques.payDate));

  if (rows.length === 0) {
    console.log("No issued paycheques to process. ✓");
    return;
  }

  const byYear = new Map<string, typeof rows>();
  for (const r of rows) {
    const y = r.payDate.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }

  let changedCount = 0;
  let unchangedCount = 0;
  let totalGrossChange = 0;
  let totalFedChange = 0;
  let totalOnChange = 0;
  let totalCppChange = 0;
  let totalCpp2Change = 0;
  let totalNetChange = 0;
  let totalRemitChange = 0;

  for (const [year, yearRows] of Array.from(byYear.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n--- Calendar year ${year} (${yearRows.length} issued paycheques) ---\n`);
    let ytdCpp = 0;
    let ytdCpp2 = 0;
    let ytdGross = 0;

    for (const row of yearRows) {
      const recomputed = computePayroll({
        grossCents: row.grossCents,
        ytdCppCents: ytdCpp,
        ytdCpp2Cents: ytdCpp2,
        ytdGrossCents: ytdGross,
        payPeriodsPerYear: periods,
      });

      const changedFields: string[] = [];
      if (row.cppCents !== recomputed.cppCents) changedFields.push("cpp");
      if (row.cpp2Cents !== recomputed.cpp2Cents) changedFields.push("cpp2");
      if (row.federalTaxCents !== recomputed.federalTaxCents) changedFields.push("fedTax");
      if (row.provincialTaxCents !== recomputed.provincialTaxCents) changedFields.push("onTax");
      if (row.netCents !== recomputed.netCents) changedFields.push("net");
      if (row.employerCppCents !== recomputed.employerCppCents) changedFields.push("erCpp");
      if (row.employerCpp2Cents !== recomputed.employerCpp2Cents) changedFields.push("erCpp2");
      if (row.totalRemittanceCents !== recomputed.totalRemittanceCents) changedFields.push("remit");

      if (changedFields.length === 0) {
        unchangedCount++;
        console.log(`  · ${row.payDate}  gross ${formatCAD(row.grossCents).padStart(11)}  (no change)`);
      } else {
        changedCount++;
        totalCppChange += recomputed.cppCents - row.cppCents;
        totalCpp2Change += recomputed.cpp2Cents - row.cpp2Cents;
        totalFedChange += recomputed.federalTaxCents - row.federalTaxCents;
        totalOnChange += recomputed.provincialTaxCents - row.provincialTaxCents;
        totalNetChange += recomputed.netCents - row.netCents;
        totalRemitChange += recomputed.totalRemittanceCents - row.totalRemittanceCents;
        totalGrossChange += 0;

        console.log(`  ✎ ${row.payDate}  gross ${formatCAD(row.grossCents).padStart(11)}`);
        console.log(`      cpp    ${fmtDelta(row.cppCents, recomputed.cppCents)}`);
        console.log(`      cpp2   ${fmtDelta(row.cpp2Cents, recomputed.cpp2Cents)}`);
        console.log(`      fedTax ${fmtDelta(row.federalTaxCents, recomputed.federalTaxCents)}`);
        console.log(`      onTax  ${fmtDelta(row.provincialTaxCents, recomputed.provincialTaxCents)}`);
        console.log(`      net    ${fmtDelta(row.netCents, recomputed.netCents)}`);
        console.log(`      erCpp  ${fmtDelta(row.employerCppCents, recomputed.employerCppCents)}`);
        console.log(`      erCpp2 ${fmtDelta(row.employerCpp2Cents, recomputed.employerCpp2Cents)}`);
        console.log(`      remit  ${fmtDelta(row.totalRemittanceCents, recomputed.totalRemittanceCents)}`);

        if (APPLY) {
          await db.transaction(async (tx) => {
            await tx
              .update(paycheques)
              .set({
                cppCents: recomputed.cppCents,
                cpp2Cents: recomputed.cpp2Cents,
                federalTaxCents: recomputed.federalTaxCents,
                provincialTaxCents: recomputed.provincialTaxCents,
                netCents: recomputed.netCents,
                employerCppCents: recomputed.employerCppCents,
                employerCpp2Cents: recomputed.employerCpp2Cents,
                totalRemittanceCents: recomputed.totalRemittanceCents,
              })
              .where(eq(paycheques.id, row.id));
            await tx.insert(auditLog).values({
              actorEmail: ALLOWED_EMAIL,
              action: "update",
              target: `paycheque:${row.id}`,
              metadata: {
                source: "backfill-paycheques-2026",
                reason: "Jan 1 2026 T4127 rate correction",
                before: {
                  cppCents: row.cppCents,
                  cpp2Cents: row.cpp2Cents,
                  federalTaxCents: row.federalTaxCents,
                  provincialTaxCents: row.provincialTaxCents,
                  netCents: row.netCents,
                  employerCppCents: row.employerCppCents,
                  employerCpp2Cents: row.employerCpp2Cents,
                  totalRemittanceCents: row.totalRemittanceCents,
                },
                after: {
                  cppCents: recomputed.cppCents,
                  cpp2Cents: recomputed.cpp2Cents,
                  federalTaxCents: recomputed.federalTaxCents,
                  provincialTaxCents: recomputed.provincialTaxCents,
                  netCents: recomputed.netCents,
                  employerCppCents: recomputed.employerCppCents,
                  employerCpp2Cents: recomputed.employerCpp2Cents,
                  totalRemittanceCents: recomputed.totalRemittanceCents,
                },
                changedFields,
              },
            });
          });
        }
      }

      // Feed YTD forward using the NEW values (matches chronological reality).
      ytdCpp += recomputed.cppCents;
      ytdCpp2 += recomputed.cpp2Cents;
      ytdGross += recomputed.grossCents;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Scanned    : ${rows.length} issued paycheques`);
  console.log(`  Changed    : ${changedCount}`);
  console.log(`  Unchanged  : ${unchangedCount}`);
  console.log(`  Δ CPP      : ${formatCAD(totalCppChange)}`);
  console.log(`  Δ CPP2     : ${formatCAD(totalCpp2Change)}`);
  console.log(`  Δ Fed tax  : ${formatCAD(totalFedChange)}`);
  console.log(`  Δ ON tax   : ${formatCAD(totalOnChange)}`);
  console.log(`  Δ Net      : ${formatCAD(totalNetChange)}`);
  console.log(`  Δ Remit    : ${formatCAD(totalRemitChange)}`);
  console.log(APPLY ? "\n✓ Applied. Audit-log entries written." : "\n(Dry run — re-run with --apply to commit.)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
