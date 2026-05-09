"use client";

import { useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/tones";
import { TONE } from "@/lib/tones";
import { DayDetailDialog, type UnifiedItem } from "./day-detail-dialog";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORY_TONE: Record<string, Tone> = {
  hst: "sky",
  t2: "indigo",
  t4: "amber",
  t1: "violet",
  annual_return: "cyan",
  payroll: "rose",
  other: "emerald",
};

type DayChip = {
  id: string;
  label: string;
  tone: Tone;
  completed: boolean;
};

function chipFor(item: UnifiedItem): DayChip {
  if (item.kind === "deadline") {
    return {
      id: `d:${item.row.id}`,
      label: item.row.title,
      tone: CATEGORY_TONE[item.row.category] ?? "emerald",
      completed: item.completed,
    };
  }
  return {
    id: `r:${item.row.id}`,
    label: `Source deductions`,
    tone: CATEGORY_TONE.payroll!,
    completed: item.completed,
  };
}

export function MonthGrid({
  monthIso,
  items,
}: {
  monthIso: string;
  items: UnifiedItem[];
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const targetMonth = useMemo(() => parseISO(monthIso + "-01"), [monthIso]);
  const gridStart = startOfWeek(startOfMonth(targetMonth), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(targetMonth), { weekStartsOn: 0 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  // Bucket items by due-date ISO for O(1) lookup.
  const byDay = useMemo(() => {
    const m = new Map<string, UnifiedItem[]>();
    for (const it of items) {
      const key = it.dueDate;
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    // Stable sort: incomplete first (so overdue/due stay visible), then by kind.
    for (const [k, arr] of m) {
      arr.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.kind.localeCompare(b.kind);
      });
      m.set(k, arr);
    }
    return m;
  }, [items]);

  const selectedItems = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <div className="space-y-0">
      {/* Weekday header */}
      <div className="grid grid-cols-7 rounded-t-md border border-border/60 bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "px-2 py-2 text-center",
              i < WEEKDAYS.length - 1 && "border-r border-border/40",
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 overflow-hidden rounded-b-md border border-t-0 border-border/60">
        {days.map((day, idx) => {
          const dayIso = format(day, "yyyy-MM-dd");
          const inMonth = isSameMonth(day, targetMonth);
          const todayFlag = isToday(day);
          const dayItems = byDay.get(dayIso) ?? [];
          const visibleChips = dayItems.slice(0, 2);
          const overflow = dayItems.length - visibleChips.length;
          const weekend = isWeekend(day);
          const col = idx % 7;
          const row = Math.floor(idx / 7);

          return (
            <button
              type="button"
              key={dayIso}
              onClick={() => setSelectedDay(dayIso)}
              className={cn(
                "group relative flex min-h-[96px] cursor-pointer flex-col gap-1 border-border/40 bg-background/40 p-1.5 text-left transition-colors hover:bg-muted/20 sm:min-h-[112px]",
                col < 6 && "border-r",
                row < Math.floor(days.length / 7) - (days.length % 7 === 0 ? 1 : 0) && "border-b",
                !inMonth && "bg-muted/5 opacity-45",
                weekend && inMonth && "bg-muted/10",
                todayFlag && "bg-emerald-500/5",
              )}
              aria-label={`${format(day, "MMMM d, yyyy")} — ${dayItems.length} item${dayItems.length === 1 ? "" : "s"}`}
            >
              {/* Day number */}
              <div className="flex items-start justify-between">
                <span
                  className={cn(
                    "inline-flex items-center justify-center text-xs font-medium",
                    todayFlag
                      ? "size-6 rounded-full bg-emerald-500 text-emerald-50 shadow-sm shadow-emerald-500/30"
                      : inMonth
                        ? "text-foreground/80"
                        : "text-muted-foreground/60",
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayItems.length > 0 && (
                  <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {dayItems.length}
                  </span>
                )}
              </div>

              {/* Chips */}
              <div className="flex flex-col gap-0.5">
                {visibleChips.map((it) => {
                  const chip = chipFor(it);
                  return <MiniChip key={chip.id} chip={chip} />;
                })}
                {overflow > 0 && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border/60">
                    +{overflow} more
                  </span>
                )}
              </div>

              {/* Subtle focus / hover ring */}
              {todayFlag && (
                <span className="pointer-events-none absolute inset-0 rounded-none ring-1 ring-inset ring-emerald-500/30" />
              )}
            </button>
          );
        })}
      </div>

      <DayDetailDialog
        open={selectedDay !== null}
        onOpenChange={(v) => {
          if (!v) setSelectedDay(null);
        }}
        dayIso={selectedDay}
        items={selectedItems}
      />
    </div>
  );
}

function MiniChip({ chip }: { chip: DayChip }) {
  const t = TONE[chip.tone];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-colors",
        t.bg,
        t.text,
        t.border,
        chip.completed && "opacity-45 line-through decoration-current/40",
      )}
      title={chip.label}
    >
      {chip.label}
    </span>
  );
}

