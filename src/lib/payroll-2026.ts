/**
 * Canadian payroll deduction formulas — 2026 (Ontario).
 *
 * Source: CRA T4127 Payroll Deductions Formulas, January 1 2026 edition.
 *   https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html
 *
 * Scope / assumptions:
 * - Owner-manager of a CCPC with > 40% voting shares → EXEMPT from EI (employee and employer both = 0).
 * - Province: Ontario.
 * - Claim codes: federal TD1 = claim code 1 (basic personal amount only). Provincial TD1-ON = claim code 1.
 *   (Saïd is single, no spouse / child credits to stack on TD1s.)
 * - No labour-sponsored venture capital credit.
 * - No Quebec-specific rules.
 *
 * Monetary values are **cents** at the public API boundary. Internal math uses
 * dollars-as-number (IEEE-754) so the constants match CRA tables verbatim;
 * every result is `Math.round`ed back to cents at the end.
 *
 * Every constant in this file must cite T4127 January 2026. If CRA releases
 * a mid-year update, snapshot the numbers as `payroll-2026-07.ts` rather than
 * mutating this file.
 */

// ───── CPP & CPP2 (2026) ─────

/** Year's Maximum Pensionable Earnings (CPP1 ceiling). T4127 §3.1 */
export const CPP_YMPE_2026 = 71_300;

/** Year's Additional Maximum Pensionable Earnings (CPP2 ceiling). T4127 §3.1 */
export const CPP_YAMPE_2026 = 81_200;

/** Annual basic exemption — no CPP on the first $3,500. T4127 §3.1 */
export const CPP_BASIC_EXEMPTION_2026 = 3_500;

/** CPP1 contribution rate (employee AND employer each pay this). T4127 §3.1 */
export const CPP_RATE_2026 = 0.0595;

/** CPP2 (enhanced) contribution rate (employee AND employer each). T4127 §3.1 */
export const CPP2_RATE_2026 = 0.04;

/** Max annual CPP1 (employee portion): (YMPE − exemption) × rate = 67,800 × 5.95% = $4,034.10 */
export const CPP_MAX_ANNUAL_2026 = (CPP_YMPE_2026 - CPP_BASIC_EXEMPTION_2026) * CPP_RATE_2026;

/** Max annual CPP2 (employee portion): (YAMPE − YMPE) × rate = 9,900 × 4% = $396.00 */
export const CPP2_MAX_ANNUAL_2026 = (CPP_YAMPE_2026 - CPP_YMPE_2026) * CPP2_RATE_2026;

// ───── Federal tax 2026 ─────
// T4127 Chapter 3 Table — rates and constants current for Jan 1 2026.

/** Federal basic personal amount — income-tested but for income ≤ $173,205 this is the flat value. */
export const FEDERAL_BPA_2026 = 16_129;

/** Lowest-bracket federal rate, also used for non-refundable credit conversion. */
export const FEDERAL_CREDIT_RATE_2026 = 0.14;

/** Federal tax brackets with T4127-style cumulative K constant. */
export const FEDERAL_BRACKETS_2026 = [
  { upTo: 57_375, rate: 0.14, k: 0 },
  { upTo: 114_750, rate: 0.205, k: 3_729.375 },       // (0.205 - 0.14) × 57,375
  { upTo: 177_882, rate: 0.26, k: 10_040.625 },       // prev + (0.26 - 0.205) × 114,750
  { upTo: 253_414, rate: 0.29, k: 15_377.085 },       // prev + (0.29 - 0.26) × 177,882
  { upTo: Infinity, rate: 0.33, k: 25_513.645 },      // prev + (0.33 - 0.29) × 253,414
] as const;

// ───── Ontario tax 2026 ─────
// T4127 Chapter 9. Rates and Ontario-specific constants for Jan 1 2026.

/** Ontario basic personal amount. */
export const ONTARIO_BPA_2026 = 12_747;

/** Ontario lowest-bracket rate / credit rate. */
export const ONTARIO_CREDIT_RATE_2026 = 0.0505;

