import { db } from "@/lib/db/client";
import {
  dividends,
  invoices,
  paycheques,
  psbChecklistItems,
  shareholderLoanEntries,
  prescribedRatePeriods,
} from "@/lib/db/schema";
import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
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
} from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { QuickActionTile } from "@/components/quick-action-tile";
import { PsbDashboardBanner } from "@/components/psb/dashboard-banner";
import { LoanRiskBanner } from "@/components/shareholder-loan/risk-banner";
import { computePsbRisk } from "@/lib/psb";
import { computeLoanTimeline, type LoanEntry, type RatePeriod } from "@/lib/shareholder-loan";
import { fiscalYearFor, formatCAD } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const calYear = new Date().getUTCFullYear();
  const yearStart = `${calYear}-01-01`;
  const yearEnd = `${calYear}-12-31`;

  const [
    s,
    allDividends,
    allPaycheques,
    psbItems,
    loanEntriesRaw,
    rateRows,
    invoiceTotals,
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
    // YTD revenue + HST aggregates — accrual basis, i.e. invoices that have
    // been issued (sent/paid/overdue), excluding drafts and voids.
    db
      .select({
        subtotal: sql<number>`COALESCE(SUM(${invoices.subtotalCents}), 0)`,
        hst: sql<number>`COALESCE(SUM(${invoices.hstCents}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, ["sent", "paid", "overdue"]),
          gte(invoices.issueDate, yearStart),
          lte(invoices.issueDate, yearEnd),
        ),
      ),
  ]);
  const firstName = s?.directorLegalName?.split(" ")[0] ?? "there";
  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const fyEnd = `${String(fyeMonth).padStart(2, "0")}-${String(fyeDay).padStart(2, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);
  const fyDividends = allDividends.filter((d) => d.fiscalYear === currentFY);
  const dividendsFYTotal = fyDividends.reduce((a, d) => a + d.amountCents, 0);
  const eligibleTotal = fyDividends.filter((d) => d.eligible).reduce((a, d) => a + d.amountCents, 0);
  const nonEligibleTotal = dividendsFYTotal - eligibleTotal;

  const ytdPaycheques = allPaycheques.filter(
    (p) => p.status === "issued" && p.payDate >= yearStart && p.payDate <= yearEnd,
  );
  const salaryYTD = ytdPaycheques.reduce((a, p) => a + p.grossCents, 0);
  const selfPayYTD = salaryYTD + dividendsFYTotal;

  // SQL COALESCE returns 0 for empty sets; Number() is belt-and-suspenders
  // in case the driver returns bigint-as-string for the SUM.
  const ytdRevenueCents = Number(invoiceTotals[0]?.subtotal ?? 0);
  const ytdHstCents = Number(invoiceTotals[0]?.hst ?? 0);
  const ytdInvoiceCount = Number(invoiceTotals[0]?.count ?? 0);

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

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard
          label="YTD revenue"
          value={formatCAD(ytdRevenueCents)}
          hint={
            ytdInvoiceCount === 0
              ? "No invoices issued yet"
              : `${ytdInvoiceCount} invoice${ytdInvoiceCount === 1 ? "" : "s"} issued in ${calYear}`
          }
          icon={CircleDollarSign}
          tone="emerald"
          delayMs={100}
        />
        <StatCard
          label="HST collected"
          value={formatCAD(ytdHstCents)}
          hint={
            ytdHstCents === 0
              ? "Annual filing. Next due 2027-04-30"
              : `${calYear} HST collected — annual filing due ${calYear + 1}-04-30`
          }
          icon={Percent}
          tone="rose"
          delayMs={180}
        />
        <StatCard
          label="Self-pay (YTD)"
          value={formatCAD(selfPayYTD)}
          hint={
            <>
              <span className="text-amber-400">{formatCAD(salaryYTD)} salary</span>
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
