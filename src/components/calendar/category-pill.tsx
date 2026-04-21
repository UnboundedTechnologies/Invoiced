import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/tones";
import { TONE } from "@/lib/tones";

export type DeadlineCategory =
  | "hst"
  | "t2"
  | "t4"
  | "t1"
  | "annual_return"
  | "payroll"
  | "other";

const CATEGORY_TONE: Record<DeadlineCategory, Tone> = {
  hst: "sky",
  t2: "indigo",
  t4: "amber",
  t1: "violet",
  annual_return: "cyan",
  payroll: "rose",
  other: "emerald",
};

const CATEGORY_LABEL: Record<DeadlineCategory, string> = {
  hst: "HST",
  t2: "T2",
  t4: "T4",
  t1: "T1",
  annual_return: "Annual return",
  payroll: "Payroll",
  other: "Other",
};

export function CategoryPill({ category }: { category: string }) {
  const known = (Object.keys(CATEGORY_TONE) as DeadlineCategory[]).includes(
    category as DeadlineCategory,
  );
  const c = (known ? category : "other") as DeadlineCategory;
  const t = TONE[CATEGORY_TONE[c]];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
        t.bg,
        t.text,
        t.border,
      )}
    >
      {CATEGORY_LABEL[c]}
    </span>
  );
}
