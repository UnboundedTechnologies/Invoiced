/**
 * Canonical invoice-status predicates. Every page, aggregator, and SQL
 * query that filters invoices by "does this count as revenue?" MUST go
 * through here.
 *
 * Rule: a draft is not yet a taxable supply (the corp hasn't billed the
 * client), a void is cancelled. Both are excluded from revenue, HST, and
 * any metric that claims to count supplies made in a period. If this rule
 * ever changes, change it here and nowhere else.
 *
 * - TS callers: `isTaxableSupply(i)` or `isTaxableSupplyInPeriod(i, period)`
 * - SQL callers: `inArray(invoices.status, TAXABLE_SUPPLY_STATUSES)`
 *
 * `scripts/verify-coherence.ts` asserts every consumer agrees on a shared
 * fixture. Break that test and something that should have counted drifted
 * out of sync.
 */

export const TAXABLE_SUPPLY_STATUSES = ["sent", "paid", "overdue"] as const;
export type TaxableSupplyStatus = (typeof TAXABLE_SUPPLY_STATUSES)[number];

export function isTaxableSupply<T extends { status: string }>(i: T): boolean {
  return i.status !== "void" && i.status !== "draft";
}

export function isTaxableSupplyInPeriod<
  T extends { status: string; issueDate: string },
>(i: T, period: { start: string; end: string }): boolean {
  return (
    isTaxableSupply(i) &&
    i.issueDate >= period.start &&
    i.issueDate <= period.end
  );
}
