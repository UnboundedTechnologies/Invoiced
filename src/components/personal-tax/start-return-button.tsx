"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertDraftT1Return } from "@/server/actions/t1";

export function StartT1ReturnButton({
  taxYear,
  variant = "outline",
}: {
  taxYear: number;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await upsertDraftT1Return(taxYear);
      if (r.ok) {
        router.push(`/personal-tax/${taxYear}`);
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={pending} className="gap-2">
      <Plus className="size-4" />
      {pending ? "Starting…" : `Start CY ${taxYear}`}
    </Button>
  );
}
