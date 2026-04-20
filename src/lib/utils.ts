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
