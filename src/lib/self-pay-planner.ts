/**
 * Phase 6 self-pay planner — pure compute orchestrator.
 *
 * Composes the canonical tax libs into a single `simulateScenario` that
 * answers: "for this FY, if I pay myself $X salary + $Y eligible divs +
 * $Z non-eligible divs, what's my combined corp+personal tax + take-home?"
 *
 * **Pure, client-safe, no I/O.** Imports only other pure libs — safe to
 * import from `"use client"` components so slider drags recompute in-browser
 * without server round-trips. No `db`, no `next/headers`, no `node:crypto`.
 *
 * The server action `saveScenario` (src/server/actions/planner.ts) additionally
 * runs `crypto.createHash("sha256")` over the canonical JSON to freeze a
 * drift-detection fingerprint, but that hashing lives in the server action;
 * this module only exposes the canonical string via `canonicalInputJson`.
 */

import type { T1Input } from "./t1";
import { computeT1, marginalRateOnNextDollar } from "./t1";
import {
  CPP_YMPE_2026,
  CPP_RATE_2026,
  CPP_BASIC_EXEMPTION_2026,
  CPP_MAX_ANNUAL_2026,
  computePayroll,
  type PayPeriodsPerYear,
} from "./payroll-2026";
import { RATES_EDITION_TAG_2026 } from "./t1-rates-2026";
import { estimateT2Detailed, SBD_BUSINESS_LIMIT_CENTS } from "./t2";
import { computeGrip } from "./tax-pools";

// ───── Constants ─────

/**
 * RRSP dollar limit for 2026 — 2026's earned income × 18% generates *2027's*
 * deduction room (capped at this amount). Source: CRA RRSP deduction limits
 * table, indexed annually.
 */
export const RRSP_DOLLAR_LIMIT_2026_CENTS = 3_249_000; // $32,490

/** 18% of prior-year earned income = RRSP room. ITA s.146(1) "RRSP deduction limit". */
export const RRSP_EARNED_INCOME_FRACTION = 0.18;

// ───── Types ─────

export type PsbRisk = "green" | "amber" | "red";

export type ScenarioInput = {
  fiscalYear: number;
  /** FY period start — used for Ontario rate proration. ISO YYYY-MM-DD. */
  periodStart: string;
  /** FY period end — used for Ontario rate proration. ISO YYYY-MM-DD. */
  periodEnd: string;
  projectedRevenueCents: number;
  /** Already meals-adjusted and capital-excluded per `operatingExpensesForT2`. */
  projectedOpexCents: number;
  salaryCents: number;
  eligibleDividendCents: number;
  nonEligibleDividendCents: number;
  ccaClaimedCents: number;
  priorYearAaiiCents: number;
  openingGripCents: number;
  /** 12 monthly, 24 semi-monthly, 26 bi-weekly, 52 weekly. Defaults to 12. */
  payPeriodsPerYear?: PayPeriodsPerYear;
  /** Current PSB risk — if red, planner emits an audit-risk warning. Optional. */
  psbRisk?: PsbRisk;
  isCcpc?: boolean; // defaults to true
  ontarioGeneralRateBps?: number; // defaults to 1150 (handled by estimateT2Detailed)
};

export type ScenarioWarning = {
  code:
    | "psb_red"
    | "grip_overdraft"
    | "sbd_grind"
    | "sbd_limit_exceeded"
    | "salary_exceeds_revenue"
    | "salary_suspicious_max"
    | "zero_mix_baseline"
    | "non_monthly_cadence"
    | "corp_loss";
  severity: "info" | "warn" | "error";
  message: string;
};

export type SyntheticT4 = T1Input["t4"];

export type ScenarioResult = {
  corpTaxCents: number;
  personalTaxCents: number;
  totalHouseholdTaxCents: number;
  takeHomeCents: number;
  cppContribCents: number; // employee CPP1 + CPP2 combined for the year
  rrspRoomGeneratedCents: number; // 18% × salary, capped at 2026 max
  gripClosingCents: number;
  syntheticT4: SyntheticT4;
  marginalRateBps: number;
  // Flow-through of underlying compute for dashboard + coherence checks
  corpNetIncomeForTaxCents: number;
  corpTaxableIncomeCents: number;
  dividendRefundCents: number; // 0 in 6A (no AAII); wired in when RDTOH compute engages
  // Fingerprint (stable JSON for drift detection; hashing done by caller)
  ratesEditionTag: string;
  warnings: ScenarioWarning[];
};

