"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { slips } from "@/lib/db/schema";
import { taxYearFor } from "@/lib/t1";

// Shared slip-filing lock helpers. All three check whether a slip with
// status='filed' exists for the calendar year derived from the given ISO
// date. Draft slips do NOT lock — data keeps flowing into the draft until
// you explicitly file it. Voided slips also don't lock — the void reopens
// the underlying data.
//
// CALENDAR year (via taxYearFor), NOT fiscal year. T4 uses payDate, T5
// uses paidDate, T4A uses entryDate — each routed through taxYearFor so
// non-Dec-31 FYE corps lock on the right year.
async function slipLockError(
  iso: string,
  type: "T4" | "T5" | "T4A",
  editLabel: string,
): Promise<string | null> {
  const cy = taxYearFor(iso);
  const [row] = await db
    .select({ id: slips.id })
    .from(slips)
    .where(
      and(
        eq(slips.type, type),
        eq(slips.taxYear, cy),
        eq(slips.status, "filed"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return `A ${type} slip was filed for CY ${cy}. ${editLabel} is locked — void the slip to reopen the data.`;
}

/** Block if a T4 slip is filed for the paycheque's pay-date calendar year. */
export async function t4SlipLockError(payDate: string): Promise<string | null> {
  return slipLockError(payDate, "T4", "Paycheque edit");
}

/** Block if a T5 slip is filed for the dividend's paid-date calendar year. */
export async function t5SlipLockError(paidDate: string): Promise<string | null> {
  return slipLockError(paidDate, "T5", "Dividend edit");
}

/** Block if a T4A slip is filed for the loan-entry's entry-date calendar year. */
export async function t4aSlipLockError(entryDate: string): Promise<string | null> {
  return slipLockError(entryDate, "T4A", "Loan-ledger edit");
}
