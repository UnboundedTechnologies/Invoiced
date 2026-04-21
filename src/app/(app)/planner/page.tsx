import Link from "next/link";
import { desc } from "drizzle-orm";
import { Target, Pin, ChevronRight } from "lucide-react";
import { db } from "@/lib/db/client";
import { plannerScenarios, t2Returns, invoices } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fiscalYearFor, formatCAD } from "@/lib/utils";
import { isTaxableSupply } from "@/lib/queries/invoice-slices";
import { DeleteScenarioButton } from "@/components/planner/delete-scenario-button";
import { PinScenarioButton } from "@/components/planner/pin-scenario-button";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const [scenarios, returns, invs, s] = await Promise.all([
    db.select().from(plannerScenarios).orderBy(desc(plannerScenarios.fiscalYear), desc(plannerScenarios.isPinned), desc(plannerScenarios.updatedAt)),
    db.select({ fy: t2Returns.fiscalYear }).from(t2Returns),
    db.select({ issueDate: invoices.issueDate, status: invoices.status }).from(invoices),
    getSettings(),
  ]);

  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  // Candidate FYs to offer a simulator for: current FY, any FY with activity, and any FY with a T2 row.
  const fyUniverse = new Set<number>();
  fyUniverse.add(currentFY);
  for (const r of returns) fyUniverse.add(r.fy);
  for (const i of invs) {
    if (!isTaxableSupply(i)) continue;
    fyUniverse.add(fiscalYearFor(i.issueDate, fyeMonth, fyeDay));
  }

  // Group scenarios by FY
  const scenariosByFy = new Map<number, typeof scenarios>();
  for (const row of scenarios) {
    const arr = scenariosByFy.get(row.fiscalYear) ?? [];
    arr.push(row);
    scenariosByFy.set(row.fiscalYear, arr);
  }
  const allFys = [...fyUniverse].sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Self-pay planner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulate salary/dividend mix · Combined corp + personal tax · Pin a scenario to your dashboard
          </p>
        </div>
      </div>

      {scenarios.length === 0 && (
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-inset ring-sky-500/30">
              <Target className="size-6 text-sky-400" />
            </div>
            <CardTitle>No scenarios yet</CardTitle>
            <CardDescription>
              Open a fiscal year below to start simulating. The planner synthesizes a T4 from your chosen salary and runs the real T2 + T1 compute — same engines as /corp-tax and /personal-tax.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      {allFys.map((fy) => {
        const list = scenariosByFy.get(fy) ?? [];
        return (
          <Card key={fy}>
            <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
              <div>
                <CardTitle className="text-base">FY {fy}</CardTitle>
                <CardDescription>
                  {list.length === 0 ? "No scenarios yet" : `${list.length} scenario${list.length === 1 ? "" : "s"}`}
                  {fy === currentFY ? " · current FY" : ""}
                </CardDescription>
              </div>
              <Link
                href={`/planner/${fy}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-400 ring-1 ring-inset ring-sky-500/30 transition-colors hover:bg-sky-500/25"
              >
                <Target className="size-3.5" />
                {list.length === 0 ? "Start simulator" : "Open simulator"}
              </Link>
            </CardHeader>
            {list.length > 0 && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Name</th>
                        <th className="px-4 py-3 text-right font-semibold">Salary</th>
                        <th className="px-4 py-3 text-right font-semibold">Dividends</th>
                        <th className="px-4 py-3 text-right font-semibold">Corp tax</th>
                        <th className="px-4 py-3 text-right font-semibold">Personal tax</th>
                        <th className="px-4 py-3 text-right font-semibold">Take-home</th>
                        <th className="px-2 py-3 sr-only">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((row) => {
                        const totalDiv = row.eligibleDividendCents + row.nonEligibleDividendCents;
                        return (
                          <tr
                            key={row.id}
                            className="border-b border-border/30 transition-colors hover:bg-muted/20"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {row.isPinned && (
                                  <Pin className="size-3.5 shrink-0 text-sky-400" aria-label="Pinned to dashboard" />
                                )}
                                <span className="font-medium">{row.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatCAD(row.salaryCents)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatCAD(totalDiv)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatCAD(row.corpTaxCents)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatCAD(row.personalTaxCents)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-400">{formatCAD(row.takeHomeCents)}</td>
                            <td className="px-2 py-3">
                              <div className="flex items-center gap-1">
                                <PinScenarioButton id={row.id} fiscalYear={row.fiscalYear} isPinned={row.isPinned} />
                                {row.name !== "Custom" && (
                                  <DeleteScenarioButton id={row.id} name={row.name} />
                                )}
                                <Link
                                  href={`/planner/${row.fiscalYear}`}
                                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  aria-label={`Open FY ${row.fiscalYear} simulator`}
                                >
                                  <ChevronRight className="size-4" />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
