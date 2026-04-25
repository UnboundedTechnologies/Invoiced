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

// ── Web Push handlers ────────────────────────────────────────────────────────
// Daily cron pushes a deadline summary to every subscription. The payload is
// JSON-encoded { title, body, url }; on click we focus an existing tab on
// the URL or open a new one.

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: "Invoiced", body: event.data?.text() ?? "" };
  }
  const title = payload.title || "Invoiced";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/calendar" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/calendar";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing tab on the same origin if possible, navigate it.
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await (client as WindowClient).navigate(url);
            } catch {
              /* cross-origin or otherwise — open new instead */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
