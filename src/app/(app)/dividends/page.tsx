import { db } from "@/lib/db/client";
import { dividends, settings } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { PiggyBank } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewDividendButton } from "@/components/dividends/new-dividend-button";
import { DividendRow } from "@/components/dividends/dividend-row";
import { formatCAD, fiscalYearFor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const [allDividends, settingsRows] = await Promise.all([
    db.select().from(dividends).orderBy(desc(dividends.declaredDate), desc(dividends.createdAt)),
    db.select().from(settings).where(eq(settings.id, 1)),
  ]);
  const s = settingsRows[0];
  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  const fyRows = allDividends.filter((d) => d.fiscalYear === currentFY);
  const eligibleFY = fyRows.filter((r) => r.eligible).reduce((a, r) => a + r.amountCents, 0);
  const nonEligibleFY = fyRows.filter((r) => !r.eligible).reduce((a, r) => a + r.amountCents, 0);
  const totalFY = eligibleFY + nonEligibleFY;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dividends (T5)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            FY {currentFY} · {formatCAD(totalFY)} total
            {totalFY > 0 && (
              <>
                {" "}
                (<span className="text-emerald-400">{formatCAD(eligibleFY)} eligible</span>
                {" · "}
                <span className="text-violet-400">{formatCAD(nonEligibleFY)} non-eligible</span>)
              </>
            )}
          </p>
        </div>
        <NewDividendButton fyeMonth={fyeMonth} fyeDay={fyeDay} />
      </div>

      {allDividends.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-inset ring-violet-500/30">
              <PiggyBank className="size-6 text-violet-400" />
            </div>
            <CardTitle>No dividends declared yet</CardTitle>
            <CardDescription>
              Record a T5 dividend paid out of retained earnings. Slip PDFs get generated at year-end.
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
                    <th className="px-4 py-3 text-left font-semibold">Declared</th>
                    <th className="px-4 py-3 text-left font-semibold">Paid</th>
                    <th className="px-4 py-3 text-center font-semibold">Type</th>
                    <th className="px-4 py-3 text-center font-semibold">FY</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allDividends.map((d) => (
                    <DividendRow key={d.id} dividend={d} fyeMonth={fyeMonth} fyeDay={fyeDay} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
