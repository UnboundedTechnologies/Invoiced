"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLog, donations } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
import { taxYearFor } from "@/lib/t1";
import { t1PeriodLockError } from "./t1";
import { versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate(taxYear: number) {
  revalidatePath("/personal-tax");
  revalidatePath(`/personal-tax/${taxYear}`);
  revalidatePath("/dashboard");
}

const donationSchema = z.object({
  charityName: z.string().trim().min(1, "Charity name is required").max(200),
  registeredCharityNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  receiptNumber: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  amountCents: z.coerce.number().int().positive("Amount must be positive"),
  dateReceived: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date received required (YYYY-MM-DD)"),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

function parseAmountToCents(raw: FormDataEntryValue | null): number {
  // Form may send dollars-with-decimals (e.g. "150.00") or raw cents.
  // Accept both forms; treat anything containing a decimal point as dollars.
  const s = String(raw ?? "").trim();
  if (!s) return NaN;
  if (s.includes(".") || s.includes(",")) {
    const dollars = Number(s.replace(",", "."));
    if (!Number.isFinite(dollars)) return NaN;
    return Math.round(dollars * 100);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export async function createDonation(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = donationSchema.safeParse({
      charityName: fd.get("charityName"),
      registeredCharityNumber: fd.get("registeredCharityNumber"),
      receiptNumber: fd.get("receiptNumber"),
      amountCents: parseAmountToCents(fd.get("amountCents")),
      dateReceived: fd.get("dateReceived"),
      notes: fd.get("notes"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const lockErr = await t1PeriodLockError(parsed.data.dateReceived);
    if (lockErr) return { error: lockErr };

    const taxYear = taxYearFor(parsed.data.dateReceived);

    await db.batch([
      db.insert(donations).values({
        taxYear,
        charityName: parsed.data.charityName,
        registeredCharityNumber: parsed.data.registeredCharityNumber,
        receiptNumber: parsed.data.receiptNumber,
        amountCents: parsed.data.amountCents,
        dateReceived: parsed.data.dateReceived,
        notes: parsed.data.notes,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `donations:${taxYear}`,
        metadata: {
          taxYear,
          charityName: parsed.data.charityName,
          amountCents: parsed.data.amountCents,
          dateReceived: parsed.data.dateReceived,
        },
      }),
    ]);

    revalidate(taxYear);
    return { ok: "Donation added." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function deleteDonation(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db.select().from(donations).where(eq(donations.id, id));
    if (!existing) return { error: "Donation not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("donation", expectedVersion, existing.version) };
    }

    const lockErr = await t1PeriodLockError(existing.dateReceived);
    if (lockErr) return { error: lockErr };

    const deleted = await db
      .delete(donations)
      .where(and(eq(donations.id, id), eq(donations.version, expectedVersion)))
      .returning({ id: donations.id });
    if (!deleted.length) {
      const [current] = await db
        .select({ version: donations.version })
        .from(donations)
        .where(eq(donations.id, id));
      if (!current) return { error: "Donation was already deleted." };
      return { error: versionConflictError("donation", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `donations:${existing.taxYear}`,
      metadata: {
        taxYear: existing.taxYear,
        charityName: existing.charityName,
        amountCents: existing.amountCents,
        dateReceived: existing.dateReceived,
        version: existing.version,
      },
    });

    revalidate(existing.taxYear);
    return { ok: "Donation removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
