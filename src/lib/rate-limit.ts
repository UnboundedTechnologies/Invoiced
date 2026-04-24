/**
 * IP-level rate limiting via Upstash (Redis-protocol; Valkey-compatible).
 *
 * Why this exists: Auth.js's per-user lockout (5 fails / 15 min) doesn't
 * help against a distributed botnet hammering the credentials endpoint —
 * each attempt still burns Argon2 CPU server-side and floods audit_log.
 * This adds an IP-level sliding window in front of the user lookup +
 * Argon2 verify so brute-force traffic gets rejected before it touches
 * the database.
 *
 * Falls back to a no-op when UPSTASH_REDIS_REST_URL / _TOKEN are unset
 * (local dev without Upstash credentials → don't block login attempts).
 *
 * Library note: `@upstash/ratelimit` is the same library whether the
 * Upstash backend is Redis or Valkey — the wire protocol is identical.
 * We use the REST SDK (`@upstash/redis`) which is Vercel-serverless-
 * compatible (HTTP, no persistent TCP connections).
 */

import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let cachedLoginLimit: Ratelimit | null = null;

/** Lazy-init the rate-limiter so missing env vars in dev don't crash imports. */
function getLoginRateLimit(): Ratelimit | null {
  if (cachedLoginLimit) return cachedLoginLimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  cachedLoginLimit = new Ratelimit({
    redis: new Redis({ url, token }),
    // 10 login attempts per IP per 10 minutes. Sliding window — last 10 min
    // always counts, no second-of-the-hour edge effects.
    limiter: Ratelimit.slidingWindow(10, "10 m"),
    analytics: true,
    prefix: "ratelimit:login",
  });
  return cachedLoginLimit;
}

export type LoginRateLimitResult = {
  /** True when the request is allowed; false when rate-limited. */
  success: boolean;
  /** Identifier we keyed on (IP or "anon" sentinel) — for audit-log only. */
  identifier: string;
  /** Remaining attempts in the current window. Infinity when no-op. */
  remaining: number;
};

/**
 * Check + consume one slot for the caller's IP. Should be called BEFORE
 * any DB query or Argon2 verify in the credentials authorize callback.
 *
 * Uses request headers (x-forwarded-for / x-real-ip) — Vercel sets these
 * on every request. Falls back to "anon" if neither header is present
 * (local dev without proxy), which means a single shared bucket — fine
 * for dev, doesn't run in prod since Vercel always sets the header.
 */
export async function checkLoginRateLimit(): Promise<LoginRateLimitResult> {
  const limit = getLoginRateLimit();
  if (!limit) {
    return { success: true, identifier: "no-op", remaining: Number.POSITIVE_INFINITY };
  }

  const h = await headers();
  // Take the first IP in the comma-separated list — that's the client.
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "anon";

  const r = await limit.limit(ip);
  return { success: r.success, identifier: ip, remaining: r.remaining };
}
