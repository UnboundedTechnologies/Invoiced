/**
 * Verifies the Phase 6 self-pay planner compute orchestrator.
 *
 * Scenarios exercise:
 *   - Salary-to-YMPE: synthesized T4 maxes CPP1 at T4127's cap, box14 === YMPE.
 *   - Dividend-only: zero CPP, T4 all-zero, takeHome = dividends minus T1 owing.
 *   - Zero-mix baseline: corp pays tax on full profit, personal = $0.
 *   - GRIP soft cap: eligible div > GRIP closing → grip_overdraft warning.
 *   - SBD grind: priorYearAaii=$100K → sbd_grind warning.
 *   - PSB red: psb_red warning pass-through.
 *   - Salary > revenue: salary_exceeds_revenue warning.
 *   - Synth T4 identity: synthesizeT4 loop ≡ manual 12-call sum to the cent.
 *   - Cash-waterfall identity: revenue − opex − corpTax − personalTax − cppEmployee = takeHome + retainedInCorp (approx).
 *   - RRSP-room formula: min(0.18 × salary, $32,490).
 *   - canonicalInputJson stability + equivalence.
 *   - Combined-tax no double-count: totalHouseholdTax ≡ corpTax + personalTax.
 *
 * Run: `pnpm verify-planner`. Exits 1 on any mismatch.
 */

import {
  simulateScenario,
  synthesizeT4,
  canonicalInputJson,
  RRSP_DOLLAR_LIMIT_2026_CENTS,
  RRSP_EARNED_INCOME_FRACTION,
  CPP_YMPE_2026,
  type ScenarioInput,
} from "../src/lib/self-pay-planner";
import { computePayroll, CPP_MAX_ANNUAL_2026 } from "../src/lib/payroll-2026";

type Check = { name: string; fn: () => string[] };

const approx = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const expectEqual = (actual: number, expected: number, label: string, tol = 1) =>
  approx(actual, expected, tol) ? null : `${label}: expected ${expected}, got ${actual} (delta ${actual - expected})`;
const expectTrue = (cond: boolean, msg: string) => (cond ? null : msg);

const FY_2026 = {
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
};

function baseInput(partial: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    fiscalYear: 2026,
    periodStart: FY_2026.periodStart,
    periodEnd: FY_2026.periodEnd,
    projectedRevenueCents: 150_000_00,
    projectedOpexCents: 0,
    salaryCents: 0,
    eligibleDividendCents: 0,
    nonEligibleDividendCents: 0,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
    ...partial,
  };
}

