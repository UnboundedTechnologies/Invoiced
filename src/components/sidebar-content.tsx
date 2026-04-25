"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  BadgeDollarSign,
  PiggyBank,
  Coins,
  Receipt,
  CalendarClock,
  FileSpreadsheet,
  FolderLock,
  Building2,
  Settings,
  ShieldAlert,
  Landmark,
  Calculator,
  Target,
  LogOut,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { logoutAction } from "@/server/actions/auth";
import { TONE, type Tone } from "@/lib/tones";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  gated?: boolean;
};

const SECTIONS: { label: string; tone: Tone; items: NavItem[] }[] = [
  {
    label: "Overview",
    tone: "indigo",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tone: "indigo" },
      { href: "/psb", label: "PSB risk", icon: ShieldAlert, tone: "indigo" },
    ],
  },
  {
    label: "Income",
    tone: "emerald",
    items: [
      { href: "/invoices", label: "Invoices", icon: FileText, tone: "emerald" },
      { href: "/clients", label: "Clients & contracts", icon: Building2, tone: "emerald" },
    ],
  },
  {
    label: "Self-pay",
    tone: "amber",
    items: [
      { href: "/planner", label: "Self-pay planner", icon: Target, tone: "sky" },
      { href: "/paycheques", label: "Paycheques (T4)", icon: BadgeDollarSign, tone: "amber" },
      { href: "/dividends", label: "Dividends (T5)", icon: PiggyBank, tone: "violet" },
      { href: "/shareholder-loan", label: "Shareholder loan", icon: Coins, tone: "cyan" },
    ],
  },
  {
    label: "Expenses & taxes",
    tone: "rose",
    items: [
      { href: "/expenses", label: "Expenses", icon: Receipt, tone: "rose" },
      { href: "/hst", label: "HST return", icon: FileSpreadsheet, tone: "rose" },
      { href: "/corp-tax", label: "Corporate tax (T2)", icon: Landmark, tone: "indigo" },
      { href: "/personal-tax", label: "Personal tax (T1)", icon: Calculator, tone: "rose" },
      { href: "/slips", label: "Year-end slips", icon: FileCheck, tone: "indigo" },
    ],
  },
  {
    label: "Admin",
    tone: "cyan",
    items: [
      { href: "/calendar", label: "Deadlines", icon: CalendarClock, tone: "cyan" },
      { href: "/vault", label: "Document vault", icon: FolderLock, tone: "cyan" },
      { href: "/settings", label: "Settings", icon: Settings, tone: "cyan" },
    ],
  },
];

/**
 * Inner content of the sidebar — header + navigation + sign-out. Wrapped by
 * AppSidebar (desktop, sticky aside) and MobileNav (mobile, drawer Dialog).
 *
 * `onNavigate` lets the mobile drawer close itself when the user taps a
 * nav item (so they're not stuck looking at the drawer after navigating).
 * Desktop doesn't pass this — the sidebar is always visible there.
 */
export function SidebarContent({
  corpName,
  onNavigate,
}: {
  corpName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  let staggerIdx = 0;

  return (
    <>
      {/* Animated brand stripe at the very top */}
      <div className="h-[3px] w-full bg-brand-gradient" />

      {/* Header — clickable, links back to dashboard */}
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="group flex items-center gap-3 px-4 py-5 animate-in fade-in slide-in-from-left-4 duration-500 transition-colors hover:bg-primary/5"
      >
        <Image
          src="/logo.png"
          alt="Unbounded Technologies"
          width={44}
          height={44}
          priority
          className="shrink-0"
        />
        <div className="min-w-0">
          <div className="text-base font-semibold leading-tight text-brand-gradient">Invoiced</div>
          <div className="text-[11px] leading-snug text-muted-foreground line-clamp-2" title={corpName}>
            {corpName}
          </div>
        </div>
      </Link>
      <Separator className="bg-border/50" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => {
          const sectionTone = TONE[section.tone];
          return (
            <div key={section.label} className="mb-4">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider",
                  sectionTone.textSoft,
                )}
              >
                <span className={cn("inline-block size-1.5 rounded-full", sectionTone.bg, "ring-1", sectionTone.border)} />
                {section.label}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const tone = TONE[item.tone];
                  const Icon = item.icon;
                  const delay = staggerIdx++ * 30;
                  return (
                    <li
                      key={item.href}
                      className="animate-in fade-in slide-in-from-left-2 fill-mode-backwards"
                      style={{ animationDuration: "350ms", animationDelay: `${delay}ms` }}
                    >
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200",
                          active
                            ? cn(tone.bg, tone.text, "font-medium")
                            : cn("text-foreground/75 hover:text-foreground", tone.bgHover),
                        )}
                      >
                        {/* Left accent bar on active */}
                        {active && (
                          <span
                            className={cn(
                              "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-current",
                            )}
                          />
                        )}
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            active && tone.text,
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.gated && (
                          <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                            locked
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <Separator className="bg-border/50" />

      {/* Footer */}
      <form action={logoutAction} className="p-3">
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </form>
    </>
  );
}
