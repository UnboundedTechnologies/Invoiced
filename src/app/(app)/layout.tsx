import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const corpName = s?.corpLegalName ?? "Unbounded Technologies Inc.";

  return (
    <div className="relative flex min-h-screen bg-background">
      {/* Background decorations: floating colored orbs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[40rem] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-[32rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <AppSidebar corpName={corpName} />
      <main className="flex-1 overflow-x-hidden">
        <TopBar corpName={corpName} />
        <div className="mx-auto max-w-6xl px-6 py-8 animate-in fade-in duration-300">{children}</div>
      </main>
    </div>
  );
}
