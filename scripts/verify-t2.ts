/**
 * Verifies the T2 compute engine + CCA pool engine + tax pools (GRIP, RDTOH,
 * CDA) with canonical scenarios. Mirrors the verify-hst shape.
 *
 * Scenarios cover: vanilla SBD, over-SBD spill to general rate, Ontario rate
 * straddling 2026-07-01, SBD grind (floor/partial/ceiling), non-CCPC,
 * CCA Class 50 half-year, CCA Class 12 no half-year, claim-fraction 50%,
 * second-year pool, GRIP addition/used/overdraft, NERDTOH addition+refund,
 * NERDTOH spill to ERDTOH, eligible dividend exceeds ERDTOH, CDA with gain
 * + election + overage, estimateT2 façade coherence, seed-zero case.
 *
 * Run: `pnpm verify-t2`. Fails the process (exit 1) on any mismatch.
 */

import {
  estimateT2Detailed,
  SBD_BUSINESS_LIMIT_CENTS,
} from "../src/lib/t2";
import { estimateT2 } from "../src/lib/dashboard-metrics";
import { buildCcaPools, totalCcaClaimed, CLASS_RATE_BPS } from "../src/lib/cca";
import {
  computeGrip,
  computeRdtoh,
  computeCda,
} from "../src/lib/tax-pools";
import { ontarioSmallBizRate } from "../src/lib/t2-rates";

type Check = { name: string; fn: () => string[] };

const approx = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const expectEqual = (actual: number, expected: number, label: string, tol = 1) =>
  approx(actual, expected, tol) ? null : `${label}: expected ${expected}, got ${actual}`;
const expectTrue = (cond: boolean, msg: string) => (cond ? null : msg);

