/**
 * Pure derivation of annual CRA + Ontario deadlines from the corp's fiscal
 * settings. Used by the `syncAnnualDeadlines` server action and by
 * `verify-deadlines.ts`. No I/O, no React.
 *
 * Rules:
 * - T2 corporate income tax — due 6 months after FYE (ITA s.150(1))
 * - T4 slip filing + T4 summary — due Feb 28 of the calendar year after
 *   the pay year ended (ITA reg 210(2))
 * - T5 slip filing + T5 summary — due Feb 28 of the calendar year after
 *   the CY the dividend was paid (ITA reg 200(1))
 * - Ontario annual return — due on the incorporation-date anniversary
 *   each year (Ontario Business Corporations Act ss.3.1)
 * - HST annual return — due 3 months after FYE (ETA s.245) — but the
 *   current-FY HST deadline is already created by `hst.ts.upsertDraftReturn`
 *   when the user opens /hst/[fy]. This lib emits the NEXT FY's HST
 *   deadline so /calendar shows what's coming after the current one.
 *
 * Payroll source-deduction remittances live in `remittances`, not here —
 * they're created per pay run. /calendar merges both sources.
 */

export type AnnualDeadline = {
  key: string; // stable natural key for idempotent upsert (category + target year)
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD
  category: "t2" | "t4" | "t5" | "annual_return" | "hst" | "other";
};

export type DeriveInput = {
  /** Corp fiscal year-end month (1-12). */
  fyeMonth: number;
  /** Corp fiscal year-end day (1-31). */
  fyeDay: number;
  /** ISO YYYY-MM-DD incorporation date, or null. Drives Ontario annual return. */
  incorporationDate: string | null;
  /** Whether RP0001 payroll is active — gates T4 deadline generation. */
  payrollActive: boolean;
  /** Whether RZ0001 info-returns is active — gates T5 deadline generation. */
  payerRzActive: boolean;
  /** The fiscal year to derive deadlines for (labelled by ending calendar year). */
  fiscalYear: number;
};

export function deriveAnnualDeadlines(input: DeriveInput): AnnualDeadline[] {
  const { fyeMonth, fyeDay, incorporationDate, payrollActive, payerRzActive, fiscalYear } = input;
  const out: AnnualDeadline[] = [];

  const fyeIso = isoDate(fiscalYear, fyeMonth, fyeDay);

  // T2 corporate return — 6 months after FYE.
  out.push({
    key: `t2:${fiscalYear}`,
    title: `T2 corporate return — FY ${fiscalYear}`,
    description: `Federal T2 filing + any balance due (6 months after FYE per ITA s.150(1)).`,
    dueDate: addMonthsISO(fyeIso, 6),
    category: "t2",
  });

  // HST next-FY draft — 3 months after FYE. (Current FY is handled by
  // `upsertDraftReturn` when the user opens /hst/[fy]; we seed the
  // subsequent one so the calendar always shows what's next.)
  out.push({
    key: `hst:${fiscalYear}`,
    title: `HST return — FY ${fiscalYear}`,
    description: `Annual HST return filing + payment (3 months after FYE per ETA s.245).`,
    dueDate: addMonthsISO(fyeIso, 3),
    category: "hst",
  });

  // T4 slip filing — Feb 28 of the calendar year after the pay year ended.
  // T4 is calendar-year-based, not FY-based. We label by pay year, which for
  // a Dec-31 FYE is the same number as the fiscalYear; for Oct-31 FYE the
  // pay year ending inside `fiscalYear` is the same calendar year.
  if (payrollActive) {
    const payYear = fiscalYear; // Pay year = calendar year that ends inside this FY label.
    out.push({
      key: `t4:${payYear}`,
      title: `T4 slips — ${payYear}`,
      description: `T4 + T4 Summary for ${payYear} pay year (due Feb 28 per Reg 210(2)).`,
      dueDate: isoDate(payYear + 1, 2, 28),
      category: "t4",
    });
  }

  // T5 slip filing — Feb 28 of the calendar year after the CY the dividend
  // was paid. Same calendar-year convention as T4; gated on RZ0001 active.
  if (payerRzActive) {
    const payYear = fiscalYear;
    out.push({
      key: `t5:${payYear}`,
      title: `T5 slips — ${payYear}`,
      description: `T5 + T5 Summary for dividends paid in ${payYear} (due Feb 28 per Reg 200(1)).`,
      dueDate: isoDate(payYear + 1, 2, 28),
      category: "t5",
    });
  }

  // Ontario annual return — anniversary of incorporation. We emit the
  // next anniversary AFTER the fiscalYear's start. For Saïd: incorp 2026-03-30
  // → first anniversary 2027-03-30, emitted for FY 2027.
  if (incorporationDate) {
    const [, m, d] = incorporationDate.split("-").map(Number) as [number, number, number];
    // Handle Feb 29 → Feb 28 in non-leap years.
    const anniversary = isoDate(fiscalYear, m, d);
    out.push({
      key: `annual_return:${fiscalYear}`,
      title: `Ontario annual return — ${fiscalYear}`,
      description: `Ontario BCA annual return (anniversary of incorporation).`,
      dueDate: anniversary,
      category: "annual_return",
    });
  }

  return out;
}

// ——— date helpers ———

function isoDate(y: number, m: number, d: number): string {
  // Clamp day to month length so Feb 29 → Feb 28 in non-leap years, and
  // Apr 31 → Apr 30 style off-by-ones don't crash callers.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = Math.min(d, lastDay);
  return `${y.toString().padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months; // 0-based
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // handle negatives
  return isoDate(targetYear, targetMonth + 1, d);
}
