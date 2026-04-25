import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { VaultAutoLock } from "@/components/vault/vault-auto-lock";
import { getSettings } from "@/lib/db/queries";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { auth } from "../../../auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 2FA enrollment is mandatory. Anyone signed in without totpEnabledAt is
  // bounced to /onboard/2fa until they complete the wizard. Middleware can't
  // do this check (edge runtime, no DB), so the gate lives here.
  const session = await auth();
  const sessionEmail = session?.user?.email?.toLowerCase() ?? null;
  if (sessionEmail) {
    const [me] = await db
      .select({ totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(eq(users.email, sessionEmail));
    if (!me?.totpEnabledAt) redirect("/onboard/2fa");
  }

  const s = await getSettings();
  const corpName = s?.corpLegalName ?? "Unbounded Technologies Inc.";
  const brandPrimary = s?.brandPrimaryHex ?? "#6366F1";
  const brandAccent = s?.brandAccentHex ?? "#22D3EE";
  // Override the shadcn CSS variables for the authenticated app so that the
  // Settings → Branding color pickers live-repaint the UI on save (alongside
  // their existing effect on invoice/paystub PDFs). `--ring` tracks primary.
  const brandStyle = {
    "--primary": brandPrimary,
    "--ring": brandPrimary,
    "--accent": brandAccent,
  } as React.CSSProperties;

  return (
    <div className="relative flex min-h-screen bg-background" style={brandStyle}>
      {/* Background decorations: floating colored orbs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[40rem] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-[32rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <AppSidebar corpName={corpName} />
      <main className="flex-1 overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <TopBar corpName={corpName} />
        <div className="mx-auto max-w-7xl px-6 py-8 animate-in fade-in duration-300">{children}</div>
      </main>
      <VaultAutoLock />
    </div>
  );
}
