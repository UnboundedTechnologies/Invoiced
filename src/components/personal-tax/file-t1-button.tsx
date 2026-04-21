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
import { fileT1Return } from "@/server/actions/t1";
import { formatCAD } from "@/lib/utils";

export function FileT1Button({
  taxYear,
  totalTaxCents,
  refundOrOwingCents,
}: {
  taxYear: number;
  totalTaxCents: number;
  refundOrOwingCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [state, action, pending] = useActionState(
    fileT1Return.bind(null, taxYear),
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

  const owing = refundOrOwingCents > 0;

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <FileCheck className="size-4" />
        File T1 return
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={action}>
            <AlertDialogHeader>
              <AlertDialogTitle>File T1 return — CY {taxYear}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Freezes the snapshot at <strong>{formatCAD(totalTaxCents)}</strong> total
                    tax payable with{" "}
                    <strong>
                      {owing ? "balance owing " : "refund "}
                      {formatCAD(Math.abs(refundOrOwingCents))}
                    </strong>
                    . Locks every paycheque, dividend, and shareholder-loan entry whose
                    date falls in CY {taxYear} against edits or deletion. Corrections after
                    filing route through CRA form T1-ADJ — cannot be reversed from within Invoiced.
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
                  placeholder="NETFILE (8 chars) or EFILE confirmation"
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
