import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PsbRiskMeter({
  score,
  risk,
  itemsDone,
  itemsTotal,
  criticalMissing,
}: {
  score: number;
  risk: "green" | "amber" | "red";
  itemsDone: number;
  itemsTotal: number;
  criticalMissing: boolean;
}) {
  const palette = {
    green: {
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-500/30",
      grad: "from-emerald-500/80 via-emerald-400 to-cyan-400/70",
      label: "Low risk",
      verdict: "Strong defensibility. Keep the review cadence.",
      Icon: ShieldCheck,
    },
    amber: {
      text: "text-amber-400",
      bg: "bg-amber-500/10",
      ring: "ring-amber-500/30",
      grad: "from-amber-500/80 via-orange-400 to-rose-400/70",
      label: "Moderate risk",
      verdict: "Several PSB signals unresolved. Work the top-3 fixes below.",
      Icon: ShieldQuestion,
    },
    red: {
      text: "text-rose-400",
      bg: "bg-rose-500/10",
      ring: "ring-rose-500/30",
      grad: "from-rose-500/80 via-pink-400 to-orange-400/70",
      label: "High risk",
      verdict: criticalMissing
        ? "A critical defense is missing. Before scaling payroll/dividends, close the gap."
        : "Score is low. Prioritise the top-3 fixes below.",
      Icon: ShieldAlert,
    },
  }[risk];
  const Icon = palette.Icon;

  return (
    <Card className="relative overflow-hidden">
      <div className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", palette.grad)} />
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">PSB risk</div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tracking-tight">{score}</span>
            <span className="text-xs text-muted-foreground">/ 100</span>
            <span className={cn("ml-2 text-sm font-semibold", palette.text)}>{palette.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{palette.verdict}</p>
          <div className="pt-1 text-[11px] text-muted-foreground">
            {itemsDone} of {itemsTotal} evidence items complete.
          </div>
        </div>
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            palette.bg,
            palette.ring,
          )}
        >
          <Icon className={cn("size-6", palette.text)} />
        </div>
      </CardHeader>
      <CardContent className="relative pt-0">
        <div className="h-2 w-full rounded-full bg-muted/40">
          <div
            className={cn("h-2 rounded-full bg-gradient-to-r", palette.grad)}
            style={{ width: `${Math.max(4, score)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
