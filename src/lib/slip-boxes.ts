/**
 * Pure slip-box mapping helpers — no DB access, no runtime side effects.
 * The DB-backed builders in `src/lib/queries/slip-aggregation.ts` wrap these
 * with the actual aggregator calls; verify-slips.ts exercises the pure side
 * without needing DATABASE_URL.
 *
 * Keep this module DB-free. Types `T4Boxes` / `T5Boxes` are duplicated here
 * from queries/t4-slices.ts and queries/t5-slices.ts rather than imported,
 * because importing from those modules pulls in the DB client at load time.
 */

import {
  dividendGrossUp,
  dividendTaxCredit,
} from "./t1";
import {
  ELIGIBLE_GROSS_UP_RATE,
  FEDERAL_DTC_ELIGIBLE_RATE,
  FEDERAL_DTC_NON_ELIGIBLE_RATE,
  NON_ELIGIBLE_GROSS_UP_RATE,
  ONTARIO_DTC_ELIGIBLE_RATE,
  ONTARIO_DTC_NON_ELIGIBLE_RATE_2026,
  RATES_EDITION_TAG_2026,
} from "./t1-rates-2026";

// ─────── shared T4 / T5 raw input shapes (mirror queries/*-slices.ts) ───────

export type T4BoxesInput = {
  box14EmploymentIncomeCents: number;
  box16CppBaseCents: number;
  box16aCpp2Cents: number;
  box18EiCents: number;
  box22FedTaxWithheldCents: number;
  box24EiInsurableCents: number;
  box26CppPensionableCents: number;
  box52PensionAdjustmentCents: number;
  ontarioTaxWithheldCents: number;
  employerCppBaseCents: number;
  employerCpp2Cents: number;
  count: number;
};

export type T5BoxesInput = {
  eligible: { actualCents: number; count: number };
  nonEligible: { actualCents: number; count: number };
};

export type T4ABoxesInput = {
  /** Box 117 total = benefit80_4Cents + inclusion15_2Cents (composite, after interest offset). */
  box117Cents: number;
  benefit80_4Cents: number;
  inclusion15_2Cents: number;
};

// ─────── output shapes ───────

export type T4SlipBoxes = {
  taxYear: number;
  box14EmploymentIncomeCents: number;
  box16CppBaseCents: number;
  box16aCpp2Cents: number;
  box18EiCents: number;
  box22FedTaxWithheldCents: number;
  box24EiInsurableCents: number;
  box26CppPensionableCents: number;
  box52PensionAdjustmentCents: number;
  ontarioTaxWithheldCents: number;
  employerCppBaseCents: number;
  employerCpp2Cents: number;
  paychequeCount: number;
  ratesEditionTag: string;
};

export type T5SlipBoxes = {
  taxYear: number;
  eligible: {
    actualCents: number;       // Box 24
    taxableCents: number;      // Box 25 (×1.38)
    federalDtcCents: number;   // Box 26 (15.0198% × taxable)
    ontarioDtcCents: number;   // ON428 DTC component (10% × taxable)
    count: number;
  };
  nonEligible: {
    actualCents: number;       // Box 10
    taxableCents: number;      // Box 11 (×1.15)
    federalDtcCents: number;   // Box 12 (9.0301% × taxable)
    ontarioDtcCents: number;   // ON428 DTC component (2.9863% × taxable)
    count: number;
  };
  totals: {
    actualCents: number;
    taxableCents: number;
    federalDtcCents: number;
    ontarioDtcCents: number;
  };
  ratesEditionTag: string;
};

export type T4ASlipBoxes = {
  taxYear: number;
  /** Box 117 = Loan Benefits (filed). */
  box117Cents: number;
  /** Box 022 = Income tax deducted. Always 0 — corp doesn't withhold on loan benefits. */
  box022TaxWithheldCents: number;
  /** Audit breakdown (not filed boxes — reference only). */
  breakdown: {
    benefit80_4Cents: number;
    inclusion15_2Cents: number;
  };
  ratesEditionTag: string;
};

// ─────── pure transforms ───────

export function t4SlipBoxesFromRaw(raw: T4BoxesInput, taxYear: number): T4SlipBoxes {
  return {
    taxYear,
    box14EmploymentIncomeCents: raw.box14EmploymentIncomeCents,
    box16CppBaseCents: raw.box16CppBaseCents,
    box16aCpp2Cents: raw.box16aCpp2Cents,
    box18EiCents: raw.box18EiCents,
    box22FedTaxWithheldCents: raw.box22FedTaxWithheldCents,
    box24EiInsurableCents: raw.box24EiInsurableCents,
    box26CppPensionableCents: raw.box26CppPensionableCents,
    box52PensionAdjustmentCents: raw.box52PensionAdjustmentCents,
    ontarioTaxWithheldCents: raw.ontarioTaxWithheldCents,
    employerCppBaseCents: raw.employerCppBaseCents,
    employerCpp2Cents: raw.employerCpp2Cents,
    paychequeCount: raw.count,
    ratesEditionTag: RATES_EDITION_TAG_2026,
  };
}

export function t4aSlipBoxesFromRaw(raw: T4ABoxesInput, taxYear: number): T4ASlipBoxes {
  return {
    taxYear,
    box117Cents: raw.box117Cents,
    box022TaxWithheldCents: 0,
    breakdown: {
      benefit80_4Cents: raw.benefit80_4Cents,
      inclusion15_2Cents: raw.inclusion15_2Cents,
    },
    ratesEditionTag: RATES_EDITION_TAG_2026,
  };
}

export function t5SlipBoxesFromRaw(raw: T5BoxesInput, taxYear: number): T5SlipBoxes {
  const elActual = raw.eligible.actualCents;
  const elTaxable = dividendGrossUp(elActual, ELIGIBLE_GROSS_UP_RATE);
  const elFedDtc = dividendTaxCredit(elTaxable, FEDERAL_DTC_ELIGIBLE_RATE);
  const elOnDtc = dividendTaxCredit(elTaxable, ONTARIO_DTC_ELIGIBLE_RATE);

  const neActual = raw.nonEligible.actualCents;
  const neTaxable = dividendGrossUp(neActual, NON_ELIGIBLE_GROSS_UP_RATE);
  const neFedDtc = dividendTaxCredit(neTaxable, FEDERAL_DTC_NON_ELIGIBLE_RATE);
  const neOnDtc = dividendTaxCredit(neTaxable, ONTARIO_DTC_NON_ELIGIBLE_RATE_2026);

  return {
    taxYear,
    eligible: {
      actualCents: elActual,
      taxableCents: elTaxable,
      federalDtcCents: elFedDtc,
      ontarioDtcCents: elOnDtc,
      count: raw.eligible.count,
    },
    nonEligible: {
      actualCents: neActual,
      taxableCents: neTaxable,
      federalDtcCents: neFedDtc,
      ontarioDtcCents: neOnDtc,
      count: raw.nonEligible.count,
    },
    totals: {
      actualCents: elActual + neActual,
      taxableCents: elTaxable + neTaxable,
      federalDtcCents: elFedDtc + neFedDtc,
      ontarioDtcCents: elOnDtc + neOnDtc,
    },
    ratesEditionTag: RATES_EDITION_TAG_2026,
  };
}
