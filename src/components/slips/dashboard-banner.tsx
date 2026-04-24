import Link from "next/link";
import { FileCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type SlipDeadlineRow = {
  type: "T4" | "T5";
  taxYear: number;
  dueDate: string;
};

/**
 * Dashboard banner for open slip deadlines. Shows when at least one T4 or
 * T5 deadline is open (not filed, not marked complete) AND due within the
 * next 60 days OR already overdue. Hidden otherwise.
 *
 * Amber tint when all open deadlines are still in the future (≤60 days).
 * Rose tint when at least one is overdue — CRA will assess late-filing
 * penalties (day 1 of overdue = $100 + $10/day up to $1,500 per slip).
 */
export function SlipDeadlineBanner({
  openSlips,
  today,
}: {
  openSlips: SlipDeadlineRow[];
  today: string;
}) {
  if (openSlips.length === 0) return null;

  const withDays = openSlips.map((s) => ({
    ...s,
    daysToDue: Math.round(
      (new Date(s.dueDate + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) /
        86_400_000,
    ),
  }));
  const anyOverdue = withDays.some((s) => s.daysToDue < 0);
  const palette = anyOverdue
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

  const sorted = [...withDays].sort((a, b) => a.daysToDue - b.daysToDue);
  const soonest = sorted[0]!;
  const headline = anyOverdue
    ? `${soonest.type} slip for CY ${soonest.taxYear} is ${-soonest.daysToDue} days overdue`
    : `${soonest.type} slip for CY ${soonest.taxYear} due in ${soonest.daysToDue} days`;

  const others = sorted.slice(1);
  const othersSummary =
    others.length > 0
      ? others
          .map((o) =>
            o.daysToDue < 0
              ? `${o.type} CY ${o.taxYear} overdue ${-o.daysToDue}d`
              : `${o.type} CY ${o.taxYear} due in ${o.daysToDue}d`,
          )
          .join(" · ")
      : "CRA charges $100 + $10/day per slip for late filing (max $1,500/slip).";

  return (
    <Link
      href={`/slips/${soonest.taxYear}`}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors",
        palette.border,
        palette.bg,
        palette.hover,
      )}
    >
      <div className="flex items-center gap-3">
        <FileCheck className={cn("size-5 shrink-0", palette.text)} />
        <div>
          <div className="font-semibold">
            <span className={palette.text}>{headline}.</span>
          </div>
          <div className="text-xs text-muted-foreground">{othersSummary}</div>
        </div>
      </div>
      <ChevronRight className={cn("size-4 shrink-0", palette.text)} />
    </Link>
  );
}
