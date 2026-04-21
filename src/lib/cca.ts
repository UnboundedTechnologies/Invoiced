/**
 * Capital Cost Allowance (CCA) pool engine — pure, server-safe, no DB deps.
 *
 * Models Schedule 8 logic for the classes Saïd's corp uses today (8, 10, 12,
 * 50, other). Class 10.1 is accepted but flagged with a warning because each
 * passenger vehicle is supposed to get its own pool under Reg 1101(1af); v1
 * groups them under one row and emits a warning. Recapture, terminal loss, and
 * disposition math are deferred to 4C-v2 (no dispositions in Saïd's data yet).
 *
 * References:
 *  - ITA s.20(1)(a) (CCA deduction)
 *  - Reg 1100, 1101 (class rates + separate-pool rules)
 *  - Reg 1100(2) (half-year rule / AIIIR)
 *
 * AIIIR note: the Accelerated Investment Incentive (Reg 1100(2)(b)) phased
 * down for property first available for use after 2023. For 2024-2027 the
 * enhancement reverts to standard half-year; for most classes Saïd uses, the
 * result is indistinguishable from the pre-AIIIR regime. v1 applies standard
 * half-year unconditionally when halfYearRuleApplies=true. Classes 43.1/43.2/53
 * (clean energy / manufacturing immediate expensing) are out of scope.
 */

export type CcaClass = "8" | "10" | "10.1" | "12" | "50" | "other";

/** Raw per-asset input captured on an expense row (expenses.cca jsonb). */
export type CcaAddition = {
  class: CcaClass;
  classRateBps: number; // 2000 = 20% (can diverge from default for class=other)
  acquisitionCostCents: number;
  businessUsePercent: number; // 1-100; applied to additions at pool-build time
  halfYearRuleApplies: boolean;
  description: string | null;
};

/** One row in the pool schedule for a given FY. */
export type CcaPoolRow = {
  class: CcaClass;
  classRateBps: number;
  openingUccCents: number;
  additionsCents: number;
  dispositionsCents: number;
  halfYearAdjustmentCents: number; // (additions - dispositions) / 2 when half-year applies
  ccaBaseCents: number;
  claimFractionBps: number; // 0-10000; 10000 = claim 100%
  ccaClaimedCents: number;
  closingUccCents: number;
  warnings: string[];
};

/** Opening balance sourced from the prior FY's closing (or 0 for first FY). */
export type CcaOpening = {
  class: CcaClass;
  classRateBps: number;
  openingUccCents: number;
};

export type BuildCcaPoolsParams = {
  openingPools: CcaOpening[];
  additions: CcaAddition[];
  dispositions?: { class: CcaClass; proceedsCents: number }[]; // reserved for 4C-v2
  claimFractionBpsPerClass?: Partial<Record<CcaClass, number>>; // override per class; default 10000
};

/** Class 10.1 cost cap per Reg 7307(1) — $38,000 + HST as of 2025. */
export const CLASS_10_1_COST_CAP_CENTS = 38_000_00;

/** Default class rates in bps. classRate defaults live here so callers don't
 * need to repeat CLASS_DEFAULTS — but each addition row also carries its own
 * classRateBps for the "other" class case. */
export const CLASS_RATE_BPS: Record<CcaClass, number> = {
  "8": 2000,
  "10": 3000,
  "10.1": 3000,
  "12": 10_000,
  "50": 5500,
  other: 0,
};

export function buildCcaPools({
  openingPools,
  additions,
  dispositions = [],
  claimFractionBpsPerClass,
}: BuildCcaPoolsParams): CcaPoolRow[] {
  const allClasses: CcaClass[] = ["8", "10", "10.1", "12", "50", "other"];

  const openingByClass = new Map<CcaClass, CcaOpening>(
    openingPools.map((o) => [o.class, o]),
  );

  // Group additions per class, applying business-use % and Class 10.1 cost cap.
  const addByClass = new Map<CcaClass, { totalCents: number; halfYear: boolean; warnings: string[]; rateBps: number }>();
  for (const a of additions) {
    const bizUse = Math.max(0, Math.min(100, a.businessUsePercent)) / 100;
    let rawCost = Math.round(a.acquisitionCostCents * bizUse);
    const warnings: string[] = [];
    if (a.class === "10.1" && rawCost > CLASS_10_1_COST_CAP_CENTS) {
      warnings.push(
        `Class 10.1 cost capped at $${CLASS_10_1_COST_CAP_CENTS / 100} per Reg 7307(1).`,
      );
      rawCost = CLASS_10_1_COST_CAP_CENTS;
    }
    const prev = addByClass.get(a.class);
    const merged = prev
      ? { ...prev, totalCents: prev.totalCents + rawCost, halfYear: prev.halfYear && a.halfYearRuleApplies, warnings: [...prev.warnings, ...warnings] }
      : { totalCents: rawCost, halfYear: a.halfYearRuleApplies, warnings, rateBps: a.classRateBps };
    addByClass.set(a.class, merged);
  }

  // Group dispositions per class.
  const dispByClass = new Map<CcaClass, number>();
  for (const d of dispositions) {
    dispByClass.set(d.class, (dispByClass.get(d.class) ?? 0) + d.proceedsCents);
  }

  const rows: CcaPoolRow[] = [];
  for (const cls of allClasses) {
    const opening = openingByClass.get(cls);
    const add = addByClass.get(cls);
    const disp = dispByClass.get(cls) ?? 0;

    // Skip empty pools — no opening, no activity, no row.
    if (!opening && !add && disp === 0) continue;

    const classRateBps = opening?.classRateBps ?? add?.rateBps ?? CLASS_RATE_BPS[cls];
    const openingUcc = opening?.openingUccCents ?? 0;
    const additionsCents = add?.totalCents ?? 0;
    const dispositionsCents = disp;
    const halfYearApplies = add?.halfYear ?? false;

    // Half-year rule: CCA base = opening + (additions - dispositions) - half-year adj
    // where half-year adj = (additions - dispositions) / 2 when positive and rule applies.
    const netAdditions = additionsCents - dispositionsCents;
    const halfYearAdjustmentCents =
      halfYearApplies && netAdditions > 0 ? Math.floor(netAdditions / 2) : 0;
    const ccaBaseCents = openingUcc + netAdditions - halfYearAdjustmentCents;

    const claimFractionBps =
      claimFractionBpsPerClass?.[cls] ?? 10_000;
    const maxCca = Math.max(
      0,
      Math.round((ccaBaseCents * classRateBps) / 10_000),
    );
    const ccaClaimedCents = Math.round((maxCca * claimFractionBps) / 10_000);

    const closingUccCents = openingUcc + netAdditions - ccaClaimedCents;

    const warnings = [...(add?.warnings ?? [])];
    if (cls === "10.1" && additionsCents > 0) {
      warnings.push(
        "Class 10.1 requires a separate pool per vehicle (Reg 1101(1af)). v1 groups — split manually if you own multiple vehicles.",
      );
    }

    rows.push({
      class: cls,
      classRateBps,
      openingUccCents: openingUcc,
      additionsCents,
      dispositionsCents,
      halfYearAdjustmentCents,
      ccaBaseCents,
      claimFractionBps,
      ccaClaimedCents,
      closingUccCents,
      warnings,
    });
  }

  return rows;
}

/** Sum CCA claimed across all pool rows. Used as the Schedule 1 tax deduction
 * for the FY and as GIFI line 8670 (amortization of tangible assets). */
export function totalCcaClaimed(rows: CcaPoolRow[]): number {
  return rows.reduce((a, r) => a + r.ccaClaimedCents, 0);
}
