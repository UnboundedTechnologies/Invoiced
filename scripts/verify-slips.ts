/**
 * Verifies src/lib/queries/slip-aggregation.ts — the canonical T4/T5 slip
 * box builder. Exercises the pure helpers (t4SlipBoxesFromRaw /
 * t5SlipBoxesFromRaw) with synthetic inputs; DB-backed filtering is covered
 * by verify-t1.ts + verify-dashboard.ts via the same underlying slices.
 *
 * Run: `pnpm verify-slips`. Exits non-zero on any mismatch.
 */

import {
  t4SlipBoxesFromRaw,
  t5SlipBoxesFromRaw,
  type T4BoxesInput,
  type T5BoxesInput,
} from "../src/lib/slip-boxes";
import {
  t4BoxesToCsv,
  t5BoxesToCsv,
  fmtAmount,
  csvField,
  type SlipCsvPayer,
} from "../src/lib/slip-csv";
import {
  ELIGIBLE_GROSS_UP_RATE,
  FEDERAL_DTC_ELIGIBLE_RATE,
  FEDERAL_DTC_NON_ELIGIBLE_RATE,
  NON_ELIGIBLE_GROSS_UP_RATE,
  ONTARIO_DTC_ELIGIBLE_RATE,
  ONTARIO_DTC_NON_ELIGIBLE_RATE_2026,
  RATES_EDITION_TAG_2026,
} from "../src/lib/t1-rates-2026";
import { dividendGrossUp, dividendTaxCredit } from "../src/lib/t1";
import { formatCAD } from "../src/lib/utils";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}

function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

function expectNear(failures: string[], label: string, actual: number, expected: number, tolCents = 1) {
  if (Math.abs(actual - expected) > tolCents) {
    failures.push(`${label}: want ${formatCAD(expected)} ± ${tolCents}¢, got ${formatCAD(actual)}`);
  }
}

function blankT4(): T4BoxesInput {
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
    employerCppBaseCents: 0,
    employerCpp2Cents: 0,
    count: 0,
  };
}

function blankT5(): T5BoxesInput {
  return {
    eligible: { actualCents: 0, count: 0 },
    nonEligible: { actualCents: 0, count: 0 },
  };
}

// ——— Test 1: Blank slate — T4 zeros map to zeros, right tax year + rate tag ———
(() => {
  const failures: string[] = [];
  const t4 = t4SlipBoxesFromRaw(blankT4(), 2026);
  expectEq(failures, "taxYear", t4.taxYear, 2026);
  expectEq(failures, "box14", t4.box14EmploymentIncomeCents, 0);
  expectEq(failures, "box16", t4.box16CppBaseCents, 0);
  expectEq(failures, "box16a", t4.box16aCpp2Cents, 0);
  expectEq(failures, "box22", t4.box22FedTaxWithheldCents, 0);
  expectEq(failures, "paychequeCount", t4.paychequeCount, 0);
  expectEq(failures, "ratesEditionTag", t4.ratesEditionTag, RATES_EDITION_TAG_2026);
  record("T4 blank → zeros + correct meta", failures);
})();

