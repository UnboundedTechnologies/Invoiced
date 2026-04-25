import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { auth } from "../../../../auth";
import { OnboardForm } from "./onboard-form";

/**
 * Forced 2FA enrollment, gated by an active session. The (app) layout
 * redirects here for any signed-in user without totpEnabledAt. If the user
 * already has 2FA enabled, bounce them to /dashboard so this page can't be
 * used to re-enrol behind the wizard's revoke flow.
 */
export default async function OnboardTwoFactorPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const [me] = await db
    .select({ totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.email, session.user.email.toLowerCase()));

  if (me?.totpEnabledAt) redirect("/dashboard");

  return <OnboardForm email={session.user.email} />;
}
