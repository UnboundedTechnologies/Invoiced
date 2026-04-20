import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground ring-border",
  issued: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  void: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
};

export function PaychequeStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
        className,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
