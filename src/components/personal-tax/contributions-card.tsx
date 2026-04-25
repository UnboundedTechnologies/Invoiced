"use client";

import { useActionState, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PiggyBank, Plus, Trash2, AlertTriangle } from "lucide-react";
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
import { createContribution, deleteContribution } from "@/server/actions/contributions";
import { formatCAD, formatLongDate } from "@/lib/utils";
import type { RrspContribution } from "@/lib/db/schema";

type Props = {
  taxYear: number;
  rows: RrspContribution[];
  rrspContributionsCents: number;
  fhsaContributionsCents: number;
  rrspDeductionCents: number;
  fhsaDeductionCents: number;
  rrspRoomCents: number | null;
  fhsaRoomCents: number | null;
  isFiled: boolean;
};

export function ContributionsCard({
  taxYear,
  rows,
  rrspContributionsCents,
  fhsaContributionsCents,
  rrspDeductionCents,
  fhsaDeductionCents,
  rrspRoomCents,
  fhsaRoomCents,
  isFiled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createContribution,
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

  const rrspRow = formatRoom("RRSP", rrspContributionsCents, rrspDeductionCents, rrspRoomCents);
  const fhsaRow = formatRoom("FHSA", fhsaContributionsCents, fhsaDeductionCents, fhsaRoomCents);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PiggyBank className="size-4 text-sky-400" />
            RRSP / FHSA · Lines 20800 / 20805
          </CardTitle>
          {!isFiled && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
              <Plus className="size-3.5" />
              Add receipt
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No RRSP or FHSA contributions applied to CY {taxYear}.
          </p>
        ) : (
          <div className="space-y-1">
            {rows.map((c) => (
              <ContributionRow
                key={c.id}
                row={c}
                taxYear={taxYear}
                isFiled={isFiled}
                onDeleted={() => router.refresh()}
              />
            ))}
          </div>
        )}

        {(rrspContributionsCents > 0 || fhsaContributionsCents > 0) && (
          <div className="space-y-2 border-t border-border/60 pt-3 text-sm">
            {rrspContributionsCents > 0 && rrspRow}
            {fhsaContributionsCents > 0 && fhsaRow}
          </div>
        )}

        {rrspRoomCents == null && fhsaRoomCents == null ? (
          <p className="text-[11px] text-muted-foreground">
            Set your RRSP / FHSA room in <a className="underline" href="/settings">Settings → Personal tax</a>.
          </p>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action}>
            <DialogHeader>
              <DialogTitle>Add RRSP / FHSA contribution</DialogTitle>
              <DialogDescription>
                Pick which CY this contribution applies against. RRSP contributions
                made Jan-Mar of {taxYear + 1} can elect to deduct against {taxYear}{" "}
                (first-60-days rule).
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kind">Kind</Label>
                  <Select name="kind" defaultValue="rrsp">
                    <SelectTrigger id="kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rrsp">RRSP (line 20800)</SelectItem>
                      <SelectItem value="fhsa">FHSA (line 20805)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="appliedToTaxYear">Apply to CY</Label>
                  <Input
                    id="appliedToTaxYear"
                    name="appliedToTaxYear"
                    type="number"
                    required
                    defaultValue={taxYear}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amountCents">Amount</Label>
                  <Input
                    id="amountCents"
                    name="amountCents"
                    required
                    inputMode="decimal"
                    placeholder="5000.00"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateContributed">Date contributed</Label>
                  <Input
                    id="dateContributed"
                    name="dateContributed"
                    type="date"
                    required
                    defaultValue={`${taxYear}-12-31`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="institutionName">Institution</Label>
                  <Input id="institutionName" name="institutionName" maxLength={200} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receiptNumber">Receipt #</Label>
                  <Input id="receiptNumber" name="receiptNumber" maxLength={80} autoComplete="off" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" maxLength={500} autoComplete="off" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add receipt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function formatRoom(
  label: string,
  contributedCents: number,
  deductedCents: number,
  roomCents: number | null,
) {
  const overContributed = roomCents != null && contributedCents > roomCents;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label} contributed</span>
        <span className="font-mono">{formatCAD(contributedCents)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label} deduction (against income)</span>
        <span className="font-mono text-emerald-400">−{formatCAD(deductedCents)}</span>
      </div>
      {roomCents != null ? (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Room available</span>
          <span className={`font-mono ${overContributed ? "text-rose-400" : "text-muted-foreground"}`}>
            {formatCAD(roomCents)}
          </span>
        </div>
      ) : null}
      {overContributed ? (
        <div className="flex items-center gap-1 pt-1 text-[11px] text-rose-400">
          <AlertTriangle className="size-3" />
          {label} contributions exceed available room. Excess won't be deducted on this return.
        </div>
      ) : null}
    </div>
  );
}

function ContributionRow({
  row,
  taxYear,
  isFiled,
  onDeleted,
}: {
  row: RrspContribution;
  taxYear: number;
  isFiled: boolean;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  // First-60-days flag — contributed in next CY but applied to current.
  const contributedYear = Number(row.dateContributed.slice(0, 4));
  const isFirst60 = contributedYear > taxYear;

  function onDelete() {
    if (!confirm(`Delete ${row.kind.toUpperCase()} contribution for ${formatCAD(row.amountCents)}?`)) {
      return;
    }
    startTransition(async () => {
      const r = await deleteContribution(row.id, row.version);
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
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
              row.kind === "rrsp"
                ? "bg-sky-500/15 text-sky-400"
                : "bg-violet-500/15 text-violet-400"
            }`}
          >
            {row.kind.toUpperCase()}
          </span>
          <span className="truncate font-medium">{row.institutionName ?? "—"}</span>
          {isFirst60 ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              first-60-days
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          contributed {formatLongDate(row.dateContributed)}
          {row.receiptNumber ? ` · receipt ${row.receiptNumber}` : null}
        </div>
      </div>
      <span className="font-mono text-sm">{formatCAD(row.amountCents)}</span>
      {!isFiled && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-rose-400"
          onClick={onDelete}
          disabled={pending}
          title="Remove receipt"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
