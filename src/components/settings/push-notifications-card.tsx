"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Smartphone, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  subscribePush,
  unsubscribePush,
  listMyPushSubscriptions,
  deletePushSubscription,
  type PushSubRow,
} from "@/server/actions/push";

/** Convert URL-safe base64 → strict ArrayBuffer for pushManager.subscribe()'s
 * applicationServerKey. Returns ArrayBuffer (not Uint8Array) because TS DOM
 * lib types narrow ArrayBufferLike vs ArrayBuffer when SharedArrayBuffer is
 * in scope. */
function urlBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const normalized = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

function shortDeviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Browser";
}

export function PushNotificationsCard({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = useState(false);
  const [rows, setRows] = useState<PushSubRow[]>([]);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
    if (!ok) return;

    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setThisDeviceSubscribed(!!sub);
      } catch {
        setThisDeviceSubscribed(false);
      }
      const list = await listMyPushSubscriptions();
      setRows(list);
    })();
  }, []);

  async function refreshList() {
    const list = await listMyPushSubscriptions();
    setRows(list);
  }

  async function enable() {
    if (!vapidPublicKey) {
      toast.error("VAPID public key isn't configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in env.");
      return;
    }
    if (Notification.permission === "denied") {
      toast.error("Notifications are blocked. Enable in browser settings, then try again.");
      return;
    }
    startTransition(async () => {
      try {
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== "granted") {
          toast.info("Notifications not granted.");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
        });
        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          toast.error("Subscription payload is incomplete. Try again.");
          return;
        }
        const r = await subscribePush({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent,
        });
        if (r.ok) {
          toast.success(r.ok);
          setThisDeviceSubscribed(true);
          await refreshList();
        } else if (r.error) {
          toast.error(r.error);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Subscribe failed.");
      }
    });
  }

  async function disable() {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await unsubscribePush(endpoint);
        }
        setThisDeviceSubscribed(false);
        toast.success("Notifications disabled on this device.");
        await refreshList();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unsubscribe failed.");
      }
    });
  }

  async function removeRemote(id: string) {
    startTransition(async () => {
      const r = await deletePushSubscription(id);
      if (r.ok) {
        toast.success(r.ok);
        await refreshList();
      } else if (r.error) {
        toast.error(r.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5 text-violet-400" />
          Deadline notifications
        </CardTitle>
        <CardDescription>
          One daily push at ~8&nbsp;am ET summarising deadlines due in the next 7 days.
          Requires the app installed via Add to Home Screen on iOS 16.4+.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
            This browser doesn&rsquo;t support Web Push. On iPhone/iPad, install the app via Safari →
            Share → Add to Home Screen, then open the installed app and try again.
          </div>
        ) : permission === "denied" ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-300">
            Notifications are blocked for this site. Enable them in browser settings, then reload.
          </div>
        ) : !vapidPublicKey ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
            Server is missing <code className="rounded bg-background px-1">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>.
            Add the key to Vercel + .env.local and redeploy.
          </div>
        ) : thisDeviceSubscribed ? (
          <Button
            variant="outline"
            onClick={disable}
            disabled={busy}
            className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <BellOff className="size-4" /> Disable on this device
          </Button>
        ) : (
          <Button variant="brand" onClick={enable} disabled={busy}>
            <Bell className="size-4" /> Enable on this device
          </Button>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Registered devices ({rows.length})
            </p>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Smartphone className="size-4 text-muted-foreground" />
                    <div className="text-sm">
                      <div className="font-medium">{shortDeviceLabel(r.userAgent)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Last seen{" "}
                        {new Date(r.lastSeenAt).toLocaleDateString("en-CA", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-rose-400 hover:bg-rose-500/10"
                    onClick={() => removeRemote(r.id)}
                    disabled={busy}
                    aria-label="Revoke this device"
                    title="Revoke"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
