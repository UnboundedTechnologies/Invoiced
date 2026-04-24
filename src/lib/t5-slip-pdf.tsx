/**
 * T5 Statement of Investment Income — working-copy PDF.
 *
 * NOT a CRA-filed slip. Saïd re-keys each box into CRA Web Forms.
 * Per the SIN-never-stored rule the recipient SIN is a blank marker.
 *
 * Multi-page document:
 *   Page 1 — Overview + filing reminder
 *   Page 2 — T5 Summary (payer totals)
 *   Page 3 — T5 slip (CRA copy)
 *   Page 4 — T5 slip (Payer copy)
 *   Page 5 — T5 slip (Recipient copy)
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";
import type { T5SlipBoxes } from "@/lib/slip-boxes";

export type T5SlipPDFProps = {
  taxYear: number;
  boxes: T5SlipBoxes;
  payer: {
    corpLegalName: string;
    businessNumber: string;
    payerRzAccount: string | null;
    payerRzActive: boolean;
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
  borderStrong: "#0a0a14",
  cardBg: "#fafafd",
  watermark: "#e9d8f2",
  violet: "#7c3aed",
  violetBg: "#f3ebff",
  violetBorder: "#ddd0f4",
  violetInk: "#5b21b6",
  amber: "#f59e0b",
  amberBg: "#fef3c7",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 48,
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
    backgroundColor: COLORS.violet,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  ribbonWorkLabel: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
  },
  ribbonWorkNote: {
    color: "#ede9fe",
    fontSize: 8,
    fontFamily: "Helvetica",
    letterSpacing: 0.4,
  },
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
  h3: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    marginBottom: 4,
    color: COLORS.violetInk,
  },
  copyTag: {
    position: "absolute",
    top: 16,
    right: 44,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: COLORS.violetInk,
    backgroundColor: COLORS.violetBg,
    borderWidth: 0.5,
    borderColor: COLORS.violetBorder,
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
  boxNumCell: { width: 54, flexDirection: "row", alignItems: "center" },
  boxNumBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.violetInk,
    backgroundColor: COLORS.violetBg,
    borderWidth: 0.5,
    borderColor: COLORS.violetBorder,
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  boxLabelCell: { flex: 1 },
  boxLabel: { fontSize: 9, color: COLORS.ink },
  boxLabelMuted: { fontSize: 9, color: COLORS.muted, fontStyle: "italic" },
  boxAmountCell: { width: 90, textAlign: "right" },
  boxAmount: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  boxBlank: { fontSize: 10, color: COLORS.faint, textAlign: "right" },
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
  sinBlank: {
    fontSize: 12,
    fontFamily: "Courier-Bold",
    color: COLORS.ink,
    letterSpacing: 2,
  },
  sinHint: {
    fontSize: 8,
    color: "#713f12",
    marginTop: 3,
    fontStyle: "italic",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 7,
    color: COLORS.faint,
    textAlign: "center",
    lineHeight: 1.3,
  },
});

function WorkingCopyRibbon() {
  return (
    <View style={styles.ribbonWork}>
      <Text style={styles.ribbonWorkLabel}>WORKING COPY</Text>
      <Text style={styles.ribbonWorkNote}>
        Not a CRA-filed slip · Re-key values into CRA Web Forms at canada.ca
      </Text>
    </View>
  );
}

function WorkingCopyWatermark() {
  return (
    <Text style={styles.watermark} fixed>
      WORKING COPY
    </Text>
  );
}

function BoxNumBadge({ n }: { n: string }) {
  return <Text style={styles.boxNumBadge}>{n}</Text>;
}

function BoxRow({
  boxNum,
  label,
  value,
  muted = false,
  last = false,
  blank = false,
}: {
  boxNum?: string;
  label: string;
  value?: number;
  muted?: boolean;
  last?: boolean;
  blank?: boolean;
}) {
  return (
    <View style={last ? [styles.boxRow, styles.boxRowLast] : styles.boxRow}>
      <View style={styles.boxNumCell}>
        {boxNum ? <BoxNumBadge n={boxNum} /> : <Text>{" "}</Text>}
      </View>
      <View style={styles.boxLabelCell}>
        <Text style={muted ? styles.boxLabelMuted : styles.boxLabel}>{label}</Text>
      </View>
      <View style={styles.boxAmountCell}>
        {blank ? (
          <Text style={styles.boxBlank}>—</Text>
        ) : (
          <Text style={styles.boxAmount}>{fmt(value ?? 0)}</Text>
        )}
      </View>
    </View>
  );
}

function PayerIdentityCard(props: T5SlipPDFProps["payer"]) {
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
        <Text style={{ color: COLORS.ink, fontFamily: "Helvetica-Bold" }}>Payer BN/RZ:</Text>{" "}
        {props.payerRzAccount
          ? props.payerRzAccount + (props.payerRzActive ? "" : " (inactive)")
          : "— not registered —"}
      </Text>
    </View>
  );
}

function RecipientIdentityCard(props: T5SlipPDFProps["recipient"]) {
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

function SinBlankBlock() {
  return (
    <View style={styles.sinRow}>
      <Text style={styles.sinLabel}>Recipient SIN (T5 recipient identification)</Text>
      <Text style={styles.sinBlank}>_ _ _  -  _ _ _  -  _ _ _</Text>
      <Text style={styles.sinHint}>
        Not stored in the app — enter on the CRA Web Forms page at filing time.
      </Text>
    </View>
  );
}

function T5SlipPage({
  copyLabel,
  props,
}: {
  copyLabel: string;
  props: T5SlipPDFProps;
}) {
  const { taxYear, boxes, payer, recipient, filingDueDate } = props;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <WorkingCopyWatermark />
      <Text style={styles.copyTag}>{copyLabel}</Text>
      <WorkingCopyRibbon />
      <Text style={styles.title}>T5 · Statement of Investment Income</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)}
      </Text>

      <View style={styles.identityRow}>
        <PayerIdentityCard {...payer} />
        <RecipientIdentityCard {...recipient} />
      </View>

      <SinBlankBlock />

      <Text style={styles.h2}>Recipient metadata</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 21" label="Report code" value={undefined} blank />
        <View style={{ paddingLeft: 60, paddingBottom: 3, paddingTop: 1 }}>
          <Text style={{ fontSize: 8, color: COLORS.muted, fontStyle: "italic" }}>
            = O (Original). Use A for Amended, C for Cancelled.
          </Text>
        </View>
        <BoxRow boxNum="Box 22" label="Recipient type" value={undefined} blank />
        <View style={{ paddingLeft: 60, paddingBottom: 3, paddingTop: 1 }}>
          <Text style={{ fontSize: 8, color: COLORS.muted, fontStyle: "italic" }}>
            = 1 (Individual). 2=Joint, 3=Corporation, 4=Other.
          </Text>
        </View>
        <BoxRow boxNum="Box 27" label="Foreign currency (enter if non-CAD)" value={undefined} blank last />
      </View>

      <Text style={styles.h2}>Eligible dividends (from corp GRIP pool)</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 24" label="Actual amount of eligible dividends" value={boxes.eligible.actualCents} />
        <BoxRow boxNum="Box 25" label="Taxable amount of eligible dividends (× 1.38 gross-up)" value={boxes.eligible.taxableCents} />
        <BoxRow boxNum="Box 26" label="Dividend tax credit for eligible dividends (15.0198% × Box 25)" value={boxes.eligible.federalDtcCents} last />
      </View>

      <Text style={styles.h2}>Other-than-eligible dividends</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 10" label="Actual amount of non-eligible dividends" value={boxes.nonEligible.actualCents} />
        <BoxRow boxNum="Box 11" label="Taxable amount of non-eligible dividends (× 1.15 gross-up)" value={boxes.nonEligible.taxableCents} />
        <BoxRow boxNum="Box 12" label="Dividend tax credit for non-eligible dividends (9.0301% × Box 11)" value={boxes.nonEligible.federalDtcCents} last />
      </View>

      <Text style={styles.h2}>Other investment income (for completeness — typically blank)</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 13" label="Interest from Canadian sources" value={undefined} muted last blank />
      </View>

      <Text style={styles.h2}>Provincial context (informational)</Text>
      <View style={styles.boxTable}>
        <BoxRow label="Ontario DTC — eligible dividends (10% × Box 25)" value={boxes.eligible.ontarioDtcCents} muted />
        <BoxRow label="Ontario DTC — non-eligible dividends (2.9863% × Box 11, 2026)" value={boxes.nonEligible.ontarioDtcCents} muted last />
      </View>

      <Text style={styles.footer} fixed>
        Working copy generated by Invoiced · {boxes.ratesEditionTag} · Eligible/non-eligible split driven by
        each dividend&rsquo;s manual flag ({boxes.eligible.count} eligible,{" "}
        {boxes.nonEligible.count} non-eligible; paid-date in CY {taxYear}).
        {"\n"}
        Store the CRA-issued slip after filing, not this working copy.
      </Text>
    </Page>
  );
}

function T5SummaryPage({ props }: { props: T5SlipPDFProps }) {
  const { taxYear, boxes, payer, filingDueDate } = props;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <WorkingCopyWatermark />
      <Text style={styles.copyTag}>SUMMARY</Text>
      <WorkingCopyRibbon />
      <Text style={styles.title}>T5 Summary · Payer T5 totals</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)} ·{" "}
        {boxes.eligible.count + boxes.nonEligible.count} paid dividend
        {boxes.eligible.count + boxes.nonEligible.count === 1 ? "" : "s"}
      </Text>

      <Text style={styles.h2}>Payer</Text>
      <View style={styles.identityRow}>
        <PayerIdentityCard {...payer} />
      </View>

      <Text style={styles.h2}>Amounts from all T5 slips for {taxYear}</Text>
      <View style={styles.boxTable}>
        <BoxRow label="Total actual eligible dividends paid (Σ all Box 24)" value={boxes.eligible.actualCents} />
        <BoxRow label="Total taxable eligible dividends (Σ all Box 25)" value={boxes.eligible.taxableCents} />
        <BoxRow label="Total federal DTC — eligible (Σ all Box 26)" value={boxes.eligible.federalDtcCents} />
        <BoxRow label="Total actual non-eligible dividends paid (Σ all Box 10)" value={boxes.nonEligible.actualCents} />
        <BoxRow label="Total taxable non-eligible dividends (Σ all Box 11)" value={boxes.nonEligible.taxableCents} />
        <BoxRow label="Total federal DTC — non-eligible (Σ all Box 12)" value={boxes.nonEligible.federalDtcCents} last />
      </View>

      <Text style={styles.h2}>Grand totals</Text>
      <View style={styles.boxTable}>
        <BoxRow label="Total actual dividends paid (all recipients)" value={boxes.totals.actualCents} />
        <BoxRow label="Total taxable (grossed-up) dividends" value={boxes.totals.taxableCents} />
        <BoxRow label="Total federal dividend tax credits" value={boxes.totals.federalDtcCents} />
        <BoxRow label="Total Ontario DTC (informational)" value={boxes.totals.ontarioDtcCents} last />
      </View>

      <Text style={styles.footer} fixed>
        Working copy generated by Invoiced · {boxes.ratesEditionTag}.
        {"\n"}
        File the T5 Summary with the slip on the same CRA Web Forms submission. Store the CRA-issued version, not this PDF.
      </Text>
    </Page>
  );
}

export function T5SlipPDF(props: T5SlipPDFProps) {
  const { bannerDataUri } = props;
  return (
    <Document>
      {/* Page 1 — Overview */}
      <Page size="LETTER" style={styles.page} wrap={false}>
        <WorkingCopyWatermark />
        {bannerDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={bannerDataUri} style={styles.banner} />
        ) : null}
        <Text style={styles.copyTag}>OVERVIEW</Text>
        <WorkingCopyRibbon />
        <Text style={styles.title}>T5 Working-Copy Bundle · CY {props.taxYear}</Text>
        <Text style={styles.subtitle}>
          This PDF bundles the T5 slip (3 copies) + T5 Summary for calendar year {props.taxYear}.
          Use it as a data-entry reference when filing via CRA Web Forms.
        </Text>
        <Text style={styles.h2}>Contents</Text>
        <View style={styles.boxTable}>
          <BoxRow label="Page 2 — T5 Summary (payer totals)" value={undefined} blank />
          <BoxRow label="Page 3 — T5 slip · CRA copy" value={undefined} blank />
          <BoxRow label="Page 4 — T5 slip · Payer copy" value={undefined} blank />
          <BoxRow label="Page 5 — T5 slip · Recipient copy" value={undefined} blank last />
        </View>
        <Text style={styles.h2}>Filing reminder</Text>
        <View style={{ ...styles.boxTable, padding: 10 }}>
          <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
            1. Open CRA Web Forms → canada.ca/en/revenue-agency/services/e-services/web-forms.html{"\n"}
            2. Select the T5 program. Your info-returns account (RZ) identifies the payer.{"\n"}
            3. Re-key each Box value from this PDF into the Web Forms fields.{"\n"}
            4. Enter the recipient&rsquo;s SIN directly on the CRA form — this app never stores it.{"\n"}
            5. Submit and save CRA&rsquo;s confirmation number. Store that version, not this working copy.
          </Text>
        </View>
        <Text style={styles.footer} fixed>
          Working copy generated by Invoiced · {props.boxes.ratesEditionTag} · Not a CRA-filed slip.
        </Text>
      </Page>
      {/* Page 2 — T5 Summary */}
      <T5SummaryPage props={props} />
      {/* Pages 3-5 — T5 slip copies */}
      <T5SlipPage copyLabel="CRA COPY (PAGE 3)" props={props} />
      <T5SlipPage copyLabel="PAYER COPY (PAGE 4)" props={props} />
      <T5SlipPage copyLabel="RECIPIENT COPY (PAGE 5)" props={props} />
    </Document>
  );
}
