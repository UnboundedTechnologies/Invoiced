import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/db/queries";
import { db } from "@/lib/db/client";
import { t2Returns, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "../../../../auth";

export default async function SettingsPage() {
  const s = await getSettings();
  const session = await auth();
  const sessionEmail = session?.user?.email?.toLowerCase() ?? null;
  const [me] = sessionEmail
    ? await db
        .select({ totpEnabledAt: users.totpEnabledAt })
        .from(users)
        .where(eq(users.email, sessionEmail))
    : [];
  const totpEnabledAt = me?.totpEnabledAt ?? null;
  // Opening-pool inputs lock once any T2 return has been filed — the
  // closing balance on that return becomes the source of truth. Passing
  // this flag down to the CorpTaxPanel disables the inputs visually in
  // addition to the server-side guard already enforced by updateCorpTax.
  const [anyFiledT2] = s
    ? await db
        .select({ id: t2Returns.id })
        .from(t2Returns)
        .where(eq(t2Returns.status, "filed"))
        .limit(1)
    : [];
  const openingPoolsLocked = !!anyFiledT2;

  if (!s) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings not seeded</CardTitle>
          <CardDescription>
            Run <code>pnpm seed</code> to initialize.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything below is the source of truth for invoices, slips, and tax tools.
        </p>
      </div>
      <SettingsForm data={s} openingPoolsLocked={openingPoolsLocked} totpEnabledAt={totpEnabledAt} />
    </div>
  );
}
