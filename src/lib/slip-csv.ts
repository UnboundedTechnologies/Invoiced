/**
 * Pure CSV builders for T4 and T5 working-copy box exports. No DB, no React.
 *
 * Used by `generateT4WorkingCopyCsv` / `generateT5WorkingCopyCsv` server
 * actions so verify-slips can exercise the formatter without DATABASE_URL.
 *
 * CSV conventions:
 *  - RFC 4180: fields with comma / double-quote / newline are double-quoted;
 *    embedded double-quotes are doubled.
 *  - Formula-injection guard: field values starting with "=" / "+" / "-" /
 *    "@" / "|" / "%" / tab get a leading apostrophe ("'") so Excel and
 *    Google Sheets treat them as text, not formulas.
 *  - Dollars.cents with period as decimal separator, no thousands comma
 *    (CRA-friendly; Web Forms accepts both but bare digits avoid ambiguity).
 *  - Negative values rendered with leading minus, no parentheses.
 *  - CRLF line endings (matches Excel default + CRA e-filing conventions).
 *  - UTF-8 BOM prefix (0xEF 0xBB 0xBF) so Excel opens UTF-8 by default.
 *  - SIN boxes always emit an empty amount with a notes reminder — never
 *    stored per the project SIN rule.
 */

import type { T4SlipBoxes, T5SlipBoxes } from "./slip-boxes";

export type SlipCsvPayer = {
  corpLegalName: string;
  businessNumber: string;
  payrollAccount: string | null;
  payerRzAccount: string | null;
  directorLegalName: string;
};

// ─────────── low-level CSV utilities ───────────

const CRLF = "\r\n";
const BOM = "﻿";

/** Format integer cents as "123.45" with no thousands separator. */
export function fmtAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const cc = (abs % 100).toString().padStart(2, "0");
  return `${sign}${dollars}.${cc}`;
}

