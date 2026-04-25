"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Paperclip, ExternalLink } from "lucide-react";
import type { Expense } from "@/lib/db/schema";
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
import { ExpenseForm } from "./expense-form";
import { CategoryBadge, type ExpenseCategory } from "./category-badge";
import { deleteExpense } from "@/server/actions/expenses";
import { formatCAD, formatLongDate } from "@/lib/utils";

export function ExpenseRow({
  expense,
  fyeMonth,
  fyeDay,
  hstRateBps,
}: {
  expense: Expense;
  fyeMonth: number;
  fyeDay: number;
  hstRateBps: number;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteExpense(expense.id, expense.version);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  const hasReceipt = !!expense.receiptBlobUrl;

  return (
    <>
      <tr className="border-b border-border/30 transition-colors hover:bg-muted/20">
        <td className="px-4 py-3 text-xs">{formatLongDate(expense.expenseDate)}</td>
        <td className="px-4 py-3 text-sm">
          <div className="font-medium">{expense.vendor}</div>
          {expense.description && (
            <div className="truncate text-[11px] text-muted-foreground" title={expense.description}>
              {expense.description}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <CategoryBadge category={expense.category as ExpenseCategory} />
        </td>
        <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
          FY {expense.fiscalYear}
        </td>
        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
          {formatCAD(expense.subtotalCents)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
          {expense.hstPaidCents > 0 ? formatCAD(expense.hstPaidCents) : "—"}
        </td>
        <td className="px-4 py-3 text-right font-medium">{formatCAD(expense.totalCents)}</td>
        <td className="px-4 py-3 text-center">
          {hasReceipt ? (
            <a
              href={`/api/expenses/${expense.id}/receipt`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex size-7 items-center justify-center rounded-md text-sky-400 transition-colors hover:bg-sky-500/10"
              title="View receipt"
              aria-label="View receipt"
            >
              <Paperclip className="size-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground" aria-label="No receipt">
              —
            </span>
          )}
        </td>
        <td className="px-2 py-3">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditOpen(true)}
              aria-label="Edit expense"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={() => setDeleteOpen(true)}
              disabled={pending}
              aria-label="Delete expense"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit expense</DialogTitle>
            <DialogDescription>
              {formatCAD(expense.totalCents)} · {expense.vendor} · {formatLongDate(expense.expenseDate)}
              {hasReceipt && (
                <>
                  {" · "}
                  <a
                    href={`/api/expenses/${expense.id}/receipt`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                  >
                    receipt
                    <ExternalLink className="size-3" />
                  </a>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <ExpenseForm
            key={expense.id}
            expense={expense}
            fyeMonth={fyeMonth}
            fyeDay={fyeDay}
            hstRateBps={hstRateBps}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the {formatCAD(expense.totalCents)} {expense.vendor} expense from{" "}
              {formatLongDate(expense.expenseDate)}.
              {hasReceipt && " The attached receipt file will also be deleted."} This cannot be undone.
            </AlertDialogDescription>
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
