"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { setFirstQmFy } from "@/server/actions/hst";

export function FirstQmToggle({
  fiscalYear,
  value,
  disabled,
}: {
  fiscalYear: number;
  value: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    if (disabled || pending) return;
    startTransition(async () => {
      const r = await setFirstQmFy(fiscalYear, next);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Switch
        id={`first-qm-${fiscalYear}`}
        checked={value}
        disabled={disabled || pending}
        onCheckedChange={onToggle}
      />
      <Label
        htmlFor={`first-qm-${fiscalYear}`}
        className="flex cursor-pointer flex-col gap-0.5 text-sm font-normal"
      >
        <span>First-year Quick Method election</span>
        <span className="text-[11px] text-muted-foreground">
          +1% off remittance rate on first $30K (max $300) — tick only for the FY you file GST74.
        </span>
      </Label>
    </div>
  );
}
