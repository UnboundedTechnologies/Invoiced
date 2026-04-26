"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { pushSubscriptions, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email.toLowerCase();
}

// Server actions invoked with structured payloads (not FormData) bypass
// Next's automatic FormData parsing — we still want runtime input checks
// since the TS types are erased at the RPC boundary. Lengths sized to
// realistic Web Push payloads from W3C Push API (no spec maximum, but
// 1 KiB endpoint + 88-char p256dh + 24-char auth covers every browser).
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
  userAgent: z.string().max(1024).optional(),
});

const endpointSchema = z.string().url().max(2048);
const idSchema = z.string().uuid();

/** Endpoints from the same browser+device are stable; on conflict we just
 * touch lastSeenAt so a re-subscribe (after the SW updates, after a clear-
 * site-data, etc.) doesn't create a duplicate row. */
export async function subscribePush(payload: unknown): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = subscribeSchema.safeParse(payload);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid subscription payload." };
    }
    const { endpoint, p256dh, auth, userAgent } = parsed.data;
    await db
      .insert(pushSubscriptions)
      .values({
        endpoint,
        p256dh,
        auth,
        userEmail: email,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          lastSeenAt: new Date(),
          userEmail: email,
          userAgent: userAgent ?? null,
        },
      });
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: "push_subscriptions:subscribe",
      metadata: {
        endpointPrefix: endpoint.slice(0, 64),
        userAgent: userAgent ?? null,
      },
    });
    return { ok: "Notifications enabled on this device." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Subscribe failed" };
  }
}

export async function unsubscribePush(endpoint: unknown): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = endpointSchema.safeParse(endpoint);
    if (!parsed.success) return { error: "Invalid endpoint." };
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: "push_subscriptions:unsubscribe",
      metadata: { endpointPrefix: parsed.data.slice(0, 64) },
    });
    return { ok: "Notifications disabled." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unsubscribe failed" };
  }
}

export type PushSubRow = {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
};

export async function listMyPushSubscriptions(): Promise<PushSubRow[]> {
  const email = await requireSession();
  return db
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
      lastSeenAt: pushSubscriptions.lastSeenAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userEmail, email))
    .orderBy(desc(pushSubscriptions.lastSeenAt));
}

/** Revoke a registration by id (e.g. an old browser the user no longer uses). */
export async function deletePushSubscription(id: unknown): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { error: "Invalid id." };
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, parsed.data), eq(pushSubscriptions.userEmail, email)));
    return { ok: "Device removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Remove failed" };
  }
}
