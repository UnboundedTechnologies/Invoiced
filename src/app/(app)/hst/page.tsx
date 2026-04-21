import Link from "next/link";
import { desc } from "drizzle-orm";
import { FileText, ChevronRight } from "lucide-react";
import { db } from "@/lib/db/client";
import { hstReturns, invoices } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StartReturnButton } from "@/components/hst/start-return-button";
import {
  fiscalYearFor,
  formatCAD,
  formatLongDate,
} from "@/lib/utils";
import { hstFilingDueDate, hstPeriodFor } from "@/lib/hst";
import { isTaxableSupply } from "@/lib/queries/invoice-slices";

export const dynamic = "force-dynamic";

export default async function HstPage() {
  const [returns, invs, s] = await Promise.all([
    db.select().from(hstReturns).orderBy(desc(hstReturns.fiscalYear)),
    db.select({ issueDate: invoices.issueDate, status: invoices.status }).from(invoices),
    getSettings(),
  ]);

  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  // Every FY that has at least one taxable supply → candidate for a return.
  // Shared predicate with the aggregator.
  const invoiceFYs = new Set<number>();
  for (const i of invs) {
    if (!isTaxableSupply(i)) continue;
    invoiceFYs.add(fiscalYearFor(i.issueDate, fyeMonth, fyeDay));
  }
  const existingFYs = new Set(returns.map((r) => r.fiscalYear));
  const candidateFYs = [...invoiceFYs]
    .filter((fy) => !existingFYs.has(fy))
    .sort((a, b) => b - a);

  // Always offer the current FY if no return exists for it yet, even if
  // there's no invoice yet — lets Saïd set up the period as soon as Jan 1.
  if (!existingFYs.has(currentFY) && !candidateFYs.includes(currentFY)) {
    candidateFYs.unshift(currentFY);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">HST returns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual filer · Due March 31 following each fiscal year end
          </p>
        </div>
      </div>

      {candidateFYs.length > 0 && (
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Start a new return</CardTitle>
            <CardDescription>
              These fiscal years have invoice activity but no return yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {candidateFYs.map((fy) => (
              <StartReturnButton key={fy} fiscalYear={fy} variant="outline" />
            ))}
          </CardContent>
        </Card>
      )}

      {returns.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-inset ring-cyan-500/30">
              <FileText className="size-6 text-cyan-400" />
            </div>
            <CardTitle>No HST returns yet</CardTitle>
            <CardDescription>
              Start a return for a fiscal year with invoice activity. The regular and Quick
              Method are computed side-by-side so you can pick before filing.
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
                    <th className="px-4 py-3 text-left font-semibold">Fiscal year</th>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-left font-semibold">Due</th>
                    <th className="px-4 py-3 text-center font-semibold">Method</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Net tax (L109)</th>
                    <th className="px-2 py-3 sr-only">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => {
                    const period = hstPeriodFor(r.fiscalYear, fyeMonth, fyeDay);
                    const due = hstFilingDueDate(period.end);
                    const isFiled = r.status === "filed";
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3 font-mono text-sm">FY {r.fiscalYear}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatLongDate(period.start)} – {formatLongDate(period.end)}
                        </td>
                        <td className="px-4 py-3 text-xs">{formatLongDate(due)}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={
                              r.method === "quick"
                                ? "rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-400"
                                : "rounded-md bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300"
                            }
                          >
                            {r.method === "quick" ? "Quick" : "Regular"}
                          </span>
                        </td>
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
                          {isFiled && r.line109Cents !== null
                            ? formatCAD(r.line109Cents)
                            : "—"}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/hst/${r.fiscalYear}`}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Open FY ${r.fiscalYear} return`}
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
