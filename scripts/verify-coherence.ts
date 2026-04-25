/**
 * Cross-feature coherence verifier. Seeds a canonical fixture in memory
 * (no DB) and drives every compute path that displays a revenue, HST, or
 * cash number. Asserts that every path produces the same answer on the
 * same input.
 *
 * If this test fails, a filter or period rule drifted out of sync between
 * two pages — exactly the class of bug the 2026-04-21 dashboard sweep
 * caught three times (HST aggregator vs dashboard, /invoices header vs
 * dashboard, Quick-Method eligibility vs aggregator).
 *
 * Every card/page/aggregator in the app MUST go through the shared
 * predicates in `src/lib/queries/invoice-slices.ts` — this script is how
 * we prove it.
 *
 * Run: `pnpm verify-coherence`. Fails the process (exit 1) on any mismatch.
 */

import {
  isTaxableSupply,
  isTaxableSupplyInPeriod,
  TAXABLE_SUPPLY_STATUSES,
} from "../src/lib/queries/invoice-slices";
import {
  aggregateRegular,
  aggregateQuickMethod,
  hstPeriodFor,
  hstFilingDueDate,
  canUseQuickMethod,
  quickMethodBreakEven,
  ONTARIO_SERVICE_QM_RATE_BPS,
  QUICK_METHOD_ELIGIBILITY_CAP_CENTS,
  QUICK_CREDIT_CAP_CENTS,
  type InvoiceSlice,
  type ExpenseSlice,
} from "../src/lib/hst";
import {
  revenueByMonth,
  estimateT2,
  estimateCashPosition,
  operatingExpensesForT2,
  FED_SBD_RATE,
  ontarioSmallBizRate,
} from "../src/lib/dashboard-metrics";
import { estimateT2Detailed } from "../src/lib/t2";
import { computeGrip, computeRdtoh, computeCda } from "../src/lib/tax-pools";
import {
  simulateScenario,
  synthesizeT4,
  canonicalInputJson,
  CPP_YMPE_2026 as PLAN_YMPE,
  type ScenarioInput,
} from "../src/lib/self-pay-planner";
import { computePayroll } from "../src/lib/payroll-2026";
import { buildCcaPools, totalCcaClaimed, CLASS_RATE_BPS } from "../src/lib/cca";
import { toGifiCsv } from "../src/lib/gifi-export";
import { computePsbRisk } from "../src/lib/psb";
import {
  computeT1,
  dividendGrossUp,
  dividendTaxCredit,
  marginalRateAt,
  marginalRateOnNextDollar,
  type T1Input,
} from "../src/lib/t1";
import {
  t4SlipBoxesFromRaw,
  t5SlipBoxesFromRaw,
  type T4BoxesInput as SlipT4Input,
  type T5BoxesInput as SlipT5Input,
} from "../src/lib/slip-boxes";
import {
  CPP_BASE_CREDIT_FRACTION,
  CPP_ENHANCED_DEDUCTION_FRACTION,
  ELIGIBLE_GROSS_UP_RATE,
  FEDERAL_DTC_ELIGIBLE_RATE,
  FEDERAL_DTC_NON_ELIGIBLE_RATE,
  NON_ELIGIBLE_GROSS_UP_RATE,
  ONTARIO_DTC_ELIGIBLE_RATE,
  ONTARIO_DTC_NON_ELIGIBLE_RATE_2026,
} from "../src/lib/t1-rates-2026";
import { fiscalYearFor, formatCAD } from "../src/lib/utils";

// ——— canonical fixture ———

const fyeMonth = 12;
const fyeDay = 31;
const fiscalYear = 2026;
const fyPeriod = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);
// fyPeriod = { start: "2026-01-01", end: "2026-12-31" }

const fixtureInvoices: InvoiceSlice[] = [
  // In-period, taxable supplies (A + B + C = $230K subtotal, $29.9K HST)
  {
    id: "A",
    invoiceNumber: "UT-0001",
    issueDate: "2026-01-15",
    subtotalCents: 100_000_00,
    hstCents: 13_000_00,
    totalCents: 113_000_00,
    status: "paid",
  },
  {
    id: "B",
    invoiceNumber: "UT-0002",
    issueDate: "2026-03-20",
    subtotalCents: 50_000_00,
    hstCents: 6_500_00,
    totalCents: 56_500_00,
    status: "sent",
  },
  {
    id: "C",
    invoiceNumber: "UT-0003",
    issueDate: "2026-06-10",
    subtotalCents: 80_000_00,
    hstCents: 10_400_00,
    totalCents: 90_400_00,
    status: "overdue",
  },
  // Draft — NOT a taxable supply yet
  {
    id: "D",
    invoiceNumber: "UT-0004",
    issueDate: "2026-05-01",
    subtotalCents: 40_000_00,
    hstCents: 5_200_00,
    totalCents: 45_200_00,
    status: "draft",
  },
  // Void — cancelled
  {
    id: "E",
    invoiceNumber: "UT-0005",
    issueDate: "2026-04-10",
    subtotalCents: 30_000_00,
    hstCents: 3_900_00,
    totalCents: 33_900_00,
    status: "void",
  },
  // Out-of-period — FY 2025
  {
    id: "F",
    invoiceNumber: "UT-0006",
    issueDate: "2025-12-15",
    subtotalCents: 60_000_00,
    hstCents: 7_800_00,
    totalCents: 67_800_00,
    status: "paid",
  },
];

const fixtureExpenses: ExpenseSlice[] = [
  {
    id: "X1",
    expenseDate: "2026-02-01",
    vendor: "GitHub",
    category: "software_subscriptions",
    subtotalCents: 10_000_00,
    hstPaidCents: 1_300_00,
    totalCents: 11_300_00,
  },
  {
    id: "X2",
    expenseDate: "2026-06-01",
    vendor: "Restaurant",
    category: "meals_entertainment",
    subtotalCents: 2_000_00,
    hstPaidCents: 260_00,
    totalCents: 2_260_00,
  },
  {
    id: "X3",
    expenseDate: "2026-07-15",
    vendor: "Apple",
    category: "capital_asset",
    subtotalCents: 30_000_00,
    hstPaidCents: 3_900_00,
    totalCents: 33_900_00,
  },
];

// Ground-truth expectations derived by hand from the fixture
const EXPECTED = {
  revenueSubtotal: 230_000_00, // A + B + C
  hstCollected: 29_900_00, // 13_000 + 6_500 + 10_400
  revenueTotal: 259_900_00, // A + B + C totals
  itcRegularRaw: 5_460_00, // 1_300 + 260 + 3_900 (line 106 raw)
  mealsHstHalf: 130_00, // ETA s.236 — 50% × 260 = 130 unrecoverable
  itcRegularNet: 5_330_00, // 5_460 - 130 = line 108 Regular
  line109Regular: 24_570_00, // 29_900 - 5_330
  // QM: 8.8% × HST-inclusive revenue
  qmRemittanceBeforeCredit: Math.round((259_900_00 * ONTARIO_SERVICE_QM_RATE_BPS) / 10_000), // 22_871_20
  qmCapitalItc: 3_900_00,
  qmCountedInvoicesSubtotal: 230_000_00,
  taxableSupplyCount: 3, // A, B, C
  opExpensesForT2: 11_000_00, // 10_000 + (2_000 × 0.5) + 0 (capital excluded)
} as const;

// ——— scaffolding ———

