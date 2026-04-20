/**
 * HST return math — pure, server-safe, no I/O. Drives both the live
 * `/hst/[fiscalYear]` detail view and the filing snapshot that freezes into
 * `hst_returns` when Saïd clicks "File return".
 *
 * References:
 *  - CRA guide RC4022 (General Information for GST/HST Registrants)
 *  - CRA GST/HST Memorandum 19.6 (Quick Method of Accounting)
 *  - ETA s.236 (50% ITC restriction on meals & entertainment)
 *
 * Scope cut for Phase 3B (see project_roadmap.md § 3B):
 *  - Annual filer only (Saïd's setup).
 *  - Ontario place-of-supply only (13% HST, Quick Method remittance rate 8.8%
 *    for a service business with ≥ 90% of supplies to HST-province customers).
 *  - No adjustments, bad-debt recoveries, credit notes, or installments.
 */

const QUICK_METHOD_ELIGIBILITY_CAP_CENTS = 400_000 * 100; // $400K prior-4-FY worldwide taxable supplies
const QUICK_CREDIT_THRESHOLD_CENTS = 30_000 * 100;        // 1% credit on first $30K HST-included supplies
const QUICK_CREDIT_RATE_BPS = 100;                        // 1%
const QUICK_CREDIT_CAP_CENTS = 300 * 100;                 // capped at $300
const ONTARIO_SERVICE_QM_RATE_BPS = 880;                  // 8.8% standard QM rate (Ontario service ≥ 90% to HST-province)
const ONTARIO_SERVICE_QM_FIRST_YEAR_RATE_BPS = 780;       // 7.8% first-year election (1% off first $30K slice)

export {
  QUICK_METHOD_ELIGIBILITY_CAP_CENTS,
  QUICK_CREDIT_THRESHOLD_CENTS,
  QUICK_CREDIT_RATE_BPS,
  QUICK_CREDIT_CAP_CENTS,
  ONTARIO_SERVICE_QM_RATE_BPS,
  ONTARIO_SERVICE_QM_FIRST_YEAR_RATE_BPS,
};

export type InvoiceSlice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  subtotalCents: number;
  hstCents: number;
  totalCents: number;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
};

export type ExpenseSlice = {
  id: string;
  expenseDate: string;
  vendor: string;
  category: string;
  subtotalCents: number;
  hstPaidCents: number;
  totalCents: number;
};

export type HstPeriod = { start: string; end: string };

/**
 * Compute the HST reporting period for a given fiscal year, given the corp's
 * fiscal year-end month/day. Period ends on the FYE and starts one year prior
 * (plus one day). Annual-filer only.
 */
export function hstPeriodFor(
  fiscalYear: number,
  fyeMonth: number,
  fyeDay: number,
): HstPeriod {
  const end = isoDate(fiscalYear, fyeMonth, fyeDay);
  // Start = day after the previous FYE. For Dec 31 FYE → Jan 1 of the FY year.
  const prevEnd = isoDate(fiscalYear - 1, fyeMonth, fyeDay);
  const start = addOneDayISO(prevEnd);
  return { start, end };
}

/** Due date for an annual HST return — 3 months after period end (corporation filer). */
export function hstFilingDueDate(periodEnd: string): string {
  const [y, m, d] = periodEnd.split("-").map(Number) as [number, number, number];
  const due = new Date(Date.UTC(y, m - 1 + 3, d));
  return due.toISOString().slice(0, 10);
}

/**
 * Quick Method eligibility gate. CRA requires worldwide taxable supplies
 * (across the registrant and its associates) in the prior 4 FYs to be
 * ≤ $400K. For a first-year registrant, prior-4-FY total is 0 → eligible.
 */
export function canUseQuickMethod(priorFourFyRevenueCents: number): boolean {
  return priorFourFyRevenueCents <= QUICK_METHOD_ELIGIBILITY_CAP_CENTS;
}

type AggregateInput = {
  invoices: InvoiceSlice[];
  expenses: ExpenseSlice[];
  period: HstPeriod;
};

