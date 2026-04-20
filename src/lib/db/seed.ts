/**
 * One-time seed: creates the singleton Settings row + the BMO client + active contract.
 * Safe to re-run; uses ON CONFLICT DO NOTHING semantics via try/catch.
 *
 * Run: pnpm seed
 */
import { db } from "./client";
import { settings, clients, contracts, psbChecklistItems, prescribedRatePeriods } from "./schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("→ Seeding singleton Settings…");
  const existing = await db.select().from(settings).where(eq(settings.id, 1));
  if (existing.length === 0) {
    await db.insert(settings).values({
      id: 1,
      corpLegalName: "Unbounded Technologies Inc.",
      businessNumber: "726742430",
      hstAccount: "726742430RT0001",
      payrollAccount: null,
      payrollAccountActive: false,
      corpIncomeTaxAccount: "726742430RC0001",
      addressLine1: "908-34 Tubman Avenue",
      city: "Toronto",
      province: "ON",
      postalCode: "M5A 0R2",
      country: "CA",
      directorLegalName: "Saïd Aïssani",
      directorEmail: "said.aissani@engineer.com",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      hstFilingFrequency: "annual",
      hstRateBps: 1300,
      paymentStrategy: "blend",
      targetAnnualSalaryCents: 7_130_000, // $71,300 (2026 YMPE)
      payCadence: "monthly",
      payDayRule: "LAST_BUSINESS_DAY",
      brandPrimaryHex: "#6366F1",
      brandAccentHex: "#22D3EE",
      invoicePrefix: "UT",
      nextInvoiceSeq: 1,
    });
    console.log("  ✔ Settings seeded.");
  } else {
    console.log("  ⊘ Settings already exists - skipped.");
  }

  console.log("→ Seeding BMO client…");
  const existingBmo = await db.select().from(clients).where(eq(clients.legalName, "Bank of Montreal"));
  let bmoId: string;
  if (existingBmo.length === 0) {
    const inserted = await db
      .insert(clients)
      .values({
        legalName: "Bank of Montreal",
        notes: "AP contact + address pending - will be updated when BMO provides.",
        country: "CA",
      })
      .returning({ id: clients.id });
    bmoId = inserted[0]!.id;
    console.log("  ✔ BMO client seeded.");
  } else {
    bmoId = existingBmo[0]!.id;
    console.log("  ⊘ BMO client already exists - skipped.");
  }

  console.log("→ Seeding active BMO contract…");
  const existingContract = await db.select().from(contracts).where(eq(contracts.clientId, bmoId));
  if (existingContract.length === 0) {
    await db.insert(contracts).values({
      clientId: bmoId,
      rateCents: 7000, // $70.00/hour
      rateUnit: "hour",
      hstApplicable: true,
      paymentTerms: "NET_15",
      billingCadence: "bi-weekly",
      startDate: "2026-04-27",
      active: true,
    });
    console.log("  ✔ Contract seeded.");
  } else {
    console.log("  ⊘ Contract already exists - skipped.");
  }

  console.log("→ Seeding PSB checklist items…");
  const existingPsb = await db.select({ id: psbChecklistItems.id }).from(psbChecklistItems).limit(1);
  if (existingPsb.length === 0) {
    const items = [
      {
        code: "multiple_clients",
        label: "Multiple concurrent clients",
        description:
          "CRA's #1 tell is single-client engagement. Two or more paid clients in the fiscal year dramatically reduces PSB risk.",
        weight: 3,
        critical: true,
        sortOrder: 10,
      },
      {
        code: "client_pipeline",
        label: "Documented pipeline of prospects",
        description:
          "Evidence of active business-development work (proposals out, discovery calls booked). Supports 'ongoing enterprise' narrative.",
        weight: 1,
        critical: false,
        sortOrder: 20,
      },
      {
        code: "website_brand",
        label: "Professional website live",
        description:
          "unboundedtechnologies.ca (or equivalent) with service description, portfolio, contact info. A real brand, not an invoice factory.",
        weight: 2,
        critical: false,
        sortOrder: 30,
      },
      {
        code: "right_to_subcontract",
        label: "Right-to-subcontract clause in MSA",
        description:
          "Written contractual right to delegate or substitute personnel. This single item is the strongest PSB defense per CRA jurisprudence.",
        weight: 3,
        critical: true,
        sortOrder: 40,
      },
      {
        code: "own_email_domain",
        label: "Own email domain",
        description:
          "Primary business email at your corp domain (e.g., @unboundedtechnologies.ca), not the client's issued email.",
        weight: 2,
        critical: false,
        sortOrder: 50,
      },
      {
        code: "own_tools",
        label: "Own laptop + software licenses",
        description:
          "You provide your own hardware and paid software. Client-issued laptop + forced Citrix is classic PSB integration.",
        weight: 2,
        critical: false,
        sortOrder: 60,
      },
      {
        code: "liability_insurance",
        label: "Business liability / E&O insurance",
        description:
          "Active policy in the corp's name. Shows you bear business risk — essential for 'chance of profit / risk of loss' test.",
        weight: 2,
        critical: false,
        sortOrder: 70,
      },
      {
        code: "fixed_fee_engagement",
        label: "Fixed-fee or milestone-based engagement",
        description:
          "Open-ended hourly rate is CRA's easiest PSB flag. Fixed-fee or milestone pricing demonstrates entrepreneurial risk.",
        weight: 2,
        critical: false,
        sortOrder: 80,
      },
      {
        code: "linkedin_brand",
        label: "LinkedIn + public brand presence",
        description:
          "LinkedIn headline reflects your corp (Founder / Principal at Unbounded Technologies), not 'Consultant at BMO'.",
        weight: 1,
        critical: false,
        sortOrder: 90,
      },
      {
        code: "business_materials",
        label: "Business cards + invoicing identity",
        description:
          "Logo, letterhead, invoice branding, business cards. Visible artifacts of an independent enterprise.",
        weight: 1,
        critical: false,
        sortOrder: 100,
      },
    ];
    await db.insert(psbChecklistItems).values(items);
    console.log(`  ✔ ${items.length} PSB items seeded.`);
  } else {
    console.log("  ⊘ PSB items already exist - skipped.");
  }

  console.log("→ Seeding CRA prescribed-rate period (2026 Q2)…");
  const existingRate = await db
    .select({ id: prescribedRatePeriods.id })
    .from(prescribedRatePeriods)
    .where(eq(prescribedRatePeriods.startDate, "2026-04-01"));
  if (existingRate.length === 0) {
    await db.insert(prescribedRatePeriods).values({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      ratePercent: 3,
      note: "CRA taxable-benefits rate, Q2 2026. Source: canada.ca/en/revenue-agency/services/tax/prescribed-interest-rates/2026-q2",
    });
    console.log("  ✔ 2026 Q2 prescribed rate seeded (3%).");
  } else {
    console.log("  ⊘ 2026 Q2 prescribed rate already exists - skipped.");
  }

  console.log("\n✅ Seed complete.");
}

seed().catch((err) => {
  console.error("✘ Seed failed:", err);
  process.exit(1);
});
