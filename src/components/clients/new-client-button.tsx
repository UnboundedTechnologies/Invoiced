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
import { ClientForm } from "./client-form";

export function NewClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" />
        Add client
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>
              The legal name is the only required field. Everything else can be filled in later.
            </DialogDescription>
          </DialogHeader>
          <ClientForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
