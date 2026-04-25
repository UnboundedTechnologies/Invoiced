/**
 * Façade that assembles a `T1Input` for a given calendar year.
 *
 * This is the ONLY place T1 inputs are composed. `/personal-tax` detail page,
 * the dashboard façade `estimateT1`, and Phase 6's self-pay planner all call
 * `buildT1Inputs`. `taxYearsWithActivity` drives the list-page candidate
 * detection (CYs where paycheques/dividends/loan benefits exist).
 */

import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dividends, paycheques, settings, shareholderLoanEntries } from "../db/schema";
import type { T1Input } from "../t1";
import { t4BoxesForYear } from "./t4-slices";
import { t5BoxesForYear } from "./t5-slices";
import { t4aBox117ForYear } from "./t4a-slices";
import { donationsForYear } from "./donations-slices";
import { contributionsForYear } from "./contributions-slices";

export async function buildT1Inputs(taxYear: number): Promise<T1Input> {
  const [t4, t5, t4a, don, contrib, [s]] = await Promise.all([
    t4BoxesForYear(taxYear),
    t5BoxesForYear(taxYear),
    t4aBox117ForYear(taxYear),
    donationsForYear(taxYear),
    contributionsForYear(taxYear),
    db.select().from(settings).where(eq(settings.id, 1)),
  ]);

  return {
    taxYear,
    t4: {
      box14EmploymentIncomeCents: t4.box14EmploymentIncomeCents,
      box16CppBaseCents: t4.box16CppBaseCents,
      box16aCpp2Cents: t4.box16aCpp2Cents,
      box18EiCents: t4.box18EiCents,
      box22FedTaxWithheldCents: t4.box22FedTaxWithheldCents,
      box24EiInsurableCents: t4.box24EiInsurableCents,
      box26CppPensionableCents: t4.box26CppPensionableCents,
      box52PensionAdjustmentCents: t4.box52PensionAdjustmentCents,
      ontarioTaxWithheldCents: t4.ontarioTaxWithheldCents,
    },
    t5: {
      eligibleActualCents: t5.eligible.actualCents,
      nonEligibleActualCents: t5.nonEligible.actualCents,
    },
    t4aBox117Cents: t4a.cents,
    donations: { totalCents: don.totalCents },
    rrsp: {
      contributionsCents: contrib.rrspCents,
      deductionLimitCents: s?.rrspRoomCents ?? 0,
    },
    fhsa: {
      contributionsCents: contrib.fhsaCents,
      roomCents: s?.fhsaRoomCents ?? 0,
    },
  };
}

/**
 * Returns the distinct set of calendar years where Saïd has any personal-tax
 * activity (issued paycheques, paid dividends, or loan ledger entries). Used
 * by /personal-tax list page to drive the "Start CY X" CTA.
 */
export async function taxYearsWithActivity(): Promise<number[]> {
  const [paychequeYears, dividendYears, loanYears] = await Promise.all([
    db
      .select({ year: sql<string>`to_char(${paycheques.payDate}, 'YYYY')` })
      .from(paycheques)
      .groupBy(sql`to_char(${paycheques.payDate}, 'YYYY')`),
    db
      .select({ year: sql<string>`to_char(${dividends.paidDate}, 'YYYY')` })
      .from(dividends)
      .where(isNotNull(dividends.paidDate))
      .groupBy(sql`to_char(${dividends.paidDate}, 'YYYY')`),
    db
      .select({ year: sql<string>`to_char(${shareholderLoanEntries.entryDate}, 'YYYY')` })
      .from(shareholderLoanEntries)
      .groupBy(sql`to_char(${shareholderLoanEntries.entryDate}, 'YYYY')`),
  ]);

  const set = new Set<number>();
  for (const r of [...paychequeYears, ...dividendYears, ...loanYears]) {
    if (r.year) set.add(Number(r.year));
  }
  return Array.from(set).sort((a, b) => a - b);
}
