/**
 * Canonical T1 (personal tax) compute engine — 2026 Ontario resident.
 *
 * This module is the **single source of truth** for personal-tax compute:
 *  - /personal-tax page consumes `computeT1` via server actions
 *  - Phase 6 self-pay planner consumes `computeT1` + `marginalRateAt` +
 *    `marginalRateOnNextDollar` to model salary-vs-dividend tradeoffs
 *  - dashboard-metrics façade `estimateT1` delegates here
 *
 * All inputs/outputs are in **integer cents**. Internal math uses dollars-as-
 * number for bracket/V-constant arithmetic (matches payroll-2026.ts idiom);
 * single `Math.round` at each output boundary.
 *
 * No DB imports, no `next/headers` — safe to import from tsx verify scripts,
 * pure server-safe, and safe from any client component that only needs types.
 */

import {
  CANADA_EMPLOYMENT_AMOUNT_2026,
  CPP_BASE_CREDIT_FRACTION,
  CPP_ENHANCED_DEDUCTION_FRACTION,
  ELIGIBLE_GROSS_UP_RATE,
  FEDERAL_BRACKETS_2026,
  FEDERAL_CREDIT_RATE_2026,
  FEDERAL_DTC_ELIGIBLE_RATE,
  FEDERAL_DTC_NON_ELIGIBLE_RATE,
  NON_ELIGIBLE_GROSS_UP_RATE,
  ONTARIO_BPA_2026,
  ONTARIO_BRACKETS_2026,
  ONTARIO_CREDIT_RATE_2026,
  ONTARIO_DTC_ELIGIBLE_RATE,
  ONTARIO_DTC_NON_ELIGIBLE_RATE_2026,
  ONTARIO_SURTAX,
  RATES_EDITION_TAG_2026,
  federalBpaFor,
  ontarioHealthPremiumAnnual,
} from "./t1-rates-2026";

// ───── Types ─────

export type T1Input = {
  taxYear: number;
  t4: {
    /** Box 14 — employment income. */
    box14EmploymentIncomeCents: number;
    /** Box 16 — employee CPP1 (base) contributions. */
    box16CppBaseCents: number;
    /** Box 16A — employee CPP2 (enhanced) contributions. */
    box16aCpp2Cents: number;
    /** Box 18 — EI premiums (owner-manager: always 0). */
    box18EiCents: number;
    /** Box 22 — federal income tax withheld. */
    box22FedTaxWithheldCents: number;
    /** Box 24 — EI insurable earnings (owner-manager: always 0). */
    box24EiInsurableCents: number;
    /** Box 26 — CPP pensionable earnings. */
    box26CppPensionableCents: number;
    /** Box 52 — pension adjustment (no IPP yet → 0). */
    box52PensionAdjustmentCents: number;
    /** Ontario income tax withheld — sum of paycheques.provincialTaxCents (incl. OHP). */
    ontarioTaxWithheldCents: number;
  };
  t5: {
    /** Actual eligible dividends paid in CY (T5 box 24). */
    eligibleActualCents: number;
    /** Actual non-eligible dividends paid in CY (T5 box 10). */
    nonEligibleActualCents: number;
  };
  /** T4A box 117 — Loan Benefits (s.15(2) inclusions + s.80.4 benefit) for the CY. */
  t4aBox117Cents: number;
};

