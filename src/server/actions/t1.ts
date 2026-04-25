"use server";

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  t1Returns,
  settings,
  deadlines,
  auditLog,
  type T1Return,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
import {
  computeT1,
  dividendGrossUp,
  t1FilingDueDate,
  taxYearFor,
  type T1Result,
} from "@/lib/t1";
import { ELIGIBLE_GROSS_UP_RATE, NON_ELIGIBLE_GROSS_UP_RATE } from "@/lib/t1-rates-2026";
import { buildT1Inputs, taxYearsWithActivity } from "@/lib/queries/personal-tax-slices";
import { t4BoxesForYear } from "@/lib/queries/t4-slices";
import { t5BoxesForYear } from "@/lib/queries/t5-slices";
import { t4aBox117ForYear } from "@/lib/queries/t4a-slices";
import { donationsForYear } from "@/lib/queries/donations-slices";
import { getBannerDataUri } from "@/lib/pdf-banner";
import { T1PrepPDF } from "@/lib/t1-pdf";

type ActionResult = {
  ok?: string;
  error?: string;
  pdfBase64?: string;
};

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate(taxYear?: number) {
  revalidatePath("/personal-tax");
  if (taxYear !== undefined) revalidatePath(`/personal-tax/${taxYear}`);
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/(app)", "layout");
}

// ————————————————————————————————————————————————————————————————
// Shared helper: filing-lock guard used by paycheques / dividends /
// shareholder-loan mutations. Additive defense-in-depth with T2 lock —
// both checks run; any failure blocks. This is not duplication: the two
// returns cover different slices (T2 = fiscal year; T1 = calendar year),
// which routinely disagree unless FYE happens to be Dec 31.
// ————————————————————————————————————————————————————————————————

