"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { voidSlip } from "@/server/actions/slips";

export function VoidSlipButton({
  slipId,
  kind,
  taxYear,
}: {
  slipId: string;
  kind: "T4" | "T5";
  taxYear: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");
  const expectedPhrase = `VOID ${kind} CY${taxYear}`;

  const [state, formAction, pending] = useActionState(
    voidSlip.bind(null, slipId),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setOpen(false);
      setTypedConfirm("");
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router]);

  const typedOk = typedConfirm === expectedPhrase;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
      >
        <Undo2 className="size-4" />
        Void slip
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={formAction}>
            <AlertDialogHeader>
              <AlertDialogTitle>Void {kind} slip — CY {taxYear}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Marks the filed slip row as voided and re-opens{" "}
                    {kind === "T4" ? "paycheques" : "paid dividends"} for CY {taxYear}
                    against edits. The filed PDF stays in the vault for audit trail.
                  </p>
                  <p className="text-muted-foreground">
                    Use when a box value needs correcting before re-filing. CRA itself
                    requires an amended slip (T4-ADJ / T5-ADJ) for corrections after
                    their submission has been accepted — the Invoiced void is separate
                    from CRA&rsquo;s amendment process and only controls this app&rsquo;s locks.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (audit log)</Label>
                <Textarea
                  id="reason"
                  name="reason"
                  required
                  rows={3}
                  data-gramm="false"
                  placeholder="E.g., Box 16 miscalculated due to pay cadence error. Re-filing with corrected CPP."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="typedConfirm" className="text-xs">
                  Type <span className="font-mono font-bold">{expectedPhrase}</span> to confirm
                </Label>
                <Input
                  id="typedConfirm"
                  name="typedConfirm"
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value.toUpperCase())}
                  autoComplete="off"
                  data-gramm="false"
                  placeholder={expectedPhrase}
                  className="font-mono"
                  required
                />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={!typedOk || pending}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {pending ? "Voiding…" : "Void + re-open data"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
