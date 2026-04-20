"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Contract, Document } from "@/lib/db/schema";
import { createContract, updateContract } from "@/server/actions/clients";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ContractDocumentSection } from "./contract-document-section";

type Result = { ok?: string; error?: string };
type DocumentLite = Pick<
  Document,
  "id" | "name" | "version" | "sizeBytes" | "uploadedAt" | "supersedesDocumentId"
>;

export function ContractForm({
  clientId,
  contract,
  document,
  onDone,
}: {
  clientId: string;
  contract?: Contract;
  document?: DocumentLite | null;
  onDone: () => void;
}) {
  const action = contract
    ? (updateContract.bind(null, contract.id) as (p: Result | undefined, fd: FormData) => Promise<Result>)
    : (createContract.bind(null, clientId) as (p: Result | undefined, fd: FormData) => Promise<Result>);
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);
  const [hstApplicable, setHst] = useState(contract?.hstApplicable ?? true);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onDone]);

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="label">Contract label</Label>
            <Input id="label" name="label" placeholder="AWS Engineering 2026" defaultValue={contract?.label ?? ""} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="reference">PO / reference #</Label>
            <Input id="reference" name="reference" defaultValue={contract?.reference ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rateDollars">Rate (CAD) *</Label>
            <Input
              id="rateDollars"
              name="rateDollars"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={((contract?.rateCents ?? 0) / 100) || ""}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rateUnit">Rate unit *</Label>
            <Select name="rateUnit" defaultValue={contract?.rateUnit ?? "hour"}>
              <SelectTrigger id="rateUnit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Per hour</SelectItem>
                <SelectItem value="day">Per day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paymentTerms">Payment terms *</Label>
            <Select name="paymentTerms" defaultValue={contract?.paymentTerms ?? "NET_30"}>
              <SelectTrigger id="paymentTerms">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DUE_ON_RECEIPT">Due on receipt</SelectItem>
                <SelectItem value="NET_15">Net 15</SelectItem>
                <SelectItem value="NET_30">Net 30</SelectItem>
                <SelectItem value="NET_45">Net 45</SelectItem>
                <SelectItem value="NET_60">Net 60</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billingCadence">Billing cadence *</Label>
            <Select name="billingCadence" defaultValue={contract?.billingCadence ?? "bi-weekly"}>
              <SelectTrigger id="billingCadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start date *</Label>
            <Input id="startDate" name="startDate" type="date" defaultValue={contract?.startDate ?? ""} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End date</Label>
            <Input id="endDate" name="endDate" type="date" defaultValue={contract?.endDate ?? ""} />
          </div>

          <div className="rounded-md border border-border/40 p-3 sm:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="hstApplicable" className="text-sm">HST applies (13% Ontario)</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Off only if billing a tax-exempt entity (rare).
                </p>
              </div>
              <Switch
                id="hstApplicable"
                name="hstApplicable"
                checked={hstApplicable}
                onCheckedChange={setHst}
              />
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={contract?.notes ?? ""} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? "Saving…" : contract ? "Save changes" : "Create contract"}
          </Button>
        </DialogFooter>
      </form>

      {/* Document upload only available for existing contracts (need an id to upload against) */}
      {contract && (
        <>
          <Separator />
          <ContractDocumentSection contract={contract} document={document ?? null} />
        </>
      )}
    </div>
  );
}
