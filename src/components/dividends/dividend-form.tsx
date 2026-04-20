"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Dividend } from "@/lib/db/schema";
import { createDividend, updateDividend } from "@/server/actions/dividends";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { fiscalYearFor } from "@/lib/utils";

type Result = { ok?: string; error?: string };

export function DividendForm({
  dividend,
  fyeMonth,
  fyeDay,
  onDone,
}: {
  dividend?: Dividend;
  fyeMonth: number;
  fyeDay: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const todayISO = new Date().toISOString().slice(0, 10);

  const action = dividend
    ? (updateDividend.bind(null, dividend.id) as (p: Result | undefined, fd: FormData) => Promise<Result>)
    : createDividend;
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);

  const [declaredDate, setDeclaredDate] = useState(dividend?.declaredDate ?? todayISO);
  const [eligible, setEligible] = useState(dividend?.eligible ?? false);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      router.refresh();
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onDone, router]);

  const derivedFY = fiscalYearFor(declaredDate, fyeMonth, fyeDay);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="amountDollars">Amount (CAD) *</Label>
        <Input
          id="amountDollars"
          name="amountDollars"
          type="number"
          step="0.01"
          min="0.01"
          required
          defaultValue={dividend ? (dividend.amountCents / 100).toFixed(2) : ""}
          data-gramm="false"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="declaredDate">Declared *</Label>
          <Input
            id="declaredDate"
            name="declaredDate"
            type="date"
            required
            value={declaredDate}
            onChange={(e) => setDeclaredDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paidDate">Paid (optional)</Label>
          <Input id="paidDate" name="paidDate" type="date" defaultValue={dividend?.paidDate ?? ""} />
        </div>
      </div>

      <div className="rounded-md border border-border/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="eligible" className="text-sm">
              Eligible dividend
            </Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Eligible = paid from income taxed at the general corp rate. CCPC active-business income is usually non-eligible.
            </p>
          </div>
          <Switch id="eligible" name="eligible" checked={eligible} onCheckedChange={setEligible} />
        </div>
      </div>

      <div className="rounded-md bg-muted/20 p-3 text-xs">
        <span className="text-muted-foreground">Fiscal year (auto-derived):</span>{" "}
        <span className="font-mono font-semibold text-foreground">FY {derivedFY}</span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={dividend?.notes ?? ""} />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Saving…" : dividend ? "Save changes" : "Declare dividend"}
        </Button>
      </DialogFooter>
    </form>
  );
}
