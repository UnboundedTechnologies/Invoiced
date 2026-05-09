import Link from "next/link";
import { desc } from "drizzle-orm";
import { Landmark, ChevronRight } from "lucide-react";
import { db } from "@/lib/db/client";
import { t2Returns, invoices } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StartT2ReturnButton } from "@/components/corp-tax/start-return-button";
import { fiscalYearFor, formatCAD, formatLongDate } from "@/lib/utils";
import { hstPeriodFor } from "@/lib/hst";
import { isTaxableSupply } from "@/lib/queries/invoice-slices";
import { t2FilingDueDate } from "@/lib/t2";

export const dynamic = "force-dynamic";

export default async function CorpTaxPage() {
  const [returns, invs, s] = await Promise.all([
    db.select().from(t2Returns).orderBy(desc(t2Returns.fiscalYear)),
    db.select({ issueDate: invoices.issueDate, status: invoices.status }).from(invoices),
    getSettings(),
  ]);

  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  // Candidate FYs: any FY with a taxable supply but no return yet. Always
  // offer the current FY even without invoices so Saïd can seed it day one.
  const invoiceFYs = new Set<number>();
  for (const i of invs) {
    if (!isTaxableSupply(i)) continue;
    invoiceFYs.add(fiscalYearFor(i.issueDate, fyeMonth, fyeDay));
  }
  const existingFYs = new Set(returns.map((r) => r.fiscalYear));
  const candidateFYs = [...invoiceFYs]
    .filter((fy) => !existingFYs.has(fy))
    .sort((a, b) => b - a);
  if (!existingFYs.has(currentFY) && !candidateFYs.includes(currentFY)) {
    candidateFYs.unshift(currentFY);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Corporate tax (T2)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ontario CCPC · Fed 9% SBD + ON blended · Due 6 months after FYE
          </p>
        </div>
      </div>

      {candidateFYs.length > 0 && (
        <Card className="border-indigo-500/30 bg-indigo-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Start a new T2 return</CardTitle>
            <CardDescription>
              These fiscal years have activity but no return yet. Drafts recompute live; filing locks them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {candidateFYs.map((fy) => (
              <StartT2ReturnButton key={fy} fiscalYear={fy} />
            ))}
          </CardContent>
        </Card>
      )}

      {returns.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30">
              <Landmark className="size-6 text-indigo-400" />
            </div>
            <CardTitle>No T2 returns yet</CardTitle>
            <CardDescription>
              Start a return for a fiscal year with activity. Every number is
              computed live from invoices, expenses, paycheques, and dividends
              until you click File. After that the snapshot is frozen and the
              FY's rows are locked from edits.
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
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable income</th>
                    <th className="px-4 py-3 text-right font-semibold">Total tax</th>
                    <th className="px-4 py-3 text-right font-semibold">Div. refund</th>
                    <th className="px-2 py-3 sr-only">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => {
                    const period = hstPeriodFor(r.fiscalYear, fyeMonth, fyeDay);
                    const due = t2FilingDueDate(period.end);
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
                              isFiled
                                ? "rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400"
                                : "rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400"
                            }
                          >
                            {isFiled ? "Filed" : "Draft"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {isFiled && r.taxableIncomeCents !== null
                            ? formatCAD(r.taxableIncomeCents)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {isFiled && r.totalTaxCents !== null
                            ? formatCAD(r.totalTaxCents)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {isFiled && r.dividendRefundCents && r.dividendRefundCents > 0
                            ? `(${formatCAD(r.dividendRefundCents)})`
                            : "—"}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/corp-tax/${r.fiscalYear}`}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Open FY ${r.fiscalYear} T2 return`}
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
