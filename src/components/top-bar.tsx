"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Meta = { section: string; sectionHref: string; page: string };

// sectionHref points at the first page in each sidebar section so clicking
// e.g. "Income" lands on /invoices, "Self-pay" on /paycheques, etc.
const TITLES: Record<string, Meta> = {
  "/dashboard": { section: "Overview", sectionHref: "/dashboard", page: "Dashboard" },
  "/psb": { section: "Overview", sectionHref: "/dashboard", page: "PSB risk" },
  "/invoices": { section: "Income", sectionHref: "/invoices", page: "Invoices" },
  "/clients": { section: "Income", sectionHref: "/invoices", page: "Clients & contracts" },
  "/paycheques": { section: "Self-pay", sectionHref: "/paycheques", page: "Paycheques (T4)" },
  "/dividends": { section: "Self-pay", sectionHref: "/paycheques", page: "Dividends (T5)" },
  "/expenses": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Expenses" },
  "/hst": { section: "Expenses & taxes", sectionHref: "/expenses", page: "HST return" },
  "/corp-tax": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Corporate tax (T2)" },
  "/personal-tax": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Personal tax (T1)" },
  "/calendar": { section: "Admin", sectionHref: "/calendar", page: "Deadlines" },
  "/vault": { section: "Admin", sectionHref: "/calendar", page: "Document vault" },
  "/settings": { section: "Admin", sectionHref: "/calendar", page: "Settings" },
};

function matchMeta(pathname: string): Meta {
  if (TITLES[pathname]) return TITLES[pathname];
  // Fall back to the longest prefix match so /invoices/abc still resolves to the Income section.
  const match = Object.keys(TITLES)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname.startsWith(`${key}/`));
  return (match && TITLES[match]) || { section: "Overview", sectionHref: "/dashboard", page: "Invoiced" };
}

export function TopBar({ corpName }: { corpName: string }) {
  const pathname = usePathname();
  const meta = matchMeta(pathname);

  return (
    <div className="sticky top-0 z-20 border-b border-border/40 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">
            {corpName}
          </Link>
          <ChevronRight className="size-3.5 opacity-50" />
          <Link
            href={meta.sectionHref}
            className="hidden sm:inline hover:text-foreground transition-colors"
          >
            {meta.section}
          </Link>
          <ChevronRight className="size-3.5 opacity-50 hidden sm:inline" />
          <span className="font-medium text-foreground" aria-current="page">
            {meta.page}
          </span>
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
