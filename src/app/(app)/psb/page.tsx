import { db } from "@/lib/db/client";
import { psbChecklistItems, psbSnapshots } from "@/lib/db/schema";
import { asc, desc } from "drizzle-orm";
import { AlertTriangle, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PsbRiskMeter } from "@/components/psb/risk-meter";
import { PsbChecklistRow } from "@/components/psb/checklist-row";
import { computePsbRisk } from "@/lib/psb";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PsbPage() {
  const [items, snapshots] = await Promise.all([
    db.select().from(psbChecklistItems).orderBy(asc(psbChecklistItems.sortOrder)),
    db.select().from(psbSnapshots).orderBy(desc(psbSnapshots.snapshotDate)).limit(12),
  ]);

  const { score, risk, itemsDone, itemsTotal, criticalMissing } = computePsbRisk(items);

  const topFixes = items
    .filter((i) => i.status !== "done" && i.status !== "not_applicable")
    .sort((a, b) => (b.critical === a.critical ? b.weight - a.weight : b.critical ? 1 : -1))
    .slice(0, 3);

  // Build a trend row from oldest -> newest, reversing the snapshot order
  const trend = [...snapshots].reverse();

  return (
    <div className="space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <h1 className="text-3xl font-bold tracking-tight">PSB risk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal Services Business defensibility. Keep the score green so CRA treats the corp as a real business and not
          an incorporated employee.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PsbRiskMeter
          score={score}
          risk={risk}
          itemsDone={itemsDone}
          itemsTotal={itemsTotal}
          criticalMissing={criticalMissing}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">12-month trend</CardTitle>
            <CardDescription>Snapshot taken on every checklist update.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground">No snapshots yet. Update a checklist item to record one.</p>
            ) : (
              <div className="flex h-16 items-end gap-1">
                {trend.map((s) => {
                  const color =
                    s.risk === "green"
                      ? "bg-emerald-500/70"
                      : s.risk === "amber"
                        ? "bg-amber-500/70"
                        : "bg-rose-500/70";
                  return (
                    <div
                      key={s.id}
                      title={`${s.snapshotDate} · score ${s.score} · ${s.risk}`}
                      className={cn("flex-1 rounded-t-sm", color)}
                      style={{ height: `${Math.max(8, s.score)}%` }}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {topFixes.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-amber-400" />
              <CardTitle className="text-base">Top 3 fixes</CardTitle>
            </div>
            <CardDescription>
              Biggest defensibility wins still open. Tackling these is the fastest path toward green.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {topFixes.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border border-border/40 bg-muted/20 p-3",
                  item.critical && "border-rose-500/40 bg-rose-500/5",
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  {item.critical && <AlertTriangle className="size-3.5 text-rose-400" />}
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Weight {item.weight}
                  </span>
                </div>
                <div className="text-sm font-medium">{item.label}</div>
                {item.description && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.description}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence checklist</CardTitle>
          <CardDescription>
            Click a row to update its status or capture a note. Critical items must be done for a green rating.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item) => (
            <PsbChecklistRow key={item.id} item={item} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
