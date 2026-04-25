import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  AlertTriangle,
  Lock,
  Calculator,
  Banknote,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { db } from "@/lib/db/client";
import { settings, t1Returns } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  loadLiveT1Aggregate,
  upsertDraftT1Return,
} from "@/server/actions/t1";
import { t1FilingDueDate } from "@/lib/t1";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { FileT1Button } from "@/components/personal-tax/file-t1-button";
import { GenerateT1PdfButton } from "@/components/personal-tax/generate-t1-pdf-button";
import { DonationsCard } from "@/components/personal-tax/donations-card";
import { ContributionsCard } from "@/components/personal-tax/contributions-card";

export const dynamic = "force-dynamic";

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function LineRow({
  line,
  label,
  amount,
  strong = false,
  negative = false,
}: {
  line?: string;
  label: string;
  amount: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-sm ${
        strong ? "border-t border-border/60 font-semibold" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {line ? (
          <span className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-rose-300">
            {line}
          </span>
        ) : null}
        <span className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      </div>
      <span
        className={`font-mono ${
          negative && amount !== 0 ? "text-rose-400" : strong ? "text-foreground" : ""
        }`}
      >
        {negative && amount > 0 ? `(${formatCAD(amount)})` : formatCAD(amount)}
      </span>
    </div>
  );
}

export default async function PersonalTaxDetailPage({
  params,
}: {
  params: Promise<{ taxYear: string }>;
}) {
  const { taxYear: tyParam } = await params;
  const taxYear = parseInt(tyParam, 10);
  if (!Number.isFinite(taxYear)) notFound();

  // Auto-upsert a draft row if missing — keeps URL addressable.
  let [row] = await db.select().from(t1Returns).where(eq(t1Returns.taxYear, taxYear));
  if (!row) {
    await upsertDraftT1Return(taxYear);
    [row] = await db.select().from(t1Returns).where(eq(t1Returns.taxYear, taxYear));
  }
  if (!row) notFound();

  const live = await loadLiveT1Aggregate(taxYear);
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const due = t1FilingDueDate(taxYear);
  const isFiled = row.status === "filed";
  const today = new Date().toISOString().slice(0, 10);
  const daysToDue = Math.round(
    (new Date(due + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) /
      86_400_000,
  );
  const r = live.result;

  const owing = r.refundOrOwingCents > 0;
  const totalTax = isFiled ? row.totalTaxPayableCents ?? 0 : r.totalTaxPayableCents;
  const refundOrOwing = isFiled ? row.refundOrOwingCents ?? 0 : r.refundOrOwingCents;

  return (
    <div className="space-y-6">
      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-500">
        <Link
          href="/personal-tax"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Personal tax
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              T1 · CY {taxYear}
              {isFiled ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-sm font-medium text-emerald-400">
                  <Lock className="size-3.5" />
                  Filed
                </span>
              ) : (
                <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-sm font-medium text-amber-400">
                  Draft
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Jan 1 – Dec 31 · Filing due {formatLongDate(due)}
              {!isFiled && (
                <>
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
                </>
              )}
            </p>
            {isFiled && row.craConfirmationNumber ? (
              <p className="mt-1 text-xs text-muted-foreground">
                CRA confirmation: <span className="font-mono">{row.craConfirmationNumber}</span>
                {row.filedAt
                  ? ` · Filed ${formatLongDate(new Date(row.filedAt).toISOString().slice(0, 10))}`
                  : null}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <GenerateT1PdfButton taxYear={taxYear} />
            {!isFiled && (
              <FileT1Button
                taxYear={taxYear}
                totalTaxCents={totalTax}
                refundOrOwingCents={refundOrOwing}
              />
            )}
          </div>
        </div>
      </div>

      {/* 3-card headline */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Calculator className="size-3.5 text-rose-400" />
              Total tax
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{formatCAD(totalTax)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Line 43500</p>
          </CardContent>
        </Card>

        <Card className={owing ? "border-rose-500/20 bg-rose-500/5" : "border-emerald-500/20 bg-emerald-500/5"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Banknote className={`size-3.5 ${owing ? "text-rose-400" : "text-emerald-400"}`} />
              {owing ? "Balance owing" : "Refund"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`font-mono text-2xl font-semibold ${owing ? "text-rose-400" : "text-emerald-400"}`}>
              {formatCAD(Math.abs(refundOrOwing))}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Line {owing ? "48500" : "48400"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-indigo-500/20 bg-indigo-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="size-3.5 text-indigo-400" />
              Marginal rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{fmtBps(r.marginalRateCombinedBps)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Fed {fmtBps(r.marginalRateFedBps)} · ON {fmtBps(r.marginalRateOnBps)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* T4 box table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">T4 · Employment slip ({live.t4.count} paycheque{live.t4.count === 1 ? "" : "s"})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow line="Box 14" label="Employment income" amount={live.t4.box14EmploymentIncomeCents} />
          <LineRow line="Box 16" label="CPP employee contributions (base)" amount={live.t4.box16CppBaseCents} />
          <LineRow line="Box 16A" label="CPP2 employee contributions (enhanced)" amount={live.t4.box16aCpp2Cents} />
          <LineRow line="Box 22" label="Federal income tax deducted" amount={live.t4.box22FedTaxWithheldCents} />
          <LineRow line="Box 26" label="CPP pensionable earnings" amount={live.t4.box26CppPensionableCents} />
          <LineRow label="Ontario income tax deducted" amount={live.t4.ontarioTaxWithheldCents} />
          <p className="pt-2 text-xs">
            <Link
              href="/paycheques"
              className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-rose-400/60 hover:decoration-rose-300"
            >
              View paycheques
              <ArrowRight className="size-3.5" />
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* T5 box table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            T5 · Dividend slip ({live.t5.eligible.count + live.t5.nonEligible.count} paid dividend
            {live.t5.eligible.count + live.t5.nonEligible.count === 1 ? "" : "s"})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow line="Box 24" label="Eligible dividend — actual" amount={live.t5.eligible.actualCents} />
          <LineRow line="Box 25" label="Eligible dividend — grossed up (×1.38)" amount={live.grossedUp.eligibleCents} />
          <LineRow line="Box 10" label="Non-eligible dividend — actual" amount={live.t5.nonEligible.actualCents} />
          <LineRow line="Box 11" label="Non-eligible dividend — grossed up (×1.15)" amount={live.grossedUp.nonEligibleCents} />
          <p className="pt-2 text-xs">
            <Link
              href="/dividends"
              className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-rose-400/60 hover:decoration-rose-300"
            >
              View dividends
              <ArrowRight className="size-3.5" />
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* T4A box 117 */}
      {live.t4a.cents > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">T4A · Loan benefits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <LineRow line="Box 117" label="Loan benefits (s.15(2) + s.80.4) → line 13000" amount={live.t4a.cents} />
            <div className="pt-2 text-xs text-muted-foreground">
              {live.t4a.breakdown.benefit80_4Cents > 0 ? (
                <span>80.4 benefit: {formatCAD(live.t4a.breakdown.benefit80_4Cents)}</span>
              ) : null}
              {live.t4a.breakdown.inclusion15_2Cents > 0 ? (
                <span className="ml-3">
                  15(2) inclusion: {formatCAD(live.t4a.breakdown.inclusion15_2Cents)}
                </span>
              ) : null}
              <div className="pt-1">
                <Link
                  href="/shareholder-loan"
                  className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 decoration-rose-400/60 hover:decoration-rose-300"
                >
                  View shareholder loan ledger
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Income → taxable */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Income → taxable income</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow line="15000" label="Total income" amount={r.totalIncomeCents} />
          <LineRow line="22215" label="CPP enhanced deduction (s.60(e))" amount={r.cppEnhancedDeductionCents} negative />
          <LineRow line="22200" label="CPP2 deduction (s.60(e.1))" amount={r.cpp2DeductionCents} negative />
          <LineRow line="20800" label="RRSP deduction" amount={r.rrspDeductionCents} negative />
          <LineRow line="20805" label="FHSA deduction" amount={r.fhsaDeductionCents} negative />
          <LineRow line="23600" label="Net income" amount={r.netIncomeCents} strong />
          <LineRow line="26000" label="Taxable income" amount={r.taxableIncomeCents} strong />
        </CardContent>
      </Card>

      {/* Donations */}
      <DonationsCard
        taxYear={taxYear}
        donations={live.donations.rows}
        totalCents={live.donations.totalCents}
        federalCreditCents={r.federal.donationsCreditCents}
        ontarioCreditCents={r.ontario.donationsCreditCents}
        isFiled={isFiled}
      />

      {/* RRSP / FHSA contributions */}
      <ContributionsCard
        taxYear={taxYear}
        rows={live.contributions.rows}
        rrspContributionsCents={live.contributions.rrspCents}
        fhsaContributionsCents={live.contributions.fhsaCents}
        rrspDeductionCents={r.rrspDeductionCents}
        fhsaDeductionCents={r.fhsaDeductionCents}
        rrspRoomCents={s?.rrspRoomCents ?? null}
        fhsaRoomCents={s?.fhsaRoomCents ?? null}
        isFiled={isFiled}
      />

      {/* Federal calc */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Federal tax — Schedule 1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow label="Tax from brackets" amount={r.federal.bracketTaxCents} />
          <LineRow line="30000" label="Basic personal amount (phased)" amount={r.federal.bpaAmountCents} />
          <LineRow line="31260" label="Canada employment amount" amount={r.federal.ceaAmountCents} />
          <LineRow line="30800" label="CPP base credit portion (4.95/5.95 of box 16)" amount={r.federal.cppBaseAmountCents} />
          <LineRow line="33500" label="Total non-refundable credit amounts" amount={r.federal.nonRefundableCreditsCents} />
          <LineRow line="35000" label="Credits × 14%" amount={r.federal.nonRefundableCreditsTaxCents} negative />
          <LineRow line="40425" label="DTC — eligible" amount={r.federal.dtcEligibleCents} negative />
          <LineRow line="40425" label="DTC — non-eligible" amount={r.federal.dtcNonEligibleCents} negative />
          <LineRow line="34900" label="Donations credit" amount={r.federal.donationsCreditCents} negative />
          <LineRow line="42000" label="Federal tax payable" amount={r.federal.federalTaxPayableCents} strong />
        </CardContent>
      </Card>

      {/* Ontario calc */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ontario tax — ON428</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow label="Tax from brackets" amount={r.ontario.bracketTaxCents} />
          <LineRow line="58040" label="Basic personal amount" amount={r.ontario.bpaAmountCents} />
          <LineRow line="58240" label="CPP base credit portion" amount={r.ontario.cppBaseAmountCents} />
          <LineRow label="Non-refundable credit tax (× 5.05%)" amount={r.ontario.nonRefundableCreditsTaxCents} negative />
          <LineRow label="Basic tax after credits" amount={r.ontario.basicTaxAfterCreditsCents} />
          <LineRow label="Surtax tier 1 (20% on basic over $5,818)" amount={r.ontario.surtaxTier1Cents} />
          <LineRow label="Surtax tier 2 (+36% on basic over $7,446)" amount={r.ontario.surtaxTier2Cents} />
          <LineRow label="Ontario DTC — eligible" amount={r.ontario.dtcEligibleCents} negative />
          <LineRow label="Ontario DTC — non-eligible" amount={r.ontario.dtcNonEligibleCents} negative />
          <LineRow line="5896" label="Ontario donations credit" amount={r.ontario.donationsCreditCents} negative />
          <LineRow label="Ontario Health Premium (ON479)" amount={r.ontario.ontarioHealthPremiumCents} />
          <LineRow label="Ontario tax payable" amount={r.ontario.ontarioTaxPayableCents} strong />
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <LineRow line="43500" label="Total tax payable" amount={r.totalTaxPayableCents} />
          <LineRow label="Total withheld (box 22 + ON)" amount={r.totalWithheldCents} negative />
          <LineRow
            line={owing ? "48500" : "48400"}
            label={owing ? "Balance owing" : "Refund"}
            amount={Math.abs(r.refundOrOwingCents)}
            strong
          />
        </CardContent>
      </Card>

      {/* Warnings */}
      {live.warnings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-400" />
              Review items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-amber-200/90">
              {live.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 size-1 rounded-full bg-amber-400" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