/**
 * Per-method aggregation of CRA line numbers. Both methods share line 101
 * (worldwide taxable supplies = sum of invoice subtotals) and the meals
 * 50% cap line 107, but diverge on 103/106/108/109.
 */
export type AggregateRegularResult = {
  line101Cents: number;
  line103Cents: number;  // HST collected (sum of invoice HST)
  line104Cents: number;  // adjustments (always 0 in 3B scope)
  line105Cents: number;  // 103 + 104
  line106RawCents: number; // sum of expense HST paid before meals cap
  line107Cents: number;    // negative = reduces ITCs; = -50% × meals HST
  line108Cents: number;    // 106 + 107
  line109Cents: number;    // 105 - 108 (positive = owed to CRA)
  invoiceContributions: InvoiceSlice[];
  expenseContributions: ExpenseSlice[];
  mealsContributions: ExpenseSlice[];
};

export function aggregateRegular({
  invoices,
  expenses,
  period,
}: AggregateInput): AggregateRegularResult {
  const invs = invoices.filter(
    (i) => i.status !== "void" && inPeriod(i.issueDate, period),
  );
  const exps = expenses.filter((e) => inPeriod(e.expenseDate, period));
  const meals = exps.filter((e) => e.category === "meals_entertainment");

  const line101Cents = sum(invs, (i) => i.subtotalCents);
  const line103Cents = sum(invs, (i) => i.hstCents);
  const line104Cents = 0;
  const line105Cents = line103Cents + line104Cents;
  const line106RawCents = sum(exps, (e) => e.hstPaidCents);
  // Meals & entertainment: only 50% of HST paid is recoverable as an ITC.
  // Apply the cap on line 107 so the raw row value on `expenses` is untouched.
  const mealsHst = sum(meals, (e) => e.hstPaidCents);
  const line107Cents = -Math.round(mealsHst / 2);
  const line108Cents = line106RawCents + line107Cents;
  const line109Cents = line105Cents - line108Cents;

  return {
    line101Cents,
    line103Cents,
    line104Cents,
    line105Cents,
    line106RawCents,
    line107Cents,
    line108Cents,
    line109Cents,
    invoiceContributions: invs,
    expenseContributions: exps,
    mealsContributions: meals,
  };
}

export type AggregateQuickResult = {
  line101Cents: number;
  line103Cents: number;    // remittance = QM rate × HST-inclusive supplies, less credit
  line104Cents: number;    // 0
  line105Cents: number;    // = 103 in QM
  line106CapitalCents: number; // capital-asset ITCs pass through even under QM
  line107Cents: number;    // 0 in QM (no meals adjustment because operating ITCs aren't claimed)
  line108Cents: number;    // = 106 capital
  line109Cents: number;
  quickCreditCents: number;
  quickRateBps: number;
  capitalExpenseContributions: ExpenseSlice[];
  invoiceContributions: InvoiceSlice[];
};

export function aggregateQuickMethod({
  invoices,
  expenses,
  period,
  isFirstQmFy,
}: AggregateInput & { isFirstQmFy: boolean }): AggregateQuickResult {
  const invs = invoices.filter(
    (i) => i.status !== "void" && inPeriod(i.issueDate, period),
  );
  const exps = expenses.filter((e) => inPeriod(e.expenseDate, period));
  const capitalExps = exps.filter((e) => e.category === "capital_asset");

  const line101Cents = sum(invs, (i) => i.subtotalCents);
  // HST-inclusive = subtotal + HST collected. Under QM the remittance rate is
  // applied to this grossed-up figure.
  const hstInclusiveCents = sum(invs, (i) => i.subtotalCents + i.hstCents);

  const quickRateBps = ONTARIO_SERVICE_QM_RATE_BPS;
  // First-year credit: 1% off the remittance rate on the first $30K of
  // HST-inclusive supplies (capped at $300 = 1% × $30K). We model this as a
  // flat credit so the underlying rate stays 8.8% in the stored snapshot.
  const eligibleCreditBase = Math.min(
    hstInclusiveCents,
    QUICK_CREDIT_THRESHOLD_CENTS,
  );
  const rawCredit = Math.round(
    (eligibleCreditBase * QUICK_CREDIT_RATE_BPS) / 10_000,
  );
  const quickCreditCents = isFirstQmFy
    ? Math.min(rawCredit, QUICK_CREDIT_CAP_CENTS)
    : 0;

  const remittanceBeforeCredit = Math.round(
    (hstInclusiveCents * quickRateBps) / 10_000,
  );
  const line103Cents = remittanceBeforeCredit - quickCreditCents;
  const line104Cents = 0;
  const line105Cents = line103Cents + line104Cents;

  // Capital-asset expenses still allow an ITC under Quick Method (per CRA).
  // Operating-expense HST is non-recoverable — that's what the QM keep-rate
  // pays for.
  const line106CapitalCents = sum(capitalExps, (e) => e.hstPaidCents);
  const line107Cents = 0;
  const line108Cents = line106CapitalCents + line107Cents;
  const line109Cents = line105Cents - line108Cents;

  return {
    line101Cents,
    line103Cents,
    line104Cents,
    line105Cents,
    line106CapitalCents,
    line107Cents,
    line108Cents,
    line109Cents,
    quickCreditCents,
    quickRateBps,
    capitalExpenseContributions: capitalExps,
    invoiceContributions: invs,
  };
}

