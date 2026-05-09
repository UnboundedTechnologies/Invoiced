import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "@/lib/db/client";
import { paycheques, auditLog } from "@/lib/db/schema";
import { streamBlob } from "@/lib/blob";

export const runtime = "nodejs";

/**
 * GET /api/paycheques/[id]/pdf
 * Auth-gated pay stub PDF proxy. Streams the paystub PDF from Vercel Blob.
 * GET is required for inline PDF rendering; the audit_log insert IS the
 * point of this route (download tracking), not a CSRF surface.
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
    .select({ url: paycheques.pdfBlobUrl, payDate: paycheques.payDate })
    .from(paycheques)
    .where(eq(paycheques.id, id));

  if (!row?.url) return new NextResponse("Not found", { status: 404 });

  const upstream = await streamBlob(row.url);
  if (!upstream) return new NextResponse("Upstream error", { status: 502 });

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `paycheques:${id}:pdf`,
    metadata: { payDate: row.payDate, download },
  });

  return new NextResponse(upstream.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="paystub-${row.payDate}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
