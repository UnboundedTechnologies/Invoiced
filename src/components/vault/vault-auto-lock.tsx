"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname } from "next/navigation";
import { lockVaultSession } from "@/server/actions/vault-pin";

/**
 * Fires `lockVaultSession()` the moment the user navigates away from any
 * `/vault*` route. Combined with the 60-second non-sliding cookie TTL, this
 * gives "PIN every access" — the cookie is cleared immediately on leave, and
 * any edge case (closing the tab, hard crash) is bounded by the short TTL.
 */
export function VaultAutoLock() {
  const pathname = usePathname();
  const wasInVault = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const inVault = pathname.startsWith("/vault");

    if (wasInVault.current && !inVault) {
      // Leaving /vault — clear the PIN cookie immediately.
      startTransition(() => {
        void lockVaultSession().catch(() => {
          // Best-effort; short TTL catches any miss.
        });
      });
    }

    wasInVault.current = inVault;
  }, [pathname]);

  return null;
}
