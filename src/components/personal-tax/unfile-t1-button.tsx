"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Unlock } from "lucide-react";
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
import { unfileT1Return } from "@/server/actions/t1";

export function UnfileT1Button({ taxYear }: { taxYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await unfileT1Return(taxYear);
      if (r.ok) {
        toast.success(r.ok);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Unfile failed");
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
      >
        <Unlock className="size-4" />
        Unfile (T1-ADJ)
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unfile T1 — CY {taxYear}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Reverts the return to <strong>draft</strong>. Paycheques, dividends,
                  shareholder-loan entries, donations, RRSP/FHSA contributions, and capital
                  transactions in CY {taxYear} become editable again.
                </p>
                <p>
                  The original CRA confirmation number and filed date stay in the audit log.
                  When you re-file, you'll need a <strong>new</strong> CRA confirmation
                  number from your T1-ADJ submission.
                </p>
                <p className="text-xs text-amber-400">
                  Use only when CRA needs you to amend via T1-ADJ — not as an undo button.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              {pending ? "Unfiling…" : "Unfile + unlock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
