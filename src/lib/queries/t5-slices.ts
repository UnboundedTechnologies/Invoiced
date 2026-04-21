/**
 * Canonical T5 dividend aggregates for a given calendar year.
 *
 * Reads `dividends WHERE paidDate IS NOT NULL AND paidDate IN [cy-01-01, cy-12-31]`.
 * Unpaid declarations don't hit T1 — only paid dividends.
 *
 * Every T5-sourced number on /personal-tax, dashboard, and Phase 6 must flow
 * through this helper so filters can't drift between pages.
 */

import { and, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import { dividends } from "../db/schema";

export type T5Boxes = {
  eligible: {
    actualCents: number;   // box 24
    count: number;
  };
  nonEligible: {
    actualCents: number;   // box 10
    count: number;
  };
};

export async function t5BoxesForYear(cy: number): Promise<T5Boxes> {
  const start = `${cy}-01-01`;
  const end = `${cy}-12-31`;
  const rows = await db
    .select()
    .from(dividends)
    .where(
      and(
        isNotNull(dividends.paidDate),
        gte(dividends.paidDate, start),
        lte(dividends.paidDate, end),
      ),
    );

  const z: T5Boxes = {
    eligible: { actualCents: 0, count: 0 },
    nonEligible: { actualCents: 0, count: 0 },
  };
  for (const r of rows) {
    if (r.eligible) {
      z.eligible.actualCents += r.amountCents;
      z.eligible.count += 1;
    } else {
      z.nonEligible.actualCents += r.amountCents;
      z.nonEligible.count += 1;
    }
  }
  return z;
}
