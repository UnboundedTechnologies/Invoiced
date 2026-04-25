/// <reference lib="webworker" />
/**
 * Service worker entry — Serwist generates `public/sw.js` from this at build
 * time. Strategy is intentionally minimal:
 *   - Precache the static build manifest (`/_next/static/*`) so cold launches
 *     of the installed PWA render the chrome instantly even on flaky cellular.
 *   - Runtime cache the rest with Serwist's defaults (Network-First for
 *     navigation, Stale-While-Revalidate for static assets).
 *
 * Critically, we DO NOT cache:
 *   - API routes (auth-sensitive, including /api/documents/[id])
 *   - Server actions (POST, never cached anyway)
 *   - The vault page (no-store header set in next.config.ts)
 *
 * Auth cookies are HttpOnly + per-domain so a stale precached HTML shell
 * couldn't leak data even if it were served — the actual data fetch always
 * goes to the network.
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
