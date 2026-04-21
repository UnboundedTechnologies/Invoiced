"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import { expenses, documents, settings, auditLog } from "@/lib/db/schema";
import { auth } from "../../../auth";
import { fiscalYearFor } from "@/lib/utils";
import { hstPeriodLockError } from "./hst";
import { t2PeriodLockError } from "./t2";

/** Checks BOTH HST and T2 filing locks for a given ISO date. Returns the
 * first non-null error, or null if the period is fully open. Keeps the
 * per-call site a single line while preserving specific error messages. */
async function periodLockError(iso: string): Promise<string | null> {
  const hst = await hstPeriodLockError(iso);
  if (hst) return hst;
  return t2PeriodLockError(iso);
}

type ActionResult = { ok?: string; error?: string; expenseId?: string };

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
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/hst");
  revalidatePath("/vault");
  revalidatePath("/(app)", "layout");
}

async function getFye() {
  const [s] = await db
    .select({ m: settings.fiscalYearEndMonth, d: settings.fiscalYearEndDay })
    .from(settings)
    .where(eq(settings.id, 1));
  return { fyeMonth: s?.m ?? 12, fyeDay: s?.d ?? 31 };
}

const CATEGORY_VALUES = [
  "office_supplies",
  "software_subscriptions",
  "professional_fees",
  "telecom",
  "internet",
  "insurance",
  "bank_fees",
  "meals_entertainment",
  "travel",
  "vehicle",
  "home_office",
  "training",
  "advertising",
  "capital_asset",
  "other",
] as const;

const CCA_CLASSES = ["8", "10", "10.1", "12", "50", "other"] as const;

const ccaSchema = z.object({
  ccaClass: z.enum(CCA_CLASSES),
  classRate: z.coerce.number().min(0).max(100),
  acquisitionCostCents: z.coerce.number().int().nonnegative(),
  businessUsePercent: z.coerce.number().int().min(1).max(100),
  halfYearRuleApplies: z.boolean(),
  description: z.string().max(500).nullable(),
});

const baseSchema = z
  .object({
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date required"),
    vendor: z.string().trim().min(1, "Vendor required").max(200),
    description: z.string().trim().max(1000).nullable(),
    category: z.enum(CATEGORY_VALUES),
    subtotalDollars: z.coerce.number().nonnegative("Subtotal must be ≥ 0"),
    hstPaidDollars: z.coerce.number().nonnegative("HST paid must be ≥ 0"),
    totalDollars: z.coerce.number().nonnegative("Total must be ≥ 0"),
    paymentMethod: z.string().trim().max(100).nullable(),
    cca: z.union([ccaSchema, z.null()]),
  })
  .refine((d) => (d.category === "capital_asset" ? d.cca !== null : d.cca === null), {
    message: "Capital asset requires CCA details; other categories must not include them",
    path: ["cca"],
  });

function parseForm(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v ? String(v).trim() : "";
  };
  const category = get("category");
  const cca =
    category === "capital_asset"
      ? {
          ccaClass: get("cca_class"),
          classRate: get("cca_classRate"),
          acquisitionCostCents: Math.round(Number(get("cca_acquisitionCostDollars") || 0) * 100),
          businessUsePercent: get("cca_businessUsePercent") || "100",
          halfYearRuleApplies: fd.get("cca_halfYearRuleApplies") === "on",
          description: get("cca_description") || null,
        }
      : null;
  return baseSchema.safeParse({
    expenseDate: get("expenseDate"),
    vendor: get("vendor"),
    description: get("description") || null,
    category,
    subtotalDollars: get("subtotalDollars"),
    hstPaidDollars: get("hstPaidDollars"),
    totalDollars: get("totalDollars"),
    paymentMethod: get("paymentMethod") || null,
    cca,
  });
}

type FileCheck =
  | { kind: "none" }
  | { kind: "file"; file: File; buffer: Buffer; sha256: string }
  | { kind: "error"; error: string };

