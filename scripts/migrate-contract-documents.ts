/**
 * One-shot migration: drop old contract.document_* fields, add document_id FK,
 * add versioning columns to documents.
 *
 * Safe to run only when no contract has yet uploaded a document (which is our
 * current state — Vercel Blob isn't configured yet).
 *
 * Run: pnpm tsx --env-file=.env.local scripts/migrate-contract-documents.ts
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log("→ Dropping old contracts.document_* columns…");
  await sql`ALTER TABLE contracts DROP COLUMN IF EXISTS document_blob_url`;
  await sql`ALTER TABLE contracts DROP COLUMN IF EXISTS document_name`;
  await sql`ALTER TABLE contracts DROP COLUMN IF EXISTS document_sha256`;
  await sql`ALTER TABLE contracts DROP COLUMN IF EXISTS document_size_bytes`;
  await sql`ALTER TABLE contracts DROP COLUMN IF EXISTS document_uploaded_at`;
  console.log("  ✔ dropped");

  console.log("→ Adding contracts.document_id (FK to documents)…");
  await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_id UUID`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contracts_document_id_documents_id_fk'
      ) THEN
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_document_id_documents_id_fk
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
      END IF;
    END $$
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS contracts_document_id_unique
      ON contracts(document_id) WHERE document_id IS NOT NULL
  `;
  console.log("  ✔ added");

  console.log("→ Adding versioning columns to documents…");
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS supersedes_document_id UUID`;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by TEXT`;
  console.log("  ✔ added");

  console.log("\n✅ Migration complete.");
}

run().catch((err) => {
  console.error("✘ Migration failed:", err);
  process.exit(1);
});
