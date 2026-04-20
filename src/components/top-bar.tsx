"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const TITLES: Record<string, { section: string; page: string }> = {
  "/dashboard": { section: "Overview", page: "Dashboard" },
  "/invoices": { section: "Income", page: "Invoices" },
  "/clients": { section: "Income", page: "Clients & contracts" },
  "/paycheques": { section: "Self-pay", page: "Paycheques (T4)" },
  "/dividends": { section: "Self-pay", page: "Dividends (T5)" },
  "/expenses": { section: "Expenses & taxes", page: "Expenses" },
  "/hst": { section: "Expenses & taxes", page: "HST return" },
  "/corp-tax": { section: "Expenses & taxes", page: "Corporate tax (T2)" },
  "/personal-tax": { section: "Expenses & taxes", page: "Personal tax (T1)" },
  "/calendar": { section: "Admin", page: "Deadlines" },
  "/vault": { section: "Admin", page: "Document vault" },
  "/settings": { section: "Admin", page: "Settings" },
};

export function TopBar({ corpName }: { corpName: string }) {
  const pathname = usePathname();
  const meta = TITLES[pathname] ?? { section: "Overview", page: "Invoiced" };

  return (
    <div className="sticky top-0 z-20 border-b border-border/40 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">
            {corpName}
          </Link>
          <ChevronRight className="size-3.5 opacity-50" />
          <span className="hidden sm:inline">{meta.section}</span>
          <ChevronRight className="size-3.5 opacity-50 hidden sm:inline" />
          <span className="font-medium text-foreground">{meta.page}</span>
        </nav>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300",
          )}
        >
          <Sparkles className="size-3" />
          Phase 0
        </span>
      </div>
    </div>
  );
}
