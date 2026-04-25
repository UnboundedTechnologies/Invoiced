/**
 * T4A Statement of Pension, Retirement, Annuity, and Other Income —
 * working-copy / filed PDF.
 *
 * For Saïd's corp the only T4A box that applies is Box 117 (Loan Benefits)
 * = Σ s.80.4(2) deemed-interest benefits + Σ s.15(2) inclusions for loans
 * past the 15(2.6) deadline. Box 022 (Income tax deducted) is always 0
 * because the corp doesn't withhold on these inclusions.
 *
 * This is NOT a CRA-filed slip — it's a working copy Saïd re-keys into
 * CRA Web Forms. SIN is rendered as a labelled blank per the project rule.
 *
 * Multi-page document mirrors t4-slip-pdf.tsx:
 *   Page 1 — Overview
 *   Page 2 — T4A Summary (totals across all T4A slips — 1 for Saïd)
 *   Page 3 — T4A slip · CRA copy
 *   Page 4 — T4A slip · Payer copy
 *   Page 5 — T4A slip · Recipient copy
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";
import type { T4ASlipBoxes } from "@/lib/slip-boxes";

export type T4ASlipPDFProps = {
  taxYear: number;
  boxes: T4ASlipBoxes;
  status: "draft" | "filed";
  filed?: {
    craConfirmationNumber: string | null;
    filedAt: string;
  };
  payer: {
    corpLegalName: string;
    businessNumber: string;
    payrollAccount: string | null;
    payerRzAccount: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  recipient: {
    legalName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  bannerDataUri?: string;
  filingDueDate: string;
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
  border: "#c4c4d4",
  cardBg: "#fafafd",
  watermark: "#f2d5d5",
  indigo: "#4f46e5",
  indigoBg: "#eef2ff",
  indigoBorder: "#c7d2fe",
  indigoInk: "#3730a3",
  amber: "#f59e0b",
  amberBg: "#fef3c7",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 64,
    paddingHorizontal: 44,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.ink,
    lineHeight: 1.4,
  },
  watermark: {
    position: "absolute",
    left: 30,
    right: 30,
    top: 340,
    fontSize: 54,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 6,
    color: COLORS.watermark,
    textAlign: "center",
    transform: "rotate(-32deg)",
    transformOrigin: "center",
  },
  banner: { width: "100%", marginBottom: 12 },
  ribbonWork: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.indigo,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  ribbonWorkLabel: { color: "#ffffff", fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  ribbonWorkNote: { color: "#e0e7ff", fontSize: 8, letterSpacing: 0.4 },
  ribbonFiled: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#047857",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  ribbonFiledLabel: { color: "#ffffff", fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  ribbonFiledNote: { color: "#d1fae5", fontSize: 8, letterSpacing: 0.4 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 4 },
  subtitle: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  h2: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 1,
    color: COLORS.ink,
    textTransform: "uppercase",
  },
  copyTag: {
    position: "absolute",
    top: 16,
    right: 44,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: COLORS.indigoInk,
    backgroundColor: COLORS.indigoBg,
    borderWidth: 0.5,
    borderColor: COLORS.indigoBorder,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  identityRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  identityCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBg,
    padding: 8,
  },
  identityLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  identityName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 2 },
  identityLine: { color: COLORS.muted, fontSize: 9, marginBottom: 1 },
  boxTable: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBg,
  },
  boxRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  boxRowLast: { borderBottomWidth: 0 },
  boxNumCell: { width: 60, flexDirection: "row", alignItems: "center" },
  boxNumBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.indigoInk,
    backgroundColor: COLORS.indigoBg,
    borderWidth: 0.5,
    borderColor: COLORS.indigoBorder,
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  boxLabelCell: { flex: 1 },
  boxLabel: { fontSize: 9, color: COLORS.ink },
  boxLabelMuted: { fontSize: 9, color: COLORS.muted, fontStyle: "italic" },
  boxAmountCell: { width: 90, textAlign: "right" },
  boxAmount: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  sinRow: {
    marginTop: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.amber,
    backgroundColor: COLORS.amberBg,
  },
  sinLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#713f12",
    marginBottom: 3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sinBlank: { fontSize: 12, fontFamily: "Courier-Bold", color: COLORS.ink, letterSpacing: 2 },
  sinHint: { fontSize: 8, color: "#713f12", marginTop: 3, fontStyle: "italic" },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 44,
    right: 44,
    fontSize: 7,
    color: COLORS.faint,
    textAlign: "center",
    lineHeight: 1.3,
  },
});

function SlipRibbon({ props }: { props: T4ASlipPDFProps }) {
  if (props.status === "filed") {
    const cra = props.filed?.craConfirmationNumber;
    const filedAt = props.filed?.filedAt;
    return (
      <View style={styles.ribbonFiled}>
        <Text style={styles.ribbonFiledLabel}>FILED</Text>
        <Text style={styles.ribbonFiledNote}>
          {cra ? `CRA #${cra}` : "Filed with CRA"}
          {filedAt ? ` · ${formatLongDate(filedAt)}` : ""}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.ribbonWork}>
      <Text style={styles.ribbonWorkLabel}>WORKING COPY</Text>
      <Text style={styles.ribbonWorkNote}>
        Not a CRA-filed slip · Re-key values into CRA Web Forms at canada.ca
      </Text>
    </View>
  );
}

function Watermark({ status }: { status: "draft" | "filed" }) {
  if (status === "filed") return null;
  return (
    <Text style={styles.watermark} fixed>
      WORKING COPY
    </Text>
  );
}

function BoxRow({
  boxNum,
  label,
  value,
  muted = false,
  last = false,
}: {
  boxNum?: string;
  label: string;
  value: number;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <View style={last ? [styles.boxRow, styles.boxRowLast] : styles.boxRow}>
      <View style={styles.boxNumCell}>
        {boxNum ? <Text style={styles.boxNumBadge}>{boxNum}</Text> : <Text>{" "}</Text>}
      </View>
      <View style={styles.boxLabelCell}>
        <Text style={muted ? styles.boxLabelMuted : styles.boxLabel}>{label}</Text>
      </View>
      <View style={styles.boxAmountCell}>
        <Text style={styles.boxAmount}>{fmt(value)}</Text>
      </View>
    </View>
  );
}

function PayerCard(props: T4ASlipPDFProps["payer"]) {
  const accountLine = props.payerRzAccount
    ? props.payerRzAccount
    : props.payrollAccount
      ? props.payrollAccount
      : "— not registered —";
  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityLabel}>Payer</Text>
      <Text style={styles.identityName}>{props.corpLegalName}</Text>
      <Text style={styles.identityLine}>
        {props.addressLine1}
        {props.addressLine2 ? `, ${props.addressLine2}` : ""}
      </Text>
      <Text style={styles.identityLine}>
        {props.city}, {props.province} {props.postalCode}
      </Text>
      <Text style={[styles.identityLine, { marginTop: 3 }]}>
        <Text style={{ color: COLORS.ink, fontFamily: "Helvetica-Bold" }}>Box 061 · Account #:</Text>{" "}
        {accountLine}
      </Text>
    </View>
  );
}

function RecipientCard(props: T4ASlipPDFProps["recipient"]) {
  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityLabel}>Recipient</Text>
      <Text style={styles.identityName}>{props.legalName}</Text>
      <Text style={styles.identityLine}>
        {props.addressLine1}
        {props.addressLine2 ? `, ${props.addressLine2}` : ""}
      </Text>
      <Text style={styles.identityLine}>
        {props.city}, {props.province} {props.postalCode}
      </Text>
    </View>
  );
}

function SinBlank() {
  return (
    <View style={styles.sinRow}>
      <Text style={styles.sinLabel}>Box 012 · Social Insurance Number (SIN)</Text>
      <Text style={styles.sinBlank}>_ _ _  -  _ _ _  -  _ _ _</Text>
      <Text style={styles.sinHint}>
        Not stored in the app — enter on the CRA Web Forms page at filing time.
      </Text>
    </View>
  );
}

function T4ASlipPage({ copyLabel, props }: { copyLabel: string; props: T4ASlipPDFProps }) {
  const { taxYear, boxes, payer, recipient, filingDueDate, status } = props;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <Watermark status={status} />
      <Text style={styles.copyTag}>{copyLabel}</Text>
      <SlipRibbon props={props} />
      <Text style={styles.title}>T4A · Statement of Other Income</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)}
      </Text>

      <View style={styles.identityRow}>
        <PayerCard {...payer} />
        <RecipientCard {...recipient} />
      </View>

      <SinBlank />

      <Text style={styles.h2}>Boxes — Calendar year {taxYear}</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 022" label="Income tax deducted (corp doesn't withhold on loan benefits)" value={boxes.box022TaxWithheldCents} muted />
        <BoxRow boxNum="Box 117" label="Loan benefits — s.80.4(2) + s.15(2) inclusions" value={boxes.box117Cents} last />
      </View>

      <Text style={styles.h2}>Audit breakdown (informational — not on the CRA T4A)</Text>
      <View style={styles.boxTable}>
        <BoxRow label="s.80.4(2) deemed-interest benefit (after interest-paid offset)" value={boxes.breakdown.benefit80_4Cents} muted />
        <BoxRow label="s.15(2) inclusion (loan past 15(2.6) deadline)" value={boxes.breakdown.inclusion15_2Cents} muted last />
      </View>

      <Text style={styles.footer} fixed>
        {status === "filed" ? "Filed record" : "Working copy"} · Invoiced {boxes.ratesEditionTag} · CY {taxYear}
        {status === "filed" ? " · Frozen snapshot" : " · Re-key into CRA Web Forms"}.
      </Text>
    </Page>
  );
}

function T4ASummaryPage({ props }: { props: T4ASlipPDFProps }) {
  const { taxYear, boxes, payer, filingDueDate, status } = props;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <Watermark status={status} />
      <Text style={styles.copyTag}>SUMMARY</Text>
      <SlipRibbon props={props} />
      <Text style={styles.title}>T4A Summary · Payer T4A totals</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)} · 1 recipient
      </Text>

      <Text style={styles.h2}>Payer</Text>
      <View style={styles.identityRow}>
        <PayerCard {...payer} />
      </View>

      <Text style={styles.h2}>Amounts from all T4A slips for {taxYear}</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Line 022" label="Total income tax withheld (Σ all Box 022)" value={boxes.box022TaxWithheldCents} muted />
        <BoxRow boxNum="Line 117" label="Total loan benefits (Σ all Box 117)" value={boxes.box117Cents} last />
      </View>

      <Text style={styles.footer} fixed>
        {status === "filed" ? "Filed record" : "Working copy"} · Invoiced {boxes.ratesEditionTag}
        {status === "filed"
          ? " · T4A Summary frozen at file time"
          : " · File the T4A Summary alongside the slip on the same CRA Web Forms submission"}.
      </Text>
    </Page>
  );
}

export function T4ASlipPDF(props: T4ASlipPDFProps) {
  const { bannerDataUri, status, taxYear } = props;
  const titleLabel = status === "filed" ? "Filed Record" : "Working-Copy Bundle";
  const subtitleLabel =
    status === "filed"
      ? `This PDF is the frozen filed record of the T4A slip (3 copies) + T4A Summary for calendar year ${taxYear}.`
      : `This PDF bundles the T4A slip (3 copies) + T4A Summary for calendar year ${taxYear}.`;
  return (
    <Document>
      {/* Page 1 — Overview */}
      <Page size="LETTER" style={styles.page} wrap={false}>
        <Watermark status={status} />
        {bannerDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={bannerDataUri} style={styles.banner} />
        ) : null}
        <Text style={styles.copyTag}>OVERVIEW</Text>
        <SlipRibbon props={props} />
        <Text style={styles.title}>T4A {titleLabel} · CY {taxYear}</Text>
        <Text style={styles.subtitle}>
          {subtitleLabel}
          {status === "filed"
            ? " Store alongside your other filed returns; no action required."
            : " Use it as a data-entry reference when filing via CRA Web Forms."}
        </Text>
        {status === "filed" ? (
          <>
            <Text style={styles.h2}>Filing record</Text>
            <View style={{ ...styles.boxTable, padding: 10 }}>
              <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
                Filed with CRA on {props.filed?.filedAt ? formatLongDate(props.filed.filedAt) : "—"}.
                {props.filed?.craConfirmationNumber ? (
                  <>
                    {"\n"}CRA confirmation number: {props.filed.craConfirmationNumber}.
                  </>
                ) : null}
                {"\n"}
                Box values below are the frozen snapshot taken at filing time. Corrections after
                filing route through an amended T4A — cannot be reversed from within Invoiced.
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.h2}>Filing reminder</Text>
            <View style={{ ...styles.boxTable, padding: 10 }}>
              <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
                1. Open CRA Web Forms → canada.ca/en/revenue-agency/services/e-services/web-forms.html{"\n"}
                2. Select the T4A program. Use your RP / RZ payer account number.{"\n"}
                3. Re-key Box 117 (Loan Benefits) and Box 022 (income tax withheld, $0).{"\n"}
                4. Enter the recipient&rsquo;s SIN directly on the CRA form — this app never stores it.{"\n"}
                5. Submit and save CRA&rsquo;s confirmation number. Store that, not this working copy.
              </Text>
            </View>
          </>
        )}
        <Text style={styles.footer} fixed>
          {status === "filed" ? "Filed record" : "Working copy"} · Invoiced {props.boxes.ratesEditionTag}
          {status === "filed" ? " · Frozen snapshot from the filing action." : " · Not a CRA-filed slip — reference only."}.
        </Text>
      </Page>
      <T4ASummaryPage props={props} />
      <T4ASlipPage copyLabel="CRA COPY (PAGE 3)" props={props} />
      <T4ASlipPage copyLabel="PAYER COPY (PAGE 4)" props={props} />
      <T4ASlipPage copyLabel="RECIPIENT COPY (PAGE 5)" props={props} />
    </Document>
  );
}
