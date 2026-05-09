import Link from "next/link";
import { Calculator, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StartT1ReturnButton } from "@/components/personal-tax/start-return-button";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { listT1Returns, listTaxYearsWithActivity } from "@/server/actions/t1";
import { t1FilingDueDate } from "@/lib/t1";

export const dynamic = "force-dynamic";

export default async function PersonalTaxPage() {
  const [returns, activityYears] = await Promise.all([
    listT1Returns(),
    listTaxYearsWithActivity(),
  ]);

  const currentCY = new Date().getUTCFullYear();
  const existingCYs = new Set(returns.map((r) => r.taxYear));
  const candidateCYs = activityYears
    .filter((y) => !existingCYs.has(y))
    .sort((a, b) => b - a);
  if (!existingCYs.has(currentCY) && !candidateCYs.includes(currentCY)) {
    candidateCYs.unshift(currentCY);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personal tax (T1)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ontario resident · Calendar year · Due April 30 of the following year
          </p>
        </div>
      </div>

      {candidateCYs.length > 0 && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Start a new T1 return</CardTitle>
            <CardDescription>
              These calendar years have activity (paycheques, dividends, or shareholder-loan entries) but no return yet. Drafts recompute live; filing locks them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {candidateCYs.map((cy) => (
              <StartT1ReturnButton key={cy} taxYear={cy} />
            ))}
          </CardContent>
        </Card>
      )}

      {returns.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-rose-500/15 ring-1 ring-inset ring-rose-500/30">
              <Calculator className="size-6 text-rose-400" />
            </div>
            <CardTitle>No T1 returns yet</CardTitle>
            <CardDescription>
              Start a return for a calendar year with personal-tax activity. Every
              number is computed live from paycheques, dividends, and the shareholder-
              loan ledger until you click File. After that the snapshot is frozen and
              the CY&rsquo;s rows are locked from edits.
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
                    <th className="px-4 py-3 text-left font-semibold">Due</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Total income</th>
                    <th className="px-4 py-3 text-right font-semibold">Total tax</th>
                    <th className="px-4 py-3 text-right font-semibold">Refund / owing</th>
                    <th className="px-2 py-3 sr-only">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => {
                    const due = t1FilingDueDate(r.taxYear);
                    const isFiled = r.status === "filed";
                    const owing = (r.refundOrOwingCents ?? 0) > 0;
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3 font-mono text-sm">CY {r.taxYear}</td>
                        <td className="px-4 py-3 text-xs">{formatLongDate(due)}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={
                              isFiled
                                ? "rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400"
                                : "rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400"
                            }
                          >
                            {isFiled ? "Filed" : "Draft"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {isFiled && r.totalIncomeCents !== null
                            ? formatCAD(r.totalIncomeCents)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {isFiled && r.totalTaxPayableCents !== null
                            ? formatCAD(r.totalTaxPayableCents)
                            : "—"}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono text-xs ${
                            isFiled && owing ? "text-rose-400" : isFiled ? "text-emerald-400" : ""
                          }`}
                        >
                          {isFiled && r.refundOrOwingCents !== null
                            ? (owing ? "+" : "−") + formatCAD(Math.abs(r.refundOrOwingCents))
                            : "—"}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/personal-tax/${r.taxYear}`}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Open CY ${r.taxYear} T1 return`}
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
    </div>
  );
}