type Result = { name: string; failures: string[] };
const results: Result[] = [];
function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expect(
  failures: string[],
  label: string,
  actual: number,
  expected: number,
  tol = 0,
) {
  if (Math.abs(actual - expected) > tol) {
    failures.push(`${label}: want ${formatCAD(expected)}, got ${formatCAD(actual)}`);
  }
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

// ——— Test 1: the shared predicate itself ———

(() => {
  const failures: string[] = [];
  const expected = ["A", "B", "C"];
  const actual = fixtureInvoices
    .filter((i) => isTaxableSupplyInPeriod(i, fyPeriod))
    .map((i) => i.id);
  expectEq(failures, "isTaxableSupplyInPeriod ids", actual.join(","), expected.join(","));
  // And the bare predicate
  const bareActual = fixtureInvoices.filter(isTaxableSupply).map((i) => i.id);
  expectEq(failures, "isTaxableSupply ids (no period)", bareActual.join(","), "A,B,C,F");
  // And the SQL status list — must cover exactly sent/paid/overdue
  expectEq(failures, "TAXABLE_SUPPLY_STATUSES length", TAXABLE_SUPPLY_STATUSES.length, 3);
  expectEq(
    failures,
    "TAXABLE_SUPPLY_STATUSES members",
    [...TAXABLE_SUPPLY_STATUSES].sort().join(","),
    "overdue,paid,sent",
  );
  record("Shared predicates: isTaxableSupply / isTaxableSupplyInPeriod / status tuple", failures);
})();

// ——— Test 2: HST aggregator vs dashboard revenue filter ———

(() => {
  const failures: string[] = [];
  const dashboardFyRevenue = fixtureInvoices
    .filter((i) => isTaxableSupplyInPeriod(i, fyPeriod))
    .reduce((a, i) => a + i.subtotalCents, 0);
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
  });
  const qm = aggregateQuickMethod({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
    isFirstQmFy: false,
  });
  expect(failures, "dashboard fy revenue", dashboardFyRevenue, EXPECTED.revenueSubtotal);
  expect(failures, "HST Regular line 101", reg.line101Cents, EXPECTED.revenueSubtotal);
  expect(failures, "HST Quick line 101", qm.line101Cents, EXPECTED.revenueSubtotal);
  expectEq(
    failures,
    "Regular counted invoice count",
    reg.invoiceContributions.length,
    EXPECTED.taxableSupplyCount,
  );
  expectEq(
    failures,
    "Quick counted invoice count",
    qm.invoiceContributions.length,
    EXPECTED.taxableSupplyCount,
  );
  record("Revenue: dashboard filter === HST Regular line 101 === HST Quick line 101", failures);
})();

// ——— Test 3: HST collected vs regular line 103 ———

(() => {
  const failures: string[] = [];
  const directHstCollected = fixtureInvoices
    .filter((i) => isTaxableSupplyInPeriod(i, fyPeriod))
    .reduce((a, i) => a + i.hstCents, 0);
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
  });
  expect(failures, "direct HST collected", directHstCollected, EXPECTED.hstCollected);
  expect(failures, "Regular line 103", reg.line103Cents, EXPECTED.hstCollected);
  record("HST collected: dashboard filter === Regular line 103", failures);
})();

// ——— Test 4: Regular line 108 — meals cap applied exactly once ———

(() => {
  const failures: string[] = [];
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
  });
  expect(failures, "line 106 raw (sum expense HST)", reg.line106RawCents, EXPECTED.itcRegularRaw);
  expect(failures, "line 107 (meals cap negative)", reg.line107Cents, -EXPECTED.mealsHstHalf);
  expect(failures, "line 108 (106 + 107)", reg.line108Cents, EXPECTED.itcRegularNet);
  expect(failures, "line 109 (105 - 108)", reg.line109Cents, EXPECTED.line109Regular);
  record("Regular ITC: meals 50% cap applied once (line 106 - line 107 = line 108)", failures);
})();

// ——— Test 5: QM remittance math (rate × HST-inclusive) ———

(() => {
  const failures: string[] = [];
  const qm = aggregateQuickMethod({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
    isFirstQmFy: false,
  });
  const hstInclusive = EXPECTED.revenueSubtotal + EXPECTED.hstCollected;
  const expectedRemit = Math.round((hstInclusive * ONTARIO_SERVICE_QM_RATE_BPS) / 10_000);
  expect(failures, "QM line 103 (remittance)", qm.line103Cents, expectedRemit);
  expect(failures, "QM line 106 capital-only ITC", qm.line106CapitalCents, EXPECTED.qmCapitalItc);
  expect(failures, "QM line 108 (capital ITC only)", qm.line108Cents, EXPECTED.qmCapitalItc);
  expect(
    failures,
    "QM line 109 (105 - 108)",
    qm.line109Cents,
    expectedRemit - EXPECTED.qmCapitalItc,
  );
  expect(failures, "QM quick credit (non-first-year)", qm.quickCreditCents, 0);
  record("Quick Method: 8.8% × HST-inclusive, capital-only ITC", failures);
})();

// ——— Test 6: Dashboard sparkline buckets sum === dashboard FY revenue ———

(() => {
  const failures: string[] = [];
  const series = revenueByMonth(fixtureInvoices, "2026-12");
  expectEq(failures, "bucket count", series.length, 12);
  // Only A + B + C have dates in the 2026-01 → 2026-12 window
  const total = series.reduce((a, b) => a + b.cents, 0);
  expect(failures, "sparkline 12mo total (Jan-Dec 2026)", total, EXPECTED.revenueSubtotal);
  // F (2025-12) is exactly at the oldest bucket edge when window ends 2026-11
  const seriesEndingNov = revenueByMonth(fixtureInvoices, "2026-11");
  const totalNov = seriesEndingNov.reduce((a, b) => a + b.cents, 0);
  // Should include F (Dec 2025, inside 12mo window ending Nov 2026) + A + B + C
  expect(
    failures,
    "sparkline 12mo ending Nov includes F (Dec 2025)",
    totalNov,
    EXPECTED.revenueSubtotal + 60_000_00,
  );
  record("Sparkline: taxable-supply filter matches HST aggregator", failures);
})();

// ——— Test 7: /hst candidate FY detection matches aggregator ———

(() => {
  const failures: string[] = [];
  const detected = new Set<number>();
  for (const i of fixtureInvoices) {
    if (!isTaxableSupply(i)) continue;
    detected.add(fiscalYearFor(i.issueDate, fyeMonth, fyeDay));
  }
  // A + B + C → FY 2026, F → FY 2025; D draft + E void excluded
  expectEq(
    failures,
    "candidate FYs (sorted)",
    [...detected].sort().join(","),
    "2025,2026",
  );
  // And what the aggregator sees for FY 2026 should not be empty
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
  });
  expectEq(
    failures,
    "aggregator sees a FY 2026 supply if /hst flagged it",
    reg.invoiceContributions.length > 0,
    true,
  );
  record("/hst candidate detection: consistent with aggregator", failures);
})();

// ——— Test 8: operatingExpensesForT2 matches manual expectation ———

(() => {
  const failures: string[] = [];
  const expOnlyInPeriod = fixtureExpenses.filter(
    (e) => e.expenseDate >= fyPeriod.start && e.expenseDate <= fyPeriod.end,
  );
  const op = operatingExpensesForT2(
    expOnlyInPeriod.map((e) => ({
      category: e.category,
      subtotalCents: e.subtotalCents,
      totalCents: e.totalCents,
    })),
  );
  expect(failures, "deductible op expenses", op, EXPECTED.opExpensesForT2);
  record("operatingExpensesForT2: meals 50% + capital excluded", failures);
})();

// ——— Test 9: T2 estimate on fixture matches manual calc ———

