import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { invoices, invoiceLines, contracts, clients } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/invoices/status-badge";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { formatCAD, formatLongDate, paymentTermsLabel, pluralizeUnit } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ invoice: invoices, contract: contracts, client: clients })
    .from(invoices)
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .where(eq(invoices.id, id));

  if (!row) notFound();

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.sortOrder));

  const { invoice, contract, client } = row;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div className="space-y-2">
          <Link
            href="/invoices"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Back to invoices
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight font-mono">{invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {client.legalName} · Issued {formatLongDate(invoice.issueDate)} · Due {formatLongDate(invoice.dueDate)}
          </p>
        </div>
        <InvoiceActions id={invoice.id} status={invoice.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-0">
            <iframe
              src={`/api/invoices/${invoice.id}/pdf`}
              title={`Invoice ${invoice.invoiceNumber}`}
              className="h-[860px] w-full rounded-xl border-0"
            />
          </CardContent>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
              <CardDescription>{contract.label || "Contract"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SummaryLine label="Service period" value={`${formatLongDate(invoice.periodStart)} → ${formatLongDate(invoice.periodEnd)}`} />
              <SummaryLine label="Payment terms" value={paymentTermsLabel(contract.paymentTerms)} />
              {contract.reference && <SummaryLine label="PO / Ref" value={contract.reference} mono />}
              <Separator />
              {lines.map((l) => (
                <div key={l.id} className="text-xs">
                  <div className="font-medium text-sm">{l.description}</div>
                  <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                    <span>
                      {(l.quantity / 100).toLocaleString("en-CA", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {pluralizeUnit(l.quantity / 100, contract.rateUnit)} × {formatCAD(l.rateCents)}
                    </span>
                    <span className="font-medium text-foreground">{formatCAD(l.amountCents)}</span>
                  </div>
                </div>
              ))}
              <Separator />
              <SummaryLine label="Subtotal" value={formatCAD(invoice.subtotalCents)} />
              <SummaryLine label="HST" value={formatCAD(invoice.hstCents)} />
              <div className="flex items-end justify-between border-t border-border/60 pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-bold text-brand-gradient">{formatCAD(invoice.totalCents)} {invoice.currency}</span>
              </div>
              {invoice.notes && (
                <>
                  <Separator />
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</div>
                    <div className="mt-1 whitespace-pre-line text-xs">{invoice.notes}</div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SummaryLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>
    </div>
  );
}
