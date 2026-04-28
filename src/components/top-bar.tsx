"use client";

import { usePathname } from "next/navigation";
import { MobileNav } from "./mobile-nav";

// Page-name lookup keyed by route. Kept flat (no section grouping) since the
// top bar shows just the page name now — section context lives in the sidebar.
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/psb": "PSB risk",
  "/invoices": "Invoices",
  "/clients": "Clients & contracts",
  "/paycheques": "Paycheques (T4)",
  "/dividends": "Dividends (T5)",
  "/shareholder-loan": "Shareholder loan",
  "/expenses": "Expenses",
  "/hst": "HST return",
  "/corp-tax": "Corporate tax (T2)",
  "/personal-tax": "Personal tax (T1)",
  "/slips": "Year-end slips",
  "/calendar": "Deadlines",
  "/vault": "Document vault",
  "/settings": "Settings",
};

function matchPage(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname.startsWith(`${key}/`));
  return (match && PAGE_TITLES[match]) || "Invoiced";
}

export function TopBar({ corpName }: { corpName: string }) {
  const pathname = usePathname();
  const page = matchPage(pathname);

  return (
    <div className="sticky top-0 z-20 border-b border-border/40 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav corpName={corpName} />
          <h1
            className="truncate text-sm font-medium text-foreground sm:text-base"
            aria-current="page"
          >
            {page}
          </h1>
        </div>

        <div
          className="dq-scene relative h-9 w-[140px] shrink-0 overflow-hidden rounded-md border border-border/40 shadow-sm sm:h-10 sm:w-[200px]"
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
