"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TONE } from "@/lib/tones";
import {
  VAULT_CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  type VaultCategory,
} from "@/lib/vault-categories";

type CountMap = Partial<Record<VaultCategory | "all", number>>;

export function VaultFilters({ counts }: { counts: CountMap }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(sp.get("q") ?? "");
  const category = sp.get("category") as VaultCategory | null;
  const archived = sp.get("archived") === "1";

  // Debounce text search → URL.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      const next = params.toString();
      const path = next ? `/vault?${next}` : "/vault";
      startTransition(() => router.replace(path, { scroll: false }));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function toggleCategory(c: VaultCategory) {
    const params = new URLSearchParams(sp.toString());
    if (category === c) params.delete("category");
    else params.set("category", c);
    const next = params.toString();
    router.replace(next ? `/vault?${next}` : "/vault", { scroll: false });
  }

  function toggleArchived() {
    const params = new URLSearchParams(sp.toString());
    if (archived) params.delete("archived");
    else params.set("archived", "1");
    const next = params.toString();
    router.replace(next ? `/vault?${next}` : "/vault", { scroll: false });
  }

  function clearAll() {
    setQ("");
    router.replace("/vault", { scroll: false });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(sp.toString());
            params.delete("category");
            const next = params.toString();
            router.replace(next ? `/vault?${next}` : "/vault", { scroll: false });
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            !category
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/30",
          )}
        >
          All
          <span className="rounded-sm bg-background/60 px-1 py-px text-[10px] text-muted-foreground">
            {counts.all ?? 0}
          </span>
        </button>
        {VAULT_CATEGORIES.map((c) => {
          const tone = TONE[CATEGORY_TONE[c]];
          const active = category === c;
          const n = counts[c] ?? 0;
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? cn(tone.border, tone.bg, tone.text)
                  : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/30",
              )}
            >
              {CATEGORY_LABEL[c]}
              <span
                className={cn(
                  "rounded-sm px-1 py-px text-[10px]",
                  active ? "bg-background/60" : "bg-background/50 text-muted-foreground",
                )}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by file name…"
            className="pl-8 pr-8 text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant={archived ? "brand" : "outline"}
          size="sm"
          onClick={toggleArchived}
          className="gap-1.5"
        >
          <Archive className="size-3.5" />
          {archived ? "Showing archived" : "Show archived"}
        </Button>
        {(q || category || archived) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
