"use server";

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put, del } from "@vercel/blob";
import { renderToBuffer } from "@react-pdf/renderer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/lib/db/client";
import {
  invoices,
  invoiceLines,
  contracts,
  clients,
  settings,
  documents,
  auditLog,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { addDaysISO, calculateHst, paymentTermsToDays } from "@/lib/utils";
import { InvoicePDF } from "@/lib/invoice-pdf";

type ActionResult = { ok?: string; error?: string; invoiceId?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

let _bannerDataUri: string | null = null;
async function getBannerDataUri(): Promise<string | undefined> {
  if (_bannerDataUri) return _bannerDataUri;
  // Prefer the trimmed, optimized banner; fall back to raw banner; then logo.
  for (const candidate of ["public/banner-pdf.png", "public/banner.png", "public/logo-full.png", "public/logo.png"]) {
    try {
      const buffer = await readFile(resolve(process.cwd(), candidate));
      _bannerDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
      return _bannerDataUri;
    } catch {
      continue;
    }
  }
  return undefined;
}

const createSchema = z.object({
  contractId: z.string().uuid("Pick a contract"),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Period start required"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Period end required"),
  quantity: z.coerce.number().positive("Hours/days must be greater than 0"),
  description: z.string().min(1, "Description required").max(500),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date required"),
  notes: z.string().max(2000).nullable(),
});

export async function createInvoice(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  let createdInvoiceId: string | null = null;
  try {
    const email = await requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = createSchema.safeParse({
      contractId: fd.get("contractId"),
      periodStart: fd.get("periodStart"),
      periodEnd: fd.get("periodEnd"),
      quantity: fd.get("quantity"),
      description: fd.get("description"),
      issueDate: fd.get("issueDate"),
      notes: (fd.get("notes") as string) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;
    if (data.periodEnd < data.periodStart) return { error: "Period end must be on or after period start." };

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, data.contractId));
    if (!contract) return { error: "Contract not found." };
    if (!contract.active) return { error: "Contract is inactive. Reactivate it before invoicing." };

    const [client] = await db.select().from(clients).where(eq(clients.id, contract.clientId));
    if (!client) return { error: "Client not found." };

    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings not seeded." };

    // Compute money. quantity is decimal (e.g., 80.5 hours). Store as basis × 100 in DB.
    const quantityBasis = Math.round(data.quantity * 100);
    const subtotalCents = Math.round(data.quantity * contract.rateCents);
    const hstCents = contract.hstApplicable ? calculateHst(subtotalCents, s.hstRateBps) : 0;
    const totalCents = subtotalCents + hstCents;

    // Sequence + invoice number
    const invoiceNumber = `${s.invoicePrefix}-${String(s.nextInvoiceSeq).padStart(4, "0")}`;
    const dueDate = addDaysISO(data.issueDate, paymentTermsToDays(contract.paymentTerms));

    // Insert invoice (status draft for now — PDF generation marks it issued)
    const [created] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        contractId: contract.id,
        issueDate: data.issueDate,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        dueDate,
        currency: "CAD",
        subtotalCents,
        hstCents,
        totalCents,
        status: "draft",
        notes: data.notes,
      })
      .returning({ id: invoices.id });
    createdInvoiceId = created!.id;

    // Insert line item
    await db.insert(invoiceLines).values({
      invoiceId: createdInvoiceId,
      description: data.description,
      quantity: quantityBasis,
      rateCents: contract.rateCents,
      amountCents: subtotalCents,
      sortOrder: 0,
    });

    // Bump sequence
    await db
      .update(settings)
      .set({ nextInvoiceSeq: s.nextInvoiceSeq + 1, updatedAt: new Date() })
      .where(eq(settings.id, 1));

    // Generate PDF
    const bannerDataUri = await getBannerDataUri();
    const pdfBuffer = await renderToBuffer(
      InvoicePDF({
        invoice: {
          invoiceNumber,
          issueDate: data.issueDate,
          dueDate,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          currency: "CAD",
          subtotalCents,
          hstCents,
          totalCents,
          notes: data.notes,
        },
        lines: [
          {
            description: data.description,
            quantity: quantityBasis,
            rateCents: contract.rateCents,
            rateUnit: contract.rateUnit,
            amountCents: subtotalCents,
          },
        ],
        settings: {
          corpLegalName: s.corpLegalName,
          hstAccount: s.hstAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          directorEmail: s.directorEmail,
          brandPrimaryHex: s.brandPrimaryHex,
          brandAccentHex: s.brandAccentHex,
          hstRateBps: s.hstRateBps,
        },
        client,
        contract: {
          paymentTerms: contract.paymentTerms,
          reference: contract.reference,
          label: contract.label,
        },
        bannerDataUri,
      }),
    );
    const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

    // Upload PDF to Vercel Blob
    const blob = await put(
      `invoices/${createdInvoiceId}/${invoiceNumber}.pdf`,
      pdfBuffer,
      { access: "public", contentType: "application/pdf", addRandomSuffix: true },
    );

    // Save vault entry + link the invoice
    const [vaultDoc] = await db
      .insert(documents)
      .values({
        name: `${invoiceNumber}.pdf`,
        category: "invoice",
        blobUrl: blob.url,
        sha256: pdfSha256,
        sizeBytes: pdfBuffer.length,
        contentType: "application/pdf",
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    await db
      .update(invoices)
      .set({ pdfBlobUrl: blob.url, pdfSha256, status: "draft" })
      .where(eq(invoices.id, createdInvoiceId));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `invoices:${createdInvoiceId}`,
      metadata: { invoiceNumber, totalCents, vaultDocumentId: vaultDoc?.id },
    });

    revalidatePath("/invoices");
    revalidatePath("/dashboard");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
  if (createdInvoiceId) redirect(`/invoices/${createdInvoiceId}`);
  return { error: "Unexpected: invoice not created" };
}