export async function t1PeriodLockError(iso: string): Promise<string | null> {
  const taxYear = taxYearFor(iso);
  const [r] = await db
    .select({ status: t1Returns.status })
    .from(t1Returns)
    .where(eq(t1Returns.taxYear, taxYear))
    .limit(1);
  if (r?.status === "filed") {
    return `T1 return for CY ${taxYear} is filed. Corrections route through CRA form T1-ADJ or the next-year return.`;
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// Live aggregation — drives /personal-tax/[cy] detail page and the
// filing snapshot. Reads from source-of-truth tables via the shared
// slice helpers; single source per box.
// ————————————————————————————————————————————————————————————————

export type LiveT1Aggregate = {
  taxYear: number;
  period: { start: string; end: string };
  dueDate: string;
  t4: Awaited<ReturnType<typeof t4BoxesForYear>>;
  t5: Awaited<ReturnType<typeof t5BoxesForYear>>;
  t4a: Awaited<ReturnType<typeof t4aBox117ForYear>>;
  donations: Awaited<ReturnType<typeof donationsForYear>>;
  result: T1Result;
  // Grossed-up dividend slices — surfaced for PDF + coherence checks
  grossedUp: {
    eligibleCents: number;
    nonEligibleCents: number;
  };
  warnings: string[];
};

export async function loadLiveT1Aggregate(taxYear: number): Promise<LiveT1Aggregate> {
  const start = `${taxYear}-01-01`;
  const end = `${taxYear}-12-31`;

  const [t4, t5, t4a, don] = await Promise.all([
    t4BoxesForYear(taxYear),
    t5BoxesForYear(taxYear),
    t4aBox117ForYear(taxYear),
    donationsForYear(taxYear),
  ]);

  const input = await buildT1Inputs(taxYear);
  const result = computeT1(input);

  const grossedUpEligible = dividendGrossUp(t5.eligible.actualCents, ELIGIBLE_GROSS_UP_RATE);
  const grossedUpNonEligible = dividendGrossUp(t5.nonEligible.actualCents, NON_ELIGIBLE_GROSS_UP_RATE);

  return {
    taxYear,
    period: { start, end },
    dueDate: t1FilingDueDate(taxYear),
    t4,
    t5,
    t4a,
    donations: don,
    result,
    grossedUp: {
      eligibleCents: grossedUpEligible,
      nonEligibleCents: grossedUpNonEligible,
    },
    warnings: result.warnings,
  };
}

// ————————————————————————————————————————————————————————————————
// Upsert draft — creates the row if missing, idempotent otherwise.
// Also emits a `t1:<cy>` deadline row due April 30 of cy+1.
// ————————————————————————————————————————————————————————————————

export async function upsertDraftT1Return(taxYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();

    const [existing] = await db
      .select()
      .from(t1Returns)
      .where(eq(t1Returns.taxYear, taxYear))
      .limit(1);
    if (existing) {
      // Still make sure the deadline exists — cheap idempotent upsert.
      await db
        .insert(deadlines)
        .values({
          title: `T1 return — CY ${taxYear}`,
          description: "Personal tax filing deadline (ITA s.150(1)(d)).",
          dueDate: t1FilingDueDate(taxYear),
          category: "t1",
          sourceKey: `t1:${taxYear}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey });
      return { ok: "Draft T1 return exists." };
    }

    await db.batch([
      db.insert(t1Returns).values({
        taxYear,
        status: "draft",
      }),
      db
        .insert(deadlines)
        .values({
          title: `T1 return — CY ${taxYear}`,
          description: "Personal tax filing deadline (ITA s.150(1)(d)).",
          dueDate: t1FilingDueDate(taxYear),
          category: "t1",
          sourceKey: `t1:${taxYear}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `t1_returns:${taxYear}`,
        metadata: { taxYear, dueDate: t1FilingDueDate(taxYear) },
      }),
    ]);
    revalidate(taxYear);
    return { ok: "Draft T1 return created." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// File — freeze snapshot, delete deadline, audit. No un-file.
// CRA confirmation number regex accepts both NETFILE (8 alphanumeric) and
// preparer-EFILE formats per plan locked decision.
// ————————————————————————————————————————————————————————————————

const fileSchema = z.object({
  craConfirmationNumber: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{6,12}$/i, "Expect 6–12 alphanumeric characters (NETFILE or EFILE)"),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Filed date required"),
});

export async function fileT1Return(
  taxYear: number,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = fileSchema.safeParse({
      craConfirmationNumber: fd.get("craConfirmationNumber"),
      filedAt: fd.get("filedAt"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const [existing] = await db
      .select()
      .from(t1Returns)
      .where(eq(t1Returns.taxYear, taxYear));
    if (!existing) return { error: "T1 return not found." };
    if (existing.status === "filed") return { error: "T1 return is already filed." };

    // Recompute from authoritative source.
    const live = await loadLiveT1Aggregate(taxYear);
    const r = live.result;

    const filedAtTs = new Date(parsed.data.filedAt + "T00:00:00Z");

    await db.batch([
      db
        .update(t1Returns)
        .set({
          status: "filed",
          // T4 snapshot
          t4Box14Cents: live.t4.box14EmploymentIncomeCents,
          t4Box16Cents: live.t4.box16CppBaseCents,
          t4Box16aCents: live.t4.box16aCpp2Cents,
          t4Box18Cents: live.t4.box18EiCents,
          t4Box22Cents: live.t4.box22FedTaxWithheldCents,
          t4Box24Cents: live.t4.box24EiInsurableCents,
          t4Box26Cents: live.t4.box26CppPensionableCents,
          t4Box52Cents: live.t4.box52PensionAdjustmentCents,
          onTaxWithheldCents: live.t4.ontarioTaxWithheldCents,
          // T5 snapshot
          t5EligibleActualCents: live.t5.eligible.actualCents,
          t5EligibleGrossedUpCents: live.grossedUp.eligibleCents,
          t5NonEligibleActualCents: live.t5.nonEligible.actualCents,
          t5NonEligibleGrossedUpCents: live.grossedUp.nonEligibleCents,
          // T4A box 117
          t4aBox117Cents: live.t4a.cents,
          // Income flow
          totalIncomeCents: r.totalIncomeCents,
          cppEnhancedDeductionCents: r.cppEnhancedDeductionCents,
          cpp2DeductionCents: r.cpp2DeductionCents,
          netIncomeCents: r.netIncomeCents,
          taxableIncomeCents: r.taxableIncomeCents,
          // Federal
          federalBracketTaxCents: r.federal.bracketTaxCents,
          federalBpaAmountCents: r.federal.bpaAmountCents,
          federalCeaAmountCents: r.federal.ceaAmountCents,
          federalCppBaseAmountCents: r.federal.cppBaseAmountCents,
          federalCreditsAmountCents: r.federal.nonRefundableCreditsCents,
          federalCreditsTaxCents: r.federal.nonRefundableCreditsTaxCents,
          federalDtcEligibleCents: r.federal.dtcEligibleCents,
          federalDtcNonEligibleCents: r.federal.dtcNonEligibleCents,
          federalTaxPayableCents: r.federal.federalTaxPayableCents,
          // Ontario
          ontarioBracketTaxCents: r.ontario.bracketTaxCents,
          ontarioBpaAmountCents: r.ontario.bpaAmountCents,
          ontarioCppBaseAmountCents: r.ontario.cppBaseAmountCents,
          ontarioBasicTaxAfterCreditsCents: r.ontario.basicTaxAfterCreditsCents,
          ontarioSurtaxTier1Cents: r.ontario.surtaxTier1Cents,
          ontarioSurtaxTier2Cents: r.ontario.surtaxTier2Cents,
          ontarioDtcEligibleCents: r.ontario.dtcEligibleCents,
          ontarioDtcNonEligibleCents: r.ontario.dtcNonEligibleCents,
          ontarioHealthPremiumCents: r.ontario.ontarioHealthPremiumCents,
          ontarioTaxPayableCents: r.ontario.ontarioTaxPayableCents,
          // Totals
          totalTaxPayableCents: r.totalTaxPayableCents,
          totalWithheldCents: r.totalWithheldCents,
          cpp2OverpaymentCents: r.cpp2OverpaymentCents,
          refundOrOwingCents: r.refundOrOwingCents,
          // Donations snapshot (line 34900 + ON428 line 5896)
          donationsTotalCents: live.donations.totalCents,
          federalDonationsCreditCents: r.federal.donationsCreditCents,
          ontarioDonationsCreditCents: r.ontario.donationsCreditCents,
          // Meta
          ratesEditionTag: r.ratesEditionTag,
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: filedAtTs,
          filedBy: email,
          updatedAt: new Date(),
        })
        .where(eq(t1Returns.taxYear, taxYear)),
      db.delete(deadlines).where(eq(deadlines.sourceKey, `t1:${taxYear}`)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `t1_returns:${taxYear}:file`,
        metadata: {
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: parsed.data.filedAt,
          totalTaxCents: r.totalTaxPayableCents,
          refundOrOwingCents: r.refundOrOwingCents,
          ratesEditionTag: r.ratesEditionTag,
        },
      }),
    ]);

    revalidate(taxYear);
    return { ok: "T1 return filed and locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// PDF generation
// ————————————————————————————————————————————————————————————————

export async function generateT1Pdf(taxYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [row] = await db
      .select()
      .from(t1Returns)
      .where(eq(t1Returns.taxYear, taxYear));
    if (!row) return { error: "T1 return not found." };
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings not seeded." };

    const live = await loadLiveT1Aggregate(taxYear);
    const bannerDataUri = await getBannerDataUri();

    const buffer = await renderToBuffer(
      T1PrepPDF({
        taxYear,
        status: row.status,
        live,
        frozen: row.status === "filed" ? row : null,
        settings: {
          directorLegalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          brandPrimaryHex: s.brandPrimaryHex,
          brandAccentHex: s.brandAccentHex,
        },
        bannerDataUri,
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `t1_returns:${taxYear}:pdf`,
      metadata: { status: row.status },
    });

    return { ok: "PDF generated.", pdfBase64 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// List query — used by /personal-tax index page
// ————————————————————————————————————————————————————————————————

export async function listT1Returns(): Promise<T1Return[]> {
  await requireSession();
  return db.select().from(t1Returns).orderBy(desc(t1Returns.taxYear));
}

/** Candidate-CY detection — used by /personal-tax list page's "Start CY X" CTA. */
export async function listTaxYearsWithActivity(): Promise<number[]> {
  await requireSession();
  return taxYearsWithActivity();
}

// ————————————————————————————————————————————————————————————————
// Calendar integration — idempotent sync of T1 deadlines for every CY
// with activity. Called from /calendar alongside syncAnnualDeadlines.
// ————————————————————————————————————————————————————————————————

export async function syncT1Deadlines(): Promise<ActionResult> {
  try {
    await requireSession();
    const years = await taxYearsWithActivity();
    if (years.length === 0) return { ok: "No CYs with activity yet." };

    // For every CY with activity, ensure a `t1:<cy>` deadline exists.
    // `onConflictDoNothing` relies on the unique constraint on sourceKey.
    for (const cy of years) {
      // Skip if a T1 return is already filed for this CY (the deadline was
      // deleted on file, and we don't want to resurrect it).
      const [t1Row] = await db
        .select({ status: t1Returns.status })
        .from(t1Returns)
        .where(eq(t1Returns.taxYear, cy));
      if (t1Row?.status === "filed") continue;

      await db
        .insert(deadlines)
        .values({
          title: `T1 return — CY ${cy}`,
          description: "Personal tax filing deadline (ITA s.150(1)(d)).",
          dueDate: t1FilingDueDate(cy),
          category: "t1",
          sourceKey: `t1:${cy}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey });
    }
    return { ok: `Synced ${years.length} T1 deadline(s).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}