export type BaselineFromActuals = {
  ytdRevenueCents: number;
  ytdOpexCents: number;
  ytdSalaryCents: number;
  ytdEmployerCppCents: number;
  ytdEligibleDividendCents: number;
  ytdNonEligibleDividendCents: number;
  openingGripCents: number;
  priorYearAaiiCents: number;
  periodStart: string;
  periodEnd: string;
};

// ───── synthesizeT4 ─────

/**
 * Synthesize a full-year T4 slip from an annual salary by iterating
 * `computePayroll` over `periodsPerYear` evenly-sized paycheques with rolling
 * YTD. Matches what `/paycheques` would produce if Saïd issued that salary.
 *
 * Assumption: even split across pay periods, no mid-year joiners, no bonuses.
 * The residual cent from integer division lands on the final period so the
 * sum of `grossCents` equals `annualSalaryCents` exactly.
 */
export function synthesizeT4(
  annualSalaryCents: number,
  periodsPerYear: PayPeriodsPerYear = 12,
): SyntheticT4 & { employerCppCents: number } {
  const t4: SyntheticT4 = {
    box14EmploymentIncomeCents: 0,
    box16CppBaseCents: 0,
    box16aCpp2Cents: 0,
    box18EiCents: 0,
    box22FedTaxWithheldCents: 0,
    box24EiInsurableCents: 0,
    box26CppPensionableCents: 0,
    box52PensionAdjustmentCents: 0,
    ontarioTaxWithheldCents: 0,
  };

  if (annualSalaryCents <= 0) {
    return { ...t4, employerCppCents: 0 };
  }

  let ytdCppCents = 0;
  let ytdCpp2Cents = 0;
  let ytdGrossCents = 0;
  let employerCppCents = 0;
  let employerCpp2Cents = 0;

  const basePerPeriod = Math.floor(annualSalaryCents / periodsPerYear);
  const residual = annualSalaryCents - basePerPeriod * periodsPerYear;

  for (let i = 0; i < periodsPerYear; i++) {
    const grossCents = i === periodsPerYear - 1 ? basePerPeriod + residual : basePerPeriod;
    const slip = computePayroll({
      grossCents,
      ytdCppCents,
      ytdCpp2Cents,
      ytdGrossCents,
      payPeriodsPerYear: periodsPerYear,
    });
    t4.box14EmploymentIncomeCents += slip.grossCents;
    t4.box16CppBaseCents += slip.cppCents;
    t4.box16aCpp2Cents += slip.cpp2Cents;
    t4.box22FedTaxWithheldCents += slip.federalTaxCents;
    t4.ontarioTaxWithheldCents += slip.provincialTaxCents;
    t4.box26CppPensionableCents += slip.grossCents; // owner-manager: pensionable ≈ gross
    employerCppCents += slip.employerCppCents;
    employerCpp2Cents += slip.employerCpp2Cents;
    ytdCppCents += slip.cppCents;
    ytdCpp2Cents += slip.cpp2Cents;
    ytdGrossCents += slip.grossCents;
  }

  return { ...t4, employerCppCents: employerCppCents + employerCpp2Cents };
}

// ───── simulateScenario ─────

