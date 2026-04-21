/**
 * Corporate tax (T2) math — pure, server-safe, no DB deps.
 *
 * Drives:
 *   - `/corp-tax/[fy]` live detail computation
 *   - filing snapshot written into `t2_returns` when Saïd clicks "File"
 *   - dashboard "Est. corp tax" stat card (via the thin façade kept in
 *     `dashboard-metrics.ts::estimateT2`)
 *
 * References (2026):
 *   - ITA s.123(1) 38% federal base
 *   - ITA s.124(1) 10% provincial abatement
 *   - ITA s.125(1.1) 19% SBD rate (CCPC ABI ≤ $500K business limit)
 *   - ITA s.125(5.1) SBD passive-income grind: $5 reduction per $1 of AAII
 *     over $50K in the prior FY; nil at $150K.
 *   - ITA s.123.4 13% General Rate Reduction
 *   - Ontario small-biz rate 3.2% → 2.2% (2026-07-01 transition, prorated)
 *   - Ontario general corp rate 11.5%
 *
 * Scope cut for Phase 4C (see project_roadmap.md § 4C):
 *   - Ontario place-of-supply only.
 *   - Dispositions / recapture / terminal loss deferred.
 *   - Non-capital loss carry-back / carry-forward deferred.
 *   - Instalment payments deferred (first-year corp auto-exempt).
 *   - Associated corps sharing SBD deferred (single-corp check).
 *
 * Taxable income floor: max(0, revenue − operating expenses − salary − ER CPP
 * − CCA). Corporate losses can't carry to personal T1, so the floor at 0 is
 * a planning simplification; loss-carry pools come later.
 */

import { ontarioSmallBizRate, FED_SBD_RATE } from "./t2-rates";

const BPS = 10_000;

/** Federal general rate after GRR (ITA s.123.4): 38% − 10% − 13% = 15%. */
export const FED_GENERAL_RATE = 0.15;
/** SBD business limit per ITA s.125(2): $500,000. */
export const SBD_BUSINESS_LIMIT_CENTS = 500_000_00;
/** SBD passive-income grind floor per s.125(5.1): $50K of prior-FY AAII. */
export const SBD_AAII_GRIND_FLOOR_CENTS = 50_000_00;
/** SBD passive-income grind ceiling: $150K (SBD fully ground down to zero). */
export const SBD_AAII_GRIND_CEILING_CENTS = 150_000_00;

export type T2Inputs = {
  periodStart: string; // ISO YYYY-MM-DD
  periodEnd: string;
  isCcpc: boolean;
  revenueCents: number; // subtotal of taxable-supply invoices in FY
  operatingExpensesCents: number; // meals already at 50%, capital excluded
  salaryCents: number; // gross salary paid in FY (issued paycheques)
  employerCppCents: number; // ER CPP + ER CPP2 combined
  ccaClaimedCents: number; // sum of ccaPools.ccaClaimedCents for this FY
  priorYearAaiiCents: number; // drives SBD grind
  ontarioGeneralRateBps?: number; // defaults to 1150 (11.5%)
};

export type T2Result = {
  // Income lines
  netIncomeForTaxCents: number;
  taxableIncomeCents: number;
  // SBD allocation
  sbdBusinessLimitCents: number; // always 500_000_00
  sbdGrindCents: number; // reduction from 500K due to prior AAII
  sbdLimitAfterGrindCents: number; // 500K − grind
  sbdEligibleCents: number; // min(taxable, sbdLimitAfterGrind) — income taxed at SBD rate
  fullRateIncomeCents: number; // taxable − sbdEligible — income taxed at general rate
  // Federal tax
  fedSbdRateBps: number; // 900 = 9%
  fedGeneralRateBps: number; // 1500 = 15%
  fedSbdPortionCents: number;
  fedGeneralPortionCents: number;
  fedTaxCents: number;
  // Ontario tax
  ontarioBlendedSbdRateBps: number; // result of ontarioSmallBizRate × 10000, rounded
  ontarioGeneralRateBps: number; // usually 1150
  ontarioSbdPortionCents: number;
  ontarioGeneralPortionCents: number;
  ontarioTaxCents: number;
  // Totals
  totalTaxCents: number;
  combinedRateOnSbdBps: number; // fed 9% + ON blended
  combinedRateOnGeneralBps: number; // fed 15% + ON 11.5%
  // GRIP full-rate input — used downstream by computeGrip
  gripFullRateIncomeCents: number;
  // Signalling
  warnings: string[];
};

/**
 * Full T2 estimate — SBD grind, CCPC gate, Ontario prorated rates.
 *
 * The dashboard `estimateT2` façade in `dashboard-metrics.ts` calls this with
 * simplified inputs (no CCA yet at dashboard render) and returns a reduced
 * shape; keep the two consistent by routing through this function.
 */
