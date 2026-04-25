/**
 * Picker source for vault uploads + anywhere we need a "pick a contract"
 * dropdown. Returns lightweight rows already joined with the client name and
 * formatted into a single label, sorted active-first.
 */
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, clients } from "@/lib/db/schema";

export type ContractPickerOption = {
  id: string;
  label: string;
  active: boolean;
};

export async function listContractsForPicker(opts?: {
  includeEnded?: boolean;
}): Promise<ContractPickerOption[]> {
  const includeEnded = opts?.includeEnded ?? false;

  const rows = await db
    .select({
      id: contracts.id,
      label: contracts.label,
      reference: contracts.reference,
      active: contracts.active,
      clientName: clients.legalName,
    })
    .from(contracts)
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    // Active first, then most recently created — predictable order for the
    // dropdown without a separate sort step in the UI.
    .orderBy(desc(contracts.active), asc(clients.legalName), desc(contracts.createdAt));

  const filtered = includeEnded ? rows : rows.filter((r) => r.active);

  return filtered.map((r) => {
    const tail = r.label || r.reference || "Contract";
    const suffix = r.active ? "" : " · ended";
    return {
      id: r.id,
      label: `${r.clientName} · ${tail}${suffix}`,
      active: r.active,
    };
  });
}
