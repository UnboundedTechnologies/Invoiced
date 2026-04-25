"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { MobileNav } from "./mobile-nav";

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
  "/shareholder-loan": { section: "Self-pay", sectionHref: "/paycheques", page: "Shareholder loan" },
  "/expenses": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Expenses" },
  "/hst": { section: "Expenses & taxes", sectionHref: "/expenses", page: "HST return" },
  "/corp-tax": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Corporate tax (T2)" },
  "/personal-tax": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Personal tax (T1)" },
  "/slips": { section: "Expenses & taxes", sectionHref: "/expenses", page: "Year-end slips" },
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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav corpName={corpName} />
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
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
          <span className="truncate font-medium text-foreground" aria-current="page">
            {meta.page}
          </span>
        </nav>
        </div>

        <div
          className="dq-scene relative hidden h-10 w-[200px] overflow-hidden rounded-md border border-border/40 shadow-sm sm:block"
          role="img"
          aria-label="Heroes walking through the landscape"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image re-encodes animated GIFs into static frames, which kills the walk cycle */}
          <img
            src="/sprites/dq11nb.gif"
            alt=""
            className="relative h-full w-full select-none object-cover object-[center_80%]"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
