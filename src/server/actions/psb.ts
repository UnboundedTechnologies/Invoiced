"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { psbChecklistItems, psbSnapshots, auditLog } from "@/lib/db/schema";
import { computePsbRisk } from "@/lib/psb";
import { auth } from "../../../auth";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/psb");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

async function snapshotToday(actorEmail: string, reason: string) {
  const items = await db.select().from(psbChecklistItems);
  const { score, risk, itemsDone, itemsTotal } = computePsbRisk(items);
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db
    .select({ id: psbSnapshots.id })
    .from(psbSnapshots)
    .where(eq(psbSnapshots.snapshotDate, today))
    .limit(1);
  if (existing[0]) {
    await db
      .update(psbSnapshots)
      .set({ score, risk, itemsDoneCount: itemsDone, itemsTotalCount: itemsTotal, notes: reason })
      .where(eq(psbSnapshots.id, existing[0].id));
  } else {
    await db.insert(psbSnapshots).values({
      snapshotDate: today,
      score,
      risk,
      itemsDoneCount: itemsDone,
      itemsTotalCount: itemsTotal,
      notes: reason,
    });
  }
  await db.insert(auditLog).values({
    actorEmail,
    action: "update",
    target: "psb:snapshot",
    metadata: { score, risk, itemsDone, itemsTotal, reason },
  });
}

// ─── Actions ───

const updateSchema = z.object({
  status: z.enum(["not_started", "in_progress", "done", "not_applicable"]),
  notes: z.string().max(2000).nullable(),
  evidenceDocumentId: z.string().uuid().nullable(),
});

export async function updateChecklistItem(
  id: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = updateSchema.safeParse({
      status: fd.get("status") ?? "not_started",
      notes: (fd.get("notes") as string) || null,
      evidenceDocumentId: (fd.get("evidenceDocumentId") as string) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    await db
      .update(psbChecklistItems)
      .set({
        status: parsed.data.status,
        notes: parsed.data.notes,
        evidenceDocumentId: parsed.data.evidenceDocumentId,
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(psbChecklistItems.id, id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `psb:item:${id}`,
      metadata: parsed.data,
    });

    await snapshotToday(email, `item:${id} → ${parsed.data.status}`);
    revalidate();
    return { ok: "Checklist updated." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function quickToggleItem(id: string, status: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const allowed = ["not_started", "in_progress", "done", "not_applicable"] as const;
    if (!allowed.includes(status as typeof allowed[number])) return { error: "Invalid status." };

    await db
      .update(psbChecklistItems)
      .set({ status, lastReviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(psbChecklistItems.id, id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `psb:item:${id}:quick`,
      metadata: { status },
    });

    await snapshotToday(email, `quick:${id} → ${status}`);
    revalidate();
    return { ok: "Updated." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function takePsbSnapshot(reason: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await snapshotToday(email, reason || "manual");
    revalidate();
    return { ok: "Snapshot saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Snapshot failed" };
  }
}
