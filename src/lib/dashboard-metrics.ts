/**
 * Pure dashboard metric functions.
 *
 * Server-safe, no DB or React deps — callers pass plain slices so the
 * functions are trivially testable (`scripts/verify-dashboard.ts`).
 *
 * Scope:
 * - 12-month rolling revenue trend for the sparkline
 * - Corporate tax (T2) estimate for the current fiscal year
 * - Cash position estimate (accrual basis, pre-withdrawal)
 *
 * T2 scope: Ontario CCPC under the small business deduction, flat 9% federal
 * plus a blended Ontario rate across the FY. Rate schedule per the Ontario
 * 2025 Fall Economic Statement: 3.2% through 2026-06-30, 2.2% from 2026-07-01
 * onward. Taxable income is floored at 0 and ignores CCA, RRSP additions,
 * and SBD grind above $500K — this is a planning estimate, not a return.
 */

import { isTaxableSupply } from "./queries/invoice-slices";

export type RevenueInvoiceSlice = {
  issueDate: string;
  subtotalCents: number;
  status: string;
};

export type ExpenseSlice = {
  category: string;
  subtotalCents: number;
  totalCents: number;
};

// ——— 12-month revenue trend ———

/**
 * Monthly revenue (ex-HST subtotal) for non-void, non-draft invoices over
 * the 12 months ending at `endIsoMonth` (YYYY-MM), oldest first. The window
 * always returns exactly 12 buckets so the sparkline shape is stable.
 */
export function revenueByMonth(
  invoices: RevenueInvoiceSlice[],
  endIsoMonth: string,
): { month: string; cents: number }[] {
  const parts = endIsoMonth.split("-").map(Number) as [number, number];
  const endY = parts[0];
  const endM = parts[1];
  const buckets: { month: string; cents: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    let y = endY;
    let m = endM - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    buckets.push({ month: `${y}-${String(m).padStart(2, "0")}`, cents: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.month, i]));
  for (const inv of invoices) {
    if (!isTaxableSupply(inv)) continue;
    const key = inv.issueDate.slice(0, 7);
    const idx = index.get(key);
    if (idx === undefined) continue;
    buckets[idx]!.cents += inv.subtotalCents;
  }
  return buckets;
}

// ——— Ontario blended rate ———

/** Flat federal CCPC SBD rate (first $500K active business income). */
export const FED_SBD_RATE = 0.09;

const ON_RATE_BEFORE = 0.032;
const ON_RATE_AFTER = 0.022;
const ON_TRANSITION_ISO = "2026-07-01";

/**
 * Blended Ontario SBD rate across a fiscal period. Prorates across the
 * 2026-07-01 transition day-by-day when the period straddles it.
 */
export function ontarioSmallBizRate(periodStart: string, periodEnd: string): number {
  const s = utcDays(periodStart);
  const e = utcDays(periodEnd);
  if (e < s) return ON_RATE_BEFORE;
  const t = utcDays(ON_TRANSITION_ISO);
  if (e < t) return ON_RATE_BEFORE;
  if (s >= t) return ON_RATE_AFTER;
  const totalDays = e - s + 1;
  const daysBefore = t - s;
  const daysAfter = totalDays - daysBefore;
  return (daysBefore * ON_RATE_BEFORE + daysAfter * ON_RATE_AFTER) / totalDays;
}

function utcDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

// ——— Operating-expense aggregator for T2 ———

/**
 * Deductible operating expenses for T2 purposes. Meals & entertainment are
 * capped at 50% per ITA s.67.1; capital assets are excluded (CCA is tracked
 * separately under Phase 4C — this estimate is conservative in FYs with
 * capital purchases). Returns ex-HST subtotal cents.
 */
export function operatingExpensesForT2(expenses: ExpenseSlice[]): number {
  let total = 0;
  for (const e of expenses) {
    if (e.category === "capital_asset") continue;
    const adj = e.category === "meals_entertainment" ? 0.5 : 1;
    total += Math.round(e.subtotalCents * adj);
  }
  return total;
}

// ——— T2 estimate ———

export type T2Input = {
  periodStart: string;
  periodEnd: string;
  revenueCents: number;
  operatingExpensesCents: number;
  salaryCents: number;
  employerCppCents: number;
};

export type T2Estimate = {
  taxableIncomeCents: number;
  fedTaxCents: number;
  ontarioTaxCents: number;
  totalTaxCents: number;
  ontarioRate: number;
  combinedRate: number;
  sbdLimitWarning: boolean;
};

export function estimateT2(input: T2Input): T2Estimate {
  const gross =
    input.revenueCents -
    input.operatingExpensesCents -
    input.salaryCents -
    input.employerCppCents;
  const taxable = Math.max(0, gross);
  const fed = Math.round(taxable * FED_SBD_RATE);
  const onRate = ontarioSmallBizRate(input.periodStart, input.periodEnd);
  const on = Math.round(taxable * onRate);
  return {
    taxableIncomeCents: taxable,
    fedTaxCents: fed,
    ontarioTaxCents: on,
    totalTaxCents: fed + on,
    ontarioRate: onRate,
    combinedRate: FED_SBD_RATE + onRate,
    sbdLimitWarning: taxable > 500_000_00,
  };
}

// ——— Cash position ———

export type CashPositionInput = {
  revenueTotalCents: number;
  expensesTotalCents: number;
  salaryGrossCents: number;
  employerCppCents: number;
  dividendsCents: number;
  t2EstimateCents: number;
  hstNetCents: number;
};

export type CashPosition = {
  netCents: number;
  inflowCents: number;
  outflowCents: number;
};

/**
 * Cash position proxy — revenue inflow minus every FY obligation (operating
 * spend, gross self-pay, employer CPP, dividends, T2, HST remittance). Uses
 * totals (incl HST) + signed HST net so both Regular and Quick Method fall
 * out of the same formula. Assumes invoiced = collected.
 */
export function estimateCashPosition(input: CashPositionInput): CashPosition {
  const inflow = input.revenueTotalCents + Math.max(0, -input.hstNetCents);
  const outflow =
    input.expensesTotalCents +
    input.salaryGrossCents +
    input.employerCppCents +
    input.dividendsCents +
    input.t2EstimateCents +
    Math.max(0, input.hstNetCents);
  return {
    netCents: inflow - outflow,
    inflowCents: inflow,
    outflowCents: outflow,
  };
}
