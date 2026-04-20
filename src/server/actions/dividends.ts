"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { dividends, settings, slips, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor } from "@/lib/utils";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/dividends");
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

async function t5SlipIssuedFor(fiscalYear: number) {
  const [row] = await db
    .select({ id: slips.id })
    .from(slips)
    .where(and(eq(slips.type, "T5"), eq(slips.taxYear, fiscalYear)))
    .limit(1);
  return !!row;
}

const schema = z.object({
  amountDollars: z.coerce.number().positive("Amount must be greater than 0"),
  declaredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Declared date required"),
  paidDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .transform((v) => v || null)
    .nullable(),
  eligible: z.boolean(),
  notes: z.string().max(2000).nullable(),
});

function parseForm(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v ? String(v).trim() : "";
  };
  return schema.safeParse({
    amountDollars: get("amountDollars"),
    declaredDate: get("declaredDate"),
    paidDate: get("paidDate"),
    eligible: fd.get("eligible") === "on",
    notes: get("notes") || null,
  });
}

export async function createDividend(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = parseForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { amountDollars, declaredDate, paidDate, eligible, notes } = parsed.data;
    if (paidDate && paidDate < declaredDate) {
      return { error: "Paid date can't be before the declared date." };
    }
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    if (await t5SlipIssuedFor(fiscalYear)) {
      return { error: `A T5 slip was already issued for FY ${fiscalYear}. Declare in a later year.` };
    }

    const [created] = await db
      .insert(dividends)
      .values({ declaredDate, paidDate, amountCents, eligible, fiscalYear, notes })
      .returning({ id: dividends.id });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `dividends:${created!.id}`,
      metadata: { amountCents, eligible, fiscalYear, declaredDate, paidDate },
    });
    revalidate();
    return { ok: "Dividend declared." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function updateDividend(
  id: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };

    const parsed = parseForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { amountDollars, declaredDate, paidDate, eligible, notes } = parsed.data;
    if (paidDate && paidDate < declaredDate) {
      return { error: "Paid date can't be before the declared date." };
    }
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    if (await t5SlipIssuedFor(existing.fiscalYear)) {
      return { error: `A T5 slip was issued for FY ${existing.fiscalYear}. Edits are locked.` };
    }
    if (fiscalYear !== existing.fiscalYear && (await t5SlipIssuedFor(fiscalYear))) {
      return { error: `A T5 slip was issued for FY ${fiscalYear}. Can't move a dividend into a closed year.` };
    }

    await db
      .update(dividends)
      .set({ declaredDate, paidDate, amountCents, eligible, fiscalYear, notes })
      .where(eq(dividends.id, id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}`,
      metadata: { amountCents, eligible, fiscalYear, declaredDate, paidDate },
    });
    revalidate();
    return { ok: "Dividend saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteDividend(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (await t5SlipIssuedFor(existing.fiscalYear)) {
      return { error: `A T5 slip was issued for FY ${existing.fiscalYear}. Delete blocked.` };
    }
    await db.delete(dividends).where(eq(dividends.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `dividends:${id}`,
      metadata: {
        amountCents: existing.amountCents,
        eligible: existing.eligible,
        fiscalYear: existing.fiscalYear,
        declaredDate: existing.declaredDate,
      },
    });
    revalidate();
    return { ok: "Dividend deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function markDividendPaid(id: string, paidDate: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) return { error: "Invalid paid date." };
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (paidDate < existing.declaredDate) {
      return { error: "Paid date can't be before the declared date." };
    }
    await db.update(dividends).set({ paidDate }).where(eq(dividends.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}:markPaid`,
      metadata: { paidDate },
    });
    revalidate();
    return { ok: "Marked as paid." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function markDividendUnpaid(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db.update(dividends).set({ paidDate: null }).where(eq(dividends.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}:markUnpaid`,
      metadata: {},
    });
    revalidate();
    return { ok: "Marked as unpaid." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}
