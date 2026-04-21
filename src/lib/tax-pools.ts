/**
 * Corporate tax pools — GRIP, ERDTOH, NERDTOH, CDA. Pure, no I/O.
 *
 * All four pools are structurally modelled even though Saïd's FY2026 will
 * start every one at zero with zero activity. The day he parks cash in a GIC
 * or his corp sells marketable securities, the framework is ready.
 *
 * References:
 *  - ITA s.89(1) GRIP / LRIP / CDA definitions
 *  - ITA s.129(1) dividend refund + RDTOH ordering
 *  - ITA s.129(4) NERDTOH / ERDTOH additions (post-2018 split)
 *  - CRA folio S3-F2-C1 (Capital Dividends)
 *  - Schedule 53 (GRIP addition formula, simplified)
 *  - Schedule 3 (dividend refund & Part IV tax)
 *
 * Formulas (2026):
 *  - GRIP addition = 0.72 × full-rate income (= taxable income − SBD-eligible
 *    − AII). For a pure-SBD CCPC with ABI ≤ $500K, full-rate = 0 → addition 0.
 *  - NERDTOH addition = 30⅔% × AAII + 38⅓% × Part IV tax on non-eligible
 *    portfolio dividends received from non-connected corps.
 *  - ERDTOH addition = 38⅓% × Part IV tax on eligible portfolio dividends
 *    received from non-connected corps.
 *  - Dividend refund (ITA s.129(1)(a)(i)): non-eligible dividends paid draw
 *    from NERDTOH first then ERDTOH; eligible dividends paid draw ONLY from
 *    ERDTOH. Refund rate on dividends paid is 38⅓%.
 *  - CDA addition: ½ × capital gains net of losses + capital dividends
 *    received + life-insurance proceeds (net of ACB). CDA used = capital
 *    dividends elected (T2054).
 *
 * LRIP is only relevant for non-CCPCs (not Saïd's case) — modelled implicitly
 * (it's 0 for every CCPC row) and deliberately not exposed in the return UI.
 */

const BPS = 10_000;

/** Refund rate on dividends paid: 38⅓% per ITA s.129(1)(a) — 38_1/3 %. */
export const DIVIDEND_REFUND_RATE_BPS = 3_833; // 38.33%
/** NERDTOH addition rate on AAII: 30⅔% per s.123.3 + s.129(4)(a)(i). */
export const NERDTOH_AAII_RATE_BPS = 3_067; // 30.67%
/** GRIP addition coefficient: 72% of full-rate income per s.89(1) definition. */
export const GRIP_ADDITION_COEFFICIENT_BPS = 7_200; // 72%
/** CDA capital-gain inclusion: 50% (non-taxable half credits CDA). */
export const CDA_CAPITAL_GAIN_INCLUSION_BPS = 5_000; // 50%

// ——— GRIP ———

export type GripInputs = {
  openingCents: number;
  fullRateIncomeCents: number; // taxable income − SBD-eligible − AII
  eligibleDividendsPaidCents: number; // dividends.amount where eligible = true, paid in FY
};

export type GripResult = {
  openingCents: number;
  additionCents: number;
  usedCents: number;
  closingCents: number;
  overdraftCents: number; // > 0 when eligible dividends paid exceed available GRIP
  warnings: string[];
};

export function computeGrip(i: GripInputs): GripResult {
  const additionCents = Math.max(
    0,
    Math.round((i.fullRateIncomeCents * GRIP_ADDITION_COEFFICIENT_BPS) / BPS),
  );
  const available = i.openingCents + additionCents;
  const usedCents = Math.min(i.eligibleDividendsPaidCents, Math.max(0, available));
  const overdraftCents = Math.max(0, i.eligibleDividendsPaidCents - available);
  const closingCents = Math.max(0, available - usedCents);
  const warnings: string[] = [];
  if (overdraftCents > 0) {
    warnings.push(
      `Eligible dividends paid exceed GRIP by $${(overdraftCents / 100).toFixed(2)} — Part III.1 tax applies (20% of excess per ITA s.185.1).`,
    );
  }
  return {
    openingCents: i.openingCents,
    additionCents,
    usedCents,
    closingCents,
    overdraftCents,
    warnings,
  };
}

// ——— RDTOH (ERDTOH + NERDTOH) ———

export type RdtohInputs = {
  erdtohOpeningCents: number;
  nerdtohOpeningCents: number;
  aaiiCents: number; // aggregate investment income for the FY
  partIVOnEligibleCents: number; // Part IV tax on non-connected eligible portfolio dividends received
  partIVOnNonEligibleCents: number; // Part IV tax on non-connected non-eligible portfolio dividends received
  eligibleDividendsPaidCents: number;
  nonEligibleDividendsPaidCents: number;
};

export type RdtohResult = {
  erdtoh: {
    openingCents: number;
    additionCents: number;
    refundCents: number;
    closingCents: number;
  };
  nerdtoh: {
    openingCents: number;
    additionCents: number;
    refundCents: number;
    closingCents: number;
  };
  dividendRefundCents: number;
  warnings: string[];
};

