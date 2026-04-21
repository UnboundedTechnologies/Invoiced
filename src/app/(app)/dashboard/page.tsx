import Link from "next/link";
import { db } from "@/lib/db/client";
import {
  dividends,
  expenses,
  invoices,
  paycheques,
  psbChecklistItems,
  shareholderLoanEntries,
  prescribedRatePeriods,
  plannerScenarios,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import { hstReturns } from "@/lib/db/schema";
import {
  aggregateRegular,
  aggregateQuickMethod,
  hstFilingDueDate,
  hstPeriodFor,
} from "@/lib/hst";
import {
  CircleDollarSign,
  Percent,
  Wallet,
  FileText,
  Receipt,
  PiggyBank,
  CalendarClock,
  Coins,
  Settings,
  Landmark,
  Banknote,
  TrendingUp,
  Calculator,
  Target,
  Percent as PercentIcon,
} from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { QuickActionTile } from "@/components/quick-action-tile";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";
import { PsbDashboardBanner } from "@/components/psb/dashboard-banner";
import { LoanRiskBanner } from "@/components/shareholder-loan/risk-banner";
import { computePsbRisk } from "@/lib/psb";
import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "@/lib/shareholder-loan";
import {
  estimateCashPosition,
  operatingExpensesForT2,
  revenueByMonth,
} from "@/lib/dashboard-metrics";
import { estimateT2Detailed } from "@/lib/t2";
import { computeT1, marginalRateOnNextDollar } from "@/lib/t1";
import { buildT1Inputs } from "@/lib/queries/personal-tax-slices";
import { computeGrip, computeRdtoh, computeCda } from "@/lib/tax-pools";
import { isTaxableSupplyInPeriod } from "@/lib/queries/invoice-slices";
import { cn, fiscalYearFor, formatCAD } from "@/lib/utils";
import { TONE } from "@/lib/tones";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [
    s,
    allDividends,
    allPaycheques,
    psbItems,
    loanEntriesRaw,
    rateRows,
    allInvoices,
    allExpenses,
    allHstReturns,
  ] = await Promise.all([
    getSettings(),
    db.select().from(dividends),
    db.select().from(paycheques),
    db.select().from(psbChecklistItems),
    db
      .select()
      .from(shareholderLoanEntries)
      .orderBy(asc(shareholderLoanEntries.entryDate), asc(shareholderLoanEntries.createdAt)),
    db.select().from(prescribedRatePeriods).orderBy(asc(prescribedRatePeriods.startDate)),
    db.select().from(invoices),
    db.select().from(expenses),
    db.select().from(hstReturns),
  ]);
  const firstName = s?.directorLegalName?.split(" ")[0] ?? "there";
  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const fyEnd = `${String(fyeMonth).padStart(2, "0")}-${String(fyeDay).padStart(2, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);
  const fyPeriod = hstPeriodFor(currentFY, fyeMonth, fyeDay);

  // Pinned planner scenario for the current FY — displayed as a "Projected FY"
  // stat card alongside YTD actuals. One row max (pin is 0-1 per FY).
  const [pinnedScenario] = await db
    .select()
    .from(plannerScenarios)
    .where(
      and(
        eq(plannerScenarios.fiscalYear, currentFY),
        eq(plannerScenarios.isPinned, true),
      ),
    )
    .limit(1);
  const fyDividends = allDividends.filter((d) => d.fiscalYear === currentFY);
  const dividendsFYTotal = fyDividends.reduce((a, d) => a + d.amountCents, 0);
  const eligibleTotal = fyDividends.filter((d) => d.eligible).reduce((a, d) => a + d.amountCents, 0);
  const nonEligibleTotal = dividendsFYTotal - eligibleTotal;

  // FY-based paycheque totals — drives the Self-pay stat card plus T2 + cash
  // position estimates. Matches the FY basis already used for dividends so
  // the blended "salary + dividends" number stays coherent regardless of the
  // corp's FYE.
  const fyPaycheques = allPaycheques.filter(
    (p) => p.status === "issued" && p.payDate >= fyPeriod.start && p.payDate <= fyPeriod.end,
  );
  const fySalaryGross = fyPaycheques.reduce((a, p) => a + p.grossCents, 0);
  const fyEmployerCpp = fyPaycheques.reduce(
    (a, p) => a + p.employerCppCents + p.employerCpp2Cents,
    0,
  );
  const selfPayFY = fySalaryGross + dividendsFYTotal;

  // FY-based revenue (shared predicate with the HST aggregator and
  // /invoices header via src/lib/queries/invoice-slices).
  const fyRevenueInvoices = allInvoices.filter((i) =>
    isTaxableSupplyInPeriod(i, fyPeriod),
  );
  const fyRevenueSubtotalCents = fyRevenueInvoices.reduce((a, i) => a + i.subtotalCents, 0);
  const fyRevenueTotalCents = fyRevenueInvoices.reduce((a, i) => a + i.totalCents, 0);
  const fyHstCollectedCents = fyRevenueInvoices.reduce((a, i) => a + i.hstCents, 0);
  const fyInvoiceCount = fyRevenueInvoices.length;

  const fyExpenses = allExpenses.filter((e) => e.fiscalYear === currentFY);
  const fyExpensesTotalCents = fyExpenses.reduce((a, e) => a + e.totalCents, 0);
  const fyExpensesCount = fyExpenses.length;
  const fyOperatingDeductibleCents = operatingExpensesForT2(
    fyExpenses.map((e) => ({
      category: e.category,
      subtotalCents: e.subtotalCents,
      totalCents: e.totalCents,
    })),
  );

  // HST net tax (line 109) projected for the current fiscal year. When a
  // draft return exists we pick up its method + first-year flag; otherwise
  // fall back to regular-method projection.
  const hstDueIso = hstFilingDueDate(fyPeriod.end);
  const currentFyReturn = allHstReturns.find((r) => r.fiscalYear === currentFY);
  const hstMethod = currentFyReturn?.method ?? "regular";
  const hstFirstQm = currentFyReturn?.isFirstQmFy ?? false;
  const hstStatus = currentFyReturn?.status ?? "draft";
  const hstInvoiceSlices = allInvoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    issueDate: i.issueDate,
    subtotalCents: i.subtotalCents,
    hstCents: i.hstCents,
    totalCents: i.totalCents,
    status: i.status,
  }));
  const hstExpenseSlices = allExpenses.map((e) => ({
    id: e.id,
    expenseDate: e.expenseDate,
    vendor: e.vendor,
    category: e.category,
    subtotalCents: e.subtotalCents,
    hstPaidCents: e.hstPaidCents,
    totalCents: e.totalCents,
  }));
  const liveAggregate =
    hstMethod === "quick"
      ? aggregateQuickMethod({
          invoices: hstInvoiceSlices,
          expenses: hstExpenseSlices,
          period: fyPeriod,
          isFirstQmFy: hstFirstQm,
        })
      : aggregateRegular({
          invoices: hstInvoiceSlices,
          expenses: hstExpenseSlices,
          period: fyPeriod,
        });
  const hstNetCents =
    hstStatus === "filed"
      ? currentFyReturn?.line109Cents ?? 0
      : liveAggregate.line109Cents;
  const liveItcRecoverableCents =
    hstStatus === "filed"
      ? currentFyReturn?.line108Cents ?? 0
      : liveAggregate.line108Cents;
  const hstDaysToDue = Math.round(
    (new Date(hstDueIso + "T00:00:00Z").getTime() -
      new Date(today + "T00:00:00Z").getTime()) /
      86_400_000,
  );

  // Corporate tax (T2) estimate — FY basis, fed 9% + ON blended. Single
  // compute feeds both the stat card and the GRIP/RDTOH/CDA pool math.
  // Dashboard simplification: ccaClaimedCents = 0 (the /corp-tax detail
  // page routes through CCA pools for the real number).
  const t2 = estimateT2Detailed({
    periodStart: fyPeriod.start,
    periodEnd: fyPeriod.end,
    isCcpc: s?.isCcpc ?? true,
    revenueCents: fyRevenueSubtotalCents,
    operatingExpensesCents: fyOperatingDeductibleCents,
    salaryCents: fySalaryGross,
    employerCppCents: fyEmployerCpp,
    ccaClaimedCents: 0,
    priorYearAaiiCents: s?.priorYearAaiiCents ?? 0,
    ontarioGeneralRateBps: s?.ontarioGeneralRateBps ?? 1150,
  });

  // Personal tax (T1) estimate — current CY basis. Reads from the shared
  // slice façade (`buildT1Inputs`) that /personal-tax also uses, so numbers
  // are bit-identical across pages. Phase 6 will consume the same compute.
  const currentCY = new Date().getUTCFullYear();
  const t1Input = await buildT1Inputs(currentCY);
  const t1 = computeT1(t1Input);
  const t1Marginal = marginalRateOnNextDollar(t1Input, 100_00);

  // Tax pools — current FY. Opening = settings.opening* since Saïd's corp
  // hasn't filed a T2 yet; once one is filed the /corp-tax detail page
  // becomes authoritative (it resolves openings from prior-FY closings).
  const eligibleDividendsPaidFY = fyDividends
    .filter((d) => d.eligible && d.paidDate !== null)
    .reduce((a, d) => a + d.amountCents, 0);
  const nonEligibleDividendsPaidFY = fyDividends
    .filter((d) => !d.eligible && d.paidDate !== null)
    .reduce((a, d) => a + d.amountCents, 0);
  const grip = computeGrip({
    openingCents: s?.openingGripCents ?? 0,
    fullRateIncomeCents: t2.fullRateIncomeCents,
    eligibleDividendsPaidCents: eligibleDividendsPaidFY,
  });
  const rdtoh = computeRdtoh({
    erdtohOpeningCents: s?.openingErdtohCents ?? 0,
    nerdtohOpeningCents: s?.openingNerdtohCents ?? 0,
    aaiiCents: 0,
    partIVOnEligibleCents: 0,
    partIVOnNonEligibleCents: 0,
    eligibleDividendsPaidCents: eligibleDividendsPaidFY,
    nonEligibleDividendsPaidCents: nonEligibleDividendsPaidFY,
  });
  const cda = computeCda({
    openingCents: s?.openingCdaCents ?? 0,
    capitalGainsNetCents: 0,
    capitalDividendsReceivedCents: 0,
    lifeInsuranceProceedsCents: 0,
    capitalDividendsElectedCents: 0,
  });

  // Cash position estimate — accrual basis, after every FY obligation. The
  // dividend refund (Schedule 3) comes back from CRA, so treat it as an
  // inflow offsetting the T2 bill.
  const cash = estimateCashPosition({
    revenueTotalCents: fyRevenueTotalCents,
    expensesTotalCents: fyExpensesTotalCents,
    salaryGrossCents: fySalaryGross,
    employerCppCents: fyEmployerCpp,
    dividendsCents: dividendsFYTotal,
    t2EstimateCents: t2.totalTaxCents,
    hstNetCents,
    dividendRefundCents: rdtoh.dividendRefundCents,
  });

  // 12-month rolling revenue trend — ends on current month.
  const currentIsoMonth = today.slice(0, 7);
  const trendSeries = revenueByMonth(
    allInvoices.map((i) => ({
      issueDate: i.issueDate,
      subtotalCents: i.subtotalCents,
      status: i.status,
    })),
    currentIsoMonth,
  );
  const trendValues = trendSeries.map((b) => b.cents);
  const trend12moTotal = trendValues.reduce((a, v) => a + v, 0);
  const nonEmptyMonths = trendValues.filter((v) => v > 0).length;
  const trendAvg = nonEmptyMonths > 0 ? Math.round(trend12moTotal / nonEmptyMonths) : 0;
  const trendPeak = Math.max(...trendValues, 0);
  const trendPeakBucket = trendSeries.find((b) => b.cents === trendPeak);
  const trendPeakLabel =
    trendPeak > 0 && trendPeakBucket ? monthNameShort(trendPeakBucket.month) : null;

  const psb = computePsbRisk(psbItems);

  // Shareholder-loan timeline → balance, worst 15(2) candidate, banner input
  const loanEntries: LoanEntry[] = loanEntriesRaw.map((e) => ({
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
  const loan = computeLoanTimeline({
    entries: loanEntries,
    rates,
    fiscalYearEnd: { month: fyeMonth, day: fyeDay },
    today,
  });
  const outstandingDraws = loan.draws15_2Candidates
    .filter((c) => c.currentUnpaidCents > 0)
    .sort((a, b) => a.daysUntilTrigger - b.daysUntilTrigger);
  const worstDraw = outstandingDraws[0];
  const pastDeadlineCount = loan.draws15_2Candidates.filter(
    (c) => c.status === "past_deadline",
  ).length;
  const loanBannerVisible =
    worstDraw && (worstDraw.status === "warning" || worstDraw.status === "past_deadline");
  const loanBalance = loan.todayBalanceCents;
  const loanHint = (() => {
    if (loanBalance === 0) return "Clean";
    if (loanBalance > 0) {
      if (worstDraw) return `Next deadline ${worstDraw.triggerDate}`;
      return "Corp → you";
    }
    return "You → corp";
  })();

  const cashPositive = cash.netCents >= 0;
  const onRatePct = (t2.ontarioBlendedSbdRateBps / 100).toFixed(2);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome back, <span className="text-brand-gradient">{firstName}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s?.corpLegalName} · fiscal year ending {fyEnd}
        </p>
      </div>

      <PsbDashboardBanner score={psb.score} risk={psb.risk} criticalMissing={psb.criticalMissing} />

      {loanBannerVisible && (
        <LoanRiskBanner
          daysUntilWorstTrigger={worstDraw.daysUntilTrigger}
          worstUnpaidCents={worstDraw.currentUnpaidCents}
          worstTriggerDate={worstDraw.triggerDate}
          pastDeadlineCount={pastDeadlineCount}
        />
      )}

      {/* Revenue trend */}
      <Card
        className="relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards"
        style={{ animationDuration: "500ms", animationDelay: "60ms" }}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r",
            TONE.emerald.topBar,
          )}
        />
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Revenue trend
              </div>
              <div className="text-3xl font-bold leading-none tracking-tight tabular-nums">
                {formatCAD(trend12moTotal)}
              </div>
              <div className="text-xs text-muted-foreground">
                {nonEmptyMonths > 0 ? (
                  <>
                    12-month total · avg{" "}
                    <span className="text-foreground">{formatCAD(trendAvg)}</span>/mo over{" "}
                    {nonEmptyMonths} active month{nonEmptyMonths === 1 ? "" : "s"}
                    {trendPeakLabel && (
                      <>
                        {" · peak "}
                        <span className="text-foreground">{formatCAD(trendPeak)}</span> in{" "}
                        {trendPeakLabel}
                      </>
                    )}
                  </>
                ) : (
                  "No invoiced revenue in the past 12 months"
                )}
              </div>
            </div>
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                TONE.emerald.bg,
                TONE.emerald.border,
              )}
            >
              <TrendingUp className={cn("size-[1.05rem]", TONE.emerald.text)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Sparkline
            data={trendValues}
            tone="emerald"
            height={72}
            ariaLabel="12-month revenue sparkline"
          />
          <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <span>{monthNameShort(trendSeries[0]!.month)}</span>
            <span>{monthNameShort(trendSeries[trendSeries.length - 1]!.month)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard
          label={`Revenue FY ${currentFY}`}
          value={formatCAD(fyRevenueSubtotalCents)}
          hint={
            fyInvoiceCount === 0
              ? "No invoices issued yet"
              : `${fyInvoiceCount} invoice${fyInvoiceCount === 1 ? "" : "s"} issued in FY ${currentFY}`
          }
          icon={CircleDollarSign}
          tone="emerald"
          delayMs={100}
        />
        <StatCard
          label={`HST net — FY ${currentFY}`}
          value={formatCAD(Math.abs(hstNetCents))}
          hint={
            hstStatus === "filed" ? (
              <span className="text-emerald-400">
                Filed · {formatCAD(fyHstCollectedCents)} HST collected FY {currentFY}
              </span>
            ) : hstNetCents === 0 ? (
              <>Nothing to remit · return due in {hstDaysToDue} days</>
            ) : hstNetCents > 0 ? (
              <>
                Owed to CRA ·{" "}
                {hstDaysToDue >= 0
                  ? `due in ${hstDaysToDue} day${hstDaysToDue === 1 ? "" : "s"}`
                  : `${Math.abs(hstDaysToDue)} days overdue`}
              </>
            ) : (
              <>
                Refund ·{" "}
                {hstDaysToDue >= 0
                  ? `file by ${hstDaysToDue} day${hstDaysToDue === 1 ? "" : "s"} from now`
                  : `${Math.abs(hstDaysToDue)} days past due`}
              </>
            )
          }
          icon={Percent}
          tone="sky"
          delayMs={180}
        />
        <StatCard
          label={`Self-pay FY ${currentFY}`}
          value={formatCAD(selfPayFY)}
          hint={
            <>
              <span className="text-amber-400">{formatCAD(fySalaryGross)} salary</span>
              {" · "}
              <span className="text-violet-400">{formatCAD(dividendsFYTotal)} dividends</span>
            </>
          }
          icon={Wallet}
          tone="amber"
          delayMs={260}
        />
        <StatCard
          label={`Dividends FY ${currentFY}`}
          value={formatCAD(dividendsFYTotal)}
          hint={
            dividendsFYTotal === 0 ? (
              "None declared yet"
            ) : (
              <>
                <span className="text-emerald-400">{formatCAD(eligibleTotal)} eligible</span>
                {" · "}
                <span className="text-violet-400">{formatCAD(nonEligibleTotal)} non-eligible</span>
              </>
            )
          }
          icon={PiggyBank}
          tone="violet"
          delayMs={340}
        />
        <StatCard
          label="Shareholder loan"
          value={formatCAD(Math.abs(loanBalance))}
          hint={loanHint}
          icon={Coins}
          tone="cyan"
          delayMs={420}
        />
        <StatCard
          label={`Expenses FY ${currentFY}`}
          value={formatCAD(fyExpensesTotalCents)}
          hint={
            fyExpensesCount === 0 ? (
              "None logged yet"
            ) : (
              <>
                {fyExpensesCount} expense{fyExpensesCount === 1 ? "" : "s"} ·{" "}
                <span className="text-amber-400">
                  {formatCAD(liveItcRecoverableCents)} ITC {hstMethod === "quick" ? "(capital only)" : "recoverable"}
                </span>
              </>
            )
          }
          icon={Receipt}
          tone="rose"
          delayMs={500}
        />
        <StatCard
          label={`Est. corp tax FY ${currentFY}`}
          value={formatCAD(t2.totalTaxCents)}
          hint={
            t2.taxableIncomeCents === 0 ? (
              "No taxable income yet"
            ) : (
              <>
                On <span className="text-foreground">{formatCAD(t2.taxableIncomeCents)}</span> taxable ·
                fed 9% + ON {onRatePct}%
                {t2.fullRateIncomeCents > 0 && (
                  <span className="ml-1 text-rose-400">· over SBD</span>
                )}
                {t2.sbdGrindCents > 0 && (
                  <span className="ml-1 text-amber-400">· SBD grind</span>
                )}
              </>
            )
          }
          icon={Landmark}
          tone="indigo"
          delayMs={580}
        />
        <StatCard
          label={`Tax pools FY ${currentFY}`}
          value={formatCAD(grip.closingCents)}
          hint={
            <>
              <span className="text-cyan-400">GRIP</span> cap ·{" "}
              <span className="text-emerald-400">{formatCAD(rdtoh.erdtoh.closingCents)}</span> ER /{" "}
              <span className="text-amber-400">{formatCAD(rdtoh.nerdtoh.closingCents)}</span> NER ·{" "}
              <span className="text-violet-400">{formatCAD(cda.closingCents)}</span> CDA
            </>
          }
          icon={Landmark}
          tone="indigo"
          delayMs={620}
        />
        <StatCard
          label={`Cash position FY ${currentFY}`}
          value={formatCAD(Math.abs(cash.netCents))}
          hint={
            <>
              <span className={cashPositive ? "text-emerald-400" : "text-rose-400"}>
                {cashPositive ? "Retained" : "Shortfall"}
              </span>{" "}
              after payroll, dividends, HST, T2
              {rdtoh.dividendRefundCents > 0 && (
                <>
                  {" · "}
                  <span className="text-emerald-400">
                    +{formatCAD(rdtoh.dividendRefundCents)} div refund
                  </span>
                </>
              )}
            </>
          }
          icon={Banknote}
          tone={cashPositive ? "emerald" : "rose"}
          delayMs={660}
        />
        <StatCard
          label={`Est. personal tax CY ${currentCY}`}
          value={formatCAD(t1.totalTaxPayableCents)}
          hint={
            t1.totalTaxPayableCents === 0 && t1.totalIncomeCents === 0 ? (
              "No personal-tax activity yet"
            ) : (
              <>
                <span
                  className={
                    t1.refundOrOwingCents > 0 ? "text-rose-400" : "text-emerald-400"
                  }
                >
                  {t1.refundOrOwingCents > 0
                    ? `+${formatCAD(Math.abs(t1.refundOrOwingCents))} owing`
                    : `${formatCAD(Math.abs(t1.refundOrOwingCents))} refund`}
                </span>{" "}
                · marg {(t1Marginal.combinedBps / 100).toFixed(1)}%
              </>
            )
          }
          icon={Calculator}
          tone="rose"
          delayMs={700}
        />
        <StatCard
          label={
            pinnedScenario
              ? `Planner · FY ${currentFY} projected`
              : `Planner · FY ${currentFY}`
          }
          value={
            pinnedScenario
              ? formatCAD(pinnedScenario.takeHomeCents)
              : "—"
          }
          hint={
            pinnedScenario ? (
              <>
                <span className="text-emerald-400">
                  {formatCAD(pinnedScenario.takeHomeCents)}
                </span>{" "}
                take-home ·{" "}
                <span>
                  {formatCAD(pinnedScenario.totalHouseholdTaxCents)} tax
                </span>
                <span className="block text-[10px] text-muted-foreground/80">
                  YTD actual corp tax {formatCAD(t2.totalTaxCents)} · Δ{" "}
                  {formatCAD(
                    Math.abs(pinnedScenario.corpTaxCents - t2.totalTaxCents),
                  )}
                </span>
              </>
            ) : (
              <>
                Pin a scenario on{" "}
                <Link
                  href="/planner"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  /planner
                </Link>{" "}
                to project full-FY tax here
              </>
            )
          }
          icon={Target}
          tone="sky"
          delayMs={740}
        />
        <StatCard
          label={`AAII · SBD grind watcher`}
          value={
            (s?.priorYearAaiiCents ?? 0) === 0
              ? "$0"
              : formatCAD(s?.priorYearAaiiCents ?? 0)
          }
          hint={(() => {
            const aaii = s?.priorYearAaiiCents ?? 0;
            if (aaii === 0)
              return "No passive income. Activates at $50K prior-FY AAII.";
            if (aaii <= 5_000_000)
              return `${formatCAD(5_000_000 - aaii)} to $50K SBD-grind threshold`;
            if (aaii < 15_000_000) {
              const grind = Math.round(
                500_000_00 *
                  Math.min(1, (aaii - 5_000_000) / (15_000_000 - 5_000_000)),
              );
              return (
                <>
                  SBD limit ground by{" "}
                  <span className="text-amber-400">{formatCAD(grind)}</span>
                </>
              );
            }
            return (
              <span className="text-rose-400">SBD fully ground out (AAII ≥ $150K)</span>
            );
          })()}
          icon={PercentIcon}
          tone={(() => {
            const aaii = s?.priorYearAaiiCents ?? 0;
            if (aaii === 0) return "emerald";
            if (aaii <= 5_000_000) return "sky";
            if (aaii < 15_000_000) return "amber";
            return "rose";
          })()}
          delayMs={780}
        />
      </div>

      {/* Quick actions */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Quick actions
          </h2>
          <span className="text-xs text-muted-foreground">Jump straight in</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <QuickActionTile
            href="/invoices"
            label="New invoice"
            description="Bill BMO for the current period"
            icon={FileText}
            tone="emerald"
            delayMs={300}
          />
          <QuickActionTile
            href="/dividends"
            label="Declare dividend"
            description="Pay yourself via T5"
            icon={PiggyBank}
            tone="violet"
            delayMs={360}
          />
          <QuickActionTile
            href="/expenses"
            label="Log expense"
            description="Receipt + HST tracked"
            icon={Receipt}
            tone="rose"
            delayMs={420}
          />
          <QuickActionTile
            href="/hst"
            label="HST return"
            description="Annual filing assist"
            icon={Percent}
            tone="cyan"
            delayMs={480}
          />
          <QuickActionTile
            href="/calendar"
            label="Deadlines"
            description="CRA + Ontario reminders"
            icon={CalendarClock}
            tone="sky"
            delayMs={540}
          />
          <QuickActionTile
            href={`/planner/${currentFY}`}
            label="Self-pay planner"
            description="Simulate salary/div mix"
            icon={Target}
            tone="sky"
            delayMs={570}
          />
          <QuickActionTile
            href="/settings"
            label="Settings"
            description="Corp, brand, contracts"
            icon={Settings}
            tone="indigo"
            delayMs={600}
          />
        </div>
      </section>
    </div>
  );
}

function monthNameShort(isoMonth: string): string {
  const [y, m] = isoMonth.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" }) + " " + String(y).slice(2);
}