export type T1Result = {
  // Income-flow (T1 General line refs in comments)
  totalIncomeCents: number;          // 15000
  cppEnhancedDeductionCents: number; // 22215 — s.60(e)
  cpp2DeductionCents: number;        // 22200 — s.60(e.1)
  netIncomeCents: number;            // 23600
  taxableIncomeCents: number;        // 26000 (== net in v1 — no Sch 3)
  // Federal side
  federal: {
    bracketTaxCents: number;
    bpaAmountCents: number;          // 30000 (amount, pre-credit-rate)
    ceaAmountCents: number;          // 31260
    cppBaseAmountCents: number;      // 30800 (amount, pre-credit-rate)
    nonRefundableCreditsCents: number;    // 33500 amount
    nonRefundableCreditsTaxCents: number; // 35000 = 33500 × 14%
    dtcEligibleCents: number;
    dtcNonEligibleCents: number;
    dtcTotalCents: number;           // 40425 (eligible + non-eligible)
    federalTaxPayableCents: number;  // 42000
  };
  // Ontario side (ON428 line order)
  ontario: {
    bracketTaxCents: number;
    bpaAmountCents: number;                // 58040 amount
    cppBaseAmountCents: number;            // 58240 amount
    nonRefundableCreditsCents: number;     // Ontario amount
    nonRefundableCreditsTaxCents: number;  // × 5.05%
    basicTaxAfterCreditsCents: number;     // bracket − credits × 5.05%
    surtaxTier1Cents: number;
    surtaxTier2Cents: number;
    surtaxTotalCents: number;
    dtcEligibleCents: number;
    dtcNonEligibleCents: number;
    dtcTotalCents: number;
    taxAfterSurtaxAndDtcCents: number;     // ON428 line after DTC
    ontarioHealthPremiumCents: number;
    ontarioTaxPayableCents: number;
  };
  // Totals
  totalTaxPayableCents: number;     // 43500
  totalWithheldCents: number;       // box22 + Ontario withheld
  cpp2OverpaymentCents: number;     // rare — single-employer scenario keeps at 0
  refundOrOwingCents: number;       // positive = owing, negative = refund
  // Planner hooks (Phase 6 consumes these)
  marginalRateFedBps: number;       // raw federal bracket rate at taxable income
  marginalRateOnBps: number;        // raw Ontario bracket rate at taxable income
  marginalRateCombinedBps: number;  // sum of federal + Ontario bracket rates
  // Meta
  ratesEditionTag: string;
  warnings: string[];
};

// ───── Small utilities ─────

/** YYYY-MM-DD ISO → calendar year. */
export function taxYearFor(iso: string): number {
  return Number(iso.slice(0, 4));
}

/**
 * T1 filing due date — April 30 of (cy + 1) per ITA s.150(1)(d).
 * Saïd is an employee of his corp + dividend recipient, NOT self-employed;
 * the June 15 extension doesn't apply to him.
 */
export function t1FilingDueDate(taxYear: number): string {
  return `${taxYear + 1}-04-30`;
}

/** Gross-up `actualCents` by `rate` (e.g. 0.38 for eligible). */
export function dividendGrossUp(actualCents: number, rate: number): number {
  return Math.round(actualCents * (1 + rate));
}

/** DTC on the grossed-up amount. */
export function dividendTaxCredit(grossedUpCents: number, rate: number): number {
  return Math.round(grossedUpCents * rate);
}

// ───── Bracket math (dollars-in, dollars-out) ─────

type Bracket = { upTo: number; rate: number; k?: number; v?: number };

function bracketAt<T extends Bracket>(taxableDollars: number, brackets: readonly T[]): T {
  return (brackets.find((b) => taxableDollars <= b.upTo) ?? brackets[brackets.length - 1]!) as T;
}

export function federalPersonalBracketTax(taxableIncomeCents: number): number {
  const A = taxableIncomeCents / 100;
  const b = bracketAt(A, FEDERAL_BRACKETS_2026);
  return Math.round((b.rate * A - (b.k ?? 0)) * 100);
}

export function ontarioPersonalBracketTax(taxableIncomeCents: number): number {
  const A = taxableIncomeCents / 100;
  const b = bracketAt(A, ONTARIO_BRACKETS_2026);
  return Math.round((b.rate * A - (b.v ?? 0)) * 100);
}

