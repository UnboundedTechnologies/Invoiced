import Link from "next/link";
import { ShieldAlert, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PsbDashboardBanner({
  score,
  risk,
  criticalMissing,
}: {
  score: number;
  risk: "green" | "amber" | "red";
  criticalMissing: boolean;
}) {
  if (risk === "green") return null;

  const palette =
    risk === "red"
      ? {
          border: "border-rose-500/40",
          bg: "bg-rose-500/5",
          text: "text-rose-400",
          hover: "hover:text-rose-200",
        }
      : {
          border: "border-amber-500/40",
          bg: "bg-amber-500/5",
          text: "text-amber-400",
          hover: "hover:text-amber-200",
        };

  const headline = criticalMissing
    ? "A critical PSB defense is missing."
    : risk === "red"
      ? "PSB risk is high."
      : "PSB risk is elevated.";

  return (
    <Link
      href="/psb"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors",
        palette.border,
        palette.bg,
        palette.hover,
      )}
    >
      <div className="flex items-center gap-3">
        <ShieldAlert className={cn("size-5 shrink-0", palette.text)} />
        <div>
          <div className="font-semibold">
            <span className={palette.text}>{headline}</span>{" "}
            <span className="text-muted-foreground">Score {score}/100.</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Open the checklist to see the top 3 fixes that move you toward green.
          </div>
        </div>
      </div>
      <ChevronRight className={cn("size-4 shrink-0", palette.text)} />
    </Link>
  );
}