/**
 * Validate an optional receipt upload on FormData. kind='none' means no file
 * attached (valid — expenses don't require a receipt). kind='file' carries
 * the validated buffer + sha. kind='error' carries a user-facing message.
 */
async function validatedReceiptFile(fd: FormData, fieldName = "receipt"): Promise<FileCheck> {
  const entry = fd.get(fieldName);
  if (!(entry instanceof File) || entry.size === 0 || !entry.name) return { kind: "none" };
  if (!ALLOWED_MIMES.has(entry.type)) {
    return { kind: "error", error: "Receipt must be PDF, JPEG, PNG, WebP, or HEIC." };
  }
  if (entry.size > MAX_BYTES) {
    return { kind: "error", error: `Receipt too large. Max ${MAX_BYTES / 1024 / 1024} MB.` };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      kind: "error",
      error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local.",
    };
  }
  const buffer = Buffer.from(await entry.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { kind: "file", file: entry, buffer, sha256 };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "receipt";
}

function ccaJson(
  c: z.infer<typeof ccaSchema> | null,
): Record<string, unknown> | null {
  if (!c) return null;
  return {
    class: c.ccaClass,
    classRate: c.classRate,
    acquisitionCostCents: c.acquisitionCostCents,
    businessUsePercent: c.businessUsePercent,
    halfYearRuleApplies: c.halfYearRuleApplies,
    description: c.description,
  };
}

