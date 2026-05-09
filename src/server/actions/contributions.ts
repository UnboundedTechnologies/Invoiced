"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLog, rrspContributions } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
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

const contributionSchema = z.object({
  appliedToTaxYear: z.coerce.number().int().min(2000).max(2100),
  kind: z.enum(["rrsp", "fhsa"]),
  amountCents: z.coerce.number().int().positive("Amount must be positive"),
  dateContributed: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date contributed required (YYYY-MM-DD)"),
  institutionName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  receiptNumber: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

function parseAmountToCents(raw: FormDataEntryValue | null): number {
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

export async function createContribution(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = contributionSchema.safeParse({
      appliedToTaxYear: fd.get("appliedToTaxYear"),
      kind: fd.get("kind"),
      amountCents: parseAmountToCents(fd.get("amountCents")),
      dateContributed: fd.get("dateContributed"),
      institutionName: fd.get("institutionName"),
      receiptNumber: fd.get("receiptNumber"),
      notes: fd.get("notes"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    // Lock the *applied* tax year — that's the T1 the contribution flows into.
    // Use Jan 1 of appliedToTaxYear as a proxy ISO; lock check needs only year.
    const lockErr = await t1PeriodLockError(`${parsed.data.appliedToTaxYear}-01-01`);
    if (lockErr) return { error: lockErr };

    await db.batch([
      db.insert(rrspContributions).values({
        appliedToTaxYear: parsed.data.appliedToTaxYear,
        kind: parsed.data.kind,
        amountCents: parsed.data.amountCents,
        dateContributed: parsed.data.dateContributed,
        institutionName: parsed.data.institutionName,
        receiptNumber: parsed.data.receiptNumber,
        notes: parsed.data.notes,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `rrsp_contributions:${parsed.data.appliedToTaxYear}`,
        metadata: {
          appliedToTaxYear: parsed.data.appliedToTaxYear,
          kind: parsed.data.kind,
          amountCents: parsed.data.amountCents,
          dateContributed: parsed.data.dateContributed,
        },
      }),
    ]);

    revalidate(parsed.data.appliedToTaxYear);
    return { ok: "Contribution added." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function deleteContribution(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db
      .select()
      .from(rrspContributions)
      .where(eq(rrspContributions.id, id));
    if (!existing) return { error: "Contribution not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("contribution", expectedVersion, existing.version) };
    }

    const lockErr = await t1PeriodLockError(`${existing.appliedToTaxYear}-01-01`);
    if (lockErr) return { error: lockErr };

    const deleted = await db
      .delete(rrspContributions)
      .where(and(eq(rrspContributions.id, id), eq(rrspContributions.version, expectedVersion)))
      .returning({ id: rrspContributions.id });
    if (!deleted.length) {
      const [current] = await db
        .select({ version: rrspContributions.version })
        .from(rrspContributions)
        .where(eq(rrspContributions.id, id));
      if (!current) return { error: "Contribution was already deleted." };
      return { error: versionConflictError("contribution", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `rrsp_contributions:${existing.appliedToTaxYear}`,
      metadata: {
        appliedToTaxYear: existing.appliedToTaxYear,
        kind: existing.kind,
        amountCents: existing.amountCents,
        dateContributed: existing.dateContributed,
        version: existing.version,
      },
    });

    revalidate(existing.appliedToTaxYear);
    return { ok: "Contribution removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
