import { FolderLock } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db/client";
import { documents, settings } from "@/lib/db/schema";
import { getPinHash } from "@/lib/vault-pin";
import { hasVaultPinSession } from "@/lib/vault-pin-session";
import {
  VAULT_CATEGORIES,
  isVaultCategory,
  type VaultCategory,
} from "@/lib/vault-categories";
import { resolveParentLinks } from "@/lib/vault-parent-links";
import { PinGate } from "@/components/vault/pin-gate";
import { VaultFilters } from "@/components/vault/vault-filters";
import { VaultTable } from "@/components/vault/vault-table";
import { UploadVaultDialog } from "@/components/vault/upload-vault-dialog";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  category?: string;
  q?: string;
  archived?: string;
}>;

export default async function VaultPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // Gate 1 — is a PIN even set? First-visit flow renders setup.
  const pinHash = await getPinHash();
  if (!pinHash) {
    return (
      <div className="space-y-6">
        <VaultHeader />
        <PinGate mode="setup" />
      </div>
    );
  }

  // Gate 2 — is this browser session unlocked?
  const unlocked = await hasVaultPinSession();
  if (!unlocked) {
    return (
      <div className="space-y-6">
        <VaultHeader />
        <PinGate mode="verify" />
      </div>
    );
  }

  const showArchived = sp.archived === "1";
  const categoryFilter: VaultCategory | null =
    sp.category && isVaultCategory(sp.category) ? sp.category : null;
  const q = (sp.q || "").trim();

  // Load rows under the current archived scope. Filter in-memory for `q` +
  // `category` since the row count is small (single-user app). Adding SQL
  // filters is trivial when we outgrow this.
  const wheres: SQL[] = [];
  if (!showArchived) wheres.push(eq(documents.archived, false));

  const scopedRows = await db
    .select()
    .from(documents)
    .where(wheres.length === 0 ? undefined : and(...wheres))
    .orderBy(desc(documents.uploadedAt));

  // Counts per category within the current archived scope — shown in pill badges.
  const counts: Record<string, number> = { all: scopedRows.length };
  for (const c of VAULT_CATEGORIES) counts[c] = 0;
  for (const r of scopedRows) {
    if (r.category in counts) counts[r.category] = (counts[r.category] ?? 0) + 1;
  }

  let rows = scopedRows;
  if (categoryFilter) rows = rows.filter((r) => r.category === categoryFilter);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle),
    );
  }

  const parentLinks = await resolveParentLinks(rows);
  const pinSetAt = await getPinSetAt();

  return (
    <div className="space-y-6">
      <VaultHeader right={<UploadVaultDialog />} pinSetAt={pinSetAt} />
      <VaultFilters counts={counts} />
      {rows.length === 0 ? (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-inset ring-cyan-500/30">
              <FolderLock className="size-6 text-cyan-400" />
            </div>
            <CardTitle>
              {q || categoryFilter || showArchived ? "No matches" : "Vault is empty"}
            </CardTitle>
            <CardDescription>
              {q || categoryFilter
                ? "Adjust the filter or search term."
                : showArchived
                  ? "No archived documents yet."
                  : "Upload articles of incorporation, NDAs, or filed tax returns to keep them behind the vault PIN. Auto-generated invoices, paystubs, and receipts will also appear here."}
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <VaultTable rows={rows} parentLinks={parentLinks} />
      )}
    </div>
  );
}

async function getPinSetAt(): Promise<Date | null> {
  const [row] = await db
    .select({ t: settings.vaultPinSetAt })
    .from(settings)
    .where(eq(settings.id, 1));
  return row?.t ?? null;
}

function VaultHeader({
  right,
  pinSetAt,
}: {
  right?: React.ReactNode;
  pinSetAt?: Date | null;
}) {
  return (
    <div className="flex items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Document vault</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the corp has on file, behind a 6-digit PIN.
          {pinSetAt && (
            <>
              {" · "}
              <span className="text-muted-foreground">
                PIN set{" "}
                {pinSetAt.toLocaleDateString("en-CA", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </>
          )}
        </p>
      </div>
      {right}
    </div>
  );
}