export type BreakEvenRecommendation = "quick" | "regular" | "wash";

export type BreakEvenResult = {
  regularNet: number;
  quickNet: number;
  deltaCents: number; // positive = QM saves money vs regular
  recommendation: BreakEvenRecommendation;
  reasons: string[];
};

/**
 * Compare the two methods head-to-head for the same period. Threshold:
 *  - delta ≥ $200 → quick wins
 *  - delta ≤ -$200 → regular wins
 *  - otherwise → wash
 * Rationale: QM eliminates operating-expense ITC bookkeeping AND removes the
 * meals 50% cap friction, so a small nominal loss can still be worth the
 * admin savings. $200 ≈ half an hour at a bookkeeper rate.
 */
export function quickMethodBreakEven(
  args: AggregateInput & { isFirstQmFy: boolean },
): BreakEvenResult {
  const reg = aggregateRegular(args);
  const qm = aggregateQuickMethod(args);
  const deltaCents = reg.line109Cents - qm.line109Cents;

  const reasons: string[] = [];
  reasons.push(
    `Regular owes ${formatSigned(reg.line109Cents)}; Quick owes ${formatSigned(qm.line109Cents)}.`,
  );
  if (args.isFirstQmFy && qm.quickCreditCents > 0) {
    reasons.push(
      `First-year QM credit: $${(qm.quickCreditCents / 100).toFixed(2)}.`,
    );
  }
  if (reg.mealsContributions.length > 0) {
    reasons.push(
      `Meals & entertainment cap (line 107) reduces Regular ITCs by $${Math.abs(reg.line107Cents / 100).toFixed(2)}.`,
    );
  }
  if (qm.line106CapitalCents > 0) {
    reasons.push(
      `Quick Method still allows capital-asset ITCs: $${(qm.line106CapitalCents / 100).toFixed(2)} recovered.`,
    );
  }

  let recommendation: BreakEvenRecommendation;
  if (deltaCents >= 200 * 100) recommendation = "quick";
  else if (deltaCents <= -200 * 100) recommendation = "regular";
  else recommendation = "wash";

  return {
    regularNet: reg.line109Cents,
    quickNet: qm.line109Cents,
    deltaCents,
    recommendation,
    reasons,
  };
}

// ——— helpers ———

function isoDate(y: number, m: number, d: number): string {
  // Clamp day to month length (e.g., FYE Feb 29 in a non-leap year becomes Feb 28).
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = Math.min(d, lastDayOfMonth);
  return `${y.toString().padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function addOneDayISO(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function inPeriod(iso: string, period: HstPeriod): boolean {
  return iso >= period.start && iso <= period.end;
}

function sum<T>(rows: T[], pick: (r: T) => number): number {
  let total = 0;
  for (const r of rows) total += pick(r);
  return total;
}

function formatSigned(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.abs(cents / 100).toFixed(2);
  return `${sign}$${dollars}`;
}
