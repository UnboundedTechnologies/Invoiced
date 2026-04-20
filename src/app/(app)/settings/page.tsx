import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings not seeded</CardTitle>
          <CardDescription>Run <code>pnpm seed</code> to initialize.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only for now — editor lands in Phase 1.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Corporation</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Legal name" value={s.corpLegalName} />
          <Separator />
          <Row label="Business Number" value={s.businessNumber} />
          <Row label="HST account" value={s.hstAccount} />
          <Row
            label="Payroll account"
            value={
              s.payrollAccount ?? (
                <span className="text-amber-600">Not registered — salary tool locked until you add it.</span>
              )
            }
          />
          <Row label="Corp income tax" value={s.corpIncomeTaxAccount} />
          <Separator />
          <Row
            label="Address"
            value={
              <>
                {s.addressLine1}
                {s.addressLine2 ? `, ${s.addressLine2}` : ""}, {s.city}, {s.province} {s.postalCode}, {s.country}
              </>
            }
          />
          <Row label="Fiscal year-end" value={`${String(s.fiscalYearEndMonth).padStart(2, "0")}-${String(s.fiscalYearEndDay).padStart(2, "0")}`} />
          <Row label="HST filing" value={`${s.hstFilingFrequency} @ ${s.hstRateBps / 100}%`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Director / Sole employee</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Legal name" value={s.directorLegalName} />
          <Row label="Email" value={s.directorEmail} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Self-pay strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Strategy" value={s.paymentStrategy} />
          <Row label="Target annual salary" value={s.targetAnnualSalaryCents ? `$${(s.targetAnnualSalaryCents / 100).toLocaleString("en-CA")} CAD` : "—"} />
          <Row label="Pay cadence" value={s.payCadence} />
          <Row label="Pay-day rule" value={s.payDayRule} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent>
          <Row
            label="Primary"
            value={
              <span className="inline-flex items-center gap-2">
                <span className="size-4 rounded" style={{ background: s.brandPrimaryHex }} /> {s.brandPrimaryHex}
              </span>
            }
          />
          <Row
            label="Accent"
            value={
              <span className="inline-flex items-center gap-2">
                <span className="size-4 rounded" style={{ background: s.brandAccentHex }} /> {s.brandAccentHex}
              </span>
            }
          />
          <Row label="Invoice prefix" value={s.invoicePrefix} />
          <Row label="Next invoice #" value={`${s.invoicePrefix}-${String(s.nextInvoiceSeq).padStart(4, "0")}`} />
        </CardContent>
      </Card>
    </div>
  );
}
