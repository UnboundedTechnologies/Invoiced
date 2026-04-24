"use client";

import { useActionState, useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { fileT4Slip, fileT5Slip } from "@/server/actions/slips";

type Kind = "T4" | "T5";

export function FileSlipButton({
  kind,
  taxYear,
  disabled,
  disabledReason,
}: {
  kind: Kind;
  taxYear: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountantSignoff, setAccountantSignoff] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const expectedPhrase = `FILE ${kind} CY${taxYear}`;

  const action = kind === "T4" ? fileT4Slip : fileT5Slip;
  const [state, formAction, pending] = useActionState(
    action.bind(null, taxYear),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setOpen(false);
      setAccountantSignoff(false);
      setTypedConfirm("");
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router]);

  const typedOk = typedConfirm === expectedPhrase;
  const allOk = typedOk && accountantSignoff;

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="gap-2"
      >
        <FileCheck className="size-4" />
        File {kind} slip
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={formAction}>
            <AlertDialogHeader>
              <AlertDialogTitle>File {kind} slip — CY {taxYear}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Freezes the box snapshot for CY {taxYear} into the database, renders
                    the final PDF, and stores it in the vault. The filed PDF drops the
                    WORKING COPY watermark and carries the FILED ribbon + CRA confirmation.
                  </p>
                  <p className="text-muted-foreground">
                    Locks every {kind === "T4" ? "paycheque" : "paid dividend"} whose
                    {kind === "T4" ? " pay-date" : " paid-date"} falls in CY {taxYear}.
                    Corrections after filing route through {kind === "T4" ? "CRA T4-ADJ" : "CRA T5-ADJ"};
                    alternatively, void the slip here to re-open edits.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="craConfirmationNumber">CRA confirmation number (optional)</Label>
                <Input
                  id="craConfirmationNumber"
                  name="craConfirmationNumber"
                  autoComplete="off"
                  data-gramm="false"
                  placeholder="From CRA Web Forms submission receipt"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filedAt">Filed on</Label>
                <Input id="filedAt" name="filedAt" type="date" required defaultValue={today} />
              </div>
              <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <Switch
                  id="accountantSignoff"
                  name="accountantSignoff"
                  checked={accountantSignoff}
                  onCheckedChange={setAccountantSignoff}
                />
                <Label htmlFor="accountantSignoff" className="text-xs cursor-pointer">
                  I have accountant sign-off on the boxes above, or I have reviewed them
                  myself against the underlying {kind === "T4" ? "paycheques" : "dividends"}.
                </Label>
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
              <AlertDialogAction type="submit" disabled={!allOk || pending}>
                {pending ? "Filing…" : "File + lock"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
