import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { paycheques, remittances } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PaychequeStatusBadge } from "@/components/paycheques/status-badge";
import { PaychequeActions } from "@/components/paycheques/paycheque-actions";
import { formatCAD, formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PaychequeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [paycheque] = await db.select().from(paycheques).where(eq(paycheques.id, id));
  if (!paycheque) notFound();

  const [s, remit] = await Promise.all([
    getSettings(),
    db
      .select()
      .from(remittances)
      .where(
        and(
          eq(remittances.type, "payroll_source_deductions"),
          eq(remittances.periodStart, paycheque.periodStart),
          eq(remittances.periodEnd, paycheque.periodEnd),
        ),
      )
      .limit(1),
  ]);

  const remittance = remit[0];
  const totalDeductions =
    paycheque.cppCents +
    paycheque.cpp2Cents +
    paycheque.eiCents +
    paycheque.federalTaxCents +
    paycheque.provincialTaxCents +
    paycheque.otherDeductionsCents;

  const pct = (cents: number) =>
    paycheque.grossCents === 0 ? "0.0%" : `${((cents / paycheque.grossCents) * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div className="space-y-2">
          <Link
            href="/paycheques"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Back to paycheques
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{formatLongDate(paycheque.payDate)}</h1>
            <PaychequeStatusBadge status={paycheque.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {s?.directorLegalName ?? "Employee"} · Period {formatLongDate(paycheque.periodStart)} → {formatLongDate(paycheque.periodEnd)}
          </p>
        </div>
        <PaychequeActions id={paycheque.id} status={paycheque.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-0">
            {paycheque.pdfBlobUrl ? (
              <iframe
                src={`/api/paycheques/${paycheque.id}/pdf`}
                title={`Pay stub ${paycheque.payDate}`}
                className="h-[860px] w-full rounded-xl border-0"
              />
            ) : (
              <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
                PDF not available.
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
              <CardDescription>CRA T4127 Jan 2026 formulas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SummaryLine label="Pay date" value={formatLongDate(paycheque.payDate)} />
              <SummaryLine
                label="Period"
                value={`${formatLongDate(paycheque.periodStart)} → ${formatLongDate(paycheque.periodEnd)}`}
              />
              <Separator />
              <div className="text-xs">
                <div className="flex items-baseline justify-between">
                  <div className="font-medium text-sm">Gross salary</div>
                  <span className="text-xs text-muted-foreground">100.0%</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                  <span className="text-foreground font-medium">{formatCAD(paycheque.grossCents)}</span>
                </div>
              </div>
              <Separator />
              <SummaryLine
                label="CPP (5.95% stat.)"
                value={`−${formatCAD(paycheque.cppCents)}`}
                effective={pct(paycheque.cppCents)}
              />
              {paycheque.cpp2Cents > 0 && (
                <SummaryLine
                  label="CPP2 (4% stat.)"
                  value={`−${formatCAD(paycheque.cpp2Cents)}`}
                  effective={pct(paycheque.cpp2Cents)}
                />
              )}
              <SummaryLine
                label="EI"
                value={paycheque.eiCents === 0 ? "—" : `−${formatCAD(paycheque.eiCents)}`}
                mutedValue={paycheque.eiCents === 0}
                hint={paycheque.eiCents === 0 ? "owner-manager exempt" : undefined}
              />
              <SummaryLine
                label="Federal tax"
                value={`−${formatCAD(paycheque.federalTaxCents)}`}
                effective={pct(paycheque.federalTaxCents)}
              />
              <SummaryLine
                label="Ontario tax"
                value={`−${formatCAD(paycheque.provincialTaxCents)}`}
                effective={pct(paycheque.provincialTaxCents)}
              />
              {paycheque.otherDeductionsCents > 0 && (
                <SummaryLine
                  label="Other"
                  value={`−${formatCAD(paycheque.otherDeductionsCents)}`}
                  effective={pct(paycheque.otherDeductionsCents)}
                />
              )}
              <SummaryLine
                label="Total deductions"
                value={`−${formatCAD(totalDeductions)}`}
                effective={pct(totalDeductions)}
                strong
              />
              <div className="flex items-end justify-between border-t border-border/60 pt-3">
                <div className="space-y-0.5">
                  <div className="text-sm text-muted-foreground">Net pay</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {pct(paycheque.netCents)} of gross (take-home)
                  </div>
                </div>
                <span className="text-2xl font-bold text-brand-gradient">{formatCAD(paycheque.netCents)}</span>
              </div>
              <Separator />
              <div className="rounded-md bg-amber-500/10 p-2 text-[11px]">
                <div className="text-muted-foreground">CRA remittance</div>
                <div className="mt-1 font-medium text-amber-300">
                  {formatCAD(paycheque.totalRemittanceCents)}
                </div>
                {remittance && (
                  <div className="mt-1 text-muted-foreground">
                    Due {formatLongDate(remittance.dueDate)}
                    {remittance.paidAt ? (
                      <span className="ml-1 text-emerald-400">· paid</span>
                    ) : (
                      <span className="ml-1 text-amber-400">· open</span>
                    )}
                  </div>
                )}
                <div className="mt-1 text-muted-foreground">
                  Employee CPP {formatCAD(paycheque.cppCents + paycheque.cpp2Cents)} + Employer CPP{" "}
                  {formatCAD(paycheque.employerCppCents + paycheque.employerCpp2Cents)} + Fed/ON tax{" "}
                  {formatCAD(paycheque.federalTaxCents + paycheque.provincialTaxCents)}
                </div>
              </div>
              {paycheque.notes && (
                <>
                  <Separator />
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</div>
                    <div className="mt-1 whitespace-pre-line text-xs">{paycheque.notes}</div>
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

function SummaryLine({
  label,
  value,
  hint,
  effective,
  mutedValue,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  effective?: string;
  mutedValue?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between text-sm ${strong ? "border-t border-border/40 pt-2" : ""}`}>
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-[10px] italic">({hint})</span>}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={mutedValue ? "text-muted-foreground" : strong ? "font-semibold" : "font-medium"}>
          {value}
        </span>
        {effective && <span className="text-[10px] text-muted-foreground">({effective})</span>}
      </span>
    </div>
  );
}
