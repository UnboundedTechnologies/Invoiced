"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { dividends, settings, auditLog, shareholderLoanEntries } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor } from "@/lib/utils";
import { t2PeriodLockError } from "./t2";
import { t1PeriodLockError } from "./t1";
import { t4aSlipLockError, t5SlipLockError } from "./slips";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/dividends");
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

    // T5 lock on paid date — T5 reports by CY of payment. Unpaid dividends
    // don't hit any T5 yet, so they bypass the lock.
    if (paidDate) {
      const t5Lock = await t5SlipLockError(paidDate);
      if (t5Lock) return { error: t5Lock };
    }
    const t2Lock = await t2PeriodLockError(declaredDate);
    if (t2Lock) return { error: t2Lock };
    if (paidDate) {
      const t1Lock = await t1PeriodLockError(paidDate);
      if (t1Lock) return { error: t1Lock };
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
    const expectedVersion = parseExpectedVersion(fd);
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      return { error: versionConflictError("dividend", expectedVersion, existing.version) };
    }

    const parsed = parseForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { amountDollars, declaredDate, paidDate, eligible, notes } = parsed.data;
    if (paidDate && paidDate < declaredDate) {
      return { error: "Paid date can't be before the declared date." };
    }
    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(declaredDate, fyeMonth, fyeDay);
    const amountCents = Math.round(amountDollars * 100);

    // T5 locks on the paid-date CY. Check BOTH the old paidDate (if set —
    // editing could remove this dividend from a filed CY's slip) and the
    // new paidDate (if set — editing could add it to a filed CY's slip).
    if (existing.paidDate) {
      const oldT5Lock = await t5SlipLockError(existing.paidDate);
      if (oldT5Lock) return { error: oldT5Lock };
    }
    if (paidDate && paidDate !== existing.paidDate) {
      const newT5Lock = await t5SlipLockError(paidDate);
      if (newT5Lock) return { error: newT5Lock };
    }
    const oldT2Lock = await t2PeriodLockError(existing.declaredDate);
    if (oldT2Lock) return { error: oldT2Lock };
    if (declaredDate !== existing.declaredDate) {
      const newT2Lock = await t2PeriodLockError(declaredDate);
      if (newT2Lock) return { error: newT2Lock };
    }
    // T1 locks on paidDate — both old (if set) and new (if set and changed).
    if (existing.paidDate) {
      const oldT1Lock = await t1PeriodLockError(existing.paidDate);
      if (oldT1Lock) return { error: oldT1Lock };
    }
    if (paidDate && paidDate !== existing.paidDate) {
      const newT1Lock = await t1PeriodLockError(paidDate);
      if (newT1Lock) return { error: newT1Lock };
    }

    const whereClause = expectedVersion !== null
      ? and(eq(dividends.id, id), eq(dividends.version, expectedVersion))
      : eq(dividends.id, id);
    const [updated] = await db
      .update(dividends)
      .set({ declaredDate, paidDate, amountCents, eligible, fiscalYear, notes, version: bumpVersion() })
      .where(whereClause)
      .returning({ id: dividends.id, version: dividends.version });

    if (!updated) {
      const [current] = await db
        .select({ version: dividends.version })
        .from(dividends)
        .where(eq(dividends.id, id));
      if (!current) return { error: "Dividend was deleted in another tab." };
      return { error: versionConflictError("dividend", expectedVersion ?? existing.version, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}`,
      metadata: { amountCents, eligible, fiscalYear, declaredDate, paidDate, fromVersion: existing.version, toVersion: updated.version },
    });
    revalidate();
    return { ok: "Dividend saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteDividend(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("dividend", expectedVersion, existing.version) };
    }
    // T5 lock: only paid dividends are on any T5. Unpaid ones can be deleted
    // freely.
    if (existing.paidDate) {
      const t5Lock = await t5SlipLockError(existing.paidDate);
      if (t5Lock) return { error: t5Lock };
    }
    const t2Lock = await t2PeriodLockError(existing.declaredDate);
    if (t2Lock) return { error: t2Lock };
    // T1 lock on paidDate — deleting a paid dividend removes it from the T1
    // of its payment CY, which is history rewriting if that T1 is filed.
    if (existing.paidDate) {
      const t1Lock = await t1PeriodLockError(existing.paidDate);
      if (t1Lock) return { error: t1Lock };
    }

    // Cascade-delete: if this dividend was created via the "Declare as
    // dividend" reclassify flow, a shareholder_loan_entries row of type
    // `reclassification` points back to it via sourceRef. Delete both
    // atomically so the ledger and the dividend list stay in sync.
    const [linkedEntry] = await db
      .select()
      .from(shareholderLoanEntries)
      .where(
        and(
          eq(shareholderLoanEntries.sourceKind, "reclass_to_dividend"),
          eq(shareholderLoanEntries.sourceRef, id),
        ),
      )
      .limit(1);

    if (linkedEntry) {
      const t4aLock = await t4aSlipLockError(linkedEntry.entryDate);
      if (t4aLock) {
        return { error: `${t4aLock} Cascade-delete of the linked loan-ledger entry blocked.` };
      }
    }

    const deleted = await db
      .delete(dividends)
      .where(and(eq(dividends.id, id), eq(dividends.version, expectedVersion)))
      .returning({ id: dividends.id });
    if (!deleted.length) {
      const [current] = await db
        .select({ version: dividends.version })
        .from(dividends)
        .where(eq(dividends.id, id));
      if (!current) return { error: "Dividend was already deleted." };
      return { error: versionConflictError("dividend", expectedVersion, current.version) };
    }

    if (linkedEntry) {
      await db.batch([
        db.delete(shareholderLoanEntries).where(eq(shareholderLoanEntries.id, linkedEntry.id)),
        db.insert(auditLog).values([
          {
            actorEmail: email,
            action: "delete",
            target: `dividends:${id}`,
            metadata: {
              amountCents: existing.amountCents,
              eligible: existing.eligible,
              fiscalYear: existing.fiscalYear,
              declaredDate: existing.declaredDate,
              cascadeDeletedLoanEntryId: linkedEntry.id,
              version: existing.version,
            },
          },
          {
            actorEmail: email,
            action: "delete",
            target: `shareholder_loan_entries:${linkedEntry.id}`,
            metadata: { cascadedFromDividendId: id },
          },
        ]),
      ]);
      revalidate();
      return { ok: "Dividend and linked loan-ledger entry deleted." };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `dividends:${id}`,
      metadata: {
        amountCents: existing.amountCents,
        eligible: existing.eligible,
        fiscalYear: existing.fiscalYear,
        declaredDate: existing.declaredDate,
        version: existing.version,
      },
    });
    revalidate();
    return { ok: "Dividend deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function markDividendPaid(
  id: string,
  paidDate: string,
  expectedVersion: number,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) return { error: "Invalid paid date." };
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("dividend", expectedVersion, existing.version) };
    }
    if (paidDate < existing.declaredDate) {
      return { error: "Paid date can't be before the declared date." };
    }
    // T5 lock on the new paid date — marking paid adds to that CY's T5.
    const t5Lock = await t5SlipLockError(paidDate);
    if (t5Lock) return { error: t5Lock };
    const t2Lock = await t2PeriodLockError(existing.declaredDate);
    if (t2Lock) return { error: t2Lock };
    // T1 lock on the new paid date — it puts a dividend into that CY's T1.
    const t1Lock = await t1PeriodLockError(paidDate);
    if (t1Lock) return { error: t1Lock };

    const [updated] = await db
      .update(dividends)
      .set({ paidDate, version: bumpVersion() })
      .where(and(eq(dividends.id, id), eq(dividends.version, expectedVersion)))
      .returning({ version: dividends.version });
    if (!updated) {
      const [current] = await db
        .select({ version: dividends.version })
        .from(dividends)
        .where(eq(dividends.id, id));
      if (!current) return { error: "Dividend was deleted in another tab." };
      return { error: versionConflictError("dividend", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}:markPaid`,
      metadata: { paidDate, fromVersion: existing.version, toVersion: updated.version },
    });
    revalidate();
    return { ok: "Marked as paid." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function markDividendUnpaid(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(dividends).where(eq(dividends.id, id));
    if (!existing) return { error: "Dividend not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("dividend", expectedVersion, existing.version) };
    }
    // T5 lock on the existing paid date — unpaying it removes the dividend
    // from that CY's T5 (history rewrite if the T5 is filed).
    if (existing.paidDate) {
      const t5Lock = await t5SlipLockError(existing.paidDate);
      if (t5Lock) return { error: t5Lock };
    }
    const t2Lock = await t2PeriodLockError(existing.declaredDate);
    if (t2Lock) return { error: t2Lock };
    // T1 lock on the existing paid date — unpaying it removes a dividend
    // from that CY's T1 (history rewrite if the T1 is filed).
    if (existing.paidDate) {
      const t1Lock = await t1PeriodLockError(existing.paidDate);
      if (t1Lock) return { error: t1Lock };
    }

    const [updated] = await db
      .update(dividends)
      .set({ paidDate: null, version: bumpVersion() })
      .where(and(eq(dividends.id, id), eq(dividends.version, expectedVersion)))
      .returning({ version: dividends.version });
    if (!updated) {
      const [current] = await db
        .select({ version: dividends.version })
        .from(dividends)
        .where(eq(dividends.id, id));
      if (!current) return { error: "Dividend was deleted in another tab." };
      return { error: versionConflictError("dividend", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `dividends:${id}:markUnpaid`,
      metadata: { fromVersion: existing.version, toVersion: updated.version },
    });
    revalidate();
    return { ok: "Marked as unpaid." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}
