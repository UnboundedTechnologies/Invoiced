"use server";

import { z } from "zod";
import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  t2Returns,
  ccaPools,
  taxPools,
  invoices,
  expenses,
  paycheques,
  dividends,
  settings,
  deadlines,
  auditLog,
  type T2Return,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
import { fiscalYearFor } from "@/lib/utils";
import { bumpVersion, parseExpectedVersion, versionConflictError } from "@/lib/optimistic-lock";
import { hstPeriodFor } from "@/lib/hst";
import { TAXABLE_SUPPLY_STATUSES } from "@/lib/queries/invoice-slices";
import { operatingExpensesForT2 } from "@/lib/dashboard-metrics";
import { estimateT2Detailed, t2FilingDueDate, type T2Result } from "@/lib/t2";
import {
  buildCcaPools,
  totalCcaClaimed,
  CLASS_RATE_BPS,
  type CcaAddition,
  type CcaClass,
  type CcaOpening,
  type CcaPoolRow,
} from "@/lib/cca";
import {
  computeGrip,
  computeRdtoh,
  computeCda,
  type GripResult,
  type RdtohResult,
  type CdaResult,
} from "@/lib/tax-pools";
import { getBannerDataUri } from "@/lib/pdf-banner";
import { T2PrepPDF } from "@/lib/t2-pdf";
import { toGifiCsv } from "@/lib/gifi-export";

type ActionResult = {
  ok?: string;
  error?: string;
  pdfBase64?: string;
  csv?: string;
  filename?: string;
};

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

async function getFye() {
  const [s] = await db
    .select({ m: settings.fiscalYearEndMonth, d: settings.fiscalYearEndDay })
    .from(settings)
    .where(eq(settings.id, 1));
  return { fyeMonth: s?.m ?? 12, fyeDay: s?.d ?? 31 };
}

