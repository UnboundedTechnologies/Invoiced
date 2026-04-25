"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "./sidebar-content";

/**
 * Mobile navigation drawer. Hamburger button visible only below md (768px);
 * tapping opens a sheet that slides in from the left containing the same
 * SidebarContent as the desktop AppSidebar. Tapping any nav item closes the
 * drawer via the `onNavigate` callback.
 *
 * Built on radix-ui/react-dialog (already a dependency for the standard
 * Dialog component) with custom positioning so we avoid pulling in shadcn's
 * Sheet as a new file.
 */
export function MobileNav({ corpName }: { corpName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden size-9 shrink-0"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm md:hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col",
            "border-r border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl",
            "md:hidden",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
            "duration-200",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
          <SidebarContent corpName={corpName} onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
