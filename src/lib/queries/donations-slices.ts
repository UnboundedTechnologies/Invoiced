/**
 * Donations aggregate for a given calendar year — sums all donation receipts
 * whose `taxYear` matches. Single source of truth for both the live T1 input
 * and the year-page UI card.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { donations, type Donation } from "../db/schema";

export type DonationsForYear = {
  totalCents: number;
  rows: Donation[];
};

export async function donationsForYear(taxYear: number): Promise<DonationsForYear> {
  const rows = await db
    .select()
    .from(donations)
    .where(eq(donations.taxYear, taxYear));

  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  return { totalCents, rows };
}
