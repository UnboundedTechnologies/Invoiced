import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db/client";
import { deadlines, pushSubscriptions } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Constant-time string compare for the cron Bearer token. Plain === leaks
 * per-byte timing (microseconds) which is below network-jitter floor in
 * practice — we use timingSafeEqual anyway to avoid leaving a defensive
 * gap that a future runtime change could expose. */
function bearerEquals(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Daily Vercel Cron — sends one push notification per subscription
 * summarising deadlines due in the next 7 days. Schedule lives in
 * `vercel.json` (default: 12:00 UTC = ~8am ET).
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` header. Vercel
 * Cron sends this automatically when CRON_SECRET is set as a project env;
 * for local testing curl with the matching token.
 *
 * Failure modes:
 *   - 410 Gone / 404 from the push service → subscription expired, deleted.
 *   - Other errors → logged, counted, doesn't abort the loop.
 */
function configureWebPush(): { ok: true } | { ok: false; reason: string } {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@unboundedtechnologies.com";
  if (!pub || !priv) return { ok: false, reason: "VAPID keys not configured" };
  webpush.setVapidDetails(subject, pub, priv);
  return { ok: true };
}

function daysBetween(today: Date, due: string): number {
  const d = new Date(`${due}T00:00:00Z`);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function pluralDays(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

export async function GET(req: Request) {
  // Vercel auto-injects CRON_SECRET as a project env when crons are
  // configured. The Vercel Cron runner hits this endpoint with a matching
  // Authorization header. Hard-fail if either side is missing so the
  // endpoint can't be public-triggered.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new NextResponse("CRON_SECRET not configured", { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!bearerEquals(auth, `Bearer ${cronSecret}`)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cfg = configureWebPush();
  if (!cfg.ok) {
    return NextResponse.json({ ok: false, reason: cfg.reason }, { status: 500 });
  }

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekIso = weekFromNow.toISOString().slice(0, 10);

  const upcoming = await db
    .select({
      id: deadlines.id,
      title: deadlines.title,
      dueDate: deadlines.dueDate,
    })
    .from(deadlines)
    .where(
      and(
        gte(deadlines.dueDate, todayIso),
        lte(deadlines.dueDate, weekIso),
        eq(deadlines.completed, false),
      ),
    );

  if (upcoming.length === 0) {
    return NextResponse.json({ sent: 0, deleted: 0, reason: "no upcoming deadlines" });
  }

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) {
    return NextResponse.json({ sent: 0, deleted: 0, reason: "no subscribers" });
  }

  // Build a single summary body for all upcoming deadlines so each device
  // gets one push per day, not N (would feel spammy).
  const sorted = upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const lead = sorted[0]!;
  const leadDays = daysBetween(now, lead.dueDate);
  const body =
    sorted.length === 1
      ? `${lead.title} — due ${pluralDays(leadDays)}`
      : `${lead.title} (${pluralDays(leadDays)}) + ${sorted.length - 1} more this week`;

  let sent = 0;
  let deleted = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: "Invoiced — Deadlines",
          body,
          url: "/calendar",
        }),
      );
      sent++;
    } catch (e: unknown) {
      const status =
        typeof e === "object" && e !== null && "statusCode" in e
          ? (e as { statusCode?: number }).statusCode
          : undefined;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        deleted++;
      }
    }
  }

  return NextResponse.json({ sent, deleted, deadlines: upcoming.length });
}
