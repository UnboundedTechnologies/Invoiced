import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "@/lib/db/client";
import { invoices, auditLog } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/invoices/[id]/pdf
 * Auth-gated PDF proxy. Streams the invoice PDF from Vercel Blob.
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
    .select({ url: invoices.pdfBlobUrl, number: invoices.invoiceNumber })
    .from(invoices)
    .where(eq(invoices.id, id));

  if (!row?.url) return new NextResponse("Not found", { status: 404 });

  const upstream = await fetch(row.url);
  if (!upstream.ok) return new NextResponse("Upstream error", { status: 502 });

  await db.insert(auditLog).values({
    actorEmail: session.user.email,
    action: "download",
    target: `invoices:${id}:pdf`,
    metadata: { invoiceNumber: row.number, download },
  });

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${row.number}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
