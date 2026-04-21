/**
 * Verifies the dashboard metric functions with canonical scenarios covering
 * the 12-month revenue sparkline window, Ontario-rate proration across the
 * 2026-07-01 transition, T2 estimates, and the cash-position formula.
 *
 * Run: `pnpm verify-dashboard`. Fails the process (exit 1) on any mismatch.
 */

import {
  revenueByMonth,
  ontarioSmallBizRate,
  estimateT2,
  estimateCashPosition,
  operatingExpensesForT2,
  FED_SBD_RATE,
  type RevenueInvoiceSlice,
  type ExpenseSlice,
} from "../src/lib/dashboard-metrics";
import { formatCAD } from "../src/lib/utils";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}

function near(a: number, b: number, tol = 0): boolean {
  return Math.abs(a - b) <= tol;
}

function inv(
  issueDate: string,
  subtotalCents: number,
  status: RevenueInvoiceSlice["status"] = "paid",
): RevenueInvoiceSlice {
  return { issueDate, subtotalCents, status };
}

// ——— revenueByMonth ———

(() => {
  const invoices: RevenueInvoiceSlice[] = [
    inv("2026-01-15", 10_000_00),
    inv("2026-01-28", 5_000_00),
    inv("2026-02-15", 20_000_00),
    inv("2026-06-01", 15_000_00),
    inv("2025-07-20", 8_000_00),
    inv("2025-12-31", 7_000_00),
    inv("2024-12-01", 99_999_99, "paid"), // before window — excluded
    inv("2026-06-10", 99_999_99, "void"), // void excluded
    inv("2026-06-10", 99_999_99, "draft"), // draft excluded
  ];
  const series = revenueByMonth(invoices, "2026-06");
  const failures: string[] = [];
  if (series.length !== 12) failures.push(`expected 12 buckets, got ${series.length}`);
  if (series[0]!.month !== "2025-07") failures.push(`oldest should be 2025-07, got ${series[0]!.month}`);
  if (series[11]!.month !== "2026-06") failures.push(`newest should be 2026-06, got ${series[11]!.month}`);
  // Jul 2025 = 8000
  if (series[0]!.cents !== 8_000_00)
    failures.push(`Jul 2025: want ${formatCAD(8_000_00)}, got ${formatCAD(series[0]!.cents)}`);
  // Dec 2025 = 7000
  if (series[5]!.cents !== 7_000_00)
    failures.push(`Dec 2025: want ${formatCAD(7_000_00)}, got ${formatCAD(series[5]!.cents)}`);
  // Jan 2026 = 15000 (sum of two)
  if (series[6]!.cents !== 15_000_00)
    failures.push(`Jan 2026: want ${formatCAD(15_000_00)}, got ${formatCAD(series[6]!.cents)}`);
  // Feb 2026 = 20000
  if (series[7]!.cents !== 20_000_00)
    failures.push(`Feb 2026: want ${formatCAD(20_000_00)}, got ${formatCAD(series[7]!.cents)}`);
  // Jun 2026 = 15000 (void + draft excluded)
  if (series[11]!.cents !== 15_000_00)
    failures.push(`Jun 2026: want ${formatCAD(15_000_00)}, got ${formatCAD(series[11]!.cents)}`);
  record("revenueByMonth: 12-bucket rolling window, void/draft excluded", failures);
})();

(() => {
  // Year rollover: endMonth Feb 2026 → window Mar 2025 … Feb 2026
  const series = revenueByMonth([inv("2025-03-01", 1_00)], "2026-02");
  const failures: string[] = [];
  if (series[0]!.month !== "2025-03") failures.push(`expected 2025-03, got ${series[0]!.month}`);
  if (series[11]!.month !== "2026-02") failures.push(`expected 2026-02, got ${series[11]!.month}`);
  if (series[0]!.cents !== 1_00) failures.push(`first bucket value mismatch`);
  record("revenueByMonth: year rollover window", failures);
})();

// ——— Ontario rate proration ———

(() => {
  const failures: string[] = [];
  // FY 2025: entirely before transition → 3.2%
  const rPre = ontarioSmallBizRate("2025-01-01", "2025-12-31");
  if (!near(rPre, 0.032, 1e-9))
    failures.push(`pre-transition: want 3.2%, got ${(rPre * 100).toFixed(4)}%`);
  record("ontarioSmallBizRate: FY entirely before 2026-07-01 → 3.2%", failures);
})();

