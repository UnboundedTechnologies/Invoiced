"use server";

import { and, desc, eq } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { revalidatePath } from "next/cache";
import { put } from "@/lib/blob";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { slips, settings, documents, deadlines, auditLog, type Slip } from "@/lib/db/schema";
import { taxYearFor } from "@/lib/t1";
import { auth } from "../../../auth";
import { taxYearsWithActivity } from "@/lib/queries/personal-tax-slices";
import { buildT4ASlipBoxes, buildT4SlipBoxes, buildT5SlipBoxes } from "@/lib/queries/slip-aggregation";
import type { T4ASlipBoxes, T4SlipBoxes, T5SlipBoxes } from "@/lib/slip-boxes";
import { T4SlipPDF } from "@/lib/t4-slip-pdf";
import { T4ASlipPDF } from "@/lib/t4a-slip-pdf";
import { T5SlipPDF } from "@/lib/t5-slip-pdf";
import { getBannerDataUri } from "@/lib/pdf-banner";
import { t4BoxesToCsv, t4aBoxesToCsv, t5BoxesToCsv, type SlipCsvPayer } from "@/lib/slip-csv";

type PdfActionResult = { ok?: string; error?: string; pdfBase64?: string; filename?: string };
type CsvActionResult = { ok?: string; error?: string; csvBase64?: string; filename?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

/** Feb 28 of CY+1, shifted to next weekday if it lands on a weekend. */
function slipFilingDueDate(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28));
  const dow = due.getUTCDay();
  if (dow === 6) due.setUTCDate(due.getUTCDate() + 2);
  else if (dow === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

// Shared slip-filing lock helpers. All three check whether a slip with
// status='filed' exists for the calendar year derived from the given ISO
// date. Draft slips do NOT lock — data keeps flowing into the draft until
// you explicitly file it. Voided slips also don't lock — the void reopens
// the underlying data.
//
// CALENDAR year (via taxYearFor), NOT fiscal year. T4 uses payDate, T5
// uses paidDate, T4A uses entryDate — each routed through taxYearFor so
// non-Dec-31 FYE corps lock on the right year.
async function slipLockError(
  iso: string,
  type: "T4" | "T5" | "T4A",
  editLabel: string,
): Promise<string | null> {
  const cy = taxYearFor(iso);
  const [row] = await db
    .select({ id: slips.id })
    .from(slips)
    .where(
      and(
        eq(slips.type, type),
        eq(slips.taxYear, cy),
        eq(slips.status, "filed"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return `A ${type} slip was filed for CY ${cy}. ${editLabel} is locked — void the slip to reopen the data.`;
}

/** Block if a T4 slip is filed for the paycheque's pay-date calendar year. */
export async function t4SlipLockError(payDate: string): Promise<string | null> {
  await requireSession();
  return slipLockError(payDate, "T4", "Paycheque edit");
}

/** Block if a T5 slip is filed for the dividend's paid-date calendar year. */
export async function t5SlipLockError(paidDate: string): Promise<string | null> {
  await requireSession();
  return slipLockError(paidDate, "T5", "Dividend edit");
}

/** Block if a T4A slip is filed for the loan-entry's entry-date calendar year. */
export async function t4aSlipLockError(entryDate: string): Promise<string | null> {
  await requireSession();
  return slipLockError(entryDate, "T4A", "Loan-ledger edit");
}

// ────────────────────────────────────────────────────────────────────────
// List + preview queries — drive /slips + /slips/[taxYear]
// ────────────────────────────────────────────────────────────────────────

/** All slip rows (any type, any status — including voided) ordered newest tax year first. */
export async function listAllSlips(): Promise<Slip[]> {
  await requireSession();
  return db.select().from(slips).orderBy(desc(slips.taxYear), desc(slips.createdAt));
}

/** Candidate CY detection for slips. A CY is a slip candidate if it has activity
 *  (paycheques/dividends/loan entries) AND no active (non-void) T4+T5 pair yet. */
export async function listSlipCandidateYears(): Promise<number[]> {
  await requireSession();
  const years = await taxYearsWithActivity();
  // Even years with filed T4 only (no T5) still show up — `/slips/[cy]` shows both cards.
  return years.sort((a, b) => b - a);
}

export type SlipPreview = {
  taxYear: number;
  t4: T4SlipBoxes;
  t5: T5SlipBoxes;
  t4a: T4ASlipBoxes;
  /** Existing DB rows for each slip type (active or voided). */
  existing: { t4: Slip | null; t5: Slip | null; t4a: Slip | null };
};

/** Full preview for a tax year: live T4/T5/T4A boxes from aggregators + any existing slip rows. */
export async function loadSlipPreview(taxYear: number): Promise<SlipPreview> {
  await requireSession();
  const [t4, t5, t4a, rows] = await Promise.all([
    buildT4SlipBoxes(taxYear),
    buildT5SlipBoxes(taxYear),
    buildT4ASlipBoxes(taxYear),
    db.select().from(slips).where(eq(slips.taxYear, taxYear)),
  ]);
  // Pick the active (non-void) slip per type, falling back to newest voided if no active exists.
  const pickByType = (type: "T4" | "T5" | "T4A"): Slip | null => {
    const typed = rows.filter((r) => r.type === type);
    const active = typed.find((r) => r.status !== "void");
    if (active) return active;
    return typed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  };
  return {
    taxYear,
    t4,
    t5,
    t4a,
    existing: { t4: pickByType("T4"), t5: pickByType("T5"), t4a: pickByType("T4A") },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Working-copy PDF generators — ephemeral base64 download (no Blob persist).
// Filing + Blob persist lands in 4E-4.
// ────────────────────────────────────────────────────────────────────────

async function requireSettings() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) throw new Error("Settings not seeded.");
  return s;
}

export async function generateT4WorkingCopyPdf(taxYear: number): Promise<PdfActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s, bannerDataUri] = await Promise.all([
      buildT4SlipBoxes(taxYear),
      requireSettings(),
      getBannerDataUri(),
    ]);

    if (boxes.paychequeCount === 0) {
      return { error: `No issued paycheques in CY ${taxYear} — nothing to generate.` };
    }

    const buffer = await renderToBuffer(
      T4SlipPDF({
        taxYear,
        boxes,
        status: "draft",
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payrollAccount: s.payrollAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T4:${taxYear}:working-copy`,
      metadata: { paychequeCount: boxes.paychequeCount },
    });

    return {
      ok: "T4 working copy generated.",
      pdfBase64,
      filename: `T4-WorkingCopy-CY${taxYear}.pdf`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

export async function generateT4aWorkingCopyPdf(taxYear: number): Promise<PdfActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s, bannerDataUri] = await Promise.all([
      buildT4ASlipBoxes(taxYear),
      requireSettings(),
      getBannerDataUri(),
    ]);

    if (boxes.box117Cents === 0) {
      return { error: `No shareholder-loan benefits in CY ${taxYear} — nothing to generate.` };
    }

    const buffer = await renderToBuffer(
      T4ASlipPDF({
        taxYear,
        boxes,
        status: "draft",
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payrollAccount: s.payrollAccount,
          payerRzAccount: s.payerRzAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T4A:${taxYear}:working-copy`,
      metadata: { box117Cents: boxes.box117Cents },
    });

    return {
      ok: "T4A working copy generated.",
      pdfBase64,
      filename: `T4A-WorkingCopy-CY${taxYear}.pdf`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

export async function generateT5WorkingCopyPdf(taxYear: number): Promise<PdfActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s, bannerDataUri] = await Promise.all([
      buildT5SlipBoxes(taxYear),
      requireSettings(),
      getBannerDataUri(),
    ]);

    const count = boxes.eligible.count + boxes.nonEligible.count;
    if (count === 0) {
      return { error: `No paid dividends in CY ${taxYear} — nothing to generate.` };
    }

    const buffer = await renderToBuffer(
      T5SlipPDF({
        taxYear,
        boxes,
        status: "draft",
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payerRzAccount: s.payerRzAccount,
          payerRzActive: s.payerRzActive,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T5:${taxYear}:working-copy`,
      metadata: { paidDividendCount: count, rzActive: s.payerRzActive },
    });

    return {
      ok: "T5 working copy generated.",
      pdfBase64,
      filename: `T5-WorkingCopy-CY${taxYear}.pdf`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Working-copy CSV generators — box-by-box export for re-keying into CRA
// Web Forms. Uses the same aggregator façade as the PDF so the two stay
// numerically identical (coherence guard in verify-coherence.ts).
// ────────────────────────────────────────────────────────────────────────

function csvPayer(s: {
  corpLegalName: string;
  businessNumber: string;
  payrollAccount: string | null;
  payerRzAccount: string | null;
  directorLegalName: string;
}): SlipCsvPayer {
  return {
    corpLegalName: s.corpLegalName,
    businessNumber: s.businessNumber,
    payrollAccount: s.payrollAccount,
    payerRzAccount: s.payerRzAccount,
    directorLegalName: s.directorLegalName,
  };
}

export async function generateT4WorkingCopyCsv(taxYear: number): Promise<CsvActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s] = await Promise.all([buildT4SlipBoxes(taxYear), requireSettings()]);
    if (boxes.paychequeCount === 0) {
      return { error: `No issued paycheques in CY ${taxYear} — nothing to generate.` };
    }
    const csv = t4BoxesToCsv(boxes, csvPayer(s), taxYear);
    const csvBase64 = Buffer.from(csv, "utf8").toString("base64");
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T4:${taxYear}:working-copy-csv`,
      metadata: { paychequeCount: boxes.paychequeCount, bytes: csv.length },
    });
    return {
      ok: "T4 CSV generated.",
      csvBase64,
      filename: `T4-WorkingCopy-CY${taxYear}.csv`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "CSV generation failed" };
  }
}

export async function generateT4aWorkingCopyCsv(taxYear: number): Promise<CsvActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s] = await Promise.all([buildT4ASlipBoxes(taxYear), requireSettings()]);
    if (boxes.box117Cents === 0) {
      return { error: `No shareholder-loan benefits in CY ${taxYear} — nothing to generate.` };
    }
    const csv = t4aBoxesToCsv(boxes, csvPayer(s), taxYear);
    const csvBase64 = Buffer.from(csv, "utf8").toString("base64");
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T4A:${taxYear}:working-copy-csv`,
      metadata: { box117Cents: boxes.box117Cents, bytes: csv.length },
    });
    return {
      ok: "T4A CSV generated.",
      csvBase64,
      filename: `T4A-WorkingCopy-CY${taxYear}.csv`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "CSV generation failed" };
  }
}

export async function generateT5WorkingCopyCsv(taxYear: number): Promise<CsvActionResult> {
  try {
    const email = await requireSession();
    const [boxes, s] = await Promise.all([buildT5SlipBoxes(taxYear), requireSettings()]);
    const count = boxes.eligible.count + boxes.nonEligible.count;
    if (count === 0) {
      return { error: `No paid dividends in CY ${taxYear} — nothing to generate.` };
    }
    const csv = t5BoxesToCsv(boxes, csvPayer(s), taxYear);
    const csvBase64 = Buffer.from(csv, "utf8").toString("base64");
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `slips:T5:${taxYear}:working-copy-csv`,
      metadata: { paidDividendCount: count, bytes: csv.length },
    });
    return {
      ok: "T5 CSV generated.",
      csvBase64,
      filename: `T5-WorkingCopy-CY${taxYear}.csv`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "CSV generation failed" };
  }
}

// ────────────────────────────────────────────────────────────────────────
// File + Void actions — freeze a slip snapshot, upload the filed PDF to
// Blob, and insert a vault row. Void re-opens the underlying data.
// ────────────────────────────────────────────────────────────────────────

type SlipActionResult = { ok?: string; error?: string };

function revalidateSlipPaths(taxYear: number) {
  revalidatePath("/slips");
  revalidatePath(`/slips/${taxYear}`);
  revalidatePath("/dashboard");
  revalidatePath("/paycheques");
  revalidatePath("/dividends");
  revalidatePath("/(app)", "layout");
}

const fileSlipSchema = z.object({
  craConfirmationNumber: z.string().max(200).nullable(),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Filed-on date required (YYYY-MM-DD)"),
  accountantSignoff: z.boolean(),
  typedConfirm: z.string(),
});

function parseFileSlipForm(fd: FormData) {
  return fileSlipSchema.safeParse({
    craConfirmationNumber: ((fd.get("craConfirmationNumber") as string) || "").trim() || null,
    filedAt: String(fd.get("filedAt") ?? "").trim(),
    accountantSignoff: fd.get("accountantSignoff") === "on",
    typedConfirm: String(fd.get("typedConfirm") ?? "").trim(),
  });
}

/** File a T4 slip — freezes the snapshot, renders final PDF, stores in vault. */
export async function fileT4Slip(
  taxYear: number,
  _prev: SlipActionResult | undefined,
  fd: FormData,
): Promise<SlipActionResult> {
  try {
    const email = await requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = parseFileSlipForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { craConfirmationNumber, filedAt, accountantSignoff, typedConfirm } = parsed.data;

    const expectedPhrase = `FILE T4 CY${taxYear}`;
    if (typedConfirm !== expectedPhrase) {
      return { error: `Type "${expectedPhrase}" exactly to confirm.` };
    }
    if (!accountantSignoff) {
      return { error: "Accountant sign-off checkbox is required before filing." };
    }

    // Refuse if an active (non-void) T4 slip exists for this CY.
    const existing = await db
      .select()
      .from(slips)
      .where(and(eq(slips.type, "T4"), eq(slips.taxYear, taxYear)));
    const active = existing.find((r) => r.status !== "void");
    if (active) {
      return {
        error: `A T4 slip for CY ${taxYear} is already ${active.status}. Void it first to re-file.`,
      };
    }

    const s = await requireSettings();
    if (!s.payrollAccountActive) {
      return { error: "Activate the RP payroll account in Settings before filing a T4." };
    }
    const boxes = await buildT4SlipBoxes(taxYear);
    if (boxes.paychequeCount === 0) {
      return { error: `No issued paycheques in CY ${taxYear} — nothing to file.` };
    }

    const bannerDataUri = await getBannerDataUri();
    const pdfBuffer = await renderToBuffer(
      T4SlipPDF({
        taxYear,
        boxes,
        status: "filed",
        filed: { craConfirmationNumber, filedAt },
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payrollAccount: s.payrollAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

    // Upload to Blob + insert vault row + upsert slip row + audit — one batch.
    const filename = `T4-Filed-CY${taxYear}${craConfirmationNumber ? `-${craConfirmationNumber}` : ""}.pdf`;
    const blob = await put(`slips/T4/${taxYear}/${filename}`, pdfBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    const [vaultDoc] = await db
      .insert(documents)
      .values({
        name: filename,
        category: "slip",
        blobUrl: blob.url,
        sha256: pdfSha256,
        sizeBytes: pdfBuffer.length,
        contentType: "application/pdf",
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    const filedAtTs = new Date(filedAt + "T00:00:00Z");
    // Prepare the JSONB totals snapshot (future-compat: RL-1, T4008).
    const totals = {
      t4: {
        box14: boxes.box14EmploymentIncomeCents,
        box16: boxes.box16CppBaseCents,
        box16a: boxes.box16aCpp2Cents,
        box18: boxes.box18EiCents,
        box22: boxes.box22FedTaxWithheldCents,
        box24: boxes.box24EiInsurableCents,
        box26: boxes.box26CppPensionableCents,
        box52: boxes.box52PensionAdjustmentCents,
        ontarioTaxWithheld: boxes.ontarioTaxWithheldCents,
        employerCpp: boxes.employerCppBaseCents,
        employerCpp2: boxes.employerCpp2Cents,
        paychequeCount: boxes.paychequeCount,
      },
    };

    const [created] = await db
      .insert(slips)
      .values({
        type: "T4",
        taxYear,
        status: "filed",
        reportTypeCode: "O",
        totals,
        filedAt: filedAtTs,
        filedBy: email,
        craConfirmationNumber,
        pdfBlobUrl: blob.url,
        pdfSha256,
        documentId: vaultDoc?.id ?? null,
        t4Box14Cents: boxes.box14EmploymentIncomeCents,
        t4Box16Cents: boxes.box16CppBaseCents,
        t4Box16aCents: boxes.box16aCpp2Cents,
        t4Box18Cents: boxes.box18EiCents,
        t4Box22Cents: boxes.box22FedTaxWithheldCents,
        t4Box24Cents: boxes.box24EiInsurableCents,
        t4Box26Cents: boxes.box26CppPensionableCents,
        t4Box52Cents: boxes.box52PensionAdjustmentCents,
        t4OntarioTaxWithheldCents: boxes.ontarioTaxWithheldCents,
        t4EmployerCppCents: boxes.employerCppBaseCents,
        t4EmployerCpp2Cents: boxes.employerCpp2Cents,
        ratesEditionTag: boxes.ratesEditionTag,
      })
      .returning({ id: slips.id });

    // Remove the upcoming t4:<cy> deadline (it's done).
    await db.delete(deadlines).where(eq(deadlines.sourceKey, `t4:${taxYear}`));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `slips:T4:${taxYear}:file`,
      metadata: {
        slipId: created?.id,
        craConfirmationNumber,
        filedAt,
        paychequeCount: boxes.paychequeCount,
        box14Cents: boxes.box14EmploymentIncomeCents,
        vaultDocumentId: vaultDoc?.id,
      },
    });

    revalidateSlipPaths(taxYear);
    return { ok: `T4 for CY ${taxYear} filed and locked.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

/** File a T5 slip — freezes the snapshot, renders final PDF, stores in vault. */
export async function fileT5Slip(
  taxYear: number,
  _prev: SlipActionResult | undefined,
  fd: FormData,
): Promise<SlipActionResult> {
  try {
    const email = await requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = parseFileSlipForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { craConfirmationNumber, filedAt, accountantSignoff, typedConfirm } = parsed.data;

    const expectedPhrase = `FILE T5 CY${taxYear}`;
    if (typedConfirm !== expectedPhrase) {
      return { error: `Type "${expectedPhrase}" exactly to confirm.` };
    }
    if (!accountantSignoff) {
      return { error: "Accountant sign-off checkbox is required before filing." };
    }

    const existing = await db
      .select()
      .from(slips)
      .where(and(eq(slips.type, "T5"), eq(slips.taxYear, taxYear)));
    const active = existing.find((r) => r.status !== "void");
    if (active) {
      return {
        error: `A T5 slip for CY ${taxYear} is already ${active.status}. Void it first to re-file.`,
      };
    }

    const s = await requireSettings();
    if (!s.payerRzActive) {
      return { error: "Activate the RZ info-returns account in Settings before filing a T5." };
    }
    const boxes = await buildT5SlipBoxes(taxYear);
    const count = boxes.eligible.count + boxes.nonEligible.count;
    if (count === 0) {
      return { error: `No paid dividends in CY ${taxYear} — nothing to file.` };
    }

    const bannerDataUri = await getBannerDataUri();
    const pdfBuffer = await renderToBuffer(
      T5SlipPDF({
        taxYear,
        boxes,
        status: "filed",
        filed: { craConfirmationNumber, filedAt },
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payerRzAccount: s.payerRzAccount,
          payerRzActive: s.payerRzActive,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

    const filename = `T5-Filed-CY${taxYear}${craConfirmationNumber ? `-${craConfirmationNumber}` : ""}.pdf`;
    const blob = await put(`slips/T5/${taxYear}/${filename}`, pdfBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    const [vaultDoc] = await db
      .insert(documents)
      .values({
        name: filename,
        category: "slip",
        blobUrl: blob.url,
        sha256: pdfSha256,
        sizeBytes: pdfBuffer.length,
        contentType: "application/pdf",
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    const filedAtTs = new Date(filedAt + "T00:00:00Z");
    const totals = {
      t5: {
        eligible: {
          actual: boxes.eligible.actualCents,
          taxable: boxes.eligible.taxableCents,
          fedDtc: boxes.eligible.federalDtcCents,
          onDtc: boxes.eligible.ontarioDtcCents,
          count: boxes.eligible.count,
        },
        nonEligible: {
          actual: boxes.nonEligible.actualCents,
          taxable: boxes.nonEligible.taxableCents,
          fedDtc: boxes.nonEligible.federalDtcCents,
          onDtc: boxes.nonEligible.ontarioDtcCents,
          count: boxes.nonEligible.count,
        },
      },
    };

    const [created] = await db
      .insert(slips)
      .values({
        type: "T5",
        taxYear,
        status: "filed",
        reportTypeCode: "O",
        totals,
        filedAt: filedAtTs,
        filedBy: email,
        craConfirmationNumber,
        pdfBlobUrl: blob.url,
        pdfSha256,
        documentId: vaultDoc?.id ?? null,
        t5EligibleActualCents: boxes.eligible.actualCents,
        t5EligibleTaxableCents: boxes.eligible.taxableCents,
        t5EligibleDtcFederalCents: boxes.eligible.federalDtcCents,
        t5EligibleDtcOntarioCents: boxes.eligible.ontarioDtcCents,
        t5NonEligibleActualCents: boxes.nonEligible.actualCents,
        t5NonEligibleTaxableCents: boxes.nonEligible.taxableCents,
        t5NonEligibleDtcFederalCents: boxes.nonEligible.federalDtcCents,
        t5NonEligibleDtcOntarioCents: boxes.nonEligible.ontarioDtcCents,
        ratesEditionTag: boxes.ratesEditionTag,
      })
      .returning({ id: slips.id });

    await db.delete(deadlines).where(eq(deadlines.sourceKey, `t5:${taxYear}`));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `slips:T5:${taxYear}:file`,
      metadata: {
        slipId: created?.id,
        craConfirmationNumber,
        filedAt,
        paidDividendCount: count,
        elActualCents: boxes.eligible.actualCents,
        neActualCents: boxes.nonEligible.actualCents,
        vaultDocumentId: vaultDoc?.id,
      },
    });

    revalidateSlipPaths(taxYear);
    return { ok: `T5 for CY ${taxYear} filed and locked.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

/** File a T4A slip (Box 117 — shareholder-loan benefits). Freezes snapshot,
 *  renders final PDF, stores in vault, and locks the loan ledger for that CY. */
export async function fileT4aSlip(
  taxYear: number,
  _prev: SlipActionResult | undefined,
  fd: FormData,
): Promise<SlipActionResult> {
  try {
    const email = await requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { error: "Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN in .env.local." };
    }

    const parsed = parseFileSlipForm(fd);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { craConfirmationNumber, filedAt, accountantSignoff, typedConfirm } = parsed.data;

    const expectedPhrase = `FILE T4A CY${taxYear}`;
    if (typedConfirm !== expectedPhrase) {
      return { error: `Type "${expectedPhrase}" exactly to confirm.` };
    }
    if (!accountantSignoff) {
      return { error: "Accountant sign-off checkbox is required before filing." };
    }

    const existing = await db
      .select()
      .from(slips)
      .where(and(eq(slips.type, "T4A"), eq(slips.taxYear, taxYear)));
    const active = existing.find((r) => r.status !== "void");
    if (active) {
      return {
        error: `A T4A slip for CY ${taxYear} is already ${active.status}. Void it first to re-file.`,
      };
    }

    const s = await requireSettings();
    if (!s.payerRzActive) {
      return { error: "Activate the RZ info-returns account in Settings before filing a T4A." };
    }
    const boxes = await buildT4ASlipBoxes(taxYear);
    if (boxes.box117Cents === 0) {
      return { error: `No shareholder-loan benefits in CY ${taxYear} — nothing to file.` };
    }

    const bannerDataUri = await getBannerDataUri();
    const pdfBuffer = await renderToBuffer(
      T4ASlipPDF({
        taxYear,
        boxes,
        status: "filed",
        filed: { craConfirmationNumber, filedAt },
        payer: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          payrollAccount: s.payrollAccount,
          payerRzAccount: s.payerRzAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        recipient: {
          legalName: s.directorLegalName,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
        },
        bannerDataUri,
        filingDueDate: slipFilingDueDate(taxYear),
      }),
    );
    const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

    const filename = `T4A-Filed-CY${taxYear}${craConfirmationNumber ? `-${craConfirmationNumber}` : ""}.pdf`;
    const blob = await put(`slips/T4A/${taxYear}/${filename}`, pdfBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    const [vaultDoc] = await db
      .insert(documents)
      .values({
        name: filename,
        category: "slip",
        blobUrl: blob.url,
        sha256: pdfSha256,
        sizeBytes: pdfBuffer.length,
        contentType: "application/pdf",
        version: 1,
        uploadedBy: email,
      })
      .returning({ id: documents.id });

    const filedAtTs = new Date(filedAt + "T00:00:00Z");
    const totals = {
      t4a: {
        box117: boxes.box117Cents,
        box022: boxes.box022TaxWithheldCents,
        breakdown: {
          benefit80_4: boxes.breakdown.benefit80_4Cents,
          inclusion15_2: boxes.breakdown.inclusion15_2Cents,
        },
      },
    };

    const [created] = await db
      .insert(slips)
      .values({
        type: "T4A",
        taxYear,
        status: "filed",
        reportTypeCode: "O",
        totals,
        filedAt: filedAtTs,
        filedBy: email,
        craConfirmationNumber,
        pdfBlobUrl: blob.url,
        pdfSha256,
        documentId: vaultDoc?.id ?? null,
        t4aBox117Cents: boxes.box117Cents,
        t4aBenefit80_4Cents: boxes.breakdown.benefit80_4Cents,
        t4aInclusion15_2Cents: boxes.breakdown.inclusion15_2Cents,
        ratesEditionTag: boxes.ratesEditionTag,
      })
      .returning({ id: slips.id });

    await db.delete(deadlines).where(eq(deadlines.sourceKey, `t4a:${taxYear}`));

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `slips:T4A:${taxYear}:file`,
      metadata: {
        slipId: created?.id,
        craConfirmationNumber,
        filedAt,
        box117Cents: boxes.box117Cents,
        benefit80_4Cents: boxes.breakdown.benefit80_4Cents,
        inclusion15_2Cents: boxes.breakdown.inclusion15_2Cents,
        vaultDocumentId: vaultDoc?.id,
      },
    });

    revalidateSlipPaths(taxYear);
    return { ok: `T4A for CY ${taxYear} filed and locked.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

const voidSlipSchema = z.object({
  reason: z.string().min(3, "Reason is required").max(1000, "Reason too long"),
  typedConfirm: z.string(),
});

export async function voidSlip(
  slipId: string,
  _prev: SlipActionResult | undefined,
  fd: FormData,
): Promise<SlipActionResult> {
  try {
    const email = await requireSession();

    const parsed = voidSlipSchema.safeParse({
      reason: String(fd.get("reason") ?? "").trim(),
      typedConfirm: String(fd.get("typedConfirm") ?? "").trim(),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const [row] = await db.select().from(slips).where(eq(slips.id, slipId));
    if (!row) return { error: "Slip not found." };
    if (row.status === "void") return { error: "Slip is already voided." };

    const expectedPhrase = `VOID ${row.type} CY${row.taxYear}`;
    if (parsed.data.typedConfirm !== expectedPhrase) {
      return { error: `Type "${expectedPhrase}" exactly to confirm.` };
    }

    // Keep the PDF in Blob + vault row (audit trail). Just mark the slip row void
    // so the filing-lock helpers stop blocking downstream edits.
    await db
      .update(slips)
      .set({
        status: "void",
        voidReason: parsed.data.reason,
        updatedAt: new Date(),
      })
      .where(eq(slips.id, slipId));

    // Re-upsert the deadline row (it was deleted on file). Only insert if no
    // row already exists for this natural key — future sync runs will keep
    // it fresh.
    const sourceKey = `${row.type.toLowerCase()}:${row.taxYear}`;
    const [existingDeadline] = await db
      .select({ id: deadlines.id })
      .from(deadlines)
      .where(eq(deadlines.sourceKey, sourceKey))
      .limit(1);
    if (!existingDeadline) {
      const dueDate = `${row.taxYear + 1}-02-28`;
      const title = `${row.type} slips — ${row.taxYear}`;
      const description =
        row.type === "T4"
          ? `T4 + T4 Summary for ${row.taxYear} pay year (due Feb 28 per Reg 210(2)).`
          : row.type === "T5"
            ? `T5 + T5 Summary for dividends paid in ${row.taxYear} (due Feb 28 per Reg 200(1)).`
            : row.type === "T4A"
              ? `T4A + T4A Summary for shareholder-loan benefits in ${row.taxYear} (due Feb 28 per Reg 200(1)).`
              : `${row.type} for ${row.taxYear}`;
      await db.insert(deadlines).values({
        title,
        description,
        dueDate,
        category: row.type.toLowerCase(),
        sourceKey,
      });
    }

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `slips:${row.type}:${row.taxYear}:void`,
      metadata: {
        slipId,
        reason: parsed.data.reason,
        hadCraConfirmation: row.craConfirmationNumber,
      },
    });

    revalidateSlipPaths(row.taxYear);
    return { ok: `${row.type} slip for CY ${row.taxYear} voided. Data is editable again.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Void failed" };
  }
}
