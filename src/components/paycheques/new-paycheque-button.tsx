"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaychequeForm } from "./paycheque-form";

export function NewPaychequeButton({
  cadence,
  ytdCppCents,
  ytdCpp2Cents,
  ytdGrossCents,
  defaultGrossDollars,
}: {
  cadence: string;
  ytdCppCents: number;
  ytdCpp2Cents: number;
  ytdGrossCents: number;
  defaultGrossDollars: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        New paycheque
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New paycheque</DialogTitle>
            <DialogDescription>
              Records a pay period, computes deductions, generates a pay stub PDF, and schedules the source-deduction
              remittance for the 15th of next month.
            </DialogDescription>
          </DialogHeader>
          <PaychequeForm
            cadence={cadence}
            ytdCppCents={ytdCppCents}
            ytdCpp2Cents={ytdCpp2Cents}
            ytdGrossCents={ytdGrossCents}
            defaultGrossDollars={defaultGrossDollars}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