(() => {
  const failures: string[] = [];
  // FY 2027: entirely after transition → 2.2%
  const rPost = ontarioSmallBizRate("2027-01-01", "2027-12-31");
  if (!near(rPost, 0.022, 1e-9))
    failures.push(`post-transition: want 2.2%, got ${(rPost * 100).toFixed(4)}%`);
  record("ontarioSmallBizRate: FY entirely after 2026-07-01 → 2.2%", failures);
})();

(() => {
  const failures: string[] = [];
  // FY 2026 Dec-31 FYE: 181 days @ 3.2% + 184 days @ 2.2% / 365
  const r = ontarioSmallBizRate("2026-01-01", "2026-12-31");
  const expected = (181 * 0.032 + 184 * 0.022) / 365;
  if (!near(r, expected, 1e-9))
    failures.push(
      `FY 2026 blended: want ${(expected * 100).toFixed(4)}%, got ${(r * 100).toFixed(4)}%`,
    );
  // Sanity: must land between 2.2 and 3.2
  if (r <= 0.022 || r >= 0.032)
    failures.push(`blended rate ${(r * 100).toFixed(4)}% out of bounds (2.2, 3.2)`);
  record("ontarioSmallBizRate: FY 2026 Dec-31 FYE straddles transition", failures);
})();

(() => {
  const failures: string[] = [];
  // FYE Oct-31 corp, FY 2026 = Nov 1 2025 → Oct 31 2026
  // Days before 2026-07-01: Nov 1 2025 → Jun 30 2026 inclusive = 242 days
  // Days after: Jul 1 2026 → Oct 31 2026 inclusive = 123 days
  const r = ontarioSmallBizRate("2025-11-01", "2026-10-31");
  const expected = (242 * 0.032 + 123 * 0.022) / 365;
  if (!near(r, expected, 1e-9))
    failures.push(
      `Oct-31 FYE FY2026: want ${(expected * 100).toFixed(4)}%, got ${(r * 100).toFixed(4)}%`,
    );
  record("ontarioSmallBizRate: Oct-31 FYE corp straddles transition", failures);
})();

// ——— operatingExpensesForT2 ———

(() => {
  const failures: string[] = [];
  const expenses: ExpenseSlice[] = [
    { category: "software_subscriptions", subtotalCents: 1_000_00, totalCents: 1_130_00 },
    { category: "meals_entertainment", subtotalCents: 800_00, totalCents: 904_00 },
    { category: "capital_asset", subtotalCents: 50_000_00, totalCents: 56_500_00 },
  ];
  const total = operatingExpensesForT2(expenses);
  // 1000 + 800×0.5 + 0 = 1400
  const expected = 1_000_00 + 400_00;
  if (total !== expected)
    failures.push(`deductible: want ${formatCAD(expected)}, got ${formatCAD(total)}`);
  record("operatingExpensesForT2: meals capped, capital excluded", failures);
})();

// ——— estimateT2 ———

(() => {
  const failures: string[] = [];
  // Zero taxable income → zero tax
  const t = estimateT2({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    revenueCents: 0,
    operatingExpensesCents: 0,
    salaryCents: 0,
    employerCppCents: 0,
  });
  if (t.totalTaxCents !== 0) failures.push(`empty FY: want 0 tax, got ${formatCAD(t.totalTaxCents)}`);
  if (t.taxableIncomeCents !== 0) failures.push(`empty FY: taxable income should be 0`);
  record("estimateT2: empty FY → zero tax", failures);
})();

(() => {
  const failures: string[] = [];
  // $200K revenue, $10K expenses, $80K salary, $5K employer CPP → $105K taxable
  const t = estimateT2({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    revenueCents: 200_000_00,
    operatingExpensesCents: 10_000_00,
    salaryCents: 80_000_00,
    employerCppCents: 5_000_00,
  });
  const taxable = 105_000_00;
  if (t.taxableIncomeCents !== taxable)
    failures.push(`taxable: want ${formatCAD(taxable)}, got ${formatCAD(t.taxableIncomeCents)}`);
  const expectedFed = Math.round(taxable * FED_SBD_RATE);
  if (!near(t.fedTaxCents, expectedFed, 1))
    failures.push(`fed: want ${formatCAD(expectedFed)}, got ${formatCAD(t.fedTaxCents)}`);
  const onRate = (181 * 0.032 + 184 * 0.022) / 365;
  const expectedOn = Math.round(taxable * onRate);
  if (!near(t.ontarioTaxCents, expectedOn, 1))
    failures.push(`ON: want ${formatCAD(expectedOn)}, got ${formatCAD(t.ontarioTaxCents)}`);
  if (!near(t.totalTaxCents, expectedFed + expectedOn, 1))
    failures.push(
      `total: want ${formatCAD(expectedFed + expectedOn)}, got ${formatCAD(t.totalTaxCents)}`,
    );
  if (t.sbdLimitWarning) failures.push(`SBD limit should not be flagged at $105K`);
  record("estimateT2: $200K revenue / $80K salary → ~$11.7K tax", failures);
})();

