"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { markDeadlineComplete } from "@/server/actions/deadlines";

export function MarkCompleteDialog({ deadlineId, title }: { deadlineId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [state, action, pending] = useActionState(
    markDeadlineComplete,
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
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
        onClick={() => setOpen(true)}
        aria-label="Mark complete"
        title="Mark complete"
      >
        <CircleCheck className="size-3.5" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={action}>
            <input type="hidden" name="id" value={deadlineId} />
            <AlertDialogHeader>
              <AlertDialogTitle>Mark complete — {title}</AlertDialogTitle>
              <AlertDialogDescription>
                Paste the CRA / Ontario registry confirmation number if you have one (optional).
                The filed date is used to sort the completed-deadlines section.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="craConfirmationNumber">Confirmation # (optional)</Label>
                <Input
                  id="craConfirmationNumber"
                  name="craConfirmationNumber"
                  autoComplete="off"
                  data-gramm="false"
                  placeholder="e.g., 123456789012"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filedAt">Filed on</Label>
                <Input
                  id="filedAt"
                  name="filedAt"
                  type="date"
                  required
                  defaultValue={today}
                />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={pending}>
                {pending ? "Saving…" : "Mark complete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
