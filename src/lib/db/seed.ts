/**
 * One-time seed: creates the singleton Settings row + the BMO client + active contract.
 * Safe to re-run; uses ON CONFLICT DO NOTHING semantics via try/catch.
 *
 * Run: pnpm seed
 */
import { db } from "./client";
import { settings, clients, contracts } from "./schema";
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
    console.log("  ⊘ Settings already exists — skipped.");
  }

  console.log("→ Seeding BMO client…");
  const existingBmo = await db.select().from(clients).where(eq(clients.legalName, "Bank of Montreal"));
  let bmoId: string;
  if (existingBmo.length === 0) {
    const inserted = await db
      .insert(clients)
      .values({
        legalName: "Bank of Montreal",
        notes: "AP contact + address pending — will be updated when BMO provides.",
        country: "CA",
      })
      .returning({ id: clients.id });
    bmoId = inserted[0]!.id;
    console.log("  ✔ BMO client seeded.");
  } else {
    bmoId = existingBmo[0]!.id;
    console.log("  ⊘ BMO client already exists — skipped.");
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
    console.log("  ⊘ Contract already exists — skipped.");
  }

  console.log("\n✅ Seed complete.");
}

seed().catch((err) => {
  console.error("✘ Seed failed:", err);
  process.exit(1);
});