// ——— Test 2: T4 pass-through identity ———
(() => {
  const failures: string[] = [];
  const raw: T4BoxesInput = {
    box14EmploymentIncomeCents: 71_300_00,
    box16CppBaseCents: 4_034_10,          // approx 2026 max CPP1
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
  const t4 = t4SlipBoxesFromRaw(raw, 2026);
  expectEq(failures, "box14 passthrough", t4.box14EmploymentIncomeCents, raw.box14EmploymentIncomeCents);
  expectEq(failures, "box16 passthrough", t4.box16CppBaseCents, raw.box16CppBaseCents);
  expectEq(failures, "box16a passthrough", t4.box16aCpp2Cents, raw.box16aCpp2Cents);
  expectEq(failures, "box18 passthrough (0)", t4.box18EiCents, 0);
  expectEq(failures, "box22 passthrough", t4.box22FedTaxWithheldCents, raw.box22FedTaxWithheldCents);
  expectEq(failures, "box24 passthrough (0)", t4.box24EiInsurableCents, 0);
  expectEq(failures, "box26 passthrough", t4.box26CppPensionableCents, raw.box26CppPensionableCents);
  expectEq(failures, "ontarioTaxWithheld passthrough", t4.ontarioTaxWithheldCents, raw.ontarioTaxWithheldCents);
  expectEq(failures, "employerCpp passthrough", t4.employerCppBaseCents, raw.employerCppBaseCents);
  expectEq(failures, "employerCpp2 passthrough", t4.employerCpp2Cents, raw.employerCpp2Cents);
  expectEq(failures, "count passthrough", t4.paychequeCount, raw.count);
  record("T4 pass-through identity", failures);
})();

// ——— Test 3: T4 owner-manager invariants (EI always 0) ———
(() => {
  const failures: string[] = [];
  const raw = { ...blankT4(), box14EmploymentIncomeCents: 50_000_00 };
  const t4 = t4SlipBoxesFromRaw(raw, 2026);
  expectEq(failures, "box18 (EI premium)", t4.box18EiCents, 0);
  expectEq(failures, "box24 (EI insurable)", t4.box24EiInsurableCents, 0);
  record("T4 owner-manager invariants: EI = 0", failures);
})();

// ——— Test 4: T5 blank → zeros everywhere ———
(() => {
  const failures: string[] = [];
  const t5 = t5SlipBoxesFromRaw(blankT5(), 2026);
  expectEq(failures, "taxYear", t5.taxYear, 2026);
  expectEq(failures, "eligible actual", t5.eligible.actualCents, 0);
  expectEq(failures, "eligible taxable", t5.eligible.taxableCents, 0);
  expectEq(failures, "eligible fed DTC", t5.eligible.federalDtcCents, 0);
  expectEq(failures, "eligible ON DTC", t5.eligible.ontarioDtcCents, 0);
  expectEq(failures, "non-eligible actual", t5.nonEligible.actualCents, 0);
  expectEq(failures, "non-eligible taxable", t5.nonEligible.taxableCents, 0);
  expectEq(failures, "totals all zero", t5.totals.actualCents, 0);
  record("T5 blank → zeros", failures);
})();

// ——— Test 5: T5 eligible gross-up @ 38% exactly ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 10_000_00, count: 1 },
    nonEligible: { actualCents: 0, count: 0 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const expectedTaxable = Math.round(10_000_00 * (1 + ELIGIBLE_GROSS_UP_RATE));
  expectEq(failures, "eligible taxable = actual × 1.38", t5.eligible.taxableCents, expectedTaxable);
  expectEq(failures, "eligible taxable = 13,800", t5.eligible.taxableCents, 13_800_00);
  record("T5 eligible gross-up: actual × 1.38", failures);
})();

// ——— Test 6: T5 non-eligible gross-up @ 15% exactly ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 0, count: 0 },
    nonEligible: { actualCents: 5_000_00, count: 1 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const expectedTaxable = Math.round(5_000_00 * (1 + NON_ELIGIBLE_GROSS_UP_RATE));
  expectEq(failures, "non-elig taxable = actual × 1.15", t5.nonEligible.taxableCents, expectedTaxable);
  expectEq(failures, "non-elig taxable = 5,750", t5.nonEligible.taxableCents, 5_750_00);
  record("T5 non-eligible gross-up: actual × 1.15", failures);
})();

// ——— Test 7: T5 eligible federal DTC = 15.0198% of grossed-up ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 10_000_00, count: 1 },
    nonEligible: { actualCents: 0, count: 0 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const expectedDtc = Math.round(13_800_00 * FEDERAL_DTC_ELIGIBLE_RATE);
  expectEq(failures, "eligible fed DTC = 15.0198% × 13800", t5.eligible.federalDtcCents, expectedDtc);
  // Sanity — should be roughly $2,073
  expectNear(failures, "eligible fed DTC ≈ $2,073", t5.eligible.federalDtcCents, 2_072_73, 50);
  record("T5 eligible fed DTC: 15.0198% × taxable", failures);
})();

// ——— Test 8: T5 non-elig federal DTC = 9.0301% of grossed-up ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 0, count: 0 },
    nonEligible: { actualCents: 5_000_00, count: 1 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const expectedDtc = Math.round(5_750_00 * FEDERAL_DTC_NON_ELIGIBLE_RATE);
  expectEq(failures, "non-elig fed DTC = 9.0301% × 5750", t5.nonEligible.federalDtcCents, expectedDtc);
  record("T5 non-eligible fed DTC: 9.0301% × taxable", failures);
})();

