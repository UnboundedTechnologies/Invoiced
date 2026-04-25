"use client";

import { useActionState, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TrendingUp, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createCapitalTransaction,
  deleteCapitalTransaction,
} from "@/server/actions/capital-transactions";
import { formatCAD, formatLongDate } from "@/lib/utils";
import type { CapitalTransaction } from "@/lib/db/schema";

type Props = {
  taxYear: number;
  rows: CapitalTransaction[];
  line19900Cents: number;
  line12700Cents: number;
  isFiled: boolean;
};

const KIND_LABELS: Record<CapitalTransaction["kind"], string> = {
  public_security: "Public security",
  mutual_fund: "Mutual fund",
  real_estate: "Real estate",
  crypto: "Crypto",
  other: "Other",
};

export function CapitalTransactionsCard({
  taxYear,
  rows,
  line19900Cents,
  line12700Cents,
  isFiled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createCapitalTransaction,
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-emerald-400" />
            Capital transactions · Sch 3 · Line 12700
          </CardTitle>
          {!isFiled && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
              <Plus className="size-3.5" />
              Add disposition
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No capital transactions recorded for CY {taxYear}.
          </p>
        ) : (
          <div className="space-y-1">
            {rows.map((tx) => (
              <CapitalRow key={tx.id} row={tx} isFiled={isFiled} onDeleted={() => router.refresh()} />
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-1 border-t border-border/60 pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Line 19900 — Total capital gains/losses</span>
              <span className={`font-mono ${line19900Cents < 0 ? "text-rose-400" : ""}`}>
                {line19900Cents < 0 ? `(${formatCAD(-line19900Cents)})` : formatCAD(line19900Cents)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Line 12700 — 50% taxable inclusion</span>
              <span className="font-mono font-semibold">{formatCAD(line12700Cents)}</span>
            </div>
            {line19900Cents < 0 && (
              <p className="pt-1 text-[11px] text-amber-400">
                Net loss — line 12700 is 0. Carryforward not yet automated.
              </p>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action}>
            <DialogHeader>
              <DialogTitle>Add capital transaction</DialogTitle>
              <DialogDescription>
                CY is derived from disposition date. Filed-CY edits are blocked.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kind">Kind</Label>
                  <Select name="kind" defaultValue="public_security">
                    <SelectTrigger id="kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public_security">Public security</SelectItem>
                      <SelectItem value="mutual_fund">Mutual fund</SelectItem>
                      <SelectItem value="real_estate">Real estate</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dispositionDate">Disposition date</Label>
                  <Input
                    id="dispositionDate"
                    name="dispositionDate"
                    type="date"
                    required
                    defaultValue={`${taxYear}-12-31`}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  name="description"
                  required
                  maxLength={200}
                  placeholder="e.g. 100 shares VFV @ $128"
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="proceedsCents">Proceeds (CAD)</Label>
                  <Input
                    id="proceedsCents"
                    name="proceedsCents"
                    required
                    inputMode="decimal"
                    placeholder="12800.00"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acbCents">ACB (CAD)</Label>
                  <Input
                    id="acbCents"
                    name="acbCents"
                    required
                    inputMode="decimal"
                    placeholder="10000.00"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outlaysCents">Outlays (CAD)</Label>
                  <Input
                    id="outlaysCents"
                    name="outlaysCents"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t5008Source">T5008 source</Label>
                  <Input
                    id="t5008Source"
                    name="t5008Source"
                    maxLength={120}
                    placeholder="e.g. Wealthsimple"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" maxLength={500} autoComplete="off" />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add disposition"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CapitalRow({
  row,
  isFiled,
  onDeleted,
}: {
  row: CapitalTransaction;
  isFiled: boolean;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const gain = row.proceedsCents - row.acbCents - row.outlaysCents;

  function onDelete() {
    if (!confirm(`Delete "${row.description}"?`)) return;
    startTransition(async () => {
      const r = await deleteCapitalTransaction(row.id);
      if (r.ok) {
        toast.success(r.ok);
        onDeleted();
      } else {
        toast.error(r.error ?? "Delete failed");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 truncate">
          <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            {KIND_LABELS[row.kind]}
          </span>
          <span className="truncate font-medium">{row.description}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          disposed {formatLongDate(row.dispositionDate)}
          {row.t5008Source ? ` · ${row.t5008Source}` : null}
          <span className="ml-2 font-mono">
            proceeds {formatCAD(row.proceedsCents)} − ACB {formatCAD(row.acbCents)}
            {row.outlaysCents > 0 ? ` − outlays ${formatCAD(row.outlaysCents)}` : ""}
          </span>
        </div>
      </div>
      <span className={`font-mono text-sm ${gain < 0 ? "text-rose-400" : "text-emerald-400"}`}>
        {gain < 0 ? `(${formatCAD(-gain)})` : formatCAD(gain)}
      </span>
      {!isFiled && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-rose-400"
          onClick={onDelete}
          disabled={pending}
          title="Remove disposition"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
