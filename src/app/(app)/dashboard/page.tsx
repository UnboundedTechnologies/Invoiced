import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
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

export default async function DashboardPage() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const firstName = s?.directorLegalName?.split(" ")[0] ?? "there";
  const fyEnd = s
    ? `${String(s.fiscalYearEndMonth).padStart(2, "0")}-${String(s.fiscalYearEndDay).padStart(2, "0")}`
    : "12-31";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome back, <span className="text-brand-gradient">{firstName}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s?.corpLegalName} — fiscal year ending {fyEnd}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
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
          hint="Annual filing — next due 2027-04-30"
          icon={Percent}
          tone="rose"
          delayMs={180}
        />
        <StatCard
          label="Self-pay (YTD)"
          value="$0.00"
          hint={
            <>
              Strategy: <span className="font-medium capitalize text-foreground">{s?.paymentStrategy ?? "blend"}</span>
            </>
          }
          icon={Wallet}
          tone="amber"
          delayMs={260}
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