// ——— Test 9: T5 Ontario DTC rates (10% eligible, 2.9863% non-eligible) ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 10_000_00, count: 1 },
    nonEligible: { actualCents: 5_000_00, count: 1 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const expectedElOnDtc = Math.round(13_800_00 * ONTARIO_DTC_ELIGIBLE_RATE);
  const expectedNeOnDtc = Math.round(5_750_00 * ONTARIO_DTC_NON_ELIGIBLE_RATE_2026);
  expectEq(failures, "eligible ON DTC = 10% × 13800 = 1380", t5.eligible.ontarioDtcCents, expectedElOnDtc);
  expectEq(failures, "eligible ON DTC = $1,380", t5.eligible.ontarioDtcCents, 1_380_00);
  expectEq(failures, "non-elig ON DTC = 2.9863% × 5750", t5.nonEligible.ontarioDtcCents, expectedNeOnDtc);
  record("T5 Ontario DTC rates (10% / 2.9863%)", failures);
})();

// ——— Test 10: T5 mixed eligible + non-eligible totals identity ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 10_000_00, count: 1 },
    nonEligible: { actualCents: 5_000_00, count: 2 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  expectEq(failures, "totals.actual = elActual + neActual", t5.totals.actualCents, t5.eligible.actualCents + t5.nonEligible.actualCents);
  expectEq(failures, "totals.taxable = elTaxable + neTaxable", t5.totals.taxableCents, t5.eligible.taxableCents + t5.nonEligible.taxableCents);
  expectEq(failures, "totals.fed DTC = elFedDtc + neFedDtc", t5.totals.federalDtcCents, t5.eligible.federalDtcCents + t5.nonEligible.federalDtcCents);
  expectEq(failures, "totals.ON DTC = elOnDtc + neOnDtc", t5.totals.ontarioDtcCents, t5.eligible.ontarioDtcCents + t5.nonEligible.ontarioDtcCents);
  expectEq(failures, "count eligible", t5.eligible.count, 1);
  expectEq(failures, "count non-eligible", t5.nonEligible.count, 2);
  record("T5 totals identity: totals === Σ (eligible, non-eligible)", failures);
})();

