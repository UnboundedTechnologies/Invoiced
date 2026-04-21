/**
 * Verifies src/lib/t1.ts — the canonical T1 (personal tax) compute engine.
 *
 * Source of truth:
 *   - CRA T1 General 2026 (lines 15000/22200/22215/23600/26000/30000/30800/31260/33500/35000/40425/42000/43500)
 *   - Form ON428 2026 (Ontario — basic tax → non-refundable credits → surtax → DTC → OHP)
 *   - CRA T4127 122nd edition (Jan 1 2026) — brackets, BPA, BPA phase-out
 *   - Ontario 2014 Budget — surtax computed BEFORE DTC deduction
 *   - ITA s.60(e) / s.60(e.1) — CPP enhanced + CPP2 deductions
 *
 * Run: `pnpm verify-t1`. Fails the process (exit 1) on any mismatch.
 */

import {
  computeT1,
  dividendGrossUp,
  dividendTaxCredit,
  marginalRateAt,
  marginalRateOnNextDollar,
  ontarioSurtax,
  taxYearFor,
  type T1Input,
} from "../src/lib/t1";
import {
  ELIGIBLE_GROSS_UP_RATE,
  FEDERAL_BPA_MAX_2026,
  FEDERAL_BPA_MIN_2026,
  FEDERAL_BPA_PHASE_END_2026,
  FEDERAL_BPA_PHASE_START_2026,
  NON_ELIGIBLE_GROSS_UP_RATE,
  ONTARIO_SURTAX,
} from "../src/lib/t1-rates-2026";
import { formatCAD } from "../src/lib/utils";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}

function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

function expectNear(failures: string[], label: string, actual: number, expected: number, tolCents = 100) {
  if (Math.abs(actual - expected) > tolCents) {
    failures.push(`${label}: want ${formatCAD(expected)} ± ${formatCAD(tolCents)}, got ${formatCAD(actual)}`);
  }
}

function expectZero(failures: string[], label: string, actual: number, tolCents = 0) {
  if (Math.abs(actual) > tolCents) failures.push(`${label}: want 0 ± ${tolCents}, got ${actual}`);
}

function blankT4(): T1Input["t4"] {
  return {
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
}

function input(overrides: Partial<T1Input> = {}): T1Input {
  return {
    taxYear: 2026,
    t4: blankT4(),
    t5: { eligibleActualCents: 0, nonEligibleActualCents: 0 },
    t4aBox117Cents: 0,
    ...overrides,
  };
}

// ——— Test 1: Blank slate — all zeros ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input());
  expectEq(failures, "totalIncome = 0", r.totalIncomeCents, 0);
  expectEq(failures, "totalTax = 0", r.totalTaxPayableCents, 0);
  expectEq(failures, "refundOrOwing = 0", r.refundOrOwingCents, 0);
  record("Blank slate: all zeros in → all zeros out", failures);
})();

// ——— Test 2: Salary-only low ($30K) — BPA fully absorbs ———

(() => {
  const failures: string[] = [];
  const r = computeT1(
    input({
      t4: {
        ...blankT4(),
        box14EmploymentIncomeCents: 30_000_00,
        box26CppPensionableCents: 30_000_00,
        box16CppBaseCents: Math.round((30_000 - 3_500) * 0.0595 * 100),
      },
    }),
  );
  // $30K − BPA $16,452 (ish) − CPP credit ≈ $13K taxable credit-wise.
  // At 14% fed ≈ $1,820. ON bracket 1 (5.05%) ≈ $685. Total ≈ $2,500 + OHP $300 ≈ $2,800.
  if (r.totalTaxPayableCents <= 0 || r.totalTaxPayableCents > 400_000) {
    failures.push(`$30K salary total tax out of range: ${formatCAD(r.totalTaxPayableCents)}`);
  }
  record("Salary-only low: $30K produces positive, plausibly small total tax", failures);
})();

// ——— Test 3: Salary-only mid ($80K) ———

