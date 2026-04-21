/**
 * Canonical T4 box aggregates for a given calendar year.
 *
 * Reads `paycheques WHERE status='issued' AND payDate IN [cy-01-01, cy-12-31]`.
 * Every T4-sourced number on /personal-tax, dashboard, and Phase 6 must flow
 * through this helper so filters can't drift between pages.
 *
 * `scripts/verify-coherence.ts` asserts that T1's box14 ≡ this helper's box14,
 * box16 ≡ cpp, box16a ≡ cpp2, box22 ≡ federal-tax-withheld, etc.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client";
import { paycheques } from "../db/schema";

export type T4Boxes = {
  box14EmploymentIncomeCents: number;
  box16CppBaseCents: number;
  box16aCpp2Cents: number;
  box18EiCents: number;              // always 0 for owner-manager
  box22FedTaxWithheldCents: number;
  box24EiInsurableCents: number;     // always 0
  box26CppPensionableCents: number;
  box52PensionAdjustmentCents: number; // 0 in v1 (no IPP)
  ontarioTaxWithheldCents: number;   // includes OHP — `paycheques.provincialTaxCents`
  employerCppBaseCents: number;
  employerCpp2Cents: number;
  count: number;
};

export async function t4BoxesForYear(cy: number): Promise<T4Boxes> {
  const start = `${cy}-01-01`;
  const end = `${cy}-12-31`;
  const rows = await db
    .select()
    .from(paycheques)
    .where(
      and(
        eq(paycheques.status, "issued"),
        gte(paycheques.payDate, start),
        lte(paycheques.payDate, end),
      ),
    );

  const z: T4Boxes = {
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
    count: rows.length,
  };
  for (const r of rows) {
    z.box14EmploymentIncomeCents += r.grossCents;
    z.box16CppBaseCents += r.cppCents;
    z.box16aCpp2Cents += r.cpp2Cents;
    z.box18EiCents += r.eiCents;
    z.box22FedTaxWithheldCents += r.federalTaxCents;
    z.box26CppPensionableCents += r.grossCents; // simplified: gross is pensionable until YMPE
    z.ontarioTaxWithheldCents += r.provincialTaxCents;
    z.employerCppBaseCents += r.employerCppCents;
    z.employerCpp2Cents += r.employerCpp2Cents;
  }
  return z;
}