// ——— Test 11: T5 rounding determinism — odd-cent actuals round consistently ———
(() => {
  const failures: string[] = [];
  // $123.45 eligible; gross-up 38% → $170.361 → rounds to $170.36 (17036 cents)
  const raw: T5BoxesInput = {
    eligible: { actualCents: 123_45, count: 1 },
    nonEligible: { actualCents: 0, count: 0 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  expectEq(
    failures,
    "eligible taxable rounds via Math.round",
    t5.eligible.taxableCents,
    Math.round(123_45 * 1.38),
  );
  // Sanity: this should equal the dividendGrossUp helper output directly
  expectEq(
    failures,
    "slip taxable ≡ dividendGrossUp helper",
    t5.eligible.taxableCents,
    dividendGrossUp(123_45, ELIGIBLE_GROSS_UP_RATE),
  );
  expectEq(
    failures,
    "slip fed DTC ≡ dividendTaxCredit helper",
    t5.eligible.federalDtcCents,
    dividendTaxCredit(t5.eligible.taxableCents, FEDERAL_DTC_ELIGIBLE_RATE),
  );
  record("T5 rounding uses dividendGrossUp + dividendTaxCredit helpers", failures);
})();

// ——— Test 12: T5 empty eligible + non-empty non-eligible → eligible zeros ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 0, count: 0 },
    nonEligible: { actualCents: 8_000_00, count: 3 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  expectEq(failures, "eligible actual = 0", t5.eligible.actualCents, 0);
  expectEq(failures, "eligible taxable = 0", t5.eligible.taxableCents, 0);
  expectEq(failures, "eligible fed DTC = 0", t5.eligible.federalDtcCents, 0);
  expectEq(failures, "eligible ON DTC = 0", t5.eligible.ontarioDtcCents, 0);
  expectEq(failures, "non-elig actual = 8000", t5.nonEligible.actualCents, 8_000_00);
  record("T5 mixed-but-empty-eligible → eligible all zeros, non-elig populated", failures);
})();

// ——— Test 13: T4 + T5 rates-edition tag identity ———
(() => {
  const failures: string[] = [];
  const t4 = t4SlipBoxesFromRaw(blankT4(), 2026);
  const t5 = t5SlipBoxesFromRaw(blankT5(), 2026);
  expectEq(failures, "T4 rates tag", t4.ratesEditionTag, RATES_EDITION_TAG_2026);
  expectEq(failures, "T5 rates tag", t5.ratesEditionTag, RATES_EDITION_TAG_2026);
  expectEq(failures, "T4 tag ≡ T5 tag", t4.ratesEditionTag, t5.ratesEditionTag);
  record("Rates-edition tag stamped on every slip snapshot", failures);
})();

// ——— Test 14: T5 gross-up monotonicity — bigger actual → bigger taxable ———
(() => {
  const failures: string[] = [];
  const small = t5SlipBoxesFromRaw(
    { eligible: { actualCents: 100_00, count: 1 }, nonEligible: { actualCents: 0, count: 0 } },
    2026,
  );
  const big = t5SlipBoxesFromRaw(
    { eligible: { actualCents: 100_000_00, count: 1 }, nonEligible: { actualCents: 0, count: 0 } },
    2026,
  );
  if (small.eligible.taxableCents >= big.eligible.taxableCents) {
    failures.push("monotonicity broken: smaller actual should produce smaller taxable");
  }
  if (small.eligible.federalDtcCents >= big.eligible.federalDtcCents) {
    failures.push("monotonicity broken: smaller actual should produce smaller fed DTC");
  }
  record("T5 gross-up + DTC monotonicity under larger inputs", failures);
})();

// ——— Test 15: T5 DTC ratio stability — ratio federal DTC / taxable is ~constant ———
(() => {
  const failures: string[] = [];
  for (const actual of [1_000_00, 50_000_00, 250_000_00]) {
    const t5 = t5SlipBoxesFromRaw(
      { eligible: { actualCents: actual, count: 1 }, nonEligible: { actualCents: 0, count: 0 } },
      2026,
    );
    const ratio = t5.eligible.federalDtcCents / t5.eligible.taxableCents;
    // Tolerance — rounding can nudge by a few parts in 10^5.
    if (Math.abs(ratio - FEDERAL_DTC_ELIGIBLE_RATE) > 5e-5) {
      failures.push(`DTC ratio for actual=${actual}: got ${ratio}, want ${FEDERAL_DTC_ELIGIBLE_RATE}`);
    }
  }
  record("T5 eligible DTC ratio ≈ FEDERAL_DTC_ELIGIBLE_RATE at multiple scales", failures);
})();

// ─────────────────────────────────────────────────────────────────────────
// CSV BUILDER TESTS (4E-6) — exercise slip-csv.ts without DATABASE_URL.
// ─────────────────────────────────────────────────────────────────────────

const samplePayer: SlipCsvPayer = {
  corpLegalName: "Unbounded Technologies Inc.",
  businessNumber: "726742430",
  payrollAccount: "726742430RP0001",
  payerRzAccount: "726742430RZ0001",
  directorLegalName: "Saïd Aïssani",
};

// ——— Test CSV-1: fmtAmount produces CRA-friendly dollars.cents ———
(() => {
  const failures: string[] = [];
  expectEq(failures, "$0.00", fmtAmount(0), "0.00");
  expectEq(failures, "$0.05", fmtAmount(5), "0.05");
  expectEq(failures, "$1.00", fmtAmount(100), "1.00");
  expectEq(failures, "$1,234.56 → 1234.56 (no thousands sep)", fmtAmount(1_234_56), "1234.56");
  expectEq(failures, "$71,300.00 → 71300.00", fmtAmount(71_300_00), "71300.00");
  expectEq(failures, "negative cents", fmtAmount(-100), "-1.00");
  record("fmtAmount: dollars.cents with period, no thousands separator, negatives with minus", failures);
})();

// ——— Test CSV-2: csvField — RFC 4180 quoting + injection guard ———
(() => {
  const failures: string[] = [];
  // Plain values pass through
  expectEq(failures, "plain", csvField("hello"), "hello");
  expectEq(failures, "amount", csvField("71300.00"), "71300.00");
  // Comma forces quoting
  expectEq(failures, "comma → quoted", csvField("a,b"), '"a,b"');
  // Double-quote inside → escaped by doubling + whole field quoted
  expectEq(failures, "double-quote → escaped", csvField('say "hi"'), '"say ""hi"""');
  // Newlines force quoting
  expectEq(failures, "newline → quoted", csvField("line1\nline2"), '"line1\nline2"');
  // Carriage return forces quoting
  expectEq(failures, "CR → quoted", csvField("a\rb"), '"a\rb"');
  // Injection guard: = → ' prefix + quoted (because ' isn't a special char, only if other specials)
  expectEq(failures, "formula = prefixed with '", csvField("=SUM(A1)"), "'=SUM(A1)");
  expectEq(failures, "formula + prefixed with '", csvField("+cmd"), "'+cmd");
  expectEq(failures, "formula - prefixed with '", csvField("-cmd"), "'-cmd");
  expectEq(failures, "formula @ prefixed with '", csvField("@cmd"), "'@cmd");
  expectEq(failures, "formula | prefixed with '", csvField("|cmd"), "'|cmd");
  expectEq(failures, "formula % prefixed with '", csvField("%cmd"), "'%cmd");
  expectEq(failures, "formula TAB prefixed with '", csvField("\tcmd"), "'\tcmd");
  // Leading digit is NOT a formula — pass through
  expectEq(failures, "leading digit ignored", csvField("1-2"), "1-2");
  record("csvField: RFC 4180 quoting + Excel/Sheets formula-injection guard", failures);
})();

// ——— Test CSV-3: T4 CSV contains the right rows in the right order ———
(() => {
  const failures: string[] = [];
  const raw: T4BoxesInput = {
    box14EmploymentIncomeCents: 71_300_00,
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
  const t4 = t4SlipBoxesFromRaw(raw, 2026);
  const csv = t4BoxesToCsv(t4, samplePayer, 2026);

  // BOM + CRLF check
  if (!csv.startsWith("﻿")) failures.push("CSV missing UTF-8 BOM");
  if (!csv.includes("\r\n")) failures.push("CSV missing CRLF line endings");

  // Header row
  if (!csv.includes("Section,Box,Description,Amount,Notes")) {
    failures.push("header row missing or wrong");
  }
  // Every CRA slip box shows up with its value
  for (const [box, expected] of [
    ["Box 14", fmtAmount(71_300_00)],
    ["Box 16", fmtAmount(4_034_10)],
    ["Box 16A", fmtAmount(396_00)],
    ["Box 22", fmtAmount(9_500_00)],
    ["Box 26", fmtAmount(71_300_00)],
  ] as const) {
    if (!csv.includes(`,${box},`)) failures.push(`${box} row missing`);
    if (!csv.includes(`,${expected},`)) failures.push(`${box} amount ${expected} missing`);
  }
  // Box 28 emits "X" not a dollar amount
  if (!csv.includes(",Box 28,") || !csv.includes(",X,")) {
    failures.push("Box 28 exempt indicator row missing or missing X marker");
  }
  // SIN row must have empty amount + a never-stored note
  if (!/META.*Recipient SIN.*NEVER STORED/.test(csv)) {
    failures.push("SIN meta row missing never-stored note");
  }
  // Section order: META first, then SLIP, then SUMMARY
  const metaIdx = csv.indexOf("META,");
  const slipIdx = csv.indexOf("SLIP,");
  const summaryIdx = csv.indexOf("SUMMARY,");
  if (metaIdx < 0 || slipIdx < 0 || summaryIdx < 0) {
    failures.push("one or more sections missing");
  } else if (!(metaIdx < slipIdx && slipIdx < summaryIdx)) {
    failures.push(`section order broken: META=${metaIdx} SLIP=${slipIdx} SUMMARY=${summaryIdx}`);
  }
  // Rates-edition tag is stamped
  if (!csv.includes(t4.ratesEditionTag)) failures.push("ratesEditionTag missing");
  record("T4 CSV: BOM + CRLF + header + all slip boxes + SIN never-stored + section order + rates tag", failures);
})();

// ——— Test CSV-4: T5 CSV contains eligible + non-eligible split + report code ———
(() => {
  const failures: string[] = [];
  const raw: T5BoxesInput = {
    eligible: { actualCents: 10_000_00, count: 2 },
    nonEligible: { actualCents: 5_000_00, count: 1 },
  };
  const t5 = t5SlipBoxesFromRaw(raw, 2026);
  const csv = t5BoxesToCsv(t5, samplePayer, 2026);

  // Report code row (Box 21 = O) — literal string O, not an amount
  if (!csv.includes(",Box 21,") || !/Box 21,[^,]+,O,/.test(csv)) {
    failures.push("Box 21 report code row missing or missing O value");
  }
  // Recipient type (Box 22 = 1)
  if (!csv.includes(",Box 22,") || !/Box 22,[^,]+,1,/.test(csv)) {
    failures.push("Box 22 recipient type row missing or missing 1 value");
  }
  // Eligible boxes present with expected values
  if (!csv.includes(`,Box 24,`) || !csv.includes(`,${fmtAmount(10_000_00)},`)) {
    failures.push("Box 24 eligible actual missing");
  }
  if (!csv.includes(`,Box 25,`) || !csv.includes(`,${fmtAmount(13_800_00)},`)) {
    failures.push("Box 25 eligible taxable missing or wrong gross-up");
  }
  // Non-eligible boxes
  if (!csv.includes(`,Box 10,`) || !csv.includes(`,${fmtAmount(5_000_00)},`)) {
    failures.push("Box 10 non-eligible actual missing");
  }
  if (!csv.includes(`,Box 11,`) || !csv.includes(`,${fmtAmount(5_750_00)},`)) {
    failures.push("Box 11 non-eligible taxable missing or wrong gross-up");
  }
  // Summary grand-total row references totals
  if (!csv.includes(`,${fmtAmount(15_000_00)},`)) {
    failures.push("Grand total actual (15,000) missing");
  }
  if (!csv.includes(`,${fmtAmount(19_550_00)},`)) {
    failures.push("Grand total taxable (13,800 + 5,750 = 19,550) missing");
  }
  // SIN reminder present
  if (!/META.*Recipient SIN.*NEVER STORED/.test(csv)) {
    failures.push("SIN meta row missing never-stored note");
  }
  record("T5 CSV: report code + recipient type + eligible/non-eligible split + grand totals + SIN guard", failures);
})();

// ——— Test CSV-5: formula-injection resistance on payer legal name ———
(() => {
  const failures: string[] = [];
  const maliciousPayer: SlipCsvPayer = {
    ...samplePayer,
    corpLegalName: "=HYPERLINK(\"evil.com\")",
  };
  const raw: T4BoxesInput = {
    box14EmploymentIncomeCents: 1_000_00,
    box16CppBaseCents: 0,
    box16aCpp2Cents: 0,
    box18EiCents: 0,
    box22FedTaxWithheldCents: 0,
    box24EiInsurableCents: 0,
    box26CppPensionableCents: 1_000_00,
    box52PensionAdjustmentCents: 0,
    ontarioTaxWithheldCents: 0,
    employerCppBaseCents: 0,
    employerCpp2Cents: 0,
    count: 1,
  };
  const csv = t4BoxesToCsv(t4SlipBoxesFromRaw(raw, 2026), maliciousPayer, 2026);
  // The raw "=" prefix must never appear as a field start — it should be quoted with a leading apostrophe.
  // Since the value contains a double-quote ("), it'll be quoted; verify the leading apostrophe is before the =.
  if (!csv.includes(`"'=HYPERLINK(""evil.com"")"`)) {
    failures.push("formula-injection guard did not prefix malicious corp name");
  }
  record("CSV formula-injection guard survives adversarial payer field", failures);
})();

// ——— Test CSV-6: Amount arithmetic in summary totals is consistent with slip values ———
(() => {
  const failures: string[] = [];
  const raw: T4BoxesInput = {
    box14EmploymentIncomeCents: 50_000_00,
    box16CppBaseCents: 2_750_00,
    box16aCpp2Cents: 200_00,
    box18EiCents: 0,
    box22FedTaxWithheldCents: 6_000_00,
    box24EiInsurableCents: 0,
    box26CppPensionableCents: 50_000_00,
    box52PensionAdjustmentCents: 0,
    ontarioTaxWithheldCents: 1_500_00,
    employerCppBaseCents: 2_750_00,
    employerCpp2Cents: 200_00,
    count: 12,
  };
  const csv = t4BoxesToCsv(t4SlipBoxesFromRaw(raw, 2026), samplePayer, 2026);
  // Sum: 6000 + 1500 + 2750 + 2750 + 200 + 200 = 13400
  const expectedRemittance = fmtAmount(13_400_00);
  if (!csv.includes(`,${expectedRemittance},`)) {
    failures.push(`Total remittance ${expectedRemittance} missing — summary math wrong`);
  }
  record("T4 CSV summary total remittance = fed + ON + CPP EE + CPP ER + CPP2 EE + CPP2 ER", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Slip-aggregation (T4 / T5) verification ===\n");
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