function revalidate(fiscalYear?: number) {
  revalidatePath("/corp-tax");
  if (fiscalYear !== undefined) revalidatePath(`/corp-tax/${fiscalYear}`);
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

// ————————————————————————————————————————————————————————————————
// Shared helper: filing-lock guard used by expenses/invoices/paycheques/
// dividends/shareholder-loan. T2 is strictly stronger than HST — a filed
// T2 locks every row type, not just those in the HST aggregator.
// ————————————————————————————————————————————————————————————————

export async function t2PeriodLockError(iso: string): Promise<string | null> {
  await requireSession();
  const { fyeMonth, fyeDay } = await getFye();
  const fiscalYear = fiscalYearFor(iso, fyeMonth, fyeDay);
  const [r] = await db
    .select({ status: t2Returns.status })
    .from(t2Returns)
    .where(eq(t2Returns.fiscalYear, fiscalYear))
    .limit(1);
  if (r?.status === "filed") {
    return `T2 return for FY ${fiscalYear} is filed. Corrections route through CRA form T2A or the next-year return.`;
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// Resolve opening pools for a given FY.
//
// Rule: prior-FY filed t2_returns.*ClosingCents is the authoritative source.
// If no prior filed return exists, fall back to settings.opening* — which
// represents the absolute baseline (zero for Saïd's blank-slate corp; only
// non-zero when migrating from an existing entity).
//
// Known limitation: multi-year draft chains (e.g. FY2027 draft exists while
// FY2026 draft exists) are not recursively resolved — each draft just sees
// settings.opening* or the nearest filed return's closing. When Saïd's data
// grows into multi-year drafts before the first filing (unlikely in
// practice), extend this to recursively live-compute intermediate FYs.
// ————————————————————————————————————————————————————————————————

type PoolOpenings = {
  gripCents: number;
  erdtohCents: number;
  nerdtohCents: number;
  cdaCents: number;
  ccaOpenings: CcaOpening[];
};

async function resolveOpeningPools(fiscalYear: number): Promise<PoolOpenings> {
  // Look back for the most recent FILED T2 with a strictly smaller FY.
  const [prior] = await db
    .select()
    .from(t2Returns)
    .where(
      and(
        drizzleSql`${t2Returns.fiscalYear} < ${fiscalYear}`,
        eq(t2Returns.status, "filed"),
      ),
    )
    .orderBy(desc(t2Returns.fiscalYear))
    .limit(1);

  if (prior) {
    // Prior-FY closing = this-FY opening. Use frozen snapshot.
    // Also fetch the prior-FY cca_pools closing rows for CCA opening UCC.
    const priorCca = await db
      .select()
      .from(ccaPools)
      .where(eq(ccaPools.fiscalYear, prior.fiscalYear));
    return {
      gripCents: prior.gripClosingCents ?? 0,
      erdtohCents: prior.erdtohClosingCents ?? 0,
      nerdtohCents: prior.nerdtohClosingCents ?? 0,
      cdaCents: prior.cdaClosingCents ?? 0,
      ccaOpenings: priorCca.map((p) => ({
        class: p.ccaClass,
        classRateBps: p.classRateBps,
        openingUccCents: p.closingUccCents,
      })),
    };
  }

  // No prior filed return — use settings.opening* (blank-slate corp).
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  return {
    gripCents: s?.openingGripCents ?? 0,
    erdtohCents: s?.openingErdtohCents ?? 0,
    nerdtohCents: s?.openingNerdtohCents ?? 0,
    cdaCents: s?.openingCdaCents ?? 0,
    ccaOpenings: [], // no prior UCC pools to carry forward
  };
}

// ————————————————————————————————————————————————————————————————
// Live aggregation — drives the /corp-tax/[fy] detail page and the filing
// snapshot. Recomputes every input from source-of-truth tables; idempotent
// across calls while nothing has changed.
// ————————————————————————————————————————————————————————————————

export type LiveT2Aggregate = {
  fiscalYear: number;
  period: { start: string; end: string };
  dueDate: string;
  isCcpc: boolean;
  priorYearAaiiCents: number;
  // P&L inputs (already adjusted per the rules — meals 50%, capital excluded)
  inputs: {
    periodStart: string;
    periodEnd: string;
    isCcpc: boolean;
    revenueCents: number;
    operatingExpensesCents: number;
    salaryCents: number;
    employerCppCents: number;
    ccaClaimedCents: number;
    priorYearAaiiCents: number;
  };
  result: T2Result;
  ccaRows: CcaPoolRow[];
  grip: GripResult;
  rdtoh: RdtohResult;
  cda: CdaResult;
  // Activity in this FY (surfaced in the detail-page accordions)
  activity: {
    invoiceCount: number;
    expenseCount: number;
    paychequeCount: number;
    dividendCount: number;
    eligibleDividendsPaidCents: number;
    nonEligibleDividendsPaidCents: number;
  };
  warnings: string[];
};

export async function loadLiveT2Aggregate(fiscalYear: number): Promise<LiveT2Aggregate> {
  const { fyeMonth, fyeDay } = await getFye();
  const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay); // same FY period as HST — reused

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const ontarioGeneralRateBps = s?.ontarioGeneralRateBps ?? 1_150;

  // Per-return overrides may diverge from global settings (e.g. Saïd had
  // passive income in a prior year but toggles the grind off for this FY
  // review). If a draft row exists we read those, else fall back to settings.
  const [existingRow] = await db
    .select()
    .from(t2Returns)
    .where(eq(t2Returns.fiscalYear, fiscalYear));
  const isCcpc = existingRow?.isCcpc ?? s?.isCcpc ?? true;
  const priorYearAaiiCents =
    existingRow?.priorYearAaiiCents ?? s?.priorYearAaiiCents ?? 0;

  // ——— Gather in-period rows ———
  const [invRows, expRows, payRows, divRows] = await Promise.all([
    db.select().from(invoices).where(
      and(
        drizzleSql`${invoices.issueDate} >= ${period.start}`,
        drizzleSql`${invoices.issueDate} <= ${period.end}`,
        inArray(invoices.status, [...TAXABLE_SUPPLY_STATUSES]),
      ),
    ),
    db.select().from(expenses).where(eq(expenses.fiscalYear, fiscalYear)),
    db
      .select()
      .from(paycheques)
      .where(
        and(
          eq(paycheques.status, "issued"),
          drizzleSql`${paycheques.payDate} >= ${period.start}`,
          drizzleSql`${paycheques.payDate} <= ${period.end}`,
        ),
      ),
    db.select().from(dividends).where(eq(dividends.fiscalYear, fiscalYear)),
  ]);

  // ——— P&L inputs ———
  const revenueCents = invRows.reduce((a, i) => a + i.subtotalCents, 0);
  const operatingExpensesCents = operatingExpensesForT2(
    expRows.map((e) => ({
      category: e.category,
      subtotalCents: e.subtotalCents,
      totalCents: e.totalCents,
    })),
  );
  const salaryCents = payRows.reduce((a, p) => a + p.grossCents, 0);
  const employerCppCents = payRows.reduce(
    (a, p) => a + p.employerCppCents + p.employerCpp2Cents,
    0,
  );

  // ——— CCA pools ———
  const openings = await resolveOpeningPools(fiscalYear);
  const additions: CcaAddition[] = [];
  for (const e of expRows) {
    if (e.category !== "capital_asset") continue;
    const cca = e.cca as Record<string, unknown> | null;
    if (!cca) continue;
    const ccaClass = String(cca.class ?? "other") as CcaClass;
    const classRateBps = Math.round(
      Number(cca.classRate ?? 0) * 100, // expense form stores percent as number (20 = 20%)
    ) || CLASS_RATE_BPS[ccaClass];
    additions.push({
      class: ccaClass,
      classRateBps,
      acquisitionCostCents: Number(cca.acquisitionCostCents ?? e.subtotalCents),
      businessUsePercent: Number(cca.businessUsePercent ?? 100),
      halfYearRuleApplies: Boolean(cca.halfYearRuleApplies ?? true),
      description:
        typeof cca.description === "string" && cca.description.length > 0
          ? cca.description
          : null,
    });
  }

  // Pull per-class claim fractions from any existing cca_pools row for this FY
  // (user may have tweaked via setCcaClaimFraction). Default 10000 (100%).
  const existingCcaRows = await db
    .select()
    .from(ccaPools)
    .where(eq(ccaPools.fiscalYear, fiscalYear));
  const claimFractionBpsPerClass: Partial<Record<CcaClass, number>> = {};
  for (const r of existingCcaRows) {
    claimFractionBpsPerClass[r.ccaClass] = r.claimFractionBps;
  }

  const ccaRows = buildCcaPools({
    openingPools: openings.ccaOpenings,
    additions,
    claimFractionBpsPerClass,
  });
  const ccaClaimedCents = totalCcaClaimed(ccaRows);

  // ——— T2 math ———
  const inputs = {
    periodStart: period.start,
    periodEnd: period.end,
    isCcpc,
    revenueCents,
    operatingExpensesCents,
    salaryCents,
    employerCppCents,
    ccaClaimedCents,
    priorYearAaiiCents,
  };
  const result = estimateT2Detailed({
    ...inputs,
    ontarioGeneralRateBps,
  });

  // ——— Dividend splits for RDTOH ordering ———
  const eligiblePaid = divRows
    .filter((d) => d.eligible && d.paidDate !== null)
    .reduce((a, d) => a + d.amountCents, 0);
  const nonEligiblePaid = divRows
    .filter((d) => !d.eligible && d.paidDate !== null)
    .reduce((a, d) => a + d.amountCents, 0);

  // ——— Tax pools ———
  // GRIP addition input = full-rate income (already computed in result).
  const grip = computeGrip({
    openingCents: openings.gripCents,
    fullRateIncomeCents: result.fullRateIncomeCents,
    eligibleDividendsPaidCents: eligiblePaid,
  });

  // AAII / Part IV / capital gain hooks are 0 for Saïd FY2026 but the wiring
  // is in place for when portfolio investment income starts flowing.
  // Populate from settings/future UI when that day comes; for now hardcode 0
  // with a TODO so the location is obvious.
  // TODO(4C-v2): pull investment-income figures from a dedicated investments
  // table once portfolio holdings exist.
  const rdtoh = computeRdtoh({
    erdtohOpeningCents: openings.erdtohCents,
    nerdtohOpeningCents: openings.nerdtohCents,
    aaiiCents: 0,
    partIVOnEligibleCents: 0,
    partIVOnNonEligibleCents: 0,
    eligibleDividendsPaidCents: eligiblePaid,
    nonEligibleDividendsPaidCents: nonEligiblePaid,
  });

  const cda = computeCda({
    openingCents: openings.cdaCents,
    capitalGainsNetCents: 0,
    capitalDividendsReceivedCents: 0,
    lifeInsuranceProceedsCents: 0,
    capitalDividendsElectedCents: 0,
  });

  const warnings = [
    ...result.warnings,
    ...grip.warnings,
    ...rdtoh.warnings,
    ...cda.warnings,
    ...ccaRows.flatMap((r) => r.warnings),
  ];

  return {
    fiscalYear,
    period,
    dueDate: t2FilingDueDate(period.end),
    isCcpc,
    priorYearAaiiCents,
    inputs,
    result,
    ccaRows,
    grip,
    rdtoh,
    cda,
    activity: {
      invoiceCount: invRows.length,
      expenseCount: expRows.length,
      paychequeCount: payRows.length,
      dividendCount: divRows.length,
      eligibleDividendsPaidCents: eligiblePaid,
      nonEligibleDividendsPaidCents: nonEligiblePaid,
    },
    warnings,
  };
}

// ————————————————————————————————————————————————————————————————
// Upsert draft — creates the row if missing, idempotent otherwise
// ————————————————————————————————————————————————————————————————

export async function upsertDraftT2Return(fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const { fyeMonth, fyeDay } = await getFye();
    const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);

    const [existing] = await db
      .select()
      .from(t2Returns)
      .where(eq(t2Returns.fiscalYear, fiscalYear))
      .limit(1);
    if (existing) return { ok: "Draft T2 return exists." };

    const [s] = await db.select().from(settings).where(eq(settings.id, 1));

    await db.batch([
      db.insert(t2Returns).values({
        fiscalYear,
        periodStart: period.start,
        periodEnd: period.end,
        status: "draft",
        isCcpc: s?.isCcpc ?? true,
        priorYearAaiiCents: s?.priorYearAaiiCents ?? 0,
      }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "create",
        target: `t2_returns:${fiscalYear}`,
        metadata: { fiscalYear, periodStart: period.start, periodEnd: period.end },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: "Draft T2 return created." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Per-return toggles / setters (blocked once filed)
// ————————————————————————————————————————————————————————————————

async function assertDraft(fiscalYear: number) {
  const [row] = await db
    .select({ status: t2Returns.status })
    .from(t2Returns)
    .where(eq(t2Returns.fiscalYear, fiscalYear));
  if (!row) throw new Error("T2 return not found.");
  if (row.status === "filed") throw new Error("T2 return is filed. Open a new FY to make changes.");
}

export async function setIsCcpc(
  fiscalYear: number,
  value: boolean,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await assertDraft(fiscalYear);
    await db.batch([
      db
        .update(t2Returns)
        .set({ isCcpc: value, updatedAt: new Date() })
        .where(eq(t2Returns.fiscalYear, fiscalYear)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `t2_returns:${fiscalYear}:isCcpc`,
        metadata: { value },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: value ? "Marked as CCPC." : "Marked as non-CCPC." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

const aaiiSchema = z.object({
  amountDollars: z.coerce.number().min(0, "Can't be negative").max(10_000_000),
});

export async function setPriorYearAaii(
  fiscalYear: number,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await assertDraft(fiscalYear);
    const parsed = aaiiSchema.safeParse({ amountDollars: fd.get("amountDollars") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid amount" };
    const cents = Math.round(parsed.data.amountDollars * 100);
    await db.batch([
      db
        .update(t2Returns)
        .set({ priorYearAaiiCents: cents, updatedAt: new Date() })
        .where(eq(t2Returns.fiscalYear, fiscalYear)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `t2_returns:${fiscalYear}:priorYearAaii`,
        metadata: { cents },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: "Prior-year AAII updated." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

const claimFractionSchema = z.object({
  ccaClass: z.enum(["8", "10", "10.1", "12", "50", "other"]),
  fractionPercent: z.coerce.number().min(0).max(100),
});

export async function setCcaClaimFraction(
  fiscalYear: number,
  _prev: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await assertDraft(fiscalYear);
    const parsed = claimFractionSchema.safeParse({
      ccaClass: fd.get("ccaClass"),
      fractionPercent: fd.get("fractionPercent"),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const claimFractionBps = Math.round(parsed.data.fractionPercent * 100);
    const classRateBps = CLASS_RATE_BPS[parsed.data.ccaClass];

    // Upsert — row may not exist yet if no pool activity in this class.
    await db
      .insert(ccaPools)
      .values({
        fiscalYear,
        ccaClass: parsed.data.ccaClass,
        classRateBps,
        claimFractionBps,
      })
      .onConflictDoUpdate({
        target: [ccaPools.fiscalYear, ccaPools.ccaClass],
        set: { claimFractionBps, updatedAt: new Date() },
      });
    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `cca_pools:${fiscalYear}:${parsed.data.ccaClass}:claimFraction`,
      metadata: { claimFractionBps },
    });
    revalidate(fiscalYear);
    return { ok: `Class ${parsed.data.ccaClass} claim set to ${parsed.data.fractionPercent}%.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// File — freeze snapshot, persist pools, delete deadline, audit
// ————————————————————————————————————————————————————————————————

const fileSchema = z.object({
  craConfirmationNumber: z
    .string()
    .trim()
    .min(1, "CRA confirmation number required")
    .max(50),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Filed date required"),
});

export async function fileT2Return(
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
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const expectedVersion = parseExpectedVersion(fd);
    const [existing] = await db
      .select()
      .from(t2Returns)
      .where(eq(t2Returns.fiscalYear, fiscalYear));
    if (!existing) return { error: "T2 return not found." };
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      return { error: versionConflictError("T2 return", expectedVersion, existing.version) };
    }
    if (existing.status === "filed") return { error: "T2 return is already filed." };

    // Recompute from authoritative source.
    const live = await loadLiveT2Aggregate(fiscalYear);

    const filedAtTs = new Date(parsed.data.filedAt + "T00:00:00Z");

    // Atomic UPDATE on t2_returns first (with version check) — if it races,
    // we skip the batch entirely. Pool / deadline / audit ops follow in a
    // separate batch.
    const updateWhere = expectedVersion !== null
      ? and(eq(t2Returns.fiscalYear, fiscalYear), eq(t2Returns.version, expectedVersion))
      : eq(t2Returns.fiscalYear, fiscalYear);
    const [updatedT2] = await db
      .update(t2Returns)
      .set({
        status: "filed",
        version: bumpVersion(),
          // P&L snapshot
          revenueCents: live.inputs.revenueCents,
          operatingExpensesCents: live.inputs.operatingExpensesCents,
          salaryCents: live.inputs.salaryCents,
          employerCppCents: live.inputs.employerCppCents,
          ccaClaimedCents: live.inputs.ccaClaimedCents,
          netIncomeForTaxCents: live.result.netIncomeForTaxCents,
          taxableIncomeCents: live.result.taxableIncomeCents,
          // Tax-calc snapshot
          sbdClaimedCents: live.result.sbdEligibleCents,
          sbdGrindCents: live.result.sbdGrindCents,
          sbdLimitAfterGrindCents: live.result.sbdLimitAfterGrindCents,
          fullRateIncomeCents: live.result.fullRateIncomeCents,
          fedSbdPortionCents: live.result.fedSbdPortionCents,
          fedGeneralPortionCents: live.result.fedGeneralPortionCents,
          fedTaxCents: live.result.fedTaxCents,
          ontarioSbdPortionCents: live.result.ontarioSbdPortionCents,
          ontarioGeneralPortionCents: live.result.ontarioGeneralPortionCents,
          ontarioTaxCents: live.result.ontarioTaxCents,
          ontarioBlendedSbdRateBps: live.result.ontarioBlendedSbdRateBps,
          totalTaxCents: live.result.totalTaxCents,
          // Pool deltas
          gripOpeningCents: live.grip.openingCents,
          gripAdditionCents: live.grip.additionCents,
          gripUsedCents: live.grip.usedCents,
          gripClosingCents: live.grip.closingCents,
          erdtohOpeningCents: live.rdtoh.erdtoh.openingCents,
          erdtohAdditionCents: live.rdtoh.erdtoh.additionCents,
          erdtohRefundCents: live.rdtoh.erdtoh.refundCents,
          erdtohClosingCents: live.rdtoh.erdtoh.closingCents,
          nerdtohOpeningCents: live.rdtoh.nerdtoh.openingCents,
          nerdtohAdditionCents: live.rdtoh.nerdtoh.additionCents,
          nerdtohRefundCents: live.rdtoh.nerdtoh.refundCents,
          nerdtohClosingCents: live.rdtoh.nerdtoh.closingCents,
          cdaOpeningCents: live.cda.openingCents,
          cdaAdditionCents: live.cda.additionCents,
          cdaUsedCents: live.cda.usedCents,
          cdaClosingCents: live.cda.closingCents,
          dividendRefundCents: live.rdtoh.dividendRefundCents,
          // Filing metadata
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: filedAtTs,
          filedBy: email,
          updatedAt: new Date(),
        })
      .where(updateWhere)
      .returning({ version: t2Returns.version });
    if (!updatedT2) {
      const [current] = await db
        .select({ version: t2Returns.version })
        .from(t2Returns)
        .where(eq(t2Returns.fiscalYear, fiscalYear));
      if (!current) return { error: "T2 return was deleted in another tab." };
      return { error: versionConflictError("T2 return", expectedVersion ?? existing.version, current.version) };
    }

    // Pool / deadline / audit ops — heterogeneous batch.
    type BatchOp = Parameters<typeof db.batch>[0][number];
    const ops: BatchOp[] = [
      // Delete the open deadline (deadlines-derivation re-emits on next
      // /calendar visit, but only for non-completed rows — we drop this one.)
      db.delete(deadlines).where(eq(deadlines.sourceKey, `t2:${fiscalYear}`)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `t2_returns:${fiscalYear}:file`,
        metadata: {
          craConfirmationNumber: parsed.data.craConfirmationNumber,
          filedAt: parsed.data.filedAt,
          totalTaxCents: live.result.totalTaxCents,
          taxableIncomeCents: live.result.taxableIncomeCents,
          isCcpc: live.isCcpc,
          fromVersion: existing.version,
          toVersion: updatedT2.version,
        },
      }),
    ];

    // Pool rows — one per pool.
    const poolInserts = [
      {
        pool: "grip" as const,
        opening: live.grip.openingCents,
        additions: live.grip.additionCents,
        used: live.grip.usedCents,
        closing: live.grip.closingCents,
      },
      {
        pool: "erdtoh" as const,
        opening: live.rdtoh.erdtoh.openingCents,
        additions: live.rdtoh.erdtoh.additionCents,
        used: live.rdtoh.erdtoh.refundCents,
        closing: live.rdtoh.erdtoh.closingCents,
      },
      {
        pool: "nerdtoh" as const,
        opening: live.rdtoh.nerdtoh.openingCents,
        additions: live.rdtoh.nerdtoh.additionCents,
        used: live.rdtoh.nerdtoh.refundCents,
        closing: live.rdtoh.nerdtoh.closingCents,
      },
      {
        pool: "cda" as const,
        opening: live.cda.openingCents,
        additions: live.cda.additionCents,
        used: live.cda.usedCents,
        closing: live.cda.closingCents,
      },
    ];
    for (const p of poolInserts) {
      ops.push(
        db
          .insert(taxPools)
          .values({
            fiscalYear,
            pool: p.pool,
            openingCents: p.opening,
            additionsCents: p.additions,
            usedCents: p.used,
            closingCents: p.closing,
          })
          .onConflictDoUpdate({
            target: [taxPools.fiscalYear, taxPools.pool],
            set: {
              openingCents: p.opening,
              additionsCents: p.additions,
              usedCents: p.used,
              closingCents: p.closing,
              updatedAt: new Date(),
            },
          }),
      );
    }

    // CCA pools — one row per class present in live.ccaRows.
    for (const row of live.ccaRows) {
      ops.push(
        db
          .insert(ccaPools)
          .values({
            fiscalYear,
            ccaClass: row.class,
            classRateBps: row.classRateBps,
            openingUccCents: row.openingUccCents,
            additionsCents: row.additionsCents,
            dispositionsCents: row.dispositionsCents,
            halfYearAdjustmentCents: row.halfYearAdjustmentCents,
            ccaBaseCents: row.ccaBaseCents,
            claimFractionBps: row.claimFractionBps,
            ccaClaimedCents: row.ccaClaimedCents,
            closingUccCents: row.closingUccCents,
          })
          .onConflictDoUpdate({
            target: [ccaPools.fiscalYear, ccaPools.ccaClass],
            set: {
              classRateBps: row.classRateBps,
              openingUccCents: row.openingUccCents,
              additionsCents: row.additionsCents,
              dispositionsCents: row.dispositionsCents,
              halfYearAdjustmentCents: row.halfYearAdjustmentCents,
              ccaBaseCents: row.ccaBaseCents,
              claimFractionBps: row.claimFractionBps,
              ccaClaimedCents: row.ccaClaimedCents,
              closingUccCents: row.closingUccCents,
              updatedAt: new Date(),
            },
          }),
      );
    }

    // db.batch signature requires a non-empty tuple; cast since we built a
    // typed array of batch ops above.
    await db.batch(ops as unknown as Parameters<typeof db.batch>[0]);

    revalidate(fiscalYear);
    return { ok: "T2 return filed and locked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Unfile T2 — escape hatch when CRA needs a correction. Toggles status
// filed → draft, re-creates the t2:<fy> deadline (file deletes it), audit
// logs the prior CRA confirmation # + filed date. Frozen P&L + pool snapshot
// columns stay intact (audit trail); refile overwrites them.
//
// **Later-FY guard**: T2 chains via `tax_pools` (FY+1 opening = FY closing).
// Refusing to unfile when a later FY's T2 already exists prevents a silent
// history rewrite of the downstream FY's opening balances. The user must
// unfile in reverse FY order.
//
// Mirrors the unfileT1Return + unfileHstReturn patterns. tax_pools and
// cca_pools rows are NOT deleted; they'll be overwritten via
// onConflictDoUpdate when the user refiles.
// ————————————————————————————————————————————————————————————————

export async function unfileT2Return(fiscalYear: number, expectedVersion: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [existing] = await db
      .select()
      .from(t2Returns)
      .where(eq(t2Returns.fiscalYear, fiscalYear));
    if (!existing) return { error: "T2 return not found." };
    if (existing.version !== expectedVersion) {
      return { error: versionConflictError("T2 return", expectedVersion, existing.version) };
    }
    if (existing.status !== "filed") return { error: "T2 return is not filed; nothing to unfile." };

    // Later-FY guard. If FY+1 (or any later FY) T2 exists in any state, refuse:
    // tax_pools chain via opening = prior-FY closing, so refiling FY would
    // silently change FY+1's opening balances.
    const [later] = await db
      .select({ fiscalYear: t2Returns.fiscalYear, status: t2Returns.status })
      .from(t2Returns)
      .where(drizzleSql`${t2Returns.fiscalYear} > ${fiscalYear}`)
      .orderBy(t2Returns.fiscalYear)
      .limit(1);
    if (later) {
      return {
        error: `Cannot unfile FY ${fiscalYear} T2 — FY ${later.fiscalYear} T2 already exists (${later.status}) and consumes its closing pool balances. Unfile FY ${later.fiscalYear} first.`,
      };
    }

    const [updated] = await db
      .update(t2Returns)
      .set({ status: "draft", version: bumpVersion(), updatedAt: new Date() })
      .where(and(eq(t2Returns.fiscalYear, fiscalYear), eq(t2Returns.version, expectedVersion)))
      .returning({ version: t2Returns.version });
    if (!updated) {
      const [current] = await db
        .select({ version: t2Returns.version })
        .from(t2Returns)
        .where(eq(t2Returns.fiscalYear, fiscalYear));
      if (!current) return { error: "T2 return was deleted in another tab." };
      return { error: versionConflictError("T2 return", expectedVersion, current.version) };
    }

    await db.batch([
      db
        .insert(deadlines)
        .values({
          title: `T2 corporate return — FY ${fiscalYear}`,
          description: "Federal T2 filing + any balance due (6 months after FYE per ITA s.150(1)).",
          dueDate: t2FilingDueDate(existing.periodEnd),
          category: "t2",
          sourceKey: `t2:${fiscalYear}`,
        })
        .onConflictDoNothing({ target: deadlines.sourceKey }),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `t2_returns:${fiscalYear}:unfile`,
        metadata: {
          fiscalYear,
          previousCraConfirmationNumber: existing.craConfirmationNumber,
          previousFiledAt: existing.filedAt,
          previousTotalTaxCents: existing.totalTaxCents,
          previousTaxableIncomeCents: existing.taxableIncomeCents,
          fromVersion: existing.version,
          toVersion: updated.version,
        },
      }),
    ]);

    revalidate(fiscalYear);
    return { ok: "T2 return unfiled. Make corrections, then re-file with a new CRA confirmation number." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unfile failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// PDF + CSV generation
// ————————————————————————————————————————————————————————————————

export async function generateT2Pdf(fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [row] = await db
      .select()
      .from(t2Returns)
      .where(eq(t2Returns.fiscalYear, fiscalYear));
    if (!row) return { error: "T2 return not found." };
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!s) return { error: "Settings not seeded." };

    const live = await loadLiveT2Aggregate(fiscalYear);
    const bannerDataUri = await getBannerDataUri();

    const buffer = await renderToBuffer(
      T2PrepPDF({
        fiscalYear,
        status: row.status,
        live,
        frozen: row.status === "filed" ? row : null,
        settings: {
          corpLegalName: s.corpLegalName,
          businessNumber: s.businessNumber,
          corpIncomeTaxAccount: s.corpIncomeTaxAccount,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          directorLegalName: s.directorLegalName,
          brandPrimaryHex: s.brandPrimaryHex,
          brandAccentHex: s.brandAccentHex,
        },
        bannerDataUri,
      }),
    );
    const pdfBase64 = Buffer.from(buffer).toString("base64");

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `t2_returns:${fiscalYear}:pdf`,
      metadata: { status: row.status },
    });

    return { ok: "PDF generated.", pdfBase64 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF generation failed" };
  }
}

export async function exportGifiCsv(fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [row] = await db
      .select()
      .from(t2Returns)
      .where(eq(t2Returns.fiscalYear, fiscalYear));
    if (!row) return { error: "T2 return not found." };

    const live = await loadLiveT2Aggregate(fiscalYear);
    const expRows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.fiscalYear, fiscalYear));

    const csv = toGifiCsv({
      fiscalYear,
      revenueCents: live.inputs.revenueCents,
      salaryCents: live.inputs.salaryCents,
      employerCppCents: live.inputs.employerCppCents,
      ccaClaimedCents: live.inputs.ccaClaimedCents,
      netIncomeForTaxCents: live.result.netIncomeForTaxCents,
      totalTaxCents: live.result.totalTaxCents,
      expenses: expRows.map((e) => ({
        category: e.category,
        subtotalCents: e.subtotalCents,
      })),
    });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "download",
      target: `t2_returns:${fiscalYear}:gifi_csv`,
      metadata: { status: row.status },
    });

    return {
      ok: "GIFI CSV generated.",
      csv,
      filename: `gifi-fy${fiscalYear}-draft.csv`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "CSV generation failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// List query — used by /corp-tax index page
// ————————————————————————————————————————————————————————————————

export async function listT2Returns(): Promise<T2Return[]> {
  await requireSession();
  return db.select().from(t2Returns).orderBy(desc(t2Returns.fiscalYear));
}
