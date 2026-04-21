"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CircleCheck, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import type { Deadline, Remittance } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteDeadline,
  markDeadlineComplete,
  markDeadlineIncomplete,
} from "@/server/actions/deadlines";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { CategoryPill } from "./category-pill";

export type UnifiedItem =
  | { kind: "deadline"; dueDate: string; completed: boolean; row: Deadline }
  | { kind: "remittance"; dueDate: string; completed: boolean; row: Remittance };

export function DayDetailDialog({
  open,
  onOpenChange,
  dayIso,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dayIso: string | null;
  items: UnifiedItem[];
}) {
  if (!dayIso) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{formatLongDate(dayIso)}</DialogTitle>
          <DialogDescription>
            {items.length} item{items.length === 1 ? "" : "s"} on this day
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due.</p>
          ) : (
            items.map((it) =>
              it.kind === "deadline" ? (
                <DeadlineCard key={`d:${it.row.id}`} deadline={it.row} onClose={() => onOpenChange(false)} />
              ) : (
                <RemittanceCard
                  key={`r:${it.row.id}`}
                  remittance={it.row}
                  onClose={() => onOpenChange(false)}
                />
              ),
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeadlineCard({ deadline, onClose }: { deadline: Deadline; onClose: () => void }) {
  const router = useRouter();
  const [showComplete, setShowComplete] = useState(false);
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      const r = await deleteDeadline(deadline.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
        onClose();
      }
      if (r.error) toast.error(r.error);
    });
  }

  const href = resourceHref(deadline);

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <CategoryPill category={deadline.category} />
            {deadline.completed && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                Filed
              </span>
            )}
          </div>
          <div className="text-sm font-medium leading-snug">{deadline.title}</div>
          {deadline.description && (
            <div className="text-xs text-muted-foreground">{deadline.description}</div>
          )}
          {deadline.craConfirmationNumber && (
            <div className="font-mono text-[11px] text-emerald-400/80">
              CRA # {deadline.craConfirmationNumber}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {deadline.completed ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onReopen}
              disabled={pending}
              aria-label="Reopen"
              title="Reopen"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
                onClick={() => setShowComplete(true)}
                aria-label="Mark complete"
                title="Mark complete"
              >
                <CircleCheck className="size-3.5" />
              </Button>
              {!deadline.sourceKey && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
                  onClick={onDelete}
                  disabled={pending}
                  aria-label="Delete"
                  title="Delete"
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
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          )}
        </div>
      </div>

      <MarkCompleteInlineDialog
        open={showComplete}
        onOpenChange={setShowComplete}
        deadlineId={deadline.id}
        title={deadline.title}
      />
    </div>
  );
}

function RemittanceCard({
  remittance,
  onClose: _onClose,
}: {
  remittance: Remittance;
  onClose: () => void;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <CategoryPill category="payroll" />
            {remittance.paidAt && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                Paid
              </span>
            )}
          </div>
          <div className="text-sm font-medium leading-snug">
            Source deductions — {remittance.periodStart} → {remittance.periodEnd}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatCAD(remittance.amountCents)} · managed on{" "}
            <Link href="/paycheques" className="text-foreground underline decoration-muted hover:decoration-foreground">
              /paycheques
            </Link>
          </div>
          {remittance.confirmationNumber && (
            <div className="font-mono text-[11px] text-emerald-400/80">
              CRA # {remittance.confirmationNumber}
            </div>
          )}
        </div>
        <Link
          href="/paycheques"
          aria-label="Open paycheques"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function MarkCompleteInlineDialog({
  open,
  onOpenChange,
  deadlineId,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deadlineId: string;
  title: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [state, action, pending] = useActionState(
    markDeadlineComplete,
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      onOpenChange(false);
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="id" value={deadlineId} />
          <DialogHeader>
            <DialogTitle>Mark complete — {title}</DialogTitle>
            <DialogDescription>
              Paste the CRA / Ontario registry confirmation number if you have one (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="craConfirmationNumber">Confirmation # (optional)</Label>
              <Input
                id="craConfirmationNumber"
                name="craConfirmationNumber"
                autoComplete="off"
                data-gramm="false"
                placeholder="e.g., 123456789012"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filedAt">Filed on</Label>
              <Input id="filedAt" name="filedAt" type="date" required defaultValue={today} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? "Saving…" : "Mark complete"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
