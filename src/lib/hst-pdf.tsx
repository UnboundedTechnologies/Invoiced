/**
 * HST return filing-summary PDF. Server-side only (@react-pdf/renderer).
 *
 * Draft returns render with a "DRAFT" watermark; filed returns carry the
 * CRA confirmation number + filed date in the metadata strip.
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";

export type HstReturnPDFProps = {
  fiscalYear: number;
  period: { start: string; end: string };
  dueDate: string;
  method: "regular" | "quick";
  status: "draft" | "filed";
  isFirstQmFy: boolean;
  craConfirmationNumber: string | null;
  filedAt: string | null;
  lines: {
    line101: number;
    line103: number;
    line105: number;
    line106: number;
    line107: number;
    line108: number;
    line109: number;
    quickCredit: number;
  };
  settings: {
    corpLegalName: string;
    hstAccount: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    directorEmail: string;
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

const COLORS = {
  ink: "#0a0a14",
  muted: "#6b6b7c",
  faint: "#a4a4b6",
  border: "#e6e6ee",
  borderStrong: "#0a0a14",
  rowBg: "#f7f7fb",
  cardBg: "#fafafd",
  watermark: "#f2d5d5",
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
  methodPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 14,
  },
  methodPillText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: "#ffffff",
  },
  lineTable: { marginBottom: 16 },
  lineHead: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
  },
  lineRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  lineRowTotal: {
    flexDirection: "row",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderStrong,
    marginTop: 6,
  },
  colNumber: { flex: 1, fontSize: 9, color: COLORS.muted },
  colLabel: { flex: 5, fontSize: 10 },
  colAmount: { flex: 2, fontSize: 10, textAlign: "right" },
  colAmountBold: { flex: 2, fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  netBlock: {
    marginTop: 12,
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
  footer: {
    position: "absolute",
    bottom: 24,
    left: 50,
    right: 50,
    fontSize: 8,
    color: COLORS.faint,
    textAlign: "center",
  },
  notes: {
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 12,
  },
});

export function HstReturnPDF(props: HstReturnPDFProps) {
  const { fiscalYear, period, dueDate, method, status, isFirstQmFy, craConfirmationNumber, filedAt, lines, settings, bannerDataUri } = props;
  const brandPrimary = settings.brandPrimaryHex;
  const brandAccent = settings.brandAccentHex;
  const isQuick = method === "quick";

  return (
    <Document
      title={`HST Return ${fiscalYear}`}
      author={settings.corpLegalName}
      creator="Invoiced"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Watermark first so all subsequent content paints on top. */}
        {status === "draft" && (
          <Text style={styles.watermark} fixed>
            DRAFT
          </Text>
        )}

        <View style={styles.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image: not an HTML img; alt is not part of its prop shape */}
            {bannerDataUri && <Image src={bannerDataUri} style={styles.banner} />}
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.title, { color: brandPrimary }]}>HST RETURN</Text>
            <Text style={styles.subtitle}>
              FY {fiscalYear} · {formatLongDate(period.start)} – {formatLongDate(period.end)}
            </Text>
          </View>
        </View>
        <View style={[styles.brandDivider, { backgroundColor: brandPrimary }]} />

        <View style={styles.registrantBlock}>
          <Text style={styles.sectionLabel}>REGISTRANT</Text>
          <Text style={styles.registrantName}>{settings.corpLegalName}</Text>
          <Text style={styles.registrantLine}>{settings.addressLine1}</Text>
          {settings.addressLine2 ? <Text style={styles.registrantLine}>{settings.addressLine2}</Text> : null}
          <Text style={styles.registrantLine}>
            {settings.city} {settings.province}  {settings.postalCode}
          </Text>
          {settings.hstAccount ? (
            <Text style={styles.registrantLine}>HST account: {settings.hstAccount}</Text>
          ) : null}
        </View>

        <View style={styles.metaStrip} >
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>DUE DATE</Text>
            <Text style={styles.metaValue}>{formatLongDate(dueDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>STATUS</Text>
            <Text style={styles.metaValue}>{status === "filed" ? "Filed" : "Draft"}</Text>
          </View>
          {status === "filed" && craConfirmationNumber ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>CRA CONFIRMATION #</Text>
              <Text style={styles.metaValue}>{craConfirmationNumber}</Text>
            </View>
          ) : null}
          {status === "filed" && filedAt ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>FILED ON</Text>
              <Text style={styles.metaValue}>{formatLongDate(filedAt)}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.methodPill, { backgroundColor: isQuick ? brandAccent : brandPrimary }]}>
          <Text style={styles.methodPillText}>
            {isQuick ? "QUICK METHOD" : "REGULAR METHOD"}
            {isQuick && isFirstQmFy ? " — FIRST-YEAR CREDIT" : ""}
          </Text>
        </View>

        <View style={styles.lineTable}>
          <View style={styles.lineHead}>
            <Text style={[styles.colNumber, { fontFamily: "Helvetica-Bold" }]}>LINE</Text>
            <Text style={[styles.colLabel, { fontFamily: "Helvetica-Bold" }]}>DESCRIPTION</Text>
            <Text style={[styles.colAmount, { fontFamily: "Helvetica-Bold" }]}>AMOUNT</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.colNumber}>101</Text>
            <Text style={styles.colLabel}>Total revenue (taxable supplies)</Text>
            <Text style={styles.colAmount}>{fmt(lines.line101)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.colNumber}>103</Text>
            <Text style={styles.colLabel}>
              {isQuick ? "Quick Method remittance (net of credit)" : "GST/HST collected"}
            </Text>
            <Text style={styles.colAmount}>{fmt(lines.line103)}</Text>
          </View>

          {isQuick && lines.quickCredit > 0 ? (
            <View style={styles.lineRow}>
              <Text style={styles.colNumber}></Text>
              <Text style={[styles.colLabel, { color: COLORS.muted, fontSize: 9 }]}>
                  incl. first-year 1% credit on first $30K
              </Text>
              <Text style={[styles.colAmount, { color: COLORS.muted, fontSize: 9 }]}>
                {fmt(-lines.quickCredit)}
              </Text>
            </View>
          ) : null}

          <View style={styles.lineRow}>
            <Text style={styles.colNumber}>105</Text>
            <Text style={styles.colLabel}>Total GST/HST + adjustments</Text>
            <Text style={styles.colAmount}>{fmt(lines.line105)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.colNumber}>106</Text>
            <Text style={styles.colLabel}>
              {isQuick ? "ITCs — capital asset purchases only" : "ITCs claimed"}
            </Text>
            <Text style={styles.colAmount}>{fmt(lines.line106)}</Text>
          </View>

          {lines.line107 !== 0 ? (
            <View style={styles.lineRow}>
              <Text style={styles.colNumber}>107</Text>
              <Text style={styles.colLabel}>Meals &amp; entertainment 50% ITC cap (ETA s.236)</Text>
              <Text style={styles.colAmount}>{fmt(lines.line107)}</Text>
            </View>
          ) : null}

          <View style={styles.lineRow}>
            <Text style={styles.colNumber}>108</Text>
            <Text style={styles.colLabel}>Total ITCs + adjustments</Text>
            <Text style={styles.colAmount}>{fmt(lines.line108)}</Text>
          </View>
        </View>

        <View style={[styles.netBlock, { backgroundColor: lines.line109 >= 0 ? brandPrimary : brandAccent }]}>
          <Text style={styles.netLabel}>
            LINE 109 — {lines.line109 >= 0 ? "NET TAX OWED TO CRA" : "REFUND DUE"}
          </Text>
          <Text style={styles.netValue}>{fmt(Math.abs(lines.line109))}</Text>
        </View>

        {status === "draft" ? (
          <Text style={styles.notes}>
            This summary is a draft. File via CRA My Business Account or GST/HST NETFILE
            on or before {formatLongDate(dueDate)} and then record the confirmation
            number to lock the period.
          </Text>
        ) : null}

        <Text style={styles.footer}>
          {settings.corpLegalName} · {settings.directorEmail} · Generated by Invoiced
        </Text>
      </Page>
    </Document>
  );
}
