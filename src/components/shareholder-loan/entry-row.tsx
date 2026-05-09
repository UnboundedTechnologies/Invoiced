"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import type { ShareholderLoanEntry } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ShareholderLoanEntryForm } from "./entry-form";
import { ReclassifyDrawDialog } from "./reclassify-dialog";
import { deleteLoanEntry } from "@/server/actions/shareholder-loan";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const TYPE_PILL: Record<
  ShareholderLoanEntry["type"],
  { label: string; tone: string }
> = {
  draw: { label: "Draw", tone: "bg-amber-500/10 text-amber-400 ring-amber-500/30" },
  repayment: { label: "Repayment", tone: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" },
  interest_payment: {
    label: "Interest",
    tone: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/30",
  },
  reclassification: {
    label: "Reclassified",
    tone: "bg-violet-500/10 text-violet-400 ring-violet-500/30",
  },
};

export function LoanEntryRow({
  entry,
  fyeMonth,
  fyeDay,
  runningBalanceCents,
  unpaidCents,
}: {
  entry: ShareholderLoanEntry;
  fyeMonth: number;
  fyeDay: number;
  runningBalanceCents: number;
  /** For draws: FIFO-matched unpaid principal. > 0 means "reclassify" is offered. */
  unpaidCents: number;
}) {
  const isUnmatchedDraw = entry.type === "draw" && unpaidCents > 0;
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteLoanEntry(entry.id, entry.version);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  const sign = entry.type === "draw" ? "+" : entry.type === "repayment" || entry.type === "reclassification" ? "−" : "";
  const amountTone =
    entry.type === "draw"
      ? "text-amber-400"
      : entry.type === "repayment" || entry.type === "reclassification"
        ? "text-emerald-400"
        : "text-muted-foreground";

  return (
    <>
      <tr className="border-b border-border/30 transition-colors hover:bg-muted/20">
        <td className="px-4 py-3 text-xs">{formatLongDate(entry.entryDate)}</td>
        <td className="px-4 py-3 text-center">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
              TYPE_PILL[entry.type].tone,
            )}
          >
            {TYPE_PILL[entry.type].label}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {entry.description ? (
            <div>{entry.description}</div>
          ) : isUnmatchedDraw ? null : (
            <span className="text-muted-foreground/60">-</span>
          )}
          {isUnmatchedDraw && (
            <div className={cn(entry.description && "mt-1")}>
              <ReclassifyDrawDialog
                drawId={entry.id}
                drawDate={entry.entryDate}
                unpaidCents={unpaidCents}
              />
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
          FY {entry.fiscalYear}
        </td>
        <td className={cn("px-4 py-3 text-right font-medium", amountTone)}>
          {sign}
          {formatCAD(entry.amountCents)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
          {formatCAD(runningBalanceCents)}
        </td>
        <td className="px-2 py-3">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditOpen(true)}
              aria-label="Edit entry"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              aria-label="Delete entry"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit entry</DialogTitle>
            <DialogDescription>
              {TYPE_PILL[entry.type].label} of {formatCAD(entry.amountCents)} on{" "}
              {formatLongDate(entry.entryDate)}.
            </DialogDescription>
          </DialogHeader>
          <ShareholderLoanEntryForm
            key={entry.id}
            entry={entry}
            fyeMonth={fyeMonth}
            fyeDay={fyeDay}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the {TYPE_PILL[entry.type].label.toLowerCase()} of{" "}
              {formatCAD(entry.amountCents)} on {formatLongDate(entry.entryDate)}. Once a T4A slip
              is issued for FY {entry.fiscalYear}, deletion is blocked.
            </AlertDialogDescription>
            {entry.type === "reclassification" &&
              entry.sourceKind === "reclass_to_dividend" &&
              entry.sourceRef && (
                <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-300">
                  <strong className="text-rose-200">Cascades:</strong> this entry was created when
                  you declared the matching dividend. Deleting it will also delete that dividend
                  to keep the ledger and T5 list in sync.
                </div>
              )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
