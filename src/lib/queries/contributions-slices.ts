/**
 * RRSP / FHSA contribution aggregate for a given tax year. Sums by `kind`,
 * keyed off `appliedToTaxYear` so the first-60-days RRSP election is honored
 * directly.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { rrspContributions, type RrspContribution } from "../db/schema";

export type ContributionsForYear = {
  rrspCents: number;
  fhsaCents: number;
  rows: RrspContribution[];
};

export async function contributionsForYear(taxYear: number): Promise<ContributionsForYear> {
  const rows = await db
    .select()
    .from(rrspContributions)
    .where(eq(rrspContributions.appliedToTaxYear, taxYear));

  let rrspCents = 0;
  let fhsaCents = 0;
  for (const r of rows) {
    if (r.kind === "rrsp") rrspCents += r.amountCents;
    else if (r.kind === "fhsa") fhsaCents += r.amountCents;
  }
  return { rrspCents, fhsaCents, rows };
}
