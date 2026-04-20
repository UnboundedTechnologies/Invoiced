/**
 * Verifies the end-to-end invoice math: business-day count, weekly → total
 * quantity derivation, subtotal in cents, HST rounding, and grand total.
 *
 * Run: `pnpm verify-math`. Fails the process (exit 1) on any mismatch so it
 * can be wired into pre-commit / CI.
 */

import {
  businessDaysBetweenISO,
  calculateHst,
  formatCAD,
  quantityFromWeekly,
} from "../src/lib/utils";

type Scenario = {
  name: string;
  periodStart: string;
  periodEnd: string;
  // Either explicit total quantity OR a weekly rate to derive it from.
  mode: "total" | "weekly";
  quantity?: number; // total mode
  perWeek?: number; // weekly mode
  rateCents: number;
  hstRateBps: number;
  hstApplicable: boolean;
  expected: {
    businessDays?: number;
    quantity?: number;
    subtotalCents: number;
    hstCents: number;
    totalCents: number;
  };
};

const scenarios: Scenario[] = [
  {
    name: "April 2026 @ 37.5 h/week, $125/h, HST 13% (ON)",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    mode: "weekly",
    perWeek: 37.5,
    rateCents: 12500,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 22, // Apr 2026: 8 weekend days → 22 weekdays
      quantity: 165, // 37.5 × (22 / 5) = 165
      subtotalCents: 2_062_500, // 165 × $125 = $20,625.00
      hstCents: 268_125, //  2,062,500 × 13% = $2,681.25
      totalCents: 2_330_625, //  $23,306.25
    },
  },
  {
    name: "Single Mon–Fri week @ 40 h/week, $140/h, HST 13%",
    periodStart: "2026-03-30", // Mon
    periodEnd: "2026-04-03", // Fri
    mode: "weekly",
    perWeek: 40,
    rateCents: 14000,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 5,
      quantity: 40,
      subtotalCents: 560_000, // $5,600.00
      hstCents: 72_800, //  $728.00
      totalCents: 632_800, // $6,328.00
    },
  },
  {
    name: "Two full weeks @ 37.5 h/week, odd rate $127.35, HST 13%",
    periodStart: "2026-03-30", // Mon
    periodEnd: "2026-04-10", // Fri
    mode: "weekly",
    perWeek: 37.5,
    rateCents: 12735,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 10,
      quantity: 75,
      // 75 × 12735 = 955,125 cents
      subtotalCents: 955_125,
      // 955,125 × 0.13 = 124,166.25 → round → 124,166
      hstCents: 124_166,
      totalCents: 1_079_291,
    },
  },
  {
    name: "Total mode: 163.24 h @ $125/h, HST 13%",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    mode: "total",
    quantity: 163.24,
    rateCents: 12500,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      // 163.24 × 12500 = 2,040,500
      subtotalCents: 2_040_500,
      // 2,040,500 × 0.13 = 265,265
      hstCents: 265_265,
      totalCents: 2_305_765,
    },
  },
  {
    name: "Weekend-only period (edge case) — 0 business days",
    periodStart: "2026-04-04", // Sat
    periodEnd: "2026-04-05", // Sun
    mode: "weekly",
    perWeek: 37.5,
    rateCents: 12500,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 0,
      quantity: 0,
      subtotalCents: 0,
      hstCents: 0,
      totalCents: 0,
    },
  },
  {
    name: "Partial week (3 business days) @ 37.5 h/week",
    periodStart: "2026-04-06", // Mon
    periodEnd: "2026-04-08", // Wed
    mode: "weekly",
    perWeek: 37.5,
    rateCents: 12500,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 3,
      quantity: 22.5, // 37.5 × (3/5)
      subtotalCents: 281_250,
      // 281,250 × 0.13 = 36,562.5 → round half-up → 36,563
      hstCents: 36_563,
      totalCents: 317_813,
    },
  },
  {
    name: "Daily rate: 5 days/week over April 2026 @ $1,200/day",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    mode: "weekly",
    perWeek: 5,
    rateCents: 120_000,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      businessDays: 22,
      quantity: 22, // 5 × (22/5) = 22 days
      subtotalCents: 2_640_000,
      // 2,640,000 × 0.13 = 343,200
      hstCents: 343_200,
      totalCents: 2_983_200,
    },
  },
  {
    name: "Non-HST client: subtotal only, no HST",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    mode: "weekly",
    perWeek: 37.5,
    rateCents: 12500,
    hstRateBps: 1300,
    hstApplicable: false,
    expected: {
      businessDays: 22,
      quantity: 165,
      subtotalCents: 2_062_500,
      hstCents: 0,
      totalCents: 2_062_500,
    },
  },
  {
    name: "Year-crossing period (Dec 28 2026 → Jan 8 2027)",
    periodStart: "2026-12-28", // Mon
    periodEnd: "2027-01-08", // Fri
    mode: "weekly",
    perWeek: 40,
    rateCents: 15000,
    hstRateBps: 1300,
    hstApplicable: true,
    expected: {
      // Mon Dec 28, Tue 29, Wed 30, Thu 31, Fri Jan 1, Mon Jan 4..Fri 8
      // 5 + 5 = 10 business days (NYE + NYD not excluded — approximation by design)
      businessDays: 10,
      quantity: 80,
      subtotalCents: 1_200_000,
      hstCents: 156_000,
      totalCents: 1_356_000,
    },
  },
];

let failures = 0;

function assertEq(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: got ${actual}, expected ${expected}`);
    failures++;
  } else {
    console.log(`  ✓ ${label}: ${actual}`);
  }
}

for (const s of scenarios) {
  console.log(`\n▸ ${s.name}`);
  console.log(`  period: ${s.periodStart} → ${s.periodEnd}`);

  const bd = businessDaysBetweenISO(s.periodStart, s.periodEnd);
  if (s.expected.businessDays !== undefined) {
    assertEq("businessDays", bd, s.expected.businessDays);
  }

  const quantity =
    s.mode === "weekly"
      ? quantityFromWeekly(s.perWeek!, s.periodStart, s.periodEnd)
      : Math.round((s.quantity ?? 0) * 100) / 100;

  if (s.expected.quantity !== undefined) {
    assertEq("quantity", quantity, s.expected.quantity);
  }

  // Same formulas the server action uses (src/server/actions/invoices.ts).
  const subtotalCents = Math.round(quantity * s.rateCents);
  const hstCents = s.hstApplicable ? calculateHst(subtotalCents, s.hstRateBps) : 0;
  const totalCents = subtotalCents + hstCents;

  assertEq(`subtotal (${formatCAD(subtotalCents)})`, subtotalCents, s.expected.subtotalCents);
  assertEq(`hst      (${formatCAD(hstCents)})`, hstCents, s.expected.hstCents);
  assertEq(`total    (${formatCAD(totalCents)})`, totalCents, s.expected.totalCents);
}

console.log(
  `\n${failures === 0 ? "✓ All scenarios passed" : `✗ ${failures} assertion(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
