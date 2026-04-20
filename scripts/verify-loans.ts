/**
 * Verifies the shareholder-loan compute engine with canonical scenarios that
 * cover ITA s.15(2) / s.15(2.6) / s.80.4(2) / s.80.4(3)(b) and the CRA
 * "series of loans" rule per folio S3-F1-C1 (2025-04-10 update).
 *
 * Run: `pnpm verify-loans`. Fails the process (exit 1) on any mismatch.
 */

import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "../src/lib/shareholder-loan";
import { formatCAD } from "../src/lib/utils";

type Scenario = {
  name: string;
  today: string;
  entries: LoanEntry[];
  rates: RatePeriod[];
  fiscalYearEnd: { month: number; day: number };
  expect: {
    todayBalanceCents?: number;
    past15_2DrawIds?: string[];      // draws with status "past_deadline"
    warning15_2DrawIds?: string[];   // draws with status "warning"
    annualBenefitBoundsCents?: Record<number, [number, number]>; // [min, max] per year
    annualInclusionCents?: Record<number, number>;
    seriesWarningCount?: number;
  };
};

// Standard 2026 prescribed rate table for the test fixtures.
const RATES_2026_FULL: RatePeriod[] = [
  { startDate: "2026-01-01", endDate: "2026-03-31", ratePercent: 3 },
  { startDate: "2026-04-01", endDate: "2026-06-30", ratePercent: 3 },
  { startDate: "2026-07-01", endDate: "2026-09-30", ratePercent: 3 },
  { startDate: "2026-10-01", endDate: "2026-12-31", ratePercent: 3 },
];
const RATES_2027_FULL: RatePeriod[] = [
  { startDate: "2027-01-01", endDate: "2027-03-31", ratePercent: 3 },
  { startDate: "2027-04-01", endDate: "2027-06-30", ratePercent: 3 },
  { startDate: "2027-07-01", endDate: "2027-09-30", ratePercent: 3 },
  { startDate: "2027-10-01", endDate: "2027-12-31", ratePercent: 3 },
];

const DEC_31 = { month: 12, day: 31 };

const scenarios: Scenario[] = [
  {
    name: "1) Same-FY clean: draw Jan 15, repaid Dec 20 same year → no 15(2), tiny 80.4",
    today: "2027-01-15",
    fiscalYearEnd: DEC_31,
    rates: RATES_2026_FULL,
    entries: [
      { id: "d1", entryDate: "2026-01-15", type: "draw", amountCents: 100_00 },
      { id: "r1", entryDate: "2026-12-20", type: "repayment", amountCents: 100_00 },
    ],
    expect: {
      todayBalanceCents: 0,
      past15_2DrawIds: [],
      warning15_2DrawIds: [],
      // $100 × 3% × 340/365 ≈ $2.79 → 279 cents, allow ±2 for rounding
      annualBenefitBoundsCents: { 2026: [275, 285] },
      annualInclusionCents: {},
    },
  },
  {
    name: "2) 15(2) trigger: draw FY26, still unpaid on 2028-01-01 → inclusion for 2026",
    today: "2028-01-15",
    fiscalYearEnd: DEC_31,
    rates: [...RATES_2026_FULL, ...RATES_2027_FULL],
    entries: [
      { id: "d1", entryDate: "2026-05-15", type: "draw", amountCents: 10_000_00 },
      // no repayment → triggers 15(2) on 2027-12-31 end-of-day; we check on 2028-01-15
    ],
    expect: {
      past15_2DrawIds: ["d1"],
      annualInclusionCents: { 2026: 10_000_00 },
      // 80.4 should have run from 2026-05-15 → 2027-12-31 (cutoff) then STOP.
      // 2026: 231 days × $10k × 3% / 365 = $189.86
      // 2027: 365 days × $10k × 3% / 365 = $300.00 (includes Dec 31 = trigger day)
      annualBenefitBoundsCents: {
        2026: [189_70, 190_00],
        2027: [299_90, 300_10],
      },
    },
  },
  {
    name: "3) 15(2.6) clean: draw FY26, repaid before 2027-12-31 → no 15(2)",
    today: "2028-01-15",
    fiscalYearEnd: DEC_31,
    rates: [...RATES_2026_FULL, ...RATES_2027_FULL],
    entries: [
      { id: "d1", entryDate: "2026-05-15", type: "draw", amountCents: 10_000_00 },
      { id: "r1", entryDate: "2027-11-30", type: "repayment", amountCents: 10_000_00 },
    ],
    expect: {
      past15_2DrawIds: [],
      annualInclusionCents: {},
      // 2026: 231 days (May 15 → Dec 31) × 3% = $189.86
      // 2027: 333 days (Jan 1 → Nov 29 — segment ends day before repayment) × 3% = $273.70
      annualBenefitBoundsCents: {
        2026: [189_70, 190_00],
        2027: [273_60, 273_80],
      },
    },
  },
  {
    name: "4) Interest paid Jan 25 next year offsets prior-year 80.4",
    today: "2027-02-01",
    fiscalYearEnd: DEC_31,
    rates: RATES_2026_FULL,
    entries: [
      { id: "d1", entryDate: "2026-01-01", type: "draw", amountCents: 10_000_00 },
      { id: "r1", entryDate: "2026-12-31", type: "repayment", amountCents: 10_000_00 },
      // interest_payment on Jan 25 2027 → reduces 2026 T4A box 117
      { id: "i1", entryDate: "2027-01-25", type: "interest_payment", amountCents: 300_00 },
    ],
    expect: {
      todayBalanceCents: 0,
      // 2026 gross benefit ≈ $10k × 3% × 365/365 = $300. Offset by $300 → 0.
      annualBenefitBoundsCents: { 2026: [0, 5_00] },
    },
  },
  {
    name: "5) Series trap: repay Dec 28, reborrow Jan 3 same amount → warning, no clean 15(2.6)",
    today: "2027-02-01",
    fiscalYearEnd: DEC_31,
    rates: RATES_2026_FULL,
    entries: [
      { id: "d1", entryDate: "2026-06-01", type: "draw", amountCents: 5_000_00 },
      { id: "r1", entryDate: "2026-12-28", type: "repayment", amountCents: 5_000_00 },
      { id: "d2", entryDate: "2027-01-03", type: "draw", amountCents: 5_000_00 },
    ],
    expect: {
      seriesWarningCount: 1,
    },
  },
  {
    name: "6) Partial FIFO: two draws, one partial repayment consumes the oldest first",
    today: "2027-06-30",
    fiscalYearEnd: DEC_31,
    rates: [...RATES_2026_FULL, ...RATES_2027_FULL],
    entries: [
      { id: "d1", entryDate: "2026-02-01", type: "draw", amountCents: 3_000_00 }, // older
      { id: "d2", entryDate: "2026-08-01", type: "draw", amountCents: 5_000_00 }, // newer
      { id: "r1", entryDate: "2027-05-01", type: "repayment", amountCents: 3_000_00 }, // clears d1 exactly
    ],
    expect: {
      todayBalanceCents: 5_000_00,
      // Today is 2027-06-30 — both draws' triggers are 2027-12-31. Neither past yet.
      // d1 has been cleared; d2 has $5000 still outstanding with 184 days to trigger. Not in warning window (<=90d).
      warning15_2DrawIds: [],
      past15_2DrawIds: [],
    },
  },
  {
    name: "7) Warning window: draw on 2026-01-15, today is 2027-10-15 (~77 days to trigger)",
    today: "2027-10-15",
    fiscalYearEnd: DEC_31,
    rates: [...RATES_2026_FULL, ...RATES_2027_FULL],
    entries: [{ id: "d1", entryDate: "2026-01-15", type: "draw", amountCents: 2_000_00 }],
    expect: {
      warning15_2DrawIds: ["d1"],
      past15_2DrawIds: [],
    },
  },
];