export function estimateT2Detailed(i: T2Inputs): T2Result {
  const warnings: string[] = [];

  // Net income for tax = revenue − deductible outflows.
  const netIncomeForTaxCents =
    i.revenueCents -
    i.operatingExpensesCents -
    i.salaryCents -
    i.employerCppCents -
    i.ccaClaimedCents;

  // Taxable income floor at 0 — corporate losses don't flow to T1 and
  // loss-carry pools are out of scope for v1.
  const taxableIncomeCents = Math.max(0, netIncomeForTaxCents);

  // SBD grind per ITA s.125(5.1): $5 reduction per $1 of prior-FY AAII over
  // $50K; fully ground at $150K. Linear between.
  const aaiiOverFloor = Math.max(
    0,
    i.priorYearAaiiCents - SBD_AAII_GRIND_FLOOR_CENTS,
  );
  const grindRange = SBD_AAII_GRIND_CEILING_CENTS - SBD_AAII_GRIND_FLOOR_CENTS;
  const grindFraction = Math.min(1, aaiiOverFloor / grindRange);
  const sbdGrindCents = Math.round(SBD_BUSINESS_LIMIT_CENTS * grindFraction);
  const sbdLimitAfterGrindCents = Math.max(
    0,
    SBD_BUSINESS_LIMIT_CENTS - sbdGrindCents,
  );

  if (sbdGrindCents > 0) {
    warnings.push(
      `SBD grind: prior-FY AAII of $${(i.priorYearAaiiCents / 100).toFixed(0)} reduces SBD limit by $${(sbdGrindCents / 100).toFixed(0)} to $${(sbdLimitAfterGrindCents / 100).toFixed(0)}.`,
    );
  }

  // CCPC gate — non-CCPC gets no SBD at all. Entire taxable income at general rate.
  const sbdEligibleCents = i.isCcpc
    ? Math.min(taxableIncomeCents, sbdLimitAfterGrindCents)
    : 0;
  const fullRateIncomeCents = taxableIncomeCents - sbdEligibleCents;

  if (!i.isCcpc) {
    warnings.push(
      "Not a CCPC — no SBD. Entire taxable income taxed at general rate (fed 15% + ON 11.5%).",
    );
  }
  if (fullRateIncomeCents > 0 && i.isCcpc) {
    warnings.push(
      `Taxable income exceeds SBD limit — $${(fullRateIncomeCents / 100).toFixed(0)} taxed at general rate. Plan: eligible-dividend capacity grows via GRIP.`,
    );
  }

  // Federal tax: 9% on SBD portion, 15% on general portion.
  const fedSbdRateBps = Math.round(FED_SBD_RATE * BPS); // 900
  const fedGeneralRateBps = Math.round(FED_GENERAL_RATE * BPS); // 1500
  const fedSbdPortionCents = Math.round(
    (sbdEligibleCents * fedSbdRateBps) / BPS,
  );
  const fedGeneralPortionCents = Math.round(
    (fullRateIncomeCents * fedGeneralRateBps) / BPS,
  );
  const fedTaxCents = fedSbdPortionCents + fedGeneralPortionCents;

  // Ontario tax: blended SBD rate across the period + general rate on spill.
  // Apply the exact blended float rate to cents (single rounding op) so the
  // result matches direct-float multiplication to the cent. The bps form is
  // computed separately for display only.
  const ontarioSbdRate = ontarioSmallBizRate(i.periodStart, i.periodEnd);
  const ontarioBlendedSbdRateBps = Math.round(ontarioSbdRate * BPS);
  const ontarioGeneralRateBps = i.ontarioGeneralRateBps ?? 1_150;
  const ontarioSbdPortionCents = Math.round(sbdEligibleCents * ontarioSbdRate);
  const ontarioGeneralPortionCents = Math.round(
    (fullRateIncomeCents * ontarioGeneralRateBps) / BPS,
  );
  const ontarioTaxCents = ontarioSbdPortionCents + ontarioGeneralPortionCents;

  const totalTaxCents = fedTaxCents + ontarioTaxCents;

  // GRIP addition input — the "full-rate income" slice (income NOT eligible
  // for SBD). For a pure-SBD CCPC this is 0. Schedule 53 simplified form.
  const gripFullRateIncomeCents = fullRateIncomeCents;

  return {
    netIncomeForTaxCents,
    taxableIncomeCents,
    sbdBusinessLimitCents: SBD_BUSINESS_LIMIT_CENTS,
    sbdGrindCents,
    sbdLimitAfterGrindCents,
    sbdEligibleCents,
    fullRateIncomeCents,
    fedSbdRateBps,
    fedGeneralRateBps,
    fedSbdPortionCents,
    fedGeneralPortionCents,
    fedTaxCents,
    ontarioBlendedSbdRateBps,
    ontarioGeneralRateBps,
    ontarioSbdPortionCents,
    ontarioGeneralPortionCents,
    ontarioTaxCents,
    totalTaxCents,
    combinedRateOnSbdBps: fedSbdRateBps + ontarioBlendedSbdRateBps,
    combinedRateOnGeneralBps: fedGeneralRateBps + ontarioGeneralRateBps,
    gripFullRateIncomeCents,
    warnings,
  };
}
