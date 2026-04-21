"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lockVaultSession } from "@/server/actions/vault-pin";

const VAULT_LOCK_CHANNEL = "invoiced-vault-lock";

export function LockVaultButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleLock() {
    startTransition(async () => {
      const r = await lockVaultSession();
      if (r.ok) {
        toast.success(r.ok);
        // Tell sibling tabs to refresh so no tab keeps showing vault content.
        try {
          new BroadcastChannel(VAULT_LOCK_CHANNEL).postMessage("lock");
        } catch {
          // BroadcastChannel unsupported — no-op; 60s TTL still caps exposure.
        }
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleLock}
      disabled={pending}
      className="gap-1.5"
      title="Clear the PIN session immediately"
    >
      <Lock className="size-3.5" />
      {pending ? "Locking…" : "Lock now"}
    </Button>
  );
}
