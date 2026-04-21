/**
 * Corporate tax rate constants + Ontario rate blending. Extracted into its
 * own module so `t2.ts` and `dashboard-metrics.ts` can both import without a
 * circular reference.
 *
 * Rate schedule per Ontario 2025 Fall Economic Statement: small-biz rate
 * drops from 3.2% to 2.2% on 2026-07-01. Periods straddling that day are
 * prorated day-by-day.
 */

/** Flat federal CCPC SBD rate (first $500K active business income). */
export const FED_SBD_RATE = 0.09;

const ON_RATE_BEFORE = 0.032;
const ON_RATE_AFTER = 0.022;
const ON_TRANSITION_ISO = "2026-07-01";

/**
 * Blended Ontario SBD rate across a fiscal period. Prorates across the
 * 2026-07-01 transition day-by-day when the period straddles it.
 */
export function ontarioSmallBizRate(periodStart: string, periodEnd: string): number {
  const s = utcDays(periodStart);
  const e = utcDays(periodEnd);
  if (e < s) return ON_RATE_BEFORE;
  const t = utcDays(ON_TRANSITION_ISO);
  if (e < t) return ON_RATE_BEFORE;
  if (s >= t) return ON_RATE_AFTER;
  const totalDays = e - s + 1;
  const daysBefore = t - s;
  const daysAfter = totalDays - daysBefore;
  return (daysBefore * ON_RATE_BEFORE + daysAfter * ON_RATE_AFTER) / totalDays;
}

function utcDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
