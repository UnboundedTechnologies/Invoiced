/**
 * T2 corporate-tax prep-summary PDF. Server-side only (@react-pdf/renderer).
 *
 * Draft returns render with a "DRAFT" watermark; filed returns carry the CRA
 * confirmation number + filed date. NOT a filed T2 — this is the prep
 * summary the accountant uses as a one-page audit of our numbers before they
 * re-enter them into their filing software (ProFile / TaxPrep / CRA CIF).
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";
import type { LiveT2Aggregate } from "@/server/actions/t2";
import type { T2Return } from "@/lib/db/schema";

export type T2PrepPDFProps = {
  fiscalYear: number;
  status: "draft" | "filed";
  live: LiveT2Aggregate;
  frozen: T2Return | null; // populated when status === "filed"
  settings: {
    corpLegalName: string;
    businessNumber: string;
    corpIncomeTaxAccount: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    directorLegalName: string;
    brandPrimaryHex: string;
    brandAccentHex: string;
  };
  bannerDataUri?: string;
};

function fmt(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents / 100).toFixed(2);
  const formatted = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(Number(abs));
  return neg ? `(${formatted})` : formatted;
}

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const COLORS = {
  ink: "#0a0a14",
  muted: "#6b6b7c",
  faint: "#a4a4b6",
  border: "#e6e6ee",
  borderStrong: "#0a0a14",
  rowBg: "#f7f7fb",
  cardBg: "#fafafd",
  watermark: "#f2d5d5",
  poolBg: "#f4f4fb",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 50,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.ink,
    lineHeight: 1.4,
  },
  watermark: {
    position: "absolute",
    top: 380,
    left: 50,
    right: 50,
    fontSize: 88,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 12,
    color: COLORS.watermark,
    textAlign: "center",
    transform: "rotate(-45deg)",
    transformOrigin: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  banner: { width: 200, height: 45 },
  headerRight: { width: 260, alignItems: "flex-end" },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    textAlign: "right",
    lineHeight: 1,
  },
  subtitle: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 8,
    textAlign: "right",
  },
  brandDivider: { height: 2, marginBottom: 18, borderRadius: 1 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: COLORS.faint,
    marginBottom: 6,
    marginTop: 6,
  },
  registrantBlock: { marginBottom: 16 },
  registrantName: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  registrantLine: { fontSize: 9.5, color: COLORS.muted },
  metaStrip: {
    flexDirection: "row",
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    padding: 10,
    marginBottom: 18,
    borderLeftWidth: 3,
  },
  metaCell: { flex: 1, paddingHorizontal: 6 },
  metaLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: COLORS.faint,
    marginBottom: 4,
  },
  metaValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  table: { marginBottom: 14 },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  tableRowTotal: {
    flexDirection: "row",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderStrong,
  },
  colFlex4: { flex: 4, fontSize: 9.5 },
  colFlex2: { flex: 2, fontSize: 9.5, textAlign: "right" },
  colFlex1: { flex: 1, fontSize: 9, color: COLORS.muted },
  colBold: { fontFamily: "Helvetica-Bold" },
  netBlock: {
    marginTop: 8,
    marginBottom: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  netLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: "#ffffff",
  },
  netValue: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  poolGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
    marginBottom: 8,
  },
  poolCell: {
    width: "50%",
    padding: 4,
  },
  poolInner: {
    backgroundColor: COLORS.poolBg,
    borderRadius: 5,
    padding: 10,
  },
  poolTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  poolLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
    fontSize: 9,
  },
  poolClose: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  poolCloseLabel: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  poolCloseValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  warningsBlock: {
    marginTop: 10,
    padding: 8,
    backgroundColor: "#fef6e0",
    borderRadius: 5,
    borderLeftWidth: 3,
    borderLeftColor: "#e8a32c",
  },
  warningLine: { fontSize: 8.5, color: "#76591a", marginBottom: 2 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 50,
    right: 50,
    fontSize: 8,
    color: COLORS.faint,
    textAlign: "center",
  },
  methodPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 12,
  },
  methodPillText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: "#ffffff",
  },
});

export function T2PrepPDF(props: T2PrepPDFProps) {
  const { fiscalYear, status, live, frozen, settings, bannerDataUri } = props;
  const brandPrimary = settings.brandPrimaryHex;
  const brandAccent = settings.brandAccentHex;

  // Prefer frozen snapshot when filed — ensures the PDF always reflects what
  // was filed, not a subsequent draft drift.
  const net = frozen?.netIncomeForTaxCents ?? live.result.netIncomeForTaxCents;
  const taxable = frozen?.taxableIncomeCents ?? live.result.taxableIncomeCents;
  const revenue = frozen?.revenueCents ?? live.inputs.revenueCents;
  const opEx = frozen?.operatingExpensesCents ?? live.inputs.operatingExpensesCents;
  const salary = frozen?.salaryCents ?? live.inputs.salaryCents;
  const erCpp = frozen?.employerCppCents ?? live.inputs.employerCppCents;
  const ccaTotal = frozen?.ccaClaimedCents ?? live.inputs.ccaClaimedCents;
  const fedTax = frozen?.fedTaxCents ?? live.result.fedTaxCents;
  const ontarioTax = frozen?.ontarioTaxCents ?? live.result.ontarioTaxCents;
  const totalTax = frozen?.totalTaxCents ?? live.result.totalTaxCents;
  const sbdEligible = frozen?.sbdClaimedCents ?? live.result.sbdEligibleCents;
  const sbdGrind = frozen?.sbdGrindCents ?? live.result.sbdGrindCents;
  const sbdLimitAfterGrind = frozen?.sbdLimitAfterGrindCents ?? live.result.sbdLimitAfterGrindCents;
  const fullRate = frozen?.fullRateIncomeCents ?? live.result.fullRateIncomeCents;
  const fedSbdPortion = frozen?.fedSbdPortionCents ?? live.result.fedSbdPortionCents;
  const fedGeneralPortion = frozen?.fedGeneralPortionCents ?? live.result.fedGeneralPortionCents;
  const onSbdPortion = frozen?.ontarioSbdPortionCents ?? live.result.ontarioSbdPortionCents;
  const onGeneralPortion = frozen?.ontarioGeneralPortionCents ?? live.result.ontarioGeneralPortionCents;
  const onBlendedBps = frozen?.ontarioBlendedSbdRateBps ?? live.result.ontarioBlendedSbdRateBps;
  const dividendRefund = frozen?.dividendRefundCents ?? live.rdtoh.dividendRefundCents;

  const pools = [
    {
      title: "GRIP",
      opening: frozen?.gripOpeningCents ?? live.grip.openingCents,
      addition: frozen?.gripAdditionCents ?? live.grip.additionCents,
      used: frozen?.gripUsedCents ?? live.grip.usedCents,
      closing: frozen?.gripClosingCents ?? live.grip.closingCents,
      color: "#22d3ee",
    },
    {
      title: "ERDTOH",
      opening: frozen?.erdtohOpeningCents ?? live.rdtoh.erdtoh.openingCents,
      addition: frozen?.erdtohAdditionCents ?? live.rdtoh.erdtoh.additionCents,
      used: frozen?.erdtohRefundCents ?? live.rdtoh.erdtoh.refundCents,
      closing: frozen?.erdtohClosingCents ?? live.rdtoh.erdtoh.closingCents,
      color: "#34d399",
    },
    {
      title: "NERDTOH",
      opening: frozen?.nerdtohOpeningCents ?? live.rdtoh.nerdtoh.openingCents,
      addition: frozen?.nerdtohAdditionCents ?? live.rdtoh.nerdtoh.additionCents,
      used: frozen?.nerdtohRefundCents ?? live.rdtoh.nerdtoh.refundCents,
      closing: frozen?.nerdtohClosingCents ?? live.rdtoh.nerdtoh.closingCents,
      color: "#fbbf24",
    },
    {
      title: "CDA",
      opening: frozen?.cdaOpeningCents ?? live.cda.openingCents,
      addition: frozen?.cdaAdditionCents ?? live.cda.additionCents,
      used: frozen?.cdaUsedCents ?? live.cda.usedCents,
      closing: frozen?.cdaClosingCents ?? live.cda.closingCents,
      color: "#a78bfa",
    },
  ];

  return (
    <Document
      title={`T2 Prep Summary FY${fiscalYear}`}
      author={settings.corpLegalName}
      creator="Invoiced"
    >
      <Page size="LETTER" style={styles.page} wrap>
        {status === "draft" && <Text style={styles.watermark}>DRAFT</Text>}

        <View style={styles.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image: not an HTML img; alt is not part of its prop shape */}
            {bannerDataUri && <Image src={bannerDataUri} style={styles.banner} />}
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.title, { color: brandPrimary }]}>T2 PREP SUMMARY</Text>
            <Text style={styles.subtitle}>
              FY {fiscalYear} · {formatLongDate(live.period.start)} – {formatLongDate(live.period.end)}
            </Text>
          </View>
        </View>
        <View style={[styles.brandDivider, { backgroundColor: brandPrimary }]} />

        <View style={styles.registrantBlock}>
          <Text style={styles.sectionLabel}>CORPORATION</Text>
          <Text style={styles.registrantName}>{settings.corpLegalName}</Text>
          <Text style={styles.registrantLine}>BN: {settings.businessNumber}</Text>
          {settings.corpIncomeTaxAccount ? (
            <Text style={styles.registrantLine}>
              Income tax account: {settings.corpIncomeTaxAccount}
            </Text>
          ) : null}
          <Text style={styles.registrantLine}>{settings.addressLine1}</Text>
          {settings.addressLine2 ? <Text style={styles.registrantLine}>{settings.addressLine2}</Text> : null}
          <Text style={styles.registrantLine}>
            {settings.city} {settings.province}  {settings.postalCode}
          </Text>
        </View>

        <View style={styles.metaStrip}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>DUE DATE</Text>
            <Text style={styles.metaValue}>{formatLongDate(live.dueDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>STATUS</Text>
            <Text style={styles.metaValue}>{status === "filed" ? "Filed" : "Draft"}</Text>
          </View>
          {status === "filed" && frozen?.craConfirmationNumber ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>CRA CONFIRMATION #</Text>
              <Text style={styles.metaValue}>{frozen.craConfirmationNumber}</Text>
            </View>
          ) : null}
          {status === "filed" && frozen?.filedAt ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>FILED ON</Text>
              <Text style={styles.metaValue}>
                {formatLongDate(frozen.filedAt.toISOString().slice(0, 10))}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={[styles.methodPill, { backgroundColor: live.isCcpc ? brandPrimary : brandAccent }]}
        >
          <Text style={styles.methodPillText}>
            {live.isCcpc ? "CCPC · ONTARIO · SBD ELIGIBLE" : "NON-CCPC · GENERAL RATE ONLY"}
          </Text>
        </View>

        {/* ——— P&L ——— */}
        <Text style={styles.sectionLabel}>INCOME STATEMENT (for tax)</Text>
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colFlex4, styles.colBold]}>LINE</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>AMOUNT</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Revenue (taxable supplies, ex-HST)</Text>
            <Text style={styles.colFlex2}>{fmt(revenue)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Operating expenses (meals at 50%, capital excluded)</Text>
            <Text style={styles.colFlex2}>({fmt(opEx).replace(/[()]/g, "")})</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Salary paid (gross, issued paycheques)</Text>
            <Text style={styles.colFlex2}>({fmt(salary).replace(/[()]/g, "")})</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Employer CPP + CPP2</Text>
            <Text style={styles.colFlex2}>({fmt(erCpp).replace(/[()]/g, "")})</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>CCA claimed (Schedule 8)</Text>
            <Text style={styles.colFlex2}>({fmt(ccaTotal).replace(/[()]/g, "")})</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[styles.colFlex4, styles.colBold]}>Net income for tax</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>{fmt(net)}</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[styles.colFlex4, styles.colBold]}>Taxable income (floor at 0)</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>{fmt(taxable)}</Text>
          </View>
        </View>

        {/* ——— SBD allocation ——— */}
        <Text style={styles.sectionLabel}>SBD ALLOCATION</Text>
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Business limit (ITA s.125(2))</Text>
            <Text style={styles.colFlex2}>{fmt(50_000_000)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>
              Passive-income grind (prior-FY AAII ${(live.priorYearAaiiCents / 100).toLocaleString("en-CA")})
            </Text>
            <Text style={styles.colFlex2}>({fmt(sbdGrind).replace(/[()]/g, "")})</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[styles.colFlex4, styles.colBold]}>Limit after grind</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>{fmt(sbdLimitAfterGrind)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>SBD-eligible income (fed 9% + ON blended)</Text>
            <Text style={styles.colFlex2}>{fmt(sbdEligible)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Full-rate income (fed 15% + ON 11.5%)</Text>
            <Text style={styles.colFlex2}>{fmt(fullRate)}</Text>
          </View>
        </View>

        {/* ——— Tax calc ——— */}
        <Text style={styles.sectionLabel}>TAX CALCULATION</Text>
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colFlex4, styles.colBold]}>COMPONENT</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>RATE</Text>
            <Text style={[styles.colFlex2, styles.colBold]}>TAX</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Federal SBD portion</Text>
            <Text style={styles.colFlex2}>9.00%</Text>
            <Text style={styles.colFlex2}>{fmt(fedSbdPortion)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Federal general portion (GRR)</Text>
            <Text style={styles.colFlex2}>15.00%</Text>
            <Text style={styles.colFlex2}>{fmt(fedGeneralPortion)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Ontario SBD portion (blended)</Text>
            <Text style={styles.colFlex2}>{fmtBps(onBlendedBps)}</Text>
            <Text style={styles.colFlex2}>{fmt(onSbdPortion)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.colFlex4}>Ontario general portion</Text>
            <Text style={styles.colFlex2}>11.50%</Text>
            <Text style={styles.colFlex2}>{fmt(onGeneralPortion)}</Text>
          </View>
          <View style={styles.tableRowTotal}>
            <Text style={[styles.colFlex4, styles.colBold]}>Federal total</Text>
            <Text style={styles.colFlex2}></Text>
            <Text style={[styles.colFlex2, styles.colBold]}>{fmt(fedTax)}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[styles.colFlex4, styles.colBold]}>Ontario total</Text>
            <Text style={styles.colFlex2}></Text>
            <Text style={[styles.colFlex2, styles.colBold]}>{fmt(ontarioTax)}</Text>
          </View>
        </View>

        <View style={[styles.netBlock, { backgroundColor: brandPrimary }]}>
          <Text style={styles.netLabel}>TOTAL TAX OWING</Text>
          <Text style={styles.netValue}>{fmt(totalTax)}</Text>
        </View>

        {dividendRefund > 0 ? (
          <View style={[styles.netBlock, { backgroundColor: brandAccent }]}>
            <Text style={styles.netLabel}>DIVIDEND REFUND</Text>
            <Text style={styles.netValue}>({fmt(dividendRefund).replace(/[()]/g, "")})</Text>
          </View>
        ) : null}

        {/* ——— CCA schedule ——— */}
        {live.ccaRows.length > 0 ? (
          <View break>
            <Text style={styles.sectionLabel}>SCHEDULE 8 · CCA POOLS</Text>
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={[styles.colFlex1, styles.colBold]}>CLASS</Text>
                <Text style={[styles.colFlex1, styles.colBold]}>RATE</Text>
                <Text style={[styles.colFlex2, styles.colBold]}>OPENING</Text>
                <Text style={[styles.colFlex2, styles.colBold]}>ADDITIONS</Text>
                <Text style={[styles.colFlex2, styles.colBold]}>CCA</Text>
                <Text style={[styles.colFlex2, styles.colBold]}>CLOSING</Text>
              </View>
              {live.ccaRows.map((r) => (
                <View key={r.class} style={styles.tableRow}>
                  <Text style={styles.colFlex1}>{r.class}</Text>
                  <Text style={styles.colFlex1}>{fmtBps(r.classRateBps)}</Text>
                  <Text style={styles.colFlex2}>{fmt(r.openingUccCents)}</Text>
                  <Text style={styles.colFlex2}>{fmt(r.additionsCents)}</Text>
                  <Text style={styles.colFlex2}>{fmt(r.ccaClaimedCents)}</Text>
                  <Text style={styles.colFlex2}>{fmt(r.closingUccCents)}</Text>
                </View>
              ))}
              <View style={styles.tableRowTotal}>
                <Text style={[styles.colFlex1, styles.colBold]}></Text>
                <Text style={[styles.colFlex1, styles.colBold]}></Text>
                <Text style={[styles.colFlex2, styles.colBold]}></Text>
                <Text style={[styles.colFlex2, styles.colBold]}>Total CCA</Text>
                <Text style={[styles.colFlex2, styles.colBold]}>{fmt(ccaTotal)}</Text>
                <Text style={[styles.colFlex2, styles.colBold]}></Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ——— Tax pools ——— */}
        <Text style={styles.sectionLabel}>TAX POOLS</Text>
        <View style={styles.poolGrid}>
          {pools.map((p) => (
            <View key={p.title} style={styles.poolCell}>
              <View style={[styles.poolInner, { borderLeftWidth: 3, borderLeftColor: p.color }]}>
                <Text style={[styles.poolTitle, { color: p.color }]}>{p.title}</Text>
                <View style={styles.poolLine}>
                  <Text style={{ color: COLORS.muted }}>Opening</Text>
                  <Text>{fmt(p.opening)}</Text>
                </View>
                <View style={styles.poolLine}>
                  <Text style={{ color: COLORS.muted }}>Additions</Text>
                  <Text>{fmt(p.addition)}</Text>
                </View>
                <View style={styles.poolLine}>
                  <Text style={{ color: COLORS.muted }}>
                    {p.title === "CDA" ? "Elected" : p.title === "GRIP" ? "Used" : "Refund"}
                  </Text>
                  <Text>({fmt(p.used).replace(/[()]/g, "")})</Text>
                </View>
                <View style={styles.poolClose}>
                  <Text style={styles.poolCloseLabel}>Closing</Text>
                  <Text style={styles.poolCloseValue}>{fmt(p.closing)}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {live.warnings.length > 0 ? (
          <View style={styles.warningsBlock}>
            <Text style={[styles.sectionLabel, { color: "#76591a", marginTop: 0, marginBottom: 4 }]}>
              NOTES
            </Text>
            {live.warnings.map((w, i) => (
              <Text key={i} style={styles.warningLine}>
                • {w}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by Invoiced on {formatLongDate(new Date().toISOString().slice(0, 10))}.
          Prep summary for accountant review — not a filed T2. Verify against ProFile/TaxPrep before submission.
        </Text>
      </Page>
    </Document>
  );
}
