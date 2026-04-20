"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, RotateCcw, Trash2 } from "lucide-react";
import type { Remittance } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
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
import {
  deleteRemittance,
  markRemittancePaid,
  markRemittanceUnpaid,
} from "@/server/actions/paycheques";
import { formatCAD } from "@/lib/utils";

export function RemittanceRow({ remittance }: { remittance: Remittance }) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onUnpaid() {
    startTransition(async () => {
      const r = await markRemittanceUnpaid(remittance.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function onDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteRemittance(remittance.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <tr className="border-b border-border/30">
      <td className="px-4 py-3 text-xs">
        {remittance.periodStart} → {remittance.periodEnd}
      </td>
      <td className="px-4 py-3 text-xs">{remittance.dueDate}</td>
      <td className="px-4 py-3 text-right font-medium">{formatCAD(remittance.amountCents)}</td>
      <td className="px-4 py-3 text-center">
        {remittance.paidAt ? (
          <span
            className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
            title={remittance.confirmationNumber ? `Confirmation ${remittance.confirmationNumber}` : undefined}
          >
            Paid
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-inset ring-amber-500/30">
            Open
          </span>
        )}
      </td>
      <td className="px-2 py-3">
        <div className="flex justify-end gap-1">
          {remittance.paidAt ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onUnpaid}
              disabled={pending}
              aria-label="Re-open remittance"
              title="Re-open (undo paid)"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
                onClick={() => setPayOpen(true)}
                disabled={pending}
                aria-label="Mark paid"
                title="Mark paid"
              >
                <CircleCheck className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
                onClick={() => setDeleteOpen(true)}
                disabled={pending}
                aria-label="Delete remittance"
                title="Delete remittance"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>

        <MarkPaidDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          remittanceId={remittance.id}
          amountCents={remittance.amountCents}
        />

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this remittance?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes the {formatCAD(remittance.amountCents)} source-deduction remittance due{" "}
                {remittance.dueDate}. Only unpaid remittances can be deleted (paid ones stay for the CRA audit trail).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
}

function MarkPaidDialog({
  open,
  onOpenChange,
  remittanceId,
  amountCents,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  remittanceId: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function submit() {
    setPending(true);
    const r = await markRemittancePaid(remittanceId, confirmation.trim() || null);
    setPending(false);
    if (r.ok) {
      toast.success(r.ok);
      router.refresh();
      onOpenChange(false);
      setConfirmation("");
    }
    if (r.error) toast.error(r.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark remittance as paid</DialogTitle>
          <DialogDescription>
            Paste the CRA confirmation number from your bank's CRA payment flow (optional but recommended). Amount:{" "}
            <span className="font-semibold text-foreground">{formatCAD(amountCents)}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirmation">CRA confirmation #</Label>
          <Input
            id="confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="e.g. 1234567890"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="brand" disabled={pending} onClick={submit}>
            {pending ? "Marking…" : "Mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
