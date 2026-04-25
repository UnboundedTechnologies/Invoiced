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
import { unfileT2Return } from "@/server/actions/t2";

export function UnfileT2Button({ fiscalYear }: { fiscalYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await unfileT2Return(fiscalYear);
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
        Unfile (T2A)
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unfile T2 — FY {fiscalYear}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Reverts the return to <strong>draft</strong>. Paycheques, dividends,
                  shareholder-loan entries, invoices, and expenses with dates in FY{" "}
                  {fiscalYear} become editable again.
                </p>
                <p>
                  Frozen P&amp;L + pool balances stay on the row for audit trail; refile
                  overwrites them. <strong>tax_pools</strong> + <strong>cca_pools</strong>{" "}
                  are not touched — they'll be overwritten on refile too.
                </p>
                <p className="text-xs text-amber-400">
                  Blocked if FY {fiscalYear + 1} (or any later FY) T2 exists — the chain of
                  pool opening balances would silently shift. Unfile downstream first.
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
