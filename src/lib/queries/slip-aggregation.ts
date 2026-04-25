/**
 * Slip-box aggregation façade — single source of truth for T4 / T5 slip
 * values used by the UI preview, the PDF renderer, the file/freeze action,
 * and the verify suites. Layered on top of existing canonical slices:
 *
 *   - T4 raw sums  ← t4BoxesForYear (paycheques WHERE status='issued' AND payDate ∈ CY)
 *   - T5 raw sums  ← t5BoxesForYear (dividends WHERE paidDate IS NOT NULL AND paidDate ∈ CY)
 *
 * Pure mapping / gross-up / DTC math lives in `src/lib/slip-boxes.ts` (DB-free
 * so verify-slips.ts can exercise it without DATABASE_URL). This module only
 * plumbs the DB-backed slices through those pure helpers.
 */

import { t4SlipBoxesFromRaw, t4aSlipBoxesFromRaw, t5SlipBoxesFromRaw } from "@/lib/slip-boxes";
import type { T4ASlipBoxes, T4SlipBoxes, T5SlipBoxes } from "@/lib/slip-boxes";
import { t4BoxesForYear } from "./t4-slices";
import { t4aBox117ForYear } from "./t4a-slices";
import { t5BoxesForYear } from "./t5-slices";

export type { T4ASlipBoxes, T4SlipBoxes, T5SlipBoxes } from "@/lib/slip-boxes";

export async function buildT4SlipBoxes(taxYear: number): Promise<T4SlipBoxes> {
  return t4SlipBoxesFromRaw(await t4BoxesForYear(taxYear), taxYear);
}

export async function buildT5SlipBoxes(taxYear: number): Promise<T5SlipBoxes> {
  return t5SlipBoxesFromRaw(await t5BoxesForYear(taxYear), taxYear);
}

export async function buildT4ASlipBoxes(taxYear: number): Promise<T4ASlipBoxes> {
  const summary = await t4aBox117ForYear(taxYear);
  return t4aSlipBoxesFromRaw(
    {
      box117Cents: summary.cents,
      benefit80_4Cents: summary.breakdown.benefit80_4Cents,
      inclusion15_2Cents: summary.breakdown.inclusion15_2Cents,
    },
    taxYear,
  );
}
