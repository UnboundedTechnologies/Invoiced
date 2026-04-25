import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  boolean,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Enums
export const payCadenceEnum = pgEnum("pay_cadence", ["weekly", "bi-weekly", "semi-monthly", "monthly"]);
export const paymentTermsEnum = pgEnum("payment_terms", ["NET_15", "NET_30", "NET_45", "NET_60", "DUE_ON_RECEIPT"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "overdue", "void"]);
export const paychequeStatusEnum = pgEnum("paycheque_status", ["draft", "issued", "void"]);
export const remitTypeEnum = pgEnum("remit_type", ["payroll_source_deductions", "hst", "corporate_tax", "other"]);
export const expenseCategoryEnum = pgEnum("expense_category", [
  "office_supplies",
  "software_subscriptions",
  "professional_fees",
  "telecom",
  "internet",
  "insurance",
  "bank_fees",
  "meals_entertainment",
  "travel",
  "vehicle",
  "home_office",
  "training",
  "advertising",
  "capital_asset",
  "other",
]);
export const slipTypeEnum = pgEnum("slip_type", ["T4", "T5", "T4A"]);
export const slipStatusEnum = pgEnum("slip_status", ["draft", "filed", "void"]);
export const payStrategyEnum = pgEnum("pay_strategy", ["salary_only", "dividends_only", "blend"]);
export const loanEntryTypeEnum = pgEnum("loan_entry_type", [
  "draw",               // shareholder takes money from corp
  "repayment",          // principal repayment
  "interest_payment",   // shareholder pays interest (offsets 80.4 benefit)
  "reclassification",   // after-the-fact recast as salary/dividend/reimbursement (phase 2D)
]);
export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete", "login", "logout", "download"]);
export const hstFilingMethodEnum = pgEnum("hst_filing_method", ["regular", "quick"]);
export const hstReturnStatusEnum = pgEnum("hst_return_status", ["draft", "filed"]);
export const t2ReturnStatusEnum = pgEnum("t2_return_status", ["draft", "filed"]);
export const t1ReturnStatusEnum = pgEnum("t1_return_status", ["draft", "filed"]);
export const taxPoolEnum = pgEnum("tax_pool", ["grip", "erdtoh", "nerdtoh", "cda"]);
export const ccaClassEnum = pgEnum("cca_class", ["8", "10", "10.1", "12", "50", "other"]);
export const contributionKindEnum = pgEnum("contribution_kind", ["rrsp", "fhsa"]);
export const capitalGainKindEnum = pgEnum("capital_gain_kind", [
  "public_security",
  "mutual_fund",
  "real_estate",
  "crypto",
  "other",
]);

// Identity & Auth (single user enforced via CHECK + allowlist)
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    // TOTP 2FA. Secret is AES-256-GCM ciphertext under TOTP_ENCRYPTION_KEY (env).
    // Backup codes are argon2id hashes of single-use 8-char alphanumeric codes;
    // each one is removed from the array on consumption.
    totpSecretEncrypted: text("totp_secret_encrypted"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    totpBackupCodesHashed: text("totp_backup_codes_hashed").array(),
    totpFailedCount: integer("totp_failed_count").default(0).notNull(),
    totpLockedUntil: timestamp("totp_locked_until", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionToken: text("session_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sessions_token_unique").on(t.sessionToken), index("sessions_user_idx").on(t.userId)],
);

