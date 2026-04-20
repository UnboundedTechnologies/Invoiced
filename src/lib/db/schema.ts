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
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────
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
export const payStrategyEnum = pgEnum("pay_strategy", ["salary_only", "dividends_only", "blend"]);
export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete", "login", "logout", "download"]);

// ────────────────────────────────────────────────────────────
// Identity & Auth (single user enforced via CHECK + allowlist)
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Settings (singleton row — corp identity, branding, fiscal config)
// ────────────────────────────────────────────────────────────
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1), // singleton: always 1
  // Corporation
  corpLegalName: text("corp_legal_name").notNull(),
  businessNumber: text("business_number").notNull(), // 9-digit BN root
  hstAccount: text("hst_account"),     // e.g., 726742430RT0001
  payrollAccount: text("payroll_account"), // e.g., 726742430RP0001 (null until registered)
  payrollAccountActive: boolean("payroll_account_active").default(false).notNull(), // gates salary tool
  corpIncomeTaxAccount: text("corp_income_tax_account"), // e.g., 726742430RC0001
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
  hstFilingFrequency: text("hst_filing_frequency").notNull().default("annual"), // annual|quarterly|monthly
  hstRateBps: integer("hst_rate_bps").notNull().default(1300), // basis points (1300 = 13.00%)
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
  // Updated
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Clients & contracts
// ────────────────────────────────────────────────────────────
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  legalName: text("legal_name").notNull(),
  apContactName: text("ap_contact_name"),
  apEmail: text("ap_email"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  country: text("country").default("CA"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  reference: text("reference"), // PO #
  rateCents: bigint("rate_cents", { mode: "number" }).notNull(), // per-unit rate in cents
  rateUnit: text("rate_unit").notNull().default("hour"),         // hour | day
  hstApplicable: boolean("hst_applicable").notNull().default(true),
  paymentTerms: paymentTermsEnum("payment_terms").notNull().default("NET_30"),
  billingCadence: payCadenceEnum("billing_cadence").notNull().default("bi-weekly"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Invoices
// ────────────────────────────────────────────────────────────
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("invoices_number_unique").on(t.invoiceNumber)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(), // hours × 100 (so 7.5 hr = 750)
  rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ────────────────────────────────────────────────────────────
// Paycheques (salary)
// ────────────────────────────────────────────────────────────
export const paycheques = pgTable("paycheques", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Dividends (T5 strategy)
// ────────────────────────────────────────────────────────────
export const dividends = pgTable("dividends", {
  id: uuid("id").defaultRandom().primaryKey(),
  declaredDate: date("declared_date").notNull(),
  paidDate: date("paid_date"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  eligible: boolean("eligible").notNull().default(true), // eligible vs non-eligible dividend
  fiscalYear: integer("fiscal_year").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Expenses (with optional receipt blob)
// ────────────────────────────────────────────────────────────
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Remittances to CRA (HST, payroll source deductions, corp tax)
// ────────────────────────────────────────────────────────────
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
});

// ────────────────────────────────────────────────────────────
// Year-end slips (T4 / T5 / T4A)
// ────────────────────────────────────────────────────────────
export const slips = pgTable("slips", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: slipTypeEnum("type").notNull(),
  taxYear: integer("tax_year").notNull(),
  totals: jsonb("totals").notNull(), // box-by-box amounts
  pdfBlobUrl: text("pdf_blob_url"),
  pdfSha256: text("pdf_sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Document vault (encrypted blobs: incorporation, contracts, NDAs)
// ────────────────────────────────────────────────────────────
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // incorporation | contract | nda | tax_return | other
  blobUrl: text("blob_url").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  contentType: text("content_type").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────────────────────
// Calendar / deadlines
// ────────────────────────────────────────────────────────────
export const deadlines = pgTable("deadlines", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date").notNull(),
  category: text("category").notNull(), // hst | payroll | t2 | t1 | annual_return | other
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ────────────────────────────────────────────────────────────
// Audit log (every write + login + download)
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Inferred types for app code
// ────────────────────────────────────────────────────────────
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
