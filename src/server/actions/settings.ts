"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  settings,
  auditLog,
  dividends,
  paycheques,
  invoices,
  shareholderLoanEntries,
  t2Returns,
} from "@/lib/db/schema";
import { auth } from "../../../auth";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string };
type CommitResult = { ok: true } | { error: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function commit(
  email: string,
  patch: Partial<typeof settings.$inferInsert>,
  section: string,
  expectedVersion: number | null = null,
): Promise<CommitResult> {
  if (expectedVersion !== null) {
    const [current] = await db
      .select({ version: settings.version })
      .from(settings)
      .where(eq(settings.id, 1));
    if (!current) return { error: "Settings not seeded." };
    if (current.version !== expectedVersion) {
      return { error: versionConflictError("settings", expectedVersion, current.version) };
    }
  }
  const whereClause = expectedVersion !== null
    ? and(eq(settings.id, 1), eq(settings.version, expectedVersion))
    : eq(settings.id, 1);
  const [updated] = await db
    .update(settings)
    .set({ ...patch, version: bumpVersion(), updatedAt: new Date() })
    .where(whereClause)
    .returning({ version: settings.version });
  if (!updated) {
    const [current] = await db
      .select({ version: settings.version })
      .from(settings)
      .where(eq(settings.id, 1));
    if (!current) return { error: "Settings not seeded." };
    return { error: versionConflictError("settings", expectedVersion ?? -1, current.version) };
  }
  await db.insert(auditLog).values({
    actorEmail: email,
    action: "update",
    target: `settings:${section}`,
    metadata: { ...(patch as Record<string, unknown>), toVersion: updated.version },
  });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
  return { ok: true };
}

//  Corporation 
const corpSchema = z
  .object({
    corpLegalName: z.string().min(1, "Legal name is required"),
    businessNumber: z.string().regex(/^\d{9}$/, "Business Number must be 9 digits"),
    hstAccount: z.string().nullable(),
    payrollAccount: z.string().nullable(),
    payrollAccountActive: z.boolean(),
    corpIncomeTaxAccount: z.string().nullable(),
    addressLine1: z.string().min(1, "Address is required"),
    addressLine2: z.string().nullable(),
    city: z.string().min(1, "City is required"),
    province: z.string().length(2, "Province code is 2 letters"),
    postalCode: z.string().min(6, "Postal code is required"),
    country: z.string().length(2, "Country code is 2 letters"),
  })
  .refine((d) => !d.payrollAccountActive || (d.payrollAccount && d.payrollAccount.length > 0), {
    message: "Payroll account # is required when activating payroll.",
    path: ["payrollAccount"],
  });

export async function updateCorporation(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = corpSchema.safeParse({
      corpLegalName: fd.get("corpLegalName"),
      businessNumber: fd.get("businessNumber"),
      hstAccount: (fd.get("hstAccount") as string) || null,
      payrollAccount: (fd.get("payrollAccount") as string) || null,
      payrollAccountActive: fd.get("payrollAccountActive") === "on",
      corpIncomeTaxAccount: (fd.get("corpIncomeTaxAccount") as string) || null,
      addressLine1: fd.get("addressLine1"),
      addressLine2: (fd.get("addressLine2") as string) || null,
      city: fd.get("city"),
      province: ((fd.get("province") as string) ?? "").toUpperCase(),
      postalCode: ((fd.get("postalCode") as string) ?? "").toUpperCase(),
      country: ((fd.get("country") as string) ?? "CA").toUpperCase(),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(email, parsed.data, "corporation", expectedVersion);
    if ("error" in result) return result;
    return { ok: "Corporation saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Payroll account (guided activation) 
const payrollActivateSchema = z.object({
  payrollAccount: z
    .string()
    .regex(/^\d{9}RP\d{4}$/, "Format must be: 9 digits + RP + 4 digits (e.g., 726742430RP0001)"),
});

export async function activatePayroll(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = payrollActivateSchema.safeParse({ payrollAccount: fd.get("payrollAccount") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    // Cross-check the first 9 digits match the BN on file
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (s && parsed.data.payrollAccount.slice(0, 9) !== s.businessNumber) {
      return { error: `First 9 digits must match your Business Number (${s.businessNumber}).` };
    }

    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(
      email,
      { payrollAccount: parsed.data.payrollAccount, payrollAccountActive: true },
      "payroll-activate",
      expectedVersion,
    );
    if ("error" in result) return result;
    return { ok: "Payroll account activated. Salary tool unlocked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Activation failed" };
  }
}

export async function deactivatePayroll(): Promise<ActionResult> {
  try {
    const email = await requireSession();
    // Refuse if any draft paycheque exists — deactivating only gates the
    // "New paycheque" UI button, not the edit/issue paths on existing drafts.
    // A draft issued after deactivation would leak through without the gate.
    const [openDraft] = await db
      .select({ id: paycheques.id })
      .from(paycheques)
      .where(eq(paycheques.status, "draft"))
      .limit(1);
    if (openDraft) {
      return {
        error: "Can't deactivate payroll while a draft paycheque is open. Issue it or delete it first.",
      };
    }
    const result = await commit(email, { payrollAccountActive: false }, "payroll-deactivate");
    if ("error" in result) return result;
    return { ok: "Payroll deactivated. Salary tool locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Deactivation failed" };
  }
}

//  Payer RZ account (guided activation) — T5 info-returns payer number
const payerRzActivateSchema = z.object({
  payerRzAccount: z
    .string()
    .regex(/^\d{9}RZ\d{4}$/, "Format must be: 9 digits + RZ + 4 digits (e.g., 726742430RZ0001)"),
});

export async function activatePayerRz(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = payerRzActivateSchema.safeParse({ payerRzAccount: fd.get("payerRzAccount") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (s && parsed.data.payerRzAccount.slice(0, 9) !== s.businessNumber) {
      return { error: `First 9 digits must match your Business Number (${s.businessNumber}).` };
    }

    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(
      email,
      { payerRzAccount: parsed.data.payerRzAccount, payerRzActive: true },
      "payer-rz-activate",
      expectedVersion,
    );
    if ("error" in result) return result;
    return { ok: "Info-returns (RZ) account activated. T5 slip generation unlocked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Activation failed" };
  }
}

export async function deactivatePayerRz(): Promise<ActionResult> {
  try {
    const email = await requireSession();
    // No draft-slip guard yet (file/void actions land in 4E-4). When they ship,
    // mirror the payroll pattern: refuse deactivation while a draft T5 slip exists.
    const result = await commit(email, { payerRzActive: false }, "payer-rz-deactivate");
    if ("error" in result) return result;
    return { ok: "Info-returns (RZ) deactivated. T5 slip generation locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Deactivation failed" };
  }
}

//  Director 
const directorSchema = z.object({
  directorLegalName: z.string().min(1, "Director name is required"),
  directorEmail: z.string().email("Invalid email"),
});

export async function updateDirector(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = directorSchema.safeParse({
      directorLegalName: fd.get("directorLegalName"),
      directorEmail: fd.get("directorEmail"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(email, parsed.data, "director", expectedVersion);
    if ("error" in result) return result;
    return { ok: "Director saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Fiscal & HST 
const fiscalSchema = z.object({
  fiscalYearEndMonth: z.coerce.number().int().min(1).max(12),
  fiscalYearEndDay: z.coerce.number().int().min(1).max(31),
  incorporationDate: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Incorporation date must be YYYY-MM-DD")
      .nullable(),
  ),
  hstFilingFrequency: z.enum(["annual", "quarterly", "monthly"]),
  hstRateBps: z.coerce.number().int().min(0).max(10000),
});

export async function updateFiscal(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = fiscalSchema.safeParse({
      fiscalYearEndMonth: fd.get("fiscalYearEndMonth"),
      fiscalYearEndDay: fd.get("fiscalYearEndDay"),
      incorporationDate: fd.get("incorporationDate") ?? undefined,
      hstFilingFrequency: fd.get("hstFilingFrequency"),
      hstRateBps: fd.get("hstRateBps"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    // FYE lock: once any fiscal-year-dependent row exists (dividends,
    // paycheques, invoices, shareholder-loan entries), refuse to change
    // fiscalYearEndMonth/Day. Those tables snapshot `fiscal_year` from the
    // current FYE at write time; silently changing it would leave stale,
    // wrong fiscal-year labels on historical rows (and invalidate T4A/T5
    // slip lookups). CRA requires consent under ITA s.249.1 anyway.
    const [current] = await db.select().from(settings).where(eq(settings.id, 1));
    const fyeChanged =
      current &&
      (current.fiscalYearEndMonth !== parsed.data.fiscalYearEndMonth ||
        current.fiscalYearEndDay !== parsed.data.fiscalYearEndDay);
    if (fyeChanged) {
      const [[anyDividend], [anyPaycheque], [anyInvoice], [anyLoan]] = await Promise.all([
        db.select({ id: dividends.id }).from(dividends).limit(1),
        db.select({ id: paycheques.id }).from(paycheques).limit(1),
        db.select({ id: invoices.id }).from(invoices).limit(1),
        db.select({ id: shareholderLoanEntries.id }).from(shareholderLoanEntries).limit(1),
      ]);
      if (anyDividend || anyPaycheque || anyInvoice || anyLoan) {
        return {
          error: "FYE change blocked — existing dividends, paycheques, invoices, or shareholder-loan entries already reference the current fiscal year. Changing FYE now would silently mislabel historical rows and break T4/T5/T4A slip lookups. ITA s.249.1 also requires CRA consent for a real FYE change.",
        };
      }
    }

    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(email, parsed.data, "fiscal", expectedVersion);
    if ("error" in result) return result;
    return { ok: "Fiscal & HST saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Personal tax (RRSP / FHSA room)
const personalTaxSchema = z.object({
  rrspRoomDollars: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().min(0).nullable(),
  ),
  fhsaRoomDollars: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().min(0).nullable(),
  ),
});

export async function updatePersonalTax(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = personalTaxSchema.safeParse({
      rrspRoomDollars: fd.get("rrspRoomDollars") ?? undefined,
      fhsaRoomDollars: fd.get("fhsaRoomDollars") ?? undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(
      email,
      {
        rrspRoomCents: parsed.data.rrspRoomDollars == null ? null : Math.round(parsed.data.rrspRoomDollars * 100),
        fhsaRoomCents: parsed.data.fhsaRoomDollars == null ? null : Math.round(parsed.data.fhsaRoomDollars * 100),
      },
      "personal-tax",
      expectedVersion,
    );
    if ("error" in result) return result;
    return { ok: "Personal tax saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Self-pay
const selfPaySchema = z.object({
  paymentStrategy: z.enum(["salary_only", "dividends_only", "blend"]),
  targetAnnualSalaryDollars: z.coerce.number().min(0),
  payCadence: z.enum(["weekly", "bi-weekly", "semi-monthly", "monthly"]),
  payDayRule: z.enum(["LAST_BUSINESS_DAY", "LAST_DAY_OF_MONTH", "FIRST_OF_MONTH", "DAY_15"]),
});

export async function updateSelfPay(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = selfPaySchema.safeParse({
      paymentStrategy: fd.get("paymentStrategy"),
      targetAnnualSalaryDollars: fd.get("targetAnnualSalaryDollars"),
      payCadence: fd.get("payCadence"),
      payDayRule: fd.get("payDayRule"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(
      email,
      {
        paymentStrategy: parsed.data.paymentStrategy,
        targetAnnualSalaryCents: Math.round(parsed.data.targetAnnualSalaryDollars * 100),
        payCadence: parsed.data.payCadence,
        payDayRule: parsed.data.payDayRule,
      },
      "self-pay",
      expectedVersion,
    );
    if ("error" in result) return result;
    return { ok: "Self-pay saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Branding & Invoicing 
const brandingSchema = z.object({
  brandPrimaryHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex like #6366F1"),
  brandAccentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex like #22D3EE"),
  invoicePrefix: z.string().min(1).max(8),
  nextInvoiceSeq: z.coerce.number().int().min(1),
});

export async function updateBranding(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = brandingSchema.safeParse({
      brandPrimaryHex: fd.get("brandPrimaryHex"),
      brandAccentHex: fd.get("brandAccentHex"),
      invoicePrefix: fd.get("invoicePrefix"),
      nextInvoiceSeq: fd.get("nextInvoiceSeq"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(email, parsed.data, "branding", expectedVersion);
    if ("error" in result) return result;
    return { ok: "Branding saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Corp tax configuration — drives T2 estimates across the app.
//  Opening pool balances are meaningful only before any T2 is filed; once a
//  filed return exists, its closing columns override what's in settings.
//  We still accept writes (for future "restoring from backup" style edits),
//  but refuse to change them while any T2 return is filed — same rationale
//  as the FYE lock, to prevent silent rewrites of closed-year history.
const corpTaxSchema = z.object({
  isCcpc: z.coerce.boolean(),
  priorYearAaiiDollars: z.coerce.number().min(0).max(10_000_000),
  ontarioGeneralRatePercent: z.coerce.number().min(0).max(50),
  openingGripDollars: z.coerce.number().min(0).max(100_000_000),
  openingErdtohDollars: z.coerce.number().min(0).max(100_000_000),
  openingNerdtohDollars: z.coerce.number().min(0).max(100_000_000),
  openingCdaDollars: z.coerce.number().min(0).max(100_000_000),
  openingRetainedEarningsDollars: z.coerce.number().min(0).max(100_000_000),
});

export async function updateCorpTax(
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = corpTaxSchema.safeParse({
      isCcpc: fd.get("isCcpc") === "on",
      priorYearAaiiDollars: fd.get("priorYearAaiiDollars"),
      ontarioGeneralRatePercent: fd.get("ontarioGeneralRatePercent"),
      openingGripDollars: fd.get("openingGripDollars"),
      openingErdtohDollars: fd.get("openingErdtohDollars"),
      openingNerdtohDollars: fd.get("openingNerdtohDollars"),
      openingCdaDollars: fd.get("openingCdaDollars"),
      openingRetainedEarningsDollars: fd.get("openingRetainedEarningsDollars"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const [current] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!current) return { error: "Settings not seeded." };

    const newOpenings = {
      openingGripCents: Math.round(parsed.data.openingGripDollars * 100),
      openingErdtohCents: Math.round(parsed.data.openingErdtohDollars * 100),
      openingNerdtohCents: Math.round(parsed.data.openingNerdtohDollars * 100),
      openingCdaCents: Math.round(parsed.data.openingCdaDollars * 100),
      openingRetainedEarningsCents: Math.round(parsed.data.openingRetainedEarningsDollars * 100),
    };
    const openingsChanged =
      current.openingGripCents !== newOpenings.openingGripCents ||
      current.openingErdtohCents !== newOpenings.openingErdtohCents ||
      current.openingNerdtohCents !== newOpenings.openingNerdtohCents ||
      current.openingCdaCents !== newOpenings.openingCdaCents ||
      current.openingRetainedEarningsCents !== newOpenings.openingRetainedEarningsCents;
    if (openingsChanged) {
      const [anyFiled] = await db
        .select({ id: t2Returns.id })
        .from(t2Returns)
        .where(eq(t2Returns.status, "filed"))
        .limit(1);
      if (anyFiled) {
        return {
          error:
            "Opening pool balances are locked — a T2 return has already been filed. Closing balances on filed returns are now the source of truth.",
        };
      }
    }

    const expectedVersion = parseExpectedVersion(fd);
    const result = await commit(
      email,
      {
        isCcpc: parsed.data.isCcpc,
        priorYearAaiiCents: Math.round(parsed.data.priorYearAaiiDollars * 100),
        ontarioGeneralRateBps: Math.round(parsed.data.ontarioGeneralRatePercent * 100),
        ...newOpenings,
      },
      "corp-tax",
      expectedVersion,
    );
    if ("error" in result) return result;
    return { ok: "Corporate tax configuration saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}