// Settings (singleton row - corp identity, branding, fiscal config)
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1), // singleton: always 1
  // Corporation
  corpLegalName: text("corp_legal_name").notNull(),
  businessNumber: text("business_number").notNull(), // 9-digit BN root
  hstAccount: text("hst_account"),     // e.g., 726742430RT0001
  payrollAccount: text("payroll_account"), // e.g., 726742430RP0001 (null until registered)
  payrollAccountActive: boolean("payroll_account_active").default(false).notNull(), // gates salary tool
  corpIncomeTaxAccount: text("corp_income_tax_account"), // e.g., 726742430RC0001
  payerRzAccount: text("payer_rz_account"),            // e.g., 726742430RZ0001 (info-returns, for T5)
  payerRzActive: boolean("payer_rz_active").default(false).notNull(), // gates T5 slip generation
  // Vault PIN (second wall in front of /vault + /api/documents/[id]).
  // Null = no PIN set yet (first-visit setup flow). Argon2id hash — never cleartext.
  vaultPinHash: text("vault_pin_hash"),
  vaultPinSetAt: timestamp("vault_pin_set_at", { withTimezone: true }),
  // Address
  addressLine1: text("address_line_1").notNull(),
  addressLine2: text("address_line_2"),
  city: text("city").notNull(),
  province: text("province").notNull().default("ON"),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("CA"),
  // Director / sole employee
  directorLegalName: text("director_legal_name").notNull(),
  directorEmail: text("director_email").notNull(),
  // Fiscal
  fiscalYearEndMonth: integer("fiscal_year_end_month").notNull().default(12), // 1-12
  fiscalYearEndDay: integer("fiscal_year_end_day").notNull().default(31),     // 1-31
  incorporationDate: date("incorporation_date"), // drives Ontario annual return anniversary
  hstFilingFrequency: text("hst_filing_frequency").notNull().default("annual"), // annual|quarterly|monthly
  hstRateBps: integer("hst_rate_bps").notNull().default(1300), // basis points (1300 = 13.00%)
  // T2 / corporate-tax configuration
  isCcpc: boolean("is_ccpc").notNull().default(true), // Canadian-Controlled Private Corp — gates SBD
  priorYearAaiiCents: bigint("prior_year_aaii_cents", { mode: "number" }).notNull().default(0), // drives SBD grind per ITA s.125(5.1)
  ontarioGeneralRateBps: integer("ontario_general_rate_bps").notNull().default(1150), // 11.5% (ON general corp rate, for ABI over $500K)
  // Opening tax-pool balances — zero for a blank-slate corp; only non-zero when
  // migrating from an existing entity. Editable only while no T2 return is filed;
  // after that, prior-FY closing rows in `tax_pools` are the source of truth.
  openingGripCents: bigint("opening_grip_cents", { mode: "number" }).notNull().default(0),
  openingErdtohCents: bigint("opening_erdtoh_cents", { mode: "number" }).notNull().default(0),
  openingNerdtohCents: bigint("opening_nerdtoh_cents", { mode: "number" }).notNull().default(0),
  openingCdaCents: bigint("opening_cda_cents", { mode: "number" }).notNull().default(0),
  // Retained earnings at Invoiced onboarding — zero for a blank-slate corp. Feeds
  // the Phase 6 Holdco-countdown card formula: opening + Σ(filed T2 net-after-tax)
  // − Σ(dividends declared). Editable while no T2 return is filed; locked after.
  openingRetainedEarningsCents: bigint("opening_retained_earnings_cents", { mode: "number" }).notNull().default(0),
  // T1 / personal-tax configuration.
  // Starting RRSP deduction room (from most recent CRA notice of assessment).
  // Null until the user enters it; Phase 6's self-pay planner reads this to
  // surface "salary unlocks $X RRSP room for next year" hints.
  rrspRoomCents: bigint("rrsp_room_cents", { mode: "number" }),
  // FHSA contribution room (lifetime cap $40K, $8K/yr starting the year you
  // open one). Null until you open an FHSA + enter the room.
  fhsaRoomCents: bigint("fhsa_room_cents", { mode: "number" }),
  // Self-pay
  paymentStrategy: payStrategyEnum("payment_strategy").notNull().default("blend"),
  targetAnnualSalaryCents: bigint("target_annual_salary_cents", { mode: "number" }).default(7130000), // $71,300
  payCadence: payCadenceEnum("pay_cadence").notNull().default("monthly"),
  payDayRule: text("pay_day_rule").notNull().default("LAST_BUSINESS_DAY"), // LAST_BUSINESS_DAY | DAY_OF_MONTH:N | DAY_OF_WEEK:N
  // Branding
  brandPrimaryHex: text("brand_primary_hex").notNull().default("#6366F1"),
  brandAccentHex: text("brand_accent_hex").notNull().default("#22D3EE"),
  logoBlobUrl: text("logo_blob_url"),
  bannerBlobUrl: text("banner_blob_url"),
  // Invoice numbering
  invoicePrefix: text("invoice_prefix").notNull().default("UT"),
  nextInvoiceSeq: integer("next_invoice_seq").notNull().default(1),
  version: integer("version").notNull().default(1),
  // Updated
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Clients & contracts
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  legalName: text("legal_name").notNull(),
  apContactName: text("ap_contact_name"),
  apEmail: text("ap_email"),
  apPhone: text("ap_phone"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  country: text("country").default("CA"),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
    label: text("label"),
    reference: text("reference"),
    rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
    rateUnit: text("rate_unit").notNull().default("hour"),
    hstApplicable: boolean("hst_applicable").notNull().default(true),
    paymentTerms: paymentTermsEnum("payment_terms").notNull().default("NET_30"),
    billingCadence: payCadenceEnum("billing_cadence").notNull().default("bi-weekly"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    notes: text("notes"),
    documentId: uuid("document_id"), // FK added below to avoid forward-ref
    active: boolean("active").notNull().default(true),
    // PSB defensibility signals
    billingModel: text("billing_model").notNull().default("hourly"), // hourly | fixed_fee | milestone
    rightToSubcontract: boolean("right_to_subcontract").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Each document can be linked to at most one contract
    uniqueIndex("contracts_document_id_unique").on(t.documentId).where(sql`document_id IS NOT NULL`),
    index("contracts_client_id_idx").on(t.clientId),
  ],
);