(() => {
  const failures: string[] = [];
  // $80K gross. box 16 and box 16a derived from CPP formulas.
  const box16 = Math.round((74_600 - 3_500) * 0.0595 * 100); // max CPP base
  const box16a = Math.round((80_000 - 74_600) * 0.04 * 100); // CPP2 on $5,400
  const r = computeT1(
    input({
      t4: {
        ...blankT4(),
        box14EmploymentIncomeCents: 80_000_00,
        box26CppPensionableCents: 74_600_00,
        box16CppBaseCents: box16,
        box16aCpp2Cents: box16a,
      },
    }),
  );
  // Effective rate in 14-20% fed + 5-9% ON ballpark → $10K-$20K total.
  if (r.totalTaxPayableCents < 8_000_00 || r.totalTaxPayableCents > 22_000_00) {
    failures.push(`$80K salary total tax out of range: ${formatCAD(r.totalTaxPayableCents)}`);
  }
  // CPP base credit ≈ box16 × 4.95/5.95 ≈ 83.2% of box16
  const expectedCppCreditAmount = Math.round(box16 * (4.95 / 5.95));
  expectEq(failures, "federal CPP base credit amount", r.federal.cppBaseAmountCents, expectedCppCreditAmount);
  record("Salary-only mid: $80K + CPP/CPP2 flows correctly to credit + deduction", failures);
})();

// ——— Test 4: Salary-only high ($200K) — BPA phase-out active ———

(() => {
  const failures: string[] = [];
  const r = computeT1(
    input({
      t4: {
        ...blankT4(),
        box14EmploymentIncomeCents: 200_000_00,
        box26CppPensionableCents: 74_600_00,
        box16CppBaseCents: Math.round((74_600 - 3_500) * 0.0595 * 100),
        box16aCpp2Cents: Math.round((85_000 - 74_600) * 0.04 * 100),
      },
    }),
  );
  // Net income ≈ $199,500 → within BPA phase-out band ($181,440 → $258,482).
  // Expected BPA ≈ 16,452 − 1,623 × (199,500 − 181,440) / 77,042
  if (r.federal.bpaAmountCents >= FEDERAL_BPA_MAX_2026 * 100) {
    failures.push(`expected phased BPA < max at $200K net; got ${formatCAD(r.federal.bpaAmountCents)}`);
  }
  if (r.federal.bpaAmountCents <= FEDERAL_BPA_MIN_2026 * 100) {
    failures.push(`expected phased BPA > min at $200K net; got ${formatCAD(r.federal.bpaAmountCents)}`);
  }
  record("Salary-only high: $200K net income triggers BPA phase-out (between max and min)", failures);
})();

// ——— Test 5: Dividends-only non-eligible ($55K) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t5: { eligibleActualCents: 0, nonEligibleActualCents: 55_000_00 } }));
  // Grossed-up = 55,000 × 1.15 = $63,250 → taxable income.
  expectEq(failures, "grossed-up non-elig income", r.totalIncomeCents, Math.round(55_000_00 * 1.15));
  // BPA + non-elig DTC should absorb most federal tax. At $63,250 taxable:
  // Fed bracket tax = 14% × 63,250 = $8,855.
  // Credits = BPA × 14% ≈ $2,303 + CPP (0) = $2,303.
  // DTC non-elig = 63,250 × 9.0301% ≈ $5,711.
  // Fed tax = 8,855 − 2,303 − 5,711 = $841 (floored 0 actually ≈ positive).
  // Very low total federal tax. ON: bracket tax ~$3,193 − BPA credit ~$656 = ~$2,537,
  // minus surtax (0, < 5,818), minus ON DTC non-elig 63,250 × 2.9863% ≈ $1,889 = ~$648.
  // Plus OHP at $63K ≈ $600 → total ON ~$1,250.
  // Loose range:
  if (r.totalTaxPayableCents < 0 || r.totalTaxPayableCents > 400_000) {
    failures.push(`$55K non-elig dividend: total tax out of range: ${formatCAD(r.totalTaxPayableCents)}`);
  }
  record("Dividends-only non-eligible: $55K grossed up to $63,250 in taxable income; DTC reduces net tax", failures);
})();

// ——— Test 6: Dividends-only eligible ($55K) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t5: { eligibleActualCents: 55_000_00, nonEligibleActualCents: 0 } }));
  // Grossed-up = 55,000 × 1.38 = $75,900
  expectEq(failures, "grossed-up eligible income", r.totalIncomeCents, Math.round(55_000_00 * 1.38));
  // Fed DTC eligible = 75,900 × 15.0198% ≈ $11,400 → likely zeros federal tax.
  if (r.federal.federalTaxPayableCents > 300_00) {
    failures.push(`$55K eligible dividend: federal tax should be very small; got ${formatCAD(r.federal.federalTaxPayableCents)}`);
  }
  record("Dividends-only eligible: $55K grossed up to $75,900 + 15.0198% fed DTC → near-zero federal tax", failures);
})();

