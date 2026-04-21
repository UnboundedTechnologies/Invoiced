"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileT2Return } from "@/server/actions/t2";
import { formatCAD } from "@/lib/utils";

export function FileT2Button({
  fiscalYear,
  totalTaxCents,
  dividendRefundCents,
}: {
  fiscalYear: number;
  totalTaxCents: number;
  dividendRefundCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [state, action, pending] = useActionState(
    fileT2Return.bind(null, fiscalYear),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setOpen(false);
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router]);

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <FileCheck className="size-4" />
        File T2 return
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={action}>
            <AlertDialogHeader>
              <AlertDialogTitle>File T2 return — FY {fiscalYear}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Freezes the snapshot at <strong>{formatCAD(totalTaxCents)}</strong> total
                    tax owing
                    {dividendRefundCents > 0 ? (
                      <>
                        {" "}with <strong>{formatCAD(dividendRefundCents)}</strong> dividend
                        refund offset
                      </>
                    ) : null}
                    . Locks every invoice, expense, paycheque, dividend, and loan-ledger
                    entry in this fiscal year against edits or deletion. Corrections after
                    filing route through CRA form T2A — cannot be reversed from within Invoiced.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="craConfirmationNumber">CRA confirmation number</Label>
                <Input
                  id="craConfirmationNumber"
                  name="craConfirmationNumber"
                  required
                  autoComplete="off"
                  data-gramm="false"
                  placeholder="e.g., 1234567890RC0001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filedAt">Filed on</Label>
                <Input id="filedAt" name="filedAt" type="date" required defaultValue={today} />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={pending}>
                {pending ? "Filing…" : "File + lock"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