// Invoices
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "restrict" }),
    issueDate: date("issue_date").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    currency: text("currency").notNull().default("CAD"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    hstCents: bigint("hst_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    pdfBlobUrl: text("pdf_blob_url"),
    pdfSha256: text("pdf_sha256"),
    notes: text("notes"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoices_number_unique").on(t.invoiceNumber),
    index("invoices_contract_id_idx").on(t.contractId),
    index("invoices_issue_date_idx").on(t.issueDate),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(), // hours × 100 (so 7.5 hr = 750)
    rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("invoice_lines_invoice_id_idx").on(t.invoiceId)],
);

// Paycheques (salary)
export const paycheques = pgTable(
  "paycheques",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payDate: date("pay_date").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    cppCents: bigint("cpp_cents", { mode: "number" }).notNull().default(0),
    cpp2Cents: bigint("cpp2_cents", { mode: "number" }).notNull().default(0),
    eiCents: bigint("ei_cents", { mode: "number" }).notNull().default(0), // owner-manager: 0
    federalTaxCents: bigint("federal_tax_cents", { mode: "number" }).notNull().default(0),
    provincialTaxCents: bigint("provincial_tax_cents", { mode: "number" }).notNull().default(0),
    otherDeductionsCents: bigint("other_deductions_cents", { mode: "number" }).notNull().default(0),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
    // Employer contributions (for remittance)
    employerCppCents: bigint("employer_cpp_cents", { mode: "number" }).notNull().default(0),
    employerCpp2Cents: bigint("employer_cpp2_cents", { mode: "number" }).notNull().default(0),
    employerEiCents: bigint("employer_ei_cents", { mode: "number" }).notNull().default(0),
    totalRemittanceCents: bigint("total_remittance_cents", { mode: "number" }).notNull().default(0),
    status: paychequeStatusEnum("status").notNull().default("draft"),
    pdfBlobUrl: text("pdf_blob_url"),
    pdfSha256: text("pdf_sha256"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("paycheques_pay_date_idx").on(t.payDate)],
);

// Dividends (T5 strategy)
export const dividends = pgTable(
  "dividends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    declaredDate: date("declared_date").notNull(),
    paidDate: date("paid_date"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    eligible: boolean("eligible").notNull().default(true), // eligible vs non-eligible dividend
    fiscalYear: integer("fiscal_year").notNull(),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("dividends_declared_date_idx").on(t.declaredDate),
    index("dividends_fiscal_year_idx").on(t.fiscalYear),
  ],
);

// Expenses (with optional receipt blob)
export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  expenseDate: date("expense_date").notNull(),
  vendor: text("vendor").notNull(),
  description: text("description"),
  category: expenseCategoryEnum("category").notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  hstPaidCents: bigint("hst_paid_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  paymentMethod: text("payment_method"),
  receiptBlobUrl: text("receipt_blob_url"),
  receiptSha256: text("receipt_sha256"),
  cca: jsonb("cca"), // capital cost allowance details if asset
  fiscalYear: integer("fiscal_year").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Remittances to CRA (HST, payroll source deductions, corp tax)
export const remittances = pgTable("remittances", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: remitTypeEnum("type").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  dueDate: date("due_date").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  confirmationNumber: text("confirmation_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// HST returns — one row per fiscal year (annual filer only, per Phase 3B scope).
// Drafts are recomputed live from invoices + expenses on every page load.
// Filing snapshots the CRA line numbers so downstream receipt edits don't
// silently rewrite a filed return. Status transitions to 'filed' also gate
// expense + invoice mutations for rows whose date falls in the period.
export const hstReturns = pgTable(
  "hst_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    method: hstFilingMethodEnum("method").notNull().default("regular"),
    status: hstReturnStatusEnum("status").notNull().default("draft"),
    // Quick Method election metadata
    isFirstQmFy: boolean("is_first_qm_fy").notNull().default(false),
    quickRateBps: integer("quick_rate_bps"), // 880 for Ontario services ≥ 90% to HST-province
    // Frozen CRA line numbers — populated when status flips to 'filed'
    line101Cents: bigint("line_101_cents", { mode: "number" }),   // worldwide taxable supplies (subtotal)
    line103Cents: bigint("line_103_cents", { mode: "number" }),   // GST/HST collected OR QM remittance
    line105Cents: bigint("line_105_cents", { mode: "number" }),   // total GST/HST + adjustments (= 103 + 104)
    line106Cents: bigint("line_106_cents", { mode: "number" }),   // ITCs (regular) / capital-only ITCs (QM)
    line107Cents: bigint("line_107_cents", { mode: "number" }),   // meals-cap adjustment (negative of 50% disallowed)
    line108Cents: bigint("line_108_cents", { mode: "number" }),   // total ITCs + adjustments
    line109Cents: bigint("line_109_cents", { mode: "number" }),   // net tax (105 - 108)
    quickCreditCents: bigint("quick_credit_cents", { mode: "number" }), // 1% first-$30K credit (max $300)
    // Filing metadata
    craConfirmationNumber: text("cra_confirmation_number"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedBy: text("filed_by"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("hst_returns_fiscal_year_unique").on(t.fiscalYear)],
);

// T2 returns — one row per fiscal year. Drafts recompute live from invoices +
// expenses + paycheques + dividends + CCA pools. Filing snapshots every number
// into frozen columns so downstream edits can't silently rewrite a filed
// return. The `status='filed'` transition also gates mutations on every row
// whose date falls inside the fiscal period (same lock pattern as hst_returns).
export const t2Returns = pgTable(
  "t2_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: t2ReturnStatusEnum("status").notNull().default("draft"),
    // CCPC status + passive-income drivers frozen at filing time. isCcpc lets
    // the corp opt out of CCPC treatment (rare — included for completeness).
    isCcpc: boolean("is_ccpc").notNull().default(true),
    priorYearAaiiCents: bigint("prior_year_aaii_cents", { mode: "number" }).notNull().default(0),
    // Frozen P&L (cents) — populated on file. Null while draft.
    revenueCents: bigint("revenue_cents", { mode: "number" }),
    operatingExpensesCents: bigint("operating_expenses_cents", { mode: "number" }),
    salaryCents: bigint("salary_cents", { mode: "number" }),
    employerCppCents: bigint("employer_cpp_cents", { mode: "number" }),
    ccaClaimedCents: bigint("cca_claimed_cents", { mode: "number" }),
    netIncomeForTaxCents: bigint("net_income_for_tax_cents", { mode: "number" }),
    taxableIncomeCents: bigint("taxable_income_cents", { mode: "number" }),
    // Frozen SBD allocation + tax calc
    sbdClaimedCents: bigint("sbd_claimed_cents", { mode: "number" }),
    sbdGrindCents: bigint("sbd_grind_cents", { mode: "number" }),
    sbdLimitAfterGrindCents: bigint("sbd_limit_after_grind_cents", { mode: "number" }),
    fullRateIncomeCents: bigint("full_rate_income_cents", { mode: "number" }),
    fedSbdPortionCents: bigint("fed_sbd_portion_cents", { mode: "number" }),
    fedGeneralPortionCents: bigint("fed_general_portion_cents", { mode: "number" }),
    fedTaxCents: bigint("fed_tax_cents", { mode: "number" }),
    ontarioSbdPortionCents: bigint("ontario_sbd_portion_cents", { mode: "number" }),
    ontarioGeneralPortionCents: bigint("ontario_general_portion_cents", { mode: "number" }),
    ontarioTaxCents: bigint("ontario_tax_cents", { mode: "number" }),
    ontarioBlendedSbdRateBps: integer("ontario_blended_sbd_rate_bps"), // 0-9999 bps
    totalTaxCents: bigint("total_tax_cents", { mode: "number" }),
    // Frozen pool deltas — running totals live in tax_pools. These give the
    // filing-time snapshot so an accountant reading a filed PDF sees what
    // flowed this FY, not just where things stand today.
    gripOpeningCents: bigint("grip_opening_cents", { mode: "number" }),
    gripAdditionCents: bigint("grip_addition_cents", { mode: "number" }),
    gripUsedCents: bigint("grip_used_cents", { mode: "number" }),
    gripClosingCents: bigint("grip_closing_cents", { mode: "number" }),
    erdtohOpeningCents: bigint("erdtoh_opening_cents", { mode: "number" }),
    erdtohAdditionCents: bigint("erdtoh_addition_cents", { mode: "number" }),
    erdtohRefundCents: bigint("erdtoh_refund_cents", { mode: "number" }),
    erdtohClosingCents: bigint("erdtoh_closing_cents", { mode: "number" }),
    nerdtohOpeningCents: bigint("nerdtoh_opening_cents", { mode: "number" }),
    nerdtohAdditionCents: bigint("nerdtoh_addition_cents", { mode: "number" }),
    nerdtohRefundCents: bigint("nerdtoh_refund_cents", { mode: "number" }),
    nerdtohClosingCents: bigint("nerdtoh_closing_cents", { mode: "number" }),
    cdaOpeningCents: bigint("cda_opening_cents", { mode: "number" }),
    cdaAdditionCents: bigint("cda_addition_cents", { mode: "number" }),
    cdaUsedCents: bigint("cda_used_cents", { mode: "number" }),
    cdaClosingCents: bigint("cda_closing_cents", { mode: "number" }),
    dividendRefundCents: bigint("dividend_refund_cents", { mode: "number" }), // ERDTOH + NERDTOH refunds combined
    // Filing metadata
    craConfirmationNumber: text("cra_confirmation_number"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedBy: text("filed_by"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("t2_returns_fiscal_year_unique").on(t.fiscalYear)],
);

// Per-class per-FY UCC pool (Schedule 8 equivalent). One row per (FY, class).
// Opening UCC derives from the prior-FY closing; first-FY opening is 0.
// Additions are this FY's capital_asset expenses (business-use adjusted).
// claimFractionBps lets Saïd claim less than max CCA (e.g. loss-year deferral):
// 10000 = 100% claim (default), 0 = claim nothing, 5000 = half.
export const ccaPools = pgTable(
  "cca_pools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    ccaClass: ccaClassEnum("cca_class").notNull(),
    classRateBps: integer("class_rate_bps").notNull(), // 2000 = 20%
    openingUccCents: bigint("opening_ucc_cents", { mode: "number" }).notNull().default(0),
    additionsCents: bigint("additions_cents", { mode: "number" }).notNull().default(0),
    dispositionsCents: bigint("dispositions_cents", { mode: "number" }).notNull().default(0),
    halfYearAdjustmentCents: bigint("half_year_adjustment_cents", { mode: "number" }).notNull().default(0),
    ccaBaseCents: bigint("cca_base_cents", { mode: "number" }).notNull().default(0),
    claimFractionBps: integer("claim_fraction_bps").notNull().default(10_000), // 10000 = 100%
    ccaClaimedCents: bigint("cca_claimed_cents", { mode: "number" }).notNull().default(0),
    closingUccCents: bigint("closing_ucc_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("cca_pools_fy_class_unique").on(t.fiscalYear, t.ccaClass)],
);

// Tax pools — running balances for GRIP, ERDTOH, NERDTOH, CDA. One row per
// (FY, pool). Opening = prior FY closing; first-FY opening = settings.opening*.
// Row persisted on T2 filing; drafts compute live on every page load.
export const taxPools = pgTable(
  "tax_pools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    pool: taxPoolEnum("pool").notNull(),
    openingCents: bigint("opening_cents", { mode: "number" }).notNull().default(0),
    additionsCents: bigint("additions_cents", { mode: "number" }).notNull().default(0),
    usedCents: bigint("used_cents", { mode: "number" }).notNull().default(0),
    closingCents: bigint("closing_cents", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("tax_pools_fy_pool_unique").on(t.fiscalYear, t.pool)],
);

// T1 returns — one row per calendar year. Drafts recompute live from
// paycheques + dividends + shareholder-loan ledger. Filing snapshots every
// number into frozen columns so downstream edits can't silently rewrite a
// filed return. The `status='filed'` transition also gates mutations on
// every paycheque / dividend / loan entry whose date falls inside the CY
// (same lock pattern as hst_returns and t2_returns).
export const t1Returns = pgTable(
  "t1_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taxYear: integer("tax_year").notNull(),
    status: t1ReturnStatusEnum("status").notNull().default("draft"),
    // T4 box snapshot (cents; null while draft)
    t4Box14Cents: bigint("t4_box_14_cents", { mode: "number" }),       // employment income
    t4Box16Cents: bigint("t4_box_16_cents", { mode: "number" }),       // CPP base employee
    t4Box16aCents: bigint("t4_box_16a_cents", { mode: "number" }),     // CPP2 employee
    t4Box18Cents: bigint("t4_box_18_cents", { mode: "number" }),       // EI — always 0 for owner-mgr
    t4Box22Cents: bigint("t4_box_22_cents", { mode: "number" }),       // fed tax withheld
    t4Box24Cents: bigint("t4_box_24_cents", { mode: "number" }),       // EI insurable earnings — 0
    t4Box26Cents: bigint("t4_box_26_cents", { mode: "number" }),       // CPP pensionable earnings
    t4Box52Cents: bigint("t4_box_52_cents", { mode: "number" }),       // pension adjustment — 0 in v1
    onTaxWithheldCents: bigint("on_tax_withheld_cents", { mode: "number" }), // from paycheques.provincialTaxCents
    // T5 snapshot
    t5EligibleActualCents: bigint("t5_eligible_actual_cents", { mode: "number" }),
    t5EligibleGrossedUpCents: bigint("t5_eligible_grossed_up_cents", { mode: "number" }),
    t5NonEligibleActualCents: bigint("t5_non_eligible_actual_cents", { mode: "number" }),
    t5NonEligibleGrossedUpCents: bigint("t5_non_eligible_grossed_up_cents", { mode: "number" }),
    // T4A box 117 (Loan Benefits — line 13000)
    t4aBox117Cents: bigint("t4a_box_117_cents", { mode: "number" }),
    // Income-flow snapshot
    totalIncomeCents: bigint("total_income_cents", { mode: "number" }),                   // 15000
    cppEnhancedDeductionCents: bigint("cpp_enhanced_deduction_cents", { mode: "number" }), // 22215 — s.60(e)
    cpp2DeductionCents: bigint("cpp2_deduction_cents", { mode: "number" }),                // 22200 — s.60(e.1)
    netIncomeCents: bigint("net_income_cents", { mode: "number" }),                        // 23600
    taxableIncomeCents: bigint("taxable_income_cents", { mode: "number" }),                // 26000
    // Federal snapshot
    federalBracketTaxCents: bigint("federal_bracket_tax_cents", { mode: "number" }),
    federalBpaAmountCents: bigint("federal_bpa_amount_cents", { mode: "number" }),         // 30000
    federalCeaAmountCents: bigint("federal_cea_amount_cents", { mode: "number" }),         // 31260
    federalCppBaseAmountCents: bigint("federal_cpp_base_amount_cents", { mode: "number" }), // 30800
    federalCreditsAmountCents: bigint("federal_credits_amount_cents", { mode: "number" }), // 33500
    federalCreditsTaxCents: bigint("federal_credits_tax_cents", { mode: "number" }),       // 35000
    federalDtcEligibleCents: bigint("federal_dtc_eligible_cents", { mode: "number" }),
    federalDtcNonEligibleCents: bigint("federal_dtc_non_eligible_cents", { mode: "number" }),
    federalTaxPayableCents: bigint("federal_tax_payable_cents", { mode: "number" }),       // 42000
    // Ontario snapshot (ON428)
    ontarioBracketTaxCents: bigint("ontario_bracket_tax_cents", { mode: "number" }),
    ontarioBpaAmountCents: bigint("ontario_bpa_amount_cents", { mode: "number" }),
    ontarioCppBaseAmountCents: bigint("ontario_cpp_base_amount_cents", { mode: "number" }),
    ontarioBasicTaxAfterCreditsCents: bigint("ontario_basic_tax_after_credits_cents", { mode: "number" }),
    ontarioSurtaxTier1Cents: bigint("ontario_surtax_tier1_cents", { mode: "number" }),
    ontarioSurtaxTier2Cents: bigint("ontario_surtax_tier2_cents", { mode: "number" }),
    ontarioDtcEligibleCents: bigint("ontario_dtc_eligible_cents", { mode: "number" }),
    ontarioDtcNonEligibleCents: bigint("ontario_dtc_non_eligible_cents", { mode: "number" }),
    ontarioHealthPremiumCents: bigint("ontario_health_premium_cents", { mode: "number" }),
    ontarioTaxPayableCents: bigint("ontario_tax_payable_cents", { mode: "number" }),
    // Totals
    totalTaxPayableCents: bigint("total_tax_payable_cents", { mode: "number" }),           // 43500
    totalWithheldCents: bigint("total_withheld_cents", { mode: "number" }),
    cpp2OverpaymentCents: bigint("cpp2_overpayment_cents", { mode: "number" }),
    refundOrOwingCents: bigint("refund_or_owing_cents", { mode: "number" }),
    // Charitable donations snapshot (line 34900 + ON428 line 5896)
    donationsTotalCents: bigint("donations_total_cents", { mode: "number" }),
    federalDonationsCreditCents: bigint("federal_donations_credit_cents", { mode: "number" }),
    ontarioDonationsCreditCents: bigint("ontario_donations_credit_cents", { mode: "number" }),
    // RRSP / FHSA snapshot (line 20800 / 20805)
    rrspContributionsCents: bigint("rrsp_contributions_cents", { mode: "number" }),
    rrspDeductionCents: bigint("rrsp_deduction_cents", { mode: "number" }),
    fhsaContributionsCents: bigint("fhsa_contributions_cents", { mode: "number" }),
    fhsaDeductionCents: bigint("fhsa_deduction_cents", { mode: "number" }),
    // Capital gains snapshot (Sch 3 → line 12700)
    capitalGainsLine19900Cents: bigint("capital_gains_line_19900_cents", { mode: "number" }),
    capitalGainsLine12700Cents: bigint("capital_gains_line_12700_cents", { mode: "number" }),
    // Rate-file metadata (for reproducibility on re-render years later)
    ratesEditionTag: text("rates_edition_tag"),
    // Filing metadata
    craConfirmationNumber: text("cra_confirmation_number"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedBy: text("filed_by"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("t1_returns_tax_year_unique").on(t.taxYear)],
);

// RRSP / FHSA contributions — one row per receipt. CY assignment is explicit
// via `appliedToTaxYear` so the first-60-days RRSP election (contributions made
// Jan-Mar of cy+1, deductible against cy) is captured directly. The
// `dateContributed` is preserved for audit trail.
// Edits/deletes blocked once the T1 for `appliedToTaxYear` is filed.
export const rrspContributions = pgTable(
  "rrsp_contributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appliedToTaxYear: integer("applied_to_tax_year").notNull(),
    kind: contributionKindEnum("kind").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    dateContributed: date("date_contributed").notNull(),
    institutionName: text("institution_name"),
    receiptNumber: text("receipt_number"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("rrsp_contributions_applied_year_idx").on(t.appliedToTaxYear)],
);

// Capital transactions — one row per disposition. CY = dispositionDate's year,
// frozen on insert. Gain (proceeds − acb − outlays) computed live; line 12700
// is the 50% taxable inclusion of the net positive sum.
// Capital LOSS carryforward is out of scope in v1; the engine emits a warning
// when net is negative.
export const capitalTransactions = pgTable(
  "capital_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taxYear: integer("tax_year").notNull(),
    kind: capitalGainKindEnum("kind").notNull(),
    description: text("description").notNull(),
    t5008Source: text("t5008_source"),
    dispositionDate: date("disposition_date").notNull(),
    proceedsCents: bigint("proceeds_cents", { mode: "number" }).notNull(),
    acbCents: bigint("acb_cents", { mode: "number" }).notNull(),
    outlaysCents: bigint("outlays_cents", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("capital_transactions_tax_year_idx").on(t.taxYear)],
);

// Charitable donations — one row per receipt. CY assignment is via dateReceived.
// Edits/deletes blocked once the T1 for that CY is filed (t1PeriodLockError guard).
export const donations = pgTable(
  "donations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taxYear: integer("tax_year").notNull(),
    charityName: text("charity_name").notNull(),
    registeredCharityNumber: text("registered_charity_number"),
    receiptNumber: text("receipt_number"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    dateReceived: date("date_received").notNull(),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("donations_tax_year_idx").on(t.taxYear)],
);

// Year-end slips (T4 / T5 / T4A). One "active" (non-void) row per (type, taxYear);
// void rows stay for audit trail. Status flow: draft → filed → void. Filing
// snapshots the box values into the first-class columns AND JSONB `totals` so
// downstream edits can't silently rewrite a filed slip. `status='filed'` plus
// matching CY in taxYear locks mutations on paycheques/dividends/loan-ledger
// rows whose (pay|paid|entry)-date falls in that calendar year.
export const slips = pgTable(
  "slips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: slipTypeEnum("type").notNull(),
    taxYear: integer("tax_year").notNull(),                          // CALENDAR year (not fiscal)
    status: slipStatusEnum("status").notNull().default("draft"),
    reportTypeCode: text("report_type_code").notNull().default("O"), // CRA: O=original, A=amended, C=cancelled
    // JSONB denormalized copy of all box values — forward-compat for T4A, RL-1, T5008, etc.
    totals: jsonb("totals").notNull(),
    // Filing metadata (null while draft)
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedBy: text("filed_by"),
    craConfirmationNumber: text("cra_confirmation_number"),
    voidReason: text("void_reason"),                                  // null unless status='void'
    // PDF & vault link
    pdfBlobUrl: text("pdf_blob_url"),
    pdfSha256: text("pdf_sha256"),
    documentId: uuid("document_id"),                                  // vault FK (wired on file)
    supersedesSlipId: uuid("supersedes_slip_id"),                     // for amended/cancelled chains
    // T4 first-class box snapshot (cents; null for non-T4 rows OR while draft).
    t4Box14Cents: bigint("t4_box_14_cents", { mode: "number" }),      // employment income
    t4Box16Cents: bigint("t4_box_16_cents", { mode: "number" }),      // CPP base
    t4Box16aCents: bigint("t4_box_16a_cents", { mode: "number" }),    // CPP2
    t4Box18Cents: bigint("t4_box_18_cents", { mode: "number" }),      // EI — always 0 for owner-mgr
    t4Box22Cents: bigint("t4_box_22_cents", { mode: "number" }),      // income tax withheld (fed + prov combined)
    t4Box24Cents: bigint("t4_box_24_cents", { mode: "number" }),      // EI insurable — 0
    t4Box26Cents: bigint("t4_box_26_cents", { mode: "number" }),      // CPP pensionable
    t4Box52Cents: bigint("t4_box_52_cents", { mode: "number" }),      // pension adjustment — 0 in v1
    t4OntarioTaxWithheldCents: bigint("t4_ontario_tax_withheld_cents", { mode: "number" }), // on top of box 22 split
    t4EmployerCppCents: bigint("t4_employer_cpp_cents", { mode: "number" }),
    t4EmployerCpp2Cents: bigint("t4_employer_cpp2_cents", { mode: "number" }),
    // T5 first-class box snapshot (cents; null for non-T5 rows OR while draft).
    t5EligibleActualCents: bigint("t5_eligible_actual_cents", { mode: "number" }),          // box 24
    t5EligibleTaxableCents: bigint("t5_eligible_taxable_cents", { mode: "number" }),        // box 25 (×1.38)
    t5EligibleDtcFederalCents: bigint("t5_eligible_dtc_federal_cents", { mode: "number" }), // box 26
    t5EligibleDtcOntarioCents: bigint("t5_eligible_dtc_ontario_cents", { mode: "number" }), // ON428 line
    t5NonEligibleActualCents: bigint("t5_non_eligible_actual_cents", { mode: "number" }),   // box 10
    t5NonEligibleTaxableCents: bigint("t5_non_eligible_taxable_cents", { mode: "number" }), // box 11 (×1.15)
    t5NonEligibleDtcFederalCents: bigint("t5_non_eligible_dtc_federal_cents", { mode: "number" }), // box 12
    t5NonEligibleDtcOntarioCents: bigint("t5_non_eligible_dtc_ontario_cents", { mode: "number" }), // ON428 line
    // T4A first-class box snapshot (cents; null for non-T4A rows OR while draft).
    // Box 117 = "Loan Benefits" = Σ(80.4(2) deemed-interest benefits − interest-paid offset)
    //                          + Σ(15(2) inclusions for loans past 15(2.6) deadline).
    // Breakdown columns kept for audit clarity even though box 117 is the filed value.
    t4aBox117Cents: bigint("t4a_box_117_cents", { mode: "number" }),
    t4aBenefit80_4Cents: bigint("t4a_benefit_80_4_cents", { mode: "number" }),
    t4aInclusion15_2Cents: bigint("t4a_inclusion_15_2_cents", { mode: "number" }),
    // Rate-file reproducibility
    ratesEditionTag: text("rates_edition_tag"),
    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // Partial unique: one active slip per (type, taxYear). Voided rows don't
  // block a fresh original, so the void + reissue workflow stays clean.
  (t) => [
    uniqueIndex("slips_type_year_active_unique")
      .on(t.type, t.taxYear)
      .where(sql`status <> 'void'`),
    index("slips_tax_year_idx").on(t.taxYear),
    index("slips_status_idx").on(t.status),
  ],
);

// Document vault (incorporation, contracts, NDAs, auto-generated invoice/paystub/receipt
// PDFs) — versioned. Runtime category values, with the first four being
// user-uploaded through /vault and the last four being auto-written by the
// corresponding parent flows (contracts, invoices, paycheques, expenses):
//   incorporation | nda | tax_return | other | contract | receipt | invoice | paystub
// See `src/lib/vault-categories.ts` for the single source of truth used by /vault.
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  blobUrl: text("blob_url").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  contentType: text("content_type").notNull(),
  version: integer("version").notNull().default(1),
  supersedesDocumentId: uuid("supersedes_document_id"),
  archived: boolean("archived").notNull().default(false),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  // Optional ancillary link to a contract — when set, this is a vault-uploaded
  // attachment (insurance certificate, code of conduct, addendum, etc.) tied
  // to a specific contract. The PRIMARY contract PDF is still discovered via
  // contracts.documentId; the two relationships coexist (a row can be either,
  // never both — see resolveParentLinks for the precedence). ON DELETE SET NULL
  // keeps user-uploaded files intact if the contract is later deleted.
  contractId: uuid("contract_id").references((): AnyPgColumn => contracts.id, { onDelete: "set null" }),
});

// Calendar / deadlines
export const deadlines = pgTable(
  "deadlines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date").notNull(),
    category: text("category").notNull(), // hst | payroll | t2 | t4 | t5 | t1 | annual_return | other
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Natural key for idempotent upsert by derivation lib. NULL for user-entered
    // "other" deadlines so duplicates are possible (by design — multiple ad-hoc items).
    sourceKey: text("source_key"),
    craConfirmationNumber: text("cra_confirmation_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("deadlines_source_key_unique").on(t.sourceKey)],
);

// Shareholder loan ledger — ITA 15(2) / 15(2.6) / 80.4 tracking
export const shareholderLoanEntries = pgTable(
  "shareholder_loan_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryDate: date("entry_date").notNull(),
    type: loanEntryTypeEnum("type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // always positive; sign implied by type
    description: text("description"),
    sourceKind: text("source_kind"),     // "bank_xfer" | "expense_personal" | "reimbursement" | free-form
    sourceRef: text("source_ref"),       // free-form reference (txn id, invoice #, etc.)
    fiscalYear: integer("fiscal_year").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("shareholder_loan_entries_date_idx").on(t.entryDate),
    index("shareholder_loan_entries_fy_idx").on(t.fiscalYear),
  ],
);

// CRA prescribed rate for taxable benefits (s.80.4) — one row per quarter
// Seeded as CRA publishes; admin can upsert via settings when new quarter lands.
export const prescribedRatePeriods = pgTable(
  "prescribed_rate_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startDate: date("start_date").notNull(), // inclusive
    endDate: date("end_date").notNull(),     // inclusive
    ratePercent: integer("rate_percent").notNull(), // 3, 4, 5, 6
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("prescribed_rate_start_unique").on(t.startDate)],
);

// PSB (Personal Services Business) risk monitor
export const psbChecklistItems = pgTable("psb_checklist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // stable key for seed / lookup
  label: text("label").notNull(),
  description: text("description"),
  weight: integer("weight").notNull().default(1), // relative weight in scoring
  critical: boolean("critical").notNull().default(false), // gates green rating
  status: text("status").notNull().default("not_started"), // not_started|in_progress|done|not_applicable
  evidenceDocumentId: uuid("evidence_document_id"), // optional vault link
  notes: text("notes"),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const psbSnapshots = pgTable(
  "psb_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotDate: date("snapshot_date").notNull(),
    score: integer("score").notNull(), // 0-100
    risk: text("risk").notNull(), // green|amber|red
    itemsDoneCount: integer("items_done_count").notNull(),
    itemsTotalCount: integer("items_total_count").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("psb_snapshots_date_idx").on(t.snapshotDate)],
);

// Phase 6 self-pay planner scenarios — one row per (fiscalYear, name). Stores
// user inputs + a server-recomputed output snapshot at save time. Forward-looking
// tool; no filing lock. Stale-snapshot detection: `inputDigest` + `ratesEditionTag`
// fingerprint the save; on load, `/planner/[fy]` re-runs `simulateScenario` and
// renders a "stale — recompute" banner if outputs no longer reproduce.
export const plannerScenarios = pgTable(
  "planner_scenarios",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiscalYear: integer("fiscal_year").notNull(),
    name: text("name").notNull(),
    isPinned: boolean("is_pinned").notNull().default(false),
    // Inputs
    projectedRevenueCents: bigint("projected_revenue_cents", { mode: "number" }).notNull(),
    projectedOpexCents: bigint("projected_opex_cents", { mode: "number" }).notNull(),
    salaryCents: bigint("salary_cents", { mode: "number" }).notNull(),
    eligibleDividendCents: bigint("eligible_dividend_cents", { mode: "number" }).notNull().default(0),
    nonEligibleDividendCents: bigint("non_eligible_dividend_cents", { mode: "number" }).notNull().default(0),
    ccaClaimedCents: bigint("cca_claimed_cents", { mode: "number" }).notNull().default(0),
    priorYearAaiiCents: bigint("prior_year_aaii_cents", { mode: "number" }).notNull().default(0),
    // Output snapshot (recomputed server-side on save)
    corpTaxCents: bigint("corp_tax_cents", { mode: "number" }).notNull(),
    personalTaxCents: bigint("personal_tax_cents", { mode: "number" }).notNull(),
    totalHouseholdTaxCents: bigint("total_household_tax_cents", { mode: "number" }).notNull(),
    takeHomeCents: bigint("take_home_cents", { mode: "number" }).notNull(),
    cppContribCents: bigint("cpp_contrib_cents", { mode: "number" }).notNull(),
    rrspRoomGeneratedCents: bigint("rrsp_room_generated_cents", { mode: "number" }).notNull(),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    // Drift detection
    ratesEditionTag: text("rates_edition_tag").notNull(),
    inputDigest: text("input_digest").notNull(),
    // Optimistic lock
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("planner_scenarios_fy_name_unique").on(t.fiscalYear, t.name),
    index("planner_scenarios_fy_idx").on(t.fiscalYear),
  ],
);

// Audit log (every write + login + download)
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorEmail: text("actor_email").notNull(),
    action: auditActionEnum("action").notNull(),
    target: text("target"),  // table:id
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_occurred_idx").on(t.occurredAt)],
);

// Vault PIN attempts — rolling-window lockout ledger. One row per PIN verify
// attempt against `/vault`. Lockout = ≥5 failed rows in the last 15 minutes.
export const vaultPinAttempts = pgTable(
  "vault_pin_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
    success: boolean("success").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [index("vault_pin_attempts_attempted_idx").on(t.attemptedAt)],
);

// Inferred types for app code
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Paycheque = typeof paycheques.$inferSelect;
export type Dividend = typeof dividends.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Remittance = typeof remittances.$inferSelect;
export type Slip = typeof slips.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Deadline = typeof deadlines.$inferSelect;
export type PsbChecklistItem = typeof psbChecklistItems.$inferSelect;
export type PsbSnapshot = typeof psbSnapshots.$inferSelect;
export type ShareholderLoanEntry = typeof shareholderLoanEntries.$inferSelect;
export type NewShareholderLoanEntry = typeof shareholderLoanEntries.$inferInsert;
export type PrescribedRatePeriod = typeof prescribedRatePeriods.$inferSelect;
export type NewPrescribedRatePeriod = typeof prescribedRatePeriods.$inferInsert;
export type HstReturn = typeof hstReturns.$inferSelect;
export type NewHstReturn = typeof hstReturns.$inferInsert;
export type T2Return = typeof t2Returns.$inferSelect;
export type NewT2Return = typeof t2Returns.$inferInsert;
export type T1Return = typeof t1Returns.$inferSelect;
export type NewT1Return = typeof t1Returns.$inferInsert;
export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
export type RrspContribution = typeof rrspContributions.$inferSelect;
export type NewRrspContribution = typeof rrspContributions.$inferInsert;
export type CapitalTransaction = typeof capitalTransactions.$inferSelect;
export type NewCapitalTransaction = typeof capitalTransactions.$inferInsert;
export type CcaPool = typeof ccaPools.$inferSelect;
export type NewCcaPool = typeof ccaPools.$inferInsert;
export type TaxPool = typeof taxPools.$inferSelect;
export type NewTaxPool = typeof taxPools.$inferInsert;
export type PlannerScenario = typeof plannerScenarios.$inferSelect;
export type NewPlannerScenario = typeof plannerScenarios.$inferInsert;
