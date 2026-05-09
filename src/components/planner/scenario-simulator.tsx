"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  Coins,
  Landmark,
  Pin,
  Save,
  Target,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  simulateScenario,
  buildPresetInputs,
  CPP_YMPE_2026,
  type ScenarioInput,
  type ScenarioResult,
  type BaselineFromActuals,
  type PsbRisk,
} from "@/lib/self-pay-planner";
import { saveScenario } from "@/server/actions/planner";
import { formatCAD } from "@/lib/utils";
import type { PlannerScenario } from "@/lib/db/schema";

type PresetKey = "salaryToYmpe" | "dividendOnly" | "custom";

const SALARY_MAX_CENTS = 200_000_00;
const DIVIDEND_MAX_CENTS = 500_000_00;
const SLIDER_STEP_CENTS = 1_000_00; // $1,000 increments

function warningTone(severity: "info" | "warn" | "error") {
  switch (severity) {
    case "error":
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    case "warn":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    default:
      return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  }
}

export function ScenarioSimulator({
  fiscalYear,
  baseline,
  openingGripCents,
  priorYearAaiiCents,
  savedScenarios,
  psbRisk,
}: {
  fiscalYear: number;
  baseline: BaselineFromActuals;
  openingGripCents: number;
  priorYearAaiiCents: number;
  savedScenarios: PlannerScenario[];
  psbRisk?: PsbRisk;
}) {
  const router = useRouter();

  const presets = useMemo(
    () => buildPresetInputs(fiscalYear, baseline),
    [fiscalYear, baseline],
  );

  const [preset, setPreset] = useState<PresetKey>("custom");
  const [projectedRevenue, setProjectedRevenue] = useState(
    presets.custom.projectedRevenueCents,
  );
  const [projectedOpex, setProjectedOpex] = useState(
    presets.custom.projectedOpexCents,
  );
  const [salary, setSalary] = useState(presets.custom.salaryCents);
  const [eligibleDiv, setEligibleDiv] = useState(
    presets.custom.eligibleDividendCents,
  );
  const [nonEligibleDiv, setNonEligibleDiv] = useState(
    presets.custom.nonEligibleDividendCents,
  );

  function loadPreset(key: PresetKey) {
    const p = presets[key];
    setPreset(key);
    setProjectedRevenue(p.projectedRevenueCents);
    setProjectedOpex(p.projectedOpexCents);
    setSalary(p.salaryCents);
    setEligibleDiv(p.eligibleDividendCents);
    setNonEligibleDiv(p.nonEligibleDividendCents);
  }

  // Live compute — client-side, synchronous, zero RTT.
  const input: ScenarioInput = {
    fiscalYear,
    periodStart: baseline.periodStart,
    periodEnd: baseline.periodEnd,
    projectedRevenueCents: projectedRevenue,
    projectedOpexCents: projectedOpex,
    salaryCents: salary,
    eligibleDividendCents: eligibleDiv,
    nonEligibleDividendCents: nonEligibleDiv,
    ccaClaimedCents: 0,
    priorYearAaiiCents,
    openingGripCents,
    psbRisk,
  };

  const result: ScenarioResult = simulateScenario(input);

  return (
    <div className="space-y-6">
      {/* Preset picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preset scenarios</CardTitle>
          <CardDescription>
            Tap a preset to seed the sliders — then fine-tune. Custom seeds from your YTD actuals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={preset} onValueChange={(v) => loadPreset(v as PresetKey)}>
            <TabsList>
              <TabsTrigger value="salaryToYmpe">
                <Coins className="mr-1.5 size-3.5" />
                Salary-to-YMPE
              </TabsTrigger>
              <TabsTrigger value="dividendOnly">
                <Banknote className="mr-1.5 size-3.5" />
                Dividend-only
              </TabsTrigger>
              <TabsTrigger value="custom">
                <Target className="mr-1.5 size-3.5" />
                Custom
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {preset === "salaryToYmpe" &&
              `Salary $${CPP_YMPE_2026.toLocaleString("en-CA")} (2026 YMPE) — maxes CPP1 contributions, generates max RRSP room. Remainder as dividends.`}
            {preset === "dividendOnly" &&
              "Zero salary, all after-tax profit as non-eligible dividend. Simpler admin, but no RRSP room or CPP contributions generated."}
            {preset === "custom" &&
              "Seeded from YTD actuals (invoices, expenses, paycheques, dividends). Use as a baseline and iterate."}
          </p>
        </CardContent>
      </Card>

      {/* Inputs + outcome side-by-side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Inputs column */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
            <CardDescription>Slide or type to change the mix.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FieldBlock
              label="Projected revenue"
              value={projectedRevenue}
              hint={`YTD actual: ${formatCAD(baseline.ytdRevenueCents)}`}
            >
              <NumberInputCents
                value={projectedRevenue}
                onChange={setProjectedRevenue}
                max={DIVIDEND_MAX_CENTS * 2}
              />
              <button
                type="button"
                className="text-[11px] text-sky-400 underline-offset-2 hover:underline"
                onClick={() => setProjectedRevenue(baseline.ytdRevenueCents)}
              >
                Fill from YTD
              </button>
            </FieldBlock>

            <FieldBlock
              label="Operating expenses"
              value={projectedOpex}
              hint={`YTD actual: ${formatCAD(baseline.ytdOpexCents)}`}
            >
              <NumberInputCents
                value={projectedOpex}
                onChange={setProjectedOpex}
                max={DIVIDEND_MAX_CENTS}
              />
              <button
                type="button"
                className="text-[11px] text-sky-400 underline-offset-2 hover:underline"
                onClick={() => setProjectedOpex(baseline.ytdOpexCents)}
              >
                Fill from YTD
              </button>
            </FieldBlock>

            <SliderBlock
              label="Salary"
              value={salary}
              onChange={setSalary}
              max={SALARY_MAX_CENTS}
              step={SLIDER_STEP_CENTS}
              marker={{ at: CPP_YMPE_2026 * 100, label: "YMPE" }}
            />

            <SliderBlock
              label="Eligible dividend"
              value={eligibleDiv}
              onChange={setEligibleDiv}
              max={DIVIDEND_MAX_CENTS}
              step={SLIDER_STEP_CENTS}
              marker={{ at: openingGripCents, label: "GRIP cap" }}
            />
            {eligibleDiv > openingGripCents + result.corpTaxableIncomeCents && (
              <p className="text-[11px] text-amber-400">
                Above GRIP cap — excess triggers Part III.1 (20%).
              </p>
            )}

            <SliderBlock
              label="Non-eligible dividend"
              value={nonEligibleDiv}
              onChange={setNonEligibleDiv}
              max={DIVIDEND_MAX_CENTS}
              step={SLIDER_STEP_CENTS}
            />
          </CardContent>
        </Card>

        {/* Outcome column */}
        <div className="space-y-4">
          <OutcomeGrid result={result} />
          <MarginalAndExtras result={result} />
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-400" />
              Compute warnings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.warnings.map((w, i) => (
              <div
                key={i}
                className={`rounded-md border px-3 py-2 text-[12px] ${warningTone(w.severity)}`}
              >
                <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
                  {w.code}
                </span>{" "}
                {w.message}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <SaveScenarioButton
          input={input}
          result={result}
          savedScenarios={savedScenarios}
          onSaved={() => router.refresh()}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadPreset(preset)}
          type="button"
        >
          Reset to {preset === "salaryToYmpe" ? "Salary-to-YMPE" : preset === "dividendOnly" ? "Dividend-only" : "Custom"}
        </Button>
      </div>
    </div>
  );
}

function OutcomeGrid({ result }: { result: ScenarioResult }) {
  const cards = [
    {
      label: "Corp tax",
      value: result.corpTaxCents,
      icon: Landmark,
      tone: "indigo",
    },
    {
      label: "Personal tax",
      value: result.personalTaxCents,
      icon: Calculator,
      tone: "rose",
    },
    {
      label: "Combined tax",
      value: result.totalHouseholdTaxCents,
      icon: Target,
      tone: "amber",
    },
    {
      label: "Net take-home",
      value: result.takeHomeCents,
      icon: Banknote,
      tone: "emerald",
    },
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((c) => {
        const Icon = c.icon;
        const toneMap: Record<string, string> = {
          indigo: "bg-indigo-500/10 ring-indigo-500/30 text-indigo-300",
          rose: "bg-rose-500/10 ring-rose-500/30 text-rose-300",
          amber: "bg-amber-500/10 ring-amber-500/30 text-amber-300",
          emerald: "bg-emerald-500/10 ring-emerald-500/30 text-emerald-300",
        };
        return (
          <div
            key={c.label}
            className="rounded-lg border border-border/40 bg-card/40 p-4"
          >
            <div className="flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-md ring-1 ring-inset ${toneMap[c.tone]}`}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {c.label}
              </div>
            </div>
            <div className="mt-2 font-mono text-xl font-semibold">
              {formatCAD(c.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarginalAndExtras({ result }: { result: ScenarioResult }) {
  return (
    <Card>
      <CardContent className="space-y-1.5 py-4 text-sm">
        <Row
          label="CPP contributions (you)"
          value={formatCAD(result.cppContribCents)}
        />
        <Row
          label="RRSP room generated"
          value={formatCAD(result.rrspRoomGeneratedCents)}
          hint="Applies to next year's T1 deduction"
        />
        <Row
          label="GRIP closing"
          value={formatCAD(result.gripClosingCents)}
        />
        <Row
          label="Combined marginal rate (next $)"
          value={`${(result.marginalRateBps / 100).toFixed(2)}%`}
        />
        <Row
          label="Corp net income for tax"
          value={formatCAD(result.corpNetIncomeForTaxCents)}
        />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-[10px] text-muted-foreground/70">· {hint}</span> : null}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function FieldBlock({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-sm">{formatCAD(value)}</span>
      </div>
      <div className="flex items-center gap-2">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberInputCents({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <Input
      type="number"
      value={Math.round(value / 100)}
      min={0}
      max={Math.round(max / 100)}
      step={1000}
      onChange={(e) => {
        const dollars = Number(e.target.value);
        if (!Number.isFinite(dollars) || dollars < 0) return;
        onChange(Math.round(dollars) * 100);
      }}
      className="h-8 max-w-[10rem] font-mono"
      data-gramm="false"
    />
  );
}

function SliderBlock({
  label,
  value,
  onChange,
  max,
  step,
  marker,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  step: number;
  marker?: { at: number; label: string };
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-sm">{formatCAD(value)}</span>
      </div>
      <Slider
        value={[value]}
        max={max}
        step={step}
        onValueChange={(arr) => onChange(arr[0] ?? 0)}
      />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>$0</span>
        {marker && marker.at > 0 && marker.at <= max ? (
          <span className="text-sky-400">
            {marker.label}: {formatCAD(marker.at)}
          </span>
        ) : null}
        <span>{formatCAD(max)}</span>
      </div>
    </div>
  );
}

function SaveScenarioButton({
  input,
  result,
  savedScenarios,
  onSaved,
}: {
  input: ScenarioInput;
  result: ScenarioResult;
  savedScenarios: PlannerScenario[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const existingNames = new Set(savedScenarios.map((s) => s.name));
  const existing = savedScenarios.find((s) => s.name === name);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      const r = await saveScenario({
        name: trimmed,
        expectedVersion: existing?.version,
        inputs: {
          fiscalYear: input.fiscalYear,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          projectedRevenueCents: input.projectedRevenueCents,
          projectedOpexCents: input.projectedOpexCents,
          salaryCents: input.salaryCents,
          eligibleDividendCents: input.eligibleDividendCents,
          nonEligibleDividendCents: input.nonEligibleDividendCents,
          ccaClaimedCents: input.ccaClaimedCents,
          priorYearAaiiCents: input.priorYearAaiiCents,
          openingGripCents: input.openingGripCents,
        },
      });
      if (r.ok) {
        toast.success(r.ok);
        setOpen(false);
        setName("");
        onSaved();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        size="sm"
        className="gap-1.5"
      >
        <Save className="size-3.5" />
        Save scenario
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save scenario</DialogTitle>
          <DialogDescription>
            Stores the current inputs + a server-recomputed output snapshot. You can pin it to the dashboard afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scenario-name">Name</Label>
            <Input
              id="scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My baseline"
              autoFocus
              maxLength={64}
              data-gramm="false"
            />
            {existingNames.has(name.trim()) && (
              <p className="text-[11px] text-amber-400">
                &ldquo;{name.trim()}&rdquo; exists — saving will overwrite.
              </p>
            )}
          </div>
          <div className="rounded-md border border-border/40 bg-card/30 p-3 text-[11px] text-muted-foreground">
            <div className="grid grid-cols-2 gap-1 font-mono">
              <span>Corp tax</span>
              <span className="text-right">{formatCAD(result.corpTaxCents)}</span>
              <span>Personal tax</span>
              <span className="text-right">{formatCAD(result.personalTaxCents)}</span>
              <span>Combined</span>
              <span className="text-right">{formatCAD(result.totalHouseholdTaxCents)}</span>
              <span>Take-home</span>
              <span className="text-right text-emerald-400">{formatCAD(result.takeHomeCents)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : <><Pin className="mr-1.5 size-3.5" /> Save</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
