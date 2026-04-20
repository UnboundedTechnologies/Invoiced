"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, FileText, Sparkles } from "lucide-react";
import type { Client, Contract } from "@/lib/db/schema";
import { createInvoice } from "@/server/actions/invoices";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addDaysISO,
  calculateHst,
  formatCAD,
  formatLongDate,
  paymentTermsLabel,
  paymentTermsToDays,
} from "@/lib/utils";

type Result = { ok?: string; error?: string };

type ContractWithClient = {
  contract: Contract;
  client: Client;
};

export function InvoiceForm({
  contracts,
  hstRateBps,
  invoicePrefix,
  nextInvoiceSeq,
}: {
  contracts: ContractWithClient[];
  hstRateBps: number;
  invoicePrefix: string;
  nextInvoiceSeq: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [state, formAction, pending] = useActionState(createInvoice, undefined as Result | undefined);

  const [contractId, setContractId] = useState(contracts[0]?.contract.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [quantity, setQuantity] = useState("");
  const [description, setDescription] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [descTouched, setDescTouched] = useState(false);

  const selected = useMemo(() => contracts.find((c) => c.contract.id === contractId), [contracts, contractId]);

  // Smart default for description based on contract + period
  useEffect(() => {
    if (descTouched) return;
    if (!selected || !periodStart || !periodEnd) return;
    const label = selected.contract.label || "Professional services";
    setDescription(`${label} for the period ${formatLongDate(periodStart)} to ${formatLongDate(periodEnd)}`);
  }, [selected, periodStart, periodEnd, descTouched]);

  // Show toast on error
  useEffect(() => {
    if (state?.error) toast.error(state.error);
  }, [state]);

  const qty = Number(quantity) || 0;
  const subtotalCents = selected ? Math.round(qty * selected.contract.rateCents) : 0;
  const hstCents = selected?.contract.hstApplicable ? calculateHst(subtotalCents, hstRateBps) : 0;
  const totalCents = subtotalCents + hstCents;
  const dueDate = selected ? addDaysISO(issueDate, paymentTermsToDays(selected.contract.paymentTerms)) : "";
  const previewNumber = `${invoicePrefix}-${String(nextInvoiceSeq).padStart(4, "0")}`;

  const canSubmit =
    !!selected &&
    !!periodStart &&
    !!periodEnd &&
    qty > 0 &&
    !!description &&
    !!issueDate &&
    !pending;

  if (contracts.length === 0) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <CardTitle>No active contracts</CardTitle>
          <CardDescription>
            You need at least one active contract before you can issue an invoice. Add one in Clients & contracts.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <form action={formAction} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>New invoice</CardTitle>
            <CardDescription>Few inputs, one click. The PDF gets generated and stored automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="contractId">Contract *</Label>
              <Select name="contractId" value={contractId} onValueChange={setContractId}>
                <SelectTrigger id="contractId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map(({ contract, client }) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {client.legalName}
                      {contract.label ? ` · ${contract.label}` : ""} · {formatCAD(contract.rateCents)}/{contract.rateUnit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <div className="text-[11px] text-muted-foreground">
                  {paymentTermsLabel(selected.contract.paymentTerms)} ·{" "}
                  {selected.contract.hstApplicable ? "HST applies" : "No HST"} ·{" "}
                  {selected.contract.billingCadence}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Period start *</Label>
                <Input
                  id="periodStart"
                  name="periodStart"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Period end *</Label>
                <Input
                  id="periodEnd"
                  name="periodEnd"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantity">
                  {selected?.contract.rateUnit === "day" ? "Days worked *" : "Hours worked *"}
                </Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issueDate">Issue date *</Label>
                <Input
                  id="issueDate"
                  name="issueDate"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescTouched(true);
                }}
                required
              />
              {!descTouched && selected && (
                <p className="text-[11px] text-muted-foreground">
                  Auto-generated from contract + period. Edit freely; it'll be locked into the PDF.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment instructions, thank you, references..."
              />
            </div>

            <Button type="submit" variant="brand" size="lg" disabled={!canSubmit} className="w-full gap-2">
              <Sparkles className="size-4" />
              {pending ? "Generating PDF…" : `Generate invoice ${previewNumber}`}
            </Button>
          </CardContent>
        </Card>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Live preview</CardTitle>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-inset ring-primary/30">
                {previewNumber}
              </span>
            </div>
            {selected && <CardDescription>{selected.client.legalName}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/40 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarRange className="size-3.5" />
                Service period
              </div>
              <div className="mt-1 text-sm font-medium">
                {periodStart && periodEnd
                  ? `${formatLongDate(periodStart)} → ${formatLongDate(periodEnd)}`
                  : "Pick the period"}
              </div>
            </div>
            <PreviewLine label="Subtotal" value={formatCAD(subtotalCents)} />
            <PreviewLine
              label={`HST ${(hstRateBps / 100).toFixed(2)}%`}
              value={formatCAD(hstCents)}
              muted={!selected?.contract.hstApplicable}
            />
            <div className="border-t border-border/60 pt-3">
              <div className="flex items-end justify-between">
                <span className="text-sm text-muted-foreground">Total due</span>
                <span className="text-2xl font-bold text-brand-gradient">{formatCAD(totalCents)} CAD</span>
              </div>
            </div>
            {dueDate && (
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 p-2 text-xs">
                <FileText className="size-3.5 text-amber-400" />
                <span className="text-muted-foreground">Pay by</span>
                <span className="ml-auto font-medium text-amber-300">{formatLongDate(dueDate)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function PreviewLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${muted ? "opacity-50" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
