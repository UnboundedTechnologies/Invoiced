import { db } from "@/lib/db/client";
import { dividends, paycheques, psbChecklistItems, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  CircleDollarSign,
  Percent,
  Wallet,
  FileText,
  Receipt,
  PiggyBank,
  CalendarClock,
  Settings,
} from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { QuickActionTile } from "@/components/quick-action-tile";
import { PsbDashboardBanner } from "@/components/psb/dashboard-banner";
import { computePsbRisk } from "@/lib/psb";
import { fiscalYearFor, formatCAD } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [[s], allDividends, allPaycheques, psbItems] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select().from(dividends),
    db.select().from(paycheques),
    db.select().from(psbChecklistItems),
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

  const calYear = new Date().getUTCFullYear();
  const yearStart = `${calYear}-01-01`;
  const yearEnd = `${calYear}-12-31`;
  const ytdPaycheques = allPaycheques.filter(
    (p) => p.status === "issued" && p.payDate >= yearStart && p.payDate <= yearEnd,
  );
  const salaryYTD = ytdPaycheques.reduce((a, p) => a + p.grossCents, 0);
  const selfPayYTD = salaryYTD + dividendsFYTotal;

  const psb = computePsbRisk(psbItems);

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

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard
          label="YTD revenue"
          value="$0.00"
          hint="No invoices issued yet"
          icon={CircleDollarSign}
          tone="emerald"
          delayMs={100}
        />
        <StatCard
          label="HST collected"
          value="$0.00"
          hint="Annual filing. Next due 2027-04-30"
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
