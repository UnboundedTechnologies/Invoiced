"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, RotateCcw, Ban, Trash2, Download } from "lucide-react";
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
import { setPaychequeStatus, deleteDraftPaycheque } from "@/server/actions/paycheques";

export function PaychequeActions({
  id,
  status,
  version,
}: {
  id: string;
  status: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function changeStatus(next: string) {
    startTransition(async () => {
      const r = await setPaychequeStatus(id, next, version);
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
      const r = await deleteDraftPaycheque(id, version);
      if (r.ok) {
        toast.success(r.ok);
        router.push("/paycheques");
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <a href={`/api/paycheques/${id}/pdf?download=1`} target="_blank" rel="noopener noreferrer">
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
            onClick={() => changeStatus("issued")}
          >
            <Send className="size-4" />
            Issue paycheque
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

      {status === "issued" && (
        <>
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
            <AlertDialogTitle>Delete draft paycheque?</AlertDialogTitle>
            <AlertDialogDescription>
              The pay stub PDF is removed from the vault. Issued paycheques cannot be deleted — void them instead to
              preserve the CRA audit trail.
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
