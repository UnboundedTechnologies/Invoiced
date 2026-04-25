"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { deleteDraftInvoice } from "@/server/actions/invoices";

export function DeleteInvoiceButton({
  id,
  invoiceNumber,
  version,
}: {
  id: string;
  invoiceNumber: string;
  version: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setOpen(false);
    startTransition(async () => {
      const r = await deleteDraftInvoice(id, version);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={pending}
        aria-label={`Delete draft ${invoiceNumber}`}
        title="Delete draft (frees the invoice number if most recent)"
      >
        <Trash2 className="size-3.5" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft {invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The PDF will be removed from Vercel Blob. If this was the most recent draft, the invoice number is freed up
              and the next invoice will reuse it. Sent and paid invoices can never be deleted (CRA records).
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
