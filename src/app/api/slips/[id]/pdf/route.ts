import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "@/lib/db/client";
import { slips, auditLog } from "@/lib/db/schema";
import { streamBlob } from "@/lib/blob";

export const runtime = "nodejs";

/**
 * GET /api/slips/[id]/pdf
 * Auth-gated proxy — streams the filed-slip PDF from Vercel Blob.
 * Only filed slips have a pdfBlobUrl; drafts 404.
 */
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
      type: slips.type,
      taxYear: slips.taxYear,
      status: slips.status,
      blobUrl: slips.pdfBlobUrl,
      craConfirmationNumber: slips.craConfirmationNumber,
    })
    .from(slips)
    .where(eq(slips.id, id));

  if (!row?.blobUrl) return new NextResponse("Not found", { status: 404 });

  const upstream = await streamBlob(row.blobUrl);
  if (!upstream) return new NextResponse("Upstream error", { status: 502 });

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `slips:${row.type}:${row.taxYear}:pdf`,
    metadata: { slipId: id, status: row.status, download },
  });

  const filename = `${row.type}-CY${row.taxYear}${row.craConfirmationNumber ? `-${row.craConfirmationNumber}` : ""}${row.status === "void" ? "-VOIDED" : ""}.pdf`;

  return new NextResponse(upstream.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