/** Ontario tax brackets with cumulative V constant. */
export const ONTARIO_BRACKETS_2026 = [
  { upTo: 54_531, rate: 0.0505, v: 0 },
  { upTo: 109_062, rate: 0.0915, v: 2_235.771 },      // (0.0915 - 0.0505) × 54,531
  { upTo: 150_000, rate: 0.1116, v: 4_427.917 },      // prev + (0.1116 - 0.0915) × 109,062
  { upTo: 220_000, rate: 0.1216, v: 5_927.917 },      // prev + (0.1216 - 0.1116) × 150,000
  { upTo: Infinity, rate: 0.1316, v: 8_127.917 },     // prev + (0.1316 - 0.1216) × 220,000
] as const;

/** Ontario surtax thresholds. T4127 §9.6 */
export const ONTARIO_SURTAX = {
  tier1Threshold: 5_710,
  tier1Rate: 0.20,
  tier2Threshold: 7_307,
  tier2Rate: 0.36,
} as const;

/** Ontario Health Premium — annual, applied to income > $20,000. T4127 §9.7 */
function ontarioHealthPremiumAnnual(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 20_000) return 0;
  if (annualTaxableIncome <= 25_000) return Math.min(300, (annualTaxableIncome - 20_000) * 0.06);
  if (annualTaxableIncome <= 36_000) return 300;
  if (annualTaxableIncome <= 38_500) return Math.min(450, 300 + (annualTaxableIncome - 36_000) * 0.06);
  if (annualTaxableIncome <= 48_000) return 450;
  if (annualTaxableIncome <= 48_600) return Math.min(600, 450 + (annualTaxableIncome - 48_000) * 0.25);
  if (annualTaxableIncome <= 72_000) return 600;
  if (annualTaxableIncome <= 72_600) return Math.min(750, 600 + (annualTaxableIncome - 72_000) * 0.25);
  if (annualTaxableIncome <= 200_000) return 750;
  if (annualTaxableIncome <= 200_600) return Math.min(900, 750 + (annualTaxableIncome - 200_000) * 0.25);
  return 900;
}

// ───── Public API ─────

export type PayPeriodsPerYear = 12 | 24 | 26 | 52;

export type PayrollInput = {
  /** Gross pay for this period, in cents. */
  grossCents: number;
  /** Year-to-date CPP1 employee contributions *before* this run, in cents. */
  ytdCppCents: number;
  /** Year-to-date CPP2 employee contributions *before* this run, in cents. */
  ytdCpp2Cents: number;
  /** Year-to-date gross pensionable earnings *before* this run, in cents (used for CPP2 annualization). */
  ytdGrossCents: number;
  /** 12 monthly, 24 semi-monthly, 26 bi-weekly, 52 weekly. */
  payPeriodsPerYear: PayPeriodsPerYear;
};

export type PayrollResult = {
  grossCents: number;
  /** Employee CPP1 for this period. */
  cppCents: number;
  /** Employee CPP2 for this period. */
  cpp2Cents: number;
  /** Always 0 for owner-manager (EI exempt). */
  eiCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  /** Ontario Health Premium portion (rolled into provincialTaxCents, broken out for display). */
  ohpCents: number;
  netCents: number;
  /** Employer CPP1 contribution (matches employee). */
  employerCppCents: number;
  /** Employer CPP2 contribution (matches employee). */
  employerCpp2Cents: number;
  /** Always 0. */
  employerEiCents: number;
  /** Sum of employee CPP/CPP2/federal/provincial + employer CPP/CPP2 → remittance total. */
  totalRemittanceCents: number;
};

function federalTaxAnnual(
  annualTaxable: number,
  annualBpa: number,
  annualCppCredit: number,
): number {
  // Step 1: apply bracket
  const bracket =
    FEDERAL_BRACKETS_2026.find((b) => annualTaxable <= b.upTo) ?? FEDERAL_BRACKETS_2026[FEDERAL_BRACKETS_2026.length - 1]!;
  // T1 = R × A − K − K1 − K2
  const K1 = FEDERAL_CREDIT_RATE_2026 * annualBpa;
  const K2 = FEDERAL_CREDIT_RATE_2026 * annualCppCredit;
  const tax = bracket.rate * annualTaxable - bracket.k - K1 - K2;
  return Math.max(0, tax);
}