function fail(msg: string): never {
  console.error(`\n✘ ${msg}`);
  process.exit(1);
}

console.log(`Running ${scenarios.length} shareholder-loan scenarios…\n`);

for (const s of scenarios) {
  const got = computeLoanTimeline({
    entries: s.entries,
    rates: s.rates,
    fiscalYearEnd: s.fiscalYearEnd,
    today: s.today,
  });
  const e = s.expect;

  if (e.todayBalanceCents !== undefined && got.todayBalanceCents !== e.todayBalanceCents) {
    fail(
      `"${s.name}"\n  todayBalanceCents: want ${formatCAD(e.todayBalanceCents)}, got ${formatCAD(got.todayBalanceCents)}`,
    );
  }
  if (e.past15_2DrawIds) {
    const actual = got.draws15_2Candidates
      .filter((c) => c.status === "past_deadline")
      .map((c) => c.drawId)
      .sort();
    const want = [...e.past15_2DrawIds].sort();
    if (actual.join(",") !== want.join(",")) {
      fail(
        `"${s.name}"\n  past_deadline draws: want [${want.join(",")}], got [${actual.join(",")}]`,
      );
    }
  }
  if (e.warning15_2DrawIds) {
    const actual = got.draws15_2Candidates
      .filter((c) => c.status === "warning")
      .map((c) => c.drawId)
      .sort();
    const want = [...e.warning15_2DrawIds].sort();
    if (actual.join(",") !== want.join(",")) {
      fail(
        `"${s.name}"\n  warning draws: want [${want.join(",")}], got [${actual.join(",")}]`,
      );
    }
  }
  if (e.annualBenefitBoundsCents) {
    for (const [yStr, [lo, hi]] of Object.entries(e.annualBenefitBoundsCents)) {
      const y = Number(yStr);
      const row = got.annualSummaries.find((a) => a.calendarYear === y);
      const actual = row?.benefit80_4Cents ?? 0;
      if (actual < lo || actual > hi) {
        fail(
          `"${s.name}"\n  benefit[${y}]: want [${formatCAD(lo)}, ${formatCAD(hi)}], got ${formatCAD(actual)}`,
        );
      }
    }
  }
  if (e.annualInclusionCents) {
    for (const [yStr, amt] of Object.entries(e.annualInclusionCents)) {
      const y = Number(yStr);
      const row = got.annualSummaries.find((a) => a.calendarYear === y);
      const actual = row?.inclusion15_2Cents ?? 0;
      if (actual !== amt) {
        fail(
          `"${s.name}"\n  inclusion[${y}]: want ${formatCAD(amt)}, got ${formatCAD(actual)}`,
        );
      }
    }
    // Also verify no spurious inclusions
    for (const a of got.annualSummaries) {
      if (a.inclusion15_2Cents > 0 && !(a.calendarYear in e.annualInclusionCents)) {
        fail(
          `"${s.name}"\n  unexpected inclusion[${a.calendarYear}]: ${formatCAD(a.inclusion15_2Cents)}`,
        );
      }
    }
  }
  if (e.seriesWarningCount !== undefined && got.seriesWarnings.length !== e.seriesWarningCount) {
    fail(
      `"${s.name}"\n  seriesWarning count: want ${e.seriesWarningCount}, got ${got.seriesWarnings.length}`,
    );
  }

  console.log(`  ✓ ${s.name}`);
}

console.log(`\n✅ All ${scenarios.length} scenarios passed.`);
