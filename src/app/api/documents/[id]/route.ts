import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "@/lib/db/client";
import { documents, users, auditLog } from "@/lib/db/schema";
import { hasVaultPinSession, refreshVaultSession } from "@/lib/vault-pin-session";
import { hasVault2faSession } from "@/lib/vault-2fa-session";
import { streamBlob } from "@/lib/blob";

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

  // If the signed-in user has 2FA enrolled, require the vault-2fa cookie too.
  const sessionEmail = session.user.email.toLowerCase();
  const [me] = await db
    .select({ totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.email, sessionEmail));
  if (me?.totpEnabledAt) {
    const twofaUnlocked = await hasVault2faSession();
    if (!twofaUnlocked) return new NextResponse("Vault 2FA required", { status: 401 });
  }

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  if (!row) return new NextResponse("Not found", { status: 404 });

  const upstream = await streamBlob(row.blobUrl);
  if (!upstream) return new NextResponse("Upstream error", { status: 502 });

  const contentType = row.contentType || upstream.contentType;
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

  // Sliding refresh: download succeeded, extend the vault session by another
  // 60s so an active session doesn't lock mid-download-spree.
  await refreshVaultSession();

  return new NextResponse(upstream.stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