// ——— Test 7: Mixed salary + non-eligible dividend ———

(() => {
  const failures: string[] = [];
  const r = computeT1(
    input({
      t4: { ...blankT4(), box14EmploymentIncomeCents: 50_000_00 },
      t5: { eligibleActualCents: 0, nonEligibleActualCents: 50_000_00 },
    }),
  );
  // Total income ≈ 50,000 + 50,000 × 1.15 = 107,500.
  const expectedTotal = 50_000_00 + Math.round(50_000_00 * 1.15);
  expectEq(failures, "mixed total income", r.totalIncomeCents, expectedTotal);
  // Should be in fed bracket 2 (20.5%).
  if (r.federal.federalTaxPayableCents <= 0) {
    failures.push(`mixed $50K+$50K: federal tax should be positive; got ${formatCAD(r.federal.federalTaxPayableCents)}`);
  }
  record("Mixed: $50K salary + $50K non-elig dividend total income identity", failures);
})();

// ——— Test 8: BPA phase-out low boundary ———

(() => {
  const failures: string[] = [];
  // Construct box 14 ≈ $181,440 so netIncome ≈ $181,440 (no other deductions).
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: FEDERAL_BPA_PHASE_START_2026 * 100 } }));
  expectEq(failures, "BPA at low boundary", r.federal.bpaAmountCents, FEDERAL_BPA_MAX_2026 * 100);
  record(`BPA phase-out low boundary: netIncome = ${formatCAD(FEDERAL_BPA_PHASE_START_2026 * 100)} → BPA = ${formatCAD(FEDERAL_BPA_MAX_2026 * 100)}`, failures);
})();

// ——— Test 9: BPA phase-out midpoint ($220K netIncome) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 220_000_00 } }));
  // BPA = 16,452 − 1,623 × (220,000 − 181,440) / 77,042
  const expected =
    FEDERAL_BPA_MAX_2026 -
    (FEDERAL_BPA_MAX_2026 - FEDERAL_BPA_MIN_2026) *
      ((220_000 - FEDERAL_BPA_PHASE_START_2026) / (FEDERAL_BPA_PHASE_END_2026 - FEDERAL_BPA_PHASE_START_2026));
  expectNear(failures, "BPA at $220K midpoint", r.federal.bpaAmountCents, Math.round(expected * 100), 2);
  record("BPA phase-out midpoint: linear reduction at $220K netIncome", failures);
})();

// ——— Test 10: BPA phase-out high boundary ($258,482 netIncome) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: FEDERAL_BPA_PHASE_END_2026 * 100 } }));
  expectEq(failures, "BPA at high boundary", r.federal.bpaAmountCents, FEDERAL_BPA_MIN_2026 * 100);
  record(`BPA phase-out high boundary: netIncome ≥ ${formatCAD(FEDERAL_BPA_PHASE_END_2026 * 100)} → BPA = ${formatCAD(FEDERAL_BPA_MIN_2026 * 100)}`, failures);
})();

// ——— Test 11: CPP base credit vs deduction split ———

(() => {
  const failures: string[] = [];
  // box 16 = $3,520 → credit = 3,520 × 4.95/5.95 = $2,928.40; deduction = $591.60
  const box16 = 3_520_00;
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 60_000_00, box16CppBaseCents: box16 } }));
  const expectedCredit = Math.round(box16 * (4.95 / 5.95));
  const expectedDeduction = Math.round(box16 * (1.00 / 5.95));
  expectEq(failures, "CPP base credit amount", r.federal.cppBaseAmountCents, expectedCredit);
  expectEq(failures, "CPP enhanced deduction (s.60(e))", r.cppEnhancedDeductionCents, expectedDeduction);
  record("CPP split: 4.95/5.95 → credit; 1/5.95 → deduction (s.60(e))", failures);
})();

// ——— Test 12: CPP2 pure deduction ———

