import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "@/lib/db/client";
import { documents, auditLog } from "@/lib/db/schema";
import { hasVaultPinSession } from "@/lib/vault-pin-session";

export const runtime = "nodejs";

/**
 * GET /api/documents/[id]
 * PIN-gated document proxy. Streams the blob so the underlying URL is never
 * exposed to the browser. Requires both Auth.js session AND a valid vault PIN
 * session cookie. Parent-specific routes (/api/invoices/[id]/pdf etc.) remain
 * session-only — they're the frictionless daily path for PDFs users already
 * have open in their parent page.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const unlocked = await hasVaultPinSession();
  if (!unlocked) return new NextResponse("Vault locked", { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  if (!row) return new NextResponse("Not found", { status: 404 });

  const upstream = await fetch(row.blobUrl);
  if (!upstream.ok) return new NextResponse("Upstream error", { status: 502 });

  const contentType = row.contentType || upstream.headers.get("content-type") || "application/octet-stream";
  const filename = row.name || `document-${id}`;

  // Inline render for PDF + images; everything else forced to attachment so
  // the browser prompts a save rather than trying to render unknown bytes.
  const renderableInline = contentType === "application/pdf" || contentType.startsWith("image/");
  const disposition = download || !renderableInline ? "attachment" : "inline";

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `documents:${id}`,
    metadata: { name: row.name, category: row.category, download, contentType },
  });

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
