import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "@/lib/db/client";
import { expenses, documents, auditLog } from "@/lib/db/schema";
import { streamBlob } from "@/lib/blob";

export const runtime = "nodejs";

/**
 * GET /api/expenses/[id]/receipt
 * Auth-gated receipt proxy. Streams the receipt from Vercel Blob so the blob
 * URL is never exposed to the browser. Supports PDF + JPEG/PNG/WebP/HEIC; the
 * content-type comes from the documents vault row we wrote at upload time.
 * GET is required so browsers can render the receipt inline; the audit_log
 * insert is the route's purpose, not a CSRF surface (session-gated, SameSite=Lax).
 */
// oxlint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const [row] = await db
    .select({
      blobUrl: expenses.receiptBlobUrl,
      vendor: expenses.vendor,
      contentType: documents.contentType,
      name: documents.name,
    })
    .from(expenses)
    .leftJoin(documents, eq(documents.blobUrl, expenses.receiptBlobUrl))
    .where(eq(expenses.id, id));

  if (!row?.blobUrl) return new NextResponse("Not found", { status: 404 });

  const upstream = await streamBlob(row.blobUrl);
  if (!upstream) return new NextResponse("Upstream error", { status: 502 });

  const contentType = row.contentType ?? upstream.contentType;
  const filename = row.name ?? `receipt-${id}`;

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `expenses:${id}:receipt`,
    metadata: { vendor: row.vendor, download, contentType },
  });

  return new NextResponse(upstream.stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
