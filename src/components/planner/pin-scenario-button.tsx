"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pin, PinOff } from "lucide-react";
import { pinScenario, unpinScenario } from "@/server/actions/planner";

export function PinScenarioButton({
  id,
  fiscalYear,
  isPinned,
}: {
  id: string;
  fiscalYear: number;
  isPinned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      const r = isPinned
        ? await unpinScenario(id, fiscalYear)
        : await pinScenario(id, fiscalYear);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={isPinned ? "Unpin scenario" : "Pin scenario to dashboard"}
      title={isPinned ? "Unpin" : "Pin to dashboard"}
      className={
        isPinned
          ? "inline-flex size-7 items-center justify-center rounded-md text-sky-400 transition-colors hover:bg-sky-500/15"
          : "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      {isPinned ? <Pin className="size-4 fill-current" /> : <PinOff className="size-4" />}
    </button>
  );
}
