/**
 * Resolves, for a list of vault `documents` rows, whether each one is still
 * bound to a live parent (contract, invoice, expense, paycheque). Runs 4
 * parallel queries and returns a Map by documentId.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contracts,
  clients,
  invoices,
  expenses,
  paycheques,
  type Document,
} from "@/lib/db/schema";

export type ParentLink = {
  kind: "contract" | "invoice" | "expense" | "paycheque";
  label: string;
  href: string;
  /** Preferred parent API route for the "download via parent" flow. */
  parentApiHref?: string;
};

export async function resolveParentLinks(
  docs: Pick<Document, "id" | "blobUrl" | "category">[],
): Promise<Map<string, ParentLink>> {
  const out = new Map<string, ParentLink>();
  if (docs.length === 0) return out;

  const contractDocIds = docs.filter((d) => d.category === "contract").map((d) => d.id);
  const invoiceUrls = docs.filter((d) => d.category === "invoice").map((d) => d.blobUrl);
  const paystubUrls = docs.filter((d) => d.category === "paystub").map((d) => d.blobUrl);
  const receiptUrls = docs.filter((d) => d.category === "receipt").map((d) => d.blobUrl);

  // Parallel — avoids 4× serial round-trips.
  const [contractRows, invoiceRows, paystubRows, receiptRows] = await Promise.all([
    contractDocIds.length === 0
      ? Promise.resolve([] as Array<{ documentId: string | null; contractId: string; clientName: string; label: string | null }>)
      : db
          .select({
            documentId: contracts.documentId,
            contractId: contracts.id,
            clientName: clients.legalName,
            label: contracts.label,
          })
          .from(contracts)
          .innerJoin(clients, eq(clients.id, contracts.clientId))
          .where(inArray(contracts.documentId, contractDocIds)),
    invoiceUrls.length === 0
      ? Promise.resolve([] as Array<{ id: string; invoiceNumber: string; blobUrl: string | null }>)
      : db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            blobUrl: invoices.pdfBlobUrl,
          })
          .from(invoices)
          .where(inArray(invoices.pdfBlobUrl, invoiceUrls)),
    paystubUrls.length === 0
      ? Promise.resolve([] as Array<{ id: string; payDate: string; blobUrl: string | null }>)
      : db
          .select({
            id: paycheques.id,
            payDate: paycheques.payDate,
            blobUrl: paycheques.pdfBlobUrl,
          })
          .from(paycheques)
          .where(inArray(paycheques.pdfBlobUrl, paystubUrls)),
    receiptUrls.length === 0
      ? Promise.resolve([] as Array<{ id: string; vendor: string; blobUrl: string | null }>)
      : db
          .select({
            id: expenses.id,
            vendor: expenses.vendor,
            blobUrl: expenses.receiptBlobUrl,
          })
          .from(expenses)
          .where(inArray(expenses.receiptBlobUrl, receiptUrls)),
  ]);

  for (const row of contractRows) {
    if (!row.documentId) continue;
    const label = row.label ? `${row.clientName} · ${row.label}` : row.clientName;
    out.set(row.documentId, {
      kind: "contract",
      label,
      href: `/clients`,
      parentApiHref: `/api/contracts/${row.contractId}/document`,
    });
  }

  const byBlobToDoc = new Map<string, string>();
  for (const d of docs) byBlobToDoc.set(d.blobUrl, d.id);

  for (const row of invoiceRows) {
    if (!row.blobUrl) continue;
    const docId = byBlobToDoc.get(row.blobUrl);
    if (!docId) continue;
    out.set(docId, {
      kind: "invoice",
      label: row.invoiceNumber,
      href: `/invoices/${row.id}`,
      parentApiHref: `/api/invoices/${row.id}/pdf`,
    });
  }

  for (const row of paystubRows) {
    if (!row.blobUrl) continue;
    const docId = byBlobToDoc.get(row.blobUrl);
    if (!docId) continue;
    out.set(docId, {
      kind: "paycheque",
      label: `Paystub ${row.payDate}`,
      href: `/paycheques/${row.id}`,
      parentApiHref: `/api/paycheques/${row.id}/pdf`,
    });
  }

  for (const row of receiptRows) {
    if (!row.blobUrl) continue;
    const docId = byBlobToDoc.get(row.blobUrl);
    if (!docId) continue;
    out.set(docId, {
      kind: "expense",
      label: `Receipt · ${row.vendor}`,
      href: `/expenses`,
      parentApiHref: `/api/expenses/${row.id}/receipt`,
    });
  }

  return out;
}
