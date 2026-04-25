/**
 * Personal tax (T1) rates and thresholds — 2026 (Ontario resident).
 *
 * Primary sources:
 *   - CRA T4127 Payroll Deductions Formulas, January 1 2026 edition (122nd)
 *     https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan.html
 *   - CRA Adjustment of Personal Income Tax and Benefit Amounts (Jan 2026)
 *   - Ontario Taxation Act (brackets + surtax + OHP)
 *   - Ontario Budget 2026 Annex (non-eligible DTC rate for 2026 and 2027+)
 *
 * Federal brackets / BPA / Ontario brackets / Ontario surtax / OHP function
 * are re-exported from `payroll-2026.ts` (single source of truth).
 *
 * Uncertain values flagged in comments — revisit on CRA TD1 2026 publication:
 *   - CANADA_EMPLOYMENT_AMOUNT_2026
 *   - Ontario surtax ordering vs DTC (confirmed: surtax BEFORE DTC per Ontario
 *     2014 Budget; see ontario.ca).
 */

export {
  // Bracket + credit rate primitives (SSOT in payroll-2026.ts).
  FEDERAL_BRACKETS_2026,
  FEDERAL_CREDIT_RATE_2026,
  FEDERAL_BPA_MAX_2026,
  FEDERAL_BPA_MIN_2026,
  FEDERAL_BPA_PHASE_START_2026,
  FEDERAL_BPA_PHASE_END_2026,
  federalBpaFor,
  ONTARIO_BRACKETS_2026,
  ONTARIO_CREDIT_RATE_2026,
  ONTARIO_BPA_2026,
  ONTARIO_SURTAX,
  ontarioHealthPremiumAnnual,
  CPP_YMPE_2026,
  CPP_YAMPE_2026,
  CPP_BASIC_EXEMPTION_2026,
  CPP_RATE_2026,
  CPP2_RATE_2026,
} from "./payroll-2026";

/** Version tag stamped on every filed T1 snapshot so we know which rate file produced it. */
export const RATES_EDITION_TAG_2026 = "T4127-122-JAN-2026";

/** Canada Employment Amount (line 31260) — FLAG: confirm against CRA TD1 2026 before first real filing. */
export const CANADA_EMPLOYMENT_AMOUNT_2026 = 1_501;

// ───── Dividend gross-up + DTC (2026) ─────

/** Eligible-dividend gross-up rate (ITA s.82(1)(b)(ii)) — stable at 38%. */
export const ELIGIBLE_GROSS_UP_RATE = 0.38;

/** Non-eligible (ordinary) dividend gross-up rate (ITA s.82(1)(b)(i)) — stable at 15%. */
export const NON_ELIGIBLE_GROSS_UP_RATE = 0.15;

/**
 * Federal dividend tax credit rates applied to the **grossed-up** dividend.
 * Eligible: 15.0198% (line 40425 component).
 * Non-eligible: 9.0301% (line 40425 component).
 */
export const FEDERAL_DTC_ELIGIBLE_RATE = 0.150198;
export const FEDERAL_DTC_NON_ELIGIBLE_RATE = 0.090301;

/**
 * Ontario dividend tax credit rates applied to the **grossed-up** dividend.
 * Eligible: 10% (ontario.ca/ontario-dividend-tax-credit).
 * Non-eligible: 2.9863% for 2026; drops to 1.9863% for 2027+ per Ontario Budget 2026 Annex.
 */
export const ONTARIO_DTC_ELIGIBLE_RATE = 0.10;
export const ONTARIO_DTC_NON_ELIGIBLE_RATE_2026 = 0.029863;

// ───── Charitable donations (line 34900 / ON428 line 5896) ─────

/**
 * Federal donations credit per ITA s.118.1(3):
 *  - 15% on first $200
 *  - 33% on the portion above $200 to the extent the donor has taxable income
 *    in the top federal bracket (≥ FEDERAL_BRACKETS_2026[3].upTo, $258,482 for 2026)
 *  - 29% on the remainder above $200
 */
export const FEDERAL_DONATION_LOW_RATE = 0.15;
export const FEDERAL_DONATION_TOP_RATE = 0.33;  // matches top federal bracket rate
export const FEDERAL_DONATION_HIGH_RATE = 0.29; // matches second-from-top bracket rate
export const FEDERAL_DONATION_LOW_THRESHOLD_CENTS = 200_00;

/**
 * Ontario donations credit per Ontario Taxation Act s.9(1) — flat-rate above $200.
 * The 11.16% rate is statutory, NOT derived from any bracket; it has not changed
 * since 2014.
 */
export const ONTARIO_DONATION_LOW_RATE = 0.0505;
export const ONTARIO_DONATION_HIGH_RATE = 0.1116;

// ───── CPP credit / deduction split ─────

/**
 * Of the 5.95% base CPP rate, the first 4.95 percentage points are a
 * non-refundable credit (line 30800); the remaining 1.00 percentage point
 * is an enhanced-CPP deduction (line 22215, s.60(e)).
 *
 * Hardwired split (per Phase 4D decision — identical cents to the literal
 * form but simpler to verify).
 */
export const CPP_BASE_CREDIT_FRACTION = 4.95 / 5.95;  // ≈ 0.8319
export const CPP_ENHANCED_DEDUCTION_FRACTION = 1.00 / 5.95; // ≈ 0.1681
