"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleAlert, CircleDashed, Clock, Minus, Pencil } from "lucide-react";
import type { PsbChecklistItem } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { quickToggleItem, updateChecklistItem } from "@/server/actions/psb";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string; ring: string }
> = {
  not_started: {
    label: "Not started",
    icon: CircleDashed,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/30",
  },
  in_progress: {
    label: "In progress",
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
  },
  done: {
    label: "Done",
    icon: Check,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30",
  },
  not_applicable: {
    label: "N/A",
    icon: Minus,
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    ring: "ring-border",
  },
};

export function PsbChecklistRow({ item }: { item: PsbChecklistItem }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const meta = STATUS_META[item.status] ?? STATUS_META.not_started!;
  const Icon = meta.icon;

  function onQuickChange(next: string) {
    startTransition(async () => {
      const r = await quickToggleItem(item.id, next);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border/40 bg-muted/20 p-4 transition-colors sm:flex-row sm:items-start",
          item.critical && item.status !== "done" && "border-rose-500/40 bg-rose-500/5",
        )}
      >
        <div
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            meta.bg,
            meta.ring,
          )}
        >
          <Icon className={cn("size-4", meta.color)} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.label}</span>
            {item.critical && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-400 ring-1 ring-inset ring-rose-500/30">
                Critical
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              Weight {item.weight}
            </span>
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground">{item.description}</p>
          )}
          {item.notes && (
            <p className="text-[11px] italic text-muted-foreground">Note: {item.notes}</p>
          )}
          {item.lastReviewedAt && (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Reviewed {new Date(item.lastReviewedAt).toISOString().slice(0, 10)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={item.status} onValueChange={onQuickChange} disabled={pending}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_started">Not started</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="not_applicable">N/A</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setEditOpen(true)}
            aria-label="Edit notes"
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{item.label}</DialogTitle>
            <DialogDescription>{item.description}</DialogDescription>
          </DialogHeader>
          <EditForm item={item} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditForm({ item, onDone }: { item: PsbChecklistItem; onDone: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    formData.set("status", status);
    formData.set("notes", notes);
    formData.set("evidenceDocumentId", "");
    const r = await updateChecklistItem(item.id, undefined, formData);
    setPending(false);
    if (r.ok) {
      toast.success(r.ok);
      router.refresh();
      onDone();
    }
    if (r.error) toast.error(r.error);
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_started">Not started</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="not_applicable">N/A</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes / evidence</Label>
        <Textarea
          id="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Link to MSA clause, insurance policy, website URL, etc."
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export { CircleAlert };