(() => {
  const failures: string[] = [];
  const box16a = 396_00;
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 85_000_00, box16aCpp2Cents: box16a } }));
  expectEq(failures, "CPP2 full amount → deduction", r.cpp2DeductionCents, box16a);
  // No federal or ON CPP2 credit exists.
  record("CPP2: entirely deductible (s.60(e.1)), no credit component", failures);
})();

// ——— Test 13: ON surtax tier 1 boundary ———

(() => {
  const failures: string[] = [];
  // At basic tax = tier1Threshold → tier 1 surtax = 0
  const atThreshold = ontarioSurtax(ONTARIO_SURTAX.tier1Threshold * 100);
  expectZero(failures, `surtax at exactly tier 1 threshold ($${ONTARIO_SURTAX.tier1Threshold})`, atThreshold.totalCents, 0);
  // Just above → positive tier 1
  const justAbove = ontarioSurtax(ONTARIO_SURTAX.tier1Threshold * 100 + 100_00); // +$100
  if (justAbove.tier1Cents <= 0) failures.push(`surtax tier 1 should be positive just above threshold; got ${justAbove.tier1Cents}`);
  if (justAbove.tier2Cents !== 0) failures.push(`surtax tier 2 should be 0 below tier 2 threshold; got ${justAbove.tier2Cents}`);
  record(`ON surtax tier 1 boundary: threshold $${ONTARIO_SURTAX.tier1Threshold}`, failures);
})();

// ——— Test 14: ON surtax tier 2 boundary ———

(() => {
  const failures: string[] = [];
  const atThreshold = ontarioSurtax(ONTARIO_SURTAX.tier2Threshold * 100);
  // tier 2 = 0 at exact boundary; tier 1 IS active (already above tier 1 threshold)
  expectZero(failures, `tier 2 surtax at tier 2 threshold ($${ONTARIO_SURTAX.tier2Threshold})`, atThreshold.tier2Cents, 0);
  const justAbove = ontarioSurtax(ONTARIO_SURTAX.tier2Threshold * 100 + 100_00);
  if (justAbove.tier2Cents <= 0) failures.push(`tier 2 surtax should be positive just above threshold; got ${justAbove.tier2Cents}`);
  record(`ON surtax tier 2 boundary: threshold $${ONTARIO_SURTAX.tier2Threshold}`, failures);
})();

// ——— Test 15: ON surtax both tiers fully active ———

(() => {
  const failures: string[] = [];
  // Basic tax = $12,000 → tier 1 = 20% × (12,000 − 5,818); tier 2 = 36% × (12,000 − 7,446)
  const basicCents = 12_000_00;
  const s = ontarioSurtax(basicCents);
  const expectedTier1 = Math.round((12_000 - ONTARIO_SURTAX.tier1Threshold) * 0.20 * 100);
  const expectedTier2 = Math.round((12_000 - ONTARIO_SURTAX.tier2Threshold) * 0.36 * 100);
  expectEq(failures, "surtax tier 1 at basic tax $12K", s.tier1Cents, expectedTier1);
  expectEq(failures, "surtax tier 2 at basic tax $12K", s.tier2Cents, expectedTier2);
  expectEq(failures, "surtax total at basic tax $12K", s.totalCents, expectedTier1 + expectedTier2);
  record("ON surtax: both tiers fully active → 20% × excess over tier 1 + 36% × excess over tier 2", failures);
})();

// ——— Test 16: OHP tier at $48K ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 48_000_00 } }));
  // Taxable ≈ 48,000 → OHP = $450
  expectEq(failures, "OHP at $48K taxable", r.ontario.ontarioHealthPremiumCents, 450_00);
  record("OHP tier $48,000 → $450", failures);
})();

// ——— Test 17: OHP tier at $72K ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 72_000_00 } }));
  expectEq(failures, "OHP at $72K taxable", r.ontario.ontarioHealthPremiumCents, 600_00);
  record("OHP tier $72,000 → $600", failures);
})();

// ——— Test 18: OHP tier at $200K ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 200_000_00 } }));
  expectEq(failures, "OHP at $200K taxable", r.ontario.ontarioHealthPremiumCents, 750_00);
  record("OHP tier $200,000 → $750", failures);
})();

