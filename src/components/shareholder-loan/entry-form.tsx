"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { ShareholderLoanEntry } from "@/lib/db/schema";
import { createLoanEntry, updateLoanEntry } from "@/server/actions/shareholder-loan";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fiscalYearFor } from "@/lib/utils";

type Result = { ok?: string; error?: string };
type EntryType = "draw" | "repayment" | "interest_payment" | "reclassification";

const TYPE_LABELS: Record<EntryType, { label: string; hint: string }> = {
  draw: {
    label: "Draw (corp → you)",
    hint: "Money out of the corp to you. Starts a s.15(2) clock ticking.",
  },
  repayment: {
    label: "Repayment (you → corp)",
    hint: "Principal paid back. FIFO-matched against the oldest outstanding draw.",
  },
  interest_payment: {
    label: "Interest payment",
    hint: "Reduces the s.80.4(2) benefit. Must be paid by Jan 30 to offset prior calendar year.",
  },
  reclassification: {
    label: "Reclassification",
    hint: "After-the-fact recast of a draw as salary/dividend/reimbursement (acts as a repayment here).",
  },
};

export function ShareholderLoanEntryForm({
  entry,
  fyeMonth,
  fyeDay,
  defaultType,
  onDone,
}: {
  entry?: ShareholderLoanEntry;
  fyeMonth: number;
  fyeDay: number;
  defaultType?: EntryType;
  onDone: () => void;
}) {
  const router = useRouter();
  const todayISO = new Date().toISOString().slice(0, 10);

  const action = entry
    ? (updateLoanEntry.bind(null, entry.id) as (p: Result | undefined, fd: FormData) => Promise<Result>)
    : createLoanEntry;
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);

  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? todayISO);
  const [type, setType] = useState<EntryType>(
    (entry?.type as EntryType | undefined) ?? defaultType ?? "draw",
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      router.refresh();
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onDone, router]);

  const derivedFY = fiscalYearFor(entryDate, fyeMonth, fyeDay);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="type">Type *</Label>
        <Select name="type" value={type} onValueChange={(v) => setType(v as EntryType)}>
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TYPE_LABELS) as EntryType[]).map((k) => (
              <SelectItem key={k} value={k}>
                {TYPE_LABELS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{TYPE_LABELS[type].hint}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entryDate">Date *</Label>
          <Input
            id="entryDate"
            name="entryDate"
            type="date"
            required
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amountDollars">Amount (CAD) *</Label>
          <Input
            id="amountDollars"
            name="amountDollars"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={entry ? (entry.amountCents / 100).toFixed(2) : ""}
            data-gramm="false"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sourceKind">Source (optional)</Label>
          <Input
            id="sourceKind"
            name="sourceKind"
            defaultValue={entry?.sourceKind ?? ""}
            placeholder="bank_xfer, expense_personal, …"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sourceRef">Reference (optional)</Label>
          <Input
            id="sourceRef"
            name="sourceRef"
            defaultValue={entry?.sourceRef ?? ""}
            placeholder="txn id, cheque #, invoice #"
          />
        </div>
      </div>

      <div className="rounded-md bg-muted/20 p-3 text-xs">
        <span className="text-muted-foreground">Fiscal year (auto-derived):</span>{" "}
        <span className="font-mono font-semibold text-foreground">FY {derivedFY}</span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={entry?.description ?? ""}
        />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Saving…" : entry ? "Save changes" : "Record entry"}
        </Button>
      </DialogFooter>
    </form>
  );
}
