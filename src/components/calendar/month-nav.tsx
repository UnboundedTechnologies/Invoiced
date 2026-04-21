"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { Button } from "@/components/ui/button";

export function MonthNav({
  monthIso,
  onChange,
}: {
  monthIso: string;
  onChange: (monthIso: string) => void;
}) {
  const current = parseISO(monthIso + "-01");
  const prev = format(subMonths(current, 1), "yyyy-MM");
  const next = format(addMonths(current, 1), "yyyy-MM");
  const todayIso = format(startOfMonth(new Date()), "yyyy-MM");
  const title = format(current, "MMMM yyyy");
  const isToday = monthIso === todayIso;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => onChange(prev)}
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="min-w-[10rem] text-center text-sm font-semibold tracking-tight">
        {title}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => onChange(next)}
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-1 h-8 text-xs"
        onClick={() => onChange(todayIso)}
        disabled={isToday}
      >
        Today
      </Button>
    </div>
  );
}
