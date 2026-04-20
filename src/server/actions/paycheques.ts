"use server";

import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put, del } from "@vercel/blob";
import { renderToBuffer } from "@react-pdf/renderer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/lib/db/client";
import {
  paycheques,
  settings,
  remittances,
  documents,
  auditLog,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { computePayroll, payPeriodsFromCadence } from "@/lib/payroll-2026";
import { PaystubPDF } from "@/lib/paystub-pdf";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

let _bannerDataUri: string | null = null;
async function getBannerDataUri(): Promise<string | undefined> {
  if (_bannerDataUri) return _bannerDataUri;
  for (const candidate of ["public/banner-pdf.png", "public/banner.png", "public/logo-full.png", "public/logo.png"]) {
    try {
      const buffer = await readFile(resolve(process.cwd(), candidate));
      _bannerDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
      return _bannerDataUri;
    } catch {
      continue;
    }
  }
  return undefined;
}

function revalidate() {
  revalidatePath("/paycheques");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

const createSchema = z.object({
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pay date required"),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Period start required"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Period end required"),
  grossDollars: z.coerce.number().positive("Gross must be greater than 0"),
  notes: z.string().max(2000).nullable(),
});

/** 15th of the month following the pay date (CRA standard remitter default). */
function remittanceDueDate(payDate: string): string {
  const [y, m] = payDate.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 15)); // month is 1-indexed -> new Date(y, m, 15) = next month 15th
  return next.toISOString().slice(0, 10);
}

