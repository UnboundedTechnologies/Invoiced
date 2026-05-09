"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Percent } from "lucide-react";
import type { Expense } from "@/lib/db/schema";
import { createExpense, updateExpense } from "@/server/actions/expenses";
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
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { fiscalYearFor } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  type ExpenseCategory,
} from "./category-badge";
import { CcaFields, type CcaInitial } from "./cca-fields";
import { ReceiptUploadField } from "./receipt-upload-field";
import { ReceiptManager } from "./receipt-manager";

type Result = { ok?: string; error?: string; expenseId?: string };

const CATEGORY_ORDER: ExpenseCategory[] = [
  "office_supplies",
  "software_subscriptions",
  "professional_fees",
  "telecom",
  "internet",
  "insurance",
  "bank_fees",
  "meals_entertainment",
  "travel",
  "vehicle",
  "home_office",
  "training",
  "advertising",
  "capital_asset",
  "other",
];

type CcaJson = {
  class?: string;
  classRate?: number;
  acquisitionCostCents?: number;
  businessUsePercent?: number;
  halfYearRuleApplies?: boolean;
  description?: string | null;
};

function ccaFromJson(raw: unknown): CcaInitial | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as CcaJson;
  if (!c.class) return undefined;
  return {
    class: (c.class as CcaInitial["class"]) ?? "other",
    classRate: c.classRate ?? 0,
    acquisitionCostCents: c.acquisitionCostCents ?? 0,
    businessUsePercent: c.businessUsePercent ?? 100,
    halfYearRuleApplies: c.halfYearRuleApplies ?? true,
    description: c.description ?? null,
  };
}

