/**
 * Shareholder-loan compute engine — pure, server-safe.
 *
 * Tracks:
 *  - Balance timeline (signed running total: + = corp→shareholder receivable).
 *  - Per-quarter ITA s.80.4(2) deemed-interest benefit accruals using the
 *    prescribed rate effective each day.
 *  - ITA s.15(2)/s.15(2.6) one-year-after-FYE candidate list, FIFO-matched.
 *  - ITA s.80.4(3)(b) cutoff: once a draw triggers s.15(2), it stops
 *    contributing to s.80.4 from the trigger date onward.
 *  - Interest-paid offset (year-or-30-days-after rule in s.80.4(2)).
 *  - "Series of loans and repayments" warnings per CRA folio S3-F1-C1
 *    (2025-04-10 update).
 *  - Missing-rate warnings if no prescribed rate exists for a span of days
 *    in the active range (the UI prompts admin to add the next quarter).
 *
 * All amounts in integer cents. Dates as ISO yyyy-mm-dd strings, parsed in
 * UTC to sidestep DST / local-TZ drift (same discipline as utils.ts).
 */

import { fiscalYearFor } from "@/lib/utils";

export type LoanEntry = {
  id: string;
  entryDate: string; // ISO
  type: "draw" | "repayment" | "interest_payment" | "reclassification";
  amountCents: number; // always positive; direction implied by type
  description?: string | null;
};

export type RatePeriod = {
  startDate: string; // inclusive
  endDate: string;   // inclusive
  ratePercent: number; // e.g. 3 = 3%
};

export type DailyBalancePoint = {
  date: string;
  balanceCents: number;
  deltaCents: number;
};

export type QuarterlyAccrual = {
  startDate: string;
  endDate: string;
  ratePercent: number;
  daysInPeriod: number;
  // Sum of (unpaid_i × days) across every draw i that remained unpaid and
  // not-yet-triggered on each day of the period. Divided by 365 × rate/100
  // to yield the period's benefit.
  principalDayCents: number;
  benefitCents: number;
};

export type Draw15_2Candidate = {
  drawId: string;
  drawDate: string;
  drawFiscalYear: number;
  triggerDate: string;
  daysUntilTrigger: number; // negative once past
  currentUnpaidCents: number;
  unpaidAtTriggerCents: number; // 0 if cleared before trigger (no 15(2) needed)
  status: "clean" | "warning" | "past_deadline";
  inclusionYear: number | null; // calendar year the 15(2) amount lands, if any
};

export type SeriesWarning = {
  repaymentId: string;
  repaymentDate: string;
  repaymentCents: number;
  followingDrawId: string;
  followingDrawDate: string;
  followingDrawCents: number;
  fiscalYearBoundary: string; // ISO of the corp FYE straddled
};

export type AnnualSummary = {
  calendarYear: number;
  benefit80_4Cents: number;     // after interest-paid offset
  grossBenefit80_4Cents: number; // before offset
  interestPaidCents: number;
  inclusion15_2Cents: number;
  t4aBox117Cents: number; // grossBenefit − interest + inclusion, floored at 0
};

export type MissingRateGap = {
  startDate: string;
  endDate: string;
  days: number;
};

export type LoanTimeline = {
  todayBalanceCents: number;
  dailyBalance: DailyBalancePoint[];
  quarterlyAccruals: QuarterlyAccrual[];
  annualSummaries: AnnualSummary[];
  draws15_2Candidates: Draw15_2Candidate[];
  seriesWarnings: SeriesWarning[];
  missingRateGaps: MissingRateGap[];
  // Pulled forward so UI can show it without a second query.
  fiscalYearEnd: { month: number; day: number };
};

const MS_PER_DAY = 86_400_000;
const WARNING_WINDOW_DAYS = 90; // 15(2) banner turns amber inside this window
const SERIES_WINDOW_DAYS = 30;  // CRA "near FYE" tolerance
const SERIES_SIMILARITY = 0.8;  // ≥ 80% size match triggers series warning

function parseUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}
function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((parseUtc(toIso) - parseUtc(fromIso)) / MS_PER_DAY);
}
function addDays(iso: string, n: number): string {
  return toIso(parseUtc(iso) + n * MS_PER_DAY);
}
function addOneYear(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
function lenderFyeIso(drawIso: string, fye: { month: number; day: number }): string {
  const fy = fiscalYearFor(drawIso, fye.month, fye.day);
  return `${fy}-${String(fye.month).padStart(2, "0")}-${String(fye.day).padStart(2, "0")}`;
}

/** Rate lookup by ISO date. Falls back to the latest-known rate if date is
 * past the last configured period. Returns null if before the earliest
 * configured period (so the engine can emit a missing-rate warning). */
function rateOn(iso: string, rates: RatePeriod[]): number | null {
  // rates assumed sorted by startDate
  for (const r of rates) {
    if (iso >= r.startDate && iso <= r.endDate) return r.ratePercent;
  }
  // Fall-forward to latest known rate if we're past the last configured window
  const last = rates[rates.length - 1];
  if (last && iso > last.endDate) return last.ratePercent;
  return null;
}

export function computeLoanTimeline(input: {
  entries: LoanEntry[];
  rates: RatePeriod[];
  fiscalYearEnd: { month: number; day: number };
  today: string; // ISO — caller passes today so tests are deterministic
}): LoanTimeline {
  const { fiscalYearEnd, today } = input;
  const entries = [...input.entries].sort((a, b) =>
    a.entryDate === b.entryDate ? a.id.localeCompare(b.id) : a.entryDate.localeCompare(b.entryDate),
  );
  const rates = [...input.rates].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Empty state — nothing to compute.
  if (entries.length === 0) {
    return {
      todayBalanceCents: 0,
      dailyBalance: [],
      quarterlyAccruals: [],
      annualSummaries: [],
      draws15_2Candidates: [],
      seriesWarnings: [],
      missingRateGaps: [],
      fiscalYearEnd,
    };
  }

  // Per-draw state for FIFO-matched repayments
  type DrawState = {
    id: string;
    drawDate: string;
    principalCents: number;
    drawFiscalYear: number;
    triggerDate: string; // last day (inclusive) by which full repayment avoids 15(2)
    matchedRepaymentCents: number;
  };
  const draws: DrawState[] = [];
  const interestPayments: Array<{ id: string; date: string; amountCents: number }> = [];

  // First pass — chronological; FIFO-match repayments to draws
  for (const e of entries) {
    if (e.type === "draw") {
      const dfy = fiscalYearFor(e.entryDate, fiscalYearEnd.month, fiscalYearEnd.day);
      const fye = lenderFyeIso(e.entryDate, fiscalYearEnd);
      draws.push({
        id: e.id,
        drawDate: e.entryDate,
        principalCents: e.amountCents,
        drawFiscalYear: dfy,
        triggerDate: addOneYear(fye),
        matchedRepaymentCents: 0,
      });
    } else if (e.type === "repayment" || e.type === "reclassification") {
      let remaining = e.amountCents;
      for (const d of draws) {
        if (remaining === 0) break;
        const unpaid = d.principalCents - d.matchedRepaymentCents;
        if (unpaid > 0) {
          const apply = Math.min(unpaid, remaining);
          d.matchedRepaymentCents += apply;
          remaining -= apply;
        }
      }
      // Any excess means shareholder has over-paid (corp now owes shareholder).
      // Out of scope for s.80.4 (reverse direction). Balance timeline reflects it.
    } else if (e.type === "interest_payment") {
      interestPayments.push({ id: e.id, date: e.entryDate, amountCents: e.amountCents });
    }
  }

  // Signed running balance for the timeline UI
  const dailyBalance: DailyBalancePoint[] = [];
  {
    let running = 0;
    for (const e of entries) {
      let delta = 0;
      if (e.type === "draw") delta = e.amountCents;
      else if (e.type === "repayment" || e.type === "reclassification") delta = -e.amountCents;
      running += delta;
      const last = dailyBalance[dailyBalance.length - 1];
      if (last && last.date === e.entryDate) {
        last.balanceCents = running;
        last.deltaCents += delta;
      } else {
        dailyBalance.push({ date: e.entryDate, balanceCents: running, deltaCents: delta });
      }
    }
  }

  // Per-draw unpaid timeline — we need this for the 80.4 integral.
  // For each draw, walk events and compute unpaid-by-day.
  // Then sum unpaid×rate across non-triggered draws per quarter.
  type Segment = { startDate: string; endDate: string; unpaidCents: number };
  const segmentsByDraw = new Map<string, Segment[]>();
  {
    // Re-walk entries, tracking per-draw unpaid as repayments FIFO-consume it.
    type Walker = DrawState & { segments: Segment[]; currentStart: string };
    const walkers: Walker[] = [];
    for (const e of entries) {
      if (e.type === "draw") {
        const dfy = fiscalYearFor(e.entryDate, fiscalYearEnd.month, fiscalYearEnd.day);
        const fye = lenderFyeIso(e.entryDate, fiscalYearEnd);
        walkers.push({
          id: e.id,
          drawDate: e.entryDate,
          principalCents: e.amountCents,
          drawFiscalYear: dfy,
          triggerDate: addOneYear(fye),
          matchedRepaymentCents: 0,
          segments: [],
          currentStart: e.entryDate,
        });
      } else if (e.type === "repayment" || e.type === "reclassification") {
        let remaining = e.amountCents;
        for (const w of walkers) {
          if (remaining === 0) break;
          const unpaid = w.principalCents - w.matchedRepaymentCents;
          if (unpaid > 0) {
            const apply = Math.min(unpaid, remaining);
            // Close the current segment at the day BEFORE this repayment
            const segEnd = addDays(e.entryDate, -1);
            if (segEnd >= w.currentStart) {
              w.segments.push({
                startDate: w.currentStart,
                endDate: segEnd,
                unpaidCents: unpaid,
              });
            }
            w.matchedRepaymentCents += apply;
            w.currentStart = e.entryDate;
            remaining -= apply;
          }
        }
      }
    }
    // Close open segments at today
    for (const w of walkers) {
      const unpaid = w.principalCents - w.matchedRepaymentCents;
      if (unpaid > 0 && w.currentStart <= today) {
        w.segments.push({ startDate: w.currentStart, endDate: today, unpaidCents: unpaid });
      }
      segmentsByDraw.set(w.id, w.segments);
    }
  }

  // Missing-rate gaps: any span of interest between earliest entry and today
  // where `rateOn()` returns null (i.e. before the earliest configured period).
  const missingRateGaps: MissingRateGap[] = [];
  {
    const firstEntryDate = entries[0]!.entryDate;
    if (rates.length > 0 && firstEntryDate < rates[0]!.startDate) {
      const gapEnd = addDays(rates[0]!.startDate, -1);
      const days = dayDiff(firstEntryDate, gapEnd) + 1;
      missingRateGaps.push({
        startDate: firstEntryDate,
        endDate: gapEnd,
        days,
      });
    }
    // We deliberately don't flag forward gaps — rateOn() falls forward to the
    // latest-known rate so the engine doesn't zero-out silently.
  }

  // Build quarterly accruals — one per RatePeriod that overlaps any draw segment.
  const quarterlyAccruals: QuarterlyAccrual[] = [];
  for (const r of rates) {
    // Intersect with [firstSegmentStart, today] globally
    const periodStart = r.startDate;
    const periodEnd = r.endDate < today ? r.endDate : today;
    if (periodStart > periodEnd) continue;

    let principalDayCents = 0;
    for (const [drawId, segs] of segmentsByDraw.entries()) {
      const draw = draws.find((d) => d.id === drawId);
      if (!draw) continue;
      // Clip at the draw's 80.4(3)(b) cutoff — if the draw is past trigger and
      // still unpaid at trigger, 80.4 stops accruing from the trigger date.
      const unpaidAtTrigger = unpaidOnDate(segs, draw.triggerDate);
      const cutoff =
        unpaidAtTrigger > 0 && draw.triggerDate <= today ? draw.triggerDate : today;
      for (const s of segs) {
        const from = max(s.startDate, periodStart);
        const to = min(min(s.endDate, periodEnd), cutoff);
        if (from > to) continue;
        const days = dayDiff(from, to) + 1;
        principalDayCents += s.unpaidCents * days;
      }
    }
    const daysInPeriod = dayDiff(periodStart, periodEnd) + 1;
    // benefit = principalDayCents × rate% / 100 / 365
    const benefitCents = Math.round((principalDayCents * r.ratePercent) / 100 / 365);
    quarterlyAccruals.push({
      startDate: r.startDate,
      endDate: r.endDate,
      ratePercent: r.ratePercent,
      daysInPeriod,
      principalDayCents,
      benefitCents,
    });
  }

  // Handle forward-fallback rate accrual: any draw-segment day past the last
  // configured period still accrues at the last rate's percent.
  if (rates.length > 0) {
    const last = rates[rates.length - 1]!;
    if (today > last.endDate) {
      const periodStart = addDays(last.endDate, 1);
      const periodEnd = today;
      let principalDayCents = 0;
      for (const [drawId, segs] of segmentsByDraw.entries()) {
        const draw = draws.find((d) => d.id === drawId);
        if (!draw) continue;
        const unpaidAtTrigger = unpaidOnDate(segs, draw.triggerDate);
        const cutoff =
          unpaidAtTrigger > 0 && draw.triggerDate <= today ? draw.triggerDate : today;
        for (const s of segs) {
          const from = max(s.startDate, periodStart);
          const to = min(min(s.endDate, periodEnd), cutoff);
          if (from > to) continue;
          principalDayCents += s.unpaidCents * (dayDiff(from, to) + 1);
        }
      }
      if (principalDayCents > 0) {
        quarterlyAccruals.push({
          startDate: periodStart,
          endDate: periodEnd,
          ratePercent: last.ratePercent,
          daysInPeriod: dayDiff(periodStart, periodEnd) + 1,
          principalDayCents,
          benefitCents: Math.round((principalDayCents * last.ratePercent) / 100 / 365),
        });
      }
    }
  }

  // 15(2) candidate list
  const draws15_2Candidates: Draw15_2Candidate[] = draws.map((d) => {
    const segs = segmentsByDraw.get(d.id) ?? [];
    const currentUnpaid = unpaidOnDate(segs, today);
    const unpaidAtTrigger = unpaidOnDate(segs, d.triggerDate);
    const daysUntilTrigger = dayDiff(today, d.triggerDate);
    let status: Draw15_2Candidate["status"] = "clean";
    if (unpaidAtTrigger > 0 && daysUntilTrigger < 0) status = "past_deadline";
    else if (currentUnpaid > 0 && daysUntilTrigger >= 0 && daysUntilTrigger <= WARNING_WINDOW_DAYS)
      status = "warning";
    const inclusionYear = status === "past_deadline" ? Number(d.drawDate.slice(0, 4)) : null;
    return {
      drawId: d.id,
      drawDate: d.drawDate,
      drawFiscalYear: d.drawFiscalYear,
      triggerDate: d.triggerDate,
      daysUntilTrigger,
      currentUnpaidCents: currentUnpaid,
      unpaidAtTriggerCents: unpaidAtTrigger,
      status,
      inclusionYear,
    };
  });

  // Series warnings: repayment within 30 days BEFORE a corp FYE + subsequent
  // draw within 30 days AFTER that FYE, of ≥ 80% size.
  const seriesWarnings: SeriesWarning[] = [];
  {
    const repayments = entries.filter(
      (e) => e.type === "repayment" || e.type === "reclassification",
    );
    for (const r of repayments) {
      const fye = lenderFyeIso(r.entryDate, fiscalYearEnd);
      const daysToFye = dayDiff(r.entryDate, fye);
      if (daysToFye < 0 || daysToFye > SERIES_WINDOW_DAYS) continue;
      const windowEnd = addDays(fye, SERIES_WINDOW_DAYS);
      const rival = entries.find(
        (e) =>
          e.type === "draw" &&
          e.entryDate > fye &&
          e.entryDate <= windowEnd &&
          e.amountCents >= Math.floor(r.amountCents * SERIES_SIMILARITY),
      );
      if (rival) {
        seriesWarnings.push({
          repaymentId: r.id,
          repaymentDate: r.entryDate,
          repaymentCents: r.amountCents,
          followingDrawId: rival.id,
          followingDrawDate: rival.entryDate,
          followingDrawCents: rival.amountCents,
          fiscalYearBoundary: fye,
        });
      }
    }
  }

  // Annual summaries (calendar years). Allocate quarterly benefit to the
  // calendar year containing each accrual day (split quarters that straddle
  // Dec 31 — rare for CRA quarters, which align to Jan/Apr/Jul/Oct — but we
  // handle it anyway for safety against rolled-forward rates).
  const annualSummaries: AnnualSummary[] = (() => {
    const byYear = new Map<number, { gross: number; incl: number; int: number }>();
    const touch = (y: number) => {
      if (!byYear.has(y)) byYear.set(y, { gross: 0, incl: 0, int: 0 });
      return byYear.get(y)!;
    };
    // Apportion quarterly benefits to calendar years by day-count
    for (const q of quarterlyAccruals) {
      const startY = Number(q.startDate.slice(0, 4));
      const endY = Number(q.endDate.slice(0, 4));
      if (startY === endY) {
        touch(startY).gross += q.benefitCents;
      } else {
        // Split at Dec 31 / Jan 1
        const splitEnd = `${startY}-12-31`;
        const daysBefore = dayDiff(q.startDate, splitEnd) + 1;
        const totalDays = q.daysInPeriod;
        const portion = Math.round((q.benefitCents * daysBefore) / totalDays);
        touch(startY).gross += portion;
        touch(endY).gross += q.benefitCents - portion;
      }
    }
    // 15(2) inclusions
    for (const c of draws15_2Candidates) {
      if (c.status === "past_deadline" && c.inclusionYear != null) {
        touch(c.inclusionYear).incl += c.unpaidAtTriggerCents;
      }
    }
    // Interest payments — a payment in Jan 1 → Jan 30 offsets the PREVIOUS
    // calendar year first (s.80.4(2) 30-day rule); anything else offsets the
    // year of the payment.
    for (const ip of interestPayments) {
      const [y, m, d] = ip.date.split("-").map(Number) as [number, number, number];
      const targetYear = m === 1 && d <= 30 ? y - 1 : y;
      touch(targetYear).int += ip.amountCents;
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, v]) => {
        const netBenefit = Math.max(0, v.gross - v.int);
        return {
          calendarYear: year,
          grossBenefit80_4Cents: v.gross,
          interestPaidCents: v.int,
          benefit80_4Cents: netBenefit,
          inclusion15_2Cents: v.incl,
          t4aBox117Cents: netBenefit + v.incl,
        };
      });
  })();

  const todayBalance = dailyBalance.length > 0
    ? dailyBalance[dailyBalance.length - 1]!.balanceCents
    : 0;

  return {
    todayBalanceCents: todayBalance,
    dailyBalance,
    quarterlyAccruals,
    annualSummaries,
    draws15_2Candidates,
    seriesWarnings,
    missingRateGaps,
    fiscalYearEnd,
  };
}

function unpaidOnDate(segments: Array<{ startDate: string; endDate: string; unpaidCents: number }>, iso: string): number {
  for (const s of segments) if (iso >= s.startDate && iso <= s.endDate) return s.unpaidCents;
  return 0;
}
function max(a: string, b: string): string { return a > b ? a : b; }
function min(a: string, b: string): string { return a < b ? a : b; }

/** Expose rate lookup for UI / server actions that need a single-day rate. */
export function prescribedRateOn(iso: string, rates: RatePeriod[]): number | null {
  return rateOn(iso, [...rates].sort((a, b) => a.startDate.localeCompare(b.startDate)));
}
