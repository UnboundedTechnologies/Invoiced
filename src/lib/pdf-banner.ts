/**
 * Shared PDF banner loader — reads the banner image once per Node process
 * and caches the base64 data URI so every PDF renderer (invoice, paystub,
 * HST return, T2 prep summary, future slip generators) embeds from one
 * source of truth without duplicating the fallback chain.
 *
 * Tries banner-pdf.png (trimmed/optimized), banner.png, logo-full.png,
 * logo.png in order. Returns undefined if none are present so callers can
 * degrade gracefully (no banner in PDF rather than crashing).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let cache: string | null = null;

export async function getBannerDataUri(): Promise<string | undefined> {
  if (cache) return cache;
  for (const candidate of [
    "public/banner-pdf.png",
    "public/banner.png",
    "public/logo-full.png",
    "public/logo.png",
  ]) {
    try {
      const buffer = await readFile(resolve(process.cwd(), candidate));
      cache = `data:image/png;base64,${buffer.toString("base64")}`;
      return cache;
    } catch {
      continue;
    }
  }
  return undefined;
}
