"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertDraftT2Return } from "@/server/actions/t2";

export function StartT2ReturnButton({
  fiscalYear,
  variant = "outline",
}: {
  fiscalYear: number;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await upsertDraftT2Return(fiscalYear);
      if (r.ok) {
        router.push(`/corp-tax/${fiscalYear}`);
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={pending} className="gap-2">
      <Plus className="size-4" />
      {pending ? "Starting…" : `Start FY ${fiscalYear}`}
    </Button>
  );
}
