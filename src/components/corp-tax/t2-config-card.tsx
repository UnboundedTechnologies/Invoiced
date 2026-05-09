"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setIsCcpc, setPriorYearAaii } from "@/server/actions/t2";
import { formatCAD } from "@/lib/utils";

export function T2ConfigCard({
  fiscalYear,
  isCcpc,
  priorYearAaiiCents,
  disabled,
}: {
  fiscalYear: number;
  isCcpc: boolean;
  priorYearAaiiCents: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [togglePending, startToggle] = useTransition();

  const [aaiiState, aaiiAction, aaiiPending] = useActionState(
    setPriorYearAaii.bind(null, fiscalYear),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (aaiiState?.ok) {
      toast.success(aaiiState.ok);
      router.refresh();
    }
    if (aaiiState?.error) toast.error(aaiiState.error);
  }, [aaiiState, router]);

  function onCcpcChange(value: boolean) {
    startToggle(async () => {
      const r = await setIsCcpc(fiscalYear, value);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 rounded-md border border-border/40 bg-card/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="isCcpc" className="text-sm">
              CCPC status
            </Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Canadian-Controlled Private Corp, gates the SBD. Off = general rate only.
            </p>
          </div>
          <Switch
            id="isCcpc"
            checked={isCcpc}
            onCheckedChange={onCcpcChange}
            disabled={disabled || togglePending}
          />
        </div>
      </div>

      <form
        action={aaiiAction}
        className="space-y-1.5 rounded-md border border-border/40 bg-card/30 p-3"
      >
        <Label htmlFor="amountDollars" className="text-sm">
          Prior-year AAII
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Drives the SBD passive-income grind (ITA s.125(5.1)). Currently {formatCAD(priorYearAaiiCents)}.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="amountDollars"
            name="amountDollars"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(priorYearAaiiCents / 100).toFixed(2)}
            disabled={disabled || aaiiPending}
            data-gramm="false"
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={disabled || aaiiPending}>
            {aaiiPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
