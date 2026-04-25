import { db } from "@/lib/db/client";
import { clients, contracts, documents, users } from "@/lib/db/schema";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ClientCard } from "@/components/clients/client-card";
import { NewClientButton } from "@/components/clients/new-client-button";
import { hasVaultPinSession } from "@/lib/vault-pin-session";
import { hasVault2faSession } from "@/lib/vault-2fa-session";
import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [allClients, contractRows, attachmentRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.archived), asc(clients.legalName)),
    db
      .select({ contract: contracts, document: documents })
      .from(contracts)
      .leftJoin(documents, eq(documents.id, contracts.documentId))
      .orderBy(asc(contracts.startDate)),
    // Ancillary contract attachments — vault rows where category=contract AND
    // contractId is set. Used by the Attachments accordion on each contract.
    db
      .select({
        id: documents.id,
        name: documents.name,
        sizeBytes: documents.sizeBytes,
        contentType: documents.contentType,
        uploadedAt: documents.uploadedAt,
        contractId: documents.contractId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.category, "contract"),
          isNotNull(documents.contractId),
          eq(documents.archived, false),
        ),
      )
      .orderBy(asc(documents.uploadedAt)),
  ]);

  // Group attachments by contractId — and exclude any row that's actually the
  // primary PDF for that contract (parent-owned, already shown via the
  // ContractDocumentSection). With the current upload flow that overlap can't
  // happen, but be defensive.
  const primaryDocIds = new Set(
    contractRows.map((r) => r.contract.documentId).filter((id): id is string => !!id),
  );
  const attachmentsByContract = new Map<string, typeof attachmentRows>();
  for (const a of attachmentRows) {
    if (!a.contractId || primaryDocIds.has(a.id)) continue;
    const list = attachmentsByContract.get(a.contractId) ?? [];
    list.push(a);
    attachmentsByContract.set(a.contractId, list);
  }

  const grouped = allClients.map((c) => ({
    client: c,
    contracts: contractRows
      .filter((row) => row.contract.clientId === c.id)
      .map((row) => ({
        ...row,
        attachments: attachmentsByContract.get(row.contract.id) ?? [],
      })),
  }));

  // Vault unlock state — passed down so the attachments section knows whether
  // each link can open directly or has to detour through the inline unlock
  // dialog. PIN cookie alone isn't enough when 2FA is enrolled.
  const session = await auth();
  const sessionEmail = session?.user?.email?.toLowerCase() ?? null;
  const [me] = sessionEmail
    ? await db
        .select({ totpEnabledAt: users.totpEnabledAt })
        .from(users)
        .where(eq(users.email, sessionEmail))
    : [];
  const twofaEnrolled = !!me?.totpEnabledAt;
  const [pinUnlocked, twofaUnlocked] = await Promise.all([
    hasVaultPinSession(),
    hasVault2faSession(),
  ]);
  const vaultUnlocked = pinUnlocked && (twofaEnrolled ? twofaUnlocked : true);

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
              <ClientCard
                client={client}
                contracts={cs}
                vaultUnlocked={vaultUnlocked}
                twofaEnrolled={twofaEnrolled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
