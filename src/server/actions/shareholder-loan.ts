"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  shareholderLoanEntries,
  prescribedRatePeriods,
  settings,
  slips,
  auditLog,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor } from "@/lib/utils";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/shareholder-loan");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
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
