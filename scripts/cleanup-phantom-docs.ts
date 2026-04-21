/**
 * Deletes rows from `documents` whose blobUrl is unreachable (404 on HEAD).
 *
 * These rows are historical leftovers from before auto-cascade-delete was
 * added to contract-document replace (pre-Phase 1 polish). They show up in
 * /vault but opening them 404s because the underlying Vercel Blob is gone.
 *
 * The counterpart is `pnpm cleanup-blobs` which goes the opposite direction
 * (blob-store → DB, deletes orphaned blobs). Run both if you want full sync.
 *
 *   Dry run:       pnpm cleanup-phantom-docs
 *   Actually run:  pnpm cleanup-phantom-docs --apply
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { documents, contracts, invoices, paycheques, expenses, auditLog } from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");
const ALLOWED_EMAIL =
  (process.env.ALLOWED_LOGIN_EMAILS ?? process.env.ALLOWED_LOGIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)[0] ?? "cli:cleanup-phantom-docs";

async function headBlob(url: string, timeoutMs = 8_000): Promise<{ ok: boolean; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log(APPLY ? "=== Phantom-docs cleanup (APPLY) ===" : "=== Phantom-docs cleanup (dry run) ===\n");

  const rows = await db.select().from(documents);
  console.log(`Scanning ${rows.length} documents rows…\n`);

  const phantoms: typeof rows = [];
  for (const row of rows) {
    const r = await headBlob(row.blobUrl);
    if (!r.ok) {
      phantoms.push(row);
      console.log(
        `  ✗ HTTP ${r.status.toString().padStart(3, " ")} · ${row.category.padEnd(14)} · v${row.version} · ${row.name}`,
      );
    }
  }

  console.log(`\n${phantoms.length} phantom row(s) found out of ${rows.length} scanned.`);

  if (phantoms.length === 0) {
    console.log("Nothing to clean up. ✓");
    return;
  }

  // Safety pass — check which phantoms are still pointed at by parents.
  // Contracts reference documentId directly; invoices/paycheques/expenses
  // only reference the blob URL (no FK), so they'll self-heal after delete.
  const phantomIds = phantoms.map((p) => p.id);
  const phantomUrls = phantoms.map((p) => p.blobUrl);

  const linkedContracts = await db
    .select({ id: contracts.id, documentId: contracts.documentId })
    .from(contracts)
    .where(inArray(contracts.documentId, phantomIds));
  const linkedInvoices = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, blobUrl: invoices.pdfBlobUrl })
    .from(invoices)
    .where(inArray(invoices.pdfBlobUrl, phantomUrls));
  const linkedPaycheques = await db
    .select({ id: paycheques.id, payDate: paycheques.payDate, blobUrl: paycheques.pdfBlobUrl })
    .from(paycheques)
    .where(inArray(paycheques.pdfBlobUrl, phantomUrls));
  const linkedExpenses = await db
    .select({ id: expenses.id, vendor: expenses.vendor, blobUrl: expenses.receiptBlobUrl })
    .from(expenses)
    .where(inArray(expenses.receiptBlobUrl, phantomUrls));

  if (
    linkedContracts.length > 0 ||
    linkedInvoices.length > 0 ||
    linkedPaycheques.length > 0 ||
    linkedExpenses.length > 0
  ) {
    console.log("\nParent references still pointing at phantom rows:");
    for (const c of linkedContracts) console.log(`  · contract ${c.id} → documents.id ${c.documentId} (will null contract FK)`);
    for (const i of linkedInvoices) console.log(`  · invoice ${i.invoiceNumber} → pdfBlobUrl (will null)`);
    for (const p of linkedPaycheques) console.log(`  · paycheque ${p.payDate} → pdfBlobUrl (will null)`);
    for (const e of linkedExpenses) console.log(`  · expense ${e.vendor} → receiptBlobUrl (will null)`);
  } else {
    console.log("\nNo parent rows reference these phantoms — safe to delete without touching parents.");
  }

  if (!APPLY) {
    console.log("\nRun with --apply to delete these rows + null parent references.");
    return;
  }

  console.log("\nApplying…");

  // 1) Null the parent FKs first — can't leave a contract pointing at a row we're deleting.
  for (const c of linkedContracts) {
    await db.update(contracts).set({ documentId: null }).where(eq(contracts.id, c.id));
  }
  for (const i of linkedInvoices) {
    await db
      .update(invoices)
      .set({ pdfBlobUrl: null, pdfSha256: null })
      .where(eq(invoices.id, i.id));
  }
  for (const p of linkedPaycheques) {
    await db
      .update(paycheques)
      .set({ pdfBlobUrl: null, pdfSha256: null })
      .where(eq(paycheques.id, p.id));
  }
  for (const e of linkedExpenses) {
    await db
      .update(expenses)
      .set({ receiptBlobUrl: null, receiptSha256: null })
      .where(eq(expenses.id, e.id));
  }

  // 2) Now safe to delete the phantom rows.
  for (const phantom of phantoms) {
    await db.delete(documents).where(eq(documents.id, phantom.id));
  }

  await db.insert(auditLog).values({
    actorEmail: ALLOWED_EMAIL,
    action: "delete",
    target: "documents:phantom-cleanup",
    metadata: {
      count: phantoms.length,
      ids: phantoms.map((p) => p.id),
      nulled: {
        contracts: linkedContracts.map((c) => c.id),
        invoices: linkedInvoices.map((i) => i.invoiceNumber),
        paycheques: linkedPaycheques.map((p) => p.id),
        expenses: linkedExpenses.map((e) => e.id),
      },
      source: "cleanup-phantom-docs script",
    },
  });

  console.log(
    `✔ Removed ${phantoms.length} phantom row(s); nulled FKs on ${linkedContracts.length} contract(s), ${linkedInvoices.length} invoice(s), ${linkedPaycheques.length} paycheque(s), ${linkedExpenses.length} expense(s).`,
  );
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
