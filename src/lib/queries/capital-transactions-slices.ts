/**
 * Capital transactions aggregate for a tax year — fetches rows + computes
 * Sch 3 totals via the pure engine. Single source for both T1 input and the
 * year-page card.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { capitalTransactions, type CapitalTransaction } from "../db/schema";
import { computeSch3, type Sch3Result } from "../sch3";

export type CapitalTransactionsForYear = {
  rows: CapitalTransaction[];
  sch3: Sch3Result;
};

export async function capitalTransactionsForYear(taxYear: number): Promise<CapitalTransactionsForYear> {
  const rows = await db
    .select()
    .from(capitalTransactions)
    .where(eq(capitalTransactions.taxYear, taxYear));

  const sch3 = computeSch3(rows);
  return { rows, sch3 };
}
