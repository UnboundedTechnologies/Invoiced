/**
 * Verifies the HST return compute engine with canonical scenarios covering
 * both Regular and Quick Method, the meals 50% ITC cap (ETA s.236), the
 * capital-asset ITC passthrough under QM, and the eligibility gate.
 *
 * Run: `pnpm verify-hst`. Fails the process (exit 1) on any mismatch.
 */

import {
  aggregateRegular,
  aggregateQuickMethod,
  quickMethodBreakEven,
  canUseQuickMethod,
  hstPeriodFor,
  hstFilingDueDate,
  type InvoiceSlice,
  type ExpenseSlice,
} from "../src/lib/hst";
import { formatCAD } from "../src/lib/utils";

type Scenario = {
  name: string;
  fiscalYear: number;
  invoices: InvoiceSlice[];
  expenses: ExpenseSlice[];
  expect: {
    regular?: Partial<{
      line101: number;
      line103: number;
      line105: number;
      line106Raw: number;
      line107: number;
      line108: number;
      line109: number;
    }>;
    quick?: Partial<{
      line101: number;
      line103: number;
      line105: number;
      line106Capital: number;
      line108: number;
      line109: number;
      quickCredit: number;
    }>;
    recommendation?: "quick" | "regular" | "wash";
    isFirstQmFy?: boolean;
  };
};

const FYE = { month: 12, day: 31 };

// Helper to stamp an invoice inside FY 2026 (Dec-31 FYE).
function inv(
  id: string,
  subtotal: number,
  hst: number,
  issueDate = "2026-06-15",
  status: InvoiceSlice["status"] = "paid",
): InvoiceSlice {
  return {
    id,
    invoiceNumber: `UT-${id}`,
    issueDate,
    subtotalCents: subtotal,
    hstCents: hst,
    totalCents: subtotal + hst,
    status,
  };
}

function exp(
  id: string,
  category: string,
  subtotal: number,
  hstPaid: number,
  expenseDate = "2026-06-15",
): ExpenseSlice {
  return {
    id,
    expenseDate,
    vendor: `Vendor ${id}`,
    category,
    subtotalCents: subtotal,
    hstPaidCents: hstPaid,
    totalCents: subtotal + hstPaid,
  };
}

const scenarios: Scenario[] = [
  {
    name: "1) Basic Regular: $200K revenue, $10K operating expenses, no meals",
    fiscalYear: 2026,
    invoices: [inv("A", 200_000_00, 26_000_00)],
    expenses: [exp("E1", "software_subscriptions", 10_000_00, 1_300_00)],
    expect: {
      regular: {
        line101: 200_000_00,
        line103: 26_000_00,
        line105: 26_000_00,
        line106Raw: 1_300_00,
        line107: 0,
        line108: 1_300_00,
        line109: 24_700_00,
      },
      quick: {
        line101: 200_000_00,
        // 8.8% × (200K + 26K) = 8.8% × 226K = 19,888
        line103: 19_888_00,
        line105: 19_888_00,
        line106Capital: 0,
        line108: 0,
        line109: 19_888_00,
        quickCredit: 0,
      },
      recommendation: "quick",
      isFirstQmFy: false,
    },
  },
  {
    name: "2) Meals 50% cap: $3K meals + $390 HST → line 107 = -$195",
    fiscalYear: 2026,
    invoices: [inv("A", 200_000_00, 26_000_00)],
    expenses: [
      exp("E1", "software_subscriptions", 10_000_00, 1_300_00),
      exp("M1", "meals_entertainment", 3_000_00, 390_00),
    ],
    expect: {
      regular: {
        line106Raw: 1_690_00,     // 1,300 + 390
        line107: -195_00,         // -50% × 390
        line108: 1_495_00,        // 1,690 - 195
        line109: 24_505_00,       // 26,000 - 1,495
      },
    },
  },
  {
    name: "3) Capital asset ITC passthrough under QM",
    fiscalYear: 2026,
    invoices: [inv("A", 200_000_00, 26_000_00)],
    expenses: [exp("CAP", "capital_asset", 50_000_00, 6_500_00)],
    expect: {
      regular: {
        line106Raw: 6_500_00,
        line108: 6_500_00,
        line109: 19_500_00,
      },
      quick: {
        line103: 19_888_00,
        line106Capital: 6_500_00,
        line108: 6_500_00,
        line109: 13_388_00,
        quickCredit: 0,
      },
    },
  },
  {
    name: "4) Empty FY: no invoices, no expenses → all zeros, recommendation wash",
    fiscalYear: 2026,
    invoices: [],
    expenses: [],
    expect: {
      regular: { line101: 0, line103: 0, line105: 0, line108: 0, line109: 0 },
      quick: { line101: 0, line103: 0, line105: 0, line108: 0, line109: 0 },
      recommendation: "wash",
    },
  },
  {
    name: "5) First-year QM credit: $50K revenue, first-year elector → $300 credit",
    fiscalYear: 2026,
    invoices: [inv("A", 50_000_00, 6_500_00)],
    expenses: [],
    expect: {
      // QM remittance before credit = 8.8% × (50K + 6.5K) = 8.8% × 56.5K = 4,972
      // Credit = 1% × min($30K HST-incl, $56.5K) = 1% × $30K = $300, capped at $300
      quick: {
        line103: 4_672_00,  // 4,972 - 300
        line105: 4_672_00,
        line106Capital: 0,
        line108: 0,
        line109: 4_672_00,
        quickCredit: 300_00,
      },
      isFirstQmFy: true,
    },
  },
  {
    name: "6) Void + draft invoices filtered: only sent/paid/overdue count",
    fiscalYear: 2026,
    invoices: [
      inv("PAID", 100_000_00, 13_000_00, "2026-03-15", "paid"),
      inv("VOID", 50_000_00, 6_500_00, "2026-04-10", "void"),
      inv("DRAFT", 40_000_00, 5_200_00, "2026-05-01", "draft"),
    ],
    expenses: [],
    expect: {
      regular: {
        line101: 100_000_00,   // only PAID — a draft is not yet a taxable supply, void cancelled
        line103: 13_000_00,
        line109: 13_000_00,
      },
    },
  },
  {
    name: "7) Out-of-period rows ignored (dates outside FY 2026 period)",
    fiscalYear: 2026,
    invoices: [
      inv("IN", 100_000_00, 13_000_00, "2026-06-15"),
      inv("PRE", 999_999_99, 999_999_99, "2025-12-31"),   // last day of FY 2025
      inv("POST", 999_999_99, 999_999_99, "2027-01-01"),  // first day of FY 2027
    ],
    expenses: [
      exp("IN", "software_subscriptions", 1_000_00, 130_00, "2026-06-15"),
      exp("PRE", "software_subscriptions", 999_99, 99_99, "2025-12-31"),
      exp("POST", "software_subscriptions", 999_99, 99_99, "2027-01-01"),
    ],
    expect: {
      regular: {
        line101: 100_000_00,
        line106Raw: 130_00,
        line109: 13_000_00 - 130_00,
      },
    },
  },
];

