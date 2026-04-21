/**
 * T4A box 117 (Loan Benefits) aggregate for a given calendar year.
 *
 * Re-uses the existing `computeLoanTimeline` engine — NOT a duplicate
 * aggregation. The loan timeline is the single source for 80.4 benefits
 * and 15(2) inclusions; this helper just picks the CY summary row.
 *
 * Reads `shareholder_loan_entries` + `prescribed_rate_periods` + settings
 * (for FYE — needed by the timeline's 15(2.6) cutoff logic).
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { prescribedRatePeriods, settings, shareholderLoanEntries } from "../db/schema";
import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "../shareholder-loan";

export type T4aBox117Summary = {
  cents: number;
  breakdown: {
    benefit80_4Cents: number;
    inclusion15_2Cents: number;
  };
};

export async function t4aBox117ForYear(cy: number): Promise<T4aBox117Summary> {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) return { cents: 0, breakdown: { benefit80_4Cents: 0, inclusion15_2Cents: 0 } };

  const entryRows = await db.select().from(shareholderLoanEntries);
  const rateRows = await db.select().from(prescribedRatePeriods);

  if (entryRows.length === 0) {
    return { cents: 0, breakdown: { benefit80_4Cents: 0, inclusion15_2Cents: 0 } };
  }

  const entries: LoanEntry[] = entryRows.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    type: e.type,
    amountCents: e.amountCents,
    description: e.description,
  }));
  const rates: RatePeriod[] = rateRows.map((r) => ({
    startDate: r.startDate,
    endDate: r.endDate,
    ratePercent: r.ratePercent,
  }));

  // `today` passed as Dec 31 of cy+1 so the CY's quarterly accruals are all
  // fully materialized by the time annualSummaries are rolled up.
  const today = `${cy + 1}-12-31`;
  const timeline = computeLoanTimeline({
    entries,
    rates,
    fiscalYearEnd: { month: s.fiscalYearEndMonth, day: s.fiscalYearEndDay },
    today,
  });

  const summary = timeline.annualSummaries.find((a) => a.calendarYear === cy);
  if (!summary) return { cents: 0, breakdown: { benefit80_4Cents: 0, inclusion15_2Cents: 0 } };
  return {
    cents: summary.t4aBox117Cents,
    breakdown: {
      benefit80_4Cents: summary.benefit80_4Cents,
      inclusion15_2Cents: summary.inclusion15_2Cents,
    },
  };
}
