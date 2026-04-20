import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";

export type ExpenseCategory =
  | "office_supplies"
  | "software_subscriptions"
  | "professional_fees"
  | "telecom"
  | "internet"
  | "insurance"
  | "bank_fees"
  | "meals_entertainment"
  | "travel"
  | "vehicle"
  | "home_office"
  | "training"
  | "advertising"
  | "capital_asset"
  | "other";

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  office_supplies: "Office supplies",
  software_subscriptions: "Software subscriptions",
  professional_fees: "Professional fees",
  telecom: "Telecom",
  internet: "Internet",
  insurance: "Insurance",
  bank_fees: "Bank fees",
  meals_entertainment: "Meals & entertainment",
  travel: "Travel",
  vehicle: "Vehicle",
  home_office: "Home office",
  training: "Training",
  advertising: "Advertising",
  capital_asset: "Capital asset",
  other: "Other",
};

const CATEGORY_TONE: Record<ExpenseCategory, Tone | "neutral"> = {
  office_supplies: "indigo",
  home_office: "indigo",
  software_subscriptions: "cyan",
  telecom: "cyan",
  internet: "cyan",
  professional_fees: "amber",
  insurance: "amber",
  bank_fees: "amber",
  meals_entertainment: "rose",
  travel: "rose",
  vehicle: "violet",
  training: "emerald",
  advertising: "emerald",
  capital_asset: "sky",
  other: "neutral",
};

export function CategoryBadge({
  category,
  size = "sm",
}: {
  category: ExpenseCategory;
  size?: "sm" | "md";
}) {
  const tone = CATEGORY_TONE[category];
  const sizeClasses =
    size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";

  if (tone === "neutral") {
    return (
      <span
        className={cn(
          "rounded-full font-medium ring-1 ring-inset",
          sizeClasses,
          "bg-muted text-muted-foreground ring-border/40",
        )}
      >
        {CATEGORY_LABELS[category]}
      </span>
    );
  }

  const t = TONE[tone];
  return (
    <span
      className={cn(
        "rounded-full font-medium ring-1 ring-inset",
        sizeClasses,
        t.bg,
        t.text,
        t.border.replace("border-", "ring-"),
      )}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}