function ontarioTaxAnnual(
  annualTaxable: number,
  annualBpa: number,
  annualCppCredit: number,
): number {
  const bracket =
    ONTARIO_BRACKETS_2026.find((b) => annualTaxable <= b.upTo) ?? ONTARIO_BRACKETS_2026[ONTARIO_BRACKETS_2026.length - 1]!;
  const V1 = ONTARIO_CREDIT_RATE_2026 * annualBpa;
  const V2 = ONTARIO_CREDIT_RATE_2026 * annualCppCredit;
  const basicTax = Math.max(0, bracket.rate * annualTaxable - bracket.v - V1 - V2);

  // Ontario surtax
  let surtax = 0;
  if (basicTax > ONTARIO_SURTAX.tier1Threshold) {
    surtax += (basicTax - ONTARIO_SURTAX.tier1Threshold) * ONTARIO_SURTAX.tier1Rate;
  }
  if (basicTax > ONTARIO_SURTAX.tier2Threshold) {
    surtax += (basicTax - ONTARIO_SURTAX.tier2Threshold) * ONTARIO_SURTAX.tier2Rate;
  }

  return basicTax + surtax;
}

export function computePayroll(input: PayrollInput): PayrollResult {
  const gross = input.grossCents / 100;
  const ytdCpp = input.ytdCppCents / 100;
  const ytdCpp2 = input.ytdCpp2Cents / 100;
  const ytdGross = input.ytdGrossCents / 100;
  const periods = input.payPeriodsPerYear;

  // CPP1 per pay: (gross − periodic exemption) × rate, capped by annual max remaining
  const periodicExemption = CPP_BASIC_EXEMPTION_2026 / periods;
  const cppUncapped = Math.max(0, gross - periodicExemption) * CPP_RATE_2026;
  const cppRemaining = Math.max(0, CPP_MAX_ANNUAL_2026 - ytdCpp);
  const cpp = Math.min(cppUncapped, cppRemaining);

  // CPP2 per pay: applies only to pensionable earnings above YMPE (annualized logic).
  // Simplified: only kicks in once YTD gross > YMPE. For the slice of this period's
  // gross that pushes YTD through YMPE → YAMPE, apply CPP2 rate.
  let cpp2 = 0;
  const grossAfter = ytdGross + gross;
  if (grossAfter > CPP_YMPE_2026) {
    const cpp2Base = Math.min(grossAfter, CPP_YAMPE_2026) - Math.max(ytdGross, CPP_YMPE_2026);
    cpp2 = Math.max(0, cpp2Base) * CPP2_RATE_2026;
    const cpp2Remaining = Math.max(0, CPP2_MAX_ANNUAL_2026 - ytdCpp2);
    cpp2 = Math.min(cpp2, cpp2Remaining);
  }

  // Annualize for tax brackets
  const annualTaxable = gross * periods;
  // Annual CPP credit = CPP1 annualized (credit is on basic portion only; simplified model).
  const annualCppCredit = cpp * periods;

  const fedTaxAnnual = federalTaxAnnual(annualTaxable, FEDERAL_BPA_2026, annualCppCredit);
  const onTaxAnnual = ontarioTaxAnnual(annualTaxable, ONTARIO_BPA_2026, annualCppCredit);
  const ohpAnnual = ontarioHealthPremiumAnnual(annualTaxable);

  const federalTax = fedTaxAnnual / periods;
  const provincialTax = (onTaxAnnual + ohpAnnual) / periods;
  const ohp = ohpAnnual / periods;

  // EI always zero for owner-manager
  const ei = 0;

  const net = gross - cpp - cpp2 - federalTax - provincialTax - ei;

  // Employer contributions match employee for CPP; EI is 0.
  const employerCpp = cpp;
  const employerCpp2 = cpp2;

  const totalRemittance = cpp + cpp2 + federalTax + provincialTax + employerCpp + employerCpp2;

  const toCents = (n: number) => Math.round(n * 100);

  return {
    grossCents: toCents(gross),
    cppCents: toCents(cpp),
    cpp2Cents: toCents(cpp2),
    eiCents: toCents(ei),
    federalTaxCents: toCents(federalTax),
    provincialTaxCents: toCents(provincialTax),
    ohpCents: toCents(ohp),
    netCents: toCents(net),
    employerCppCents: toCents(employerCpp),
    employerCpp2Cents: toCents(employerCpp2),
    employerEiCents: 0,
    totalRemittanceCents: toCents(totalRemittance),
  };
}

/** Label helper for pay cadence enum. */
export function payPeriodsFromCadence(cadence: string): PayPeriodsPerYear {
  switch (cadence) {
    case "weekly":
      return 52;
    case "bi-weekly":
      return 26;
    case "semi-monthly":
      return 24;
    case "monthly":
    default:
      return 12;
  }
}