(() => {
  const failures: string[] = [];
  const t2 = estimateT2({
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    revenueCents: EXPECTED.revenueSubtotal,
    operatingExpensesCents: EXPECTED.opExpensesForT2,
    salaryCents: 60_000_00,
    employerCppCents: 3_000_00,
  });
  // Gross = 230_000 - 11_000 - 60_000 - 3_000 = 156_000
  const taxable = 156_000_00;
  expect(failures, "taxable income", t2.taxableIncomeCents, taxable);
  const fedExpected = Math.round(taxable * FED_SBD_RATE);
  expect(failures, "fed tax (9%)", t2.fedTaxCents, fedExpected);
  const onRate = ontarioSmallBizRate(fyPeriod.start, fyPeriod.end);
  const onExpected = Math.round(taxable * onRate);
  expect(failures, "ON tax (blended)", t2.ontarioTaxCents, onExpected);
  expect(failures, "total tax", t2.totalTaxCents, fedExpected + onExpected);
  record("T2 estimate: manual calc matches estimateT2 on fixture", failures);
})();

// ——— Test 10: Cash position formula ———

(() => {
  const failures: string[] = [];
  const expensesTotal = fixtureExpenses.reduce((a, e) => a + e.totalCents, 0);
  const t2 = estimateT2({
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    revenueCents: EXPECTED.revenueSubtotal,
    operatingExpensesCents: EXPECTED.opExpensesForT2,
    salaryCents: 60_000_00,
    employerCppCents: 3_000_00,
  });
  const cash = estimateCashPosition({
    revenueTotalCents: EXPECTED.revenueTotal,
    expensesTotalCents: expensesTotal,
    salaryGrossCents: 60_000_00,
    employerCppCents: 3_000_00,
    dividendsCents: 20_000_00,
    t2EstimateCents: t2.totalTaxCents,
    hstNetCents: EXPECTED.line109Regular,
  });
  // inflow = revenueTotal (hst net positive → no refund added)
  // outflow = expenses + salary + eCPP + div + T2 + hstNet
  const expectedOutflow =
    expensesTotal +
    60_000_00 +
    3_000_00 +
    20_000_00 +
    t2.totalTaxCents +
    EXPECTED.line109Regular;
  expect(failures, "cash inflow", cash.inflowCents, EXPECTED.revenueTotal);
  expect(failures, "cash outflow", cash.outflowCents, expectedOutflow);
  expect(failures, "cash net", cash.netCents, EXPECTED.revenueTotal - expectedOutflow);
  record("Cash position: revenueTotal - (expenses + salary + eCPP + div + T2 + HST) ", failures);
})();

// ——— Test 11: Regression guard — shared predicate excludes drafts ———
// This was the actual 3C bug: HST aggregator used to include drafts.

(() => {
  const failures: string[] = [];
  const draftOnly = fixtureInvoices.filter((i) => i.status === "draft");
  expectEq(failures, "fixture has a draft to test against", draftOnly.length, 1);
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: [],
    period: fyPeriod,
  });
  const draftId = draftOnly[0]!.id;
  const includesDraft = reg.invoiceContributions.some((i) => i.id === draftId);
  expectEq(failures, "Regular aggregator excludes draft", includesDraft, false);
  const qm = aggregateQuickMethod({
    invoices: fixtureInvoices,
    expenses: [],
    period: fyPeriod,
    isFirstQmFy: false,
  });
  const qmIncludesDraft = qm.invoiceContributions.some((i) => i.id === draftId);
  expectEq(failures, "Quick Method aggregator excludes draft", qmIncludesDraft, false);
  record("Regression: HST aggregator no longer includes drafts (the original 3C bug)", failures);
})();

// ——— Test 12: Row-level identity — subtotal + HST = total, always ———

(() => {
  const failures: string[] = [];
  for (const i of fixtureInvoices) {
    if (i.subtotalCents + i.hstCents !== i.totalCents) {
      failures.push(
        `invoice ${i.invoiceNumber}: ${i.subtotalCents} + ${i.hstCents} !== ${i.totalCents}`,
      );
    }
  }
  for (const e of fixtureExpenses) {
    if (e.subtotalCents + e.hstPaidCents !== e.totalCents) {
      failures.push(
        `expense ${e.id}: ${e.subtotalCents} + ${e.hstPaidCents} !== ${e.totalCents}`,
      );
    }
  }
  record("Row identity: subtotal + HST = total for every invoice/expense row", failures);
})();

// ——— Test 13: Line 101 + Line 103 = sum(totalCents) for counted invoices ———

(() => {
  const failures: string[] = [];
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: [],
    period: fyPeriod,
  });
  const countedTotals = reg.invoiceContributions.reduce((a, i) => a + i.totalCents, 0);
  expect(
    failures,
    "line 101 + line 103 = sum(totalCents)",
    reg.line101Cents + reg.line103Cents,
    countedTotals,
  );
  record("HST identity: line 101 + line 103 = sum of counted invoice totals", failures);
})();

// ——— Test 14: Period boundary — issue date on exact period start/end counts ———

(() => {
  const failures: string[] = [];
  const boundaryInvoices: InvoiceSlice[] = [
    {
      id: "START",
      invoiceNumber: "UT-START",
      issueDate: fyPeriod.start,
      subtotalCents: 100_00,
      hstCents: 13_00,
      totalCents: 113_00,
      status: "paid",
    },
    {
      id: "END",
      invoiceNumber: "UT-END",
      issueDate: fyPeriod.end,
      subtotalCents: 200_00,
      hstCents: 26_00,
      totalCents: 226_00,
      status: "paid",
    },
    {
      id: "BEFORE",
      invoiceNumber: "UT-BEFORE",
      issueDate: addDaysISO(fyPeriod.start, -1),
      subtotalCents: 999_99,
      hstCents: 129_99,
      totalCents: 1_129_98,
      status: "paid",
    },
    {
      id: "AFTER",
      invoiceNumber: "UT-AFTER",
      issueDate: addDaysISO(fyPeriod.end, 1),
      subtotalCents: 999_99,
      hstCents: 129_99,
      totalCents: 1_129_98,
      status: "paid",
    },
  ];
  const reg = aggregateRegular({
    invoices: boundaryInvoices,
    expenses: [],
    period: fyPeriod,
  });
  expectEq(failures, "boundary count", reg.invoiceContributions.length, 2);
  expect(failures, "boundary line 101", reg.line101Cents, 300_00);
  record("Period boundary: invoice on exact start/end counts; ±1 day doesn't", failures);
})();

// ——— Test 15: Void + out-of-period never contribute anywhere ———

(() => {
  const failures: string[] = [];
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: [],
    period: fyPeriod,
  });
  const voidLeaked = reg.invoiceContributions.some((i) => i.status === "void");
  expectEq(failures, "no void in Regular", voidLeaked, false);
  const outLeaked = reg.invoiceContributions.some(
    (i) => i.issueDate < fyPeriod.start || i.issueDate > fyPeriod.end,
  );
  expectEq(failures, "no out-of-period in Regular", outLeaked, false);
  const qm = aggregateQuickMethod({
    invoices: fixtureInvoices,
    expenses: [],
    period: fyPeriod,
    isFirstQmFy: false,
  });
  const voidInQm = qm.invoiceContributions.some((i) => i.status === "void");
  expectEq(failures, "no void in Quick", voidInQm, false);
  const series = revenueByMonth(fixtureInvoices, "2026-12");
  const totalIncludingF = series.reduce((a, b) => a + b.cents, 0);
  // F is in Dec 2025, which is outside the Jan-Dec 2026 sparkline window.
  // Void E in Apr 2026 is in window but must be excluded by predicate.
  expect(failures, "sparkline excludes void + out-of-window", totalIncludingF, 230_000_00);
  record("Void and out-of-period rows never contribute to any aggregate", failures);
})();

