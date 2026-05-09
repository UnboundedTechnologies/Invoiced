"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { deadlines, settings, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { deriveAnnualDeadlines, type AnnualDeadline } from "@/lib/deadlines-derivation";
import { fiscalYearFor } from "@/lib/utils";

type ActionResult = { ok?: string; error?: string };

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

// ——————————————————————————————————————————————————————————————
// Sync annual deadlines — idempotent upsert for current + next FY
// ——————————————————————————————————————————————————————————————

export async function syncAnnualDeadlines(): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings missing." };

    const today = new Date().toISOString().slice(0, 10);
    const currentFY = fiscalYearFor(today, s.fiscalYearEndMonth, s.fiscalYearEndDay);
    // Derive for current + next two FYs so there's always something on the
    // calendar and you can plan ahead. Older FYs stay in the table if they
    // already exist (preserves history); we don't retroactively populate.
    const targetFYs = [currentFY, currentFY + 1, currentFY + 2];
    const derived: AnnualDeadline[] = targetFYs.flatMap((fy) =>
      deriveAnnualDeadlines({
        fyeMonth: s.fiscalYearEndMonth,
        fyeDay: s.fiscalYearEndDay,
        incorporationDate: s.incorporationDate,
        payrollActive: s.payrollAccountActive,
        payerRzActive: s.payerRzActive,
        fiscalYear: fy,
      }),
    );

    let created = 0;
    let updated = 0;
    for (const d of derived) {
      const [existing] = await db
        .select({ id: deadlines.id, dueDate: deadlines.dueDate, completed: deadlines.completed })
        .from(deadlines)
        .where(eq(deadlines.sourceKey, d.key))
        .limit(1);
      if (!existing) {
        await db.insert(deadlines).values({
          title: d.title,
          description: d.description,
          dueDate: d.dueDate,
          category: d.category,
          sourceKey: d.key,
        });
        created++;
      } else if (!existing.completed && existing.dueDate !== d.dueDate) {
        // Correct the due date if the underlying rule moved it (e.g., user
        // changed FYE). Never touch completed rows — those are historical.
        await db
          .update(deadlines)
          .set({ dueDate: d.dueDate, title: d.title, description: d.description })
          .where(eq(deadlines.id, existing.id));
        updated++;
      }
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: "deadlines:sync",
      metadata: { created, updated, targetFYs },
    });
    revalidate();
    return { ok: `Synced: ${created} created, ${updated} updated.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// Mark complete / incomplete
// ——————————————————————————————————————————————————————————————

const markCompleteSchema = z.object({
  id: z.string().uuid(),
  craConfirmationNumber: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.string().min(1).max(50).nullable(),
  ),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function markDeadlineComplete(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = markCompleteSchema.safeParse({
      id: fd.get("id"),
      craConfirmationNumber: fd.get("craConfirmationNumber"),
      filedAt: fd.get("filedAt"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, parsed.data.id));
    if (!row) return { error: "Deadline not found." };
    if (row.completed) return { error: "Already marked complete." };

    await db.batch([
      db
        .update(deadlines)
        .set({
          completed: true,
          completedAt: new Date(parsed.data.filedAt + "T12:00:00Z"),
          craConfirmationNumber: parsed.data.craConfirmationNumber,
        })
        .where(eq(deadlines.id, parsed.data.id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `deadlines:${parsed.data.id}:complete`,
        metadata: {
          title: row.title,
          category: row.category,
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: parsed.data.filedAt,
        },
      }),
    ]);
    revalidate();
    return { ok: "Marked complete." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function markDeadlineIncomplete(id: string): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, id));
    if (!row) return { error: "Deadline not found." };
    if (!row.completed) return { error: "Not marked complete." };

    await db.batch([
      db
        .update(deadlines)
        .set({ completed: false, completedAt: null, craConfirmationNumber: null })
        .where(eq(deadlines.id, id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `deadlines:${id}:reopen`,
        metadata: { title: row.title, category: row.category },
      }),
    ]);
    revalidate();
    return { ok: "Reopened." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// Manual entries (category 'other' by design — annual/recurring
// deadlines flow from settings via syncAnnualDeadlines)
// ——————————————————————————————————————————————————————————————

const manualSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(["other", "t2", "t4", "t5", "t1", "hst", "annual_return", "payroll"]),
});

export async function createManualDeadline(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = manualSchema.safeParse({
      title: fd.get("title"),
      description: (fd.get("description") as string) || null,
      dueDate: fd.get("dueDate"),
      category: fd.get("category"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    await db.batch([
      db.insert(deadlines).values({
        title: parsed.data.title,
        description: parsed.data.description,
        dueDate: parsed.data.dueDate,
        category: parsed.data.category,
        // sourceKey stays null → no upsert conflict with sync. User-entered.
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: "deadlines:manual",
        metadata: parsed.data as Record<string, unknown>,
      }),
    ]);
    revalidate();
    return { ok: "Deadline added." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function deleteDeadline(id: string): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, id));
    if (!row) return { error: "Deadline not found." };
    // Auto-generated deadlines (sourceKey set) shouldn't be deleted via this
    // path — they'll get re-created on next sync. Require manual entries only.
    if (row.sourceKey) {
      return {
        error:
          "This is an auto-generated deadline. Change the underlying setting (FYE, incorporation date, payroll status) to remove it, or mark it complete if done.",
      };
    }
    await db.batch([
      db.delete(deadlines).where(eq(deadlines.id, id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "delete",
        target: `deadlines:${id}`,
        metadata: { title: row.title, category: row.category },
      }),
    ]);
    revalidate();
    return { ok: "Deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