export function ExpenseForm({
  expense,
  fyeMonth,
  fyeDay,
  hstRateBps,
  onDone,
}: {
  expense?: Expense;
  fyeMonth: number;
  fyeDay: number;
  hstRateBps: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const todayISO = new Date().toISOString().slice(0, 10);

  const action = expense
    ? (updateExpense.bind(null, expense.id) as (p: Result | undefined, fd: FormData) => Promise<Result>)
    : createExpense;
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);

  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? todayISO);
  const [category, setCategory] = useState<ExpenseCategory>(
    (expense?.category as ExpenseCategory) ?? "software_subscriptions",
  );
  const [subtotal, setSubtotal] = useState(
    expense ? (expense.subtotalCents / 100).toFixed(2) : "",
  );
  const [hstPaid, setHstPaid] = useState(
    expense ? (expense.hstPaidCents / 100).toFixed(2) : "",
  );
  const [total, setTotal] = useState(
    expense ? (expense.totalCents / 100).toFixed(2) : "",
  );
  const totalTouched = useRef<boolean>(!!expense);

  const hstRatePercent = hstRateBps / 100;
  const ccaInitial = expense ? ccaFromJson(expense.cca) : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      router.refresh();
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onDone, router]);

  // Auto-fill total whenever subtotal or hst changes, unless the user has
  // explicitly edited total (totalTouched). Preserves manual overrides.
  function maybeAutoFillTotal(nextSubtotal?: string, nextHst?: string) {
    if (totalTouched.current) return;
    const s = Number(nextSubtotal ?? subtotal) || 0;
    const h = Number(nextHst ?? hstPaid) || 0;
    if (s === 0 && h === 0) return;
    setTotal((s + h).toFixed(2));
  }

  // Back-compute subtotal + hst from total using current HST rate.
  function splitAtRate() {
    const t = Number(total) || 0;
    if (t <= 0) return;
    const sub = (t * 10000) / (10000 + hstRateBps);
    const hst = t - sub;
    setSubtotal(sub.toFixed(2));
    setHstPaid(hst.toFixed(2));
    totalTouched.current = true;
  }

  const sNum = Number(subtotal) || 0;
  const hNum = Number(hstPaid) || 0;
  const tNum = Number(total) || 0;
  const mismatch = Math.abs(tNum - sNum - hNum) > 0.01;
  const derivedFY = fiscalYearFor(expenseDate, fyeMonth, fyeDay);
  const isCapital = category === "capital_asset";

  return (
    <form action={formAction} className="space-y-4">
      {expense && <input type="hidden" name="expectedVersion" value={expense.version} />}
      {/* Vendor + date */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vendor">Vendor *</Label>
          <Input
            id="vendor"
            name="vendor"
            type="text"
            required
            maxLength={200}
            defaultValue={expense?.vendor ?? ""}
            placeholder="e.g., Apple Canada"
            data-gramm="false"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expenseDate">Date *</Label>
          <Input
            id="expenseDate"
            name="expenseDate"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </div>
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <Label htmlFor="category">Category *</Label>
        <Select
          name="category"
          value={category}
          onValueChange={(v) => setCategory(v as ExpenseCategory)}
        >
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_ORDER.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {category === "meals_entertainment" && (
          <p className="text-[11px] text-amber-400">
            Record the full receipt amount here. CRA caps the deduction at 50% — applied at tax time.
          </p>
        )}
        {isCapital && (
          <p className="text-[11px] text-sky-400">
            Capital asset — fill out CCA class below. Full acquisition cost is recorded; depreciation happens at T2 time.
          </p>
        )}
      </div>

      {/* Money — enter total first, then Split at 13% back-computes subtotal + HST */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Money *</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={splitAtRate}
            disabled={!total || Number(total) <= 0}
            title={`Back-compute subtotal + HST from total at ${hstRatePercent}%`}
          >
            <Percent className="size-3" />
            Split at {hstRatePercent}%
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="totalDollars" className="text-xs text-muted-foreground">
              Total
            </Label>
            <Input
              id="totalDollars"
              name="totalDollars"
              type="number"
              step="0.01"
              min="0"
              required
              value={total}
              onChange={(e) => {
                setTotal(e.target.value);
                totalTouched.current = true;
              }}
              data-gramm="false"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="subtotalDollars" className="text-xs text-muted-foreground">
              Subtotal
            </Label>
            <Input
              id="subtotalDollars"
              name="subtotalDollars"
              type="number"
              step="0.01"
              min="0"
              required
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              onBlur={() => maybeAutoFillTotal(subtotal)}
              data-gramm="false"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hstPaidDollars" className="text-xs text-muted-foreground">
              HST paid
            </Label>
            <Input
              id="hstPaidDollars"
              name="hstPaidDollars"
              type="number"
              step="0.01"
              min="0"
              required
              value={hstPaid}
              onChange={(e) => setHstPaid(e.target.value)}
              onBlur={() => maybeAutoFillTotal(undefined, hstPaid)}
              data-gramm="false"
            />
          </div>
        </div>
        {mismatch && (
          <p className="text-[11px] text-amber-400">
            Subtotal + HST ≠ total. Non-HST items included? (tip, gratuity, delivery)
          </p>
        )}
      </div>

      {/* Capital-asset sub-form */}
      {isCapital && <CcaFields initial={ccaInitial} subtotalDollars={sNum} />}

      {/* Payment method */}
      <div className="space-y-1.5">
        <Label htmlFor="paymentMethod">Payment method</Label>
        <Input
          id="paymentMethod"
          name="paymentMethod"
          type="text"
          maxLength={100}
          defaultValue={expense?.paymentMethod ?? ""}
          placeholder="e.g., Visa •1234, corp debit, eTransfer"
          data-gramm="false"
        />
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="description">Notes</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={expense?.description ?? ""}
          placeholder="Optional memo — what / why"
          data-gramm="false"
        />
      </div>

      {/* Receipt */}
      {expense ? (
        <ReceiptManager expenseId={expense.id} expenseVersion={expense.version} hasReceipt={!!expense.receiptBlobUrl} />
      ) : (
        <ReceiptUploadField />
      )}

      {/* FY preview */}
      <div className="rounded-md bg-muted/20 p-3 text-xs">
        <span className="text-muted-foreground">Fiscal year (auto-derived):</span>{" "}
        <span className="font-mono font-semibold text-foreground">FY {derivedFY}</span>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Saving…" : expense ? "Save changes" : "Record expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}
