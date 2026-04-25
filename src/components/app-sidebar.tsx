import { SidebarContent } from "./sidebar-content";

/**
 * Desktop-only sidebar. Hidden below md (768px); the mobile drawer in the
 * TopBar handles narrower viewports.
 */
export function AppSidebar({ corpName }: { corpName: string }) {
  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r border-border/60 bg-card/40 backdrop-blur-xl">
      <SidebarContent corpName={corpName} />
    </aside>
  );
}
