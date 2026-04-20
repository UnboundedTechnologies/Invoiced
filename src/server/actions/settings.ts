"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  settings,
  auditLog,
  dividends,
  paycheques,
  invoices,
  shareholderLoanEntries,
} from "@/lib/db/schema";
import { auth } from "../../../auth";

type ActionResult = { ok?: string; error?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function commit(
  email: string,
  patch: Partial<typeof settings.$inferInsert>,
  section: string,
): Promise<void> {
  await db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, 1));
  await db.insert(auditLog).values({
    actorEmail: email,
    action: "update",
    target: `settings:${section}`,
    metadata: patch as Record<string, unknown>,
  });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
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
    await commit(email, parsed.data, "corporation");
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

    await commit(
      email,
      { payrollAccount: parsed.data.payrollAccount, payrollAccountActive: true },
      "payroll-activate",
    );
    return { ok: "Payroll account activated. Salary tool unlocked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Activation failed" };
  }
}

export async function deactivatePayroll(): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await commit(email, { payrollAccountActive: false }, "payroll-deactivate");
    return { ok: "Payroll deactivated. Salary tool locked." };
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
    await commit(email, parsed.data, "director");
    return { ok: "Director saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

//  Fiscal & HST 
const fiscalSchema = z.object({
  fiscalYearEndMonth: z.coerce.number().int().min(1).max(12),
  fiscalYearEndDay: z.coerce.number().int().min(1).max(31),
  hstFilingFrequency: z.enum(["annual", "quarterly", "monthly"]),
  hstRateBps: z.coerce.number().int().min(0).max(10000),
});

export async function updateFiscal(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = fiscalSchema.safeParse({
      fiscalYearEndMonth: fd.get("fiscalYearEndMonth"),
      fiscalYearEndDay: fd.get("fiscalYearEndDay"),
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

    await commit(email, parsed.data, "fiscal");
    return { ok: "Fiscal & HST saved." };
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
    await commit(
      email,
      {
        paymentStrategy: parsed.data.paymentStrategy,
        targetAnnualSalaryCents: Math.round(parsed.data.targetAnnualSalaryDollars * 100),
        payCadence: parsed.data.payCadence,
        payDayRule: parsed.data.payDayRule,
      },
      "self-pay",
    );
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
    await commit(email, parsed.data, "branding");
    return { ok: "Branding saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}
