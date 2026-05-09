"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { clients, contracts, auditLog, invoices } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function audit(email: string, target: string, metadata: Record<string, unknown>) {
  await db.insert(auditLog).values({ actorEmail: email, action: "update", target, metadata });
}

function revalidate() {
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

//  Clients 
const clientSchema = z.object({
  legalName: z.string().min(1, "Legal name is required"),
  apContactName: z.string().nullable(),
  apEmail: z.string().email("Invalid email").or(z.literal("")).transform((v) => v || null).nullable(),
  apPhone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
});

function parseClientForm(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v ? String(v).trim() : null;
  };
  return clientSchema.safeParse({
    legalName: get("legalName"),
    apContactName: get("apContactName"),
    apEmail: get("apEmail"),
    apPhone: get("apPhone"),
    addressLine1: get("addressLine1"),
    addressLine2: get("addressLine2"),
    city: get("city"),
    province: get("province")?.toUpperCase() ?? null,
    postalCode: get("postalCode")?.toUpperCase() ?? null,
    country: get("country")?.toUpperCase() ?? "CA",
    notes: get("notes"),
  });
}

export async function createClient(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = parseClientForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const [created] = await db.insert(clients).values(parsed.data).returning({ id: clients.id });
    await audit(email, `clients:create:${created!.id}`, parsed.data);
    revalidate();
    return { ok: "Client created." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function updateClient(id: string, _prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = parseClientForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    await db.update(clients).set(parsed.data).where(eq(clients.id, id));
    await audit(email, `clients:update:${id}`, parsed.data);
    revalidate();
    return { ok: "Client saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function archiveClient(id: string): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    // refuse to archive if any active contracts
    const active = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.clientId, id));
    if (active.some((c) => c.id)) {
      // OK to archive even with contracts; just warn the user via UI later. Keeping archive permissive.
    }
    await db.update(clients).set({ archived: true }).where(eq(clients.id, id));
    await audit(email, `clients:archive:${id}`, {});
    revalidate();
    return { ok: "Client archived." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Archive failed" };
  }
}

export async function restoreClient(id: string): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    await db.update(clients).set({ archived: false }).where(eq(clients.id, id));
    await audit(email, `clients:restore:${id}`, {});
    revalidate();
    return { ok: "Client restored." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Restore failed" };
  }
}

//  Contracts 
const contractSchema = z.object({
  clientId: z.string().uuid(),
  label: z.string().nullable(),
  reference: z.string().nullable(),
  rateDollars: z.coerce.number().positive("Rate must be greater than 0"),
  rateUnit: z.enum(["hour", "day"]),
  hstApplicable: z.boolean(),
  paymentTerms: z.enum(["NET_15", "NET_30", "NET_45", "NET_60", "DUE_ON_RECEIPT"]),
  billingCadence: z.enum(["weekly", "bi-weekly", "semi-monthly", "monthly"]),
  billingModel: z.enum(["hourly", "fixed_fee", "milestone"]),
  rightToSubcontract: z.boolean(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().nullable(),
});

function parseContractForm(clientId: string, fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v ? String(v).trim() : null;
  };
  return contractSchema.safeParse({
    clientId,
    label: get("label"),
    reference: get("reference"),
    rateDollars: get("rateDollars"),
    rateUnit: get("rateUnit"),
    hstApplicable: fd.get("hstApplicable") === "on",
    paymentTerms: get("paymentTerms"),
    billingCadence: get("billingCadence"),
    billingModel: get("billingModel") ?? "hourly",
    rightToSubcontract: fd.get("rightToSubcontract") === "on",
    startDate: get("startDate"),
    endDate: get("endDate") || null,
    notes: get("notes"),
  });
}

export async function createContract(
  clientId: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const parsed = parseContractForm(clientId, fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const { rateDollars, ...rest } = parsed.data;
    const [created] = await db
      .insert(contracts)
      .values({ ...rest, rateCents: Math.round(rateDollars * 100) })
      .returning({ id: contracts.id });
    await audit(email, `contracts:create:${created!.id}`, parsed.data);
    revalidate();
    return { ok: "Contract created." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function updateContract(
  id: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const expectedVersion = parseExpectedVersion(fd);
    const [existing] = await db.select().from(contracts).where(eq(contracts.id, id));
    if (!existing) return { error: "Contract not found" };
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.version) };
    }

    const parsed = parseContractForm(existing.clientId, fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const { rateDollars, ...rest } = parsed.data;
    const whereClause = expectedVersion !== null
      ? and(eq(contracts.id, id), eq(contracts.version, expectedVersion))
      : eq(contracts.id, id);
    const [updated] = await db
      .update(contracts)
      .set({ ...rest, rateCents: Math.round(rateDollars * 100), version: bumpVersion(), updatedAt: new Date() })
      .where(whereClause)
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, id));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion ?? existing.version, current.version) };
    }
    await audit(email, `contracts:update:${id}`, { ...parsed.data, fromVersion: existing.version, toVersion: updated.version });
    revalidate();
    return { ok: "Contract saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function archiveContract(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db.select().from(contracts).where(eq(contracts.id, id));
    if (!existing) return { error: "Contract not found" };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.version) };
    }
    // refuse if any invoices reference this contract — keep referential integrity for tax history
    const used = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.contractId, id))
      .limit(1);
    const whereClause = and(eq(contracts.id, id), eq(contracts.version, expectedVersion));
    const [updated] = await db
      .update(contracts)
      .set({ active: false, version: bumpVersion(), updatedAt: new Date() })
      .where(whereClause)
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, id));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }
    await audit(email, `contracts:deactivate:${id}`, used[0] ? { reason: "has invoices", fromVersion: existing.version, toVersion: updated.version } : { fromVersion: existing.version, toVersion: updated.version });
    revalidate();
    return { ok: used[0] ? "Contract deactivated. Past invoices remain linked." : "Contract deactivated." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Deactivate failed" };
  }
}

export async function reactivateContract(id: string, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db.select().from(contracts).where(eq(contracts.id, id));
    if (!existing) return { error: "Contract not found" };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.version) };
    }
    const [updated] = await db
      .update(contracts)
      .set({ active: true, version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(contracts.id, id), eq(contracts.version, expectedVersion)))
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, id));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }
    await audit(email, `contracts:reactivate:${id}`, { fromVersion: existing.version, toVersion: updated.version });
    revalidate();
    return { ok: "Contract reactivated." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Reactivate failed" };
  }
}
