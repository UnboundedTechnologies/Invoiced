"use client";

import { useActionState, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Heart, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import { createDonation, deleteDonation } from "@/server/actions/donations";
import { formatCAD, formatLongDate } from "@/lib/utils";
import type { Donation } from "@/lib/db/schema";

type Props = {
  taxYear: number;
  donations: Donation[];
  totalCents: number;
  federalCreditCents: number;
  ontarioCreditCents: number;
  isFiled: boolean;
};

export function DonationsCard({
  taxYear,
  donations,
  totalCents,
  federalCreditCents,
  ontarioCreditCents,
  isFiled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createDonation,
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="size-4 text-pink-400" />
            Donations · Line 34900
          </CardTitle>
          {!isFiled && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
              <Plus className="size-3.5" />
              Add receipt
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {donations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No donations recorded for CY {taxYear}.
          </p>
        ) : (
          <div className="space-y-1">
            {donations.map((d) => (
              <DonationRow key={d.id} donation={d} isFiled={isFiled} onDeleted={() => router.refresh()} />
            ))}
          </div>
        )}

        {totalCents > 0 && (
          <div className="space-y-1 border-t border-border/60 pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total donations</span>
              <span className="font-mono font-semibold">{formatCAD(totalCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Federal credit (line 34900)</span>
              <span className="font-mono text-emerald-400">−{formatCAD(federalCreditCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ontario credit (ON428 line 5896)</span>
              <span className="font-mono text-emerald-400">−{formatCAD(ontarioCreditCents)}</span>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action}>
            <DialogHeader>
              <DialogTitle>Add donation receipt</DialogTitle>
              <DialogDescription>
                The CY is derived from the date received. Filed-CY edits are blocked.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="charityName">Charity name</Label>
                <Input id="charityName" name="charityName" required maxLength={200} autoComplete="off" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amountCents">Amount</Label>
                  <Input
                    id="amountCents"
                    name="amountCents"
                    required
                    inputMode="decimal"
                    placeholder="150.00"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateReceived">Date received</Label>
                  <Input
                    id="dateReceived"
                    name="dateReceived"
                    type="date"
                    required
                    defaultValue={`${taxYear}-12-31`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receiptNumber">Receipt #</Label>
                  <Input id="receiptNumber" name="receiptNumber" maxLength={80} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="registeredCharityNumber">Registered charity #</Label>
                  <Input
                    id="registeredCharityNumber"
                    name="registeredCharityNumber"
                    maxLength={40}
                    autoComplete="off"
                    placeholder="e.g. 123456789-RR0001"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" maxLength={500} autoComplete="off" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add receipt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DonationRow({
  donation,
  isFiled,
  onDeleted,
}: {
  donation: Donation;
  isFiled: boolean;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Delete donation to ${donation.charityName} for ${formatCAD(donation.amountCents)}?`)) {
      return;
    }
    startTransition(async () => {
      const r = await deleteDonation(donation.id, donation.version);
      if (r.ok) {
        toast.success(r.ok);
        onDeleted();
      } else {
        toast.error(r.error ?? "Delete failed");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{donation.charityName}</div>
        <div className="text-xs text-muted-foreground">
          {formatLongDate(donation.dateReceived)}
          {donation.receiptNumber ? ` · receipt ${donation.receiptNumber}` : null}
          {donation.registeredCharityNumber ? ` · ${donation.registeredCharityNumber}` : null}
        </div>
      </div>
      <span className="font-mono text-sm">{formatCAD(donation.amountCents)}</span>
      {!isFiled && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-rose-400"
          onClick={onDelete}
          disabled={pending}
          title="Remove receipt"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
