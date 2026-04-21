"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { lockVaultSession } from "@/server/actions/vault-pin";

const VAULT_LOCK_CHANNEL = "invoiced-vault-lock";

/**
 * Client-side guard that enforces "PIN every vault access" on three fronts
 * the server cookie alone can't cover:
 *
 *  1. **Navigation away**: immediately calls `lockVaultSession()` when the
 *     user leaves any `/vault*` route. The 60s cookie TTL catches edge cases
 *     (tab close, hard crash); this covers the common case instantly.
 *
 *  2. **Back-button / bfcache restore**: listens for the `pageshow` event
 *     with `persisted=true` — Chrome/Firefox/Safari fire this when a page
 *     is served from the back/forward cache. We `router.refresh()` to force
 *     the server round-trip, which re-runs the PIN gate.
 *
 *  3. **Tab-to-tab sync**: uses BroadcastChannel so that when ANY tab locks
 *     (Lock-now button, nav-away, logout), every open tab refreshes and
 *     picks up the new (locked) state. Without this, Tab B would keep
 *     showing vault content after Tab A locked.
 */
export function VaultAutoLock() {
  const pathname = usePathname();
  const router = useRouter();
  const wasInVault = useRef(false);
  const [, startTransition] = useTransition();

  // 1) Auto-lock on navigation away from /vault
  useEffect(() => {
    const inVault = pathname.startsWith("/vault");
    if (wasInVault.current && !inVault) {
      startTransition(() => {
        void lockVaultSession()
          .then(() => {
            try {
              new BroadcastChannel(VAULT_LOCK_CHANNEL).postMessage("lock");
            } catch {
              // BroadcastChannel unsupported — short TTL covers it.
            }
          })
          .catch(() => {
            // best-effort; short TTL covers it
          });
      });
    }
    wasInVault.current = inVault;
  }, [pathname]);

  // 2) bfcache restore — force a fresh render when the page is served from the
  //    browser's back/forward cache. Without this, Back can show unlocked
  //    vault HTML that was cached before the lock.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) router.refresh();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  // 3) Tab-to-tab sync — any tab's lock triggers a refresh in all tabs so the
  //    newly-cleared cookie gets picked up everywhere.
  useEffect(() => {
    let chan: BroadcastChannel | null = null;
    try {
      chan = new BroadcastChannel(VAULT_LOCK_CHANNEL);
      chan.onmessage = (e) => {
        if (e.data === "lock") router.refresh();
      };
    } catch {
      // BroadcastChannel unsupported in this browser — no-op. Same-browser
      // tabs will still pick up the lock on next navigation.
    }
    return () => {
      chan?.close();
    };
  }, [router]);

  return null;
}
