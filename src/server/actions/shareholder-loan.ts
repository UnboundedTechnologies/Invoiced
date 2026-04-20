"use server";

import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  shareholderLoanEntries,
  prescribedRatePeriods,
  settings,
  slips,
  auditLog,
  dividends,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor, formatCAD } from "@/lib/utils";
import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "@/lib/shareholder-loan";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/shareholder-loan");
  revalidatePath("/dashboard");
  revalidatePath("/dividends");
  revalidatePath("/(app)", "layout");
}

async function t5SlipIssuedFor(fiscalYear: number) {
  const [row] = await db
    .select({ id: slips.id })
    .from(slips)
    .where(and(eq(slips.type, "T5"), eq(slips.taxYear, fiscalYear)))
    .limit(1);
  return !!row;
}

async function getFye() {
  const [s] = await db
    .select({ m: settings.fiscalYearEndMonth, d: settings.fiscalYearEndDay })
    .from(settings)
    .where(eq(settings.id, 1));
  return { fyeMonth: s?.m ?? 12, fyeDay: s?.d ?? 31 };
}

async function t4aSlipIssuedFor(fiscalYear: number) {
  const [row] = await db
    .select({ id: slips.id })
    .from(slips)
    .where(and(eq(slips.type, "T4A"), eq(slips.taxYear, fiscalYear)))
    .limit(1);
  return !!row;
}

//  Entries
const entrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required (YYYY-MM-DD)"),
  type: z.enum(["draw", "repayment", "interest_payment", "reclassification"]),
  amountDollars: z.coerce.number().positive("Amount must be greater than 0"),
  description: z.string().max(500).nullable(),
  sourceKind: z.string().max(50).nullable(),
  sourceRef: z.string().max(200).nullable(),
});

function parseEntry(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v ? String(v).trim() : "";
  };
  return entrySchema.safeParse({
    entryDate: get("entryDate"),
    type: get("type"),
    amountDollars: get("amountDollars"),
    description: get("description") || null,
    sourceKind: get("sourceKind") || null,
    sourceRef: get("sourceRef") || null,
  });
}

