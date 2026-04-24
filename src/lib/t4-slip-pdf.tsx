/**
 * T4 Statement of Remuneration Paid — working-copy PDF.
 *
 * This is NOT a CRA-filed slip. It's a working copy Saïd re-keys into CRA
 * Web Forms at canada.ca. Accepts "acceptable facsimile" requirements are
 * irrelevant since the PDF is never sent to CRA — every box is rendered
 * plainly so a human can read and transcribe.
 *
 * Per the SIN-never-stored rule, the recipient's SIN is rendered as a
 * labelled blank the user fills in on the CRA form at filing time.
 *
 * Multi-page document:
 *   Page 1 — T4 Summary (totals across all T4 slips — 1 slip for Saïd)
 *   Page 2 — T4 slip (CRA copy)
 *   Page 3 — T4 slip (Payer copy)
 *   Page 4 — T4 slip (Recipient copy)
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";
import type { T4SlipBoxes } from "@/lib/slip-boxes";

export type T4SlipPDFProps = {
  taxYear: number;
  boxes: T4SlipBoxes;
  payer: {
    corpLegalName: string;
    businessNumber: string;
    payrollAccount: string | null;
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
  ribbonWorkLabel: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
  },
  ribbonWorkNote: {
    color: "#e0e7ff",
    fontSize: 8,
    fontFamily: "Helvetica",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.2,
    marginBottom: 4,
  },
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
  // Identity blocks: 2-column grid (payer | recipient)
  identityRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
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
  identityName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 2,
  },
  identityLine: {
    color: COLORS.muted,
    fontSize: 9,
    marginBottom: 1,
  },
  // Box grid — 2-column table of (box#, label, amount)
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
  boxNumCell: {
    width: 54,
    flexDirection: "row",
    alignItems: "center",
  },
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
  boxBlank: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.faint,
    textAlign: "right",
  },
  // SIN blank row — emphasized
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
    bottom: 32,
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

function PayerIdentityCard(props: T4SlipPDFProps["payer"]) {
  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityLabel}>Employer / Payer</Text>
      <Text style={styles.identityName}>{props.corpLegalName}</Text>
      <Text style={styles.identityLine}>
        {props.addressLine1}
        {props.addressLine2 ? `, ${props.addressLine2}` : ""}
      </Text>
      <Text style={styles.identityLine}>
        {props.city}, {props.province} {props.postalCode}
      </Text>
      <Text style={[styles.identityLine, { marginTop: 3 }]}>
        <Text style={{ color: COLORS.ink, fontFamily: "Helvetica-Bold" }}>Box 54 · Employer BN/RP:</Text>{" "}
        {props.payrollAccount ? props.payrollAccount : "— not registered —"}
      </Text>
    </View>
  );
}

function RecipientIdentityCard(props: T4SlipPDFProps["recipient"]) {
  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityLabel}>Employee / Recipient</Text>
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
      <Text style={styles.sinLabel}>Box 12 · Social Insurance Number (SIN)</Text>
      <Text style={styles.sinBlank}>_ _ _  -  _ _ _  -  _ _ _</Text>
      <Text style={styles.sinHint}>
        Not stored in the app — enter on the CRA Web Forms page at filing time.
      </Text>
    </View>
  );
}

function T4SlipPage({
  copyLabel,
  props,
}: {
  copyLabel: string;
  props: T4SlipPDFProps;
}) {
  const { taxYear, boxes, payer, recipient, filingDueDate } = props;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <WorkingCopyWatermark />
      <Text style={styles.copyTag}>{copyLabel}</Text>
      <WorkingCopyRibbon />
      <Text style={styles.title}>T4 · Statement of Remuneration Paid</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)}
      </Text>

      <View style={styles.identityRow}>
        <PayerIdentityCard {...payer} />
        <RecipientIdentityCard {...recipient} />
      </View>

      <SinBlankBlock />

      <Text style={styles.h2}>Income + deductions — Calendar year {taxYear}</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Box 10" label="Province of employment" value={undefined} blank />
        <View style={{ paddingLeft: 60, paddingBottom: 3, paddingTop: 1 }}>
          <Text style={{ fontSize: 8, color: COLORS.muted, fontStyle: "italic" }}>= ON (Ontario)</Text>
        </View>
        <BoxRow boxNum="Box 14" label="Employment income" value={boxes.box14EmploymentIncomeCents} />
        <BoxRow boxNum="Box 16" label="CPP employee contributions (base, 5.95%)" value={boxes.box16CppBaseCents} />
        <BoxRow boxNum="Box 16A" label="CPP2 employee contributions (enhanced, 4%)" value={boxes.box16aCpp2Cents} />
        <BoxRow boxNum="Box 18" label="EI premiums (owner-manager exempt)" value={boxes.box18EiCents} muted />
        <BoxRow boxNum="Box 22" label="Income tax deducted — Federal" value={boxes.box22FedTaxWithheldCents} />
        <BoxRow label="Income tax deducted — Ontario (informational)" value={boxes.ontarioTaxWithheldCents} />
        <BoxRow boxNum="Box 24" label="EI insurable earnings (owner-manager exempt)" value={boxes.box24EiInsurableCents} muted />
        <BoxRow boxNum="Box 26" label="CPP pensionable earnings" value={boxes.box26CppPensionableCents} />
        <BoxRow boxNum="Box 28" label="CPP/QPP + EI exempt indicator" value={undefined} blank />
        <View style={{ paddingLeft: 60, paddingBottom: 3, paddingTop: 1 }}>
          <Text style={{ fontSize: 8, color: COLORS.muted, fontStyle: "italic" }}>
            = Tick EI-exempt box (owner-manager &gt;40% voting shares)
          </Text>
        </View>
        <BoxRow boxNum="Box 52" label="Pension adjustment" value={boxes.box52PensionAdjustmentCents} muted last />
      </View>

      <Text style={styles.h2}>Employer remittance context (for T4 Summary)</Text>
      <View style={styles.boxTable}>
        <BoxRow label="Employer CPP contribution (matching, base)" value={boxes.employerCppBaseCents} />
        <BoxRow label="Employer CPP2 contribution (matching, enhanced)" value={boxes.employerCpp2Cents} last />
      </View>

      <Text style={styles.footer} fixed>
        Working copy · Invoiced {boxes.ratesEditionTag} · Σ {boxes.paychequeCount} issued paycheque
        {boxes.paychequeCount === 1 ? "" : "s"} in CY {taxYear} · Re-key into CRA Web Forms; store the CRA version.
      </Text>
    </Page>
  );
}

function T4SummaryPage({ props }: { props: T4SlipPDFProps }) {
  const { taxYear, boxes, payer, filingDueDate } = props;
  const totalTaxWithheld = boxes.box22FedTaxWithheldCents + boxes.ontarioTaxWithheldCents;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <WorkingCopyWatermark />
      <Text style={styles.copyTag}>SUMMARY</Text>
      <WorkingCopyRibbon />
      <Text style={styles.title}>T4 Summary · Employer T4 totals</Text>
      <Text style={styles.subtitle}>
        Calendar year {taxYear} · Filing due {formatLongDate(filingDueDate)} · {boxes.paychequeCount} paycheque{boxes.paychequeCount === 1 ? "" : "s"}
      </Text>

      <Text style={styles.h2}>Employer</Text>
      <View style={styles.identityRow}>
        <PayerIdentityCard {...payer} />
      </View>

      <Text style={styles.h2}>Amounts from all T4 slips for {taxYear}</Text>
      <View style={styles.boxTable}>
        <BoxRow boxNum="Line 14" label="Total employment income (Σ all T4 Box 14)" value={boxes.box14EmploymentIncomeCents} />
        <BoxRow boxNum="Line 16" label="Total CPP base contributions (Σ all Box 16)" value={boxes.box16CppBaseCents} />
        <BoxRow boxNum="Line 16A" label="Total CPP2 contributions (Σ all Box 16A)" value={boxes.box16aCpp2Cents} />
        <BoxRow boxNum="Line 18" label="Total EI premiums (Σ all Box 18 — owner-mgr exempt)" value={boxes.box18EiCents} muted />
        <BoxRow boxNum="Line 22" label="Total federal tax withheld (Σ all Box 22)" value={boxes.box22FedTaxWithheldCents} />
        <BoxRow label="Total Ontario tax withheld (informational)" value={boxes.ontarioTaxWithheldCents} last />
      </View>

      <Text style={styles.h2}>Employer contributions (what you remitted with source deductions)</Text>
      <View style={styles.boxTable}>
        <BoxRow label="Total employer CPP base contributions" value={boxes.employerCppBaseCents} />
        <BoxRow label="Total employer CPP2 contributions" value={boxes.employerCpp2Cents} />
        <BoxRow label="Total income tax withheld (combined)" value={totalTaxWithheld} last />
      </View>

      <Text style={styles.h2}>Reconciliation — what should have been remitted</Text>
      <View style={styles.boxTable}>
        <BoxRow
          label="Total to have been remitted = emp CPP + emp CPP2 + ee CPP + ee CPP2 + fed tax + ON tax"
          value={
            boxes.employerCppBaseCents +
            boxes.employerCpp2Cents +
            boxes.box16CppBaseCents +
            boxes.box16aCpp2Cents +
            totalTaxWithheld
          }
          last
        />
      </View>

      <Text style={styles.footer} fixed>
        Working copy · Invoiced {boxes.ratesEditionTag} · File the T4 Summary alongside the slip on the same CRA Web Forms submission.
      </Text>
    </Page>
  );
}

export function T4SlipPDF(props: T4SlipPDFProps) {
  const { bannerDataUri } = props;
  return (
    <Document>
      {/* Page 1 — T4 Summary */}
      <Page size="LETTER" style={styles.page} wrap={false}>
        <WorkingCopyWatermark />
        {bannerDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={bannerDataUri} style={styles.banner} />
        ) : null}
        <Text style={styles.copyTag}>OVERVIEW</Text>
        <WorkingCopyRibbon />
        <Text style={styles.title}>T4 Working-Copy Bundle · CY {props.taxYear}</Text>
        <Text style={styles.subtitle}>
          This PDF bundles the T4 slip (3 copies) + T4 Summary for calendar year {props.taxYear}.
          Use it as a data-entry reference when filing via CRA Web Forms.
        </Text>
        <Text style={styles.h2}>Contents</Text>
        <View style={styles.boxTable}>
          <BoxRow label="Page 2 — T4 Summary (payer totals)" value={undefined} blank />
          <BoxRow label="Page 3 — T4 slip · CRA copy" value={undefined} blank />
          <BoxRow label="Page 4 — T4 slip · Payer copy" value={undefined} blank />
          <BoxRow label="Page 5 — T4 slip · Recipient copy" value={undefined} blank last />
        </View>
        <Text style={styles.h2}>Filing reminder</Text>
        <View style={{ ...styles.boxTable, padding: 10 }}>
          <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
            1. Open CRA Web Forms → canada.ca/en/revenue-agency/services/e-services/web-forms.html{"\n"}
            2. Select the T4 program. Your payroll program account (RP) identifies the payer.{"\n"}
            3. Re-key each Box value from this PDF into the Web Forms fields.{"\n"}
            4. Enter the recipient&rsquo;s SIN directly on the CRA form — this app never stores it.{"\n"}
            5. Submit and save CRA&rsquo;s confirmation number. Store that version, not this working copy.
          </Text>
        </View>
        <Text style={styles.footer} fixed>
          Working copy · Invoiced {props.boxes.ratesEditionTag} · Not a CRA-filed slip — reference only.
        </Text>
      </Page>
      {/* Page 2 — T4 Summary */}
      <T4SummaryPage props={props} />
      {/* Pages 3-5 — T4 slip copies */}
      <T4SlipPage copyLabel="CRA COPY (PAGE 3)" props={props} />
      <T4SlipPage copyLabel="PAYER COPY (PAGE 4)" props={props} />
      <T4SlipPage copyLabel="RECIPIENT COPY (PAGE 5)" props={props} />
    </Document>
  );
}
