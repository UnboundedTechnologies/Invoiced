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
import { FED_SBD_RATE, ontarioSmallBizRate } from "./t2-rates";
import { estimateT2Detailed } from "./t2";

// Re-export so existing callers (scripts/verify-*, dashboard page) keep
// working with a single import site.
export { FED_SBD_RATE, ontarioSmallBizRate };

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
// Thin façade over `estimateT2Detailed` in `src/lib/t2.ts`. Exists so the
// dashboard stat card keeps its historical shape while routing through the
// canonical compute lib — one source of truth for taxable income, fed + ON
// tax, and SBD allocation. All new callers should use estimateT2Detailed
// directly.

export type T2Input = {
  periodStart: string;
  periodEnd: string;
  revenueCents: number;
  operatingExpensesCents: number;
  salaryCents: number;
  employerCppCents: number;
  ccaClaimedCents?: number; // defaults to 0 for dashboard (CCA wired in detail page only)
  isCcpc?: boolean; // defaults to true
  priorYearAaiiCents?: number; // defaults to 0 (dashboard reads settings)
};

export type T2Estimate = {
  taxableIncomeCents: number;
  fedTaxCents: number;
  ontarioTaxCents: number;
  totalTaxCents: number;
  ontarioRate: number;
  combinedRate: number;
  sbdLimitWarning: boolean;
  sbdGrindWarning: boolean;
};

export function estimateT2(input: T2Input): T2Estimate {
  const detailed = estimateT2Detailed({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    isCcpc: input.isCcpc ?? true,
    revenueCents: input.revenueCents,
    operatingExpensesCents: input.operatingExpensesCents,
    salaryCents: input.salaryCents,
    employerCppCents: input.employerCppCents,
    ccaClaimedCents: input.ccaClaimedCents ?? 0,
    priorYearAaiiCents: input.priorYearAaiiCents ?? 0,
  });

  return {
    taxableIncomeCents: detailed.taxableIncomeCents,
    fedTaxCents: detailed.fedTaxCents,
    ontarioTaxCents: detailed.ontarioTaxCents,
    totalTaxCents: detailed.totalTaxCents,
    ontarioRate: detailed.ontarioBlendedSbdRateBps / 10_000,
    combinedRate: detailed.combinedRateOnSbdBps / 10_000,
    sbdLimitWarning: detailed.fullRateIncomeCents > 0,
    sbdGrindWarning: detailed.sbdGrindCents > 0,
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
  /** Phase 4C: ERDTOH + NERDTOH refund from dividends paid in FY. Inflow. */
  dividendRefundCents?: number;
};

export type CashPosition = {
  netCents: number;
  inflowCents: number;
  outflowCents: number;
};

/**
 * Cash position proxy — revenue inflow minus every FY obligation (operating
 * spend, gross self-pay, employer CPP, dividends, T2, HST remittance), plus
 * any Part IV / Part I dividend refund coming back from CRA. Uses totals
 * (incl HST) + signed HST net so both Regular and Quick Method fall out of
 * the same formula. Assumes invoiced = collected.
 */
export function estimateCashPosition(input: CashPositionInput): CashPosition {
  const inflow =
    input.revenueTotalCents +
    Math.max(0, -input.hstNetCents) +
    (input.dividendRefundCents ?? 0);
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
