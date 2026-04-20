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
import { ShareholderLoanEntryForm } from "./entry-form";

export function NewLoanEntryButton({
  fyeMonth,
  fyeDay,
}: {
  fyeMonth: number;
  fyeDay: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        New entry
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New shareholder-loan entry</DialogTitle>
            <DialogDescription>
              Draws, repayments, interest payments, or reclassifications. All amounts are positive;
              direction is implied by the type.
            </DialogDescription>
          </DialogHeader>
          <ShareholderLoanEntryForm fyeMonth={fyeMonth} fyeDay={fyeDay} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