// ——— eligibility + deadline sub-tests ———

function runEligibilityChecks(): string[] {
  const failures: string[] = [];
  if (canUseQuickMethod(0) !== true) failures.push("eligibility: first-year corp (0) should be eligible");
  if (canUseQuickMethod(399_999_99) !== true) failures.push("eligibility: $399,999.99 should be eligible (≤ cap)");
  if (canUseQuickMethod(400_000_00) !== true) failures.push("eligibility: exactly $400K should be eligible (boundary inclusive)");
  if (canUseQuickMethod(400_000_01) !== false) failures.push("eligibility: $400,000.01 should be ineligible");
  return failures;
}

function runPeriodChecks(): string[] {
  const failures: string[] = [];
  const p = hstPeriodFor(2026, 12, 31);
  if (p.start !== "2026-01-01") failures.push(`period: FY2026 Dec-31 FYE start should be 2026-01-01, got ${p.start}`);
  if (p.end !== "2026-12-31") failures.push(`period: FY2026 Dec-31 FYE end should be 2026-12-31, got ${p.end}`);
  const due = hstFilingDueDate("2026-12-31");
  if (due !== "2027-03-31") failures.push(`due date: Dec-31 FYE should have 2027-03-31 due date (3mo after), got ${due}`);
  // Non-Dec FYE (Oct 31)
  const p2 = hstPeriodFor(2026, 10, 31);
  if (p2.start !== "2025-11-01") failures.push(`period: FY2026 Oct-31 FYE start should be 2025-11-01, got ${p2.start}`);
  if (p2.end !== "2026-10-31") failures.push(`period: FY2026 Oct-31 FYE end should be 2026-10-31, got ${p2.end}`);
  return failures;
}

// ——— runner ———

function check(actual: number, expected: number, tolCents = 0): boolean {
  return Math.abs(actual - expected) <= tolCents;
}

