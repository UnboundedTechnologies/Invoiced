import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer cents as CAD with 2 decimals. */
export function formatCAD(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

/** Calculate HST (basis points) on a subtotal in cents. Returns cents. */
export function calculateHst(subtotalCents: number, hstRateBps: number): number {
  return Math.round((subtotalCents * hstRateBps) / 10_000);
}

/** Map a payment-terms enum to a number of days from issue to due. */
export function paymentTermsToDays(terms: string): number {
  switch (terms) {
    case "DUE_ON_RECEIPT":
      return 0;
    case "NET_15":
      return 15;
    case "NET_30":
      return 30;
    case "NET_45":
      return 45;
    case "NET_60":
      return 60;
    default:
      return 30;
  }
}

/** Human-readable label for a payment-terms enum. */
export function paymentTermsLabel(terms: string): string {
  switch (terms) {
    case "DUE_ON_RECEIPT":
      return "Due on receipt";
    case "NET_15":
      return "Net 15 days";
    case "NET_30":
      return "Net 30 days";
    case "NET_45":
      return "Net 45 days";
    case "NET_60":
      return "Net 60 days";
    default:
      return terms;
  }
}

/** Add days to an ISO date string, return new ISO date string (YYYY-MM-DD). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pluralize a unit based on quantity (1 → "hour", 1.5 / 0 / 40 → "hours"). */
export function pluralizeUnit(qty: number, unit: string): string {
  return qty === 1 ? unit : `${unit}s`;
}

/** Format an ISO date as e.g., "April 27, 2026". */
export function formatLongDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Count business days (Mon-Fri) in [startISO, endISO] inclusive.
 * Public holidays are NOT excluded — this is an approximation for invoice
 * quantity defaults. Returns 0 if end < start or either date is malformed.
 * Parses via UTC to sidestep DST / local-TZ off-by-ones.
 */
export function businessDaysBetweenISO(startISO: string, endISO: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) return 0;
  if (endISO < startISO) return 0;
  const [ys, ms, ds] = startISO.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = endISO.split("-").map(Number) as [number, number, number];
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  let count = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    const day = new Date(t).getUTCDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * Compute an invoice quantity (hours or days) from a weekly rate applied over
 * the business days in a period. `weeks = businessDays / 5`, so a full Mon-Fri
 * week yields 1 week. Rounded to 2 decimals to match the form + DB basis.
 */
export function quantityFromWeekly(perWeek: number, startISO: string, endISO: string): number {
  const bd = businessDaysBetweenISO(startISO, endISO);
  const raw = perWeek * (bd / 5);
  return Math.round(raw * 100) / 100;
}
