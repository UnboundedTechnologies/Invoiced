import { sql } from "drizzle-orm";

export const VERSION_CONFLICT_CODE = "version_conflict" as const;

export function parseExpectedVersion(fd: FormData): number | null {
  const raw = fd.get("expectedVersion");
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : null;
}

export const bumpVersion = () => sql`version + 1`;

export function versionConflictError(label: string, expected: number, current: number): string {
  return `This ${label} was updated in another tab (you saw v${expected}, current is v${current}). Refresh and try again.`;
}
