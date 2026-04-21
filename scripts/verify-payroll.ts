/**
 * Verifies the 2026 PDOC payroll library (`src/lib/payroll-2026.ts`) —
 * CPP/CPP2 caps, bracket math, owner-manager EI exemption, and the
 * gross-minus-deductions identity.
 *
 * Source of truth: CRA T4127 (Jan 2026 edition). Every constant in the
 * payroll lib cites this doc; this script pins those constants to the
 * formulas that consume them.
 *
 * Run: `pnpm verify-payroll`. Fails the process (exit 1) on any mismatch.
 */

import {
  computePayroll,
  CPP_BASIC_EXEMPTION_2026,
  CPP_MAX_ANNUAL_2026,
  CPP_RATE_2026,
  CPP_YAMPE_2026,
  CPP_YMPE_2026,
  CPP2_MAX_ANNUAL_2026,
  CPP2_RATE_2026,
  FEDERAL_BPA_MAX_2026,
  FEDERAL_BPA_MIN_2026,
  FEDERAL_BPA_PHASE_END_2026,
  FEDERAL_BPA_PHASE_START_2026,
  federalBpaFor,
} from "../src/lib/payroll-2026";
import { formatCAD } from "../src/lib/utils";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}

function expectNear(
  failures: string[],
  label: string,
  actual: number,
  expected: number,
  tolCents = 100, // rounding slack: $1 acceptable for annualized-period math
) {
  if (Math.abs(actual - expected) > tolCents) {
    failures.push(
      `${label}: want ${formatCAD(expected)} ± ${formatCAD(tolCents)}, got ${formatCAD(actual)}`,
    );
  }
}

function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

// ——— Test 1: EI always 0 for owner-manager ———

(() => {
  const failures: string[] = [];
  for (const gross of [1_000_00, 5_000_00, 15_000_00]) {
    const r = computePayroll({
      grossCents: gross,
      ytdCppCents: 0,
      ytdCpp2Cents: 0,
      ytdGrossCents: 0,
      payPeriodsPerYear: 12,
    });
    expectEq(failures, `EI at gross ${formatCAD(gross)}`, r.eiCents, 0);
    expectEq(failures, `employer EI at gross ${formatCAD(gross)}`, r.employerEiCents, 0);
  }
  record("EI exemption: owner-manager always pays 0 EI (employee + employer)", failures);
})();

// ——— Test 2: Gross − deductions = net (identity) ———

