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
import { computePsbRisk } from "../src/lib/psb";
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
  // Delta: $40K extra expenses × combined rate ≈ expected drop
  const expectedDrop = Math.round((50_000_00 - 10_000_00) * base.combinedRate);
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
