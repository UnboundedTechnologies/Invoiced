import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ChevronLeft, Target } from "lucide-react";
import { db } from "@/lib/db/client";
import { plannerScenarios, psbSnapshots, t2Returns, dividends } from "@/lib/db/schema";
import { and } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  loadBaseline,
  upsertDraftScenario,
} from "@/server/actions/planner";
import { ScenarioSimulator } from "@/components/planner/scenario-simulator";
import { HoldcoCountdownCard } from "@/components/planner/holdco-countdown-card";
import { PsbWarningBanner } from "@/components/planner/psb-warning-banner";
import { formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlannerDetailPage({
  params,
}: {
  params: Promise<{ fiscalYear: string }>;
}) {
  const { fiscalYear: fyParam } = await params;
  const fiscalYear = parseInt(fyParam, 10);
  if (!Number.isFinite(fiscalYear)) notFound();

  const s = await getSettings();
  if (!s) notFound();

  // Ensure a Custom draft exists so the URL is addressable
  await upsertDraftScenario(fiscalYear);

  // Parallel reads: baseline, saved scenarios for this FY, latest PSB snapshot,
  // filed T2 net-after-tax + all dividends declared to date (for Holdco card).
  const [baseline, scenarios, psbRows, filedT2s, allDivs] = await Promise.all([
    loadBaseline(fiscalYear),
    db
      .select()
      .from(plannerScenarios)
      .where(eq(plannerScenarios.fiscalYear, fiscalYear))
      .orderBy(desc(plannerScenarios.isPinned), desc(plannerScenarios.updatedAt)),
    db.select().from(psbSnapshots).orderBy(desc(psbSnapshots.snapshotDate)).limit(1),
    db
      .select({
        netIncomeForTaxCents: t2Returns.netIncomeForTaxCents,
        totalTaxCents: t2Returns.totalTaxCents,
      })
      .from(t2Returns)
      .where(eq(t2Returns.status, "filed")),
    db.select({ amountCents: dividends.amountCents }).from(dividends),
  ]);

  const psbRisk: "green" | "amber" | "red" | undefined =
    (psbRows[0]?.risk as "green" | "amber" | "red" | undefined) ?? undefined;

  // Retained earnings: opening + Σ(filed T2 net-after-tax) − Σ(dividends declared).
  // Dividends key on declaration (GAAP alignment) — they're already recorded as they flow.
  const retainedEarningsCents =
    s.openingRetainedEarningsCents +
    filedT2s.reduce(
      (a, t) => a + ((t.netIncomeForTaxCents ?? 0) - (t.totalTaxCents ?? 0)),
      0,
    ) -
    allDivs.reduce((a, d) => a + d.amountCents, 0);
  // Suppress unused-import warning
  void and;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-500">
        <Link
          href="/planner"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          All scenarios
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Self-pay planner · FY {fiscalYear}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatLongDate(baseline.periodStart)} – {formatLongDate(baseline.periodEnd)} ·
              Simulate salary/dividend mix with live corp + personal tax
            </p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-inset ring-sky-500/30">
            <Target className="size-5 text-sky-400" />
          </div>
        </div>
      </div>

      {/* PSB banner — audit risk pass-through */}
      {psbRisk === "red" || psbRisk === "amber" ? (
        <PsbWarningBanner risk={psbRisk} />
      ) : null}

      {/* The simulator — all slider state + live compute client-side */}
      <ScenarioSimulator
        fiscalYear={fiscalYear}
        baseline={baseline}
        openingGripCents={baseline.openingGripCents}
        priorYearAaiiCents={baseline.priorYearAaiiCents}
        savedScenarios={scenarios}
        psbRisk={psbRisk}
      />

      {/* Saved scenarios list */}
      {scenarios.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Saved scenarios · FY {fiscalYear}</CardTitle>
            <CardDescription>
              Pin a scenario to surface it on the dashboard. Snapshots store inputs + computed outputs at save time; the Custom sandbox cannot be deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-right font-semibold">Salary</th>
                    <th className="px-4 py-3 text-right font-semibold">Dividends</th>
                    <th className="px-4 py-3 text-right font-semibold">Total tax</th>
                    <th className="px-4 py-3 text-right font-semibold">Take-home</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((row) => {
                    const totalDiv =
                      row.eligibleDividendCents + row.nonEligibleDividendCents;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {row.isPinned && (
                              <span
                                className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400 ring-1 ring-inset ring-sky-500/30"
                                aria-label="Pinned to dashboard"
                              >
                                Pinned
                              </span>
                            )}
                            <span className="font-medium">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          ${(row.salaryCents / 100).toLocaleString("en-CA")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          ${(totalDiv / 100).toLocaleString("en-CA")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          ${(row.totalHouseholdTaxCents / 100).toLocaleString("en-CA")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-400">
                          ${(row.takeHomeCents / 100).toLocaleString("en-CA")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Holdco / QSBC countdown — informational only */}
      <HoldcoCountdownCard
        incorporationDate={s.incorporationDate}
        retainedEarningsCents={retainedEarningsCents}
      />
    </div>
  );
}
