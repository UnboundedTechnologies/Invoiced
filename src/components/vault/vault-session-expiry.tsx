"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Client-side auto-lock timer.
 *
 * The vault PIN + 2FA cookies are 60s non-sliding (sliding-refresh fires on
 * each successful action). If the user just stays on /vault and idles past
 * the TTL, the cookies expire silently — every subsequent action throws
 * "Vault locked" and the page sits on a stale view.
 *
 * This timer fires `router.refresh()` exactly when the EARLIER of the two
 * cookies expires. Server-side, the next render reads the expired cookies
 * and shows PinGate, getting the user to a clean re-unlock prompt instead
 * of an error toast.
 *
 * Self-resetting: each successful action triggers `router.refresh()` which
 * re-fetches the server tree with a NEW lockAt prop. The `[lockAt]` deps
 * array detects the change and resets the timeout.
 */
export function VaultSessionExpiry({ lockAt }: { lockAt: number }) {
  const router = useRouter();
  useEffect(() => {
    const ms = lockAt - Date.now();
    if (ms <= 0) {
      router.refresh();
      return;
    }
    const t = setTimeout(() => {
      toast.info("Vault locked — enter your PIN to continue.");
      router.refresh();
    }, ms);
    return () => clearTimeout(t);
  }, [lockAt, router]);
  return null;
}