export async function createLoanEntry(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = parseEntry(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { entryDate, type, amountDollars, description, sourceKind, sourceRef } = parsed.data;
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(entryDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    if (await t4aSlipIssuedFor(fiscalYear)) {
      return { error: `A T4A slip was issued for FY ${fiscalYear}. Can't add a new entry in a closed year.` };
    }

    const [created] = await db
      .insert(shareholderLoanEntries)
      .values({
        entryDate,
        type,
        amountCents,
        description,
        sourceKind,
        sourceRef,
        fiscalYear,
      })
      .returning({ id: shareholderLoanEntries.id });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `shareholder_loan_entries:${created!.id}`,
      metadata: { type, amountCents, entryDate, fiscalYear },
    });
    revalidate();
    return { ok: `Entry recorded.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function updateLoanEntry(
  id: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(eq(shareholderLoanEntries.id, id));
    if (!existing) return { error: "Entry not found." };

    const parsed = parseEntry(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { entryDate, type, amountDollars, description, sourceKind, sourceRef } = parsed.data;
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(entryDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    if (await t4aSlipIssuedFor(existing.fiscalYear)) {
      return { error: `A T4A slip was issued for FY ${existing.fiscalYear}. Edits are locked.` };
    }
    if (fiscalYear !== existing.fiscalYear && (await t4aSlipIssuedFor(fiscalYear))) {
      return { error: `A T4A slip was issued for FY ${fiscalYear}. Can't move an entry into a closed year.` };
    }

    await db
      .update(shareholderLoanEntries)
      .set({ entryDate, type, amountCents, description, sourceKind, sourceRef, fiscalYear })
      .where(eq(shareholderLoanEntries.id, id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `shareholder_loan_entries:${id}`,
      metadata: { type, amountCents, entryDate, fiscalYear },
    });
    revalidate();
    return { ok: "Entry saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteLoanEntry(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(eq(shareholderLoanEntries.id, id));
    if (!existing) return { error: "Entry not found." };
    if (await t4aSlipIssuedFor(existing.fiscalYear)) {
      return { error: `A T4A slip was issued for FY ${existing.fiscalYear}. Delete blocked.` };
    }

    // Cascade-delete: if this is a reclassification entry linked to a dividend
    // (created via the /shareholder-loan "Declare as dividend" flow), delete
    // the matching dividend atomically so the pair stays consistent.
    let linkedDividendId: string | null = null;
    if (
      existing.type === "reclassification" &&
      existing.sourceKind === "reclass_to_dividend" &&
      existing.sourceRef
    ) {
      const [dividend] = await db
        .select()
        .from(dividends)
        .where(eq(dividends.id, existing.sourceRef));
      if (dividend) {
        if (await t5SlipIssuedFor(dividend.fiscalYear)) {
          return {
            error: `A T5 slip was issued for FY ${dividend.fiscalYear}. Can't cascade-delete the linked dividend.`,
          };
        }
        linkedDividendId = dividend.id;
      }
    }

    if (linkedDividendId) {
      await db.batch([
        db.delete(shareholderLoanEntries).where(eq(shareholderLoanEntries.id, id)),
        db.delete(dividends).where(eq(dividends.id, linkedDividendId)),
        db.insert(auditLog).values([
          {
            actorEmail: email,
            action: "delete",
            target: `shareholder_loan_entries:${id}`,
            metadata: {
              type: existing.type,
              amountCents: existing.amountCents,
              entryDate: existing.entryDate,
              fiscalYear: existing.fiscalYear,
              cascadeDeletedDividendId: linkedDividendId,
            },
          },
          {
            actorEmail: email,
            action: "delete",
            target: `dividends:${linkedDividendId}`,
            metadata: { cascadedFromLoanEntryId: id },
          },
        ]),
      ]);
      revalidate();
      return { ok: "Entry and linked dividend deleted." };
    }

    await db.delete(shareholderLoanEntries).where(eq(shareholderLoanEntries.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `shareholder_loan_entries:${id}`,
      metadata: {
        type: existing.type,
        amountCents: existing.amountCents,
        entryDate: existing.entryDate,
        fiscalYear: existing.fiscalYear,
      },
    });
    revalidate();
    return { ok: "Entry deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

//  Prescribed rate admin
const rateSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date is required"),
    ratePercent: z.coerce.number().int().min(0).max(20, "Rate % out of range"),
    note: z.string().max(200).nullable(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "End date must be after start date", path: ["endDate"] });

export async function upsertPrescribedRate(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = rateSchema.safeParse({
      startDate: String(fd.get("startDate") ?? "").trim(),
      endDate: String(fd.get("endDate") ?? "").trim(),
      ratePercent: String(fd.get("ratePercent") ?? "").trim(),
      note: (String(fd.get("note") ?? "").trim()) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { startDate, endDate, ratePercent, note } = parsed.data;

    const [existing] = await db
      .select()
      .from(prescribedRatePeriods)
      .where(eq(prescribedRatePeriods.startDate, startDate));
    if (existing) {
      await db
        .update(prescribedRatePeriods)
        .set({ endDate, ratePercent, note })
        .where(eq(prescribedRatePeriods.id, existing.id));
    } else {
      await db.insert(prescribedRatePeriods).values({ startDate, endDate, ratePercent, note });
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `prescribed_rate_periods:${startDate}`,
      metadata: { startDate, endDate, ratePercent },
    });
    revalidate();
    return { ok: `Rate ${ratePercent}% saved for ${startDate} → ${endDate}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deletePrescribedRate(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db.delete(prescribedRatePeriods).where(eq(prescribedRatePeriods.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `prescribed_rate_periods:${id}`,
      metadata: {},
    });
    revalidate();
    return { ok: "Rate period deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

//  Reclassify draw as dividend (Phase 2D)
//  Atomic: inserts a dividend + a matching reclassification ledger entry in a
//  single transaction so the draw's outstanding principal goes to zero AND a
//  T5-eligible dividend row appears, in one click. If either insert fails,
//  nothing commits (neon-http transaction → single-request atomicity).
const reclassifySchema = z.object({
  declaredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Declared date is required"),
  eligible: z.boolean(),
  notes: z.string().max(2000).nullable(),
});

export async function reclassifyDrawAsDividend(
  drawId: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();

    const parsed = reclassifySchema.safeParse({
      declaredDate: String(fd.get("declaredDate") ?? "").trim(),
      eligible: fd.get("eligible") === "on",
      notes: (String(fd.get("notes") ?? "").trim()) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { declaredDate, eligible, notes } = parsed.data;

    // Load the draw + full ledger so we can recompute its FIFO-unpaid amount.
    const [draw] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(eq(shareholderLoanEntries.id, drawId));
    if (!draw) return { error: "Draw not found." };
    if (draw.type !== "draw") return { error: "Only draws can be reclassified as dividends." };

    const { fyeMonth, fyeDay } = await getFye();
    const [allEntries, rateRows] = await Promise.all([
      db
        .select()
        .from(shareholderLoanEntries)
        .orderBy(asc(shareholderLoanEntries.entryDate), asc(shareholderLoanEntries.createdAt)),
      db.select().from(prescribedRatePeriods).orderBy(asc(prescribedRatePeriods.startDate)),
    ]);
    const entries: LoanEntry[] = allEntries.map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      type: e.type,
      amountCents: e.amountCents,
      description: e.description,
    }));
    const rates: RatePeriod[] = rateRows.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      ratePercent: r.ratePercent,
    }));
    const timeline = computeLoanTimeline({
      entries,
      rates,
      fiscalYearEnd: { month: fyeMonth, day: fyeDay },
      today: new Date().toISOString().slice(0, 10),
    });
    const candidate = timeline.draws15_2Candidates.find((c) => c.drawId === drawId);
    if (!candidate) return { error: "Draw not found in ledger." };
    const amountCents = candidate.currentUnpaidCents;
    if (amountCents <= 0) {
      return { error: "This draw has already been fully settled — nothing to reclassify." };
    }

    const dividendFY = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    const entryFY = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    if (await t5SlipIssuedFor(dividendFY)) {
      return { error: `A T5 slip was issued for FY ${dividendFY}. Can't create a dividend in a closed year.` };
    }
    if (await t4aSlipIssuedFor(entryFY)) {
      return { error: `A T4A slip was issued for FY ${entryFY}. Can't add a loan-ledger entry in a closed year.` };
    }
    if (await t4aSlipIssuedFor(draw.fiscalYear)) {
      return { error: `A T4A slip was issued for the draw's FY ${draw.fiscalYear}. Reclassifying would rewrite closed-year history.` };
    }

    // Atomic write via db.batch() — the neon-http driver doesn't support
    // interactive transactions, but batch sends every statement in one
    // transactional HTTP request (all commit or all fail). We pre-generate
    // the dividend UUID server-side so the second insert can reference it
    // without needing a mid-batch RETURNING round-trip.
    const newDividendId = crypto.randomUUID();
    await db.batch([
      db.insert(dividends).values({
        id: newDividendId,
        declaredDate,
        paidDate: declaredDate, // declared + settled same day (draw already received)
        amountCents,
        eligible,
        fiscalYear: dividendFY,
        notes,
      }),
      db.insert(shareholderLoanEntries).values({
        entryDate: declaredDate,
        type: "reclassification",
        amountCents,
        description: `Reclassified ${formatCAD(amountCents)} draw from ${draw.entryDate} as dividend`,
        sourceKind: "reclass_to_dividend",
        sourceRef: newDividendId,
        fiscalYear: entryFY,
      }),
      db.insert(auditLog).values([
        {
          actorEmail: email,
          action: "create",
          target: `dividends:${newDividendId}`,
          metadata: {
            amountCents,
            eligible,
            fiscalYear: dividendFY,
            declaredDate,
            reclassifiedFromDrawId: drawId,
          },
        },
        {
          actorEmail: email,
          action: "create",
          target: `shareholder_loan_entries:reclass_for_draw_${drawId}`,
          metadata: {
            type: "reclassification",
            amountCents,
            entryDate: declaredDate,
            fiscalYear: entryFY,
            reclassDividendId: newDividendId,
          },
        },
      ]),
    ]);

    revalidate();
    return { ok: `Reclassified ${formatCAD(amountCents)} as a ${eligible ? "eligible" : "non-eligible"} dividend. Draw settled.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Reclassify failed" };
  }
}
