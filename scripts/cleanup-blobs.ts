/**
 * Vercel Blob janitor.
 *
 * Lists every blob in the store, cross-references with the documents table,
 * and deletes anything not actively referenced. Safe to run any time — what
 * the app shows is the source of truth.
 *
 * Usage:
 *   pnpm cleanup-blobs            # dry-run by default, prints orphans
 *   pnpm cleanup-blobs --apply    # actually delete the orphans
 */
import { list, del } from "@vercel/blob";
import { db } from "../src/lib/db/client";
import { documents, contracts, invoices } from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("✘ BLOB_READ_WRITE_TOKEN not set in .env.local");
  process.exit(1);
}

async function main() {
  console.log(APPLY ? "→ DELETE mode" : "→ DRY RUN (use --apply to delete)");

  // 1. Pull every blob from Vercel
  console.log("→ Listing blobs in Vercel Blob storage…");
  const allBlobs: { url: string; pathname: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ cursor, limit: 1000 });
    for (const b of result.blobs) {
      allBlobs.push({ url: b.url, pathname: b.pathname, size: b.size });
    }
    cursor = result.cursor;
  } while (cursor);
  console.log(`  ${allBlobs.length} blob(s) in storage`);

  // 2. Pull every URL referenced from the DB (documents + invoices safety net)
  console.log("→ Indexing referenced URLs from DB…");
  const docRows = await db.select({ blobUrl: documents.blobUrl }).from(documents);
  const contractDocIds = await db.select({ id: contracts.documentId }).from(contracts);
  const invoiceUrls = await db.select({ url: invoices.pdfBlobUrl }).from(invoices);

  const referenced = new Set<string>();
  for (const r of docRows) referenced.add(r.blobUrl);
  for (const r of invoiceUrls) if (r.url) referenced.add(r.url);
  // contractDocIds are kept just to surface broken links during diagnostics
  const linkedDocIds = new Set(contractDocIds.map((r) => r.id).filter(Boolean));
  console.log(
    `  ${referenced.size} referenced URL(s), ${linkedDocIds.size} contract->document link(s)`,
  );

  // 3. Find orphans
  const orphans = allBlobs.filter((b) => !referenced.has(b.url));
  if (orphans.length === 0) {
    console.log("\n✅ Storage is already clean. Nothing to delete.");
    return;
  }

  let total = 0;
  console.log(`\n→ ${orphans.length} orphan blob(s):`);
  for (const o of orphans) {
    total += o.size;
    console.log(`  ⊘ ${o.pathname.padEnd(60)} ${(o.size / 1024).toFixed(1)} KB`);
  }
  console.log(`  Total: ${(total / 1024 / 1024).toFixed(2)} MB`);

  if (!APPLY) {
    console.log("\n  Re-run with --apply to delete.");
    return;
  }

  console.log("\n→ Deleting…");
  for (const o of orphans) {
    try {
      await del(o.url);
      console.log(`  ✔ ${o.pathname}`);
    } catch (e) {
      console.error(`  ✘ ${o.pathname}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("\n✅ Cleanup complete.");
}

main().catch((e) => {
  console.error("✘ Cleanup failed:", e);
  process.exit(1);
});
