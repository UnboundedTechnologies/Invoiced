import Link from "next/link";
import { db } from "@/lib/db/client";
import { invoices, contracts, clients } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/invoices/status-badge";
import { DeleteInvoiceButton } from "@/components/invoices/delete-invoice-button";
import { getSettings } from "@/lib/db/queries";
import { fiscalYearFor, formatCAD } from "@/lib/utils";
import { hstPeriodFor } from "@/lib/hst";
import { isTaxableSupplyInPeriod } from "@/lib/queries/invoice-slices";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [rows, s] = await Promise.all([
    db
      .select({ invoice: invoices, contract: contracts, client: clients })
      .from(invoices)
      .innerJoin(contracts, eq(contracts.id, invoices.contractId))
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .orderBy(desc(invoices.issueDate), desc(invoices.invoiceNumber)),
    getSettings(),
  ]);

  const fyeMonth = s?.fiscalYearEndMonth ?? 12;
  const fyeDay = s?.fiscalYearEndDay ?? 31;
  const currentFY = fiscalYearFor(new Date().toISOString().slice(0, 10), fyeMonth, fyeDay);
  const fyPeriod = hstPeriodFor(currentFY, fyeMonth, fyeDay);
  // Revenue = issued invoices via the shared predicate. Matches every other
  // page that shows a FY revenue number.
  const fyRevenueCents = rows
    .filter((r) => isTaxableSupplyInPeriod(r.invoice, fyPeriod))
    .reduce((acc, r) => acc + r.invoice.subtotalCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} total · FY {currentFY} revenue {formatCAD(fyRevenueCents)}
          </p>
        </div>
        <Button asChild variant="brand" className="gap-1.5">
          <Link href="/invoices/new">
            <Plus className="size-4" />
            New invoice
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
              <FileText className="size-6 text-emerald-400" />
            </div>
            <CardTitle>No invoices yet</CardTitle>
            <CardDescription>Generate your first invoice to start tracking revenue.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild variant="brand">
              <Link href="/invoices/new">
                <Plus className="size-4" />
                Create invoice
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Number</th>
                    <th className="px-4 py-3 text-left font-semibold">Client</th>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-left font-semibold">Issued</th>
                    <th className="px-4 py-3 text-left font-semibold">Due</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ invoice, client }) => (
                    <tr
                      key={invoice.id}
                      className="border-b border-border/30 transition-colors hover:bg-muted/20"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-mono font-medium text-primary hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{client.legalName}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {invoice.periodStart} → {invoice.periodEnd}
                      </td>
                      <td className="px-4 py-3 text-xs">{invoice.issueDate}</td>
                      <td className="px-4 py-3 text-xs">{invoice.dueDate}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCAD(invoice.totalCents)}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={invoice.status} />
                      </td>
                      <td className="px-2 py-3 text-right">
                        {invoice.status === "draft" && (
                          <DeleteInvoiceButton id={invoice.id} invoiceNumber={invoice.invoiceNumber} version={invoice.version} />
                        )}
                      </td>
                    </tr>
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
