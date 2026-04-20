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
import { ExpenseForm } from "./expense-form";

export function NewExpenseButton({
  fyeMonth,
  fyeDay,
  hstRateBps,
}: {
  fyeMonth: number;
  fyeDay: number;
  hstRateBps: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        New expense
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Record expense</DialogTitle>
            <DialogDescription>
              Track deductible business expenses. Attach a receipt (PDF or photo) so it flows into the vault.
            </DialogDescription>
          </DialogHeader>
          <ExpenseForm
            fyeMonth={fyeMonth}
            fyeDay={fyeDay}
            hstRateBps={hstRateBps}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
