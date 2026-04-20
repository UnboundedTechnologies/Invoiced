"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CcaClass = "8" | "10" | "10.1" | "12" | "50" | "other";

export type CcaInitial = {
  class: CcaClass;
  classRate: number;
  acquisitionCostCents: number;
  businessUsePercent: number;
  halfYearRuleApplies: boolean;
  description: string | null;
};

const CLASS_DEFAULTS: Record<CcaClass, { rate: number; halfYear: boolean; label: string }> = {
  "8": { rate: 20, halfYear: true, label: "Class 8 · 20% — furniture, office equipment" },
  "10": { rate: 30, halfYear: true, label: "Class 10 · 30% — general EDP equipment, vehicles ≤ $38k" },
  "10.1": { rate: 30, halfYear: true, label: "Class 10.1 · 30% — passenger vehicles > $38k (cost capped)" },
  "12": { rate: 100, halfYear: false, label: "Class 12 · 100% — tools/software < $500, off-the-shelf software" },
  "50": { rate: 55, halfYear: true, label: "Class 50 · 55% — computers, monitors, tablets (post-2007)" },
  other: { rate: 0, halfYear: true, label: "Other — enter rate manually" },
};

export function CcaFields({
  initial,
  subtotalDollars,
}: {
  initial?: CcaInitial;
  subtotalDollars: number;
}) {
  const [ccaClass, setCcaClass] = useState<CcaClass>(initial?.class ?? "50");
  const [classRate, setClassRate] = useState<number>(initial?.classRate ?? CLASS_DEFAULTS["50"].rate);
  const [halfYear, setHalfYear] = useState<boolean>(
    initial?.halfYearRuleApplies ?? CLASS_DEFAULTS["50"].halfYear,
  );
  const [acquisitionCost, setAcquisitionCost] = useState<string>(
    initial
      ? (initial.acquisitionCostCents / 100).toFixed(2)
      : subtotalDollars > 0
        ? subtotalDollars.toFixed(2)
        : "",
  );
  const [bizUse, setBizUse] = useState<string>(String(initial?.businessUsePercent ?? 100));

  // When user picks a new class, snap to its defaults (rate + half-year). They
  // can still override the rate for "other" or exotic cases.
  useEffect(() => {
    const d = CLASS_DEFAULTS[ccaClass];
    setClassRate(d.rate);
    setHalfYear(d.halfYear);
  }, [ccaClass]);

  return (
    <div className="space-y-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
        Capital asset (CCA)
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cca_class">CCA class *</Label>
        <Select
          value={ccaClass}
          onValueChange={(v) => setCcaClass(v as CcaClass)}
          name="cca_class"
        >
          <SelectTrigger id="cca_class">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CLASS_DEFAULTS) as CcaClass[]).map((k) => (
              <SelectItem key={k} value={k}>
                {CLASS_DEFAULTS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cca_classRate">Rate % *</Label>
          <Input
            id="cca_classRate"
            name="cca_classRate"
            type="number"
            step="0.1"
            min="0"
            max="100"
            required
            value={classRate}
            onChange={(e) => setClassRate(Number(e.target.value))}
            data-gramm="false"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cca_acquisitionCostDollars">Acquisition cost (CAD) *</Label>
          <Input
            id="cca_acquisitionCostDollars"
            name="cca_acquisitionCostDollars"
            type="number"
            step="0.01"
            min="0"
            required
            value={acquisitionCost}
            onChange={(e) => setAcquisitionCost(e.target.value)}
            data-gramm="false"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cca_businessUsePercent">Business use % *</Label>
          <Input
            id="cca_businessUsePercent"
            name="cca_businessUsePercent"
            type="number"
            step="1"
            min="1"
            max="100"
            required
            value={bizUse}
            onChange={(e) => setBizUse(e.target.value)}
            data-gramm="false"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 p-2.5">
        <div>
          <Label htmlFor="cca_halfYearRuleApplies" className="text-sm">
            Half-year rule applies
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            On for most classes (first-year CCA is halved). Off for class 12 software. AII suspension handled at T2 time.
          </p>
        </div>
        <Switch
          id="cca_halfYearRuleApplies"
          name="cca_halfYearRuleApplies"
          checked={halfYear}
          onCheckedChange={setHalfYear}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cca_description">Asset description</Label>
        <Input
          id="cca_description"
          name="cca_description"
          type="text"
          maxLength={500}
          placeholder="e.g., MacBook Pro M4, 14-inch, space black"
          defaultValue={initial?.description ?? ""}
          data-gramm="false"
        />
      </div>
    </div>
  );
}
