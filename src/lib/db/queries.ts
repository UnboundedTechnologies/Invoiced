/**
 * Request-scoped cached queries. Every call to `getSettings()` during the same
 * React render resolves to the same Promise, so the (app) layout and every
 * page can call it without incurring an extra HTTPS round-trip to Neon.
 *
 * Uses React's `cache()` — per-request, not cross-request. Server actions that
 * need to mutate and re-read can still call `db.select(...)` directly.
 */
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { settings } from "./schema";

export const getSettings = cache(async () => {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row;
});