// ——— Test 16: Quick Method eligibility boundary ($400K inclusive) ———

(() => {
  const failures: string[] = [];
  expectEq(failures, "0 eligible", canUseQuickMethod(0), true);
  expectEq(
    failures,
    "exactly $400K eligible",
    canUseQuickMethod(QUICK_METHOD_ELIGIBILITY_CAP_CENTS),
    true,
  );
  expectEq(
    failures,
    "$400K + 1¢ ineligible",
    canUseQuickMethod(QUICK_METHOD_ELIGIBILITY_CAP_CENTS + 1),
    false,
  );
  expectEq(failures, "$500K ineligible", canUseQuickMethod(500_000_00), false);
  record("Quick Method eligibility: $400K inclusive boundary", failures);
})();

// ——— Test 17: Quick Method first-year credit caps at $300 ———

(() => {
  const failures: string[] = [];
  // Revenue large enough that 1% × $30K HST-inclusive = $300 — the cap.
  const big: InvoiceSlice = {
    id: "BIG",
    invoiceNumber: "UT-BIG",
    issueDate: fyPeriod.start,
    subtotalCents: 100_000_00,
    hstCents: 13_000_00,
    totalCents: 113_000_00,
    status: "paid",
  };
  const qm = aggregateQuickMethod({
    invoices: [big],
    expenses: [],
    period: fyPeriod,
    isFirstQmFy: true,
  });
  expect(failures, "QM credit capped at $300", qm.quickCreditCents, QUICK_CREDIT_CAP_CENTS);
  // Revenue below threshold → credit scales down (1% of HST-inclusive supplies)
  const small: InvoiceSlice = {
    ...big,
    subtotalCents: 10_000_00,
    hstCents: 1_300_00,
    totalCents: 11_300_00,
  };
  const qmSmall = aggregateQuickMethod({
    invoices: [small],
    expenses: [],
    period: fyPeriod,
    isFirstQmFy: true,
  });
  const expectedSmall = Math.round(11_300_00 * 0.01); // 1% × $11,300 = $113
  expect(failures, "QM credit scales when below $30K cap", qmSmall.quickCreditCents, expectedSmall);
  record("Quick Method first-year credit: 1% × min($30K, HST-incl), capped $300", failures);
})();

// ——— Test 18: Cash position monotonicity ———
// Adding $1 to revenue should raise net cash by exactly $1 (everything else held).

(() => {
  const failures: string[] = [];
  const base = estimateCashPosition({
    revenueTotalCents: 100_000_00,
    expensesTotalCents: 10_000_00,
    salaryGrossCents: 50_000_00,
    employerCppCents: 2_000_00,
    dividendsCents: 5_000_00,
    t2EstimateCents: 3_000_00,
    hstNetCents: 8_000_00,
  });
  const plusOne = estimateCashPosition({
    revenueTotalCents: 100_000_00 + 100, // +$1.00
    expensesTotalCents: 10_000_00,
    salaryGrossCents: 50_000_00,
    employerCppCents: 2_000_00,
    dividendsCents: 5_000_00,
    t2EstimateCents: 3_000_00,
    hstNetCents: 8_000_00,
  });
  expectEq(failures, "+$1 revenue → +$1 net cash", plusOne.netCents - base.netCents, 100);
  const plusExpense = estimateCashPosition({
    revenueTotalCents: 100_000_00,
    expensesTotalCents: 10_000_00 + 100, // +$1.00
    salaryGrossCents: 50_000_00,
    employerCppCents: 2_000_00,
    dividendsCents: 5_000_00,
    t2EstimateCents: 3_000_00,
    hstNetCents: 8_000_00,
  });
  expectEq(failures, "+$1 expense → -$1 net cash", plusExpense.netCents - base.netCents, -100);
  record("Cash position monotonicity: +$1 revenue → +$1 net; +$1 expense → -$1 net", failures);
})();

// ——— Test 19: T2 monotonicity — more operating expenses = less tax ———

(() => {
  const failures: string[] = [];
  const base = estimateT2({
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    revenueCents: 200_000_00,
    operatingExpensesCents: 10_000_00,
    salaryCents: 0,
    employerCppCents: 0,
  });
  const more = estimateT2({
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    revenueCents: 200_000_00,
    operatingExpensesCents: 50_000_00,
    salaryCents: 0,
    employerCppCents: 0,
  });
  if (more.totalTaxCents >= base.totalTaxCents) {
    failures.push(
      `more expenses must reduce T2: base ${formatCAD(base.totalTaxCents)}, more ${formatCAD(more.totalTaxCents)}`,
    );
  }
  // Delta: $40K extra expenses × combined rate = expected drop. Compute the
  // expected drop via the same exact-float path estimateT2Detailed uses
  // internally — the facade's combinedRate is bps-rounded for display and
  // would drift a few cents from the cent-exact reality.
  const deltaCents = 40_000_00; // 50k - 10k
  const onRate = ontarioSmallBizRate(fyPeriod.start, fyPeriod.end);
  const expectedDrop =
    Math.round(deltaCents * FED_SBD_RATE) + Math.round(deltaCents * onRate);
  const actualDrop = base.totalTaxCents - more.totalTaxCents;
  expect(failures, "T2 drop proportional to combined rate", actualDrop, expectedDrop, 1);
  record("T2 monotonicity: more operating expenses → less tax, proportional to combined rate", failures);
})();

// ——— Test 20: hstPeriodFor / hstFilingDueDate for both FYEs ———

(() => {
  const failures: string[] = [];
  const dec = hstPeriodFor(2026, 12, 31);
  expectEq(failures, "Dec-31 FY26 start", dec.start, "2026-01-01");
  expectEq(failures, "Dec-31 FY26 end", dec.end, "2026-12-31");
  expectEq(failures, "Dec-31 FY26 due", hstFilingDueDate(dec.end), "2027-03-31");
  const oct = hstPeriodFor(2026, 10, 31);
  expectEq(failures, "Oct-31 FY26 start", oct.start, "2025-11-01");
  expectEq(failures, "Oct-31 FY26 end", oct.end, "2026-10-31");
  expectEq(failures, "Oct-31 FY26 due", hstFilingDueDate(oct.end), "2027-01-31");
  record("Period / due-date derivation for Dec-31 and Oct-31 FYE corps", failures);
})();

// ——— Test 21: fiscalYearFor boundary — the FYE day and day after ———

(() => {
  const failures: string[] = [];
  // Dec-31 FYE: 2026-12-31 → FY 2026, 2027-01-01 → FY 2027
  expectEq(failures, "Dec-31 last day", fiscalYearFor("2026-12-31", 12, 31), 2026);
  expectEq(failures, "Dec-31 day after", fiscalYearFor("2027-01-01", 12, 31), 2027);
  // Oct-31 FYE: 2026-10-31 → FY 2026, 2026-11-01 → FY 2027
  expectEq(failures, "Oct-31 last day", fiscalYearFor("2026-10-31", 10, 31), 2026);
  expectEq(failures, "Oct-31 day after", fiscalYearFor("2026-11-01", 10, 31), 2027);
  record("fiscalYearFor: FYE day belongs to that FY, day-after rolls", failures);
})();

// ——— Test 22: break-even comparison is symmetric with the aggregators ———

