"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { slips, type Slip } from "@/lib/db/schema";
import { taxYearFor } from "@/lib/t1";
import { auth } from "../../../auth";
import { taxYearsWithActivity } from "@/lib/queries/personal-tax-slices";
import { buildT4SlipBoxes, buildT5SlipBoxes } from "@/lib/queries/slip-aggregation";
import type { T4SlipBoxes, T5SlipBoxes } from "@/lib/slip-boxes";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

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

// ────────────────────────────────────────────────────────────────────────
// List + preview queries — drive /slips + /slips/[taxYear]
// ────────────────────────────────────────────────────────────────────────

/** All slip rows (any type, any status — including voided) ordered newest tax year first. */
export async function listAllSlips(): Promise<Slip[]> {
  await requireSession();
  return db.select().from(slips).orderBy(desc(slips.taxYear), desc(slips.createdAt));
}

/** Candidate CY detection for slips. A CY is a slip candidate if it has activity
 *  (paycheques/dividends/loan entries) AND no active (non-void) T4+T5 pair yet. */
export async function listSlipCandidateYears(): Promise<number[]> {
  await requireSession();
  const years = await taxYearsWithActivity();
  // Even years with filed T4 only (no T5) still show up — `/slips/[cy]` shows both cards.
  return years.sort((a, b) => b - a);
}

export type SlipPreview = {
  taxYear: number;
  t4: T4SlipBoxes;
  t5: T5SlipBoxes;
  /** Existing DB rows for each slip type (active or voided). */
  existing: { t4: Slip | null; t5: Slip | null };
};

/** Full preview for a tax year: live T4/T5 boxes from aggregators + any existing slip rows. */
export async function loadSlipPreview(taxYear: number): Promise<SlipPreview> {
  await requireSession();
  const [t4, t5, rows] = await Promise.all([
    buildT4SlipBoxes(taxYear),
    buildT5SlipBoxes(taxYear),
    db.select().from(slips).where(eq(slips.taxYear, taxYear)),
  ]);
  // Pick the active (non-void) slip per type, falling back to newest voided if no active exists.
  const pickByType = (type: "T4" | "T5"): Slip | null => {
    const typed = rows.filter((r) => r.type === type);
    const active = typed.find((r) => r.status !== "void");
    if (active) return active;
    return typed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  };
  return {
    taxYear,
    t4,
    t5,
    existing: { t4: pickByType("T4"), t5: pickByType("T5") },
  };
}
