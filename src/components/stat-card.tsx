import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  delayMs = 0,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  delayMs?: number;
}) {
  const t = TONE[tone];
  return (
    <Card
      className={cn(
        "relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards",
      )}
      style={{ animationDuration: "500ms", animationDelay: `${delayMs}ms` }}
    >
      {/* Top gradient bar */}
      <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", t.topBar)} />

      {/* Soft halo behind icon */}
      <div
        aria-hidden
        className={cn(
          "absolute -right-6 -top-6 size-32 rounded-full blur-3xl opacity-30",
          t.bg,
        )}
      />

      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="space-y-1.5 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-3xl font-bold tracking-tight">{value}</div>
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            t.bg,
            t.border,
          )}
        >
          <Icon className={cn("size-5", t.text)} />
        </div>
      </CardHeader>

      <CardContent className="relative pt-0">
        {/* Sparkline placeholder — flat baseline with a fade */}
        <svg
          viewBox="0 0 200 32"
          preserveAspectRatio="none"
          className={cn("h-8 w-full opacity-60", t.text)}
          aria-hidden
        >
          <defs>
            <linearGradient id={`spark-${tone}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,24 C20,22 40,18 60,18 S100,22 120,16 160,12 200,14 L200,32 L0,32 Z"
            fill={`url(#spark-${tone})`}
          />
          <path
            d="M0,24 C20,22 40,18 60,18 S100,22 120,16 160,12 200,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
