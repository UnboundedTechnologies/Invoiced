"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { createPaycheque } from "@/server/actions/paycheques";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CPP_BASIC_EXEMPTION_2026,
  CPP_MAX_ANNUAL_2026,
  CPP2_MAX_ANNUAL_2026,
  computePayroll,
  payPeriodsFromCadence,
  type PayPeriodsPerYear,
} from "@/lib/payroll-2026";
import { formatCAD, formatLongDate } from "@/lib/utils";

type Result = { ok?: string; error?: string };

export function PaychequeForm({
  cadence,
  ytdCppCents,
  ytdCpp2Cents,
  ytdGrossCents,
  defaultGrossDollars,
  onDone,
}: {
  cadence: string;
  ytdCppCents: number;
  ytdCpp2Cents: number;
  ytdGrossCents: number;
  defaultGrossDollars: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [state, formAction, pending] = useActionState(createPaycheque, undefined as Result | undefined);

  const [payDate, setPayDate] = useState(today);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [grossDollars, setGrossDollars] = useState<string>(() => defaultGrossDollars.toFixed(2));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      router.refresh();
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router, onDone]);

  const periods = payPeriodsFromCadence(cadence) as PayPeriodsPerYear;

  const preview = useMemo(() => {
    const g = Number(grossDollars);
    if (!Number.isFinite(g) || g <= 0) return null;
    return computePayroll({
      grossCents: Math.round(g * 100),
      ytdCppCents,
      ytdCpp2Cents,
      ytdGrossCents,
      payPeriodsPerYear: periods,
    });
  }, [grossDollars, ytdCppCents, ytdCpp2Cents, ytdGrossCents, periods]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="payDate">Pay date *</Label>
            <Input
              id="payDate"
              name="payDate"
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grossDollars">Gross pay (CAD) *</Label>
            <Input
              id="grossDollars"
              name="grossDollars"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={grossDollars}
              onChange={(e) => setGrossDollars(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="periodStart">Period start *</Label>
            <Input
              id="periodStart"
              name="periodStart"
              type="date"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="periodEnd">Period end *</Label>
            <Input
              id="periodEnd"
              name="periodEnd"
              type="date"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bonus top-up, catch-up for missed period, etc."
          />
        </div>
        <div className="rounded-md bg-muted/20 p-3 text-xs">
          <div className="text-muted-foreground">
            Cadence: <span className="font-medium text-foreground">{cadence}</span> ·{" "}
            <span className="font-medium text-foreground">{periods}</span> periods/yr · exemption{" "}
            {formatCAD(Math.round((CPP_BASIC_EXEMPTION_2026 / periods) * 100))} / pay
          </div>
          <div className="mt-1 text-muted-foreground">
            YTD CPP {formatCAD(ytdCppCents)} / max {formatCAD(Math.round(CPP_MAX_ANNUAL_2026 * 100))} ·{" "}
            YTD CPP2 {formatCAD(ytdCpp2Cents)} / max {formatCAD(Math.round(CPP2_MAX_ANNUAL_2026 * 100))}
          </div>
        </div>
        <Button type="submit" variant="brand" size="lg" disabled={pending} className="w-full gap-2">
          <Sparkles className="size-4" />
          {pending ? "Generating stub…" : "Create paycheque"}
        </Button>
      </form>

      <aside>
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Live deductions preview</CardTitle>
            <CardDescription>CRA T4127 Jan 2026 formulas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {preview ? (
              <>
                <PreviewLine label="Gross" value={formatCAD(preview.grossCents)} effective="100.0%" />
                <PreviewLine
                  label="CPP (5.95% stat.)"
                  value={`−${formatCAD(preview.cppCents)}`}
                  effective={pct(preview.cppCents, preview.grossCents)}
                />
                {preview.cpp2Cents > 0 && (
                  <PreviewLine
                    label="CPP2 (4% stat.)"
                    value={`−${formatCAD(preview.cpp2Cents)}`}
                    effective={pct(preview.cpp2Cents, preview.grossCents)}
                  />
                )}
                <PreviewLine label="EI" value="−$0.00" muted hint="owner-manager" />
                <PreviewLine
                  label="Federal tax"
                  value={`−${formatCAD(preview.federalTaxCents)}`}
                  effective={pct(preview.federalTaxCents, preview.grossCents)}
                />
                <PreviewLine
                  label="Ontario tax"
                  value={`−${formatCAD(preview.provincialTaxCents)}`}
                  effective={pct(preview.provincialTaxCents, preview.grossCents)}
                  hint={preview.ohpCents > 0 ? `incl. OHP ${formatCAD(preview.ohpCents)}` : undefined}
                />
                <PreviewLine
                  label="Total deductions"
                  value={`−${formatCAD(
                    preview.cppCents +
                      preview.cpp2Cents +
                      preview.eiCents +
                      preview.federalTaxCents +
                      preview.provincialTaxCents,
                  )}`}
                  effective={pct(
                    preview.cppCents +
                      preview.cpp2Cents +
                      preview.eiCents +
                      preview.federalTaxCents +
                      preview.provincialTaxCents,
                    preview.grossCents,
                  )}
                  strong
                />
                <div className="border-t border-border/60 pt-2">
                  <div className="flex items-end justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Net pay</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        {pct(preview.netCents, preview.grossCents)} take-home
                      </div>
                    </div>
                    <span className="text-lg font-bold text-brand-gradient">{formatCAD(preview.netCents)}</span>
                  </div>
                </div>
                <div className="mt-2 rounded-md bg-amber-500/10 p-2 text-[11px]">
                  <div className="text-muted-foreground">CRA remittance</div>
                  <div className="font-medium text-amber-300">
                    {formatCAD(preview.totalRemittanceCents)} due 15th of next month
                  </div>
                </div>
                {payDate && (
                  <div className="pt-1 text-[11px] text-muted-foreground">
                    Pay date: {formatLongDate(payDate)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Enter a gross amount to preview deductions.</p>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function pct(n: number, gross: number) {
  if (gross === 0) return "0.0%";
  return `${((n / gross) * 100).toFixed(1)}%`;
}

function PreviewLine({
  label,
  value,
  hint,
  effective,
  muted,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  effective?: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${muted ? "opacity-60" : ""} ${strong ? "border-t border-border/40 pt-1.5" : ""}`}
    >
      <span className="text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-[10px] italic">({hint})</span> : null}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={strong ? "font-semibold" : "font-medium"}>{value}</span>
        {effective && <span className="text-[10px] text-muted-foreground">({effective})</span>}
      </span>
    </div>
  );
}
