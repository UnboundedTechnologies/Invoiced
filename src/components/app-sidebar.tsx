"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  BadgeDollarSign,
  PiggyBank,
  Receipt,
  CalendarClock,
  FileSpreadsheet,
  FolderLock,
  Building2,
  User,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { logoutAction } from "@/server/actions/auth";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; gated?: boolean };

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Income",
    items: [
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/clients", label: "Clients & contracts", icon: Building2 },
    ],
  },
  {
    label: "Self-pay",
    items: [
      { href: "/paycheques", label: "Paycheques (T4)", icon: BadgeDollarSign, gated: true },
      { href: "/dividends", label: "Dividends (T5)", icon: PiggyBank },
    ],
  },
  {
    label: "Expenses & taxes",
    items: [
      { href: "/expenses", label: "Expenses", icon: Receipt },
      { href: "/hst", label: "HST return", icon: FileSpreadsheet },
      { href: "/corp-tax", label: "Corporate tax (T2)", icon: FileSpreadsheet },
      { href: "/personal-tax", label: "Personal tax (T1)", icon: User },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/calendar", label: "Deadlines", icon: CalendarClock },
      { href: "/vault", label: "Document vault", icon: FolderLock },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-3 px-4 py-5">
        <Image src="/logo.png" alt="Unbounded Technologies" width={36} height={36} />
        <div>
          <div className="text-base font-semibold leading-tight text-brand-gradient">Invoiced</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unbounded Tech.</div>
        </div>
      </div>
      <Separator />
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="size-4" />
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
        ))}
      </nav>
      <Separator />
      <form action={logoutAction} className="p-3">
        <Button type="submit" variant="ghost" size="sm" className="w-full justify-start gap-2">
          <LogOut className="size-4" /> Sign out
        </Button>
      </form>
    </aside>
  );
}