export function simulateScenario(input: ScenarioInput): ScenarioResult {
  const warnings: ScenarioWarning[] = [];
  const periodsPerYear = input.payPeriodsPerYear ?? 12;
  const isCcpc = input.isCcpc ?? true;

  // 1. Synthesize T4 via payroll loop
  const synth = synthesizeT4(input.salaryCents, periodsPerYear);
  const syntheticT4: SyntheticT4 = {
    box14EmploymentIncomeCents: synth.box14EmploymentIncomeCents,
    box16CppBaseCents: synth.box16CppBaseCents,
    box16aCpp2Cents: synth.box16aCpp2Cents,
    box18EiCents: synth.box18EiCents,
    box22FedTaxWithheldCents: synth.box22FedTaxWithheldCents,
    box24EiInsurableCents: synth.box24EiInsurableCents,
    box26CppPensionableCents: synth.box26CppPensionableCents,
    box52PensionAdjustmentCents: synth.box52PensionAdjustmentCents,
    ontarioTaxWithheldCents: synth.ontarioTaxWithheldCents,
  };

  // 2. Corp T2
  const t2 = estimateT2Detailed({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    isCcpc,
    revenueCents: input.projectedRevenueCents,
    operatingExpensesCents: input.projectedOpexCents,
    salaryCents: input.salaryCents,
    employerCppCents: synth.employerCppCents,
    ccaClaimedCents: input.ccaClaimedCents,
    priorYearAaiiCents: input.priorYearAaiiCents,
    ontarioGeneralRateBps: input.ontarioGeneralRateBps,
  });

  // 3. GRIP — soft cap, warn on overdraft but let planner proceed
  const grip = computeGrip({
    openingCents: input.openingGripCents,
    fullRateIncomeCents: t2.gripFullRateIncomeCents,
    eligibleDividendsPaidCents: input.eligibleDividendCents,
  });

  // 4. Personal T1
  const t1 = computeT1({
    taxYear: input.fiscalYear, // for a Dec-31 FYE, fiscalYear === taxYear
    t4: syntheticT4,
    t5: {
      eligibleActualCents: input.eligibleDividendCents,
      nonEligibleActualCents: input.nonEligibleDividendCents,
    },
    t4aBox117Cents: 0,
  });

  // 5. Warnings assembly
  if (input.psbRisk === "red") {
    warnings.push({
      code: "psb_red",
      severity: "error",
      message:
        "PSB risk is RED. Planner assumes CCPC active-business treatment; a PSB reclass would invalidate salary paths and push corp tax toward 44.5%. Consult a CPA before changing self-pay.",
    });
  }
  if (input.psbRisk === "amber") {
    warnings.push({
      code: "psb_red",
      severity: "warn",
      message:
        "PSB risk is amber. Planner assumes CCPC active-business treatment; tighten /psb signals before committing to this mix.",
    });
  }
  if (grip.overdraftCents > 0) {
    warnings.push({
      code: "grip_overdraft",
      severity: "warn",
      message: `Eligible dividends exceed GRIP by $${(grip.overdraftCents / 100).toFixed(2)} — Part III.1 tax (20%) applies to the excess. Reduce eligible or reclassify as non-eligible.`,
    });
  }
  if (t2.sbdGrindCents > 0) {
    warnings.push({
      code: "sbd_grind",
      severity: "warn",
      message: `Prior-FY AAII of $${(input.priorYearAaiiCents / 100).toFixed(0)} grinds SBD limit by $${(t2.sbdGrindCents / 100).toFixed(0)}.`,
    });
  }
  if (t2.fullRateIncomeCents > 0 && isCcpc) {
    warnings.push({
      code: "sbd_limit_exceeded",
      severity: "info",
      message: `Taxable income exceeds SBD — $${(t2.fullRateIncomeCents / 100).toFixed(0)} taxed at the general rate. GRIP grows by 72% of this slice.`,
    });
  }
  if (input.salaryCents > input.projectedRevenueCents) {
    warnings.push({
      code: "salary_exceeds_revenue",
      severity: "error",
      message: "Salary exceeds projected revenue — corp would run at a loss. Use a lower salary or increase revenue.",
    });
  }
  if (input.salaryCents > 20_000_000) {
    warnings.push({
      code: "salary_suspicious_max",
      severity: "warn",
      message: "Salary > $200,000 is unusual for a solo CCPC consultant. Double-check the input.",
    });
  }
  if (
    input.salaryCents === 0 &&
    input.eligibleDividendCents === 0 &&
    input.nonEligibleDividendCents === 0
  ) {
    warnings.push({
      code: "zero_mix_baseline",
      severity: "info",
      message: "Zero-mix baseline: corp pays full tax on profit; nothing flows to you personally. Use as a reference point.",
    });
  }
  if (periodsPerYear !== 12) {
    warnings.push({
      code: "non_monthly_cadence",
      severity: "info",
      message: `Synthesized T4 uses ${periodsPerYear} pay periods. Actual paycheque cadence in settings is used on /paycheques.`,
    });
  }
  if (t2.netIncomeForTaxCents < 0) {
    warnings.push({
      code: "corp_loss",
      severity: "info",
      message: `Corp shows a loss of $${(Math.abs(t2.netIncomeForTaxCents) / 100).toFixed(0)}. Taxable income floors at $0 and loss carry-forwards aren't modelled in v1.`,
    });
  }

  // 6. Totals + waterfall
  const corpTaxCents = t2.totalTaxCents;
  // Personal tax bottom line — use total payable; withholding doesn't change
  // the combined household bill, only whether Saïd owes or gets a refund at
  // filing. The planner compares household burden, so use totalTaxPayable.
  const personalTaxCents = t1.totalTaxPayableCents;
  const totalHouseholdTaxCents = corpTaxCents + personalTaxCents;
  // Take-home = net in Saïd's pocket after both sides pay tax. From the
  // synthesized T4 we know what reaches him in paycheque-net terms (gross −
  // CPP1 − CPP2 − fed withholding − ON withholding). Dividends reach him at
  // actual face value (gross-up is notional for tax only). Then reconcile
  // the T1 refund/owing at year-end.
  const payrollNetCents =
    syntheticT4.box14EmploymentIncomeCents -
    syntheticT4.box16CppBaseCents -
    syntheticT4.box16aCpp2Cents -
    syntheticT4.box22FedTaxWithheldCents -
    syntheticT4.ontarioTaxWithheldCents;
  const dividendsReceivedCents =
    input.eligibleDividendCents + input.nonEligibleDividendCents;
  // t1.refundOrOwingCents: positive = owing, negative = refund
  const takeHomeCents =
    payrollNetCents + dividendsReceivedCents - t1.refundOrOwingCents;

  const cppContribCents =
    syntheticT4.box16CppBaseCents + syntheticT4.box16aCpp2Cents;
  const rrspRoomGeneratedCents = Math.min(
    Math.round(input.salaryCents * RRSP_EARNED_INCOME_FRACTION),
    RRSP_DOLLAR_LIMIT_2026_CENTS,
  );

  // Marginal rate at current taxable income (combined fed+ON bracket-only).
  // For surtax/BPA/OHP-aware marginal use `marginalRateOnNextDollar` on the T1 side.
  const marginalRateBps = t1.marginalRateCombinedBps;
  void marginalRateOnNextDollar; // imported for availability downstream; unused here

  return {
    corpTaxCents,
    personalTaxCents,
    totalHouseholdTaxCents,
    takeHomeCents,
    cppContribCents,
    rrspRoomGeneratedCents,
    gripClosingCents: grip.closingCents,
    syntheticT4,
    marginalRateBps,
    corpNetIncomeForTaxCents: t2.netIncomeForTaxCents,
    corpTaxableIncomeCents: t2.taxableIncomeCents,
    dividendRefundCents: 0, // 6A: no RDTOH wiring (zero AAII); reserved for later
    ratesEditionTag: RATES_EDITION_TAG_2026,
    warnings,
  };
}

