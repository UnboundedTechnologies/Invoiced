import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, AlertTriangle, Lock } from "lucide-react";
import { db } from "@/lib/db/client";
import { hstReturns } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  loadLiveAggregate,
  upsertDraftReturn,
} from "@/server/actions/hst";
import {
  canUseQuickMethod,
  quickMethodBreakEven,
  hstPeriodFor,
  hstFilingDueDate,
} from "@/lib/hst";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { MethodToggle } from "@/components/hst/method-toggle";
import { FirstQmToggle } from "@/components/hst/first-qm-toggle";
import { FileReturnButton } from "@/components/hst/file-return-button";
import { UnfileHstButton } from "@/components/hst/unfile-hst-button";
import { GeneratePdfButton } from "@/components/hst/generate-pdf-button";

export const dynamic = "force-dynamic";

export default async function HstDetailPage({
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

  // Auto-upsert a draft row if this FY has no record yet — keeps the URL
  // addressable by FY number without a separate "create" step.
  let [row] = await db
    .select()
    .from(hstReturns)
    .where(eq(hstReturns.fiscalYear, fiscalYear));
  if (!row) {
    await upsertDraftReturn(fiscalYear);
    [row] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
  }
  if (!row) notFound();

  const live = await loadLiveAggregate({ fiscalYear, isFirstQmFy: row.isFirstQmFy });
  const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);
  const due = hstFilingDueDate(period.end);
  const qmEligible = canUseQuickMethod(live.priorFourFyRevenueCents);
  const isFiled = row.status === "filed";

  // Break-even: only meaningful while drafting.
  const breakEven = !isFiled
    ? quickMethodBreakEven({
        invoices: live.regular.invoiceContributions,
        expenses: [
          ...live.regular.expenseContributions,
          ...live.quick.capitalExpenseContributions.filter(
            (c) => !live.regular.expenseContributions.some((e) => e.id === c.id),
          ),
        ],
        period,
        isFirstQmFy: row.isFirstQmFy,
      })
    : null;

  const activeMethod = row.method;

  // When filed, render from the frozen snapshot. When draft, render from live.
  const shown = isFiled
    ? {
        line101: row.line101Cents ?? 0,
        line103: row.line103Cents ?? 0,
        line105: row.line105Cents ?? 0,
        line106: row.line106Cents ?? 0,
        line107: row.line107Cents ?? 0,
        line108: row.line108Cents ?? 0,
        line109: row.line109Cents ?? 0,
        quickCredit: row.quickCreditCents ?? 0,
      }
    : activeMethod === "quick"
      ? {
          line101: live.quick.line101Cents,
          line103: live.quick.line103Cents,
          line105: live.quick.line105Cents,
          line106: live.quick.line106CapitalCents,
          line107: live.quick.line107Cents,
          line108: live.quick.line108Cents,
          line109: live.quick.line109Cents,
          quickCredit: live.quick.quickCreditCents,
        }
      : {
          line101: live.regular.line101Cents,
          line103: live.regular.line103Cents,
          line105: live.regular.line105Cents,
          line106: live.regular.line106RawCents,
          line107: live.regular.line107Cents,
          line108: live.regular.line108Cents,
          line109: live.regular.line109Cents,
          quickCredit: 0,
        };

  const netOwed = shown.line109 >= 0;
  const netToneColor = netOwed ? "text-rose-400" : "text-emerald-400";
  const netLabel = netOwed ? "Net tax owed to CRA" : "Refund due";

  // Deadline tint
  const daysToDue = daysBetweenISO(new Date().toISOString().slice(0, 10), due);
  const deadlineTone =
    isFiled
      ? "hidden"
      : daysToDue < 0
        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
        : daysToDue <= 60
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "hidden";

  return (
    <div className="space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <Link
          href="/hst"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          All returns
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">HST return — FY {fiscalYear}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatLongDate(period.start)} – {formatLongDate(period.end)} · due{" "}
              {formatLongDate(due)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <GeneratePdfButton fiscalYear={fiscalYear} />
            {!isFiled ? (
              <FileReturnButton
                fiscalYear={fiscalYear}
                netCents={shown.line109}
                method={activeMethod}
                version={row.version}
              />
            ) : (
              <UnfileHstButton fiscalYear={fiscalYear} version={row.version} />
            )}
          </div>
        </div>
      </div>

      {isFiled && (
        <div className="flex items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <Lock className="size-4" />
          <div>
            <div className="font-medium">
              Filed {row.filedAt ? formatLongDate(row.filedAt.toISOString().slice(0, 10)) : ""}
              {row.craConfirmationNumber && (
                <> · CRA confirmation {row.craConfirmationNumber}</>
              )}
            </div>
            <div className="text-[12px] text-emerald-300/80">
              Invoices and expenses with dates in this period are locked against edits.
            </div>
          </div>
        </div>
      )}

      {!isFiled && daysToDue >= 0 && daysToDue <= 60 && (
        <div className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${deadlineTone}`}>
          <AlertTriangle className="size-4" />
          <div>
            <div className="font-medium">Due in {daysToDue} day{daysToDue === 1 ? "" : "s"}</div>
            <div className="text-[12px] opacity-80">
              File via CRA My Business Account or GST/HST NETFILE by {formatLongDate(due)}.
            </div>
          </div>
        </div>
      )}

      {!isFiled && daysToDue < 0 && (
        <div className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${deadlineTone}`}>
          <AlertTriangle className="size-4" />
          <div>
            <div className="font-medium">Overdue by {Math.abs(daysToDue)} days</div>
            <div className="text-[12px] opacity-80">
              CRA charges interest daily. File ASAP and record the confirmation number to lock the period.
            </div>
          </div>
        </div>
      )}

      {/* Method comparison */}
      {!isFiled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filing method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MethodToggle
              fiscalYear={fiscalYear}
              method={activeMethod}
              disabled={!qmEligible && activeMethod === "regular"}
              disabledReason={
                !qmEligible
                  ? `Quick Method unavailable: prior-4-FY worldwide taxable supplies ${formatCAD(live.priorFourFyRevenueCents)} exceed $400K cap.`
                  : undefined
              }
            />

            {activeMethod === "quick" && (
              <FirstQmToggle
                fiscalYear={fiscalYear}
                value={row.isFirstQmFy}
                disabled={isFiled}
              />
            )}

            {breakEven && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-md border p-3 ${activeMethod === "regular" ? "border-indigo-500/40 bg-indigo-500/5" : "border-border/60"}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Regular
                  </div>
                  <div className="mt-1 font-mono text-lg">
                    {formatCAD(breakEven.regularNet)}
                  </div>
                </div>
                <div
                  className={`rounded-md border p-3 ${activeMethod === "quick" ? "border-cyan-500/40 bg-cyan-500/5" : "border-border/60"} ${!qmEligible ? "opacity-60" : ""}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Method
                  </div>
                  <div className="mt-1 font-mono text-lg">
                    {formatCAD(breakEven.quickNet)}
                  </div>
                </div>
                <div className="sm:col-span-2 rounded-md border border-border/60 bg-muted/10 p-3 text-xs">
                  <div className="mb-1 font-semibold">
                    {breakEven.recommendation === "quick" && (
                      <span className="text-cyan-300">
                        Quick Method saves {formatCAD(Math.abs(breakEven.deltaCents))}
                      </span>
                    )}
                    {breakEven.recommendation === "regular" && (
                      <span className="text-indigo-300">
                        Regular saves {formatCAD(Math.abs(breakEven.deltaCents))}
                      </span>
                    )}
                    {breakEven.recommendation === "wash" && (
                      <span className="text-muted-foreground">
                        Within $200 — either method works; Quick saves bookkeeping admin.
                      </span>
                    )}
                  </div>
                  <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {breakEven.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Line-by-line breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            CRA line numbers — {activeMethod === "quick" ? "Quick Method" : "Regular Method"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <tbody>
              <LineRow no="101" label="Total revenue (taxable supplies)" amount={shown.line101} />
              <LineRow
                no="103"
                label={activeMethod === "quick" ? "Quick Method remittance (net of credit)" : "GST/HST collected"}
                amount={shown.line103}
              />
              {activeMethod === "quick" && shown.quickCredit > 0 && (
                <LineRow
                  sub
                  label="incl. first-year 1% credit on first $30K"
                  amount={-shown.quickCredit}
                />
              )}
              <LineRow no="105" label="Total GST/HST + adjustments" amount={shown.line105} />
              <LineRow
                no="106"
                label={activeMethod === "quick" ? "ITCs — capital asset purchases only" : "ITCs claimed"}
                amount={shown.line106}
              />
              {shown.line107 !== 0 && (
                <LineRow
                  no="107"
                  label="Meals & entertainment 50% cap (ETA s.236)"
                  amount={shown.line107}
                />
              )}
              <LineRow no="108" label="Total ITCs + adjustments" amount={shown.line108} />
            </tbody>
          </table>
          <Separator />
          <div className="flex items-center justify-between px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Line 109 — {netLabel}
            </div>
            <div className={`font-mono text-2xl font-bold ${netToneColor}`}>
              {formatCAD(Math.abs(shown.line109))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Supporting detail */}
      {!isFiled && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoices contributing to line 101 / 103</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {live.regular.invoiceContributions.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  No non-void invoices in this period.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Invoice</th>
                      <th className="px-4 py-2 text-left">Issued</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                      <th className="px-4 py-2 text-right">HST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.regular.invoiceContributions.map((i) => (
                      <tr key={i.id} className="border-b border-border/20">
                        <td className="px-4 py-2 font-mono text-[11px]">{i.invoiceNumber}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatLongDate(i.issueDate)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatCAD(i.subtotalCents)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatCAD(i.hstCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Expenses —{" "}
                {activeMethod === "quick"
                  ? "capital assets (line 106)"
                  : "ITC contributions (lines 106 & 107)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(activeMethod === "quick"
                ? live.quick.capitalExpenseContributions
                : live.regular.expenseContributions
              ).length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  No expenses in this period.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Vendor</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                      <th className="px-4 py-2 text-right">HST paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeMethod === "quick"
                      ? live.quick.capitalExpenseContributions
                      : live.regular.expenseContributions
                    ).map((e) => (
                      <tr
                        key={e.id}
                        className={`border-b border-border/20 ${e.category === "meals_entertainment" ? "bg-amber-500/5" : ""}`}
                      >
                        <td className="px-4 py-2">{e.vendor}</td>
                        <td className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {e.category.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatCAD(e.subtotalCents)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatCAD(e.hstPaidCents)}
                          {e.category === "meals_entertainment" && activeMethod === "regular" && (
                            <span className="ml-1 text-[10px] text-amber-400">×50%</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function LineRow({
  no,
  label,
  amount,
  sub = false,
}: {
  no?: string;
  label: string;
  amount: number;
  sub?: boolean;
}) {
  return (
    <tr className="border-b border-border/30">
      <td
        className={`px-4 py-3 font-mono text-xs ${sub ? "text-muted-foreground" : "text-muted-foreground"}`}
      >
        {no ?? ""}
      </td>
      <td className={`px-4 py-3 ${sub ? "text-[12px] text-muted-foreground" : ""}`}>
        {label}
      </td>
      <td
        className={`px-4 py-3 text-right font-mono ${sub ? "text-[12px] text-muted-foreground" : ""}`}
      >
        {formatCAD(amount)}
      </td>
    </tr>
  );
}

function daysBetweenISO(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}
