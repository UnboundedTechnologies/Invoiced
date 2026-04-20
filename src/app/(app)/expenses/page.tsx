import { db } from "@/lib/db/client";
import { expenses } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewExpenseButton } from "@/components/expenses/new-expense-button";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { formatCAD, fiscalYearFor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const [allExpenses, s] = await Promise.all([
    db.select().from(expenses).orderBy(desc(expenses.expenseDate), desc(expenses.createdAt)),
    getSettings(),
  ]);

  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const hstRateBps = s?.hstRateBps ?? 1300;
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = fiscalYearFor(today, fyeMonth, fyeDay);

  const fyRows = allExpenses.filter((e) => e.fiscalYear === currentFY);
  const fySubtotal = fyRows.reduce((a, r) => a + r.subtotalCents, 0);
  const fyHstPaid = fyRows.reduce((a, r) => a + r.hstPaidCents, 0);
  const fyTotal = fyRows.reduce((a, r) => a + r.totalCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            FY {currentFY} · {formatCAD(fyTotal)} total
            {fyTotal > 0 && (
              <>
                {" "}
                (<span className="text-rose-400">{formatCAD(fySubtotal)} deductible</span>
                {" · "}
                <span className="text-amber-400">{formatCAD(fyHstPaid)} ITC recoverable</span>)
              </>
            )}
          </p>
        </div>
        <NewExpenseButton fyeMonth={fyeMonth} fyeDay={fyeDay} hstRateBps={hstRateBps} />
      </div>

      {allExpenses.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-rose-500/15 ring-1 ring-inset ring-rose-500/30">
              <Receipt className="size-6 text-rose-400" />
            </div>
            <CardTitle>No expenses yet</CardTitle>
            <CardDescription>
              Record deductible business expenses to claim HST ITCs and reduce taxable income at year-end.
              Drag-drop receipts to attach photos or PDFs.
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
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                    <th className="px-4 py-3 text-left font-semibold">Category</th>
                    <th className="px-4 py-3 text-center font-semibold">FY</th>
                    <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                    <th className="px-4 py-3 text-right font-semibold">HST</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Receipt</th>
                    <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allExpenses.map((e) => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      fyeMonth={fyeMonth}
                      fyeDay={fyeDay}
                      hstRateBps={hstRateBps}
                    />
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
