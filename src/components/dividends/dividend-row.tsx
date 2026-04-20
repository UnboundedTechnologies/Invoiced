"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, CircleCheck, RotateCcw } from "lucide-react";
import type { Dividend } from "@/lib/db/schema";
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
import { DividendForm } from "./dividend-form";
import { deleteDividend, markDividendPaid, markDividendUnpaid } from "@/server/actions/dividends";
import { formatCAD, formatLongDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function DividendRow({
  dividend,
  fyeMonth,
  fyeDay,
  linkedToLoanLedger = false,
}: {
  dividend: Dividend;
  fyeMonth: number;
  fyeDay: number;
  /** True if this dividend was created via shareholder-loan reclassification.
   * Delete will cascade to the matching ledger entry — show a warning. */
  linkedToLoanLedger?: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteDividend(dividend.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function togglePaid() {
    startTransition(async () => {
      const r = dividend.paidDate
        ? await markDividendUnpaid(dividend.id)
        : await markDividendPaid(dividend.id, new Date().toISOString().slice(0, 10));
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  const isPaid = !!dividend.paidDate;

  return (
    <>
      <tr className="border-b border-border/30 transition-colors hover:bg-muted/20">
        <td className="px-4 py-3 text-xs">{formatLongDate(dividend.declaredDate)}</td>
        <td className="px-4 py-3 text-xs">
          {isPaid ? (
            <span className="text-foreground">{formatLongDate(dividend.paidDate!)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
              dividend.eligible
                ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                : "bg-violet-500/10 text-violet-400 ring-violet-500/30",
            )}
          >
            {dividend.eligible ? "Eligible" : "Non-eligible"}
          </span>
        </td>
        <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
          FY {dividend.fiscalYear}
        </td>
        <td className="px-4 py-3 text-right font-medium">{formatCAD(dividend.amountCents)}</td>
        <td className="px-2 py-3">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={togglePaid}
              disabled={pending}
              aria-label={isPaid ? "Mark as unpaid" : "Mark as paid"}
              title={isPaid ? "Mark as unpaid" : "Mark as paid today"}
            >
              {isPaid ? (
                <RotateCcw className="size-3.5" />
              ) : (
                <CircleCheck className="size-3.5 text-emerald-400" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditOpen(true)}
              aria-label="Edit dividend"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              aria-label="Delete dividend"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit dividend</DialogTitle>
            <DialogDescription>
              {formatCAD(dividend.amountCents)} declared {formatLongDate(dividend.declaredDate)}.
            </DialogDescription>
          </DialogHeader>
          <DividendForm
            key={dividend.id}
            dividend={dividend}
            fyeMonth={fyeMonth}
            fyeDay={fyeDay}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this dividend?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the {formatCAD(dividend.amountCents)} {dividend.eligible ? "eligible" : "non-eligible"} dividend declared {formatLongDate(dividend.declaredDate)}. Once a T5 slip is issued for FY {dividend.fiscalYear}, deletion is blocked.
            </AlertDialogDescription>
            {linkedToLoanLedger && (
              <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-300">
                <strong className="text-rose-200">Cascades:</strong> this dividend was created by
                reclassifying a shareholder-loan draw. Deleting it will also remove the matching
                ledger entry so the draw&rsquo;s outstanding balance stays consistent.
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