// ——— Test 19: OHP tier max at $250K ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 250_000_00 } }));
  expectEq(failures, "OHP max at $250K taxable", r.ontario.ontarioHealthPremiumCents, 900_00);
  record("OHP max ($900) reached above $200,600 taxable", failures);
})();

// ——— Test 20: T4A box 117 flow ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t4aBox117Cents: 1_200_00 }));
  expectEq(failures, "box 117 flows to total income", r.totalIncomeCents, 1_200_00);
  // With BPA absorbing, total tax should still be 0 at this level.
  expectZero(failures, "low-income box 117 → 0 tax", r.totalTaxPayableCents, 0);
  record("T4A box 117 ($1,200) flows to line 13000 / total income", failures);
})();

// ——— Test 21: Refund case ———

(() => {
  const failures: string[] = [];
  const r = computeT1(
    input({
      t4: {
        ...blankT4(),
        box14EmploymentIncomeCents: 80_000_00,
        box22FedTaxWithheldCents: 20_000_00, // heavy withholding
        ontarioTaxWithheldCents: 10_000_00,
      },
    }),
  );
  if (r.refundOrOwingCents >= 0) {
    failures.push(`expected refund (negative refundOrOwing); got ${formatCAD(r.refundOrOwingCents)}`);
  }
  record("Refund case: heavy withholding → refundOrOwing < 0", failures);
})();

// ——— Test 22: Owing case (dividend-heavy, no withholding) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(input({ t5: { eligibleActualCents: 0, nonEligibleActualCents: 80_000_00 } }));
  if (r.refundOrOwingCents <= 0) {
    failures.push(`expected owing (positive refundOrOwing); got ${formatCAD(r.refundOrOwingCents)}`);
  }
  record("Owing case: $80K non-elig dividend, no withholding → refundOrOwing > 0", failures);
})();

// ——— Test 23: Top-bracket high income ($300K salary) ———

(() => {
  const failures: string[] = [];
  const r = computeT1(
    input({
      t4: {
        ...blankT4(),
        box14EmploymentIncomeCents: 300_000_00,
        box26CppPensionableCents: 74_600_00,
        box16CppBaseCents: Math.round((74_600 - 3_500) * 0.0595 * 100),
        box16aCpp2Cents: Math.round((85_000 - 74_600) * 0.04 * 100),
      },
    }),
  );
  // At $300K net: fed bracket 5 (33%), ON bracket 5 (13.16%), BPA fully phased out, full surtax tier 2, OHP $900.
  // Marginal combined ≈ 46% ballpark. Total tax should be a large positive number.
  if (r.totalTaxPayableCents < 80_000_00 || r.totalTaxPayableCents > 130_000_00) {
    failures.push(`$300K salary total tax out of sane range: ${formatCAD(r.totalTaxPayableCents)}`);
  }
  expectEq(failures, "BPA fully phased out at $300K", r.federal.bpaAmountCents, FEDERAL_BPA_MIN_2026 * 100);
  expectEq(failures, "OHP max at $300K", r.ontario.ontarioHealthPremiumCents, 900_00);
  record("Top-bracket $300K: bracket 5 × 2 + full surtax + OHP max + BPA fully phased out", failures);
})();

// ——— Test 24: Marginal rate at bracket boundaries ———

(() => {
  const failures: string[] = [];
  // Just below first federal boundary → fed bracket 1 (14%).
  // Note: Ontario bracket 1 ceiling is $53,891, so at $58,522 (> $53,891) we're
  // ALREADY in ON bracket 2 (9.15%). Fed and ON bracket boundaries don't align.
  const below = marginalRateAt(58_522_00);
  expectEq(failures, "fed marginal at $58,522", below.federalBps, 1400);
  expectEq(failures, "ON marginal at $58,522 (already in ON bracket 2)", below.ontarioBps, 915);
  // Just above federal boundary → fed bracket 2 (20.5%), ON still bracket 2 (9.15%)
  const above = marginalRateAt(58_524_00);
  expectEq(failures, "fed marginal at $58,524", above.federalBps, 2050);
  expectEq(failures, "ON marginal at $58,524", above.ontarioBps, 915);
  // Separately validate ON bracket 1 → 2 boundary at $53,891
  const belowOn = marginalRateAt(53_890_00);
  expectEq(failures, "ON marginal at $53,890", belowOn.ontarioBps, 505);
  const aboveOn = marginalRateAt(53_892_00);
  expectEq(failures, "ON marginal at $53,892", aboveOn.ontarioBps, 915);
  record("Marginal rate at federal bracket 1 → 2 boundary ($58,523)", failures);
})();

