import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/db/queries";

export default async function SettingsPage() {
  const s = await getSettings();

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
      <SettingsForm data={s} />
    </div>
  );
}