// ───── buildPresetInputs ─────

/**
 * Three preset scenarios tuned for Saïd's 2026 profile:
 *   - **salaryToYmpe**: $74,600 salary (= 2026 YMPE, caps CPP1, generates max
 *     RRSP room). Remaining corp profit → eligible dividend up to GRIP, rest
 *     non-eligible.
 *   - **dividendOnly**: $0 salary. All corp after-tax profit → non-eligible
 *     dividend (GRIP is $0 in year 1 → eligible dividends trigger Part III.1).
 *   - **custom**: seed inputs from YTD actuals; user slides from there.
 */
export function buildPresetInputs(
  fy: number,
  baseline: BaselineFromActuals,
): Record<"salaryToYmpe" | "dividendOnly" | "custom", ScenarioInput> {
  const base: Omit<
    ScenarioInput,
    "salaryCents" | "eligibleDividendCents" | "nonEligibleDividendCents"
  > = {
    fiscalYear: fy,
    periodStart: baseline.periodStart,
    periodEnd: baseline.periodEnd,
    projectedRevenueCents: baseline.ytdRevenueCents,
    projectedOpexCents: baseline.ytdOpexCents,
    ccaClaimedCents: 0,
    priorYearAaiiCents: baseline.priorYearAaiiCents,
    openingGripCents: baseline.openingGripCents,
  };

  // Salary-to-YMPE: $74,600
  const salaryToYmpeSalaryCents = CPP_YMPE_2026 * 100;
  // Corp profit after salary (rough pre-tax) → split eligible up to GRIP opening
  // (conservatively; the planner recomputes GRIP dynamically), rest non-eligible.
  const salaryToYmpePreTax =
    baseline.ytdRevenueCents -
    baseline.ytdOpexCents -
    salaryToYmpeSalaryCents;
  // Estimate post-SBD corp tax at ~12.2% (Ontario SBD H1 2026), leaves cash to distribute.
  const salaryToYmpePostTaxCash = Math.max(
    0,
    Math.round(salaryToYmpePreTax * (1 - 0.122)),
  );
  // Default: assume all non-eligible (GRIP is zero for year 1). Saïd can
  // re-slot some as eligible when GRIP accumulates.
  const salaryToYmpe: ScenarioInput = {
    ...base,
    salaryCents: salaryToYmpeSalaryCents,
    eligibleDividendCents: Math.min(baseline.openingGripCents, salaryToYmpePostTaxCash),
    nonEligibleDividendCents: Math.max(
      0,
      salaryToYmpePostTaxCash - Math.min(baseline.openingGripCents, salaryToYmpePostTaxCash),
    ),
  };

  // Dividend-only: $0 salary, all cash as non-eligible
  const divOnlyPreTax = baseline.ytdRevenueCents - baseline.ytdOpexCents;
  const divOnlyPostTaxCash = Math.max(
    0,
    Math.round(divOnlyPreTax * (1 - 0.122)),
  );
  const dividendOnly: ScenarioInput = {
    ...base,
    salaryCents: 0,
    eligibleDividendCents: Math.min(baseline.openingGripCents, divOnlyPostTaxCash),
    nonEligibleDividendCents: Math.max(
      0,
      divOnlyPostTaxCash - Math.min(baseline.openingGripCents, divOnlyPostTaxCash),
    ),
  };

  // Custom: seed from actuals
  const custom: ScenarioInput = {
    ...base,
    salaryCents: baseline.ytdSalaryCents,
    eligibleDividendCents: baseline.ytdEligibleDividendCents,
    nonEligibleDividendCents: baseline.ytdNonEligibleDividendCents,
  };

  return { salaryToYmpe, dividendOnly, custom };
}

