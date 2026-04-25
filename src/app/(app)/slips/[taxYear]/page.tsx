import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  AlertTriangle,
  Lock,
  FileCheck,
  ArrowRight,
  Info,
} from "lucide-react";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadSlipPreview } from "@/server/actions/slips";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { CPP_YMPE_2026 } from "@/lib/payroll-2026";
import type { T4ASlipBoxes, T4SlipBoxes, T5SlipBoxes } from "@/lib/slip-boxes";
import type { Slip } from "@/lib/db/schema";
import { SlipActionsMenu } from "@/components/slips/slip-actions-menu";

export const dynamic = "force-dynamic";

function BoxRow({
  box,
  label,
  amount,
  muted = false,
  strong = false,
}: {
  box?: string;
  label: string;
  amount: number;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-sm ${
        strong ? "border-t border-border/60 font-semibold" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {box ? (
          <span className="inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-300">
            {box}
          </span>
        ) : null}
        <span
          className={
            muted
              ? "text-muted-foreground/70"
              : strong
                ? "text-foreground"
                : "text-muted-foreground"
          }
        >
          {label}
        </span>
      </div>
      <span className={`font-mono ${strong ? "text-foreground" : ""} ${muted ? "text-muted-foreground/70" : ""}`}>
        {formatCAD(amount)}
      </span>
    </div>
  );
}

function slipFilingDueDate(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28));
  const dow = due.getUTCDay();
  if (dow === 6) due.setUTCDate(due.getUTCDate() + 2);
  else if (dow === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

export default async function SlipPreviewPage({
  params,
}: {
  params: Promise<{ taxYear: string }>;
}) {
  const { taxYear: tyParam } = await params;
  const taxYear = parseInt(tyParam, 10);
  if (!Number.isFinite(taxYear)) notFound();

  const [s, preview] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)).then((rows) => rows[0]),
    loadSlipPreview(taxYear),
  ]);
  if (!s) notFound();

  const due = slipFilingDueDate(taxYear);
  const today = new Date().toISOString().slice(0, 10);
  const daysToDue = Math.round(
    (new Date(due + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) /
      86_400_000,
  );

  const t4 = preview.t4;
  const t5 = preview.t5;
  const t4a = preview.t4a;
  const t4Filed = preview.existing.t4?.status === "filed";
  const t5Filed = preview.existing.t5?.status === "filed";
  const t4aFiled = preview.existing.t4a?.status === "filed";
  const t4Voided = preview.existing.t4?.status === "void";
  const t5Voided = preview.existing.t5?.status === "void";
  const t4aVoided = preview.existing.t4a?.status === "void";

  // Preflight warnings
  const warnings: string[] = [];
  if (t4.paychequeCount > 0 && !s.payrollAccount) {
    warnings.push("No payroll RP account set in Settings — T4 cannot reference the payer.");
  }
  if (t5.eligible.count + t5.nonEligible.count > 0 && !s.payerRzActive) {
    warnings.push("Payer RZ account not registered/active in Settings — T5 filing blocked. Register your RZ account at canada.ca, then enable it under Settings → Corporation.");
  }
  if (t4.box14EmploymentIncomeCents > CPP_YMPE_2026 * 100) {
    warnings.push(`Box 14 (${formatCAD(t4.box14EmploymentIncomeCents)}) exceeds 2026 YMPE (${formatCAD(CPP_YMPE_2026 * 100)}) — Box 26 pensionable earnings may need manual capping.`);
  }
  if (t4.box18EiCents !== 0 || t4.box24EiInsurableCents !== 0) {
    warnings.push("Owner-manager EI boxes (18 / 24) must be 0 — non-zero detected. Investigate payroll math.");
  }
  if (
    t5.eligible.count + t5.nonEligible.count > 0 &&
    t5.totals.actualCents < 50_00
  ) {
    warnings.push("Total dividends to recipient are under $50 — T5 slip is technically optional, but filing is recommended for completeness.");
  }
  if (t4a.box117Cents > 0 && !s.payerRzActive) {
    warnings.push("Payer RZ account not registered/active in Settings — T4A filing blocked. Register your RZ account at canada.ca, then enable it under Settings → Corporation.");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-500">
        <Link
          href="/slips"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Year-end slips
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              Slips · CY {taxYear}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Jan 1 – Dec 31 · Filing due {formatLongDate(due)}
              {" "}
              ·{" "}
              <span
                className={
                  daysToDue < 0
                    ? "text-rose-400"
                    : daysToDue < 60
                      ? "text-amber-400"
                      : "text-muted-foreground"
                }
              >
                {daysToDue < 0 ? `${-daysToDue} days overdue` : `${daysToDue} days`}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Working copy — re-key the values below into CRA Web Forms at canada.ca to file.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <SlipActionsMenu
              kind="T4"
              taxYear={taxYear}
              activityCount={t4.paychequeCount}
              programAccountActive={s.payrollAccountActive}
              filed={preview.existing.t4 && t4Filed ? { id: preview.existing.t4.id } : null}
            />
            <SlipActionsMenu
              kind="T5"
              taxYear={taxYear}
              activityCount={t5.eligible.count + t5.nonEligible.count}
              programAccountActive={s.payerRzActive}
              filed={preview.existing.t5 && t5Filed ? { id: preview.existing.t5.id } : null}
            />
            <SlipActionsMenu
              kind="T4A"
              taxYear={taxYear}
              activityCount={t4a.box117Cents > 0 ? 1 : 0}
              programAccountActive={s.payerRzActive}
              filed={preview.existing.t4a && t4aFiled ? { id: preview.existing.t4a.id } : null}
            />
          </div>
        </div>
      </div>

      {/* Corporate + recipient identity summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payer + recipient identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Payer (corporation)
            </p>
            <p className="font-medium">{s.corpLegalName}</p>
            <p className="text-xs text-muted-foreground">
              {s.addressLine1}
              {s.addressLine2 ? `, ${s.addressLine2}` : ""}
              <br />
              {s.city}, {s.province} {s.postalCode}
            </p>
            <div className="space-y-0.5 pt-2 text-xs">
              <p>
                <span className="text-muted-foreground">BN root:</span>{" "}
                <span className="font-mono">{s.businessNumber}</span>
              </p>
              <p>
                <span className="text-muted-foreground">T4 payroll account:</span>{" "}
                <span className="font-mono">{s.payrollAccount ?? "—"}</span>
                {!s.payrollAccountActive && (
                  <span className="ml-2 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-400">
                    not active
                  </span>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">T5 info-returns account:</span>{" "}
                <span className="font-mono">{s.payerRzAccount ?? "—"}</span>
                {!s.payerRzActive && (
                  <span className="ml-2 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-400">
                    not active
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recipient (director)
            </p>
            <p className="font-medium">{s.directorLegalName}</p>
            <p className="text-xs text-muted-foreground">{s.directorEmail}</p>
            <div className="space-y-0.5 pt-2 text-xs">
              <p>
                <span className="text-muted-foreground">SIN:</span>{" "}
                <span className="font-mono text-muted-foreground">
                  not stored — enter on CRA form
                </span>
              </p>
              <p className="text-muted-foreground">
                Recipient address = payer address (owner-manager)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-400" />
              Review before filing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-amber-200/90">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 size-1 rounded-full bg-amber-400" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* T4 preview */}
      <T4Card boxes={t4} existing={preview.existing.t4} filed={t4Filed} voided={t4Voided} taxYear={taxYear} />

      {/* T5 preview */}
      <T5Card boxes={t5} existing={preview.existing.t5} filed={t5Filed} voided={t5Voided} taxYear={taxYear} />

      {/* T4A preview — only render when there's loan-benefit activity */}
      {t4a.box117Cents > 0 || preview.existing.t4a ? (
        <T4ACard boxes={t4a} existing={preview.existing.t4a} filed={t4aFiled} voided={t4aVoided} />
      ) : null}

      {/* T4 + T5 summary / totals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">T4 + T5 summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <BoxRow label="Employment income on all T4 slips" amount={t4.box14EmploymentIncomeCents} />
          <BoxRow label="Total CPP employee contributions" amount={t4.box16CppBaseCents + t4.box16aCpp2Cents} />
          <BoxRow label="Total income tax withheld (fed + ON)" amount={t4.box22FedTaxWithheldCents + t4.ontarioTaxWithheldCents} />
          <BoxRow label="Employer CPP portion (for T4 Summary)" amount={t4.employerCppBaseCents + t4.employerCpp2Cents} />
          <BoxRow label="Dividends paid (all recipients, actual)" amount={t5.totals.actualCents} strong />
          <BoxRow label="Dividends paid — taxable (grossed-up)" amount={t5.totals.taxableCents} muted />
        </CardContent>
      </Card>

      {/* Info callout */}
      <Card className="border-indigo-500/20 bg-indigo-500/5">
        <CardContent className="pt-6">
          <div className="flex gap-3 text-sm">
            <Info className="size-4 flex-shrink-0 text-indigo-400" />
            <div className="space-y-2 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Rates edition:</span>{" "}
                <span className="font-mono text-xs">{t4.ratesEditionTag}</span>. Every box value
                above is computed live from paycheques (status = issued, pay-date in CY {taxYear})
                and paid dividends (paid-date in CY {taxYear}).
              </p>
              <p>
                Filing workflow: review box values here → open CRA Web Forms at{" "}
                <code className="font-mono text-xs">canada.ca</code> → re-key each box → print
                copies for your records. Working-copy PDF download will land in the next phase.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function T4Card({
  boxes,
  existing,
  filed,
  voided,
  taxYear,
}: {
  boxes: T4SlipBoxes;
  existing: Slip | null;
  filed: boolean;
  voided: boolean;
  taxYear: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <FileCheck className="size-4 text-indigo-400" />
          T4 · Statement of Remuneration Paid ({boxes.paychequeCount} paycheque{boxes.paychequeCount === 1 ? "" : "s"})
          {filed ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <Lock className="size-3" />
              Filed
            </span>
          ) : voided ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">
              Voided — preview reflects live data
            </span>
          ) : (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              Draft preview
            </span>
          )}
          {filed && existing?.craConfirmationNumber ? (
            <span className="text-xs font-normal text-muted-foreground">
              CRA #{existing.craConfirmationNumber}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <BoxRow box="Box 10" label="Province of employment" amount={0} muted />
        <div className="pl-6 text-xs text-muted-foreground">= ON (Ontario)</div>
        <BoxRow box="Box 14" label="Employment income" amount={boxes.box14EmploymentIncomeCents} />
        <BoxRow box="Box 16" label="CPP employee contributions (base, 5.95%)" amount={boxes.box16CppBaseCents} />
        <BoxRow box="Box 16A" label="CPP2 employee contributions (enhanced, 4%)" amount={boxes.box16aCpp2Cents} />
        <BoxRow box="Box 18" label="EI premiums (owner-manager exempt)" amount={boxes.box18EiCents} muted />
        <BoxRow box="Box 22" label="Income tax deducted (federal)" amount={boxes.box22FedTaxWithheldCents} />
        <BoxRow label="Income tax deducted (Ontario)" amount={boxes.ontarioTaxWithheldCents} />
        <BoxRow box="Box 24" label="EI insurable earnings (exempt)" amount={boxes.box24EiInsurableCents} muted />
        <BoxRow box="Box 26" label="CPP pensionable earnings" amount={boxes.box26CppPensionableCents} />
        <BoxRow box="Box 28" label="CPP/QPP and EI exempt indicator" amount={0} muted />
        <div className="pl-6 text-xs text-muted-foreground">= EI box checked (owner-manager)</div>
        <BoxRow box="Box 52" label="Pension adjustment" amount={boxes.box52PensionAdjustmentCents} muted />
        <div className="pt-3 border-t border-border/30" />
        <p className="pt-2 text-xs font-medium text-muted-foreground">Employer portion (for T4 Summary)</p>
        <BoxRow label="Employer CPP (base)" amount={boxes.employerCppBaseCents} />
        <BoxRow label="Employer CPP2 (enhanced)" amount={boxes.employerCpp2Cents} />
        <p className="pt-3 text-xs">
          <Link
            href="/paycheques"
            className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-indigo-400/60 hover:decoration-indigo-300"
          >
            View source paycheques
            <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function T4ACard({
  boxes,
  existing,
  filed,
  voided,
}: {
  boxes: T4ASlipBoxes;
  existing: Slip | null;
  filed: boolean;
  voided: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <FileCheck className="size-4 text-amber-400" />
          T4A · Statement of Other Income (Box 117 — Loan Benefits)
          {filed ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <Lock className="size-3" />
              Filed
            </span>
          ) : voided ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">
              Voided — preview reflects live data
            </span>
          ) : (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              Draft preview
            </span>
          )}
          {filed && existing?.craConfirmationNumber ? (
            <span className="text-xs font-normal text-muted-foreground">
              CRA #{existing.craConfirmationNumber}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <BoxRow box="Box 022" label="Income tax deducted (corp doesn't withhold on loan benefits)" amount={boxes.box022TaxWithheldCents} muted />
        <BoxRow box="Box 117" label="Loan benefits — total filed value" amount={boxes.box117Cents} strong />
        <div className="pt-3 border-t border-border/30" />
        <p className="pt-2 pb-2 text-xs font-medium text-muted-foreground">
          Audit breakdown (informational — not on the CRA T4A)
        </p>
        <BoxRow label="s.80.4(2) deemed-interest benefit (after interest-paid offset)" amount={boxes.breakdown.benefit80_4Cents} muted />
        <BoxRow label="s.15(2) inclusion (loan past 15(2.6) deadline)" amount={boxes.breakdown.inclusion15_2Cents} muted />
        <p className="pt-3 text-xs">
          <Link
            href="/shareholder-loan"
            className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-amber-400/60 hover:decoration-amber-300"
          >
            View source loan ledger
            <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function T5Card({
  boxes,
  existing,
  filed,
  voided,
  taxYear,
}: {
  boxes: T5SlipBoxes;
  existing: Slip | null;
  filed: boolean;
  voided: boolean;
  taxYear: number;
}) {
  const totalCount = boxes.eligible.count + boxes.nonEligible.count;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <FileCheck className="size-4 text-violet-400" />
          T5 · Statement of Investment Income ({totalCount} paid dividend{totalCount === 1 ? "" : "s"})
          {filed ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <Lock className="size-3" />
              Filed
            </span>
          ) : voided ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">
              Voided — preview reflects live data
            </span>
          ) : (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              Draft preview
            </span>
          )}
          {filed && existing?.craConfirmationNumber ? (
            <span className="text-xs font-normal text-muted-foreground">
              CRA #{existing.craConfirmationNumber}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="pb-2 text-xs font-medium text-muted-foreground">
          Eligible dividends ({boxes.eligible.count})
        </p>
        <BoxRow box="Box 24" label="Actual amount" amount={boxes.eligible.actualCents} />
        <BoxRow box="Box 25" label="Taxable amount (×1.38 gross-up)" amount={boxes.eligible.taxableCents} />
        <BoxRow box="Box 26" label="Federal dividend tax credit (15.0198% × Box 25)" amount={boxes.eligible.federalDtcCents} />
        <BoxRow label="Ontario DTC component (10% × Box 25)" amount={boxes.eligible.ontarioDtcCents} muted />
        <div className="pt-3 border-t border-border/30" />
        <p className="pt-2 pb-2 text-xs font-medium text-muted-foreground">
          Other-than-eligible dividends ({boxes.nonEligible.count})
        </p>
        <BoxRow box="Box 10" label="Actual amount" amount={boxes.nonEligible.actualCents} />
        <BoxRow box="Box 11" label="Taxable amount (×1.15 gross-up)" amount={boxes.nonEligible.taxableCents} />
        <BoxRow box="Box 12" label="Federal dividend tax credit (9.0301% × Box 11)" amount={boxes.nonEligible.federalDtcCents} />
        <BoxRow label="Ontario DTC component (2.9863% × Box 11, 2026)" amount={boxes.nonEligible.ontarioDtcCents} muted />
        <div className="pt-3 border-t border-border/30" />
        <p className="pt-2 pb-2 text-xs font-medium text-muted-foreground">Totals</p>
        <BoxRow label="Total actual dividends paid" amount={boxes.totals.actualCents} strong />
        <BoxRow label="Total taxable (grossed-up)" amount={boxes.totals.taxableCents} strong />
        <BoxRow label="Total federal DTC" amount={boxes.totals.federalDtcCents} strong />
        <p className="pt-3 text-xs">
          <Link
            href="/dividends"
            className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-violet-400/60 hover:decoration-violet-300"
          >
            View source dividends
            <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
