"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, CircleCheck, RotateCcw, Ban, Trash2, Download } from "lucide-react";
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
import { setInvoiceStatus, deleteDraftInvoice } from "@/server/actions/invoices";

export function InvoiceActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function changeStatus(next: string) {
    startTransition(async () => {
      const r = await setInvoiceStatus(id, next);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteDraftInvoice(id);
      if (r.ok) {
        toast.success(r.ok);
        router.push("/invoices");
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <a href={`/api/invoices/${id}/pdf?download=1`} target="_blank" rel="noopener noreferrer">
          <Download className="size-4" />
          Download PDF
        </a>
      </Button>

      {status === "draft" && (
        <>
          <Button
            type="button"
            variant="brand"
            size="sm"
            className="gap-1.5"
            disabled={pending}
            onClick={() => changeStatus("sent")}
          >
            <Send className="size-4" />
            Mark as sent
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
            Delete draft
          </Button>
        </>
      )}

      {status === "sent" && (
        <>
          <Button
            type="button"
            variant="brand"
            size="sm"
            className="gap-1.5"
            disabled={pending}
            onClick={() => changeStatus("paid")}
          >
            <CircleCheck className="size-4" />
            Mark as paid
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={pending}
            onClick={() => changeStatus("draft")}
          >
            <RotateCcw className="size-4" />
            Move back to draft
          </Button>
        </>
      )}

      {status === "paid" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={pending}
          onClick={() => changeStatus("sent")}
        >
          <RotateCcw className="size-4" />
          Mark as unpaid
        </Button>
      )}

      {(status === "draft" || status === "sent") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-400"
          disabled={pending}
          onClick={() => changeStatus("void")}
        >
          <Ban className="size-4" />
          Void
        </Button>
      )}

      {status === "void" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={pending}
          onClick={() => changeStatus("draft")}
        >
          <RotateCcw className="size-4" />
          Reopen as draft
        </Button>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              The PDF stays in the vault as history. The invoice number is freed up if it was the most recent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
