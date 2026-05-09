"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLog, capitalTransactions } from "@/lib/db/schema";
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

const txSchema = z.object({
  kind: z.enum(["public_security", "mutual_fund", "real_estate", "crypto", "other"]),
  description: z.string().trim().min(1, "Description is required").max(200),
  t5008Source: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  dispositionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Disposition date required (YYYY-MM-DD)"),
  proceedsCents: z.coerce.number().int().nonnegative("Proceeds must be ≥ 0"),
  acbCents: z.coerce.number().int().nonnegative("ACB must be ≥ 0"),
  outlaysCents: z.coerce.number().int().nonnegative("Outlays must be ≥ 0"),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

function parseAmountToCents(raw: FormDataEntryValue | null): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  if (s.includes(".") || s.includes(",")) {
    const dollars = Number(s.replace(",", "."));
    if (!Number.isFinite(dollars)) return NaN;
    return Math.round(dollars * 100);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export async function createCapitalTransaction(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = txSchema.safeParse({
      kind: fd.get("kind"),
      description: fd.get("description"),
      t5008Source: fd.get("t5008Source"),
      dispositionDate: fd.get("dispositionDate"),
      proceedsCents: parseAmountToCents(fd.get("proceedsCents")),
      acbCents: parseAmountToCents(fd.get("acbCents")),
      outlaysCents: parseAmountToCents(fd.get("outlaysCents")),
      notes: fd.get("notes"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const lockErr = await t1PeriodLockError(parsed.data.dispositionDate);
    if (lockErr) return { error: lockErr };

    const taxYear = taxYearFor(parsed.data.dispositionDate);

    await db.batch([
      db.insert(capitalTransactions).values({
        taxYear,
        kind: parsed.data.kind,
        description: parsed.data.description,
        t5008Source: parsed.data.t5008Source,
        dispositionDate: parsed.data.dispositionDate,
        proceedsCents: parsed.data.proceedsCents,
        acbCents: parsed.data.acbCents,
        outlaysCents: parsed.data.outlaysCents,
        notes: parsed.data.notes,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `capital_transactions:${taxYear}`,
        metadata: {
          taxYear,
          kind: parsed.data.kind,
          description: parsed.data.description,
          dispositionDate: parsed.data.dispositionDate,
          proceedsCents: parsed.data.proceedsCents,
          acbCents: parsed.data.acbCents,
          outlaysCents: parsed.data.outlaysCents,
        },
      }),
    ]);

    revalidate(taxYear);
    return { ok: "Capital transaction added." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function deleteCapitalTransaction(
  id: string,
  expectedVersion: number,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db
      .select()
      .from(capitalTransactions)
      .where(eq(capitalTransactions.id, id));
    if (!existing) return { error: "Capital transaction not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("capital transaction", expectedVersion, existing.version) };
    }

    const lockErr = await t1PeriodLockError(existing.dispositionDate);
    if (lockErr) return { error: lockErr };

    const deleted = await db
      .delete(capitalTransactions)
      .where(and(eq(capitalTransactions.id, id), eq(capitalTransactions.version, expectedVersion)))
      .returning({ id: capitalTransactions.id });
    if (!deleted.length) {
      const [current] = await db
        .select({ version: capitalTransactions.version })
        .from(capitalTransactions)
        .where(eq(capitalTransactions.id, id));
      if (!current) return { error: "Capital transaction was already deleted." };
      return { error: versionConflictError("capital transaction", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `capital_transactions:${existing.taxYear}`,
      metadata: {
        taxYear: existing.taxYear,
        kind: existing.kind,
        description: existing.description,
        dispositionDate: existing.dispositionDate,
        proceedsCents: existing.proceedsCents,
        acbCents: existing.acbCents,
        outlaysCents: existing.outlaysCents,
        version: existing.version,
      },
    });

    revalidate(existing.taxYear);
    return { ok: "Capital transaction removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
