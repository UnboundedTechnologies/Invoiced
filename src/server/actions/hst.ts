"use server";

import { z } from "zod";
import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  hstReturns,
  invoices,
  expenses,
  settings,
  deadlines,
  auditLog,
  type HstReturn,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
import {
  aggregateRegular,
  aggregateQuickMethod,
  hstFilingDueDate,
  hstPeriodFor,
  ONTARIO_SERVICE_QM_RATE_BPS,
  type InvoiceSlice,
  type ExpenseSlice,
} from "@/lib/hst";
import { fiscalYearFor } from "@/lib/utils";
import { TAXABLE_SUPPLY_STATUSES } from "@/lib/queries/invoice-slices";
import { HstReturnPDF } from "@/lib/hst-pdf";
import { getBannerDataUri } from "@/lib/pdf-banner";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";

type ActionResult = { ok?: string; error?: string; pdfBase64?: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

function revalidate(fiscalYear?: number) {
  revalidatePath("/hst");
  if (fiscalYear !== undefined) revalidatePath(`/hst/${fiscalYear}`);
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

async function getFye() {
  const [s] = await db
    .select({ m: settings.fiscalYearEndMonth, d: settings.fiscalYearEndDay })
    .from(settings)
    .where(eq(settings.id, 1));
  return { fyeMonth: s?.m ?? 12, fyeDay: s?.d ?? 31 };
}

// ——————————————————————————————————————————————————————————————
// Shared helper: filing-lock guard used by expenses.ts + invoices.ts
// ——————————————————————————————————————————————————————————————

/**
 * Returns a user-facing error string if the given ISO date falls inside a
 * filed HST return period, or null if the period is still open.
 *
 * Called from every mutation in expenses.ts and the destructive paths in
 * invoices.ts. Keeps the cross-feature dependency single-direction so
 * expenses/invoices don't need to know the HST schema shape.
 */
export async function hstPeriodLockError(iso: string): Promise<string | null> {
  await requireSession();
  const { fyeMonth, fyeDay } = await getFye();
  const fiscalYear = fiscalYearFor(iso, fyeMonth, fyeDay);
  const [r] = await db
    .select({ status: hstReturns.status })
    .from(hstReturns)
    .where(eq(hstReturns.fiscalYear, fiscalYear))
    .limit(1);
  if (r?.status === "filed") {
    return `HST return for FY ${fiscalYear} is filed. Unfile or correct via a next-period adjustment.`;
  }
  return null;
}

// ——————————————————————————————————————————————————————————————
// Live aggregation: used by server-rendered detail page + actions below
// ——————————————————————————————————————————————————————————————

type LiveAggregateArgs = { fiscalYear: number; isFirstQmFy: boolean };
type LiveAggregateResult = {
  period: { start: string; end: string };
  regular: ReturnType<typeof aggregateRegular>;
  quick: ReturnType<typeof aggregateQuickMethod>;
  priorFourFyRevenueCents: number;
  dueDate: string;
};

export async function loadLiveAggregate({
  fiscalYear,
  isFirstQmFy,
}: LiveAggregateArgs): Promise<LiveAggregateResult> {
  const { fyeMonth, fyeDay } = await getFye();
  const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);

  const invRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      subtotalCents: invoices.subtotalCents,
      hstCents: invoices.hstCents,
      totalCents: invoices.totalCents,
      status: invoices.status,
    })
    .from(invoices);
  const expRows = await db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      vendor: expenses.vendor,
      category: expenses.category,
      subtotalCents: expenses.subtotalCents,
      hstPaidCents: expenses.hstPaidCents,
      totalCents: expenses.totalCents,
    })
    .from(expenses);

  const invoiceSlices: InvoiceSlice[] = invRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    issueDate: r.issueDate,
    subtotalCents: r.subtotalCents,
    hstCents: r.hstCents,
    totalCents: r.totalCents,
    status: r.status,
  }));
  const expenseSlices: ExpenseSlice[] = expRows.map((r) => ({
    id: r.id,
    expenseDate: r.expenseDate,
    vendor: r.vendor,
    category: r.category,
    subtotalCents: r.subtotalCents,
    hstPaidCents: r.hstPaidCents,
    totalCents: r.totalCents,
  }));

  const regular = aggregateRegular({ invoices: invoiceSlices, expenses: expenseSlices, period });
  const quick = aggregateQuickMethod({
    invoices: invoiceSlices,
    expenses: expenseSlices,
    period,
    isFirstQmFy,
  });

  // Prior 4 FYs' worldwide taxable supplies — drives QM eligibility.
  // First-year corp → prior = 0 → eligible. Uses invoice issue-date FY buckets.
  const firstPriorFy = fiscalYear - 4;
  const priorStart = hstPeriodFor(firstPriorFy, fyeMonth, fyeDay).start;
  const priorEnd = hstPeriodFor(fiscalYear - 1, fyeMonth, fyeDay).end;
  const [priorAgg] = await db
    .select({
      total: drizzleSql<number>`COALESCE(SUM(${invoices.subtotalCents}), 0)::int`,
    })
    .from(invoices)
    .where(
      and(
        drizzleSql`${invoices.issueDate} >= ${priorStart}`,
        drizzleSql`${invoices.issueDate} <= ${priorEnd}`,
        inArray(invoices.status, [...TAXABLE_SUPPLY_STATUSES]),
      ),
    );
  const priorFourFyRevenueCents = Number(priorAgg?.total ?? 0);

  return {
    period,
    regular,
    quick,
    priorFourFyRevenueCents,
    dueDate: hstFilingDueDate(period.end),
  };
}

