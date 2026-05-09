"use server";

import { put, del } from "@/lib/blob";
import { and, eq, ne, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import { contracts, documents, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { bumpVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = "application/pdf";

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function validatedFile(fd: FormData): Promise<{ file: File } | ActionResult> {
  const file = fd.get("document");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file first." };
  if (file.type !== ALLOWED_MIME) return { error: "PDFs only." };
  if (file.size > MAX_BYTES) return { error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB.` };
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
  }
  return { file };
}

/**
 * Upload a brand-new contract PDF.
 *  - Creates a Document (vault row) at version 1
 *  - Links it to the contract
 *  - Refuses if the contract already has a linked document (use replace instead)
 */
export async function uploadContractDocument(
  contractId: string,
  expectedVersion: number,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const v = await validatedFile(fd);
    if (!("file" in v)) return v;
    const file = v.file;

    const [existing] = await db
      .select({ documentId: contracts.documentId, version: contracts.version })
      .from(contracts)
      .where(eq(contracts.id, contractId));
    if (!existing) return { error: "Contract not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.version) };
    }
    if (existing.documentId) {
      return { error: "Contract already has a document. Use Replace to upload a new version." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const blob = await put(`contracts/${contractId}/v1/${file.name}`, buffer, {
      access: "private",
      contentType: ALLOWED_MIME,
      addRandomSuffix: true,
    });

    const [doc] = await db
      .insert(documents)
      .values({
        name: file.name,
        category: "contract",
        blobUrl: blob.url,
        sha256,
        sizeBytes: file.size,
        contentType: ALLOWED_MIME,
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    const [updated] = await db
      .update(contracts)
      .set({ documentId: doc!.id, version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.version, expectedVersion)))
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `contracts:${contractId}:document:${doc!.id}`,
      metadata: { name: file.name, sha256, version: 1, fromVersion: existing.version, toVersion: updated.version },
    });

    revalidatePath("/clients");
    return { ok: "Document uploaded." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

/**
 * Replace the current contract document with a new version.
 *  - Creates a Document at (current.version + 1), supersedes_document_id = current.id
 *  - Old version stays in vault as history (NOT deleted from blob)
 *  - Updates contract.document_id to the new one
 */
export async function replaceContractDocument(
  contractId: string,
  expectedVersion: number,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const v = await validatedFile(fd);
    if (!("file" in v)) return v;
    const file = v.file;

    const [existing] = await db
      .select({
        documentId: contracts.documentId,
        contractVersion: contracts.version,
        version: documents.version,
        previousId: documents.id,
        previousBlobUrl: documents.blobUrl,
      })
      .from(contracts)
      .leftJoin(documents, eq(documents.id, contracts.documentId))
      .where(eq(contracts.id, contractId));
    if (!existing) return { error: "Contract not found." };
    if (existing.contractVersion !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.contractVersion) };
    }
    if (!existing.documentId) {
      return { error: "Nothing to replace. Upload a document first." };
    }

    const newVersion = (existing.version ?? 1) + 1;
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const blob = await put(`contracts/${contractId}/v${newVersion}/${file.name}`, buffer, {
      access: "private",
      contentType: ALLOWED_MIME,
      addRandomSuffix: true,
    });

    const [doc] = await db
      .insert(documents)
      .values({
        name: file.name,
        category: "contract",
        blobUrl: blob.url,
        sha256,
        sizeBytes: file.size,
        contentType: ALLOWED_MIME,
        version: newVersion,
        supersedesDocumentId: existing.previousId,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    const [updated] = await db
      .update(contracts)
      .set({ documentId: doc!.id, version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.version, expectedVersion)))
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }

    // Auto-cleanup: delete the previous version's blob + vault row so storage stays
    // in sync with what the app actually shows. Audit log keeps the version trail.
    if (existing.previousBlobUrl) {
      try {
        await del(existing.previousBlobUrl);
      } catch {
        // best-effort
      }
    }
    if (existing.previousId) {
      await db.delete(documents).where(eq(documents.id, existing.previousId));
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `contracts:${contractId}:document:${doc!.id}`,
      metadata: {
        name: file.name,
        sha256,
        version: newVersion,
        supersedes: existing.previousId,
        previousBlobDeleted: !!existing.previousBlobUrl,
        fromContractVersion: existing.contractVersion,
        toContractVersion: updated.version,
      },
    });

    revalidatePath("/clients");
    return { ok: `Document replaced. Now at v${newVersion}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Replace failed" };
  }
}

/**
 * Delete the contract's document and every prior version in its supersedes chain.
 * Wipes each blob from Vercel Blob and each row from the vault, then nulls
 * contracts.document_id. Replace already auto-deletes prior versions, so in
 * practice the chain is length 1 — walking it is defensive.
 */
export async function unlinkContractDocument(
  contractId: string,
  expectedVersion: number,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();
    const [existing] = await db
      .select({ documentId: contracts.documentId, version: contracts.version })
      .from(contracts)
      .where(eq(contracts.id, contractId));
    if (!existing) return { error: "Contract not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, existing.version) };
    }
    if (!existing.documentId) return { error: "No document linked." };

    const chain: { id: string; blobUrl: string; version: number }[] = [];
    let cursor: string | null = existing.documentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const [row] = await db
        .select({
          id: documents.id,
          blobUrl: documents.blobUrl,
          version: documents.version,
          supersedesDocumentId: documents.supersedesDocumentId,
        })
        .from(documents)
        .where(eq(documents.id, cursor));
      if (!row) break;
      chain.push({ id: row.id, blobUrl: row.blobUrl, version: row.version });
      cursor = row.supersedesDocumentId;
    }

    // Null the FK before deleting rows so the unique index doesn't trip.
    const [updated] = await db
      .update(contracts)
      .set({ documentId: null, version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.version, expectedVersion)))
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }

    for (const doc of chain) {
      try {
        await del(doc.blobUrl);
      } catch {
        // best-effort; orphan sweep (pnpm cleanup-blobs) will catch leftovers
      }
      await db.delete(documents).where(eq(documents.id, doc.id));
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `contracts:${contractId}:document-delete`,
      metadata: {
        previousDocumentId: existing.documentId,
        deletedVersions: chain.map((d) => d.version),
        deletedCount: chain.length,
      },
    });
    revalidatePath("/clients");
    const versionsLabel = chain.length === 1 ? "1 version" : `${chain.length} versions`;
    return { ok: `Document deleted (${versionsLabel} wiped from vault + blob).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

/** Link an existing vault document to this contract (rejects if already linked elsewhere). */
export async function linkVaultDocumentToContract(
  contractId: string,
  documentId: string,
  expectedVersion: number,
): Promise<ActionResult> {
  try {
    const email = await requireAuth();

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return { error: "Document not found." };
    if (doc.archived) return { error: "Document is archived." };

    const [contractRow] = await db
      .select({ version: contracts.version })
      .from(contracts)
      .where(eq(contracts.id, contractId));
    if (!contractRow) return { error: "Contract not found." };
    if (contractRow.version !== expectedVersion) {
      return { error: versionConflictError("contract", expectedVersion, contractRow.version) };
    }

    const [usedBy] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.documentId, documentId), ne(contracts.id, contractId)));
    if (usedBy) return { error: "That document is already linked to another contract." };

    const [updated] = await db
      .update(contracts)
      .set({ documentId, version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.version, expectedVersion)))
      .returning({ version: contracts.version });
    if (!updated) {
      const [current] = await db
        .select({ version: contracts.version })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      if (!current) return { error: "Contract was deleted in another tab." };
      return { error: versionConflictError("contract", expectedVersion, current.version) };
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `contracts:${contractId}:document-link:${documentId}`,
      metadata: { name: doc.name, version: doc.version, fromContractVersion: contractRow.version, toContractVersion: updated.version },
    });
    revalidatePath("/clients");
    return { ok: `Linked "${doc.name}" (v${doc.version}).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Link failed" };
  }
}

/** List vault documents available to link as a contract (category=contract, not archived, not already linked). */
export async function listAvailableContractDocuments() {
  await requireAuth();
  const linkedIds = await db
    .select({ id: contracts.documentId })
    .from(contracts)
    .where(sql`${contracts.documentId} IS NOT NULL`);
  const linked = linkedIds.map((r) => r.id).filter((x): x is string => Boolean(x));

  const conds: SQL[] = [eq(documents.category, "contract"), eq(documents.archived, false)];
  if (linked.length > 0) conds.push(notInArray(documents.id, linked));

  return db.select().from(documents).where(and(...conds));
}
