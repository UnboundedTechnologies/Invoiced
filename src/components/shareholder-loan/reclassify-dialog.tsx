"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PiggyBank } from "lucide-react";
import { reclassifyDrawAsDividend } from "@/server/actions/shareholder-loan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCAD, formatLongDate } from "@/lib/utils";

type Result = { ok?: string; error?: string };

export function ReclassifyDrawDialog({
  drawId,
  drawDate,
  unpaidCents,
}: {
  drawId: string;
  drawDate: string;
  unpaidCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = reclassifyDrawAsDividend.bind(null, drawId) as (
    p: Result | undefined,
    fd: FormData,
  ) => Promise<Result>;
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);

  const todayISO = new Date().toISOString().slice(0, 10);
  const [declaredDate, setDeclaredDate] = useState(todayISO);
  const [eligible, setEligible] = useState(false);

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
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 gap-1.5 border border-violet-500/40 bg-violet-500/10 text-violet-300 shadow-none hover:bg-violet-500/20 hover:text-violet-100"
        aria-label="Reclassify draw as dividend"
      >
        <PiggyBank className="size-3.5" />
        Declare as dividend
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reclassify as dividend</DialogTitle>
            <DialogDescription>
              Converts the <span className="font-semibold text-foreground">{formatCAD(unpaidCents)}</span>{" "}
              outstanding from the draw on{" "}
              <span className="font-semibold text-foreground">{formatLongDate(drawDate)}</span> into a
              declared dividend. Writes the T5 dividend AND the matching repayment entry in a single
              transaction. No chance of half-done state.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="declaredDate">Declared date *</Label>
              <Input
                id="declaredDate"
                name="declaredDate"
                type="date"
                required
                value={declaredDate}
                onChange={(e) => setDeclaredDate(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Goes on the T5 slip for the corp&rsquo;s fiscal year containing this date.
              </p>
            </div>

            <div className="rounded-md border border-border/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="eligible" className="text-sm">
                    Eligible dividend
                  </Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    CCPC active-business income is usually non-eligible. Only toggle on if the
                    corp&rsquo;s GRIP balance covers it.
                  </p>
                </div>
                <Switch
                  id="eligible"
                  name="eligible"
                  checked={eligible}
                  onCheckedChange={setEligible}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Optional — rationale, board resolution #, etc."
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="brand" disabled={pending}>
                {pending ? "Reclassifying…" : `Declare ${formatCAD(unpaidCents)} dividend`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
