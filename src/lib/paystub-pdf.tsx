/**
 * T4-compliant pay stub PDF, rendered with @react-pdf/renderer.
 * Server-side only.
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";

export type PaystubPDFProps = {
  paycheque: {
    payDate: string;
    periodStart: string;
    periodEnd: string;
    grossCents: number;
    cppCents: number;
    cpp2Cents: number;
    eiCents: number;
    federalTaxCents: number;
    provincialTaxCents: number;
    ohpCents: number;
    otherDeductionsCents: number;
    netCents: number;
    employerCppCents: number;
    employerCpp2Cents: number;
    totalRemittanceCents: number;
    notes: string | null;
  };
  ytd: {
    grossCents: number;
    cppCents: number;
    cpp2Cents: number;
    federalTaxCents: number;
    provincialTaxCents: number;
    netCents: number;
  };
  settings: {
    corpLegalName: string;
    payrollAccount: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    brandPrimaryHex: string;
  };
  employee: {
    legalName: string;
    email: string;
  };
  bannerDataUri?: string;
};

function fmt(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 50,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0a0a14",
    lineHeight: 1.35,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  banner: { width: 200, height: 45 },
  headerRight: { width: 260, alignItems: "flex-end" },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textAlign: "right",
    lineHeight: 1,
    marginBottom: 6,
  },
  subtitle: { fontSize: 9, color: "#6b6b7c", textAlign: "right", marginTop: 2 },
  twoCol: { flexDirection: "row", gap: 24, marginBottom: 18 },
  col: { flex: 1 },
  colLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: "#6b6b7c", marginBottom: 4 },
  corpName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  line: { fontSize: 9, color: "#4b5563" },
  metaStrip: {
    flexDirection: "row",
    marginBottom: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e6e6ee",
    paddingVertical: 8,
  },
  metaCell: { flex: 1 },
  metaLabel: { fontSize: 8, textTransform: "uppercase", color: "#6b6b7c", letterSpacing: 1 },
  metaValue: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 6,
  },
  tableHeader: { flexDirection: "row", backgroundColor: "#f7f7fb", paddingVertical: 6, paddingHorizontal: 8 },
  tableRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: "#e6e6ee" },
  thLeft: { flex: 2, fontSize: 9, fontFamily: "Helvetica-Bold", color: "#6b6b7c" },
  thRight: { flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold", color: "#6b6b7c", textAlign: "right" },
  tdLeft: { flex: 2, fontSize: 10 },
  tdRight: { flex: 1, fontSize: 10, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    marginTop: 10,
    padding: 10,
    borderRadius: 4,
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "white" },
  totalValue: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "white" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 50,
    right: 50,
    fontSize: 8,
    color: "#a4a4b6",
    textAlign: "center",
  },
  notesBox: { marginTop: 14, padding: 10, backgroundColor: "#fafafd", borderRadius: 4 },
  notesLabel: { fontSize: 8, textTransform: "uppercase", color: "#6b6b7c", letterSpacing: 1, marginBottom: 4 },
});

export function PaystubPDF({ paycheque, ytd, settings, employee, bannerDataUri }: PaystubPDFProps) {
  const brand = settings.brandPrimaryHex || "#6366F1";

  return (
    <Document title={`Pay Stub ${paycheque.payDate} — ${employee.legalName}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          {bannerDataUri ? <Image src={bannerDataUri} style={styles.banner} /> : <View />}
          <View style={styles.headerRight}>
            <Text style={styles.title}>PAY STUB</Text>
            <Text style={styles.subtitle}>Pay date: {formatLongDate(paycheque.payDate)}</Text>
            {settings.payrollAccount && (
              <Text style={styles.subtitle}>Payroll account: {settings.payrollAccount}</Text>
            )}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Employer</Text>
            <Text style={styles.corpName}>{settings.corpLegalName}</Text>
            <Text style={styles.line}>{settings.addressLine1}</Text>
            {settings.addressLine2 ? <Text style={styles.line}>{settings.addressLine2}</Text> : null}
            <Text style={styles.line}>
              {settings.city}, {settings.province} {settings.postalCode}
            </Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Employee</Text>
            <Text style={styles.corpName}>{employee.legalName}</Text>
            <Text style={styles.line}>{employee.email}</Text>
          </View>
        </View>

        <View style={styles.metaStrip}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Period start</Text>
            <Text style={styles.metaValue}>{paycheque.periodStart}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Period end</Text>
            <Text style={styles.metaValue}>{paycheque.periodEnd}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Pay date</Text>
            <Text style={styles.metaValue}>{paycheque.payDate}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Earnings</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.thLeft}>Description</Text>
          <Text style={styles.thRight}>This period</Text>
          <Text style={styles.thRight}>Year-to-date</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.tdLeft}>Gross salary</Text>
          <Text style={styles.tdRight}>{fmt(paycheque.grossCents)}</Text>
          <Text style={styles.tdRight}>{fmt(ytd.grossCents)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Deductions</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.thLeft}>Description</Text>
          <Text style={styles.thRight}>This period</Text>
          <Text style={styles.thRight}>Year-to-date</Text>
        </View>
        <DeductionRow label="CPP (5.95%)" period={paycheque.cppCents} ytd={ytd.cppCents} />
        {paycheque.cpp2Cents > 0 && (
          <DeductionRow label="CPP2 (4%)" period={paycheque.cpp2Cents} ytd={ytd.cpp2Cents} />
        )}
        <DeductionRow
          label="EI"
          period={paycheque.eiCents}
          ytd={0}
          hint={paycheque.eiCents === 0 ? "owner-manager exempt" : undefined}
        />
        <DeductionRow label="Federal tax" period={paycheque.federalTaxCents} ytd={ytd.federalTaxCents} />
        <DeductionRow
          label="Ontario tax"
          period={paycheque.provincialTaxCents}
          ytd={ytd.provincialTaxCents}
          hint={paycheque.ohpCents > 0 ? `incl. OHP ${fmt(paycheque.ohpCents)}` : undefined}
        />
        {paycheque.otherDeductionsCents > 0 && (
          <DeductionRow label="Other" period={paycheque.otherDeductionsCents} ytd={0} />
        )}

        <View style={[styles.totalRow, { backgroundColor: brand }]}>
          <Text style={styles.totalLabel}>Net pay</Text>
          <Text style={styles.totalValue}>{fmt(paycheque.netCents)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Remittance summary (employer)</Text>
        <View style={styles.tableRow}>
          <Text style={styles.tdLeft}>Employer CPP</Text>
          <Text style={styles.tdRight}>{fmt(paycheque.employerCppCents)}</Text>
          <Text style={styles.tdRight}>—</Text>
        </View>
        {paycheque.employerCpp2Cents > 0 && (
          <View style={styles.tableRow}>
            <Text style={styles.tdLeft}>Employer CPP2</Text>
            <Text style={styles.tdRight}>{fmt(paycheque.employerCpp2Cents)}</Text>
            <Text style={styles.tdRight}>—</Text>
          </View>
        )}
        <View style={styles.tableRow}>
          <Text style={styles.tdLeft}>Total source deductions due to CRA</Text>
          <Text style={styles.tdRight}>{fmt(paycheque.totalRemittanceCents)}</Text>
          <Text style={styles.tdRight}>—</Text>
        </View>

        {paycheque.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text>{paycheque.notes}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          fixed
          render={() =>
            `${settings.corpLegalName}  |  Generated ${new Date().toISOString().slice(0, 10)}  |  Formulas per CRA T4127 Jan 2026`
          }
        />
      </Page>
    </Document>
  );
}

function DeductionRow({
  label,
  period,
  ytd,
  hint,
}: {
  label: string;
  period: number;
  ytd: number;
  hint?: string;
}) {
  return (
    <View style={styles.tableRow}>
      <Text style={styles.tdLeft}>
        {label}
        {hint ? ` (${hint})` : ""}
      </Text>
      <Text style={styles.tdRight}>{fmt(period)}</Text>
      <Text style={styles.tdRight}>{fmt(ytd)}</Text>
    </View>
  );
}
