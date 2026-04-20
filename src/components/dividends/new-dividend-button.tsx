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
import { DividendForm } from "./dividend-form";

export function NewDividendButton({ fyeMonth, fyeDay }: { fyeMonth: number; fyeDay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        Declare dividend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Declare dividend</DialogTitle>
            <DialogDescription>
              Record a T5 dividend paid out of retained earnings.
            </DialogDescription>
          </DialogHeader>
          <DividendForm fyeMonth={fyeMonth} fyeDay={fyeDay} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
