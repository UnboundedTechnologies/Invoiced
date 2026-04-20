import { db } from "@/lib/db/client";
import { contracts, clients, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { InvoiceForm } from "@/components/invoices/invoice-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) {
    return <div>Settings not seeded. Run pnpm seed.</div>;
  }

  const rows = await db
    .select({ contract: contracts, client: clients })
    .from(contracts)
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .where(eq(contracts.active, true));

  return (
    <div className="space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <h1 className="text-3xl font-bold tracking-tight">New invoice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a contract, fill in the period and hours, click generate. The CRA-compliant PDF is built and saved
          to the vault automatically.
        </p>
      </div>

      <InvoiceForm
        contracts={rows}
        hstRateBps={s.hstRateBps}
        invoicePrefix={s.invoicePrefix}
        nextInvoiceSeq={s.nextInvoiceSeq}
      />
    </div>
  );
}
