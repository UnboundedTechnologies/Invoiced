"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setMethod } from "@/server/actions/hst";

export function MethodToggle({
  fiscalYear,
  method,
  disabled,
  disabledReason,
}: {
  fiscalYear: number;
  method: "regular" | "quick";
  disabled: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    if (disabled || pending) return;
    if (value !== "regular" && value !== "quick") return;
    if (value === method) return;
    startTransition(async () => {
      const r = await setMethod(fiscalYear, value);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div>
      <Tabs value={method} onValueChange={onChange}>
        <TabsList className={disabled ? "pointer-events-none opacity-60" : ""}>
          <TabsTrigger value="regular" disabled={disabled || pending}>
            Regular method
          </TabsTrigger>
          <TabsTrigger value="quick" disabled={disabled || pending}>
            Quick method
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {disabled && disabledReason ? (
        <p className="mt-1.5 text-[11px] text-amber-400">{disabledReason}</p>
      ) : null}
    </div>
  );
}
