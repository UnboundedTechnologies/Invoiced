"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { Button } from "@/components/ui/button";

export function MonthNav({ monthIso }: { monthIso: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = parseISO(monthIso + "-01");
  const prev = format(subMonths(current, 1), "yyyy-MM");
  const next = format(addMonths(current, 1), "yyyy-MM");
  const todayIso = format(startOfMonth(new Date()), "yyyy-MM");

  function go(m: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (m === todayIso) params.delete("month");
    else params.set("month", m);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const title = format(current, "MMMM yyyy");
  const isToday = monthIso === todayIso;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => go(prev)}
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
        onClick={() => go(next)}
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-1 h-8 text-xs"
        onClick={() => go(todayIso)}
        disabled={isToday}
      >
        Today
      </Button>
    </div>
  );
}