(() => {
  const failures: string[] = [];
  // Negative gross → clamps to 0
  const t = estimateT2({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    revenueCents: 50_000_00,
    operatingExpensesCents: 10_000_00,
    salaryCents: 80_000_00,
    employerCppCents: 5_000_00,
  });
  if (t.totalTaxCents !== 0)
    failures.push(`negative gross: tax should floor at 0, got ${formatCAD(t.totalTaxCents)}`);
  record("estimateT2: loss year → taxable income floors at 0", failures);
})();

(() => {
  const failures: string[] = [];
  // $600K taxable → SBD warning
  const t = estimateT2({
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    revenueCents: 600_000_00,
    operatingExpensesCents: 0,
    salaryCents: 0,
    employerCppCents: 0,
  });
  if (!t.sbdLimitWarning)
    failures.push(`$600K taxable should trip the SBD warning`);
  record("estimateT2: $600K taxable flags SBD limit warning", failures);
})();

// ——— estimateCashPosition ———

(() => {
  const failures: string[] = [];
  // Clean scenario: HST owed (positive), no refund
  const c = estimateCashPosition({
    revenueTotalCents: 226_000_00, // $200K + $26K HST
    expensesTotalCents: 11_300_00, // $10K + $1.3K HST
    salaryGrossCents: 80_000_00,
    employerCppCents: 5_000_00,
    dividendsCents: 20_000_00,
    t2EstimateCents: 11_700_00,
    hstNetCents: 24_700_00, // $26K collected - $1.3K ITC
  });
  // inflow: revenueTotal = 226_000_00
  // outflow: 11_300 + 80_000 + 5_000 + 20_000 + 11_700 + 24_700 = 152_700_00
  // net: 73_300_00
  if (c.inflowCents !== 226_000_00)
    failures.push(`inflow: want ${formatCAD(226_000_00)}, got ${formatCAD(c.inflowCents)}`);
  const expectedOutflow =
    11_300_00 + 80_000_00 + 5_000_00 + 20_000_00 + 11_700_00 + 24_700_00;
  if (c.outflowCents !== expectedOutflow)
    failures.push(
      `outflow: want ${formatCAD(expectedOutflow)}, got ${formatCAD(c.outflowCents)}`,
    );
  if (c.netCents !== 226_000_00 - expectedOutflow)
    failures.push(`net: got ${formatCAD(c.netCents)}`);
  record("estimateCashPosition: HST owed → net = revenue - obligations", failures);
})();

(() => {
  const failures: string[] = [];
  // HST refund scenario: net is negative (refund incoming)
  const c = estimateCashPosition({
    revenueTotalCents: 11_300_00, // tiny revenue
    expensesTotalCents: 113_000_00, // big capital purchase
    salaryGrossCents: 0,
    employerCppCents: 0,
    dividendsCents: 0,
    t2EstimateCents: 0,
    hstNetCents: -11_700_00, // refund
  });
  // inflow: revenue + max(0, -hstNet) = 11_300 + 11_700 = 23_000
  // outflow: 113_000 + 0 + max(0, hstNet=-11700) = 113_000 + 0 = 113_000
  // net: 23_000 - 113_000 = -90_000
  if (c.inflowCents !== 23_000_00)
    failures.push(`refund inflow: want ${formatCAD(23_000_00)}, got ${formatCAD(c.inflowCents)}`);
  if (c.outflowCents !== 113_000_00)
    failures.push(`refund outflow: want ${formatCAD(113_000_00)}, got ${formatCAD(c.outflowCents)}`);
  if (c.netCents !== -90_000_00)
    failures.push(`refund net: want ${formatCAD(-90_000_00)}, got ${formatCAD(c.netCents)}`);
  record("estimateCashPosition: HST refund adds to inflow side", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Dashboard metric verification ===\n");
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
