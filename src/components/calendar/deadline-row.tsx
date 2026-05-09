"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import type { Deadline } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteDeadline,
  markDeadlineIncomplete,
} from "@/server/actions/deadlines";
import { formatLongDate } from "@/lib/utils";
import { CategoryPill } from "./category-pill";
import { MarkCompleteDialog } from "./mark-complete-dialog";

/** Map a deadline to the in-app page it refers to, if any. */
function resourceHref(d: Pick<Deadline, "category" | "sourceKey">): string | null {
  if (!d.sourceKey) return null;
  const [kind, year] = d.sourceKey.split(":");
  switch (kind) {
    case "hst":
      return `/hst/${year}`;
    case "t2":
      return `/corp-tax`;
    case "t4":
      return `/paycheques`;
    case "annual_return":
      return `/settings`;
    default:
      return null;
  }
}

export function DeadlineRow({ deadline, today }: { deadline: Deadline; today: string }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const daysToDue = daysBetweenISO(today, deadline.dueDate);
  const href = resourceHref(deadline);

  const countdown = deadline.completed
    ? deadline.completedAt
      ? `Filed ${formatLongDate(deadline.completedAt.toISOString().slice(0, 10))}`
      : "Filed"
    : daysToDue < 0
      ? `${Math.abs(daysToDue)} day${daysToDue === -1 ? "" : "s"} overdue`
      : daysToDue === 0
        ? "Due today"
        : `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`;

  function onReopen() {
    startTransition(async () => {
      const r = await markDeadlineIncomplete(deadline.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function onDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteDeadline(deadline.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <tr className="border-b border-border/30 transition-colors hover:bg-muted/20">
      <td className="px-4 py-3">
        <CategoryPill category={deadline.category} />
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{deadline.title}</div>
        {deadline.description && (
          <div className="text-[11px] text-muted-foreground">{deadline.description}</div>
        )}
        {deadline.craConfirmationNumber && (
          <div className="mt-0.5 font-mono text-[11px] text-emerald-400/80">
            CRA # {deadline.craConfirmationNumber}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs">{formatLongDate(deadline.dueDate)}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{countdown}</td>
      <td className="px-2 py-3">
        <div className="flex items-center justify-end gap-1">
          {deadline.completed ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReopen}
              disabled={pending}
              aria-label="Re-open"
              title="Reopen (undo complete)"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : (
            <>
              <MarkCompleteDialog deadlineId={deadline.id} title={deadline.title} />
              {!deadline.sourceKey && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
                  onClick={() => setDeleteOpen(true)}
                  disabled={pending}
                  aria-label="Delete deadline"
                  title="Delete (manual entries only)"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </>
          )}
          {href && (
            <Link
              href={href}
              aria-label="Open related page"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          )}
        </div>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this deadline?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes &ldquo;{deadline.title}&rdquo;. Auto-generated deadlines
                (HST, T2, T4, annual return) can&rsquo;t be deleted here; change
                the underlying setting instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
}

function daysBetweenISO(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}