/**
 * ITA s.129(1)(a) ordering rule (as clarified by ITA 129(1)(a)(i) and (ii)
 * post the 2019 RDTOH split):
 *  1. Refund on eligible dividends paid = 38⅓% × eligible dividends paid,
 *     limited to the ERDTOH balance (opening + addition).
 *  2. Refund on non-eligible dividends paid = 38⅓% × non-elig paid, drawn
 *     first from NERDTOH, then spilling to remaining ERDTOH if NERDTOH is
 *     insufficient.
 */
export function computeRdtoh(i: RdtohInputs): RdtohResult {
  const erdtohAdd = Math.round((i.partIVOnEligibleCents * DIVIDEND_REFUND_RATE_BPS) / BPS);
  const nerdtohAdd =
    Math.round((i.aaiiCents * NERDTOH_AAII_RATE_BPS) / BPS) +
    Math.round((i.partIVOnNonEligibleCents * DIVIDEND_REFUND_RATE_BPS) / BPS);

  let erdtohBalance = i.erdtohOpeningCents + erdtohAdd;
  let nerdtohBalance = i.nerdtohOpeningCents + nerdtohAdd;

  // Step 1 — eligible dividends paid: draws ONLY from ERDTOH.
  const eligibleClaim = Math.round(
    (i.eligibleDividendsPaidCents * DIVIDEND_REFUND_RATE_BPS) / BPS,
  );
  const erdtohRefundFromEligible = Math.min(eligibleClaim, erdtohBalance);
  erdtohBalance -= erdtohRefundFromEligible;

  // Step 2 — non-eligible dividends paid: draws from NERDTOH first, spills
  // to remaining ERDTOH.
  const nonEligibleClaim = Math.round(
    (i.nonEligibleDividendsPaidCents * DIVIDEND_REFUND_RATE_BPS) / BPS,
  );
  const nerdtohRefund = Math.min(nonEligibleClaim, nerdtohBalance);
  nerdtohBalance -= nerdtohRefund;
  const spillToErdtoh = Math.min(nonEligibleClaim - nerdtohRefund, erdtohBalance);
  erdtohBalance -= spillToErdtoh;

  const erdtohRefund = erdtohRefundFromEligible + spillToErdtoh;
  const dividendRefundCents = erdtohRefund + nerdtohRefund;

  const warnings: string[] = [];
  if (eligibleClaim > erdtohRefundFromEligible) {
    warnings.push(
      "Eligible dividends paid exceed ERDTOH — excess produces no refund. Check GRIP vs eligible-dividend sizing.",
    );
  }
  if (nonEligibleClaim > nerdtohRefund + spillToErdtoh) {
    warnings.push(
      "Non-eligible dividends paid exceed combined NERDTOH + ERDTOH — excess produces no refund.",
    );
  }

  return {
    erdtoh: {
      openingCents: i.erdtohOpeningCents,
      additionCents: erdtohAdd,
      refundCents: erdtohRefund,
      closingCents: erdtohBalance,
    },
    nerdtoh: {
      openingCents: i.nerdtohOpeningCents,
      additionCents: nerdtohAdd,
      refundCents: nerdtohRefund,
      closingCents: nerdtohBalance,
    },
    dividendRefundCents,
    warnings,
  };
}

// ——— CDA ———

export type CdaInputs = {
  openingCents: number;
  capitalGainsNetCents: number; // realized capital gains minus capital losses for the FY
  capitalDividendsReceivedCents: number; // from other corps, if any
  lifeInsuranceProceedsCents: number; // net of ACB
  capitalDividendsElectedCents: number; // T2054 elections this FY
};

export type CdaResult = {
  openingCents: number;
  additionCents: number;
  usedCents: number;
  closingCents: number;
  warnings: string[];
};

export function computeCda(i: CdaInputs): CdaResult {
  const gainHalf = Math.round(
    (Math.max(0, i.capitalGainsNetCents) * CDA_CAPITAL_GAIN_INCLUSION_BPS) / BPS,
  );
  // Capital losses reduce CDA symmetrically (non-deductible half of losses
  // reduces the pool): use the signed net so losses push CDA down on gains.
  const signedGainHalf =
    i.capitalGainsNetCents >= 0
      ? gainHalf
      : -Math.round(
          (Math.abs(i.capitalGainsNetCents) * CDA_CAPITAL_GAIN_INCLUSION_BPS) / BPS,
        );

  const additionCents =
    signedGainHalf + i.capitalDividendsReceivedCents + i.lifeInsuranceProceedsCents;

  const available = i.openingCents + additionCents;
  const usedCents = Math.min(i.capitalDividendsElectedCents, Math.max(0, available));
  const closingCents = Math.max(0, available - usedCents);

  const warnings: string[] = [];
  if (i.capitalDividendsElectedCents > 0) {
    warnings.push(
      "Capital dividend election requires CRA form T2054 filed on or before the earlier of (a) the day the dividend becomes payable and (b) the first day the dividend is paid.",
    );
  }
  if (i.capitalDividendsElectedCents > available) {
    warnings.push(
      `Capital dividend elected ($${(i.capitalDividendsElectedCents / 100).toFixed(2)}) exceeds CDA balance — excess triggers Part III tax (60%) per ITA s.184(2).`,
    );
  }
  return {
    openingCents: i.openingCents,
    additionCents,
    usedCents,
    closingCents,
    warnings,
  };
}
