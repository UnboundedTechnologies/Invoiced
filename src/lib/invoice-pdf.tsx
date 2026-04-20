/**
 * CRA-compliant invoice PDF, rendered with @react-pdf/renderer.
 * Server-side only.
 *
 * Layout: banner top-left, INVOICE display top-right, FROM/TO two-column,
 * three-column meta strip (Issued / Due / Period), line items table,
 * brand-color TOTAL DUE block, payment terms, optional notes, fixed footer.
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate, paymentTermsLabel, pluralizeUnit } from "@/lib/utils";

export type InvoicePDFProps = {
  invoice: {
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    subtotalCents: number;
    hstCents: number;
    totalCents: number;
    notes: string | null;
  };
  lines: Array<{
    description: string;
    quantity: number; // basis units (× 100)
    rateCents: number;
    rateUnit: string;
    amountCents: number;
  }>;
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
    hstRateBps: number;
  };
  client: {
    legalName: string;
    apContactName: string | null;
    apEmail: string | null;
    apPhone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
  };
  contract: {
    paymentTerms: string;
    reference: string | null;
    label: string | null;
  };
  bannerDataUri?: string;
};

function fmt(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

function shortPeriod(start: string, end: string): string {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  const monthFmt: Intl.DateTimeFormatOptions = { month: "short", timeZone: "UTC" };
  const dayFmt: Intl.DateTimeFormatOptions = { day: "numeric", timeZone: "UTC" };
  const yearFmt: Intl.DateTimeFormatOptions = { year: "numeric", timeZone: "UTC" };
  const sMo = s.toLocaleDateString("en-CA", monthFmt);
  const eMo = e.toLocaleDateString("en-CA", monthFmt);
  const sDay = s.toLocaleDateString("en-CA", dayFmt);
  const eDay = e.toLocaleDateString("en-CA", dayFmt);
  const yr = e.toLocaleDateString("en-CA", yearFmt);
  if (sameMonth) return `${sMo} ${sDay} – ${eDay}, ${yr}`;
  if (sameYear) return `${sMo} ${sDay} – ${eMo} ${eDay}, ${yr}`;
  return `${sMo} ${sDay}, ${s.getUTCFullYear()} – ${eMo} ${eDay}, ${yr}`;
}

const COLORS = {
  ink: "#0a0a14",
  muted: "#6b6b7c",
  faint: "#a4a4b6",
  border: "#e6e6ee",
  borderStrong: "#0a0a14",
  rowBg: "#f7f7fb",
  cardBg: "#fafafd",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 50,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.ink,
    lineHeight: 1.35,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  banner: {
    width: 200,
    height: 45,
  },
  headerRight: {
    width: 220,
    alignItems: "flex-end",
  },
  invoiceTitle: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 3,
    textAlign: "right",
    lineHeight: 1,
  },
  invoiceNumber: {
    fontSize: 13,
    fontFamily: "Helvetica",
    color: COLORS.muted,
    textAlign: "right",
    marginTop: 10,
    lineHeight: 1,
  },

  // Brand divider
  brandDivider: {
    height: 2,
    marginBottom: 16,
    borderRadius: 1,
  },

  // FROM / TO
  partiesRow: {
    flexDirection: "row",
    gap: 32,
    marginBottom: 16,
  },
  partyCol: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: COLORS.faint,
    marginBottom: 6,
  },
  partyName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  partyLine: {
    fontSize: 9.5,
    color: COLORS.ink,
    lineHeight: 1.5,
  },
  partyMuted: {
    fontSize: 9.5,
    color: COLORS.muted,
    lineHeight: 1.5,
  },

  // Meta strip
  metaStrip: {
    flexDirection: "row",
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    padding: 10,
    marginBottom: 18,
    borderLeftWidth: 3,
  },
  metaCell: {
    flex: 1,
    paddingHorizontal: 6,
  },
  metaCellDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  metaLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: COLORS.faint,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
  },

  // Line items
  itemsHeading: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: COLORS.faint,
    marginBottom: 6,
  },
  table: {
    marginBottom: 14,
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    alignItems: "flex-start",
  },
  cellHeadText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: COLORS.muted,
  },
  colDescription: { flex: 5, paddingRight: 8 },
  colQty: { flex: 1.4, textAlign: "right", paddingRight: 6 },
  colRate: { flex: 1.4, textAlign: "right", paddingRight: 6 },
  colAmount: { flex: 1.6, textAlign: "right" },

  itemDescription: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
  },
  itemQty: {
    fontSize: 10,
    color: COLORS.ink,
    textAlign: "right",
  },
  itemRate: {
    fontSize: 10,
    color: COLORS.ink,
    textAlign: "right",
  },
  itemAmount: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    textAlign: "right",
  },

  // Totals
  totalsWrap: {
    marginLeft: "auto",
    width: 260,
    marginBottom: 18,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 10,
    color: COLORS.muted,
  },
  totalsValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
  },
  totalsDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginVertical: 6,
  },
  totalDueBox: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalDueLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: COLORS.white,
  },
  totalDueValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLORS.white,
  },
  totalDueCurrency: {
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLORS.white,
    opacity: 0.85,
    marginLeft: 4,
  },

  // Payment / Notes
  twoColBlock: {
    flexDirection: "row",
    gap: 18,
    marginBottom: 0,
  },
  panel: {
    flex: 1,
    padding: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.cardBg,
  },
  panelLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: COLORS.faint,
    marginBottom: 6,
  },
  panelText: {
    fontSize: 10,
    color: COLORS.ink,
    lineHeight: 1.5,
  },
  panelMuted: {
    fontSize: 9.5,
    color: COLORS.muted,
    lineHeight: 1.5,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 50,
    right: 50,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  footerThanks: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    textAlign: "center",
    marginBottom: 6,
  },
  footerLine: {
    fontSize: 7.5,
    color: COLORS.faint,
    textAlign: "center",
    letterSpacing: 0.5,
  },
});

function CanadianAddress({
  d,
}: {
  d: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
}) {
  const cityLine = [d.city, d.province, d.postalCode]
    .filter(Boolean)
    .map((v) => v?.toUpperCase())
    .join(" ")
    .replace(/\s+/g, " ");
  const lines = [
    d.addressLine1?.toUpperCase(),
    d.addressLine2?.toUpperCase(),
    cityLine || null,
    d.country === "CA" ? "CANADA" : d.country?.toUpperCase(),
  ].filter(Boolean) as string[];
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} style={styles.partyLine}>
          {line}
        </Text>
      ))}
    </>
  );
}

export function InvoicePDF({
  invoice,
  lines,
  settings,
  client,
  contract,
  bannerDataUri,
}: InvoicePDFProps) {
  const hstPct = (settings.hstRateBps / 100).toFixed(2);
  const primary = settings.brandPrimaryHex;

  return (
    <Document
      title={`Invoice ${invoice.invoiceNumber}`}
      author={settings.corpLegalName}
      subject={`Invoice ${invoice.invoiceNumber} for ${client.legalName}`}
      creator="Invoiced"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {bannerDataUri && <Image src={bannerDataUri} style={styles.banner} />}
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.invoiceTitle, { color: primary }]}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
          </View>
        </View>

        <View style={[styles.brandDivider, { backgroundColor: primary }]} />

        {/* FROM / TO */}
        <View style={styles.partiesRow}>
          <View style={styles.partyCol}>
            <Text style={styles.sectionLabel}>FROM</Text>
            <Text style={styles.partyName}>{settings.corpLegalName}</Text>
            <CanadianAddress d={settings} />
            {settings.hstAccount && (
              <Text style={[styles.partyMuted, { marginTop: 4 }]}>
                HST/GST{" "}
                <Text style={{ fontFamily: "Helvetica-Bold", color: COLORS.ink }}>
                  {settings.hstAccount}
                </Text>
              </Text>
            )}
            <Text style={styles.partyMuted}>{settings.directorEmail}</Text>
          </View>
          <View style={styles.partyCol}>
            <Text style={styles.sectionLabel}>BILL TO</Text>
            <Text style={styles.partyName}>{client.legalName}</Text>
            {client.apContactName && (
              <Text style={styles.partyMuted}>Attn: {client.apContactName}</Text>
            )}
            {(client.addressLine1 || client.city) && <CanadianAddress d={client} />}
            {client.apEmail && (
              <Text style={[styles.partyMuted, { marginTop: 4 }]}>{client.apEmail}</Text>
            )}
            {client.apPhone && <Text style={styles.partyMuted}>{client.apPhone}</Text>}
          </View>
        </View>

        {/* Meta strip: Issued / Due / Period (+ optional Reference) */}
        <View style={[styles.metaStrip, { borderLeftColor: primary }]}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>ISSUED</Text>
            <Text style={styles.metaValue}>{formatLongDate(invoice.issueDate)}</Text>
          </View>
          <View style={styles.metaCellDivider} />
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>DUE</Text>
            <Text style={[styles.metaValue, { color: primary }]}>
              {formatLongDate(invoice.dueDate)}
            </Text>
          </View>
          <View style={styles.metaCellDivider} />
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>SERVICE PERIOD</Text>
            <Text style={styles.metaValue}>{shortPeriod(invoice.periodStart, invoice.periodEnd)}</Text>
          </View>
          {contract.reference && (
            <>
              <View style={styles.metaCellDivider} />
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>PO / REF</Text>
                <Text style={styles.metaValue}>{contract.reference}</Text>
              </View>
            </>
          )}
        </View>

        {/* Line items */}
        <Text style={styles.itemsHeading}>WORK PERFORMED</Text>
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colDescription, styles.cellHeadText]}>DESCRIPTION</Text>
            <Text style={[styles.colQty, styles.cellHeadText]}>QTY</Text>
            <Text style={[styles.colRate, styles.cellHeadText]}>RATE</Text>
            <Text style={[styles.colAmount, styles.cellHeadText]}>AMOUNT</Text>
          </View>
          {lines.map((line, i) => {
            const qty = line.quantity / 100;
            return (
              <View key={i} style={styles.tableRow}>
                <View style={styles.colDescription}>
                  <Text style={styles.itemDescription}>{line.description}</Text>
                  {contract.label && (
                    <Text style={[styles.partyMuted, { marginTop: 2 }]}>{contract.label}</Text>
                  )}
                </View>
                <View style={styles.colQty}>
                  <Text style={styles.itemQty}>
                    {qty.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{" "}
                    {pluralizeUnit(qty, line.rateUnit)}
                  </Text>
                </View>
                <View style={styles.colRate}>
                  <Text style={styles.itemRate}>{fmt(line.rateCents, invoice.currency)}</Text>
                </View>
                <View style={styles.colAmount}>
                  <Text style={styles.itemAmount}>{fmt(line.amountCents, invoice.currency)}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{fmt(invoice.subtotalCents, invoice.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>HST ({hstPct}%)</Text>
            <Text style={styles.totalsValue}>{fmt(invoice.hstCents, invoice.currency)}</Text>
          </View>
          <View style={styles.totalsDivider} />
          <View style={[styles.totalDueBox, { backgroundColor: primary }]}>
            <Text style={styles.totalDueLabel}>TOTAL DUE</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={styles.totalDueValue}>{fmt(invoice.totalCents, invoice.currency)}</Text>
              <Text style={styles.totalDueCurrency}>{invoice.currency}</Text>
            </View>
          </View>
        </View>

        {/* Payment + Notes side-by-side (notes only if present) */}
        <View style={styles.twoColBlock}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>PAYMENT</Text>
            <Text style={styles.panelText}>
              <Text style={styles.panelMuted}>Terms: </Text>
              {paymentTermsLabel(contract.paymentTerms)}
            </Text>
            <Text style={[styles.panelText, { marginTop: 4 }]}>
              <Text style={styles.panelMuted}>Pay by: </Text>
              <Text style={{ fontFamily: "Helvetica-Bold", color: primary }}>
                {formatLongDate(invoice.dueDate)}
              </Text>
            </Text>
            <Text style={[styles.panelMuted, { marginTop: 8, fontSize: 8.5 }]}>
              Please remit in {invoice.currency} via interac e-transfer or wire to {settings.directorEmail}.
            </Text>
          </View>
          {invoice.notes && (
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>NOTES</Text>
              <Text style={styles.panelText}>{invoice.notes}</Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerThanks}>Thank you for your business.</Text>
          <Text style={styles.footerLine}>
            {settings.corpLegalName} · {settings.addressLine1}, {settings.city}, {settings.province}{" "}
            {settings.postalCode}
            {settings.hstAccount ? ` · HST ${settings.hstAccount}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
