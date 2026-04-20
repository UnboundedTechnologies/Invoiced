import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, <span className="text-brand-gradient">{s?.directorLegalName?.split(" ")[0] ?? "there"}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s?.corpLegalName ?? "Unbounded Technologies Inc."} — fiscal year ending{" "}
          {s ? `${String(s.fiscalYearEndMonth).padStart(2, "0")}-${String(s.fiscalYearEndDay).padStart(2, "0")}` : "12-31"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Year-to-date revenue</CardDescription>
            <CardTitle className="text-3xl">$0.00</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">No invoices issued yet.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>HST collected</CardDescription>
            <CardTitle className="text-3xl">$0.00</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Annual filing — next due 2027-04-30.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Self-pay (YTD)</CardDescription>
            <CardTitle className="text-3xl">$0.00</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Strategy: <span className="font-medium capitalize">{s?.paymentStrategy ?? "blend"}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 0 ✅ — App is alive</CardTitle>
          <CardDescription>
            Auth, database, and the toolbox shell are wired up. Pick the next module from the sidebar to start building it
            in Phase 1.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