const statusSchema = z.enum(["draft", "sent", "paid", "overdue", "void"]);

export async function setInvoiceStatus(id: string, status: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = statusSchema.safeParse(status);
    if (!parsed.success) return { error: "Invalid status." };

    const patch: { status: typeof parsed.data; paidAt?: Date | null } = { status: parsed.data };
    if (parsed.data === "paid") patch.paidAt = new Date();
    if (parsed.data !== "paid") patch.paidAt = null;

    await db.update(invoices).set(patch).where(eq(invoices.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `invoices:${id}:status`,
      metadata: { status: parsed.data },
    });
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/dashboard");
    return { ok: `Marked as ${parsed.data}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Status update failed" };
  }
}

export async function deleteDraftInvoice(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!inv) return { error: "Invoice not found." };
    if (inv.status !== "draft") return { error: "Only draft invoices can be deleted." };

    // Free up the sequence number for reuse only if it was the most recent
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    const expectedSeq = s ? s.nextInvoiceSeq - 1 : null;
    const lastUsedSeq = parseInt(inv.invoiceNumber.split("-").pop() ?? "0", 10);
    if (s && expectedSeq === lastUsedSeq) {
      await db.update(settings).set({ nextInvoiceSeq: lastUsedSeq, updatedAt: new Date() }).where(eq(settings.id, 1));
    }

    // Delete the blob + the vault documents row that mirrored this invoice's PDF
    if (inv.pdfBlobUrl) {
      try {
        await del(inv.pdfBlobUrl);
      } catch {
        // best-effort; continue with DB cleanup even if blob is already gone
      }
      await db.delete(documents).where(eq(documents.blobUrl, inv.pdfBlobUrl));
    }

    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `invoices:${id}`,
      metadata: { invoiceNumber: inv.invoiceNumber, blobDeleted: !!inv.pdfBlobUrl },
    });
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { ok: "Draft invoice deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