// ───── canonicalInputJson ─────

/**
 * Stable JSON serialization of a ScenarioInput. Keys always in the same order
 * so `canonicalInputJson(a) === canonicalInputJson(b)` iff inputs are
 * semantically equal. Used by the server action to sha256 for drift detection.
 */
export function canonicalInputJson(input: ScenarioInput): string {
  const ordered = {
    fiscalYear: input.fiscalYear,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    projectedRevenueCents: input.projectedRevenueCents,
    projectedOpexCents: input.projectedOpexCents,
    salaryCents: input.salaryCents,
    eligibleDividendCents: input.eligibleDividendCents,
    nonEligibleDividendCents: input.nonEligibleDividendCents,
    ccaClaimedCents: input.ccaClaimedCents,
    priorYearAaiiCents: input.priorYearAaiiCents,
    openingGripCents: input.openingGripCents,
    payPeriodsPerYear: input.payPeriodsPerYear ?? 12,
    isCcpc: input.isCcpc ?? true,
    ontarioGeneralRateBps: input.ontarioGeneralRateBps ?? 1150,
  };
  return JSON.stringify(ordered);
}

// Re-exports kept in-range so callers of the planner can stay planner-local
export {
  CPP_YMPE_2026,
  CPP_RATE_2026,
  CPP_BASIC_EXEMPTION_2026,
  CPP_MAX_ANNUAL_2026,
  SBD_BUSINESS_LIMIT_CENTS,
  RATES_EDITION_TAG_2026,
};