const CHECKS: Check[] = [
  {
    name: "T2 · vanilla CCPC FY2026 Dec-31 FYE, ABI $100K → SBD only, ≈ 11-12% combined",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 100_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 0,
      });
      const errs: (string | null)[] = [
        expectEqual(r.taxableIncomeCents, 100_000_00, "taxable"),
        expectEqual(r.sbdEligibleCents, 100_000_00, "sbdEligible"),
        expectEqual(r.fullRateIncomeCents, 0, "fullRate"),
        expectEqual(r.fedTaxCents, 9_000_00, "fed"),
        // Ontario blended: period straddles 2026-07-01. FY2026 full year:
        // 181 days at 3.2% + 184 days at 2.2% = (181*3.2 + 184*2.2)/365 ≈ 2.696%
        expectTrue(
          r.ontarioBlendedSbdRateBps >= 269 && r.ontarioBlendedSbdRateBps <= 270,
          `ontarioBlendedSbdRateBps expected 269-270, got ${r.ontarioBlendedSbdRateBps}`,
        ),
      ];
      return errs.filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · over-SBD spill → fed 9% + 15%, ON blended SBD + 11.5% general",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 600_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 0,
      });
      return [
        expectEqual(r.sbdEligibleCents, SBD_BUSINESS_LIMIT_CENTS, "sbdEligible"),
        expectEqual(r.fullRateIncomeCents, 100_000_00, "fullRate"),
        expectEqual(r.fedSbdPortionCents, 45_000_00, "fedSbdPortion"),
        expectEqual(r.fedGeneralPortionCents, 15_000_00, "fedGeneralPortion"),
        expectEqual(r.ontarioGeneralPortionCents, 11_500_00, "onGeneralPortion"),
        expectTrue(r.warnings.some((w) => w.includes("SBD limit")), "expected SBD limit warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · Ontario rate pre-transition: FY ending 2026-06-30 → 3.2% flat",
    fn: () => {
      const rate = ontarioSmallBizRate("2025-07-01", "2026-06-30");
      return [expectTrue(Math.abs(rate - 0.032) < 1e-6, `expected 0.032, got ${rate}`)].filter(
        (e): e is string => e !== null,
      );
    },
  },
  {
    name: "T2 · Ontario rate post-transition: FY 2027 → 2.2% flat",
    fn: () => {
      const rate = ontarioSmallBizRate("2027-01-01", "2027-12-31");
      return [expectTrue(Math.abs(rate - 0.022) < 1e-6, `expected 0.022, got ${rate}`)].filter(
        (e): e is string => e !== null,
      );
    },
  },
  {
    name: "T2 · SBD grind floor: priorAAII $50K → no grind",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 400_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 50_000_00,
      });
      return [
        expectEqual(r.sbdGrindCents, 0, "sbdGrind"),
        expectEqual(r.sbdLimitAfterGrindCents, SBD_BUSINESS_LIMIT_CENTS, "sbdLimitAfterGrind"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · SBD grind partial: priorAAII $75K → $125K grind, limit $375K",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 400_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 75_000_00,
      });
      // grindFraction = (75k-50k)/(150k-50k) = 25k/100k = 0.25
      // grind = 500k × 0.25 = $125k
      return [
        expectEqual(r.sbdGrindCents, 125_000_00, "sbdGrind"),
        expectEqual(r.sbdLimitAfterGrindCents, 375_000_00, "sbdLimitAfterGrind"),
        expectEqual(r.sbdEligibleCents, 375_000_00, "sbdEligible"),
        expectEqual(r.fullRateIncomeCents, 25_000_00, "fullRate"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · SBD grind ceiling: priorAAII $150K → SBD fully ground out, all income at general rate",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 400_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 150_000_00,
      });
      return [
        expectEqual(r.sbdGrindCents, SBD_BUSINESS_LIMIT_CENTS, "sbdGrind"),
        expectEqual(r.sbdLimitAfterGrindCents, 0, "sbdLimitAfterGrind"),
        expectEqual(r.sbdEligibleCents, 0, "sbdEligible"),
        expectEqual(r.fullRateIncomeCents, 400_000_00, "fullRate"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · non-CCPC → no SBD, all income at 15% fed + 11.5% ON",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2027-01-01",
        periodEnd: "2027-12-31",
        isCcpc: false,
        revenueCents: 200_000_00,
        operatingExpensesCents: 0,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 0,
      });
      return [
        expectEqual(r.sbdEligibleCents, 0, "sbdEligible"),
        expectEqual(r.fullRateIncomeCents, 200_000_00, "fullRate"),
        expectEqual(r.fedTaxCents, 30_000_00, "fed"),
        expectEqual(r.ontarioTaxCents, 23_000_00, "on"),
        expectTrue(r.warnings.some((w) => w.includes("Not a CCPC")), "expected non-CCPC warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · CCA claimed reduces taxable income below revenue",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 100_000_00,
        operatingExpensesCents: 10_000_00,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 2_000_00,
        priorYearAaiiCents: 0,
      });
      return [
        expectEqual(r.netIncomeForTaxCents, 88_000_00, "net"),
        expectEqual(r.taxableIncomeCents, 88_000_00, "taxable"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "T2 · loss floor: expenses > revenue → taxable = 0, zero tax",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 50_000_00,
        operatingExpensesCents: 70_000_00,
        salaryCents: 0,
        employerCppCents: 0,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 0,
      });
      return [
        expectEqual(r.netIncomeForTaxCents, -20_000_00, "net (negative ok)"),
        expectEqual(r.taxableIncomeCents, 0, "taxable"),
        expectEqual(r.totalTaxCents, 0, "total"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · Class 50 first year, $3000 laptop, half-year → $825 CCA, closing UCC $2175",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          {
            class: "50",
            classRateBps: CLASS_RATE_BPS["50"],
            acquisitionCostCents: 3_000_00,
            businessUsePercent: 100,
            halfYearRuleApplies: true,
            description: "MacBook",
          },
        ],
      });
      const row = rows.find((r) => r.class === "50")!;
      return [
        expectEqual(row.additionsCents, 3_000_00, "additions"),
        expectEqual(row.halfYearAdjustmentCents, 1_500_00, "halfYearAdj"),
        expectEqual(row.ccaBaseCents, 1_500_00, "ccaBase"),
        expectEqual(row.ccaClaimedCents, 825_00, "ccaClaimed"),
        expectEqual(row.closingUccCents, 2_175_00, "closingUcc"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · Class 12 $400 software, no half-year → $400 CCA, closing UCC $0",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          {
            class: "12",
            classRateBps: CLASS_RATE_BPS["12"],
            acquisitionCostCents: 400_00,
            businessUsePercent: 100,
            halfYearRuleApplies: false,
            description: "App license",
          },
        ],
      });
      const row = rows.find((r) => r.class === "12")!;
      return [
        expectEqual(row.halfYearAdjustmentCents, 0, "halfYearAdj"),
        expectEqual(row.ccaBaseCents, 400_00, "ccaBase"),
        expectEqual(row.ccaClaimedCents, 400_00, "ccaClaimed"),
        expectEqual(row.closingUccCents, 0, "closingUcc"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · claim fraction 50% on Class 50 → half the max, rest preserved in UCC",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          {
            class: "50",
            classRateBps: CLASS_RATE_BPS["50"],
            acquisitionCostCents: 3_000_00,
            businessUsePercent: 100,
            halfYearRuleApplies: true,
            description: "MacBook",
          },
        ],
        claimFractionBpsPerClass: { "50": 5_000 },
      });
      const row = rows.find((r) => r.class === "50")!;
      return [
        expectEqual(row.ccaClaimedCents, 412_50, "ccaClaimed ~half of 825"),
        expectEqual(row.closingUccCents, 3_000_00 - 412_50, "closingUcc"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · second-year pool: opening UCC $2175, no additions → $1196 CCA, no half-year",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [
          { class: "50", classRateBps: CLASS_RATE_BPS["50"], openingUccCents: 2_175_00 },
        ],
        additions: [],
      });
      const row = rows.find((r) => r.class === "50")!;
      // 2175 × 55% = 1196.25 → 1196 cents after rounding
      return [
        expectEqual(row.halfYearAdjustmentCents, 0, "no half-year on brought-fwd UCC"),
        expectEqual(row.ccaBaseCents, 2_175_00, "ccaBase"),
        expectEqual(row.ccaClaimedCents, 1_196_25, "ccaClaimed"),
        expectEqual(row.closingUccCents, 2_175_00 - 1_196_25, "closingUcc"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · business use 50% → acquisition cost halved in the pool",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          {
            class: "10",
            classRateBps: CLASS_RATE_BPS["10"],
            acquisitionCostCents: 10_000_00,
            businessUsePercent: 50,
            halfYearRuleApplies: true,
            description: "Shared laptop",
          },
        ],
      });
      const row = rows.find((r) => r.class === "10")!;
      return [
        expectEqual(row.additionsCents, 5_000_00, "additions (biz-use adjusted)"),
        expectEqual(row.ccaBaseCents, 2_500_00, "ccaBase (half-year)"),
        expectEqual(row.ccaClaimedCents, 750_00, "ccaClaimed 30%"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · Class 10.1 $50K vehicle → capped at $38K, warning emitted",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          {
            class: "10.1",
            classRateBps: CLASS_RATE_BPS["10.1"],
            acquisitionCostCents: 50_000_00,
            businessUsePercent: 100,
            halfYearRuleApplies: true,
            description: "Tesla",
          },
        ],
      });
      const row = rows.find((r) => r.class === "10.1")!;
      return [
        expectEqual(row.additionsCents, 38_000_00, "cost cap at 38K"),
        expectTrue(row.warnings.some((w) => w.includes("capped")), "expected cap warning"),
        expectTrue(row.warnings.some((w) => w.includes("separate pool")), "expected separate-pool warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CCA · total across pools via totalCcaClaimed",
    fn: () => {
      const rows = buildCcaPools({
        openingPools: [],
        additions: [
          { class: "50", classRateBps: CLASS_RATE_BPS["50"], acquisitionCostCents: 3_000_00, businessUsePercent: 100, halfYearRuleApplies: true, description: null },
          { class: "12", classRateBps: CLASS_RATE_BPS["12"], acquisitionCostCents: 400_00, businessUsePercent: 100, halfYearRuleApplies: false, description: null },
        ],
      });
      return [
        expectEqual(totalCcaClaimed(rows), 825_00 + 400_00, "total CCA"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "GRIP · addition = 72% of full-rate income, pure SBD → 0",
    fn: () => {
      const pureSbd = computeGrip({ openingCents: 0, fullRateIncomeCents: 0, eligibleDividendsPaidCents: 0 });
      const overSbd = computeGrip({ openingCents: 0, fullRateIncomeCents: 100_000_00, eligibleDividendsPaidCents: 0 });
      return [
        expectEqual(pureSbd.additionCents, 0, "pureSbd.addition"),
        expectEqual(overSbd.additionCents, 72_000_00, "overSbd.addition = 72% × 100k"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "GRIP · used eligible dividends, closing reflects remainder",
    fn: () => {
      const r = computeGrip({ openingCents: 72_000_00, fullRateIncomeCents: 0, eligibleDividendsPaidCents: 50_000_00 });
      return [
        expectEqual(r.usedCents, 50_000_00, "used"),
        expectEqual(r.closingCents, 22_000_00, "closing"),
        expectEqual(r.overdraftCents, 0, "no overdraft"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "GRIP · overdraft: eligible dividend > GRIP → Part III.1 warning",
    fn: () => {
      const r = computeGrip({ openingCents: 0, fullRateIncomeCents: 10_000_00, eligibleDividendsPaidCents: 20_000_00 });
      return [
        expectEqual(r.additionCents, 7_200_00, "addition"),
        expectEqual(r.usedCents, 7_200_00, "used capped at available"),
        expectEqual(r.overdraftCents, 12_800_00, "overdraft"),
        expectTrue(r.warnings.some((w) => w.includes("Part III.1")), "expected Part III.1 warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "RDTOH · Saïd FY2026 zero case → all pools untouched",
    fn: () => {
      const r = computeRdtoh({
        erdtohOpeningCents: 0, nerdtohOpeningCents: 0,
        aaiiCents: 0, partIVOnEligibleCents: 0, partIVOnNonEligibleCents: 0,
        eligibleDividendsPaidCents: 50_000_00, nonEligibleDividendsPaidCents: 0,
      });
      return [
        expectEqual(r.erdtoh.closingCents, 0, "erdtoh closing 0"),
        expectEqual(r.nerdtoh.closingCents, 0, "nerdtoh closing 0"),
        expectEqual(r.dividendRefundCents, 0, "no refund with empty pools"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "RDTOH · AAII $10K → NERDTOH addition ≈ $3067, non-elig div $20K refunds $3067",
    fn: () => {
      const r = computeRdtoh({
        erdtohOpeningCents: 0, nerdtohOpeningCents: 0,
        aaiiCents: 10_000_00, partIVOnEligibleCents: 0, partIVOnNonEligibleCents: 0,
        eligibleDividendsPaidCents: 0, nonEligibleDividendsPaidCents: 20_000_00,
      });
      return [
        expectEqual(r.nerdtoh.additionCents, 3_067_00, "nerdtoh addition 30.67%"),
        expectEqual(r.nerdtoh.refundCents, 3_067_00, "nerdtoh refund = full pool"),
        expectEqual(r.dividendRefundCents, 3_067_00, "dividend refund"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "RDTOH · non-elig div spills NERDTOH into ERDTOH",
    fn: () => {
      const r = computeRdtoh({
        erdtohOpeningCents: 5_000_00, nerdtohOpeningCents: 2_000_00,
        aaiiCents: 0, partIVOnEligibleCents: 0, partIVOnNonEligibleCents: 0,
        eligibleDividendsPaidCents: 0, nonEligibleDividendsPaidCents: 20_000_00,
      });
      // 38.33% × 20k = 7666 cents; NERDTOH 2000 used fully → remaining 5666 spills
      // to ERDTOH (capped at 5000); leftover 666 is unrefunded.
      return [
        expectEqual(r.nerdtoh.refundCents, 2_000_00, "nerdtoh spent"),
        expectEqual(r.nerdtoh.closingCents, 0, "nerdtoh closing 0"),
        expectEqual(r.erdtoh.refundCents, 5_000_00, "erdtoh spent to cap"),
        expectEqual(r.erdtoh.closingCents, 0, "erdtoh closing 0"),
        expectEqual(r.dividendRefundCents, 7_000_00, "total refund"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "RDTOH · eligible div only draws from ERDTOH, not NERDTOH",
    fn: () => {
      const r = computeRdtoh({
        erdtohOpeningCents: 0, nerdtohOpeningCents: 10_000_00,
        aaiiCents: 0, partIVOnEligibleCents: 0, partIVOnNonEligibleCents: 0,
        eligibleDividendsPaidCents: 20_000_00, nonEligibleDividendsPaidCents: 0,
      });
      return [
        expectEqual(r.erdtoh.refundCents, 0, "no ERDTOH to draw"),
        expectEqual(r.nerdtoh.closingCents, 10_000_00, "NERDTOH untouched"),
        expectEqual(r.dividendRefundCents, 0, "no refund"),
        expectTrue(r.warnings.some((w) => w.includes("ERDTOH")), "expected no-ERDTOH warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CDA · $10K capital gain → $5K addition; elect $5K → closing 0",
    fn: () => {
      const r = computeCda({
        openingCents: 0,
        capitalGainsNetCents: 10_000_00,
        capitalDividendsReceivedCents: 0,
        lifeInsuranceProceedsCents: 0,
        capitalDividendsElectedCents: 5_000_00,
      });
      return [
        expectEqual(r.additionCents, 5_000_00, "addition = 50% of gain"),
        expectEqual(r.usedCents, 5_000_00, "used"),
        expectEqual(r.closingCents, 0, "closing"),
        expectTrue(r.warnings.some((w) => w.includes("T2054")), "expected T2054 warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "CDA · election exceeds balance → Part III warning",
    fn: () => {
      const r = computeCda({
        openingCents: 1_000_00,
        capitalGainsNetCents: 0,
        capitalDividendsReceivedCents: 0,
        lifeInsuranceProceedsCents: 0,
        capitalDividendsElectedCents: 5_000_00,
      });
      return [
        expectEqual(r.usedCents, 1_000_00, "used capped at available"),
        expectTrue(r.warnings.some((w) => w.includes("Part III")), "expected Part III warning"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "Façade · estimateT2 matches estimateT2Detailed for a vanilla input",
    fn: () => {
      const input = {
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        revenueCents: 150_000_00,
        operatingExpensesCents: 20_000_00,
        salaryCents: 50_000_00,
        employerCppCents: 2_000_00,
      };
      const facade = estimateT2(input);
      const detailed = estimateT2Detailed({
        ...input,
        isCcpc: true,
        ccaClaimedCents: 0,
        priorYearAaiiCents: 0,
      });
      return [
        expectEqual(facade.taxableIncomeCents, detailed.taxableIncomeCents, "taxable"),
        expectEqual(facade.fedTaxCents, detailed.fedTaxCents, "fed"),
        expectEqual(facade.ontarioTaxCents, detailed.ontarioTaxCents, "on"),
        expectEqual(facade.totalTaxCents, detailed.totalTaxCents, "total"),
      ].filter((e): e is string => e !== null);
    },
  },
  {
    name: "Seed-zero · blank-slate corp FY2026 → taxable 0, every pool closes at 0",
    fn: () => {
      const r = estimateT2Detailed({
        periodStart: "2026-04-01",
        periodEnd: "2026-12-31",
        isCcpc: true,
        revenueCents: 0, operatingExpensesCents: 0,
        salaryCents: 0, employerCppCents: 0,
        ccaClaimedCents: 0, priorYearAaiiCents: 0,
      });
      const grip = computeGrip({ openingCents: 0, fullRateIncomeCents: r.fullRateIncomeCents, eligibleDividendsPaidCents: 0 });
      const rdtoh = computeRdtoh({
        erdtohOpeningCents: 0, nerdtohOpeningCents: 0,
        aaiiCents: 0, partIVOnEligibleCents: 0, partIVOnNonEligibleCents: 0,
        eligibleDividendsPaidCents: 0, nonEligibleDividendsPaidCents: 0,
      });
      const cda = computeCda({
        openingCents: 0, capitalGainsNetCents: 0,
        capitalDividendsReceivedCents: 0, lifeInsuranceProceedsCents: 0,
        capitalDividendsElectedCents: 0,
      });
      return [
        expectEqual(r.totalTaxCents, 0, "no tax"),
        expectEqual(grip.closingCents, 0, "GRIP 0"),
        expectEqual(rdtoh.erdtoh.closingCents, 0, "ERDTOH 0"),
        expectEqual(rdtoh.nerdtoh.closingCents, 0, "NERDTOH 0"),
        expectEqual(cda.closingCents, 0, "CDA 0"),
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
