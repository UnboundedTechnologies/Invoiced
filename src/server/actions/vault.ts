"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { put, del } from "@/lib/blob";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  documents,
  contracts,
  invoices,
  expenses,
  paycheques,
  auditLog,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { USER_UPLOADABLE, type VaultCategory } from "@/lib/vault-categories";
import { requireVaultPinSession } from "@/lib/vault-pin-session";

type ActionResult = { ok?: string; error?: string; documentId?: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate() {
  revalidatePath("/vault");
  revalidatePath("/(app)", "layout");
}

const uploadSchema = z.object({
  category: z.enum(USER_UPLOADABLE as readonly [VaultCategory, ...VaultCategory[]]),
  name: z.string().trim().max(200).nullable().optional(),
});

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 160) || "document";
}

export async function uploadMiscDocument(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  let uploadedBlobUrl: string | null = null;
  try {
    const email = await requireSession();
    await requireVaultPinSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = uploadSchema.safeParse({
      category: fd.get("category"),
      name: fd.get("name") ? String(fd.get("name")).trim() || null : null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const entry = fd.get("file");
    if (!(entry instanceof File) || entry.size === 0 || !entry.name) {
      return { error: "Pick a file first." };
    }
    if (!ALLOWED_MIMES.has(entry.type)) {
      return { error: "File must be PDF, JPEG, PNG, WebP, or HEIC." };
    }
    if (entry.size > MAX_BYTES) {
      return { error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB.` };
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const filename = sanitizeFilename(entry.name);

    const blob = await put(
      `vault/${parsed.data.category}/${Date.now()}-${filename}`,
      buffer,
      { access: "private", contentType: entry.type, addRandomSuffix: true },
    );
    uploadedBlobUrl = blob.url;

    const displayName = parsed.data.name?.trim() || entry.name;
    const [row] = await db
      .insert(documents)
      .values({
        name: displayName,
        category: parsed.data.category,
        blobUrl: blob.url,
        sha256,
        sizeBytes: entry.size,
        contentType: entry.type,
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `documents:${row!.id}`,
      metadata: { name: displayName, category: parsed.data.category, sha256, source: "vault-upload" },
    });

    revalidate();
    return { ok: "Uploaded to vault.", documentId: row!.id };
  } catch (e) {
    if (uploadedBlobUrl) {
      try {
        await del(uploadedBlobUrl);
      } catch {
        // best-effort; pnpm cleanup-blobs will sweep
      }
    }
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

/**
 * Returns the still-bound parent reference if `docId` is currently linked,
 * or null when free. TOCTOU guard for delete + archive: re-checked in every
 * mutating action after the page rendered the row.
 */
async function resolveLiveParentLink(docId: string, blobUrl: string): Promise<string | null> {
  const [contractBind] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.documentId, docId))
    .limit(1);
  if (contractBind) return `contracts:${contractBind.id}`;

  const invoiceBind = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.pdfBlobUrl, blobUrl))
    .limit(1);
  if (invoiceBind[0]) return `invoices:${invoiceBind[0].id}`;

  const paystubBind = await db
    .select({ id: paycheques.id })
    .from(paycheques)
    .where(eq(paycheques.pdfBlobUrl, blobUrl))
    .limit(1);
  if (paystubBind[0]) return `paycheques:${paystubBind[0].id}`;

  const receiptBind = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.receiptBlobUrl, blobUrl))
    .limit(1);
  if (receiptBind[0]) return `expenses:${receiptBind[0].id}`;

  return null;
}

export async function deleteMiscDocument(documentId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await requireVaultPinSession();

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return { error: "Document not found." };

    const parent = await resolveLiveParentLink(doc.id, doc.blobUrl);
    if (parent) {
      return { error: `This document is still linked to ${parent}. Delete it from there.` };
    }

    try {
      await del(doc.blobUrl);
    } catch {
      // best-effort
    }
    await db.delete(documents).where(eq(documents.id, documentId));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `documents:${documentId}`,
      metadata: {
        name: doc.name,
        category: doc.category,
        sizeBytes: doc.sizeBytes,
        source: "vault-delete",
      },
    });

    revalidate();
    return { ok: "Deleted from vault." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function archiveDocument(documentId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await requireVaultPinSession();

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return { error: "Document not found." };

    const parent = await resolveLiveParentLink(doc.id, doc.blobUrl);
    if (parent) {
      return { error: `Document is still linked to ${parent}. Archive would confuse the parent flow.` };
    }
    if (doc.archived) return { error: "Already archived." };

    await db.update(documents).set({ archived: true }).where(eq(documents.id, documentId));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `documents:${documentId}:archive`,
      metadata: { name: doc.name },
    });

    revalidate();
    return { ok: "Archived." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Archive failed" };
  }
}

export async function unarchiveDocument(documentId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await requireVaultPinSession();

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return { error: "Document not found." };
    if (!doc.archived) return { error: "Not archived." };

    await db.update(documents).set({ archived: false }).where(eq(documents.id, documentId));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `documents:${documentId}:unarchive`,
      metadata: { name: doc.name },
    });

    revalidate();
    return { ok: "Restored." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Restore failed" };
  }
}