(() => {
  const failures: string[] = [];
  const reg = aggregateRegular({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
  });
  const qm = aggregateQuickMethod({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
    isFirstQmFy: false,
  });
  const be = quickMethodBreakEven({
    invoices: fixtureInvoices,
    expenses: fixtureExpenses,
    period: fyPeriod,
    isFirstQmFy: false,
  });
  expectEq(failures, "breakEven.regularNet === reg.line109", be.regularNet, reg.line109Cents);
  expectEq(failures, "breakEven.quickNet === qm.line109", be.quickNet, qm.line109Cents);
  expectEq(
    failures,
    "breakEven.delta === reg.line109 - qm.line109",
    be.deltaCents,
    reg.line109Cents - qm.line109Cents,
  );
  record("Break-even advisor: uses the same aggregator outputs", failures);
})();

// ——— Test 23: PSB risk — critical-missing forces red regardless of score ———

(() => {
  const failures: string[] = [];
  type Item = {
    critical: boolean;
    status: "done" | "in_progress" | "not_applicable";
    weight: number;
  };
  // 9 of 10 items done (each weight 1), but one critical is missing → still red.
  const items: Item[] = [
    { critical: true, status: "done", weight: 1 },
    { critical: true, status: "in_progress", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
    { critical: false, status: "done", weight: 1 },
  ];
  const psb = computePsbRisk(items);
  expectEq(failures, "critical missing detected", psb.criticalMissing, true);
  expectEq(failures, "risk forced red", psb.risk, "red");
  // Now mark the critical item done → risk re-evaluates
  items[1]!.status = "done";
  const psb2 = computePsbRisk(items);
  expectEq(failures, "after fix, critical missing false", psb2.criticalMissing, false);
  expectEq(failures, "after fix, risk green", psb2.risk, "green");
  record("PSB: critical-missing forces red; score only matters without critical gaps", failures);
})();

// ——— helpers ———

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ————————————————————————————————————————————————————————————————
// T2 cross-feature coherence (Phase 4C)
// ————————————————————————————————————————————————————————————————
// Asserts that the three T2 presentation paths agree on the same inputs:
//   1. Dashboard façade (estimateT2)
//   2. /corp-tax/[fy] detail (estimateT2Detailed)
//   3. T2 prep PDF + GIFI CSV (frozen snapshot → CSV line 9970 / 8670)
// Regression guard: every equality below must hold for the canonical fixture.
//
// Also verifies the CCA pool engine plus the estimateCashPosition dividend
// refund passthrough (Phase 4C addition to the cash formula).
// ————————————————————————————————————————————————————————————————

{
  const t2Input = {
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    revenueCents: EXPECTED.revenueSubtotal,
    operatingExpensesCents: EXPECTED.opExpensesForT2,
    salaryCents: 50_000_00,
    employerCppCents: 2_000_00,
  };
  const facade = estimateT2(t2Input);
  const detailed = estimateT2Detailed({
    ...t2Input,
    isCcpc: true,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
  });

  const failures: string[] = [];
  expect(failures, "dashboard façade taxable === detailed.taxable", facade.taxableIncomeCents, detailed.taxableIncomeCents);
  expect(failures, "dashboard façade fed === detailed.fed", facade.fedTaxCents, detailed.fedTaxCents);
  expect(failures, "dashboard façade ontario === detailed.ontario", facade.ontarioTaxCents, detailed.ontarioTaxCents);
  expect(failures, "dashboard façade total === detailed.total", facade.totalTaxCents, detailed.totalTaxCents);
  expect(
    failures,
    "facade.combinedRate × 10000 === detailed SBD combined bps",
    Math.round(facade.combinedRate * 10_000),
    detailed.combinedRateOnSbdBps,
  );
  record("T2 · dashboard façade ≡ estimateT2Detailed", failures);
}

{
  // CCA pool: opening empty, add a $3000 Class 50 laptop + $400 Class 12
  // software. Sum of claimed CCA must match what GIFI exports on line 8670.
  const ccaRows = buildCcaPools({
    openingPools: [],
    additions: [
      { class: "50", classRateBps: CLASS_RATE_BPS["50"], acquisitionCostCents: 3_000_00, businessUsePercent: 100, halfYearRuleApplies: true, description: null },
      { class: "12", classRateBps: CLASS_RATE_BPS["12"], acquisitionCostCents: 400_00, businessUsePercent: 100, halfYearRuleApplies: false, description: null },
    ],
  });
  const total = totalCcaClaimed(ccaRows);
  const csv = toGifiCsv({
    fiscalYear: 2026,
    revenueCents: 0,
    salaryCents: 0,
    employerCppCents: 0,
    ccaClaimedCents: total,
    netIncomeForTaxCents: 0,
    totalTaxCents: 0,
    expenses: [],
  });
  const line8670 = csv.split("\n").find((l) => l.startsWith("8670,"));
  const csvCents = line8670 ? Number(line8670.split(",")[2]) : -1;

  const failures: string[] = [];
  expect(failures, "GIFI line 8670 === sum of CCA claimed", csvCents, total);
  record("GIFI · line 8670 amortization ≡ totalCcaClaimed", failures);
}

{
  // GIFI line 9970 (net income before tax) === detailed.netIncomeForTaxCents
  // for the same inputs.
  const t2Input = {
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    isCcpc: true,
    revenueCents: 200_000_00,
    operatingExpensesCents: 30_000_00,
    salaryCents: 50_000_00,
    employerCppCents: 2_000_00,
    ccaClaimedCents: 1_200_00,
    priorYearAaiiCents: 0,
  };
  const detailed = estimateT2Detailed(t2Input);
  const csv = toGifiCsv({
    fiscalYear: 2026,
    revenueCents: t2Input.revenueCents,
    salaryCents: t2Input.salaryCents,
    employerCppCents: t2Input.employerCppCents,
    ccaClaimedCents: t2Input.ccaClaimedCents,
    netIncomeForTaxCents: detailed.netIncomeForTaxCents,
    totalTaxCents: detailed.totalTaxCents,
    expenses: [],
  });
  const line9970 = csv.split("\n").find((l) => l.startsWith("9970,"));
  const csvNet = line9970 ? Number(line9970.split(",")[2]) : -1;

  const failures: string[] = [];
  expect(failures, "GIFI line 9970 === detailed.netIncomeForTaxCents", csvNet, detailed.netIncomeForTaxCents);
  record("GIFI · line 9970 net income ≡ detailed net income", failures);
}

{
  // Cash position: dividend refund passthrough must add to inflow.
  const baseInput = {
    revenueTotalCents: 100_000_00,
    expensesTotalCents: 20_000_00,
    salaryGrossCents: 40_000_00,
    employerCppCents: 1_500_00,
    dividendsCents: 10_000_00,
    t2EstimateCents: 3_000_00,
    hstNetCents: 5_000_00,
  };
  const without = estimateCashPosition(baseInput);
  const with_ = estimateCashPosition({ ...baseInput, dividendRefundCents: 800_00 });

  const failures: string[] = [];
  expect(
    failures,
    "dividend refund $800 increases inflow by exactly $800",
    with_.inflowCents,
    without.inflowCents + 800_00,
  );
  expect(failures, "outflow unchanged by refund", with_.outflowCents, without.outflowCents);
  expect(
    failures,
    "net increases by exactly $800",
    with_.netCents,
    without.netCents + 800_00,
  );
  record("Cash position · dividend refund increases inflow 1:1", failures);
}

{
  // RDTOH ordering guard: non-elig dividend paid depletes NERDTOH FIRST,
  // then spills to ERDTOH. This statutory rule (ITA s.129(1)) must stay
  // stable — if it flips silently, the dividend refund becomes wrong.
  const r = computeRdtoh({
    erdtohOpeningCents: 5_000_00,
    nerdtohOpeningCents: 2_000_00,
    aaiiCents: 0,
    partIVOnEligibleCents: 0,
    partIVOnNonEligibleCents: 0,
    eligibleDividendsPaidCents: 0,
    nonEligibleDividendsPaidCents: 20_000_00,
  });
  const failures: string[] = [];
  // 38.33% × 20_000_00 = 7_666_00; NERDTOH drained first (2_000_00), then
  // ERDTOH takes the rest (5_000_00 cap). Total refund = 7_000_00.
  expect(failures, "NERDTOH refund = 2000 (fully drained first)", r.nerdtoh.refundCents, 2_000_00);
  expect(failures, "ERDTOH refund = 5000 (spill cap)", r.erdtoh.refundCents, 5_000_00);
  expect(failures, "total dividend refund = 7000", r.dividendRefundCents, 7_000_00);
  record("RDTOH · ITA s.129(1) ordering: NERDTOH-first, ERDTOH-spill", failures);
}

{
  // GRIP coefficient: 72% of full-rate income. Hardcoded-constant drift
  // would break every eligible-dividend cap across the app.
  const r = computeGrip({
    openingCents: 0,
    fullRateIncomeCents: 10_000_00,
    eligibleDividendsPaidCents: 0,
  });
  const failures: string[] = [];
  expect(failures, "GRIP addition = 72% × 10000 = 7200", r.additionCents, 7_200_00);
  record("GRIP · 72% addition coefficient (Schedule 53)", failures);
}

{
  // CDA: 50% of realized capital gains credits the pool; negative net
  // reduces it by 50% of the loss. Symmetry must hold.
  const gain = computeCda({
    openingCents: 0,
    capitalGainsNetCents: 10_000_00,
    capitalDividendsReceivedCents: 0,
    lifeInsuranceProceedsCents: 0,
    capitalDividendsElectedCents: 0,
  });
  const loss = computeCda({
    openingCents: 10_000_00,
    capitalGainsNetCents: -10_000_00,
    capitalDividendsReceivedCents: 0,
    lifeInsuranceProceedsCents: 0,
    capitalDividendsElectedCents: 0,
  });
  const failures: string[] = [];
  expect(failures, "CDA addition = 50% gain", gain.additionCents, 5_000_00);
  expect(failures, "CDA negative addition = -50% loss", loss.additionCents, -5_000_00);
  record("CDA · 50% inclusion rate is symmetric on gains and losses", failures);
}

// ——— T1 coherence checks (10) ———

// Canonical T1 fixture — salary + mixed dividends + box 117.
const t1Fixture: T1Input = {
  taxYear: 2026,
  t4: {
    box14EmploymentIncomeCents: 80_000_00,
    box16CppBaseCents: Math.round((74_600 - 3_500) * 0.0595 * 100),
    box16aCpp2Cents: Math.round((80_000 - 74_600) * 0.04 * 100),
    box18EiCents: 0,
    box22FedTaxWithheldCents: 12_000_00,
    box24EiInsurableCents: 0,
    box26CppPensionableCents: 74_600_00,
    box52PensionAdjustmentCents: 0,
    ontarioTaxWithheldCents: 4_500_00,
  },
  t5: {
    eligibleActualCents: 10_000_00,
    nonEligibleActualCents: 5_000_00,
  },
  t4aBox117Cents: 500_00,
  donations: { totalCents: 0 },
  rrsp: { contributionsCents: 0, deductionLimitCents: 0 },
  fhsa: { contributionsCents: 0, roomCents: 0 },
  capitalGains: { line19900Cents: 0, line12700Cents: 0, sch3Warnings: [] },
};

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  const expectedGrossedUpEligible = Math.round(10_000_00 * (1 + ELIGIBLE_GROSS_UP_RATE));
  const expectedGrossedUpNonElig = Math.round(5_000_00 * (1 + NON_ELIGIBLE_GROSS_UP_RATE));
  const expectedTotalIncome =
    t1Fixture.t4.box14EmploymentIncomeCents +
    expectedGrossedUpEligible +
    expectedGrossedUpNonElig +
    t1Fixture.t4aBox117Cents;
  expect(failures, "T1 totalIncome identity", r.totalIncomeCents, expectedTotalIncome);
  record("T1 · totalIncome ≡ box14 + grossedUp(eligible) + grossedUp(non-elig) + box117", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  const expectedDeduction = Math.round(t1Fixture.t4.box16CppBaseCents * CPP_ENHANCED_DEDUCTION_FRACTION);
  expect(failures, "CPP enhanced deduction (s.60(e))", r.cppEnhancedDeductionCents, expectedDeduction);
  record("T1 · CPP enhanced deduction = box16 × (1/5.95) — line 22215", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  expect(failures, "CPP2 full deduction (s.60(e.1))", r.cpp2DeductionCents, t1Fixture.t4.box16aCpp2Cents);
  record("T1 · CPP2 deduction = box16a (100%) — line 22200", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  const expectedCredit = Math.round(t1Fixture.t4.box16CppBaseCents * CPP_BASE_CREDIT_FRACTION);
  expect(failures, "Federal CPP base credit (line 30800)", r.federal.cppBaseAmountCents, expectedCredit);
  expect(failures, "Ontario CPP base credit (line 58240)", r.ontario.cppBaseAmountCents, expectedCredit);
  record("T1 · CPP base credit = box16 × (4.95/5.95) — lines 30800 + 58240", failures);
}

{
  const failures: string[] = [];
  const gEligible = dividendGrossUp(12_345_67, ELIGIBLE_GROSS_UP_RATE);
  expect(failures, "eligible 38% gross-up", gEligible, Math.round(12_345_67 * 1.38));
  const gNonElig = dividendGrossUp(12_345_67, NON_ELIGIBLE_GROSS_UP_RATE);
  expect(failures, "non-eligible 15% gross-up", gNonElig, Math.round(12_345_67 * 1.15));
  record("T1 · dividend gross-up: eligible 38%, non-eligible 15%", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  const grossEligible = Math.round(10_000_00 * 1.38);
  const grossNonElig = Math.round(5_000_00 * 1.15);
  expect(
    failures,
    "federal DTC eligible (15.0198% of grossed-up)",
    r.federal.dtcEligibleCents,
    Math.round(grossEligible * FEDERAL_DTC_ELIGIBLE_RATE),
  );
  expect(
    failures,
    "federal DTC non-eligible (9.0301% of grossed-up)",
    r.federal.dtcNonEligibleCents,
    Math.round(grossNonElig * FEDERAL_DTC_NON_ELIGIBLE_RATE),
  );
  record("T1 · federal DTC: 15.0198% eligible + 9.0301% non-elig (of grossed-up)", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  const grossEligible = Math.round(10_000_00 * 1.38);
  const grossNonElig = Math.round(5_000_00 * 1.15);
  expect(
    failures,
    "Ontario DTC eligible (10% of grossed-up)",
    r.ontario.dtcEligibleCents,
    Math.round(grossEligible * ONTARIO_DTC_ELIGIBLE_RATE),
  );
  expect(
    failures,
    "Ontario DTC non-eligible (2.9863% of grossed-up 2026)",
    r.ontario.dtcNonEligibleCents,
    Math.round(grossNonElig * ONTARIO_DTC_NON_ELIGIBLE_RATE_2026),
  );
  record("T1 · Ontario DTC: 10% eligible + 2.9863% non-elig (2026, of grossed-up)", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  expect(
    failures,
    "totalTaxPayable = federal + Ontario",
    r.totalTaxPayableCents,
    r.federal.federalTaxPayableCents + r.ontario.ontarioTaxPayableCents,
  );
  record("T1 · totalTaxPayable ≡ federal + Ontario (line 43500)", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  expect(
    failures,
    "refundOrOwing = totalTax − withheld − cpp2Overpayment",
    r.refundOrOwingCents,
    r.totalTaxPayableCents - r.totalWithheldCents - r.cpp2OverpaymentCents,
  );
  expect(
    failures,
    "totalWithheld = box22 + Ontario withheld",
    r.totalWithheldCents,
    t1Fixture.t4.box22FedTaxWithheldCents + t1Fixture.t4.ontarioTaxWithheldCents,
  );
  record("T1 · refund/owing identity and totalWithheld ≡ box22 + Ontario withheld", failures);
}

{
  const r = computeT1(t1Fixture);
  const failures: string[] = [];
  expect(
    failures,
    "combined marginal bps = fed + Ontario",
    r.marginalRateCombinedBps,
    r.marginalRateFedBps + r.marginalRateOnBps,
  );
  // marginalRateAt at a bracket boundary
  const atFedBrk2 = marginalRateAt(58_524_00);
  expect(failures, "fed bracket 2 rate at $58,524", atFedBrk2.federalBps, 2050);
  // marginalRateOnNextDollar plausibility — low-income bump is in ~14-20% + ~5-9% range
  const marg = marginalRateOnNextDollar(t1Fixture, 100_00);
  if (marg.combinedBps < 1500 || marg.combinedBps > 5000) {
    failures.push(`marginalRateOnNextDollar plausibility: got ${marg.combinedBps} bps`);
  }
  record("T1 · marginalRateAt + marginalRateOnNextDollar identity + plausibility", failures);
}

// ——— Phase 6 planner coherence ———

(() => {
  const failures: string[] = [];
  const base: ScenarioInput = {
    fiscalYear: 2026,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    projectedRevenueCents: 200_000_00,
    projectedOpexCents: 10_000_00,
    salaryCents: 0,
    eligibleDividendCents: 0,
    nonEligibleDividendCents: 0,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
  };

  // (1) Zero-mix planner ≡ /corp-tax T2 façade with same inputs
  const zeroMix = simulateScenario(base);
  const t2Direct = estimateT2Detailed({
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
    isCcpc: true,
    revenueCents: base.projectedRevenueCents,
    operatingExpensesCents: base.projectedOpexCents,
    salaryCents: 0,
    employerCppCents: 0,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
  });
  expect(
    failures,
    "planner zero-mix corpTax ≡ estimateT2Detailed totalTax",
    zeroMix.corpTaxCents,
    t2Direct.totalTaxCents,
    0,
  );
  // Zero-mix personal tax floors at 0 (no income flows to T1)
  expect(failures, "planner zero-mix personalTax = 0", zeroMix.personalTaxCents, 0, 0);

  record("Planner · zero-mix ≡ /corp-tax T2 façade (no double-count)", failures);
})();

(() => {
  const failures: string[] = [];
  // (2) synthesizeT4($74,600, 12) sum ≡ 12-paycheque manual loop via computePayroll
  const salary = PLAN_YMPE * 100;
  const synth = synthesizeT4(salary, 12);
  let ytdCpp = 0, ytdCpp2 = 0, ytdGross = 0;
  let box14 = 0, box16 = 0, box16a = 0, box22 = 0, onTax = 0;
  const basePer = Math.floor(salary / 12);
  const residual = salary - basePer * 12;
  for (let i = 0; i < 12; i++) {
    const per = i === 11 ? basePer + residual : basePer;
    const s = computePayroll({
      grossCents: per,
      ytdCppCents: ytdCpp,
      ytdCpp2Cents: ytdCpp2,
      ytdGrossCents: ytdGross,
      payPeriodsPerYear: 12,
    });
    box14 += s.grossCents; box16 += s.cppCents; box16a += s.cpp2Cents;
    box22 += s.federalTaxCents; onTax += s.provincialTaxCents;
    ytdCpp += s.cppCents; ytdCpp2 += s.cpp2Cents; ytdGross += s.grossCents;
  }
  expect(failures, "synthT4 box14 identity", synth.box14EmploymentIncomeCents, box14, 0);
  expect(failures, "synthT4 CPP1 identity", synth.box16CppBaseCents, box16, 0);
  expect(failures, "synthT4 CPP2 identity", synth.box16aCpp2Cents, box16a, 0);
  expect(failures, "synthT4 fed tax identity", synth.box22FedTaxWithheldCents, box22, 0);
  expect(failures, "synthT4 ON tax identity", synth.ontarioTaxWithheldCents, onTax, 0);
  record("Planner · synthesizeT4(YMPE, 12) ≡ 12× computePayroll loop", failures);
})();

(() => {
  const failures: string[] = [];
  // (3) totalHouseholdTax ≡ corpTax + personalTax across a realistic mix
  const s = simulateScenario({
    fiscalYear: 2026,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    projectedRevenueCents: 180_000_00,
    projectedOpexCents: 12_000_00,
    salaryCents: 70_000_00,
    eligibleDividendCents: 0,
    nonEligibleDividendCents: 20_000_00,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
  });
  expect(
    failures,
    "planner no-double-count",
    s.totalHouseholdTaxCents,
    s.corpTaxCents + s.personalTaxCents,
    0,
  );
  record("Planner · totalHouseholdTax = corpTax + personalTax (no double-count)", failures);
})();

(() => {
  const failures: string[] = [];
  // (4) canonicalInputJson stability — distinct construction orders produce same string
  const a: ScenarioInput = {
    fiscalYear: 2026,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    projectedRevenueCents: 150_000_00,
    projectedOpexCents: 10_000_00,
    salaryCents: 74_600_00,
    eligibleDividendCents: 5_000_00,
    nonEligibleDividendCents: 10_000_00,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
  };
  const b: ScenarioInput = {
    nonEligibleDividendCents: 10_000_00,
    eligibleDividendCents: 5_000_00,
    salaryCents: 74_600_00,
    projectedOpexCents: 10_000_00,
    projectedRevenueCents: 150_000_00,
    periodEnd: "2026-12-31",
    periodStart: "2026-01-01",
    fiscalYear: 2026,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
  };
  expectEq(failures, "canonicalInputJson stable across key order", canonicalInputJson(a), canonicalInputJson(b));
  record("Planner · canonicalInputJson stability (drift-detection)", failures);
})();

(() => {
  const failures: string[] = [];
  // (5) Cash waterfall identity — corp net-income-for-tax = revenue − opex − salary − ERcpp − cca
  const r = simulateScenario({
    fiscalYear: 2026,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    projectedRevenueCents: 160_000_00,
    projectedOpexCents: 8_000_00,
    salaryCents: 60_000_00,
    eligibleDividendCents: 0,
    nonEligibleDividendCents: 15_000_00,
    ccaClaimedCents: 0,
    priorYearAaiiCents: 0,
    openingGripCents: 0,
  });
  const erCpp = r.syntheticT4.box16CppBaseCents + r.syntheticT4.box16aCpp2Cents;
  const expected = 160_000_00 - 8_000_00 - 60_000_00 - erCpp - 0;
  expect(
    failures,
    "planner corp net-income-for-tax identity",
    r.corpNetIncomeForTaxCents,
    expected,
    2,
  );
  record("Planner · cash-waterfall (corp net = revenue − opex − salary − ERcpp − cca)", failures);
})();

// ═════════════════════════════════════════════════════════════════════════
// SLIP · T4 / T5 source identity — what lands on a filed slip MUST be what
// the T1 / dashboard / planner / corp-tax paths read. Drift between these
// is the exact class of bug the filing lock can't catch.
// ═════════════════════════════════════════════════════════════════════════

(() => {
  const failures: string[] = [];
  // Synthetic T4 raw sums — same shape the DB aggregator t4BoxesForYear produces.
  const rawT4: SlipT4Input = {
    box14EmploymentIncomeCents: 74_600_00,
    box16CppBaseCents: 4_034_10,
    box16aCpp2Cents: 396_00,
    box18EiCents: 0,
    box22FedTaxWithheldCents: 9_500_00,
    box24EiInsurableCents: 0,
    box26CppPensionableCents: 71_300_00,
    box52PensionAdjustmentCents: 0,
    ontarioTaxWithheldCents: 3_200_00,
    employerCppBaseCents: 4_034_10,
    employerCpp2Cents: 396_00,
    count: 12,
  };

  // (1) Slip box14 === T1 input box14 — drift-guard.
  const slipT4 = t4SlipBoxesFromRaw(rawT4, 2026);
  expectEq(failures, "slip box14 ≡ raw box14", slipT4.box14EmploymentIncomeCents, rawT4.box14EmploymentIncomeCents);
  expectEq(failures, "slip box16 ≡ raw box16", slipT4.box16CppBaseCents, rawT4.box16CppBaseCents);
  expectEq(failures, "slip box16a ≡ raw box16a", slipT4.box16aCpp2Cents, rawT4.box16aCpp2Cents);
  expectEq(failures, "slip box22 ≡ raw box22", slipT4.box22FedTaxWithheldCents, rawT4.box22FedTaxWithheldCents);
  expectEq(failures, "slip box26 ≡ raw box26", slipT4.box26CppPensionableCents, rawT4.box26CppPensionableCents);
  expectEq(failures, "slip ON withheld ≡ raw ON withheld", slipT4.ontarioTaxWithheldCents, rawT4.ontarioTaxWithheldCents);

  // (2) Feeding the SAME raw into computeT1 must use the SAME values. Slip → T1 → slip round-trip.
  const t1 = computeT1({
    taxYear: 2026,
    t4: rawT4,
    t5: { eligibleActualCents: 0, nonEligibleActualCents: 0 },
    t4aBox117Cents: 0,
    donations: { totalCents: 0 },
    rrsp: { contributionsCents: 0, deductionLimitCents: 0 },
    fhsa: { contributionsCents: 0, roomCents: 0 },
    capitalGains: { line19900Cents: 0, line12700Cents: 0, sch3Warnings: [] },
  });
  // T1 line 10100/15000 employment-income floor MUST include the full box14 from the slip.
  // totalIncomeCents >= box14 (the slip value). Use >= because T1 also adds dividends / box117.
  if (t1.totalIncomeCents < slipT4.box14EmploymentIncomeCents) {
    failures.push(`T1 totalIncome (${formatCAD(t1.totalIncomeCents)}) < slip box14 (${formatCAD(slipT4.box14EmploymentIncomeCents)}) — slip not fully flowing through`);
  }
  // With no dividends + no box117, totalIncome should equal box14 exactly (CPP enhanced deduction + CPP2 deduction come later).
  expectEq(failures, "T1 totalIncome ≡ slip box14 (employment-only fixture)", t1.totalIncomeCents, slipT4.box14EmploymentIncomeCents);
  record("Slip · T4 box values ≡ raw sums ≡ T1 source", failures);
})();

(() => {
  const failures: string[] = [];
  const rawT5: SlipT5Input = {
    eligible: { actualCents: 12_000_00, count: 2 },
    nonEligible: { actualCents: 8_000_00, count: 3 },
  };

  const slipT5 = t5SlipBoxesFromRaw(rawT5, 2026);
  const t1 = computeT1({
    taxYear: 2026,
    t4: {
      box14EmploymentIncomeCents: 0,
      box16CppBaseCents: 0,
      box16aCpp2Cents: 0,
      box18EiCents: 0,
      box22FedTaxWithheldCents: 0,
      box24EiInsurableCents: 0,
      box26CppPensionableCents: 0,
      box52PensionAdjustmentCents: 0,
      ontarioTaxWithheldCents: 0,
    },
    t5: {
      eligibleActualCents: rawT5.eligible.actualCents,
      nonEligibleActualCents: rawT5.nonEligible.actualCents,
    },
    t4aBox117Cents: 0,
    donations: { totalCents: 0 },
    rrsp: { contributionsCents: 0, deductionLimitCents: 0 },
    fhsa: { contributionsCents: 0, roomCents: 0 },
    capitalGains: { line19900Cents: 0, line12700Cents: 0, sch3Warnings: [] },
  });

  // (3) Slip Box 24 (eligible actual) === raw (no loss).
  expectEq(failures, "slip T5 box24 ≡ raw eligible actual", slipT5.eligible.actualCents, rawT5.eligible.actualCents);
  expectEq(failures, "slip T5 box10 ≡ raw non-eligible actual", slipT5.nonEligible.actualCents, rawT5.nonEligible.actualCents);

  // (4) Slip gross-up === T1 gross-up on the same actuals. No drift between slip and T1 math.
  const elGuExpected = dividendGrossUp(rawT5.eligible.actualCents, ELIGIBLE_GROSS_UP_RATE);
  const neGuExpected = dividendGrossUp(rawT5.nonEligible.actualCents, NON_ELIGIBLE_GROSS_UP_RATE);
  expectEq(failures, "slip box25 ≡ dividendGrossUp(box24, 0.38)", slipT5.eligible.taxableCents, elGuExpected);
  expectEq(failures, "slip box11 ≡ dividendGrossUp(box10, 0.15)", slipT5.nonEligible.taxableCents, neGuExpected);

  // (5) Slip DTC === T1 DTC rate×taxable.
  expectEq(
    failures,
    "slip box26 ≡ dividendTaxCredit(box25, 0.150198)",
    slipT5.eligible.federalDtcCents,
    dividendTaxCredit(slipT5.eligible.taxableCents, FEDERAL_DTC_ELIGIBLE_RATE),
  );
  expectEq(
    failures,
    "slip box12 ≡ dividendTaxCredit(box11, 0.090301)",
    slipT5.nonEligible.federalDtcCents,
    dividendTaxCredit(slipT5.nonEligible.taxableCents, FEDERAL_DTC_NON_ELIGIBLE_RATE),
  );
  expectEq(
    failures,
    "slip ON eligible DTC ≡ dividendTaxCredit(box25, 0.10)",
    slipT5.eligible.ontarioDtcCents,
    dividendTaxCredit(slipT5.eligible.taxableCents, ONTARIO_DTC_ELIGIBLE_RATE),
  );
  expectEq(
    failures,
    "slip ON non-eligible DTC ≡ dividendTaxCredit(box11, 0.029863)",
    slipT5.nonEligible.ontarioDtcCents,
    dividendTaxCredit(slipT5.nonEligible.taxableCents, ONTARIO_DTC_NON_ELIGIBLE_RATE_2026),
  );

  // (6) T1 totalIncome = box14(0) + eligibleGrossedUp + nonElGrossedUp + box117(0) → sanity the gross-up reaches T1.
  expectEq(failures, "T1 totalIncome ≡ slip taxable total (no other sources)", t1.totalIncomeCents, slipT5.totals.taxableCents);
  record("Slip · T5 box values ≡ raw actuals + shared gross-up / DTC math ≡ T1 source", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Cross-feature coherence verification ===\n");
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
