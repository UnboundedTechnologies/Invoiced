import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Remittance } from "@/lib/db/schema";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { CategoryPill } from "./category-pill";

/**
 * Display-only remittance row on /calendar. The full mark-paid / delete
 * workflow lives on /paycheques — this row is a glance + link.
 */
export function CalendarRemittanceRow({
  remittance,
  today,
}: {
  remittance: Remittance;
  today: string;
}) {
  const daysToDue = daysBetweenISO(today, remittance.dueDate);
  const countdown = remittance.paidAt
    ? `Paid ${formatLongDate(remittance.paidAt.toISOString().slice(0, 10))}`
    : daysToDue < 0
      ? `${Math.abs(daysToDue)} day${daysToDue === -1 ? "" : "s"} overdue`
      : daysToDue === 0
        ? "Due today"
        : `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`;

  return (
    <tr className="border-b border-border/30 transition-colors hover:bg-muted/20">
      <td className="px-4 py-3">
        <CategoryPill category="payroll" />
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">
          Source deductions: {remittance.periodStart} → {remittance.periodEnd}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatCAD(remittance.amountCents)} · managed on /paycheques
        </div>
        {remittance.confirmationNumber && (
          <div className="mt-0.5 font-mono text-[11px] text-emerald-400/80">
            CRA # {remittance.confirmationNumber}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs">{formatLongDate(remittance.dueDate)}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{countdown}</td>
      <td className="px-2 py-3">
        <div className="flex items-center justify-end">
          <Link
            href="/paycheques"
            aria-label="Open paycheques"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function daysBetweenISO(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}
