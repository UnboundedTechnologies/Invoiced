import { db } from "@/lib/db/client";
import { clients, contracts, documents } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ClientCard } from "@/components/clients/client-card";
import { NewClientButton } from "@/components/clients/new-client-button";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [allClients, contractRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.archived), asc(clients.legalName)),
    db
      .select({ contract: contracts, document: documents })
      .from(contracts)
      .leftJoin(documents, eq(documents.id, contracts.documentId))
      .orderBy(asc(contracts.startDate)),
  ]);

  const grouped = allClients.map((c) => ({
    client: c,
    contracts: contractRows.filter((row) => row.contract.clientId === c.id),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients & contracts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone you bill. Each client can hold one or more contracts with their own rate and terms.
          </p>
        </div>
        <NewClientButton />
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
              <Building2 className="size-6 text-emerald-400" />
            </div>
            <CardTitle>No clients yet</CardTitle>
            <CardDescription>Add your first client to get started.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ client, contracts: cs }, i) => (
            <div
              key={client.id}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards"
              style={{ animationDuration: "450ms", animationDelay: `${i * 80}ms` }}
            >
              <ClientCard client={client} contracts={cs} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
