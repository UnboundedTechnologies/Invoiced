"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { deleteDraftPaycheque } from "@/server/actions/paycheques";

export function DeletePaychequeButton({
  id,
  payDate,
  version,
}: {
  id: string;
  payDate: string;
  version: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setOpen(false);
    startTransition(async () => {
      const r = await deleteDraftPaycheque(id, version);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={pending}
        aria-label={`Delete draft paycheque ${payDate}`}
        title="Delete draft paycheque"
      >
        <Trash2 className="size-3.5" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft paycheque {payDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              The pay stub PDF is removed from the vault. Issued paycheques cannot be deleted — void them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
