import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "@/lib/db/client";
import { contracts, documents, auditLog } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/contracts/[id]/document
 *
 * Auth-gated PDF proxy:
 *  - Requires Auth.js session
 *  - Joins contract → document, fetches the blob URL (never exposed)
 *  - Streams the PDF back through this app
 *  - Logs every view
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;

  const [row] = await db
    .select({
      url: documents.blobUrl,
      name: documents.name,
      version: documents.version,
    })
    .from(contracts)
    .leftJoin(documents, eq(documents.id, contracts.documentId))
    .where(eq(contracts.id, id));

  if (!row?.url) return new NextResponse("Not found", { status: 404 });

  const upstream = await fetch(row.url);
  if (!upstream.ok) return new NextResponse("Upstream error", { status: 502 });

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `contracts:${id}:document`,
    metadata: { name: row.name, version: row.version },
  });

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.name ?? "contract.pdf"}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
