import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { format, startOfMonth } from "date-fns";
import { AlertTriangle, CalendarClock, Check, CircleCheck, Hourglass } from "lucide-react";
import { db } from "@/lib/db/client";
import { deadlines, remittances } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries";
import { syncAnnualDeadlines } from "@/server/actions/deadlines";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeadlineRow } from "@/components/calendar/deadline-row";
import { CalendarRemittanceRow } from "@/components/calendar/remittance-row";
import { AddDeadlineButton } from "@/components/calendar/add-deadline-button";
import { ViewToggle } from "@/components/calendar/view-toggle";
import { CalendarShell } from "@/components/calendar/calendar-shell";
import type { UnifiedItem } from "@/components/calendar/day-detail-dialog";

export const dynamic = "force-dynamic";

type Bucket = "overdue" | "due_soon" | "upcoming" | "completed";

function daysBetweenISO(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}

function bucketFor(item: UnifiedItem, today: string): Bucket {
  if (item.completed) return "completed";
  const d = daysBetweenISO(today, item.dueDate);
  if (d < 0) return "overdue";
  if (d <= 60) return "due_soon";
  return "upcoming";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "list" ? "list" : "calendar";
  const defaultMonth = format(startOfMonth(new Date()), "yyyy-MM");
  const monthIso = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : defaultMonth;

  // Idempotent sync — reflects freshly-saved Settings changes with no click.
  await syncAnnualDeadlines();

  const [s, allDeadlines, allRemittances] = await Promise.all([
    getSettings(),
    db.select().from(deadlines).orderBy(asc(deadlines.dueDate)),
    db.select().from(remittances).orderBy(desc(remittances.dueDate)),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const items: UnifiedItem[] = [
    ...allDeadlines.map(
      (d): UnifiedItem => ({
        kind: "deadline",
        dueDate: d.dueDate,
        completed: d.completed,
        row: d,
      }),
    ),
    ...allRemittances.map(
      (r): UnifiedItem => ({
        kind: "remittance",
        dueDate: r.dueDate,
        completed: r.paidAt !== null,
        row: r,
      }),
    ),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deadlines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CRA + Ontario obligations, unified with payroll remittances. Annual items
            auto-derive from your fiscal settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle current={view} />
          <AddDeadlineButton />
        </div>
      </div>

      {!s?.incorporationDate && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300/90">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div>
            No incorporation date set — your Ontario annual return deadline won&rsquo;t
            be derived.{" "}
            <Link href="/settings" className="underline hover:text-amber-200">
              Set it in Settings → Fiscal
            </Link>
            .
          </div>
        </div>
      )}

      {view === "calendar" ? (
        <CalendarShell initialMonthIso={monthIso} items={items} />
      ) : (
        <ListView items={items} today={today} />
      )}
    </div>
  );
}

function ListView({ items, today }: { items: UnifiedItem[]; today: string }) {
  const grouped: Record<Bucket, UnifiedItem[]> = {
    overdue: [],
    due_soon: [],
    upcoming: [],
    completed: [],
  };
  for (const it of items) grouped[bucketFor(it, today)].push(it);

  grouped.overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  grouped.due_soon.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  grouped.upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  grouped.completed.sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  const hasAny = items.length > 0;
  if (!hasAny) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-inset ring-sky-500/30">
            <CalendarClock className="size-6 text-sky-400" />
          </div>
          <CardTitle>No deadlines yet</CardTitle>
          <CardDescription>
            Finalize fiscal year-end and incorporation date in Settings so the
            annual deadlines auto-populate.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  return (
    <>
      <BucketSection
        title="Overdue"
        description="Past due date, still open. File ASAP — CRA charges daily interest."
        tone="rose"
        icon={AlertTriangle}
        items={grouped.overdue}
        today={today}
      />
      <BucketSection
        title="Due soon"
        description="Within 60 days."
        tone="amber"
        icon={Hourglass}
        items={grouped.due_soon}
        today={today}
      />
      <BucketSection
        title="Upcoming"
        description="More than 60 days out."
        tone="indigo"
        icon={CalendarClock}
        items={grouped.upcoming}
        today={today}
      />
      <BucketSection
        title="Completed"
        description="Filed and done. Kept for your audit trail."
        tone="emerald"
        icon={CircleCheck}
        items={grouped.completed}
        today={today}
        collapsed
      />
    </>
  );
}

function BucketSection({
  title,
  description,
  tone,
  icon: Icon,
  items,
  today,
  collapsed = false,
}: {
  title: string;
  description: string;
  tone: "rose" | "amber" | "indigo" | "emerald";
  icon: React.ComponentType<{ className?: string }>;
  items: UnifiedItem[];
  today: string;
  collapsed?: boolean;
}) {
  if (items.length === 0) return null;
  const tones = {
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    indigo: "border-indigo-500/30 bg-indigo-500/5 text-indigo-300",
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  } as const;

  const table = (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold w-28">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Title</th>
                <th className="px-4 py-3 text-left font-semibold w-44">Due</th>
                <th className="px-4 py-3 text-left font-semibold w-40">Status</th>
                <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) =>
                it.kind === "deadline" ? (
                  <DeadlineRow key={`d:${it.row.id}`} deadline={it.row} today={today} />
                ) : (
                  <CalendarRemittanceRow
                    key={`r:${it.row.id}`}
                    remittance={it.row}
                    today={today}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <section className="space-y-3">
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${tones[tone]}`}>
        <Icon className="size-4" />
        <span className="font-semibold">
          {title}{" "}
          <span className="font-normal opacity-75">
            · {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </span>
        <Separator orientation="vertical" className="mx-1 h-3" />
        <span className="opacity-80">{description}</span>
      </div>
      {collapsed ? <CollapsedBucket>{table}</CollapsedBucket> : table}
    </section>
  );
}

function CollapsedBucket({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none select-none text-xs text-muted-foreground hover:text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3" />
          Show
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