// ——————————————————————————————————————————————————————————————
// Upsert draft return (idempotent; called on detail-page load if missing)
// ——————————————————————————————————————————————————————————————

export async function upsertDraftReturn(fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const { fyeMonth, fyeDay } = await getFye();
    const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);

    const [existing] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear))
      .limit(1);
    if (existing) return { ok: "Draft return exists." };

    const dueIso = hstFilingDueDate(period.end);
    await db.batch([
      db.insert(hstReturns).values({
        fiscalYear,
        periodStart: period.start,
        periodEnd: period.end,
        method: "regular",
        status: "draft",
      }),
      db
        .insert(deadlines)
        .values({
          title: `HST return — FY ${fiscalYear}`,
          description: `Annual HST return filing + payment due.`,
          dueDate: dueIso,
          category: "hst",
          sourceKey: `hst:${fiscalYear}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `hst_returns:${fiscalYear}`,
        metadata: { fiscalYear, periodStart: period.start, periodEnd: period.end, dueDate: dueIso },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: "Draft return created." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// Toggle method / first-year flag (blocked once filed)
// ——————————————————————————————————————————————————————————————

const methodSchema = z.enum(["regular", "quick"]);

export async function setMethod(fiscalYear: number, method: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = methodSchema.safeParse(method);
    if (!parsed.success) return { error: "Invalid method." };
    const [existing] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
    if (!existing) return { error: "Return not found." };
    if (existing.status === "filed") return { error: "Return is filed. Method can't change." };

    await db.batch([
      db
        .update(hstReturns)
        .set({
          method: parsed.data,
          quickRateBps: parsed.data === "quick" ? ONTARIO_SERVICE_QM_RATE_BPS : null,
          updatedAt: new Date(),
        })
        .where(eq(hstReturns.fiscalYear, fiscalYear)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `hst_returns:${fiscalYear}:method`,
        metadata: { method: parsed.data },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: `Method set to ${parsed.data === "quick" ? "Quick Method" : "Regular"}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function setFirstQmFy(
  fiscalYear: number,
  value: boolean,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
    if (!existing) return { error: "Return not found." };
    if (existing.status === "filed") return { error: "Return is filed. Flag can't change." };

    await db.batch([
      db
        .update(hstReturns)
        .set({ isFirstQmFy: value, updatedAt: new Date() })
        .where(eq(hstReturns.fiscalYear, fiscalYear)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `hst_returns:${fiscalYear}:isFirstQmFy`,
        metadata: { value },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: value ? "First-year QM credit enabled." : "First-year QM credit disabled." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// File return — freeze snapshot, delete the deadline, lock mutations
// ——————————————————————————————————————————————————————————————

const fileSchema = z.object({
  craConfirmationNumber: z.string().trim().min(1, "CRA confirmation number required").max(50),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Filed date required"),
});

export async function fileReturn(
  fiscalYear: number,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = fileSchema.safeParse({
      craConfirmationNumber: fd.get("craConfirmationNumber"),
      filedAt: fd.get("filedAt"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const expectedVersion = parseExpectedVersion(fd);
    const [existing] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
    if (!existing) return { error: "Return not found." };
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      return { error: versionConflictError("HST return", expectedVersion, existing.version) };
    }
    if (existing.status === "filed") return { error: "Return is already filed." };

    // Recompute at filing time from the authoritative live data.
    const live = await loadLiveAggregate({
      fiscalYear,
      isFirstQmFy: existing.isFirstQmFy,
    });

    const snap =
      existing.method === "quick"
        ? {
            line101Cents: live.quick.line101Cents,
            line103Cents: live.quick.line103Cents,
            line105Cents: live.quick.line105Cents,
            line106Cents: live.quick.line106CapitalCents,
            line107Cents: live.quick.line107Cents,
            line108Cents: live.quick.line108Cents,
            line109Cents: live.quick.line109Cents,
            quickCreditCents: live.quick.quickCreditCents,
            quickRateBps: ONTARIO_SERVICE_QM_RATE_BPS,
          }
        : {
            line101Cents: live.regular.line101Cents,
            line103Cents: live.regular.line103Cents,
            line105Cents: live.regular.line105Cents,
            line106Cents: live.regular.line106RawCents,
            line107Cents: live.regular.line107Cents,
            line108Cents: live.regular.line108Cents,
            line109Cents: live.regular.line109Cents,
            quickCreditCents: null,
            quickRateBps: null,
          };

    const filedAtTs = new Date(parsed.data.filedAt + "T00:00:00Z");

    const updateWhere = expectedVersion !== null
      ? and(eq(hstReturns.fiscalYear, fiscalYear), eq(hstReturns.version, expectedVersion))
      : eq(hstReturns.fiscalYear, fiscalYear);
    const [updated] = await db
      .update(hstReturns)
      .set({
        status: "filed",
        ...snap,
        version: bumpVersion(),
        craConfirmationNumber: parsed.data.craConfirmationNumber,
        filedAt: filedAtTs,
        filedBy: email,
        updatedAt: new Date(),
      })
      .where(updateWhere)
      .returning({ version: hstReturns.version });
    if (!updated) {
      const [current] = await db
        .select({ version: hstReturns.version })
        .from(hstReturns)
        .where(eq(hstReturns.fiscalYear, fiscalYear));
      if (!current) return { error: "Return was deleted in another tab." };
      return { error: versionConflictError("HST return", expectedVersion ?? existing.version, current.version) };
    }

    await db.batch([
      // Remove the pending deadline now that it's filed (match on sourceKey
      // since the title could be edited by the user)
      db.delete(deadlines).where(eq(deadlines.sourceKey, `hst:${fiscalYear}`)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `hst_returns:${fiscalYear}:file`,
        metadata: {
          method: existing.method,
          isFirstQmFy: existing.isFirstQmFy,
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: parsed.data.filedAt,
          snapshot: snap,
          fromVersion: existing.version,
          toVersion: updated.version,
        },
      }),
    ]);

    revalidate(fiscalYear);
    return { ok: "Return filed and locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// Unfile return — escape hatch when CRA needs a correction. Toggles status
// filed → draft, re-creates the hst:<fy> deadline (file deletes it), audit
// logs the prior CRA confirmation # + filed date as the trail. Frozen line
// snapshot stays intact (audit history); refile overwrites it.
//
// Mirrors the unfileT1Return pattern (commit 3a23781). HST returns are
// independent FY-to-FY (no chain), so no later-FY guard is needed.
// ——————————————————————————————————————————————————————————————

export async function unfileHstReturn(fiscalYear: number, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
    if (!existing) return { error: "Return not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("HST return", expectedVersion, existing.version) };
    }
    if (existing.status !== "filed") return { error: "Return is not filed; nothing to unfile." };

    const dueIso = hstFilingDueDate(existing.periodEnd);

    const [updated] = await db
      .update(hstReturns)
      .set({ status: "draft", version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(hstReturns.fiscalYear, fiscalYear), eq(hstReturns.version, expectedVersion)))
      .returning({ version: hstReturns.version });
    if (!updated) {
      const [current] = await db
        .select({ version: hstReturns.version })
        .from(hstReturns)
        .where(eq(hstReturns.fiscalYear, fiscalYear));
      if (!current) return { error: "Return was deleted in another tab." };
      return { error: versionConflictError("HST return", expectedVersion, current.version) };
    }

    await db.batch([
      db
        .insert(deadlines)
        .values({
          title: `HST return — FY ${fiscalYear}`,
          description: `Annual HST return filing + payment due.`,
          dueDate: dueIso,
          category: "hst",
          sourceKey: `hst:${fiscalYear}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `hst_returns:${fiscalYear}:unfile`,
        metadata: {
          fiscalYear,
          previousCraConfirmationNumber: existing.craConfirmationNumber,
          previousFiledAt: existing.filedAt,
          previousLine109Cents: existing.line109Cents,
          fromVersion: existing.version,
          toVersion: updated.version,
        },
      }),
    ]);

    revalidate(fiscalYear);
    return { ok: "HST return unfiled. Make corrections, then re-file with a new CRA confirmation number." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unfile failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// PDF generation — returns base64 so the client can download it
// ——————————————————————————————————————————————————————————————

export async function generateHstPdf(fiscalYear: number): Promise<ActionResult> {
  try {
    await requireSession();
    const [row] = await db
      .select()
      .from(hstReturns)
      .where(eq(hstReturns.fiscalYear, fiscalYear));
    if (!row) return { error: "Return not found." };

    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings not seeded." };

    const live = await loadLiveAggregate({ fiscalYear, isFirstQmFy: row.isFirstQmFy });

    // When filed, prefer the frozen snapshot. When draft, render live numbers.
    const lines =
      row.status === "filed"
        ? {
            line101: row.line101Cents ?? 0,
            line103: row.line103Cents ?? 0,
            line105: row.line105Cents ?? 0,
            line106: row.line106Cents ?? 0,
            line107: row.line107Cents ?? 0,
            line108: row.line108Cents ?? 0,
            line109: row.line109Cents ?? 0,
            quickCredit: row.quickCreditCents ?? 0,
          }
        : row.method === "quick"
          ? {
              line101: live.quick.line101Cents,
              line103: live.quick.line103Cents,
              line105: live.quick.line105Cents,
              line106: live.quick.line106CapitalCents,
              line107: live.quick.line107Cents,
              line108: live.quick.line108Cents,
              line109: live.quick.line109Cents,
              quickCredit: live.quick.quickCreditCents,
            }
          : {
              line101: live.regular.line101Cents,
              line103: live.regular.line103Cents,
              line105: live.regular.line105Cents,
              line106: live.regular.line106RawCents,
              line107: live.regular.line107Cents,
              line108: live.regular.line108Cents,
              line109: live.regular.line109Cents,
              quickCredit: 0,
            };

    const bannerDataUri = await getBannerDataUri();
    const buffer = await renderToBuffer(
      HstReturnPDF({
        fiscalYear,
        period: live.period,
        dueDate: live.dueDate,
        method: row.method,
        status: row.status,
        isFirstQmFy: row.isFirstQmFy,
        craConfirmationNumber: row.craConfirmationNumber,
        filedAt: row.filedAt ? row.filedAt.toISOString().slice(0, 10) : null,
        lines,
        settings: {
          corpLegalName: s.corpLegalName,
          hstAccount: s.hstAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          directorEmail: s.directorEmail,
          brandPrimaryHex: s.brandPrimaryHex,
          brandAccentHex: s.brandAccentHex,
        },
        bannerDataUri,
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: await requireSession(),
      action: "download",
      target: `hst_returns:${fiscalYear}:pdf`,
      metadata: { status: row.status, method: row.method },
    });

    return { ok: "PDF generated.", pdfBase64 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

// ——————————————————————————————————————————————————————————————
// List query — used by the index page
// ——————————————————————————————————————————————————————————————

export async function listReturns(): Promise<HstReturn[]> {
  await requireSession();
  return db.select().from(hstReturns).orderBy(desc(hstReturns.fiscalYear));
}
