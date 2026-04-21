"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  plannerScenarios,
  settings,
  invoices,
  expenses,
  paycheques,
  dividends,
  t2Returns,
  auditLog,
  type PlannerScenario,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { auth } from "../../../auth";
import { hstPeriodFor } from "@/lib/hst";
import { TAXABLE_SUPPLY_STATUSES } from "@/lib/queries/invoice-slices";
import { operatingExpensesForT2 } from "@/lib/dashboard-metrics";
import {
  simulateScenario,
  canonicalInputJson,
  type ScenarioInput,
  type BaselineFromActuals,
} from "@/lib/self-pay-planner";
import { inArray } from "drizzle-orm";

type ActionResult = {
  ok?: string;
  error?: string;
  scenarioId?: string;
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
  revalidatePath("/planner");
  if (fiscalYear !== undefined) revalidatePath(`/planner/${fiscalYear}`);
  revalidatePath("/dashboard");
  revalidatePath("/(app)", "layout");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ————————————————————————————————————————————————————————————————
// Live baseline from YTD actuals — used to seed defaults in the simulator.
// Revenue, opex, salary, divs, opening GRIP are all drawn from source-of-
// truth tables + settings. No mutation.
// ————————————————————————————————————————————————————————————————

export async function loadBaseline(fiscalYear: number): Promise<BaselineFromActuals> {
  const { fyeMonth, fyeDay } = await getFye();
  const period = hstPeriodFor(fiscalYear, fyeMonth, fyeDay);

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));

  // GRIP opening: prior-FY filed t2_returns.gripClosingCents, or settings.openingGripCents.
  const [prior] = await db
    .select({ gripClosing: t2Returns.gripClosingCents })
    .from(t2Returns)
    .where(
      and(
        drizzleSql`${t2Returns.fiscalYear} < ${fiscalYear}`,
        eq(t2Returns.status, "filed"),
      ),
    )
    .orderBy(desc(t2Returns.fiscalYear))
    .limit(1);
  const openingGripCents = prior?.gripClosing ?? s?.openingGripCents ?? 0;

  // In-period aggregates
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

  const ytdRevenueCents = invRows.reduce((a, i) => a + i.subtotalCents, 0);
  const ytdOpexCents = operatingExpensesForT2(
    expRows.map((e) => ({
      category: e.category,
      subtotalCents: e.subtotalCents,
      totalCents: e.totalCents,
    })),
  );
  const ytdSalaryCents = payRows.reduce((a, p) => a + p.grossCents, 0);
  const ytdEmployerCppCents = payRows.reduce(
    (a, p) => a + p.employerCppCents + p.employerCpp2Cents,
    0,
  );
  const ytdEligibleDividendCents = divRows
    .filter((d) => d.eligible)
    .reduce((a, d) => a + d.amountCents, 0);
  const ytdNonEligibleDividendCents = divRows
    .filter((d) => !d.eligible)
    .reduce((a, d) => a + d.amountCents, 0);

  return {
    ytdRevenueCents,
    ytdOpexCents,
    ytdSalaryCents,
    ytdEmployerCppCents,
    ytdEligibleDividendCents,
    ytdNonEligibleDividendCents,
    openingGripCents,
    priorYearAaiiCents: s?.priorYearAaiiCents ?? 0,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

// ————————————————————————————————————————————————————————————————
// Auto-upsert draft "Custom" scenario for a given FY. Idempotent — returns
// existing row if one is named "Custom" already. Inputs seed from YTD actuals.
// ————————————————————————————————————————————————————————————————

export async function upsertDraftScenario(fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    // Already have a Custom row?
    const [existing] = await db
      .select()
      .from(plannerScenarios)
      .where(
        and(
          eq(plannerScenarios.fiscalYear, fiscalYear),
          eq(plannerScenarios.name, "Custom"),
        ),
      )
      .limit(1);
    if (existing) return { ok: "Custom scenario exists.", scenarioId: existing.id };

    const baseline = await loadBaseline(fiscalYear);
    // Seed a Custom scenario from YTD actuals — what /paycheques + /dividends
    // would produce if the FY ended today with current data.
    const input: ScenarioInput = {
      fiscalYear,
      periodStart: baseline.periodStart,
      periodEnd: baseline.periodEnd,
      projectedRevenueCents: baseline.ytdRevenueCents,
      projectedOpexCents: baseline.ytdOpexCents,
      salaryCents: baseline.ytdSalaryCents,
      eligibleDividendCents: baseline.ytdEligibleDividendCents,
      nonEligibleDividendCents: baseline.ytdNonEligibleDividendCents,
      ccaClaimedCents: 0,
      priorYearAaiiCents: baseline.priorYearAaiiCents,
      openingGripCents: baseline.openingGripCents,
    };
    const result = simulateScenario(input);
    const json = canonicalInputJson(input);

    const [row] = await db
      .insert(plannerScenarios)
      .values({
        fiscalYear,
        name: "Custom",
        isPinned: false,
        projectedRevenueCents: input.projectedRevenueCents,
        projectedOpexCents: input.projectedOpexCents,
        salaryCents: input.salaryCents,
        eligibleDividendCents: input.eligibleDividendCents,
        nonEligibleDividendCents: input.nonEligibleDividendCents,
        ccaClaimedCents: input.ccaClaimedCents,
        priorYearAaiiCents: input.priorYearAaiiCents,
        corpTaxCents: result.corpTaxCents,
        personalTaxCents: result.personalTaxCents,
        totalHouseholdTaxCents: result.totalHouseholdTaxCents,
        takeHomeCents: result.takeHomeCents,
        cppContribCents: result.cppContribCents,
        rrspRoomGeneratedCents: result.rrspRoomGeneratedCents,
        warnings: result.warnings,
        ratesEditionTag: result.ratesEditionTag,
        inputDigest: sha256(json),
        version: 1,
      })
      .returning({ id: plannerScenarios.id });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `planner_scenarios:${row?.id ?? "?"}`,
      metadata: { fiscalYear, name: "Custom" },
    });

    revalidate(fiscalYear);
    return { ok: "Draft Custom scenario created.", scenarioId: row?.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Create failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Save a named scenario — upsert on UNIQUE(fy, name). Snapshots server-side
// (authoritative) using simulateScenario. Optimistic-lock via `version`.
// ————————————————————————————————————————————————————————————————

const scenarioInputSchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectedRevenueCents: z.number().int().min(0).max(1_000_000_00 * 100),
  projectedOpexCents: z.number().int().min(0).max(1_000_000_00 * 100),
  salaryCents: z.number().int().min(0).max(1_000_000_00 * 100),
  eligibleDividendCents: z.number().int().min(0).max(1_000_000_00 * 100),
  nonEligibleDividendCents: z.number().int().min(0).max(1_000_000_00 * 100),
  ccaClaimedCents: z.number().int().min(0).max(1_000_000_00 * 100),
  priorYearAaiiCents: z.number().int().min(0).max(1_000_000_00 * 100),
  openingGripCents: z.number().int().min(0).max(1_000_000_00 * 100),
  payPeriodsPerYear: z.union([z.literal(12), z.literal(24), z.literal(26), z.literal(52)]).optional(),
});

const saveScenarioSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(64, "Name too long")
    .refine((v) => !["Custom"].includes(v) || v === "Custom", { message: "Invalid name" }),
  expectedVersion: z.number().int().optional(),
  inputs: scenarioInputSchema,
});

export async function saveScenario(
  input: z.infer<typeof saveScenarioSchema>,
): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const parsed = saveScenarioSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { name, expectedVersion, inputs } = parsed.data;

    // Re-run authoritative compute server-side
    const scenarioInput: ScenarioInput = inputs;
    const result = simulateScenario(scenarioInput);
    const digest = sha256(canonicalInputJson(scenarioInput));

    // Find existing row (unique on fy+name)
    const [existing] = await db
      .select()
      .from(plannerScenarios)
      .where(
        and(
          eq(plannerScenarios.fiscalYear, scenarioInput.fiscalYear),
          eq(plannerScenarios.name, name),
        ),
      )
      .limit(1);

    if (existing) {
      if (
        expectedVersion !== undefined &&
        expectedVersion !== existing.version
      ) {
        return {
          error: `Scenario was edited in another tab (expected v${expectedVersion}, current v${existing.version}). Refresh to continue.`,
        };
      }
      await db.batch([
        db
          .update(plannerScenarios)
          .set({
            projectedRevenueCents: scenarioInput.projectedRevenueCents,
            projectedOpexCents: scenarioInput.projectedOpexCents,
            salaryCents: scenarioInput.salaryCents,
            eligibleDividendCents: scenarioInput.eligibleDividendCents,
            nonEligibleDividendCents: scenarioInput.nonEligibleDividendCents,
            ccaClaimedCents: scenarioInput.ccaClaimedCents,
            priorYearAaiiCents: scenarioInput.priorYearAaiiCents,
            corpTaxCents: result.corpTaxCents,
            personalTaxCents: result.personalTaxCents,
            totalHouseholdTaxCents: result.totalHouseholdTaxCents,
            takeHomeCents: result.takeHomeCents,
            cppContribCents: result.cppContribCents,
            rrspRoomGeneratedCents: result.rrspRoomGeneratedCents,
            warnings: result.warnings,
            ratesEditionTag: result.ratesEditionTag,
            inputDigest: digest,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(plannerScenarios.id, existing.id)),
        db.insert(auditLog).values({
          actorEmail: email,
          action: "update",
          target: `planner_scenarios:${existing.id}`,
          metadata: { fiscalYear: scenarioInput.fiscalYear, name, from: existing.version, to: existing.version + 1 },
        }),
      ]);
      revalidate(scenarioInput.fiscalYear);
      return { ok: `Saved "${name}".`, scenarioId: existing.id };
    }

    // Insert new
    const [row] = await db
      .insert(plannerScenarios)
      .values({
        fiscalYear: scenarioInput.fiscalYear,
        name,
        isPinned: false,
        projectedRevenueCents: scenarioInput.projectedRevenueCents,
        projectedOpexCents: scenarioInput.projectedOpexCents,
        salaryCents: scenarioInput.salaryCents,
        eligibleDividendCents: scenarioInput.eligibleDividendCents,
        nonEligibleDividendCents: scenarioInput.nonEligibleDividendCents,
        ccaClaimedCents: scenarioInput.ccaClaimedCents,
        priorYearAaiiCents: scenarioInput.priorYearAaiiCents,
        corpTaxCents: result.corpTaxCents,
        personalTaxCents: result.personalTaxCents,
        totalHouseholdTaxCents: result.totalHouseholdTaxCents,
        takeHomeCents: result.takeHomeCents,
        cppContribCents: result.cppContribCents,
        rrspRoomGeneratedCents: result.rrspRoomGeneratedCents,
        warnings: result.warnings,
        ratesEditionTag: result.ratesEditionTag,
        inputDigest: digest,
        version: 1,
      })
      .returning({ id: plannerScenarios.id });

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "create",
      target: `planner_scenarios:${row?.id ?? "?"}`,
      metadata: { fiscalYear: scenarioInput.fiscalYear, name },
    });

    revalidate(scenarioInput.fiscalYear);
    return { ok: `Saved "${name}".`, scenarioId: row?.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Pin a scenario — atomic single-UPDATE (no batch race). Zero-one-invariant
// per FY: exactly one scenario has is_pinned=true after this runs.
// ————————————————————————————————————————————————————————————————

export async function pinScenario(id: string, fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();

    // Atomic pin-flip: pin this row, unpin every other in the same FY.
    await db.execute(drizzleSql`
      UPDATE planner_scenarios
      SET is_pinned = (id = ${id}::uuid),
          updated_at = NOW()
      WHERE fiscal_year = ${fiscalYear}
    `);

    await db.insert(auditLog).values({
      actorEmail: email,
      action: "update",
      target: `planner_scenarios:${id}:pin`,
      metadata: { fiscalYear, pinnedId: id },
    });

    revalidate(fiscalYear);
    return { ok: "Pinned to dashboard." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Pin failed" };
  }
}

export async function unpinScenario(id: string, fiscalYear: number): Promise<ActionResult> {
  try {
    const email = await requireSession();
    await db.batch([
      db
        .update(plannerScenarios)
        .set({ isPinned: false, updatedAt: new Date() })
        .where(eq(plannerScenarios.id, id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "update",
        target: `planner_scenarios:${id}:unpin`,
        metadata: { fiscalYear },
      }),
    ]);
    revalidate(fiscalYear);
    return { ok: "Unpinned." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unpin failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Delete a scenario — protected: the Custom draft cannot be deleted (it's
// the auto-seeded sandbox; users rename to "My plan" to persist).
// ————————————————————————————————————————————————————————————————

export async function deleteScenario(id: string): Promise<ActionResult> {
  try {
    const email = await requireSession();
    const [row] = await db
      .select()
      .from(plannerScenarios)
      .where(eq(plannerScenarios.id, id))
      .limit(1);
    if (!row) return { error: "Scenario not found." };
    if (row.name === "Custom") {
      return { error: "The Custom sandbox scenario cannot be deleted. Rename it to keep a copy, or reset its inputs." };
    }
    await db.batch([
      db.delete(plannerScenarios).where(eq(plannerScenarios.id, id)),
      db.insert(auditLog).values({
        actorEmail: email,
        action: "delete",
        target: `planner_scenarios:${id}`,
        metadata: { fiscalYear: row.fiscalYear, name: row.name },
      }),
    ]);
    revalidate(row.fiscalYear);
    return { ok: `Deleted "${row.name}".` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// ————————————————————————————————————————————————————————————————
// Read-only helpers for pages
// ————————————————————————————————————————————————————————————————

export async function listScenariosForFy(fiscalYear: number): Promise<PlannerScenario[]> {
  await requireSession();
  return db
    .select()
    .from(plannerScenarios)
    .where(eq(plannerScenarios.fiscalYear, fiscalYear))
    .orderBy(desc(plannerScenarios.isPinned), desc(plannerScenarios.updatedAt));
}

export async function listAllScenarios(): Promise<PlannerScenario[]> {
  await requireSession();
  return db
    .select()
    .from(plannerScenarios)
    .orderBy(desc(plannerScenarios.fiscalYear), desc(plannerScenarios.isPinned), desc(plannerScenarios.updatedAt));
}

