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

      <CardHeader className="pb-2">
        {/* Top row: label + icon chip. Value lives below on its own full-width
            row so long amounts (up to $1,000,000.00+) never collide with the
            icon, regardless of card column count. */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
              t.bg,
              t.border,
            )}
          >
            <Icon className={cn("size-[1.05rem]", t.text)} />
          </div>
        </div>
        <div className="text-3xl font-bold leading-none tracking-tight">
          {value}
        </div>
      </CardHeader>

      {hint && (
        <CardContent className="relative pt-0">
          <div className="text-xs text-muted-foreground">{hint}</div>
        </CardContent>
      )}
    </Card>
  );
}
