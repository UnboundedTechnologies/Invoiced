"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CalendarDays, List } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewToggle({ current }: { current: "calendar" | "list" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setView(v: "calendar" | "list") {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "calendar") params.delete("view");
    else params.set("view", "list");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div
      role="tablist"
      aria-label="View"
      className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs"
    >
      <ViewButton
        active={current === "calendar"}
        label="Calendar"
        icon={CalendarDays}
        onClick={() => setView("calendar")}
      />
      <ViewButton
        active={current === "list"}
        label="List"
        icon={List}
        onClick={() => setView("list")}
      />
    </div>
  );
}

function ViewButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/50"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