// ——— Test 25: Re-run idempotency ———

(() => {
  const failures: string[] = [];
  const fixture = input({
    t4: { ...blankT4(), box14EmploymentIncomeCents: 120_000_00, box16CppBaseCents: 4_230_45 },
    t5: { eligibleActualCents: 10_000_00, nonEligibleActualCents: 5_000_00 },
    t4aBox117Cents: 500_00,
  });
  const a = computeT1(fixture);
  const b = computeT1(fixture);
  // Verify structure-equal on a few key outputs
  expectEq(failures, "totalIncome (run 1 = run 2)", a.totalIncomeCents, b.totalIncomeCents);
  expectEq(failures, "totalTax (run 1 = run 2)", a.totalTaxPayableCents, b.totalTaxPayableCents);
  expectEq(failures, "refundOrOwing (run 1 = run 2)", a.refundOrOwingCents, b.refundOrOwingCents);
  expectEq(failures, "ratesEditionTag (run 1 = run 2)", a.ratesEditionTag, b.ratesEditionTag);
  record("Re-run idempotency: computeT1 is pure — same input → same result", failures);
})();

// ——— Test 26: Totals integrity ———

(() => {
  const failures: string[] = [];
  const fixture = input({
    t4: {
      ...blankT4(),
      box14EmploymentIncomeCents: 90_000_00,
      box16CppBaseCents: 4_230_45,
      box16aCpp2Cents: 400_00,
      box22FedTaxWithheldCents: 15_000_00,
      ontarioTaxWithheldCents: 5_000_00,
    },
  });
  const r = computeT1(fixture);
  expectEq(
    failures,
    "totalTaxPayable = fed + ON (identity)",
    r.totalTaxPayableCents,
    r.federal.federalTaxPayableCents + r.ontario.ontarioTaxPayableCents,
  );
  expectEq(
    failures,
    "refundOrOwing = totalTaxPayable − totalWithheld − cpp2Overpayment",
    r.refundOrOwingCents,
    r.totalTaxPayableCents - r.totalWithheldCents - r.cpp2OverpaymentCents,
  );
  // Marginal ≡ sum of components
  expectEq(failures, "combined marginal = fed + ON", r.marginalRateCombinedBps, r.marginalRateFedBps + r.marginalRateOnBps);
  // taxYearFor sanity
  expectEq(failures, "taxYearFor 2026-07-15", taxYearFor("2026-07-15"), 2026);
  // dividendGrossUp sanity
  expectEq(failures, "eligible gross-up (38%)", dividendGrossUp(1_000_00, ELIGIBLE_GROSS_UP_RATE), 1_380_00);
  expectEq(failures, "non-elig gross-up (15%)", dividendGrossUp(1_000_00, NON_ELIGIBLE_GROSS_UP_RATE), 1_150_00);
  // dividendTaxCredit sanity
  expectEq(failures, "DTC eligible fed (15.0198% of grossed-up)", dividendTaxCredit(1_380_00, 0.150198), Math.round(1_380_00 * 0.150198));
  // marginalRateOnNextDollar sanity — for a low-income fixture, marginal ≈ 14+5.05% ≈ 19.05% ≈ 1905 bps.
  const lowFixture = input({ t4: { ...blankT4(), box14EmploymentIncomeCents: 30_000_00 } });
  const lowMarg = marginalRateOnNextDollar(lowFixture, 100_00); // $100 bump
  if (lowMarg.combinedBps < 1400 || lowMarg.combinedBps > 2500) {
    failures.push(`low-income marginal on next $100 out of range: ${lowMarg.combinedBps} bps`);
  }
  record("Totals identity + helper sanity checks", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== T1 (personal tax, 2026) verification ===\n");
  for (const r of results) {
    if (r.failures.length === 0) {
      console.log(`✓ ${r.name}`);
      pass++;
    } else {
      console.log(`✗ ${r.name}`);
      r.failures.forEach((f) => console.log(`    ${f}`));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