export async function createExpense(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  let uploadedBlobUrl: string | null = null;
  try {
    const email = await requireSession();
    const parsed = parseForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;

    const lockErr = await periodLockError(data.expenseDate);
    if (lockErr) return { error: lockErr };

    const fileCheck = await validatedReceiptFile(fd);
    if (fileCheck.kind === "error") return { error: fileCheck.error };

    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(data.expenseDate, fyeMonth, fyeDay);

    const subtotalCents = Math.round(data.subtotalDollars * 100);
    const hstPaidCents = Math.round(data.hstPaidDollars * 100);
    const totalCents = Math.round(data.totalDollars * 100);

    const expenseId = crypto.randomUUID();
    const auditMetadataBase = {
      vendor: data.vendor,
      category: data.category,
      subtotalCents,
      hstPaidCents,
      totalCents,
      fiscalYear,
    };

    if (fileCheck.kind === "file") {
      const file = fileCheck.file;
      const blob = await put(
        `expenses/${expenseId}/${Date.now()}-${sanitizeFilename(file.name)}`,
        fileCheck.buffer,
        { access: "public", contentType: file.type, addRandomSuffix: true },
      );
      uploadedBlobUrl = blob.url;
      const documentId = crypto.randomUUID();

      await db.batch([
        db.insert(expenses).values({
          id: expenseId,
          expenseDate: data.expenseDate,
          vendor: data.vendor,
          description: data.description,
          category: data.category,
          subtotalCents,
          hstPaidCents,
          totalCents,
          paymentMethod: data.paymentMethod,
          receiptBlobUrl: blob.url,
          receiptSha256: fileCheck.sha256,
          cca: ccaJson(data.cca),
          fiscalYear,
        }),
        db.insert(documents).values({
          id: documentId,
          name: file.name,
          category: "receipt",
          blobUrl: blob.url,
          sha256: fileCheck.sha256,
          sizeBytes: file.size,
          contentType: file.type,
          version: 1,
          uploadedBy: email,
        }),
        db.insert(auditLog).values({
          actorEmail: email,
          action: "create",
          target: `expenses:${expenseId}`,
          metadata: { ...auditMetadataBase, receiptAttached: true, vaultDocumentId: documentId },
        }),
      ]);
    } else {
      await db.batch([
        db.insert(expenses).values({
          id: expenseId,
          expenseDate: data.expenseDate,
          vendor: data.vendor,
          description: data.description,
          category: data.category,
          subtotalCents,
          hstPaidCents,
          totalCents,
          paymentMethod: data.paymentMethod,
          receiptBlobUrl: null,
          receiptSha256: null,
          cca: ccaJson(data.cca),
          fiscalYear,
        }),
        db.insert(auditLog).values({
          actorEmail: email,
          action: "create",
          target: `expenses:${expenseId}`,
          metadata: { ...auditMetadataBase, receiptAttached: false },
        }),
      ]);
    }

    revalidate();
    return { ok: "Expense recorded.", expenseId };
  } catch (e) {
    if (uploadedBlobUrl) {
      try {
        await del(uploadedBlobUrl);
      } catch {
        // best-effort; orphan sweep (pnpm cleanup-blobs) will catch leftovers
      }
    }
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function updateExpense(
  id: string,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!existing) return { error: "Expense not found." };

    const parsed = parseForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;

    // Block edits in a filed period AND block moving a row into a filed period.
    const oldLockErr = await periodLockError(existing.expenseDate);
    if (oldLockErr) return { error: oldLockErr };
    if (data.expenseDate !== existing.expenseDate) {
      const newLockErr = await periodLockError(data.expenseDate);
      if (newLockErr) return { error: newLockErr };
    }

    const { fyeMonth, fyeDay } = await getFye();
    const fiscalYear = fiscalYearFor(data.expenseDate, fyeMonth, fyeDay);
    const subtotalCents = Math.round(data.subtotalDollars * 100);
    const hstPaidCents = Math.round(data.hstPaidDollars * 100);
    const totalCents = Math.round(data.totalDollars * 100);

    await db.batch([
      db
        .update(expenses)
        .set({
          expenseDate: data.expenseDate,
          vendor: data.vendor,
          description: data.description,
          category: data.category,
          subtotalCents,
          hstPaidCents,
          totalCents,
          paymentMethod: data.paymentMethod,
          cca: ccaJson(data.cca),
          fiscalYear,
        })
        .where(eq(expenses.id, id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `expenses:${id}`,
        metadata: {
          vendor: data.vendor,
          category: data.category,
          subtotalCents,
          hstPaidCents,
          totalCents,
          fiscalYear,
        },
      }),
    ]);

    revalidate();
    return { ok: "Expense saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!existing) return { error: "Expense not found." };

    const lockErr = await periodLockError(existing.expenseDate);
    if (lockErr) return { error: lockErr };

    const auditEntry = db.insert(auditLog).values({
      actorEmail: email,
      action: "delete" as const,
      target: `expenses:${id}`,
      metadata: {
        vendor: existing.vendor,
        category: existing.category,
        subtotalCents: existing.subtotalCents,
        hstPaidCents: existing.hstPaidCents,
        totalCents: existing.totalCents,
        fiscalYear: existing.fiscalYear,
        receiptDeleted: !!existing.receiptBlobUrl,
      },
    });

    if (existing.receiptBlobUrl) {
      await db.batch([
        db.delete(documents).where(eq(documents.blobUrl, existing.receiptBlobUrl)),
        db.delete(expenses).where(eq(expenses.id, id)),
        auditEntry,
      ]);
      try {
        await del(existing.receiptBlobUrl);
      } catch {
        // best-effort
      }
    } else {
      await db.batch([db.delete(expenses).where(eq(expenses.id, id)), auditEntry]);
    }

    revalidate();
    return { ok: "Expense deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function uploadReceipt(expenseId: string, fd: FormData): Promise<ActionResult> {
  let uploadedBlobUrl: string | null = null;
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!existing) return { error: "Expense not found." };
    if (existing.receiptBlobUrl) {
      return { error: "A receipt is already attached. Use Replace to upload a new file." };
    }
    const lockErr = await periodLockError(existing.expenseDate);
    if (lockErr) return { error: lockErr };

    const fileCheck = await validatedReceiptFile(fd);
    if (fileCheck.kind === "error") return { error: fileCheck.error };
    if (fileCheck.kind === "none") return { error: "Pick a file first." };

    const file = fileCheck.file;
    const blob = await put(
      `expenses/${expenseId}/${Date.now()}-${sanitizeFilename(file.name)}`,
      fileCheck.buffer,
      { access: "public", contentType: file.type, addRandomSuffix: true },
    );
    uploadedBlobUrl = blob.url;

    const documentId = crypto.randomUUID();

    await db.batch([
      db
        .update(expenses)
        .set({ receiptBlobUrl: blob.url, receiptSha256: fileCheck.sha256 })
        .where(eq(expenses.id, expenseId)),
      db.insert(documents).values({
        id: documentId,
        name: file.name,
        category: "receipt",
        blobUrl: blob.url,
        sha256: fileCheck.sha256,
        sizeBytes: file.size,
        contentType: file.type,
        version: 1,
        uploadedBy: email,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `expenses:${expenseId}:attachReceipt`,
        metadata: { name: file.name, sha256: fileCheck.sha256, vaultDocumentId: documentId },
      }),
    ]);

    revalidate();
    return { ok: "Receipt attached." };
  } catch (e) {
    if (uploadedBlobUrl) {
      try {
        await del(uploadedBlobUrl);
      } catch {
        // best-effort
      }
    }
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

export async function replaceReceipt(expenseId: string, fd: FormData): Promise<ActionResult> {
  let newBlobUrl: string | null = null;
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!existing) return { error: "Expense not found." };
    if (!existing.receiptBlobUrl) {
      return { error: "Nothing to replace. Attach a receipt first." };
    }
    const lockErr = await periodLockError(existing.expenseDate);
    if (lockErr) return { error: lockErr };

    const fileCheck = await validatedReceiptFile(fd);
    if (fileCheck.kind === "error") return { error: fileCheck.error };
    if (fileCheck.kind === "none") return { error: "Pick a file first." };

    const oldBlobUrl = existing.receiptBlobUrl;
    const file = fileCheck.file;
    const blob = await put(
      `expenses/${expenseId}/${Date.now()}-${sanitizeFilename(file.name)}`,
      fileCheck.buffer,
      { access: "public", contentType: file.type, addRandomSuffix: true },
    );
    newBlobUrl = blob.url;

    const documentId = crypto.randomUUID();

    await db.batch([
      db
        .update(expenses)
        .set({ receiptBlobUrl: blob.url, receiptSha256: fileCheck.sha256 })
        .where(eq(expenses.id, expenseId)),
      db.delete(documents).where(eq(documents.blobUrl, oldBlobUrl)),
      db.insert(documents).values({
        id: documentId,
        name: file.name,
        category: "receipt",
        blobUrl: blob.url,
        sha256: fileCheck.sha256,
        sizeBytes: file.size,
        contentType: file.type,
        version: 1,
        uploadedBy: email,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `expenses:${expenseId}:replaceReceipt`,
        metadata: {
          name: file.name,
          sha256: fileCheck.sha256,
          vaultDocumentId: documentId,
          previousBlobUrl: oldBlobUrl,
        },
      }),
    ]);

    try {
      await del(oldBlobUrl);
    } catch {
      // best-effort
    }

    revalidate();
    return { ok: "Receipt replaced." };
  } catch (e) {
    if (newBlobUrl) {
      try {
        await del(newBlobUrl);
      } catch {
        // best-effort
      }
    }
    return { error: e instanceof Error ? e.message : "Replace failed" };
  }
}

export async function deleteReceipt(expenseId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!existing) return { error: "Expense not found." };
    if (!existing.receiptBlobUrl) return { error: "No receipt to remove." };
    const lockErr = await periodLockError(existing.expenseDate);
    if (lockErr) return { error: lockErr };

    const oldBlobUrl = existing.receiptBlobUrl;

    await db.batch([
      db
        .update(expenses)
        .set({ receiptBlobUrl: null, receiptSha256: null })
        .where(eq(expenses.id, expenseId)),
      db.delete(documents).where(eq(documents.blobUrl, oldBlobUrl)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `expenses:${expenseId}:deleteReceipt`,
        metadata: { previousBlobUrl: oldBlobUrl },
      }),
    ]);

    try {
      await del(oldBlobUrl);
    } catch {
      // best-effort
    }

    revalidate();
    return { ok: "Receipt removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