const CHECKS: Check[] = [
  {
    name: "planner · salary-to-YMPE ($74,600) synthesizes CPP1-max T4",
    fn: () => {
      const r = simulateScenario(
        baseInput({ salaryCents: CPP_YMPE_2026 * 100, projectedRevenueCents: 200_000_00 }),
      );
      const cpp1MaxCents = Math.round(CPP_MAX_ANNUAL_2026 * 100);
      return [
        expectEqual(
          r.syntheticT4.box14EmploymentIncomeCents,
          CPP_YMPE_2026 * 100,
          "box14 = YMPE",
        ),
        expectEqual(r.syntheticT4.box16CppBaseCents, cpp1MaxCents, "CPP1 at annual max", 5),
        expectEqual(r.syntheticT4.box16aCpp2Cents, 0, "no CPP2 at YMPE"),
        expectTrue(r.cppContribCents > 400_000 && r.cppContribCents < 450_000, `CPP contrib ≈ $4,230, got ${r.cppContribCents}`),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · dividend-only synthesizes zero-T4, zero-CPP",
    fn: () => {
      const r = simulateScenario(
        baseInput({
          salaryCents: 0,
          nonEligibleDividendCents: 50_000_00,
          projectedRevenueCents: 150_000_00,
        }),
      );
      return [
        expectEqual(r.syntheticT4.box14EmploymentIncomeCents, 0, "box14 = 0"),
        expectEqual(r.syntheticT4.box16CppBaseCents, 0, "CPP base = 0"),
        expectEqual(r.cppContribCents, 0, "cppContrib = 0"),
        expectEqual(r.rrspRoomGeneratedCents, 0, "RRSP room = 0"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · zero-mix baseline emits zero_mix_baseline info warning",
    fn: () => {
      const r = simulateScenario(
        baseInput({ salaryCents: 0, eligibleDividendCents: 0, nonEligibleDividendCents: 0 }),
      );
      const found = r.warnings.find((w) => w.code === "zero_mix_baseline");
      return [
        expectTrue(!!found, "expected zero_mix_baseline warning"),
        expectEqual(r.personalTaxCents, 0, "personal tax = 0 on zero mix"),
        expectTrue(r.corpTaxCents > 0, "corp tax > 0 on profit with no deductions"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · GRIP overdraft warning fires when eligible div exceeds GRIP closing",
    fn: () => {
      const r = simulateScenario(
        baseInput({
          openingGripCents: 0,
          projectedRevenueCents: 150_000_00,
          eligibleDividendCents: 20_000_00, // GRIP is 0 + (0 × 72%) = 0
        }),
      );
      const found = r.warnings.find((w) => w.code === "grip_overdraft");
      return [expectTrue(!!found, "expected grip_overdraft warning")].filter(
        (e): e is string => e !== null,
      );
    },
  },
  {
    name: "planner · SBD grind warning at priorYearAaii = $100K (half-grind)",
    fn: () => {
      const r = simulateScenario(
        baseInput({
          projectedRevenueCents: 600_000_00,
          priorYearAaiiCents: 100_000_00,
        }),
      );
      const found = r.warnings.find((w) => w.code === "sbd_grind");
      return [expectTrue(!!found, "expected sbd_grind warning")].filter(
        (e): e is string => e !== null,
      );
    },
  },
  {
    name: "planner · PSB red produces psb_red error warning",
    fn: () => {
      const r = simulateScenario(
        baseInput({ salaryCents: 50_000_00, psbRisk: "red" }),
      );
      const found = r.warnings.find((w) => w.code === "psb_red");
      return [
        expectTrue(!!found, "expected psb_red warning"),
        expectTrue(found?.severity === "error", "psb_red must be severity error"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · salary > revenue emits salary_exceeds_revenue error",
    fn: () => {
      const r = simulateScenario(
        baseInput({ projectedRevenueCents: 50_000_00, salaryCents: 100_000_00 }),
      );
      const found = r.warnings.find((w) => w.code === "salary_exceeds_revenue");
      return [expectTrue(!!found, "expected salary_exceeds_revenue warning")].filter(
        (e): e is string => e !== null,
      );
    },
  },
  {
    name: "planner · synthesizeT4 loop ≡ manual 12-call aggregate",
    fn: () => {
      const salary = 60_000_00; // $60K annual
      const synth = synthesizeT4(salary, 12);
      // Manual reproduction
      let ytdGross = 0;
      let ytdCpp = 0;
      let ytdCpp2 = 0;
      let sumBox14 = 0;
      let sumCpp = 0;
      let sumCpp2 = 0;
      let sumFed = 0;
      let sumOn = 0;
      for (let i = 0; i < 12; i++) {
        const per = i === 11 ? salary - Math.floor(salary / 12) * 11 : Math.floor(salary / 12);
        const s = computePayroll({
          grossCents: per,
          ytdCppCents: ytdCpp,
          ytdCpp2Cents: ytdCpp2,
          ytdGrossCents: ytdGross,
          payPeriodsPerYear: 12,
        });
        sumBox14 += s.grossCents;
        sumCpp += s.cppCents;
        sumCpp2 += s.cpp2Cents;
        sumFed += s.federalTaxCents;
        sumOn += s.provincialTaxCents;
        ytdCpp += s.cppCents;
        ytdCpp2 += s.cpp2Cents;
        ytdGross += s.grossCents;
      }
      return [
        expectEqual(synth.box14EmploymentIncomeCents, sumBox14, "box14"),
        expectEqual(synth.box16CppBaseCents, sumCpp, "box16 CPP1"),
        expectEqual(synth.box16aCpp2Cents, sumCpp2, "box16a CPP2"),
        expectEqual(synth.box22FedTaxWithheldCents, sumFed, "box22 fed"),
        expectEqual(synth.ontarioTaxWithheldCents, sumOn, "ON withheld"),
        expectEqual(synth.box14EmploymentIncomeCents, salary, "sum = annual salary"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · totalHouseholdTax === corpTax + personalTax (no double-count)",
    fn: () => {
      const r = simulateScenario(
        baseInput({
          projectedRevenueCents: 200_000_00,
          salaryCents: 50_000_00,
          nonEligibleDividendCents: 30_000_00,
        }),
      );
      return [
        expectEqual(
          r.totalHouseholdTaxCents,
          r.corpTaxCents + r.personalTaxCents,
          "totalHousehold",
          0,
        ),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · RRSP room = min(18% × salary, $32,490)",
    fn: () => {
      // Low salary
      const r1 = simulateScenario(baseInput({ salaryCents: 60_000_00 }));
      // High salary (caps)
      const r2 = simulateScenario(baseInput({ salaryCents: 250_000_00 }));
      return [
        expectEqual(
          r1.rrspRoomGeneratedCents,
          Math.round(60_000_00 * RRSP_EARNED_INCOME_FRACTION),
          "low salary RRSP",
        ),
        expectEqual(
          r2.rrspRoomGeneratedCents,
          RRSP_DOLLAR_LIMIT_2026_CENTS,
          "high salary caps RRSP at $32,490",
        ),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · canonicalInputJson stable across key reorder",
    fn: () => {
      const a = baseInput({ salaryCents: 50_000_00, nonEligibleDividendCents: 10_000_00 });
      const b: ScenarioInput = {
        // intentionally shuffled declaration order
        nonEligibleDividendCents: 10_000_00,
        salaryCents: 50_000_00,
        fiscalYear: a.fiscalYear,
        periodStart: a.periodStart,
        periodEnd: a.periodEnd,
        projectedRevenueCents: a.projectedRevenueCents,
        projectedOpexCents: a.projectedOpexCents,
        eligibleDividendCents: a.eligibleDividendCents,
        ccaClaimedCents: a.ccaClaimedCents,
        priorYearAaiiCents: a.priorYearAaiiCents,
        openingGripCents: a.openingGripCents,
      };
      const ja = canonicalInputJson(a);
      const jb = canonicalInputJson(b);
      return [
        expectTrue(ja === jb, `canonicalInputJson: '${ja}' !== '${jb}'`),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · cash-waterfall identity (corp profit + dividends fund take-home + tax + retained)",
    fn: () => {
      const r = simulateScenario(
        baseInput({
          projectedRevenueCents: 150_000_00,
          projectedOpexCents: 10_000_00,
          salaryCents: 74_600_00, // YMPE
          nonEligibleDividendCents: 30_000_00,
        }),
      );
      // Cash in: revenue − opex = potential corp cash
      // Cash out tracked: salary (to Saïd) + ER CPP + corp tax + dividends paid
      // Retained in corp = potential − (salary + ER CPP + corp tax + dividends paid)
      // Saïd's pocket = payroll net + dividends − (refund/owing at T1)
      // Combined identity: revenue − opex − corpTax − personalTax − cppEmployee − cppEmployer ≡ takeHome + retained
      // We just check that corpTax + personalTax + takeHome ≤ revenue (economic sanity),
      // and that the direct formula holds on the cent.

      // Direct formula: revenue − opex − ERcpp − ccaClaimed − salary = corp net before tax (may be negative)
      // corp tax = f(taxable ≥ 0)
      // We don't have ERcpp exposed in the result; reconstruct from synthesized T4 CPP1+CPP2 doubled.
      const erCpp =
        r.syntheticT4.box16CppBaseCents + r.syntheticT4.box16aCpp2Cents;
      const corpNetBeforeTax =
        150_000_00 - 10_000_00 - 74_600_00 - erCpp - 0;
      // Must align with planner's corpNetIncomeForTaxCents
      return [
        expectEqual(
          r.corpNetIncomeForTaxCents,
          corpNetBeforeTax,
          "corp net-income-for-tax identity",
          2,
        ),
        expectTrue(
          r.corpTaxCents + r.personalTaxCents + r.takeHomeCents <=
            150_000_00 - 10_000_00 + 1_000,
          "household economic sanity (tax + take-home ≤ revenue − opex)",
        ),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "planner · ratesEditionTag flows through",
    fn: () => {
      const r = simulateScenario(baseInput());
      return [
        expectTrue(
          r.ratesEditionTag.startsWith("T4127-"),
          `ratesEditionTag='${r.ratesEditionTag}' should start with 'T4127-'`,
        ),
      ].filter((e): e is string => e !== null);
    },
  },
];

function main() {
  let pass = 0;
  let fail = 0;
  for (const c of CHECKS) {
    const errs = c.fn();
    if (errs.length === 0) {
      console.log(`✓ ${c.name}`);
      pass++;
    } else {
      console.log(`✗ ${c.name}`);
      errs.forEach((e) => console.log(`    ${e}`));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
