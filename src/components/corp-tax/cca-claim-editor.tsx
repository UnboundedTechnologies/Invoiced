"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setCcaClaimFraction } from "@/server/actions/t2";
import type { CcaClass } from "@/lib/cca";

export function CcaClaimEditor({
  fiscalYear,
  ccaClass,
  claimFractionBps,
  disabled,
}: {
  fiscalYear: number;
  ccaClass: CcaClass;
  claimFractionBps: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, action, pending] = useActionState(
    setCcaClaimFraction.bind(null, fiscalYear),
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
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {(claimFractionBps / 100).toFixed(0)}%
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action}>
            <DialogHeader>
              <DialogTitle>Class {ccaClass} · claim fraction</DialogTitle>
              <DialogDescription>
                Default 100% (claim max CCA each year). Reduce for loss-year deferral to
                preserve UCC for a higher-income year down the road.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="ccaClass" value={ccaClass} />
            <div className="my-4 space-y-1.5">
              <Label htmlFor="fractionPercent">Claim percent</Label>
              <Input
                id="fractionPercent"
                name="fractionPercent"
                type="number"
                step="1"
                min="0"
                max="100"
                required
                defaultValue={claimFractionBps / 100}
                data-gramm="false"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