function runScenario(s: Scenario): string[] {
  const failures: string[] = [];
  const period = hstPeriodFor(s.fiscalYear, FYE.month, FYE.day);
  const isFirstQmFy = s.expect.isFirstQmFy ?? false;

  const reg = aggregateRegular({ invoices: s.invoices, expenses: s.expenses, period });
  const qm = aggregateQuickMethod({
    invoices: s.invoices,
    expenses: s.expenses,
    period,
    isFirstQmFy,
  });

  const r = s.expect.regular;
  if (r) {
    if (r.line101 !== undefined && !check(reg.line101Cents, r.line101))
      failures.push(`regular line 101: want ${formatCAD(r.line101)}, got ${formatCAD(reg.line101Cents)}`);
    if (r.line103 !== undefined && !check(reg.line103Cents, r.line103))
      failures.push(`regular line 103: want ${formatCAD(r.line103)}, got ${formatCAD(reg.line103Cents)}`);
    if (r.line105 !== undefined && !check(reg.line105Cents, r.line105))
      failures.push(`regular line 105: want ${formatCAD(r.line105)}, got ${formatCAD(reg.line105Cents)}`);
    if (r.line106Raw !== undefined && !check(reg.line106RawCents, r.line106Raw))
      failures.push(`regular line 106 raw: want ${formatCAD(r.line106Raw)}, got ${formatCAD(reg.line106RawCents)}`);
    if (r.line107 !== undefined && !check(reg.line107Cents, r.line107))
      failures.push(`regular line 107 (meals cap): want ${formatCAD(r.line107)}, got ${formatCAD(reg.line107Cents)}`);
    if (r.line108 !== undefined && !check(reg.line108Cents, r.line108))
      failures.push(`regular line 108: want ${formatCAD(r.line108)}, got ${formatCAD(reg.line108Cents)}`);
    if (r.line109 !== undefined && !check(reg.line109Cents, r.line109))
      failures.push(`regular line 109 (net): want ${formatCAD(r.line109)}, got ${formatCAD(reg.line109Cents)}`);
  }

  const q = s.expect.quick;
  if (q) {
    if (q.line101 !== undefined && !check(qm.line101Cents, q.line101))
      failures.push(`quick line 101: want ${formatCAD(q.line101)}, got ${formatCAD(qm.line101Cents)}`);
    if (q.line103 !== undefined && !check(qm.line103Cents, q.line103))
      failures.push(`quick line 103: want ${formatCAD(q.line103)}, got ${formatCAD(qm.line103Cents)}`);
    if (q.line105 !== undefined && !check(qm.line105Cents, q.line105))
      failures.push(`quick line 105: want ${formatCAD(q.line105)}, got ${formatCAD(qm.line105Cents)}`);
    if (q.line106Capital !== undefined && !check(qm.line106CapitalCents, q.line106Capital))
      failures.push(`quick line 106 (capital): want ${formatCAD(q.line106Capital)}, got ${formatCAD(qm.line106CapitalCents)}`);
    if (q.line108 !== undefined && !check(qm.line108Cents, q.line108))
      failures.push(`quick line 108: want ${formatCAD(q.line108)}, got ${formatCAD(qm.line108Cents)}`);
    if (q.line109 !== undefined && !check(qm.line109Cents, q.line109))
      failures.push(`quick line 109: want ${formatCAD(q.line109)}, got ${formatCAD(qm.line109Cents)}`);
    if (q.quickCredit !== undefined && !check(qm.quickCreditCents, q.quickCredit))
      failures.push(`quick credit: want ${formatCAD(q.quickCredit)}, got ${formatCAD(qm.quickCreditCents)}`);
  }

  if (s.expect.recommendation !== undefined) {
    const be = quickMethodBreakEven({
      invoices: s.invoices,
      expenses: s.expenses,
      period,
      isFirstQmFy,
    });
    if (be.recommendation !== s.expect.recommendation) {
      failures.push(
        `break-even recommendation: want ${s.expect.recommendation}, got ${be.recommendation} (Δ ${formatCAD(be.deltaCents)})`,
      );
    }
  }

  return failures;
}

function main() {
  let pass = 0;
  let fail = 0;

  console.log("\n=== HST math verification ===\n");

  const eligFailures = runEligibilityChecks();
  if (eligFailures.length === 0) {
    console.log("✓ eligibility gate");
    pass++;
  } else {
    console.log("✗ eligibility gate");
    eligFailures.forEach((f) => console.log(`    ${f}`));
    fail++;
  }

  const periodFailures = runPeriodChecks();
  if (periodFailures.length === 0) {
    console.log("✓ period + due date derivation");
    pass++;
  } else {
    console.log("✗ period + due date derivation");
    periodFailures.forEach((f) => console.log(`    ${f}`));
    fail++;
  }

  for (const s of scenarios) {
    const failures = runScenario(s);
    if (failures.length === 0) {
      console.log(`✓ ${s.name}`);
      pass++;
    } else {
      console.log(`✗ ${s.name}`);
      failures.forEach((f) => console.log(`    ${f}`));
      fail++;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
