import Link from "next/link";
import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";
import { ArrowUpRight } from "lucide-react";

export function QuickActionTile({
  href,
  label,
  description,
  icon: Icon,
  tone,
  delayMs = 0,
}: {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  delayMs?: number;
}) {
  const t = TONE[tone];
  return (
    <Link
      href={href}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm transition-colors duration-300",
        "animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards",
        "hover:" + t.border.replace("border-", "border-"),
      )}
      style={{ animationDuration: "450ms", animationDelay: `${delayMs}ms` }}
    >
      {/* Gradient wash on hover */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br",
          t.topBar,
        )}
        style={{ filter: "blur(40px)", transform: "scale(0.85)" }}
      />

      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg ring-1 ring-inset",
            t.bg,
            t.border,
          )}
        >
          <Icon className={cn("size-5", t.text)} />
        </div>
        <ArrowUpRight
          className={cn(
            "size-4 text-muted-foreground transition-colors duration-300",
            "group-hover:" + t.text.replace("text-", "text-"),
          )}
        />
      </div>
      <div className="mt-3">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
    </Link>
  );
}
