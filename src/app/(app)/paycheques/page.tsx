import Link from "next/link";
import { db } from "@/lib/db/client";
import { paycheques, remittances } from "@/lib/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getSettings } from "@/lib/db/queries";
import { BadgeDollarSign, Lock, Shield } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NewPaychequeButton } from "@/components/paycheques/new-paycheque-button";
import { PaychequeStatusBadge } from "@/components/paycheques/status-badge";
import { DeletePaychequeButton } from "@/components/paycheques/delete-paycheque-button";
import { RemittanceRow } from "@/components/paycheques/remittance-row";
import { formatCAD } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PaychequesPage() {
  const s = await getSettings();

  if (!s?.payrollAccountActive) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Paycheques (T4)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Salary flows require an active payroll account (RP0001).
          </p>
        </div>
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-inset ring-amber-500/30">
              <Lock className="size-6 text-amber-400" />
            </div>
            <CardTitle>Payroll not activated</CardTitle>
            <CardDescription className="max-w-md">
              Register with CRA (BN RP0001) and activate it in Settings before creating paycheques.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild variant="brand">
              <Link href="/settings">Open Settings → Payroll</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [allPaycheques, openRemittances] = await Promise.all([
    db.select().from(paycheques).orderBy(desc(paycheques.payDate), desc(paycheques.createdAt)),
    db
      .select()
      .from(remittances)
      .where(
        and(
          eq(remittances.type, "payroll_source_deductions"),
          gte(remittances.dueDate, yearStart),
          lte(remittances.dueDate, yearEnd),
        ),
      )
      .orderBy(desc(remittances.dueDate)),
  ]);

  const ytd = allPaycheques.filter(
    (p) => p.status === "issued" && p.payDate >= yearStart && p.payDate <= yearEnd,
  );
  const ytdGross = ytd.reduce((a, p) => a + p.grossCents, 0);
  const ytdNet = ytd.reduce((a, p) => a + p.netCents, 0);
  const ytdCpp = ytd.reduce((a, p) => a + p.cppCents, 0);
  const ytdCpp2 = ytd.reduce((a, p) => a + p.cpp2Cents, 0);
  const ytdRemit = ytd.reduce((a, p) => a + p.totalRemittanceCents, 0);
  const unpaidRemit = openRemittances
    .filter((r) => !r.paidAt)
    .reduce((a, r) => a + r.amountCents, 0);

  const targetAnnualCents = s.targetAnnualSalaryCents ?? 0;
  const remainingTarget = Math.max(0, targetAnnualCents - ytdGross);
  const defaultGrossDollars =
    targetAnnualCents > 0
      ? Math.max(1, Math.round(remainingTarget / Math.max(1, 12 - ytd.length) / 100))
      : 5942;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Paycheques (T4)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            YTD {year} · Gross {formatCAD(ytdGross)} · Net {formatCAD(ytdNet)} · Remittances {formatCAD(ytdRemit)}{" "}
            ({formatCAD(unpaidRemit)} open)
          </p>
        </div>
        <NewPaychequeButton
          cadence={s.payCadence}
          ytdCppCents={ytdCpp}
          ytdCpp2Cents={ytdCpp2}
          ytdGrossCents={ytdGross}
          defaultGrossDollars={defaultGrossDollars}
        />
      </div>

      <div className="flex items-start gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-300/90">
        <Shield className="mt-0.5 size-4 shrink-0 text-sky-400" />
        <div>
          Paying yourself salary when PSB risk is red can backfire — if reassessed, only salary-to-incorporated-employee
          is deductible, and every other deduction you took gets clawed back.{" "}
          <Link href="/psb" className="underline hover:text-sky-200">
            Check your PSB score
          </Link>{" "}
          before issuing.
        </div>
      </div>

      {allPaycheques.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-inset ring-amber-500/30">
              <BadgeDollarSign className="size-6 text-amber-400" />
            </div>
            <CardTitle>No paycheques yet</CardTitle>
            <CardDescription>
              Issue your first pay run. Deductions compute per CRA T4127 (Jan 2026); stub and remittance are generated
              automatically.
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
                    <th className="px-4 py-3 text-left font-semibold">Pay date</th>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-right font-semibold">Gross</th>
                    <th className="px-4 py-3 text-right font-semibold">Deductions</th>
                    <th className="px-4 py-3 text-right font-semibold">Net</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allPaycheques.map((p) => {
                    const totalDeductions =
                      p.cppCents +
                      p.cpp2Cents +
                      p.federalTaxCents +
                      p.provincialTaxCents +
                      p.otherDeductionsCents;
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/paycheques/${p.id}`}
                            className="font-mono font-medium text-primary hover:underline"
                          >
                            {p.payDate}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {p.periodStart} → {p.periodEnd}
                        </td>
                        <td className="px-4 py-3 text-right">{formatCAD(p.grossCents)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          −{formatCAD(totalDeductions)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatCAD(p.netCents)}</td>
                        <td className="px-4 py-3 text-center">
                          <PaychequeStatusBadge status={p.status} />
                        </td>
                        <td className="px-2 py-3 text-right">
                          {p.status === "draft" && (
                            <DeletePaychequeButton id={p.id} payDate={p.payDate} />
                          )}
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

      {openRemittances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source-deduction remittances</CardTitle>
            <CardDescription>
              Due 15th of the month after the pay period. Paying late triggers a 10% CRA penalty (20% on the
              second late within the same year).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-left font-semibold">Due</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openRemittances.map((r) => (
                    <RemittanceRow key={r.id} remittance={r} />
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