export async function createPaycheque(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  let createdId: string | null = null;
  try {
    const email = await requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = createSchema.safeParse({
      payDate: fd.get("payDate"),
      periodStart: fd.get("periodStart"),
      periodEnd: fd.get("periodEnd"),
      grossDollars: fd.get("grossDollars"),
      notes: (fd.get("notes") as string) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;
    if (data.periodEnd < data.periodStart) return { error: "Period end must be on or after period start." };

    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings not seeded." };
    if (!s.payrollAccountActive) return { error: "Activate payroll (RP0001) in Settings first." };

    const periods = payPeriodsFromCadence(s.payCadence);
    const payYear = data.payDate.slice(0, 4);

    // YTD: only issued paycheques count toward CPP caps. Draft/void excluded.
    const ytdRows = await db
      .select()
      .from(paycheques)
      .where(
        and(
          eq(paycheques.status, "issued"),
          gte(paycheques.payDate, `${payYear}-01-01`),
          lte(paycheques.payDate, `${payYear}-12-31`),
        ),
      );
    const ytdCpp = ytdRows.reduce((a, r) => a + r.cppCents, 0);
    const ytdCpp2 = ytdRows.reduce((a, r) => a + r.cpp2Cents, 0);
    const ytdGross = ytdRows.reduce((a, r) => a + r.grossCents, 0);

    const grossCents = Math.round(data.grossDollars * 100);
    const result = computePayroll({
      grossCents,
      ytdCppCents: ytdCpp,
      ytdCpp2Cents: ytdCpp2,
      ytdGrossCents: ytdGross,
      payPeriodsPerYear: periods,
    });

    // Insert paycheque draft
    const [created] = await db
      .insert(paycheques)
      .values({
        payDate: data.payDate,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        grossCents: result.grossCents,
        cppCents: result.cppCents,
        cpp2Cents: result.cpp2Cents,
        eiCents: result.eiCents,
        federalTaxCents: result.federalTaxCents,
        provincialTaxCents: result.provincialTaxCents,
        otherDeductionsCents: 0,
        netCents: result.netCents,
        employerCppCents: result.employerCppCents,
        employerCpp2Cents: result.employerCpp2Cents,
        employerEiCents: 0,
        totalRemittanceCents: result.totalRemittanceCents,
        status: "draft",
        notes: data.notes,
      })
      .returning({ id: paycheques.id });
    const id = created!.id;
    createdId = id;

    // Render PDF
    const bannerDataUri = await getBannerDataUri();
    const pdfBuffer = await renderToBuffer(
      PaystubPDF({
        paycheque: {
          payDate: data.payDate,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          grossCents: result.grossCents,
          cppCents: result.cppCents,
          cpp2Cents: result.cpp2Cents,
          eiCents: result.eiCents,
          federalTaxCents: result.federalTaxCents,
          provincialTaxCents: result.provincialTaxCents,
          ohpCents: result.ohpCents,
          otherDeductionsCents: 0,
          netCents: result.netCents,
          employerCppCents: result.employerCppCents,
          employerCpp2Cents: result.employerCpp2Cents,
          totalRemittanceCents: result.totalRemittanceCents,
          notes: data.notes,
        },
        ytd: {
          grossCents: ytdGross + result.grossCents,
          cppCents: ytdCpp + result.cppCents,
          cpp2Cents: ytdCpp2 + result.cpp2Cents,
          federalTaxCents:
            ytdRows.reduce((a, r) => a + r.federalTaxCents, 0) + result.federalTaxCents,
          provincialTaxCents:
            ytdRows.reduce((a, r) => a + r.provincialTaxCents, 0) + result.provincialTaxCents,
          netCents: ytdRows.reduce((a, r) => a + r.netCents, 0) + result.netCents,
        },
        settings: {
          corpLegalName: s.corpLegalName,
          payrollAccount: s.payrollAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          brandPrimaryHex: s.brandPrimaryHex,
        },
        employee: {
          legalName: s.directorLegalName,
          email: s.directorEmail,
        },
        bannerDataUri,
      }),
    );
    const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

    const blob = await put(
      `paycheques/${id}/paystub-${data.payDate}.pdf`,
      pdfBuffer,
      { access: "public", contentType: "application/pdf", addRandomSuffix: true },
    );

    const [vaultDoc] = await db
      .insert(documents)
      .values({
        name: `paystub-${data.payDate}.pdf`,
        category: "paystub",
        blobUrl: blob.url,
        sha256: pdfSha256,
        sizeBytes: pdfBuffer.length,
        contentType: "application/pdf",
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    await db
      .update(paycheques)
      .set({ pdfBlobUrl: blob.url, pdfSha256 })
      .where(eq(paycheques.id, id));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `paycheques:${id}`,
      metadata: {
        payDate: data.payDate,
        grossCents,
        netCents: result.netCents,
        remittanceCents: result.totalRemittanceCents,
        vaultDocumentId: vaultDoc?.id,
      },
    });

    revalidate();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
  if (createdId) redirect(`/paycheques/${createdId}`);
  return { error: "Unexpected: paycheque not created" };
}

const statusSchema = z.enum(["draft", "issued", "void"]);

export async function setPaychequeStatus(id: string, status: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = statusSchema.safeParse(status);
    if (!parsed.success) return { error: "Invalid status." };

    const [pq] = await db.select().from(paycheques).where(eq(paycheques.id, id));
    if (!pq) return { error: "Paycheque not found." };

    await db.update(paycheques).set({ status: parsed.data }).where(eq(paycheques.id, id));

    // When transitioning to issued: create the remittance row (once per pay period).
    if (parsed.data === "issued" && pq.status !== "issued") {
      const due = remittanceDueDate(pq.payDate);
      const existing = await db
        .select({ id: remittances.id })
        .from(remittances)
        .where(
          and(
            eq(remittances.type, "payroll_source_deductions"),
            eq(remittances.periodStart, pq.periodStart),
            eq(remittances.periodEnd, pq.periodEnd),
          ),
        )
        .limit(1);
      if (!existing[0]) {
        await db.insert(remittances).values({
          type: "payroll_source_deductions",
          periodStart: pq.periodStart,
          periodEnd: pq.periodEnd,
          dueDate: due,
          amountCents: pq.totalRemittanceCents,
          notes: `Source deductions for pay period ${pq.periodStart}...${pq.periodEnd}`,
        });
      }
    }

    // When leaving "issued" (→ draft or void): remove the unpaid remittance.
    // Paid remittances stay for audit — the money is already with CRA.
    if (pq.status === "issued" && parsed.data !== "issued") {
      await db
        .delete(remittances)
        .where(
          and(
            eq(remittances.type, "payroll_source_deductions"),
            eq(remittances.periodStart, pq.periodStart),
            eq(remittances.periodEnd, pq.periodEnd),
            sql`${remittances.paidAt} IS NULL`,
          ),
        );
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `paycheques:${id}:status`,
      metadata: { from: pq.status, to: parsed.data },
    });
    revalidate();
    return { ok: `Marked as ${parsed.data}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Status update failed" };
  }
}

export async function deleteDraftPaycheque(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [pq] = await db.select().from(paycheques).where(eq(paycheques.id, id));
    if (!pq) return { error: "Paycheque not found." };
    if (pq.status !== "draft") return { error: "Only draft paycheques can be deleted." };

    if (pq.pdfBlobUrl) {
      try {
        await del(pq.pdfBlobUrl);
      } catch {
        // best-effort
      }
      await db.delete(documents).where(eq(documents.blobUrl, pq.pdfBlobUrl));
    }

    await db.delete(paycheques).where(eq(paycheques.id, id));

    // Defensive: drop any unpaid source-deduction remittance for this same period.
    // Drafts shouldn't have one, but this catches orphans from earlier issue/revert cycles.
    await db
      .delete(remittances)
      .where(
        and(
          eq(remittances.type, "payroll_source_deductions"),
          eq(remittances.periodStart, pq.periodStart),
          eq(remittances.periodEnd, pq.periodEnd),
          sql`${remittances.paidAt} IS NULL`,
        ),
      );

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `paycheques:${id}`,
      metadata: { payDate: pq.payDate, grossCents: pq.grossCents },
    });
    revalidate();
    return { ok: "Draft paycheque deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function markRemittancePaid(
  remittanceId: string,
  confirmationNumber: string | null,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db
      .update(remittances)
      .set({ paidAt: new Date(), confirmationNumber })
      .where(eq(remittances.id, remittanceId));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `remittances:${remittanceId}:paid`,
      metadata: { confirmationNumber },
    });
    revalidate();
    return { ok: "Remittance marked as paid." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function markRemittanceUnpaid(remittanceId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db
      .update(remittances)
      .set({ paidAt: null, confirmationNumber: null })
      .where(eq(remittances.id, remittanceId));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `remittances:${remittanceId}:unpaid`,
      metadata: {},
    });
    revalidate();
    return { ok: "Remittance re-opened." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function deleteRemittance(remittanceId: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [row] = await db.select().from(remittances).where(eq(remittances.id, remittanceId));
    if (!row) return { error: "Remittance not found." };
    if (row.paidAt) return { error: "Paid remittances can't be deleted (audit trail)." };

    await db.delete(remittances).where(eq(remittances.id, remittanceId));
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "delete",
      target: `remittances:${remittanceId}`,
      metadata: {
        type: row.type,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        amountCents: row.amountCents,
      },
    });
    revalidate();
    return { ok: "Remittance deleted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}
