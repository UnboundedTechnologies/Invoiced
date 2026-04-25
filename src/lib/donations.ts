/**
 * Charitable donations credit — federal line 34900 + Ontario ON428 line 5896.
 *
 * Pure compute, no DB. Called from src/lib/t1.ts after taxable income is known.
 *
 * Federal (ITA s.118.1(3)):
 *   - 15% × first $200
 *   - 33% × min(donations − $200, max(0, taxable − $258,482))   [top-bracket bonus]
 *   - 29% × remainder of (donations − $200)
 *
 * Ontario (ON Tax Act s.9(1)):
 *   - 5.05% × first $200
 *   - 11.16% × remainder
 *
 * Test scenarios live in scripts/verify-t1.ts.
 */

import {
  FEDERAL_BRACKETS_2026,
  FEDERAL_DONATION_HIGH_RATE,
  FEDERAL_DONATION_LOW_RATE,
  FEDERAL_DONATION_LOW_THRESHOLD_CENTS,
  FEDERAL_DONATION_TOP_RATE,
  ONTARIO_DONATION_HIGH_RATE,
  ONTARIO_DONATION_LOW_RATE,
} from "./t1-rates-2026";

export type DonationCreditResult = {
  federalCreditCents: number; // line 34900
  ontarioCreditCents: number; // ON428 line 5896 (Ontario non-refundable)
};

export function computeDonationCredit({
  totalCents,
  taxableIncomeCents,
}: {
  totalCents: number;
  taxableIncomeCents: number;
}): DonationCreditResult {
  if (totalCents <= 0) {
    return { federalCreditCents: 0, ontarioCreditCents: 0 };
  }

  const lowSlice = Math.min(totalCents, FEDERAL_DONATION_LOW_THRESHOLD_CENTS);
  const aboveLow = Math.max(0, totalCents - FEDERAL_DONATION_LOW_THRESHOLD_CENTS);

  // Federal — split the above-$200 portion across the 33% top-bracket bonus
  // and the 29% standard rate.
  const topBracketStartCents = FEDERAL_BRACKETS_2026[3]!.upTo * 100; // $258,482 for 2026
  const taxableInTopBracketCents = Math.max(0, taxableIncomeCents - topBracketStartCents);
  const topBracketSlice = Math.min(aboveLow, taxableInTopBracketCents);
  const standardSlice = aboveLow - topBracketSlice;

  const federalCreditCents =
    Math.round(lowSlice * FEDERAL_DONATION_LOW_RATE) +
    Math.round(topBracketSlice * FEDERAL_DONATION_TOP_RATE) +
    Math.round(standardSlice * FEDERAL_DONATION_HIGH_RATE);

  // Ontario — flat 5.05% on first $200, 11.16% on remainder.
  const ontarioCreditCents =
    Math.round(lowSlice * ONTARIO_DONATION_LOW_RATE) +
    Math.round(aboveLow * ONTARIO_DONATION_HIGH_RATE);

  return { federalCreditCents, ontarioCreditCents };
}
