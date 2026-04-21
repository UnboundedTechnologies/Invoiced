/**
 * GIFI CSV exporter — Schedule 125 (Income Statement) + selected Schedule 100
 * (Balance Sheet) rows. Accountant imports this into ProFile / TaxPrep.
 *
 * Mapping: Saïd's expense-category enum → GIFI code. This v1 mapping is
 * pending accountant sign-off per `feedback_accountant_before_freeze.md`;
 * changes after review land in a small follow-up PR (single pure module,
 * no schema impact).
 *
 * Output: UTF-8 CSV with LF line endings. Columns:
 *   gifi_code,description,amount_cents,amount_cad
 * Quoting: description is quoted because some legal GIFI descriptions contain
 * commas (e.g. "Insurance, general"). Amounts are raw integers; CAD is the
 * signed decimal for accountant eyeballing.
 *
 * References:
 *   - CRA RC4088 "General Index of Financial Information (GIFI)"
 *   - CRA Schedule 100 (balance sheet), Schedule 125 (income statement)
 *   - Format spec: https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4088.html
 */

export type GifiExportInput = {
  fiscalYear: number;
  revenueCents: number;
  salaryCents: number;
  employerCppCents: number;
  ccaClaimedCents: number;
  netIncomeForTaxCents: number;
  totalTaxCents: number;
  expenses: { category: string; subtotalCents: number }[];
};

/**
 * Expense-enum → GIFI code map. Kept here (not in expenses module) so the
 * tax concern stays separated from the operational concern.
 */
const EXPENSE_CATEGORY_TO_GIFI: Record<string, { code: string; description: string }> = {
  office_supplies: { code: "8811", description: "Office supplies" },
  software_subscriptions: { code: "8714", description: "Computer-related expenses" },
  professional_fees: { code: "8860", description: "Professional fees" },
  telecom: { code: "9225", description: "Telephone and telecommunications" },
  internet: { code: "9225", description: "Telephone and telecommunications" }, // CRA groups under 9225
  insurance: { code: "8690", description: "Insurance" },
  bank_fees: { code: "8710", description: "Interest and bank charges" },
  meals_entertainment: { code: "8523", description: "Meals and entertainment (at 50%)" },
  travel: { code: "9200", description: "Travel expenses" },
  vehicle: { code: "9281", description: "Motor vehicle expenses (no CCA)" },
  home_office: { code: "8918", description: "Other rental" }, // no perfect GIFI code; review with accountant
  training: { code: "8860", description: "Professional fees (training/development)" },
  advertising: { code: "8521", description: "Advertising and promotion" },
  capital_asset: { code: "8670", description: "Amortization of tangible assets (CCA)" }, // routed via CCA total, not per-row
  other: { code: "9270", description: "Other expenses" },
};

type GifiLine = { code: string; description: string; amountCents: number };

export function toGifiCsv(input: GifiExportInput): string {
  const lines: GifiLine[] = [];

  // ——— Schedule 125 · revenue ———
  // 8000 = total revenue from sales of goods and services
  lines.push({
    code: "8000",
    description: "Trade sales of goods and services",
    amountCents: input.revenueCents,
  });

  // ——— Schedule 125 · operating expenses (aggregated by GIFI code) ———
  // Capital asset rows are excluded from per-line expense output; their
  // tax deduction flows through 8670 below.
  const byCode = new Map<string, GifiLine>();
  for (const e of input.expenses) {
    if (e.category === "capital_asset") continue; // CCA line only
    const map = EXPENSE_CATEGORY_TO_GIFI[e.category] ?? EXPENSE_CATEGORY_TO_GIFI.other!;
    // meals 50% cap applied at the GIFI level, same rule as operatingExpensesForT2.
    const amt =
      e.category === "meals_entertainment"
        ? Math.round(e.subtotalCents * 0.5)
        : e.subtotalCents;
    const existing = byCode.get(map.code);
    if (existing) {
      existing.amountCents += amt;
    } else {
      byCode.set(map.code, {
        code: map.code,
        description: map.description,
        amountCents: amt,
      });
    }
  }
  const sortedExpenseLines = [...byCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  lines.push(...sortedExpenseLines);

  // 9060 salaries + 9062 employee benefits (ER CPP). GIFI 9062 is the
  // typical bucket for employer-side statutory contributions.
  if (input.salaryCents > 0) {
    lines.push({
      code: "9060",
      description: "Salaries and wages",
      amountCents: input.salaryCents,
    });
  }
  if (input.employerCppCents > 0) {
    lines.push({
      code: "9062",
      description: "Employee benefits (employer CPP + CPP2)",
      amountCents: input.employerCppCents,
    });
  }

  // 8670 amortization of tangible assets — total CCA claimed across pools.
  if (input.ccaClaimedCents > 0) {
    lines.push({
      code: "8670",
      description: "Amortization of tangible assets (CCA)",
      amountCents: input.ccaClaimedCents,
    });
  }

  // 9970 net income/loss before income taxes.
  lines.push({
    code: "9970",
    description: "Net income/loss before income taxes",
    amountCents: input.netIncomeForTaxCents,
  });

  // 9990 net income/loss after income taxes.
  lines.push({
    code: "9990",
    description: "Net income/loss after income taxes",
    amountCents: input.netIncomeForTaxCents - input.totalTaxCents,
  });

  // ——— CSV assembly ———
  const header = "gifi_code,description,amount_cents,amount_cad";
  const rows = lines.map((l) => {
    const cad = (l.amountCents / 100).toFixed(2);
    const desc = l.description.replace(/"/g, '""');
    return `${l.code},"${desc}",${l.amountCents},${cad}`;
  });
  return [header, ...rows].join("\n") + "\n";
}
