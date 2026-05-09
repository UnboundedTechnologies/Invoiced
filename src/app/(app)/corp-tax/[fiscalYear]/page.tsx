import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  AlertTriangle,
  Lock,
  Landmark,
  Calculator,
  Banknote,
  FileText,
} from "lucide-react";
import { db } from "@/lib/db/client";
import { t2Returns } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  loadLiveT2Aggregate,
  upsertDraftT2Return,
} from "@/server/actions/t2";
import { t2FilingDueDate } from "@/lib/t2";
import { hstPeriodFor } from "@/lib/hst";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { FileT2Button } from "@/components/corp-tax/file-t2-button";
import { UnfileT2Button } from "@/components/corp-tax/unfile-t2-button";
import { GenerateT2PdfButton } from "@/components/corp-tax/generate-t2-pdf-button";
import { ExportGifiButton } from "@/components/corp-tax/export-gifi-button";
import { T2ConfigCard } from "@/components/corp-tax/t2-config-card";
import { CcaClaimEditor } from "@/components/corp-tax/cca-claim-editor";

export const dynamic = "force-dynamic";

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export default async function CorpTaxDetailPage({
  params,
}: {
  params: Promise<{ fiscalYear: string }>;
}) {
  const { fiscalYear: fyParam } = await params;
  const fiscalYear = parseInt(fyParam, 10);
  if (!Number.isFinite(fiscalYear)) notFound();

  const s = await getSettings();
  if (!s) notFound();
  const fyeMonth = s.fiscalYearEndMonth;
  const fyeDay = s.fiscalYearEndDay;

  // Auto-upsert a draft row if missing — keeps URL addressable.
  let [row] = await db.select().from(t2Returns).where(eq(t2Returns.fiscalYear, fiscalYear));
  if (!row) {
    await upsertDraftT2Return(fiscalYear);
    [row] = await db.select().from(t2Returns).where(eq(t2Returns.fiscalYear, fiscalYear));
  }
  if (!row) notFound();

  const live = await loadLiveT2Aggregate(fiscalYear);
  const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);
  const due = t2FilingDueDate(period.end);
  const isFiled = row.status === "filed";
  const today = new Date().toISOString().slice(0, 10);
  const daysToDue = Math.round(
    (new Date(due + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) /
      86_400_000,
  );

  const taxable = isFiled ? row.taxableIncomeCents ?? 0 : live.result.taxableIncomeCents;
  const totalTax = isFiled ? row.totalTaxCents ?? 0 : live.result.totalTaxCents;
  const dividendRefund = isFiled
    ? row.dividendRefundCents ?? 0
    : live.rdtoh.dividendRefundCents;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-500">
        <Link
          href="/corp-tax"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          All T2 returns
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">T2 return · FY {fiscalYear}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatLongDate(period.start)} – {formatLongDate(period.end)} · Due{" "}
              {formatLongDate(due)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportGifiButton fiscalYear={fiscalYear} />
            <GenerateT2PdfButton fiscalYear={fiscalYear} />
            {!isFiled ? (
              <FileT2Button
                fiscalYear={fiscalYear}
                totalTaxCents={totalTax}
                dividendRefundCents={dividendRefund}
                version={row.version}
              />
            ) : (
              <UnfileT2Button fiscalYear={fiscalYear} version={row.version} />
            )}
          </div>
        </div>
      </div>

      {/* Status banner */}
      {isFiled ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <Lock className="size-4 shrink-0 text-emerald-400" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-emerald-400">
              Filed {row.filedAt ? `on ${formatLongDate(row.filedAt.toISOString().slice(0, 10))}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              CRA confirmation: {row.craConfirmationNumber ?? "—"} · all FY rows locked from edits
            </div>
          </div>
        </div>
      ) : daysToDue < 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-rose-400" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-rose-400">
              Overdue by {Math.abs(daysToDue)} day{Math.abs(daysToDue) === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-muted-foreground">
              Interest accrues daily at CRA's prescribed rate + 4%. File ASAP.
            </div>
          </div>
        </div>
      ) : daysToDue <= 60 ? (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-amber-400" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-400">
              Due in {daysToDue} day{daysToDue === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-muted-foreground">
              Plan to have the accountant review the prep summary before the deadline.
            </div>
          </div>
        </div>
      ) : null}

      {/* Headline stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Taxable income
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-md bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30">
                <Calculator className="size-4 text-indigo-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold">{formatCAD(taxable)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              On {formatCAD(live.inputs.revenueCents)} revenue
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Total tax owing
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-md bg-rose-500/15 ring-1 ring-inset ring-rose-500/30">
                <Landmark className="size-4 text-rose-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold">{formatCAD(totalTax)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Fed + Ontario combined
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Dividend refund
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-md bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
                <Banknote className="size-4 text-emerald-400" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold">{formatCAD(dividendRefund)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              ERDTOH + NERDTOH refund (Schedule 3)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Config card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <T2ConfigCard
            fiscalYear={fiscalYear}
            isCcpc={live.isCcpc}
            priorYearAaiiCents={live.priorYearAaiiCents}
            disabled={isFiled}
          />
        </CardContent>
      </Card>

      {/* P&L */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Income statement (for tax)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">Revenue (taxable supplies, ex-HST)</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.inputs.revenueCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    Operating expenses (meals 50%, capital excluded)
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    ({formatCAD(live.inputs.operatingExpensesCents)})
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-muted-foreground">Salary paid (gross)</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    ({formatCAD(live.inputs.salaryCents)})
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-muted-foreground">Employer CPP + CPP2</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    ({formatCAD(live.inputs.employerCppCents)})
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-muted-foreground">CCA claimed (Schedule 8)</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    ({formatCAD(live.inputs.ccaClaimedCents)})
                  </td>
                </tr>
                <tr className="border-t border-border/70 bg-muted/20">
                  <td className="px-4 py-3 font-semibold">Net income for tax</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.netIncomeForTaxCents)}
                  </td>
                </tr>
                <tr className="border-t border-border/70 bg-muted/10">
                  <td className="px-4 py-3 font-semibold">Taxable income</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.taxableIncomeCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* SBD allocation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            SBD allocation
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">Business limit (ITA s.125(2))</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.result.sbdBusinessLimitCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    Passive-income grind · prior AAII {formatCAD(live.priorYearAaiiCents)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                    ({formatCAD(live.result.sbdGrindCents)})
                  </td>
                </tr>
                <tr className="border-t border-border/70 bg-muted/20">
                  <td className="px-4 py-3 font-semibold">Limit after grind</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.sbdLimitAfterGrindCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-emerald-400">SBD-eligible income</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                    {formatCAD(live.result.sbdEligibleCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5 text-amber-400">
                    Full-rate income (taxed at general rate)
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-amber-400">
                    {formatCAD(live.result.fullRateIncomeCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Tax calc */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Tax calculation
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Component</th>
                  <th className="px-4 py-2 text-right font-semibold">Rate</th>
                  <th className="px-4 py-2 text-right font-semibold">Tax</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">Federal SBD portion</td>
                  <td className="px-4 py-2.5 text-right font-mono">9.00%</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.result.fedSbdPortionCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">Federal general portion (GRR)</td>
                  <td className="px-4 py-2.5 text-right font-mono">15.00%</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.result.fedGeneralPortionCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">
                    Ontario SBD portion (blended {fmtBps(live.result.ontarioBlendedSbdRateBps)})
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {fmtBps(live.result.ontarioBlendedSbdRateBps)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.result.ontarioSbdPortionCents)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-4 py-2.5">Ontario general portion</td>
                  <td className="px-4 py-2.5 text-right font-mono">11.50%</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {formatCAD(live.result.ontarioGeneralPortionCents)}
                  </td>
                </tr>
                <tr className="border-t border-border/70 bg-muted/10">
                  <td className="px-4 py-3 font-semibold">Federal total</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.fedTaxCents)}
                  </td>
                </tr>
                <tr className="bg-muted/10">
                  <td className="px-4 py-3 font-semibold">Ontario total</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.ontarioTaxCents)}
                  </td>
                </tr>
                <tr className="border-t border-border/70 bg-indigo-500/10">
                  <td className="px-4 py-3 font-semibold">Total tax owing</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCAD(live.result.totalTaxCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* CCA schedule */}
      {live.ccaRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Schedule 8 · CCA pools
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Class</th>
                    <th className="px-4 py-2 text-right font-semibold">Rate</th>
                    <th className="px-4 py-2 text-right font-semibold">Opening UCC</th>
                    <th className="px-4 py-2 text-right font-semibold">Additions</th>
                    <th className="px-4 py-2 text-right font-semibold">Half-year adj.</th>
                    <th className="px-4 py-2 text-right font-semibold">CCA base</th>
                    <th className="px-4 py-2 text-center font-semibold">Claim</th>
                    <th className="px-4 py-2 text-right font-semibold">CCA claimed</th>
                    <th className="px-4 py-2 text-right font-semibold">Closing UCC</th>
                  </tr>
                </thead>
                <tbody>
                  {live.ccaRows.map((r) => (
                    <tr key={r.class} className="border-b border-border/30">
                      <td className="px-4 py-2.5 font-mono">{r.class}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {fmtBps(r.classRateBps)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {formatCAD(r.openingUccCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {formatCAD(r.additionsCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        ({formatCAD(r.halfYearAdjustmentCents)})
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {formatCAD(r.ccaBaseCents)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <CcaClaimEditor
                          fiscalYear={fiscalYear}
                          ccaClass={r.class}
                          claimFractionBps={r.claimFractionBps}
                          disabled={isFiled}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">
                        {formatCAD(r.ccaClaimedCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                        {formatCAD(r.closingUccCents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border/70 bg-muted/10">
                    <td className="px-4 py-3 font-semibold" colSpan={7}>
                      Total CCA
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatCAD(live.inputs.ccaClaimedCents)}
                    </td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tax pools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Tax pools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <PoolCard
              title="GRIP"
              subtitle="Eligible-dividend capacity"
              tone="cyan"
              opening={live.grip.openingCents}
              addition={live.grip.additionCents}
              used={live.grip.usedCents}
              closing={live.grip.closingCents}
              usedLabel="Used"
            />
            <PoolCard
              title="ERDTOH"
              subtitle="Eligible refundable tax"
              tone="emerald"
              opening={live.rdtoh.erdtoh.openingCents}
              addition={live.rdtoh.erdtoh.additionCents}
              used={live.rdtoh.erdtoh.refundCents}
              closing={live.rdtoh.erdtoh.closingCents}
              usedLabel="Refund"
            />
            <PoolCard
              title="NERDTOH"
              subtitle="Non-eligible refundable tax"
              tone="amber"
              opening={live.rdtoh.nerdtoh.openingCents}
              addition={live.rdtoh.nerdtoh.additionCents}
              used={live.rdtoh.nerdtoh.refundCents}
              closing={live.rdtoh.nerdtoh.closingCents}
              usedLabel="Refund"
            />
            <PoolCard
              title="CDA"
              subtitle="Capital dividend account"
              tone="violet"
              opening={live.cda.openingCents}
              addition={live.cda.additionCents}
              used={live.cda.usedCents}
              closing={live.cda.closingCents}
              usedLabel="Elected"
            />
          </div>
        </CardContent>
      </Card>

      {/* Activity + warnings */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Activity in FY
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ActivityRow
              href="/invoices"
              label="Invoices (taxable supplies)"
              count={live.activity.invoiceCount}
            />
            <ActivityRow href="/expenses" label="Expenses" count={live.activity.expenseCount} />
            <ActivityRow
              href="/paycheques"
              label="Paycheques (issued)"
              count={live.activity.paychequeCount}
            />
            <ActivityRow
              href="/dividends"
              label="Dividends (eligible / non-eligible)"
              count={live.activity.dividendCount}
              right={
                <span className="font-mono text-xs">
                  {formatCAD(live.activity.eligibleDividendsPaidCents)} /{" "}
                  {formatCAD(live.activity.nonEligibleDividendsPaidCents)}
                </span>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Notes {live.warnings.length > 0 ? `(${live.warnings.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {live.warnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to flag. Review the prep summary PDF and hand to the accountant.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {live.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        All figures live-computed from invoices, expenses, paycheques, and dividends. Filing the
        return freezes a snapshot and locks every row in FY {fiscalYear} from edits. See the prep
        summary PDF for the accountant hand-off, or export GIFI CSV to paste into ProFile / TaxPrep.
      </p>
    </div>
  );
}

function PoolCard({
  title,
  subtitle,
  tone,
  opening,
  addition,
  used,
  closing,
  usedLabel,
}: {
  title: string;
  subtitle: string;
  tone: "cyan" | "emerald" | "amber" | "violet";
  opening: number;
  addition: number;
  used: number;
  closing: number;
  usedLabel: string;
}) {
  const toneMap = {
    cyan: { border: "border-cyan-500/30", bg: "bg-cyan-500/5", text: "text-cyan-400" },
    emerald: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-400" },
    amber: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400" },
    violet: { border: "border-violet-500/30", bg: "bg-violet-500/5", text: "text-violet-400" },
  };
  const t = toneMap[tone];
  return (
    <div className={`rounded-md border ${t.border} ${t.bg} p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-sm font-bold uppercase tracking-wider ${t.text}`}>{title}</div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Opening</span>
          <span className="font-mono">{formatCAD(opening)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Additions</span>
          <span className="font-mono">{formatCAD(addition)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{usedLabel}</span>
          <span className="font-mono">({formatCAD(used)})</span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border/50 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wider">Closing</span>
        <span className={`font-mono text-base font-bold ${t.text}`}>
          {formatCAD(closing)}
        </span>
      </div>
    </div>
  );
}

function ActivityRow({
  href,
  label,
  count,
  right,
}: {
  href: string;
  label: string;
  count: number;
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border/40 hover:bg-muted/20"
    >
      <div className="flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {right ?? null}
        <span className="rounded-md bg-muted/40 px-2 py-0.5 text-xs font-semibold">
          {count}
        </span>
      </div>
    </Link>
  );
}
