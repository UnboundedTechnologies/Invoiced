"use server";

import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  shareholderLoanEntries,
  prescribedRatePeriods,
  settings,
  auditLog,
  dividends,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor, formatCAD } from "@/lib/utils";
import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "@/lib/shareholder-loan";
import { t2PeriodLockError } from "./t2";
import { t1PeriodLockError } from "./t1";
import { t4aSlipLockError, t5SlipLockError } from "./slips";
import { t1Returns } from "@/lib/db/schema";
import { gte, lte } from "drizzle-orm";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };

async function requireAuth() {
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

async function getFye() {
  const [s] = await db
    .select({ m: settings.fiscalYearEndMonth, d: settings.fiscalYearEndDay })
    .from(settings)
    .where(eq(settings.id, 1));
  return { fyeMonth: s?.m ?? 12, fyeDay: s?.d ?? 31 };
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
    const email = await requireAuth();
    const parsed = parseEntry(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { entryDate, type, amountDollars, description, sourceKind, sourceRef } = parsed.data;
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(entryDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    const t4aLock = await t4aSlipLockError(entryDate);
    if (t4aLock) return { error: t4aLock };
    const t2Lock = await t2PeriodLockError(entryDate);
    if (t2Lock) return { error: t2Lock };
    const t1Lock = await t1PeriodLockError(entryDate);
    if (t1Lock) return { error: t1Lock };

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
    const email = await requireAuth();
    const expectedVersion = parseExpectedVersion(fd);
    const [existing] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(eq(shareholderLoanEntries.id, id));
    if (!existing) return { error: "Entry not found." };
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      return { error: versionConflictError("loan entry", expectedVersion, existing.version) };
    }

    // Guard: linked reclassifications (created by the "Declare as dividend"
    // flow) must stay tied to their dividend — the amount, date, and type
    // are locked to the dividend's row to preserve the invariant. Delete
    // and recreate if you need to change it (the delete cascades cleanly).
    if (
      existing.type === "reclassification" &&
      existing.sourceKind === "reclass_to_dividend" &&
      existing.sourceRef
    ) {
      return {
        error: "This entry is linked to a dividend declared via the reclassify flow. To change it, delete the entry (which cascades and removes the matching dividend) and create new records — don't edit in place.",
      };
    }

    const parsed = parseEntry(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { entryDate, type, amountDollars, description, sourceKind, sourceRef } = parsed.data;
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(entryDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    const oldT4aLock = await t4aSlipLockError(existing.entryDate);
    if (oldT4aLock) return { error: oldT4aLock };
    if (entryDate !== existing.entryDate) {
      const newT4aLock = await t4aSlipLockError(entryDate);
      if (newT4aLock) return { error: newT4aLock };
    }
    const oldT2Lock = await t2PeriodLockError(existing.entryDate);
    if (oldT2Lock) return { error: oldT2Lock };
    if (entryDate !== existing.entryDate) {
      const newT2Lock = await t2PeriodLockError(entryDate);
      if (newT2Lock) return { error: newT2Lock };
    }
    const oldT1Lock = await t1PeriodLockError(existing.entryDate);
    if (oldT1Lock) return { error: oldT1Lock };
    if (entryDate !== existing.entryDate) {
      const newT1Lock = await t1PeriodLockError(entryDate);
      if (newT1Lock) return { error: newT1Lock };
    }

    const whereClause = expectedVersion !== null
      ? and(eq(shareholderLoanEntries.id, id), eq(shareholderLoanEntries.version, expectedVersion))
      : eq(shareholderLoanEntries.id, id);
    const [updated] = await db
      .update(shareholderLoanEntries)
      .set({ entryDate, type, amountCents, description, sourceKind, sourceRef, fiscalYear, version: bumpVersion() })
      .where(whereClause)
      .returning({ version: shareholderLoanEntries.version });
    if (!updated) {
      const [current] = await db
        .select({ version: shareholderLoanEntries.version })
        .from(shareholderLoanEntries)
        .where(eq(shareholderLoanEntries.id, id));
      if (!current) return { error: "Entry was deleted in another tab." };
      return { error: versionConflictError("loan entry", expectedVersion ?? existing.version, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `shareholder_loan_entries:${id}`,
      metadata: { type, amountCents, entryDate, fiscalYear, fromVersion: existing.version, toVersion: updated.version },
    });
    revalidate();
    return { ok: "Entry saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteLoanEntry(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(eq(shareholderLoanEntries.id, id));
    if (!existing) return { error: "Entry not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("loan entry", expectedVersion, existing.version) };
    }
    const t4aLock = await t4aSlipLockError(existing.entryDate);
    if (t4aLock) return { error: t4aLock };
    const t2Lock = await t2PeriodLockError(existing.entryDate);
    if (t2Lock) return { error: t2Lock };
    const t1Lock = await t1PeriodLockError(existing.entryDate);
    if (t1Lock) return { error: t1Lock };

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
        // T5 lock on the linked dividend's paidDate (if set). Unpaid dividends
        // aren't on any T5 so they cascade-delete freely.
        if (dividend.paidDate) {
          const t5Lock = await t5SlipLockError(dividend.paidDate);
          if (t5Lock) {
            return { error: `${t5Lock} Cascade-delete of the linked dividend blocked.` };
          }
        }
        linkedDividendId = dividend.id;
      }
    }

    const deleted = await db
      .delete(shareholderLoanEntries)
      .where(and(eq(shareholderLoanEntries.id, id), eq(shareholderLoanEntries.version, expectedVersion)))
      .returning({ id: shareholderLoanEntries.id });
    if (!deleted.length) {
      const [current] = await db
        .select({ version: shareholderLoanEntries.version })
        .from(shareholderLoanEntries)
        .where(eq(shareholderLoanEntries.id, id));
      if (!current) return { error: "Entry was already deleted." };
      return { error: versionConflictError("loan entry", expectedVersion, current.version) };
    }

    if (linkedDividendId) {
      await db.batch([
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
              version: existing.version,
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

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `shareholder_loan_entries:${id}`,
      metadata: {
        type: existing.type,
        amountCents: existing.amountCents,
        entryDate: existing.entryDate,
        fiscalYear: existing.fiscalYear,
        version: existing.version,
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
    const email = await requireAuth();
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

    // Overlap guard: reject if any OTHER row's date range intersects the new
    // one. The unique index on startDate only catches exact start collisions,
    // not partial overlaps that would silently skew 80.4 benefit math.
    const allPeriods = await db.select().from(prescribedRatePeriods);
    const overlap = allPeriods.find(
      (p) =>
        p.startDate !== startDate &&
        p.startDate <= endDate &&
        p.endDate >= startDate,
    );
    if (overlap) {
      return {
        error: `Overlaps existing ${overlap.ratePercent}% period ${overlap.startDate} → ${overlap.endDate}. Fix or delete that period first.`,
      };
    }

    // T1 filing-lock: a rate change retroactively rewrites 80.4 benefit math
    // for every CY whose entries fall in the rate's effective window. Block
    // the change if any of those CYs has a filed T1 — history is frozen.
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const [filedInWindow] = await db
      .select({ taxYear: t1Returns.taxYear })
      .from(t1Returns)
      .where(
        and(
          eq(t1Returns.status, "filed"),
          gte(t1Returns.taxYear, startYear),
          lte(t1Returns.taxYear, endYear),
        ),
      )
      .limit(1);
    if (filedInWindow) {
      return {
        error: `T1 return for CY ${filedInWindow.taxYear} is filed; rate changes inside that window would silently rewrite the T4A box 117 on that return. File a T1-ADJ if the rate was genuinely wrong.`,
      };
    }

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
    const email = await requireAuth();
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
    const email = await requireAuth();

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
    // s.80.4(3)(b) + s.15(2) double-tax guard: once a draw has crossed its
    // s.15(2.6) one-year deadline still unpaid, the principal is already
    // deemed income in the draw's year T1. Declaring a T5 dividend on top
    // would tax the same dollars twice.
    if (candidate.status === "past_deadline") {
      return {
        error: `This draw already triggered s.15(2) inclusion in FY ${candidate.drawFiscalYear} (deadline ${candidate.triggerDate}). Reclassifying now would double-count the principal as income. If that inclusion was entered in error, delete the draw first so the ledger no longer shows it as unpaid-past-deadline.`,
      };
    }

    const dividendFY = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    const entryFY = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    // Slip locks — reclassify creates a paid dividend dated `declaredDate`
    // AND a T4A-relevant ledger entry on the same date AND rewrites the
    // original draw's CY history.
    const declaredT5Lock = await t5SlipLockError(declaredDate);
    if (declaredT5Lock) return { error: declaredT5Lock };
    const declaredT4aLock = await t4aSlipLockError(declaredDate);
    if (declaredT4aLock) return { error: declaredT4aLock };
    if (draw.entryDate !== declaredDate) {
      const drawT4aLock = await t4aSlipLockError(draw.entryDate);
      if (drawT4aLock) {
        return { error: `${drawT4aLock} Reclassifying would rewrite the draw's CY history.` };
      }
    }
    // T2 filing-lock: both the declared-date FY (where the dividend lands)
    // and the draw's original FY (where history is being rewritten) must
    // still be open.
    const declaredT2Lock = await t2PeriodLockError(declaredDate);
    if (declaredT2Lock) return { error: declaredT2Lock };
    if (draw.entryDate !== declaredDate) {
      const drawT2Lock = await t2PeriodLockError(draw.entryDate);
      if (drawT2Lock) return { error: drawT2Lock };
    }
    // T1 lock: reclassify also rewrites T1 in both CYs (the paid dividend
    // lands in the declared-date CY, while removing the draw from unpaid
    // principal can shift the 80.4 benefit reported on the draw's CY).
    const declaredT1Lock = await t1PeriodLockError(declaredDate);
    if (declaredT1Lock) return { error: declaredT1Lock };
    if (draw.entryDate !== declaredDate) {
      const drawT1Lock = await t1PeriodLockError(draw.entryDate);
      if (drawT1Lock) return { error: drawT1Lock };
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