/** Escape a single field per RFC 4180 + injection guard. */
export function csvField(raw: string): string {
  const needsInjectionGuard = /^[=+\-@|%\t]/.test(raw);
  const guarded = needsInjectionGuard ? `'${raw}` : raw;
  const needsQuotes = /[",\r\n]/.test(guarded);
  if (!needsQuotes) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Join a row of fields into one CSV line. */
function row(...fields: string[]): string {
  return fields.map(csvField).join(",");
}

// ─────────── public builders ───────────

export function t4BoxesToCsv(
  boxes: T4SlipBoxes,
  payer: SlipCsvPayer,
  taxYear: number,
): string {
  const lines: string[] = [];
  // Header
  lines.push(row("Section", "Box", "Description", "Amount", "Notes"));

  // META — payer / recipient identity
  lines.push(row("META", "", "Tax year (CY)", String(taxYear), "Calendar year — payDate in [Jan 1, Dec 31]"));
  lines.push(row("META", "", "Payer legal name", payer.corpLegalName, "Employer on T4 slip"));
  lines.push(row("META", "Box 54", "Employer BN/RP account", payer.payrollAccount ?? "", "Format NNNNNNNNNRP0001"));
  lines.push(row("META", "", "Recipient legal name", payer.directorLegalName, "Employee on T4 slip"));
  lines.push(row("META", "Box 12", "Recipient SIN", "", "NEVER STORED by Invoiced — enter on CRA Web Forms directly"));
  lines.push(row("META", "", "Rates edition", boxes.ratesEditionTag, "Reproducibility tag"));
  lines.push(row("META", "", "Paycheque count", String(boxes.paychequeCount), "Σ issued paycheques with payDate in this CY"));

  // SLIP boxes
  lines.push(row("SLIP", "Box 10", "Province of employment", "ON", "Ontario"));
  lines.push(row("SLIP", "Box 14", "Employment income", fmtAmount(boxes.box14EmploymentIncomeCents), ""));
  lines.push(row("SLIP", "Box 16", "CPP employee contributions — base (5.95%)", fmtAmount(boxes.box16CppBaseCents), ""));
  lines.push(row("SLIP", "Box 16A", "CPP2 employee contributions — enhanced (4%)", fmtAmount(boxes.box16aCpp2Cents), ""));
  lines.push(row("SLIP", "Box 18", "EI premiums", fmtAmount(boxes.box18EiCents), "Owner-manager EI-exempt — should be 0.00"));
  lines.push(row("SLIP", "Box 22", "Income tax deducted — federal", fmtAmount(boxes.box22FedTaxWithheldCents), ""));
  lines.push(row("SLIP", "", "Income tax deducted — Ontario (informational)", fmtAmount(boxes.ontarioTaxWithheldCents), "Not a CRA T4 box; included for sanity-check"));
  lines.push(row("SLIP", "Box 24", "EI insurable earnings", fmtAmount(boxes.box24EiInsurableCents), "Owner-manager EI-exempt — should be 0.00"));
  lines.push(row("SLIP", "Box 26", "CPP pensionable earnings", fmtAmount(boxes.box26CppPensionableCents), ""));
  lines.push(row("SLIP", "Box 28", "CPP/QPP + EI exempt indicator", "X", "Tick EI-exempt for owner-manager >40% voting shares"));
  lines.push(row("SLIP", "Box 52", "Pension adjustment", fmtAmount(boxes.box52PensionAdjustmentCents), ""));

  // SUMMARY totals (for T4 Summary form on Web Forms)
  lines.push(row("SUMMARY", "Line 14", "Total employment income (Σ all T4 Box 14)", fmtAmount(boxes.box14EmploymentIncomeCents), ""));
  lines.push(row("SUMMARY", "Line 16", "Total employee CPP contributions (Σ Box 16)", fmtAmount(boxes.box16CppBaseCents), ""));
  lines.push(row("SUMMARY", "Line 16A", "Total employee CPP2 contributions (Σ Box 16A)", fmtAmount(boxes.box16aCpp2Cents), ""));
  lines.push(row("SUMMARY", "Line 18", "Total EI premiums (Σ Box 18)", fmtAmount(boxes.box18EiCents), "Owner-manager exempt"));
  lines.push(row("SUMMARY", "Line 22", "Total federal tax withheld (Σ Box 22)", fmtAmount(boxes.box22FedTaxWithheldCents), ""));
  lines.push(row("SUMMARY", "", "Total Ontario tax withheld (informational)", fmtAmount(boxes.ontarioTaxWithheldCents), ""));
  lines.push(row("SUMMARY", "", "Employer CPP contributions (matching)", fmtAmount(boxes.employerCppBaseCents), ""));
  lines.push(row("SUMMARY", "", "Employer CPP2 contributions (matching)", fmtAmount(boxes.employerCpp2Cents), ""));
  lines.push(row("SUMMARY", "", "Total source-deduction remittance (fed + ON + CPP EE + CPP ER + CPP2 EE + CPP2 ER)", fmtAmount(
    boxes.box22FedTaxWithheldCents +
    boxes.ontarioTaxWithheldCents +
    boxes.box16CppBaseCents +
    boxes.employerCppBaseCents +
    boxes.box16aCpp2Cents +
    boxes.employerCpp2Cents,
  ), "What should have been remitted on PD7A during the CY"));

  return BOM + lines.join(CRLF) + CRLF;
}

export function t5BoxesToCsv(
  boxes: T5SlipBoxes,
  payer: SlipCsvPayer,
  taxYear: number,
): string {
  const lines: string[] = [];
  lines.push(row("Section", "Box", "Description", "Amount", "Notes"));

  const paidCount = boxes.eligible.count + boxes.nonEligible.count;

  lines.push(row("META", "", "Tax year (CY)", String(taxYear), "Calendar year — paidDate in [Jan 1, Dec 31]"));
  lines.push(row("META", "", "Payer legal name", payer.corpLegalName, "Payer on T5 slip"));
  lines.push(row("META", "", "Payer BN/RZ account", payer.payerRzAccount ?? "", "Format NNNNNNNNNRZ0001 — required for T5"));
  lines.push(row("META", "", "Recipient legal name", payer.directorLegalName, "Recipient on T5 slip"));
  lines.push(row("META", "", "Recipient SIN", "", "NEVER STORED by Invoiced — enter on CRA Web Forms directly"));
  lines.push(row("META", "", "Rates edition", boxes.ratesEditionTag, "Reproducibility tag"));
  lines.push(row("META", "", "Eligible dividend count", String(boxes.eligible.count), "Σ paid dividends with eligible=true"));
  lines.push(row("META", "", "Non-eligible dividend count", String(boxes.nonEligible.count), "Σ paid dividends with eligible=false"));
  lines.push(row("META", "", "Total paid dividend count", String(paidCount), ""));

  // SLIP — recipient metadata
  lines.push(row("SLIP", "Box 21", "Report code", "O", "O=Original · A=Amended · C=Cancelled"));
  lines.push(row("SLIP", "Box 22", "Recipient type", "1", "1=Individual · 2=Joint · 3=Corporation · 4=Other"));
  lines.push(row("SLIP", "Box 27", "Foreign currency code", "", "Leave blank when reporting in CAD"));

  // SLIP — eligible dividends
  lines.push(row("SLIP", "Box 24", "Actual amount of eligible dividends", fmtAmount(boxes.eligible.actualCents), ""));
  lines.push(row("SLIP", "Box 25", "Taxable amount of eligible dividends (× 1.38 gross-up)", fmtAmount(boxes.eligible.taxableCents), ""));
  lines.push(row("SLIP", "Box 26", "Dividend tax credit — eligible (15.0198% × Box 25)", fmtAmount(boxes.eligible.federalDtcCents), ""));

  // SLIP — other-than-eligible dividends
  lines.push(row("SLIP", "Box 10", "Actual amount of non-eligible dividends", fmtAmount(boxes.nonEligible.actualCents), ""));
  lines.push(row("SLIP", "Box 11", "Taxable amount of non-eligible dividends (× 1.15 gross-up)", fmtAmount(boxes.nonEligible.taxableCents), ""));
  lines.push(row("SLIP", "Box 12", "Dividend tax credit — non-eligible (9.0301% × Box 11)", fmtAmount(boxes.nonEligible.federalDtcCents), ""));

  // SLIP — other (typically blank for our corp)
  lines.push(row("SLIP", "Box 13", "Interest from Canadian sources", "0.00", "Typically 0 for a CCPC that only pays dividends"));

  // Provincial context (informational — ON DTC isn't on the T5 slip but flows into T1 ON428)
  lines.push(row("SLIP", "", "Ontario DTC — eligible (10% × Box 25, informational)", fmtAmount(boxes.eligible.ontarioDtcCents), "Not a CRA T5 box"));
  lines.push(row("SLIP", "", "Ontario DTC — non-eligible (2.9863% × Box 11 in 2026, informational)", fmtAmount(boxes.nonEligible.ontarioDtcCents), "Not a CRA T5 box"));

  // SUMMARY totals (for T5 Summary form on Web Forms)
  lines.push(row("SUMMARY", "", "Total actual eligible dividends paid (Σ Box 24)", fmtAmount(boxes.eligible.actualCents), ""));
  lines.push(row("SUMMARY", "", "Total taxable eligible dividends (Σ Box 25)", fmtAmount(boxes.eligible.taxableCents), ""));
  lines.push(row("SUMMARY", "", "Total federal DTC — eligible (Σ Box 26)", fmtAmount(boxes.eligible.federalDtcCents), ""));
  lines.push(row("SUMMARY", "", "Total actual non-eligible dividends paid (Σ Box 10)", fmtAmount(boxes.nonEligible.actualCents), ""));
  lines.push(row("SUMMARY", "", "Total taxable non-eligible dividends (Σ Box 11)", fmtAmount(boxes.nonEligible.taxableCents), ""));
  lines.push(row("SUMMARY", "", "Total federal DTC — non-eligible (Σ Box 12)", fmtAmount(boxes.nonEligible.federalDtcCents), ""));
  lines.push(row("SUMMARY", "", "Grand total actual dividends (all recipients)", fmtAmount(boxes.totals.actualCents), ""));
  lines.push(row("SUMMARY", "", "Grand total taxable (grossed-up)", fmtAmount(boxes.totals.taxableCents), ""));
  lines.push(row("SUMMARY", "", "Grand total federal DTC", fmtAmount(boxes.totals.federalDtcCents), ""));
  lines.push(row("SUMMARY", "", "Grand total Ontario DTC (informational)", fmtAmount(boxes.totals.ontarioDtcCents), ""));

  return BOM + lines.join(CRLF) + CRLF;
}
