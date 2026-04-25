import Link from "next/link";
import { FileCheck, ChevronRight, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatLongDate } from "@/lib/utils";
import { listAllSlips, listSlipCandidateYears } from "@/server/actions/slips";

export const dynamic = "force-dynamic";

/** Slip filing deadline: Feb 28 of the year after the tax year. Shifts to the
 *  next weekday when Feb 28 lands on a Saturday or Sunday. */
function slipFilingDueDate(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28)); // Feb 28 of CY+1
  const dow = due.getUTCDay();
  if (dow === 6) due.setUTCDate(due.getUTCDate() + 2); // Sat → Mon
  else if (dow === 0) due.setUTCDate(due.getUTCDate() + 1); // Sun → Mon
  return due.toISOString().slice(0, 10);
}

function daysUntil(iso: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (new Date(iso + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

export default async function SlipsPage() {
  const [allSlips, activityYears] = await Promise.all([
    listAllSlips(),
    listSlipCandidateYears(),
  ]);

  // Group existing (non-void) slips by CY for quick lookup.
  const activeByYear = new Map<number, { t4: boolean; t5: boolean; t4a: boolean }>();
  for (const s of allSlips) {
    if (s.status === "void") continue;
    const entry = activeByYear.get(s.taxYear) ?? { t4: false, t5: false, t4a: false };
    if (s.type === "T4") entry.t4 = true;
    if (s.type === "T5") entry.t5 = true;
    if (s.type === "T4A") entry.t4a = true;
    activeByYear.set(s.taxYear, entry);
  }

  // CYs with activity OR an existing slip (union), newest first.
  const allYearsWithSomething = new Set<number>([
    ...activityYears,
    ...allSlips.map((s) => s.taxYear),
  ]);
  const yearsSorted = [...allYearsWithSomething].sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Year-end slips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            T4 (employment income) + T5 (dividend income) + T4A (loan benefits) · Calendar year · Due Feb 28 of the following year
          </p>
        </div>
      </div>

      {yearsSorted.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30">
              <FileCheck className="size-6 text-indigo-400" />
            </div>
            <CardTitle>No slips yet</CardTitle>
            <CardDescription>
              Year-end slips appear here once you have issued paycheques or paid dividends
              in a calendar year. The app computes T4/T5 box values live; you&rsquo;ll re-key
              them into CRA Web Forms at filing time.
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
                    <th className="px-4 py-3 text-left font-semibold">Calendar year</th>
                    <th className="px-4 py-3 text-left font-semibold">Filing due</th>
                    <th className="px-4 py-3 text-center font-semibold">T4</th>
                    <th className="px-4 py-3 text-center font-semibold">T5</th>
                    <th className="px-4 py-3 text-center font-semibold">T4A</th>
                    <th className="px-4 py-3 text-left font-semibold">Countdown</th>
                    <th className="px-2 py-3 sr-only">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {yearsSorted.map((cy) => {
                    const due = slipFilingDueDate(cy);
                    const daysToDue = daysUntil(due);
                    const hasAny = activeByYear.get(cy);
                    const t4Filed = !!hasAny?.t4;
                    const t5Filed = !!hasAny?.t5;
                    const t4aFiled = !!hasAny?.t4a;
                    const countdownClass =
                      daysToDue < 0
                        ? "text-rose-400"
                        : daysToDue < 60
                          ? "text-amber-400"
                          : "text-muted-foreground";
                    return (
                      <tr
                        key={cy}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3 font-mono text-sm">CY {cy}</td>
                        <td className="px-4 py-3 text-xs">{formatLongDate(due)}</td>
                        <td className="px-4 py-3 text-center">
                          <SlipStatusBadge filed={t4Filed} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <SlipStatusBadge filed={t5Filed} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <SlipStatusBadge filed={t4aFiled} />
                        </td>
                        <td className={`px-4 py-3 text-xs ${countdownClass}`}>
                          {daysToDue < 0 ? `${-daysToDue} days overdue` : `${daysToDue} days`}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/slips/${cy}`}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Open CY ${cy} slip preview`}
                          >
                            <ChevronRight className="size-4" />
                          </Link>
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

      <p className="text-xs text-muted-foreground">
        Working copies only — this app computes the box values and prepares a PDF for
        reference. You file the official T4/T5 slips via CRA Web Forms at canada.ca.
      </p>
    </div>
  );
}

function SlipStatusBadge({ filed }: { filed: boolean }) {
  if (filed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
        <Lock className="size-3" />
        Filed
      </span>
    );
  }
  return (
    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
      Draft
    </span>
  );
}