/** Ontario surtax (ON428 line 51) — computed on basic tax AFTER non-refundable credits but BEFORE DTC. */
export function ontarioSurtax(basicTaxAfterCreditsCents: number): {
  tier1Cents: number;
  tier2Cents: number;
  totalCents: number;
} {
  const basicDollars = basicTaxAfterCreditsCents / 100;
  const tier1 = Math.max(0, basicDollars - ONTARIO_SURTAX.tier1Threshold) * ONTARIO_SURTAX.tier1Rate;
  const tier2 = Math.max(0, basicDollars - ONTARIO_SURTAX.tier2Threshold) * ONTARIO_SURTAX.tier2Rate;
  const tier1Cents = Math.round(tier1 * 100);
  const tier2Cents = Math.round(tier2 * 100);
  return { tier1Cents, tier2Cents, totalCents: tier1Cents + tier2Cents };
}

/** Ontario Health Premium — re-exported from payroll-2026.ts for convenience. */
export function ontarioHealthPremium(taxableIncomeCents: number): number {
  return Math.round(ontarioHealthPremiumAnnual(taxableIncomeCents / 100) * 100);
}

// ───── The big one ─────

export function computeT1(input: T1Input): T1Result {
  const warnings: string[] = [];

  // ── Income (cents) ──
  const box14 = input.t4.box14EmploymentIncomeCents;
  const box16 = input.t4.box16CppBaseCents;
  const box16a = input.t4.box16aCpp2Cents;
  const box22 = input.t4.box22FedTaxWithheldCents;
  const onWithheld = input.t4.ontarioTaxWithheldCents;

  // Gross-up dividends → grossed-up cents flow into Total Income (line 12000).
  const eligibleGrossedUp = dividendGrossUp(input.t5.eligibleActualCents, ELIGIBLE_GROSS_UP_RATE);
  const nonEligibleGrossedUp = dividendGrossUp(input.t5.nonEligibleActualCents, NON_ELIGIBLE_GROSS_UP_RATE);

  // Total Income — line 15000
  const totalIncomeCents = box14 + eligibleGrossedUp + nonEligibleGrossedUp + input.t4aBox117Cents;

  // ── Deductions ──
  // CPP enhanced portion of box 16 (1% of the 5.95%) → line 22215 deduction (s.60(e))
  const cppEnhancedDeductionCents = Math.round(box16 * CPP_ENHANCED_DEDUCTION_FRACTION);
  // CPP2 contributions → line 22200 deduction (s.60(e.1)) — 100% deductible, no credit component
  const cpp2DeductionCents = box16a;

  const netIncomeCents = totalIncomeCents - cppEnhancedDeductionCents - cpp2DeductionCents;
  // v1: no Schedule 3 losses, no other reductions → taxable = net
  const taxableIncomeCents = netIncomeCents;

  // ── Federal calc (Schedule 1) ──
  const fedBracketTaxCents = federalPersonalBracketTax(taxableIncomeCents);

  // Non-refundable credit amounts (pre-rate, cents):
  const bpaDollars = federalBpaFor(netIncomeCents / 100);
  const bpaAmountCents = Math.round(bpaDollars * 100);
  const ceaAmountCents = Math.min(box14, CANADA_EMPLOYMENT_AMOUNT_2026 * 100);
  // CPP base credit: the 4.95/5.95 share of box 16 → line 30800
  const cppBaseAmountCentsFed = Math.round(box16 * CPP_BASE_CREDIT_FRACTION);

  const fedCreditsCents = bpaAmountCents + ceaAmountCents + cppBaseAmountCentsFed;
  const fedCreditsTaxCents = Math.round(fedCreditsCents * FEDERAL_CREDIT_RATE_2026);

  // DTC — federal (line 40425)
  const fedDtcEligibleCents = dividendTaxCredit(eligibleGrossedUp, FEDERAL_DTC_ELIGIBLE_RATE);
  const fedDtcNonEligibleCents = dividendTaxCredit(nonEligibleGrossedUp, FEDERAL_DTC_NON_ELIGIBLE_RATE);
  const fedDtcTotalCents = fedDtcEligibleCents + fedDtcNonEligibleCents;

  // Federal tax payable (line 42000) — non-refundable credits + DTC can't push below 0.
  const federalTaxPayableCents = Math.max(
    0,
    fedBracketTaxCents - fedCreditsTaxCents - fedDtcTotalCents,
  );

  // ── Ontario calc (ON428) ──
  const onBracketTaxCents = ontarioPersonalBracketTax(taxableIncomeCents);

  const onBpaAmountCents = ONTARIO_BPA_2026 * 100;
  const onCppBaseAmountCents = Math.round(box16 * CPP_BASE_CREDIT_FRACTION);
  const onCreditsCents = onBpaAmountCents + onCppBaseAmountCents;
  const onCreditsTaxCents = Math.round(onCreditsCents * ONTARIO_CREDIT_RATE_2026);

  const basicTaxAfterCreditsCents = Math.max(0, onBracketTaxCents - onCreditsTaxCents);

  // Ontario surtax — per Ontario 2014 Budget, computed BEFORE Ontario DTC deduction.
  const surtax = ontarioSurtax(basicTaxAfterCreditsCents);

  // Ontario DTC
  const onDtcEligibleCents = dividendTaxCredit(eligibleGrossedUp, ONTARIO_DTC_ELIGIBLE_RATE);
  const onDtcNonEligibleCents = dividendTaxCredit(nonEligibleGrossedUp, ONTARIO_DTC_NON_ELIGIBLE_RATE_2026);
  const onDtcTotalCents = onDtcEligibleCents + onDtcNonEligibleCents;

  // Ontario tax after surtax + DTC — DTC can't push below 0.
  const taxAfterSurtaxAndDtcCents = Math.max(
    0,
    basicTaxAfterCreditsCents + surtax.totalCents - onDtcTotalCents,
  );

  const ontarioHealthPremiumCents = ontarioHealthPremium(taxableIncomeCents);
  const ontarioTaxPayableCents = taxAfterSurtaxAndDtcCents + ontarioHealthPremiumCents;

  // ── Totals (T1 line 43500 and downstream) ──
  const totalTaxPayableCents = federalTaxPayableCents + ontarioTaxPayableCents;
  const totalWithheldCents = box22 + onWithheld;
  // CPP2 overpayment: only possible via multi-employer aggregation (out of scope in v1).
  const cpp2OverpaymentCents = 0;
  const refundOrOwingCents = totalTaxPayableCents - totalWithheldCents - cpp2OverpaymentCents;

  // ── Marginal rate (raw bracket-only; for full-compute use marginalRateOnNextDollar) ──
  const fedBracket = bracketAt(taxableIncomeCents / 100, FEDERAL_BRACKETS_2026);
  const onBracket = bracketAt(taxableIncomeCents / 100, ONTARIO_BRACKETS_2026);
  const marginalRateFedBps = Math.round(fedBracket.rate * 10_000);
  const marginalRateOnBps = Math.round(onBracket.rate * 10_000);
  const marginalRateCombinedBps = marginalRateFedBps + marginalRateOnBps;

  // ── Warnings ──
  if (input.t4.box18EiCents > 0) {
    warnings.push("Box 18 (EI) is non-zero — owner-managers are exempt from EI. Double-check the paycheque source.");
  }
  if (input.t4.box24EiInsurableCents > 0) {
    warnings.push("Box 24 (EI insurable earnings) is non-zero — owner-managers should have 0.");
  }
  if (input.t4.box52PensionAdjustmentCents > 0) {
    warnings.push("Box 52 (pension adjustment) is non-zero — v1 assumes no IPP. Extend computeT1 if this is real.");
  }
  if (netIncomeCents > FEDERAL_BRACKETS_2026[3]!.upTo * 100) {
    warnings.push(`Net income is in the BPA phase-out band — phased BPA is $${bpaDollars.toFixed(2)}.`);
  }

  return {
    totalIncomeCents,
    cppEnhancedDeductionCents,
    cpp2DeductionCents,
    netIncomeCents,
    taxableIncomeCents,
    federal: {
      bracketTaxCents: fedBracketTaxCents,
      bpaAmountCents,
      ceaAmountCents,
      cppBaseAmountCents: cppBaseAmountCentsFed,
      nonRefundableCreditsCents: fedCreditsCents,
      nonRefundableCreditsTaxCents: fedCreditsTaxCents,
      dtcEligibleCents: fedDtcEligibleCents,
      dtcNonEligibleCents: fedDtcNonEligibleCents,
      dtcTotalCents: fedDtcTotalCents,
      federalTaxPayableCents,
    },
    ontario: {
      bracketTaxCents: onBracketTaxCents,
      bpaAmountCents: onBpaAmountCents,
      cppBaseAmountCents: onCppBaseAmountCents,
      nonRefundableCreditsCents: onCreditsCents,
      nonRefundableCreditsTaxCents: onCreditsTaxCents,
      basicTaxAfterCreditsCents,
      surtaxTier1Cents: surtax.tier1Cents,
      surtaxTier2Cents: surtax.tier2Cents,
      surtaxTotalCents: surtax.totalCents,
      dtcEligibleCents: onDtcEligibleCents,
      dtcNonEligibleCents: onDtcNonEligibleCents,
      dtcTotalCents: onDtcTotalCents,
      taxAfterSurtaxAndDtcCents,
      ontarioHealthPremiumCents,
      ontarioTaxPayableCents,
    },
    totalTaxPayableCents,
    totalWithheldCents,
    cpp2OverpaymentCents,
    refundOrOwingCents,
    marginalRateFedBps,
    marginalRateOnBps,
    marginalRateCombinedBps,
    ratesEditionTag: RATES_EDITION_TAG_2026,
    warnings,
  };
}

