/**
 * Verifies `src/lib/deadlines-derivation.ts` — the pure function that
 * derives T2 / T4 / HST / Ontario-annual-return deadlines from fiscal
 * settings. Covers the four annual rules + leap-day edge cases + the
 * payroll-activation gate.
 *
 * Run: `pnpm verify-deadlines`. Fails the process (exit 1) on any mismatch.
 */

import { deriveAnnualDeadlines } from "../src/lib/deadlines-derivation";

type Result = { name: string; failures: string[] };
const results: Result[] = [];

function record(name: string, failures: string[]) {
  results.push({ name, failures });
}
function expectEq<T>(failures: string[], label: string, a: T, b: T) {
  if (a !== b) failures.push(`${label}: ${String(a)} !== ${String(b)}`);
}

// ——— Test 1: Dec-31 FYE corp, all annual deadlines present ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2026,
  });
  const byKey = Object.fromEntries(ds.map((d) => [d.key, d]));
  // T2 = FYE + 6 months → 2027-06-30
  expectEq(failures, "T2 due", byKey["t2:2026"]?.dueDate, "2027-06-30");
  // HST = FYE + 3 months → 2027-03-31
  expectEq(failures, "HST due", byKey["hst:2026"]?.dueDate, "2027-03-31");
  // T4 = Feb 28 of year after pay year (2026 pay year → 2027-02-28)
  expectEq(failures, "T4 due", byKey["t4:2026"]?.dueDate, "2027-02-28");
  // Annual return = 2026-03-30 (incorporation anniversary in FY 2026)
  expectEq(
    failures,
    "Annual return due",
    byKey["annual_return:2026"]?.dueDate,
    "2026-03-30",
  );
  record("Dec-31 FYE, FY 2026: T2, HST, T4, Ontario annual return derived", failures);
})();

// ——— Test 2: Oct-31 FYE corp shifts T2 + HST appropriately ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 10,
    fyeDay: 31,
    incorporationDate: "2025-05-15",
    payrollActive: true,
    fiscalYear: 2026,
  });
  const byKey = Object.fromEntries(ds.map((d) => [d.key, d]));
  expectEq(failures, "Oct-31 T2 due", byKey["t2:2026"]?.dueDate, "2027-04-30");
  expectEq(failures, "Oct-31 HST due", byKey["hst:2026"]?.dueDate, "2027-01-31");
  // T4 stays calendar-year based — Feb 28 of year after labelled FY
  expectEq(failures, "T4 Oct-31 due", byKey["t4:2026"]?.dueDate, "2027-02-28");
  expectEq(
    failures,
    "Annual return Oct-31 corp due",
    byKey["annual_return:2026"]?.dueDate,
    "2026-05-15",
  );
  record("Oct-31 FYE shifts T2 to April 30 and HST to Jan 31", failures);
})();

// ——— Test 3: payroll inactive → no T4 deadline ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: false,
    fiscalYear: 2026,
  });
  const hasT4 = ds.some((d) => d.key.startsWith("t4:"));
  expectEq(failures, "no T4 when payroll inactive", hasT4, false);
  record("Payroll gate: T4 deadline only emitted when RP0001 is active", failures);
})();

// ——— Test 4: no incorporation date → no annual return deadline ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: null,
    payrollActive: true,
    fiscalYear: 2026,
  });
  const hasAR = ds.some((d) => d.key.startsWith("annual_return:"));
  expectEq(failures, "no Ontario annual return when incorporationDate null", hasAR, false);
  record("Incorporation-date gate: annual return only emitted when date is set", failures);
})();

// ——— Test 5: Feb 29 incorporation → Feb 28 in non-leap anniversary ———

(() => {
  const failures: string[] = [];
  // Corp incorporated on 2024-02-29 (leap day). For FY 2026 (non-leap),
  // anniversary should be Feb 28, not Mar 1.
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2024-02-29",
    payrollActive: false,
    fiscalYear: 2026,
  });
  const ar = ds.find((d) => d.key === "annual_return:2026");
  expectEq(failures, "Feb 29 anniversary → Feb 28 in non-leap", ar?.dueDate, "2026-02-28");
  record("Leap-day edge: Feb 29 anniversary clamps to Feb 28 in non-leap years", failures);
})();

// ——— Test 6: Feb 29 anniversary stays Feb 29 in leap year ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2024-02-29",
    payrollActive: false,
    fiscalYear: 2028, // leap year
  });
  const ar = ds.find((d) => d.key === "annual_return:2028");
  expectEq(failures, "Feb 29 anniversary in leap year", ar?.dueDate, "2028-02-29");
  record("Leap year: Feb 29 anniversary preserved when the target year is itself leap", failures);
})();

// ——— Test 7: stable natural keys for idempotency ———

(() => {
  const failures: string[] = [];
  const ds1 = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2026,
  });
  const ds2 = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2026,
  });
  const keys1 = ds1.map((d) => d.key).sort();
  const keys2 = ds2.map((d) => d.key).sort();
  expectEq(failures, "key set stable across calls", keys1.join(","), keys2.join(","));
  const uniqCount = new Set(keys1).size;
  expectEq(failures, "no duplicate keys within single call", uniqCount, ds1.length);
  record("Keys: stable + unique → upsert is safe to run repeatedly", failures);
})();

// ——— Test 8: categories only use the whitelisted set ———

(() => {
  const failures: string[] = [];
  const validCategories = new Set(["t2", "t4", "hst", "annual_return", "other"]);
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2026,
  });
  for (const d of ds) {
    if (!validCategories.has(d.category)) {
      failures.push(`unknown category ${d.category} emitted by ${d.key}`);
    }
  }
  record("Categories: only whitelisted strings emitted", failures);
})();

// ——— Test 9: next-FY derivation pushes deadlines forward ———

(() => {
  const failures: string[] = [];
  const ds2026 = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2026,
  });
  const ds2027 = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: "2026-03-30",
    payrollActive: true,
    fiscalYear: 2027,
  });
  const t2_2026 = ds2026.find((d) => d.key === "t2:2026")!.dueDate;
  const t2_2027 = ds2027.find((d) => d.key === "t2:2027")!.dueDate;
  if (t2_2027 <= t2_2026) {
    failures.push(`next-FY T2 should be after current-FY T2: ${t2_2027} vs ${t2_2026}`);
  }
  // Keys never collide across FYs
  const sharedKeys = ds2026.filter((d) => ds2027.some((e) => e.key === d.key));
  expectEq(failures, "no shared keys across FY 2026 and FY 2027", sharedKeys.length, 0);
  record("FY progression: next-FY deadlines are after current-FY, keys don't collide", failures);
})();

// ——— Test 10: HST due exactly halves T2 due window (3mo vs 6mo) ———

(() => {
  const failures: string[] = [];
  const ds = deriveAnnualDeadlines({
    fyeMonth: 12,
    fyeDay: 31,
    incorporationDate: null,
    payrollActive: false,
    fiscalYear: 2026,
  });
  const hst = ds.find((d) => d.key === "hst:2026")!;
  const t2 = ds.find((d) => d.key === "t2:2026")!;
  // Both have same day, but hst month = t2 month - 3
  const [, hstM] = hst.dueDate.split("-").map(Number);
  const [, t2M] = t2.dueDate.split("-").map(Number);
  expectEq(failures, "HST month = T2 month - 3", hstM, t2M! - 3);
  record("Rule sanity: HST always 3 months ahead of T2 (6mo vs 3mo rules)", failures);
})();

// ——— runner ———

function main() {
  let pass = 0;
  let fail = 0;
  console.log("\n=== Deadline derivation verification ===\n");
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