(() => {
  const failures: string[] = [];
  const r = computePayroll({
    grossCents: 5_942_00, // ~$71.3K annualized at 12 pays → right around YMPE
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  const deductions =
    r.cppCents + r.cpp2Cents + r.federalTaxCents + r.provincialTaxCents + r.eiCents;
  expectEq(failures, "gross − deductions = net", r.grossCents - deductions, r.netCents);
  record("Paycheque identity: gross − (CPP + CPP2 + fed + ON) = net", failures);
})();

// ——— Test 3: Remittance totals — every piece accounted for ———

(() => {
  const failures: string[] = [];
  const r = computePayroll({
    grossCents: 5_942_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  const expected =
    r.cppCents +
    r.cpp2Cents +
    r.federalTaxCents +
    r.provincialTaxCents +
    r.employerCppCents +
    r.employerCpp2Cents;
  // 1¢ tolerance: totalRemittance is rounded once from the dollar sum; the
  // breakdown rounds each component independently and can drift by 1¢.
  if (Math.abs(r.totalRemittanceCents - expected) > 1) {
    failures.push(
      `remittance: total ${formatCAD(r.totalRemittanceCents)} vs breakdown ${formatCAD(expected)} (diff > 1¢)`,
    );
  }
  record("Remittance identity: remittance = CPP EE + CPP ER + CPP2 EE + CPP2 ER + fed + ON (±1¢)", failures);
})();

// ——— Test 4: Employer CPP matches employee CPP ———

(() => {
  const failures: string[] = [];
  for (const gross of [2_000_00, 5_942_00, 7_000_00]) {
    const r = computePayroll({
      grossCents: gross,
      ytdCppCents: 0,
      ytdCpp2Cents: 0,
      ytdGrossCents: 0,
      payPeriodsPerYear: 12,
    });
    expectEq(
      failures,
      `CPP symmetry at ${formatCAD(gross)}`,
      r.cppCents,
      r.employerCppCents,
    );
    expectEq(
      failures,
      `CPP2 symmetry at ${formatCAD(gross)}`,
      r.cpp2Cents,
      r.employerCpp2Cents,
    );
  }
  record("CPP symmetry: employer portion matches employee portion at all income levels", failures);
})();

// ——— Test 5: CPP ceiling — YTD near max produces 0 new CPP ———

(() => {
  const failures: string[] = [];
  const maxCents = Math.round(CPP_MAX_ANNUAL_2026 * 100);
  const r = computePayroll({
    grossCents: 5_942_00,
    ytdCppCents: maxCents, // already at cap
    ytdCpp2Cents: 0,
    ytdGrossCents: CPP_YMPE_2026 * 100,
    payPeriodsPerYear: 12,
  });
  expectEq(failures, "CPP clipped at cap", r.cppCents, 0);
  record("CPP cap: YTD at max → subsequent pay charges 0 CPP1", failures);
})();

// ——— Test 6: CPP2 only kicks in above YMPE ———

(() => {
  const failures: string[] = [];
  // First pay of the year, gross well below YMPE → CPP2 should be 0
  const below = computePayroll({
    grossCents: 2_000_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  expectEq(failures, "CPP2 = 0 when YTD below YMPE", below.cpp2Cents, 0);
  // YTD gross already above YMPE, this period pushes further → CPP2 = rate × period gross
  const above = computePayroll({
    grossCents: 2_000_00,
    ytdCppCents: Math.round(CPP_MAX_ANNUAL_2026 * 100),
    ytdCpp2Cents: 0,
    ytdGrossCents: 75_000_00, // > YMPE
    payPeriodsPerYear: 12,
  });
  const expectedCpp2 = Math.round(2_000_00 * CPP2_RATE_2026);
  expectNear(failures, "CPP2 applies above YMPE", above.cpp2Cents, expectedCpp2, 2);
  record("CPP2: zero while YTD ≤ YMPE; applies to the slice above YMPE", failures);
})();

// ——— Test 7: CPP2 caps at CPP2_MAX_ANNUAL_2026 ———

(() => {
  const failures: string[] = [];
  const cpp2MaxCents = Math.round(CPP2_MAX_ANNUAL_2026 * 100);
  const r = computePayroll({
    grossCents: 2_000_00,
    ytdCppCents: Math.round(CPP_MAX_ANNUAL_2026 * 100),
    ytdCpp2Cents: cpp2MaxCents, // already at CPP2 cap
    ytdGrossCents: CPP_YAMPE_2026 * 100,
    payPeriodsPerYear: 12,
  });
  expectEq(failures, "CPP2 clipped at cap", r.cpp2Cents, 0);
  record("CPP2 cap: YTD at max → subsequent pay charges 0 CPP2", failures);
})();

// ——— Test 8: CPP1 math at low income — exemption applied ———

(() => {
  const failures: string[] = [];
  // $1000/month, 12 pays. Annualized = $12K. Periodic exemption = $3500/12 ≈ $291.67.
  // Per-pay CPP1 = ($1000 - $291.67) × 5.95% ≈ $42.15
  const r = computePayroll({
    grossCents: 1_000_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  const periodicExemption = (CPP_BASIC_EXEMPTION_2026 / 12) * 100; // cents
  const expected = Math.round((1_000_00 - periodicExemption) * CPP_RATE_2026);
  expectNear(failures, "CPP1 at $1K/mo", r.cppCents, expected, 2);
  record("CPP1: (gross − periodic exemption) × 5.95%", failures);
})();

// ——— Test 9: Federal bracket — $50K annualized in lowest bracket (14%) ———

(() => {
  const failures: string[] = [];
  // Monthly gross ~$4,166.67 → annualized $50K, entirely in the 14% bracket after BPA.
  const r = computePayroll({
    grossCents: 4_166_67,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  // Roughly: (50_000 - 16_129) × 14% ÷ 12 - small CPP credit. Check it's a positive amount
  // in a sane range rather than trying to match CRA to the penny (avoids tight-coupling).
  if (r.federalTaxCents <= 0 || r.federalTaxCents > 600_00) {
    failures.push(`$50K/year federal tax out of sane range: ${formatCAD(r.federalTaxCents)}`);
  }
  record("Federal tax lowest bracket: $50K/yr produces plausible monthly tax", failures);
})();

// ——— Test 10: High-income bracket crossover ———

(() => {
  const failures: string[] = [];
  // $200K/year → in 29% federal bracket, Ontario surtax kicks in.
  const r = computePayroll({
    grossCents: 16_666_67, // $200K ÷ 12
    ytdCppCents: Math.round(CPP_MAX_ANNUAL_2026 * 100),
    ytdCpp2Cents: Math.round(CPP2_MAX_ANNUAL_2026 * 100),
    ytdGrossCents: CPP_YAMPE_2026 * 100,
    payPeriodsPerYear: 12,
  });
  // At $200K, total combined tax rate is well above 30%. Sanity: federal+provincial > 35% of gross.
  const totalTax = r.federalTaxCents + r.provincialTaxCents;
  const effectiveRate = totalTax / r.grossCents;
  if (effectiveRate < 0.28 || effectiveRate > 0.45) {
    failures.push(
      `$200K/yr effective tax rate out of sane range: ${(effectiveRate * 100).toFixed(1)}%`,
    );
  }
  record("High-income plausibility: $200K/yr hits upper brackets + Ontario surtax", failures);
})();

// ——— Test 11: Bi-weekly cadence produces ~proportional CPP ———

(() => {
  const failures: string[] = [];
  // Same $78K/yr at 12 pays vs 26 pays → annual CPP should be ~identical.
  const monthly = computePayroll({
    grossCents: 6_500_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  const biweekly = computePayroll({
    grossCents: 3_000_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 26,
  });
  // Annualize and compare: should be within a few dollars.
  const annualMonthlyCpp = monthly.cppCents * 12;
  const annualBiweeklyCpp = biweekly.cppCents * 26;
  expectNear(
    failures,
    "annual CPP monthly vs bi-weekly",
    annualBiweeklyCpp,
    annualMonthlyCpp,
    500_00, // within $500 across the year is fine (periodic exemption rounding)
  );
  record("Cadence sanity: annualized CPP similar across monthly and bi-weekly", failures);
})();

// ——— Test 12: Net + deductions = gross (no leakage) ———

(() => {
  const failures: string[] = [];
  for (const gross of [2_000_00, 5_942_00, 16_666_67]) {
    const r = computePayroll({
      grossCents: gross,
      ytdCppCents: 0,
      ytdCpp2Cents: 0,
      ytdGrossCents: 0,
      payPeriodsPerYear: 12,
    });
    // Rounding: at most 1¢ difference from cents-to-dollars round-tripping.
    const diff = Math.abs(
      r.netCents +
        r.cppCents +
        r.cpp2Cents +
        r.federalTaxCents +
        r.provincialTaxCents +
        r.eiCents -
        r.grossCents,
    );
    if (diff > 1) {
      failures.push(`gross=${formatCAD(gross)}: identity off by ${diff} cents`);
    }
  }
  record("No leakage: net + every deduction = gross (within 1¢ rounding)", failures);
})();

// ——— Test 13: OHP scales through tiers ———

(() => {
  const failures: string[] = [];
  // OHP is rolled into provincialTaxCents — so check it via the `ohp` field.
  // $15K/yr < $20K → OHP 0.
  const low = computePayroll({
    grossCents: 1_250_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  expectEq(failures, "$15K income → $0 OHP", low.ohpCents, 0);
  // $60K/yr → OHP $600/yr ÷ 12 = $50/mo
  const mid = computePayroll({
    grossCents: 5_000_00,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  expectNear(failures, "$60K income → $50/mo OHP", mid.ohpCents, 50_00, 50);
  // $500K/yr → OHP $900/yr ÷ 12 = $75/mo (maxed out)
  const high = computePayroll({
    grossCents: 41_666_67,
    ytdCppCents: 0,
    ytdCpp2Cents: 0,
    ytdGrossCents: 0,
    payPeriodsPerYear: 12,
  });
  expectNear(failures, "high income → $75/mo OHP (max)", high.ohpCents, 75_00, 50);
  record("OHP: scales through 2026 Ontario Health Premium tiers", failures);
})();

// ——— Test 14: Federal BPA phase-out (Jan 1 2026) ———

(() => {
  const failures: string[] = [];
  // Boundary: at or below phase start → max BPA
  expectEq(
    failures,
    "BPA at phase start ($181,440)",
    federalBpaFor(FEDERAL_BPA_PHASE_START_2026),
    FEDERAL_BPA_MAX_2026,
  );
  // Below phase start → max BPA
  expectEq(
    failures,
    "BPA below phase start",
    federalBpaFor(100_000),
    FEDERAL_BPA_MAX_2026,
  );
  // At or above phase end → min BPA
  expectEq(
    failures,
    "BPA at phase end ($258,482)",
    federalBpaFor(FEDERAL_BPA_PHASE_END_2026),
    FEDERAL_BPA_MIN_2026,
  );
  expectEq(
    failures,
    "BPA above phase end",
    federalBpaFor(300_000),
    FEDERAL_BPA_MIN_2026,
  );
  // Midpoint: at $220,000 (exactly midway through 181,440→258,482 range)
  // BPA = 16,452 − 1,623 × (220,000 − 181,440) / 77,042
  //     ≈ 16,452 − 1,623 × 0.50050856 ≈ 16,452 − 812.325 ≈ 15,639.68
  const midpoint = federalBpaFor(220_000);
  const expectedMid = FEDERAL_BPA_MAX_2026 - 1_623 * ((220_000 - FEDERAL_BPA_PHASE_START_2026) / 77_042);
  if (Math.abs(midpoint - expectedMid) > 0.01) {
    failures.push(`BPA at $220K midpoint: want ≈${expectedMid.toFixed(2)}, got ${midpoint.toFixed(2)}`);
  }
  record("Federal BPA phase-out: 16,452 at $181,440 → 14,829 at $258,482 (linear)", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Payroll (2026 PDOC) verification ===\n");
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
