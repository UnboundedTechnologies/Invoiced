# GIFI mapping review — FY 2026 (Unbounded Technologies Inc.)

**Context:** I'm standing up an in-house corporate-tax prep tool for Unbounded Technologies (single-shareholder Ontario CCPC, Dec-31 FYE, first T2 due 2027-06-30). The tool produces a Schedule 125 + Schedule 100 CSV that I'll hand to you for filing. Before I freeze the code mapping below, I want your sign-off so the output lines up with how you actually book things in ProFile / TaxPrep / your preferred software.

**Ask:** please mark any line you'd map to a different GIFI code. No other feedback needed unless you see a missing category.

---

## Proposed expense-category → GIFI code mapping

| Expense category (internal) | GIFI code | GIFI description |
|---|---|---|
| Office supplies | **8811** | Office supplies |
| Software subscriptions (SaaS) | **8714** | Computer-related expenses |
| Professional fees (legal, accounting, consulting) | **8860** | Professional fees |
| Telecom (mobile plan) | **9225** | Telephone and telecommunications |
| Internet | **9225** | Telephone and telecommunications |
| Insurance (E&O, general biz) | **8690** | Insurance |
| Bank fees | **8710** | Interest and bank charges |
| Meals & entertainment (50% deductible per ITA s.67.1) | **8523** | Meals and entertainment |
| Travel (airfare, hotel, taxi) | **9200** | Travel expenses |
| Vehicle expenses (fuel, parking, maintenance — no CCA) | **9281** | Motor vehicle expenses (no CCA) |
| Home office | **8918** | Other rental |
| Training / professional development | **8860** | Professional fees |
| Advertising & promotion | **8521** | Advertising and promotion |
| Other / miscellaneous | **9270** | Other expenses |
| Capital assets | *(excluded — routed through CCA total on 8670)* | — |

### Fixed GIFI lines I also emit

| Line | Source | Description |
|---|---|---|
| **8000** | Revenue (subtotal of taxable-supply invoices) | Trade sales of goods and services |
| **9060** | Salary paid (gross, issued paycheques) | Salaries and wages |
| **9062** | Employer CPP + CPP2 contributions | Employee benefits |
| **8670** | Total CCA claimed across Schedule 8 pools | Amortization of tangible assets |
| **9970** | Revenue − deductible expenses − salary − ER CPP − CCA | Net income/loss before income taxes |
| **9990** | 9970 − (fed 9% + ON blended SBD on SBD portion) | Net income/loss after income taxes |

### Meals & entertainment — 50% cap

Meals are captured in the ledger at 100% subtotal. I apply the 50% cap (ITA s.67.1) at the GIFI export step (same rule that's already applied for HST ITCs under ETA s.236). So on line 8523, you'll see 50% of the full meals total.

### CCA classes I currently track

Class 8 (20%), Class 10 (30%), Class 10.1 (30%, $38K cost cap), Class 12 (100%), Class 50 (55%), plus "other". Half-year rule applies per Reg 1100(2). Accelerated Investment Incentive (AIIIR) is not explicitly modelled — for 2024–2027 acquisitions I've understood AIIIR reverts to standard half-year for most classes Saïd uses. If you'd prefer I apply the enhancement explicitly, let me know.

Class 10.1 currently groups all vehicles under one pool and emits a warning. If Saïd ever owns more than one passenger vehicle, I'll split per-vehicle (Reg 1101(1af)) in a follow-up.

---

## Questions for you

1. **Mapping** — any code you'd change? Particularly worth your eye:
   - Software subscriptions → 8714 vs 8523?
   - Home office → 8918 vs a different bucket?
   - Training → 8860 vs 9224 (other selling expenses) vs 8860?
   - Bank fees → 8710 vs 8811 (office/general)?
2. **Missing categories** — anything Saïd will commonly expense that doesn't fit the list above?
3. **First-T2 approach** — do you prefer to receive a GIFI CSV (to paste into ProFile) or a fully filled T2 prep PDF (for independent review against your own numbers)? My tool generates both. The PDF is what Saïd sees; the CSV is what you'd import.
4. **Instalment threshold** — first year is auto-exempt. Should I start surfacing quarterly instalment deadlines starting FY 2027 if the FY 2026 tax payable exceeds $3,000?

Once I have your mapping sign-off, the tool's GIFI output gets frozen for FY 2026 and going forward. Changes after that trigger a small code update — no ripple, single pure module.

Thanks — happy to hop on a call if easier than email for any of the above.

—  Saïd
