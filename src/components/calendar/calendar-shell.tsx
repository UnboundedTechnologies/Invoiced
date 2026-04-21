"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { format, parseISO, startOfMonth } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MonthGrid } from "./month-grid";
import { MonthNav } from "./month-nav";
import type { UnifiedItem } from "./day-detail-dialog";

export function CalendarShell({
  initialMonthIso,
  items,
}: {
  initialMonthIso: string;
  items: UnifiedItem[];
}) {
  const [monthIso, setMonthIso] = useState(initialMonthIso);

  // Keep ?month= in the URL so refresh / deep-link works, but do it with
  // history.replaceState so we don't trigger a Next.js RSC round-trip on
  // every prev/next click.
  useEffect(() => {
    const defaultMonth = format(startOfMonth(new Date()), "yyyy-MM");
    const url = new URL(window.location.href);
    if (monthIso === defaultMonth) {
      url.searchParams.delete("month");
    } else {
      url.searchParams.set("month", monthIso);
    }
    const qs = url.searchParams.toString();
    const path = url.pathname + (qs ? `?${qs}` : "");
    window.history.replaceState(null, "", path);
  }, [monthIso]);

  const onMonthChange = useCallback((m: string) => {
    setMonthIso(m);
  }, []);

  const monthStart = startOfMonth(parseISO(monthIso + "-01"));
  const monthPrefix = format(monthStart, "yyyy-MM");
  const today = format(new Date(), "yyyy-MM-dd");
  const monthItems = items.filter((i) => i.dueDate.startsWith(monthPrefix));
  const monthOverdue = monthItems.filter((i) => !i.completed && i.dueDate < today).length;
  const monthOpen = monthItems.filter((i) => !i.completed).length;
  const monthCompleted = monthItems.length - monthOpen;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <MonthNav monthIso={monthIso} onChange={onMonthChange} />
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {monthOverdue > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-400">
              <AlertTriangle className="size-3.5" />
              {monthOverdue} overdue
            </span>
          )}
          <span>{monthOpen} open</span>
          <span>{monthCompleted} done</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <MonthGrid monthIso={monthIso} items={items} />
      </CardContent>
    </Card>
  );
}
