import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCAD, formatLongDate } from "@/lib/utils";

export function LoanRiskBanner({
  daysUntilWorstTrigger,
  worstUnpaidCents,
  worstTriggerDate,
  pastDeadlineCount,
}: {
  daysUntilWorstTrigger: number | null;
  worstUnpaidCents: number;
  worstTriggerDate: string | null;
  pastDeadlineCount: number;
}) {
  if (daysUntilWorstTrigger === null) return null;

  const isPast = pastDeadlineCount > 0 || daysUntilWorstTrigger < 0;
  const palette = isPast
    ? {
        border: "border-rose-500/40",
        bg: "bg-rose-500/5",
        text: "text-rose-400",
        hover: "hover:text-rose-200",
      }
    : {
        border: "border-amber-500/40",
        bg: "bg-amber-500/5",
        text: "text-amber-400",
        hover: "hover:text-amber-200",
      };

  const headline = isPast
    ? `${pastDeadlineCount || 1} draw(s) past the s.15(2.6) deadline.`
    : `A draw hits the s.15(2.6) deadline in ${daysUntilWorstTrigger} day${daysUntilWorstTrigger === 1 ? "" : "s"}.`;
  const subline = isPast
    ? `The unpaid principal lands as income on your T1 in the draw's calendar year, reportable on T4A box 117.`
    : `${formatCAD(worstUnpaidCents)} outstanding, trigger ${worstTriggerDate ? formatLongDate(worstTriggerDate) : "soon"}. Repay before then to stay in s.15(2.6).`;

  return (
    <Link
      href="/shareholder-loan"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors",
        palette.border,
        palette.bg,
        palette.hover,
      )}
    >
      <div className="flex items-center gap-3">
        <CalendarClock className={cn("size-5 shrink-0", palette.text)} />
        <div>
          <div className="font-semibold">
            <span className={palette.text}>{headline}</span>
          </div>
          <div className="text-xs text-muted-foreground">{subline}</div>
        </div>
      </div>
      <ChevronRight className={cn("size-4 shrink-0", palette.text)} />
    </Link>
  );
}
