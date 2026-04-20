import { db } from "@/lib/db/client";
import { shareholderLoanEntries, prescribedRatePeriods } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import { Coins, TrendingDown, TrendingUp, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLoanEntryButton } from "@/components/shareholder-loan/new-entry-button";
import { LoanEntryRow } from "@/components/shareholder-loan/entry-row";
import { LoanRiskBanner } from "@/components/shareholder-loan/risk-banner";
import {
  computeLoanTimeline,
  type LoanEntry,
  type RatePeriod,
} from "@/lib/shareholder-loan";
import { formatCAD, formatLongDate, fiscalYearFor } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ShareholderLoanPage() {
  const [entriesRaw, rateRows, s] = await Promise.all([
    db
      .select()
      .from(shareholderLoanEntries)
      .orderBy(asc(shareholderLoanEntries.entryDate), asc(shareholderLoanEntries.createdAt)),
    db.select().from(prescribedRatePeriods).orderBy(asc(prescribedRatePeriods.startDate)),
    getSettings(),
  ]);
  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  const entries: LoanEntry[] = entriesRaw.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    type: e.type,
    amountCents: e.amountCents,
    description: e.description,
  }));
  const rates: RatePeriod[] = rateRows.map((r) => ({
    startDate: r.startDate,
    endDate: r.endDate,
    ratePercent: r.ratePercent,
  }));

  const timeline = computeLoanTimeline({
    entries,
    rates,
    fiscalYearEnd: { month: fyeMonth, day: fyeDay },
    today,
  });

  // Signed running balance per entry for the "running" column
  const runningByEntryId = new Map<string, number>();
  {
    let running = 0;
    for (const e of entriesRaw) {
      if (e.type === "draw") running += e.amountCents;
      else if (e.type === "repayment" || e.type === "reclassification") running -= e.amountCents;
      runningByEntryId.set(e.id, running);
    }
  }

  // Per-draw FIFO-matched unpaid principal. The row uses this for the
  // reclassify CTA amount; non-draw entries get 0 (button won't show).
  const unpaidByDrawId = new Map<string, number>(
    timeline.draws15_2Candidates.map((d) => [d.drawId, d.currentUnpaidCents]),
  );

  // Current-year summary for the header
  const currentYearSummary = timeline.annualSummaries.find((a) => a.calendarYear === currentFY);
  const fyBenefit = currentYearSummary?.benefit80_4Cents ?? 0;
  const fyInclusion = currentYearSummary?.inclusion15_2Cents ?? 0;
  const fyT4aBox117 = currentYearSummary?.t4aBox117Cents ?? 0;

  // Worst 15(2) candidate for the banner
  const candidates = [...timeline.draws15_2Candidates]
    .filter((c) => c.currentUnpaidCents > 0)
    .sort((a, b) => a.daysUntilTrigger - b.daysUntilTrigger);
  const worst = candidates[0];
  const pastDeadlineCount = timeline.draws15_2Candidates.filter(
    (c) => c.status === "past_deadline",
  ).length;
  const inWindow =
    worst && (worst.status === "warning" || worst.status === "past_deadline");

  // Rate coverage check — flag if today is past every configured rate period's end
  const lastRate = rates[rates.length - 1];
  const rateStale = lastRate && today > lastRate.endDate;

  const balance = timeline.todayBalanceCents;
  const balanceTone =
    balance === 0
      ? "text-emerald-400"
      : balance > 0
        ? "text-amber-400"
        : "text-cyan-400";
  const balanceLabel =
    balance === 0
      ? "Clean — no shareholder loan"
      : balance > 0
        ? "Corp → you (you owe the corp)"
        : "You → corp (corp owes you)";
  const BalanceIcon = balance === 0 ? Coins : balance > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shareholder loan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ITA s.15(2) ledger · s.80.4(2) benefit accrual · T4A box 117 prep
          </p>
        </div>
        <NewLoanEntryButton fyeMonth={fyeMonth} fyeDay={fyeDay} />
      </div>

      {inWindow && (
        <LoanRiskBanner
          daysUntilWorstTrigger={worst!.daysUntilTrigger}
          worstUnpaidCents={worst!.currentUnpaidCents}
          worstTriggerDate={worst!.triggerDate}
          pastDeadlineCount={pastDeadlineCount}
        />
      )}

      {rateStale && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-400" />
          <div className="text-xs text-muted-foreground">
            Latest configured prescribed rate ended {formatLongDate(lastRate.endDate)}. The engine
            is falling forward at {lastRate.ratePercent}% — add the next quarter&rsquo;s rate when CRA
            publishes it.
          </div>
        </div>
      )}

      {timeline.seriesWarnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-rose-400" />
          <div>
            <div className="text-sm font-semibold text-rose-400">
              Possible &ldquo;series of loans&rdquo; detected.
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {timeline.seriesWarnings.length} repay-near-FYE + reborrow-early pattern(s) found.
              Per CRA folio S3-F1-C1, this defeats the s.15(2.6) exception.
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Current balance
              </div>
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-inset ring-amber-500/30",
                )}
              >
                <BalanceIcon className={cn("size-[1.05rem]", balanceTone)} />
              </div>
            </div>
            <div
              className={cn(
                "text-3xl font-bold leading-none tracking-tight tabular-nums",
                balanceTone,
              )}
            >
              {formatCAD(Math.abs(balance))}
            </div>
            <CardDescription className="text-xs">{balanceLabel}</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                FY {currentFY} s.80.4 benefit
              </div>
              <div className="flex size-9 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-inset ring-cyan-500/30">
                <Info className="size-[1.05rem] text-cyan-400" />
              </div>
            </div>
            <div className="text-3xl font-bold leading-none tracking-tight tabular-nums text-cyan-400">
              {formatCAD(fyBenefit)}
            </div>
            <CardDescription className="text-xs">
              Net deemed interest at prescribed rate, less interest paid.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                FY {currentFY} T4A box 117
              </div>
              <div className="flex size-9 items-center justify-center rounded-lg bg-violet-500/10 ring-1 ring-inset ring-violet-500/30">
                <Coins className="size-[1.05rem] text-violet-400" />
              </div>
            </div>
            <div className="text-3xl font-bold leading-none tracking-tight tabular-nums text-violet-400">
              {formatCAD(fyT4aBox117)}
            </div>
            <CardDescription className="text-xs">
              s.80.4 benefit + any s.15(2) principal inclusion ({formatCAD(fyInclusion)}).
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Entries table */}
      {entriesRaw.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-inset ring-amber-500/30">
              <Coins className="size-6 text-amber-400" />
            </div>
            <CardTitle>No shareholder-loan activity yet</CardTitle>
            <CardDescription>
              Log every draw (corp → you) and repayment (you → corp) here. The engine keeps an
              eye on the ITA s.15(2.6) one-year deadline and accrues the s.80.4(2) benefit
              quarterly at the CRA prescribed rate.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-center font-semibold">Type</th>
                    <th className="px-4 py-3 text-left font-semibold">Description</th>
                    <th className="px-4 py-3 text-center font-semibold">FY</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 text-right font-semibold">Running</th>
                    <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesRaw.map((e) => (
                    <LoanEntryRow
                      key={e.id}
                      entry={e}
                      fyeMonth={fyeMonth}
                      fyeDay={fyeDay}
                      runningBalanceCents={runningByEntryId.get(e.id) ?? 0}
                      unpaidCents={unpaidByDrawId.get(e.id) ?? 0}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Year-end panel */}
      {timeline.annualSummaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">T4A box 117 by calendar year</CardTitle>
            <CardDescription>
              Gross s.80.4 benefit, minus interest paid (incl. 30-day window), plus any s.15(2)
              principal inclusion.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Year</th>
                    <th className="px-4 py-3 text-right font-semibold">Gross 80.4</th>
                    <th className="px-4 py-3 text-right font-semibold">Interest paid</th>
                    <th className="px-4 py-3 text-right font-semibold">15(2) incl.</th>
                    <th className="px-4 py-3 text-right font-semibold">T4A box 117</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.annualSummaries.map((a) => (
                    <tr key={a.calendarYear} className="border-b border-border/30">
                      <td className="px-4 py-3 font-mono text-xs">{a.calendarYear}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCAD(a.grossBenefit80_4Cents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        −{formatCAD(a.interestPaidCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.inclusion15_2Cents > 0 ? (
                          <span className="text-rose-400">
                            +{formatCAD(a.inclusion15_2Cents)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-violet-400">
                        {formatCAD(a.t4aBox117Cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