// ───── Planner hooks ─────

/** Simple bracket-lookup marginal rate at a given taxable income point. */
export function marginalRateAt(taxableIncomeCents: number): {
  federalBps: number;
  ontarioBps: number;
  combinedBps: number;
} {
  const A = taxableIncomeCents / 100;
  const fed = bracketAt(A, FEDERAL_BRACKETS_2026);
  const on = bracketAt(A, ONTARIO_BRACKETS_2026);
  const federalBps = Math.round(fed.rate * 10_000);
  const ontarioBps = Math.round(on.rate * 10_000);
  return { federalBps, ontarioBps, combinedBps: federalBps + ontarioBps };
}

/**
 * Effective combined marginal rate over the NEXT $deltaCents of taxable income.
 * Re-runs the full T1 compute at `base` and `base + delta` so surtax kicks, BPA
 * phase-out, and OHP tier transitions are captured. Returns basis points.
 *
 * Phase 6's self-pay planner uses this for the user-facing "your marginal rate
 * on an extra $1K of salary" display.
 */
export function marginalRateOnNextDollar(
  baseInput: T1Input,
  deltaCents = 100_000,
): { federalBps: number; ontarioBps: number; combinedBps: number } {
  const base = computeT1(baseInput);
  // Add the delta to employment income (most common use case). If the caller
  // wants a dividend-side marginal, they can pre-bake the delta into t5.*.
  const bumped = computeT1({
    ...baseInput,
    t4: { ...baseInput.t4, box14EmploymentIncomeCents: baseInput.t4.box14EmploymentIncomeCents + deltaCents },
  });
  const dFederal = bumped.federal.federalTaxPayableCents - base.federal.federalTaxPayableCents;
  const dOntario = bumped.ontario.ontarioTaxPayableCents - base.ontario.ontarioTaxPayableCents;
  const dTotal = bumped.totalTaxPayableCents - base.totalTaxPayableCents;
  return {
    federalBps: Math.round((dFederal / deltaCents) * 10_000),
    ontarioBps: Math.round((dOntario / deltaCents) * 10_000),
    combinedBps: Math.round((dTotal / deltaCents) * 10_000),
  };
}
