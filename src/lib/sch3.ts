/**
 * Schedule 3 — Capital gains and losses → T1 line 12700.
 *
 * Pure compute. Per-row gain = proceeds − ACB − outlays. Sch 3 sums all rows
 * (line 19900 = total capital gains/losses) and applies the 50% inclusion rate
 * to the net positive amount → line 12700.
 *
 * Inclusion rate note: the 2024 federal budget proposed bumping the inclusion
 * rate to 2/3 on annual gains above $250K. That measure was deferred
 * indefinitely (status as of 2026-04-25). We use 50% throughout; revisit if
 * Finance reintroduces the change.
 *
 * Capital LOSS carryforward (s.111(1)(b)) is OUT OF SCOPE in v1: when
 * line 19900 < 0, line 12700 = 0 and a warning is emitted so future-me knows
 * to record the loss in `settings.capitalLossesCarriedForwardCents` (column
 * not yet added).
 */

export const CAPITAL_GAINS_INCLUSION_RATE = 0.5;

export type CapitalTxLite = {
  proceedsCents: number;
  acbCents: number;
  outlaysCents: number;
  kind: "public_security" | "mutual_fund" | "real_estate" | "crypto" | "other";
};

export type Sch3Result = {
  /** Sum of (proceeds − ACB − outlays) across all rows. Can be negative. */
  line19900Cents: number;
  /** 50% × max(0, line 19900). Always ≥ 0. */
  line12700Cents: number;
  /** Per-kind subtotals — surfaced for the year-page card. */
  byKind: Record<CapitalTxLite["kind"], number>;
  warnings: string[];
};

export function computeSch3(transactions: readonly CapitalTxLite[]): Sch3Result {
  const byKind: Record<CapitalTxLite["kind"], number> = {
    public_security: 0,
    mutual_fund: 0,
    real_estate: 0,
    crypto: 0,
    other: 0,
  };
  let line19900Cents = 0;
  for (const t of transactions) {
    const gain = t.proceedsCents - t.acbCents - t.outlaysCents;
    line19900Cents += gain;
    byKind[t.kind] += gain;
  }

  const line12700Cents =
    line19900Cents > 0
      ? Math.round(line19900Cents * CAPITAL_GAINS_INCLUSION_RATE)
      : 0;

  const warnings: string[] = [];
  if (line19900Cents < 0) {
    warnings.push(
      `Net capital LOSS of $${(-line19900Cents / 100).toFixed(2)} — losses don't offset other income on T1. Carryforward to a future year (s.111(1)(b)). Tracking is not yet automated; record manually.`,
    );
  }

  return { line19900Cents, line12700Cents, byKind, warnings };
}
