"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pushSubscriptions, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email.toLowerCase();
}

/** Endpoints from the same browser+device are stable; on conflict we just
 * touch lastSeenAt so a re-subscribe (after the SW updates, after a clear-
 * site-data, etc.) doesn't create a duplicate row. */
export async function subscribePush(payload: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<ActionResult> {
  try {
    const email = await requireSession();
    if (!payload.endpoint || !payload.p256dh || !payload.auth) {
      return { error: "Incomplete subscription payload." };
    }
    await db
      .insert(pushSubscriptions)
      .values({
        endpoint: payload.endpoint,
        p256dh: payload.p256dh,
        auth: payload.auth,
        userEmail: email,
        userAgent: payload.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          lastSeenAt: new Date(),
          userEmail: email,
          userAgent: payload.userAgent ?? null,
        },
      });
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: "push_subscriptions:subscribe",
      metadata: {
        endpointPrefix: payload.endpoint.slice(0, 64),
        userAgent: payload.userAgent ?? null,
      },
    });
    return { ok: "Notifications enabled on this device." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Subscribe failed" };
  }
}

export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: "push_subscriptions:unsubscribe",
      metadata: { endpointPrefix: endpoint.slice(0, 64) },
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
export async function deletePushSubscription(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userEmail, email)));
    return { ok: "Device removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Remove failed" };
  }
}
