import { Building2, Clock, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCAD, formatLongDate } from "@/lib/utils";

/** $200K retained earnings — playbook trigger for considering Holdco. */
const HOLDCO_THRESHOLD_CENTS = 200_000_00;

/** 24 months of QSBC preceding-hold for the $1.275M LCGE (ITA s.110.6). */
const QSBC_PRECEDING_HOLD_MONTHS = 24;

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const m = d.getUTCMonth() + months;
  const targetY = d.getUTCFullYear() + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return `${targetY}-${String(targetM + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso + "T00:00:00Z").getTime() -
      new Date(fromIso + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

export function HoldcoCountdownCard({
  incorporationDate,
  retainedEarningsCents,
}: {
  incorporationDate: string | null;
  retainedEarningsCents: number;
}) {
  if (!incorporationDate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdco / QSBC readiness</CardTitle>
          <CardDescription>
            Set <span className="font-mono text-foreground">incorporationDate</span> in /settings to unlock the QSBC 24-month countdown and Holdco-trigger nudge.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const qsbcEligibleFrom = addMonthsIso(incorporationDate, QSBC_PRECEDING_HOLD_MONTHS);
  const daysToQsbc = daysBetween(today, qsbcEligibleFrom);
  const qsbcReady = daysToQsbc <= 0;

  const nearHoldco =
    retainedEarningsCents >= HOLDCO_THRESHOLD_CENTS * 0.5; // surface warmly at $100K
  const crossedHoldco = retainedEarningsCents >= HOLDCO_THRESHOLD_CENTS;

  const tone = crossedHoldco
    ? "border-amber-500/40 bg-amber-500/5"
    : qsbcReady
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-sky-500/30 bg-sky-500/5";

  return (
    <Card className={tone}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-sky-500/15 ring-1 ring-inset ring-sky-500/30">
            <Building2 className="size-5 text-sky-400" />
          </div>
          <div>
            <CardTitle className="text-base">Holdco / QSBC readiness</CardTitle>
            <CardDescription>
              Display-only — no structure is created. Playbook trigger: $200K retained earnings OR a 24-month exit horizon.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border/40 bg-card/30 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />
              QSBC 24-month clock
            </div>
            <div className="text-lg font-semibold">
              {qsbcReady ? (
                <span className="text-emerald-400">Eligible</span>
              ) : (
                <span>{daysToQsbc} days</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Incorp {formatLongDate(incorporationDate)} · LCGE window opens {formatLongDate(qsbcEligibleFrom)}
            </p>
          </div>
          <div className="rounded-md border border-border/40 bg-card/30 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="size-3" />
              Retained earnings
            </div>
            <div
              className={`text-lg font-semibold ${
                crossedHoldco
                  ? "text-amber-400"
                  : nearHoldco
                    ? "text-sky-300"
                    : ""
              }`}
            >
              {formatCAD(retainedEarningsCents)}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {crossedHoldco
                ? "Exceeds $200K playbook trigger — consider a Holdco review with your CPA."
                : nearHoldco
                  ? "Approaching $200K — revisit at year-end planning."
                  : `$${Math.round((HOLDCO_THRESHOLD_CENTS - retainedEarningsCents) / 100).toLocaleString("en-CA")} to Holdco trigger.`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
