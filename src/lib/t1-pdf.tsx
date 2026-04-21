/**
 * T1 personal-tax prep-summary PDF. Server-side only (@react-pdf/renderer).
 *
 * Draft returns render with a "DRAFT" watermark; filed returns carry the CRA
 * confirmation number + filed date. NOT a filed T1 — this is the prep
 * summary Saïd reviews before NETFILE or EFILE with a preparer.
 *
 * Step 9 will extract the watermark to a shared component. This first
 * version keeps it inline.
 */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatLongDate } from "@/lib/utils";
import type { LiveT1Aggregate } from "@/server/actions/t1";
import type { T1Return } from "@/lib/db/schema";
import { DraftWatermark } from "@/lib/pdf-watermark";

export type T1PrepPDFProps = {
  taxYear: number;
  status: "draft" | "filed";
  live: LiveT1Aggregate;
  frozen: T1Return | null;
  settings: {
    directorLegalName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
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
  rose: "#e11d48",      // rose-600 — matches /personal-tax web sidebar tone
  roseBg: "#fff1f2",    // rose-50 — code-badge fill
  roseBorder: "#fecdd3", // rose-200 — code-badge border
  roseInk: "#9f1239",   // rose-800 — code-badge text
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
  banner: { width: "100%", marginBottom: 14 },
  // Status ribbon — pinned at the top, above the title. "In front" of everything.
  ribbonDraft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.rose,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  ribbonDraftLabel: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
  },
  ribbonDraftNote: {
    color: "#ffe4e6",
    fontSize: 8,
    fontFamily: "Helvetica",
    letterSpacing: 0.4,
  },
  ribbonFiled: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#047857",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  ribbonFiledLabel: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
  },
  ribbonFiledNote: {
    color: "#d1fae5",
    fontSize: 8,
    fontFamily: "Helvetica",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.2,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  h2: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 1.2,
    color: COLORS.ink,
    textTransform: "uppercase",
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBg,
    padding: 10,
    marginBottom: 8,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderStrong,
    marginTop: 4,
  },
  label: { color: COLORS.muted, flex: 1 },
  labelInk: { color: COLORS.ink, flex: 1 },
  value: { fontFamily: "Helvetica-Bold", color: COLORS.ink, textAlign: "right" },
  // Rose-tinted code badge — matches /personal-tax web styling for line refs.
  lineRef: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.roseInk,
    backgroundColor: COLORS.roseBg,
    borderWidth: 0.5,
    borderColor: COLORS.roseBorder,
    paddingVertical: 1,
    paddingHorizontal: 4,
    marginRight: 8,
    letterSpacing: 0.3,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 50,
    right: 50,
    fontSize: 8,
    color: COLORS.faint,
    textAlign: "center",
    lineHeight: 1.3,
  },
  warnings: {
    marginTop: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#facc15",
    backgroundColor: "#fef3c7",
    color: "#713f12",
    fontSize: 9,
    lineHeight: 1.4,
  },
});

function BoxRow({ line, label, value }: { line?: string; label: string; value: number }) {
  return (
    <View style={styles.row}>
      <View style={{ flexDirection: "row", flex: 1 }}>
        {line ? <Text style={styles.lineRef}>{line}</Text> : null}
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value}>{fmt(value)}</Text>
    </View>
  );
}

export function T1PrepPDF(props: T1PrepPDFProps) {
  const { taxYear, status, live, frozen, settings, bannerDataUri } = props;
  const r = live.result;

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {status === "draft" && <DraftWatermark top={500} />}

        {/* Status ribbon — ALWAYS the first visible element (in front). */}
        {status === "draft" ? (
          <View style={styles.ribbonDraft}>
            <Text style={styles.ribbonDraftLabel}>DRAFT</Text>
            <Text style={styles.ribbonDraftNote}>Not yet filed with CRA · Numbers recompute live</Text>
          </View>
        ) : (
          <View style={styles.ribbonFiled}>
            <Text style={styles.ribbonFiledLabel}>FILED</Text>
            <Text style={styles.ribbonFiledNote}>
              {frozen?.craConfirmationNumber ? `CRA #${frozen.craConfirmationNumber}` : "Frozen snapshot"}
            </Text>
          </View>
        )}

        {bannerDataUri ? (
          // @react-pdf Image doesn't support the DOM alt attribute; rule targets web <img>.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={bannerDataUri} style={styles.banner} />
        ) : null}

        <Text style={styles.title}>T1 Personal Tax — Prep Summary</Text>
        <Text style={styles.subtitle}>
          Calendar year {taxYear} · Filing due {formatLongDate(live.dueDate)}
        </Text>

        {/* Registrant — keep together */}
        <View style={styles.card} wrap={false}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>{settings.directorLegalName}</Text>
          <Text style={{ color: COLORS.muted }}>
            {settings.addressLine1}
            {settings.addressLine2 ? `, ${settings.addressLine2}` : ""}
          </Text>
          <Text style={{ color: COLORS.muted }}>
            {settings.city}, {settings.province} {settings.postalCode} · {settings.country}
          </Text>
          <Text style={{ color: COLORS.faint, marginTop: 4 }}>SIN: XXX-XXX-XXX (not stored)</Text>
          {frozen?.craConfirmationNumber ? (
            <Text style={{ color: COLORS.muted, marginTop: 4 }}>
              CRA confirmation: {frozen.craConfirmationNumber} · Filed{" "}
              {frozen.filedAt ? formatLongDate(new Date(frozen.filedAt).toISOString().slice(0, 10)) : "—"}
            </Text>
          ) : null}
        </View>

        {/* T4 box set — heading + card stay together */}
        <View wrap={false}>
          <Text style={styles.h2}>T4 · Employment slip</Text>
          <View style={styles.card}>
            <BoxRow line="Box 14" label="Employment income" value={live.t4.box14EmploymentIncomeCents} />
            <BoxRow line="Box 16" label="CPP employee contributions (base)" value={live.t4.box16CppBaseCents} />
            <BoxRow line="Box 16A" label="CPP2 employee contributions (enhanced)" value={live.t4.box16aCpp2Cents} />
            <BoxRow line="Box 22" label="Federal income tax deducted" value={live.t4.box22FedTaxWithheldCents} />
            <BoxRow line="Box 26" label="CPP pensionable earnings" value={live.t4.box26CppPensionableCents} />
            <BoxRow line="—" label="Ontario income tax deducted" value={live.t4.ontarioTaxWithheldCents} />
          </View>
        </View>

        {/* T5 box set */}
        <View wrap={false}>
          <Text style={styles.h2}>T5 · Dividend slip</Text>
          <View style={styles.card}>
            <BoxRow line="Box 24" label="Eligible dividend — actual" value={live.t5.eligible.actualCents} />
            <BoxRow line="Box 25" label="Eligible dividend — grossed up (×1.38)" value={live.grossedUp.eligibleCents} />
            <BoxRow line="Box 10" label="Non-eligible dividend — actual" value={live.t5.nonEligible.actualCents} />
            <BoxRow line="Box 11" label="Non-eligible dividend — grossed up (×1.15)" value={live.grossedUp.nonEligibleCents} />
          </View>
        </View>

        {/* T4A box 117 */}
        {live.t4a.cents > 0 ? (
          <View wrap={false}>
            <Text style={styles.h2}>T4A · Loan benefits</Text>
            <View style={styles.card}>
              <BoxRow line="Box 117" label="Loan benefits (s.15(2) + s.80.4) · line 13000" value={live.t4a.cents} />
            </View>
          </View>
        ) : null}

        {/* Income flow */}
        <View wrap={false}>
          <Text style={styles.h2}>Income & Deductions</Text>
          <View style={styles.card}>
            <BoxRow line="15000" label="Total income" value={r.totalIncomeCents} />
            <BoxRow line="22215" label="CPP enhanced deduction (s.60(e))" value={-r.cppEnhancedDeductionCents} />
            <BoxRow line="22200" label="CPP2 deduction (s.60(e.1))" value={-r.cpp2DeductionCents} />
            <View style={styles.rowStrong}>
              <Text style={{ ...styles.labelInk, fontFamily: "Helvetica-Bold" }}>Net income (23600)</Text>
              <Text style={styles.value}>{fmt(r.netIncomeCents)}</Text>
            </View>
            <View style={styles.rowStrong}>
              <Text style={{ ...styles.labelInk, fontFamily: "Helvetica-Bold" }}>Taxable income (26000)</Text>
              <Text style={styles.value}>{fmt(r.taxableIncomeCents)}</Text>
            </View>
          </View>
        </View>

        {/* Federal calc */}
        <View wrap={false}>
          <Text style={styles.h2}>Federal tax — Schedule 1</Text>
          <View style={styles.card}>
            <BoxRow label="Tax from brackets" value={r.federal.bracketTaxCents} />
            <BoxRow line="30000" label="Basic personal amount (phased)" value={r.federal.bpaAmountCents} />
            <BoxRow line="31260" label="Canada employment amount" value={r.federal.ceaAmountCents} />
            <BoxRow line="30800" label="CPP base credit portion" value={r.federal.cppBaseAmountCents} />
            <BoxRow line="33500" label="Total non-refundable credit amounts" value={r.federal.nonRefundableCreditsCents} />
            <BoxRow line="35000" label="Credits × 14%" value={-r.federal.nonRefundableCreditsTaxCents} />
            <BoxRow line="40425" label="Dividend tax credit — eligible" value={-r.federal.dtcEligibleCents} />
            <BoxRow line="40425" label="Dividend tax credit — non-eligible" value={-r.federal.dtcNonEligibleCents} />
            <View style={styles.rowStrong}>
              <Text style={{ ...styles.labelInk, fontFamily: "Helvetica-Bold" }}>Federal tax payable (42000)</Text>
              <Text style={styles.value}>{fmt(r.federal.federalTaxPayableCents)}</Text>
            </View>
          </View>
        </View>

        {/* Ontario calc */}
        <View wrap={false}>
          <Text style={styles.h2}>Ontario tax — ON428</Text>
          <View style={styles.card}>
          <BoxRow label="Tax from brackets" value={r.ontario.bracketTaxCents} />
          <BoxRow line="58040" label="Basic personal amount" value={r.ontario.bpaAmountCents} />
          <BoxRow line="58240" label="CPP base credit portion" value={r.ontario.cppBaseAmountCents} />
          <BoxRow label="Non-refundable credit tax (× 5.05%)" value={-r.ontario.nonRefundableCreditsTaxCents} />
          <BoxRow label="Basic tax after credits" value={r.ontario.basicTaxAfterCreditsCents} />
          <BoxRow label="Surtax tier 1 (20% over $5,818)" value={r.ontario.surtaxTier1Cents} />
          <BoxRow label="Surtax tier 2 (+36% over $7,446)" value={r.ontario.surtaxTier2Cents} />
          <BoxRow label="Ontario DTC — eligible" value={-r.ontario.dtcEligibleCents} />
          <BoxRow label="Ontario DTC — non-eligible" value={-r.ontario.dtcNonEligibleCents} />
          <BoxRow label="Ontario Health Premium (ON479)" value={r.ontario.ontarioHealthPremiumCents} />
          <View style={styles.rowStrong}>
            <Text style={{ ...styles.labelInk, fontFamily: "Helvetica-Bold" }}>Ontario tax payable</Text>
            <Text style={styles.value}>{fmt(r.ontario.ontarioTaxPayableCents)}</Text>
          </View>
          </View>
        </View>

        {/* Totals */}
        <View wrap={false}>
          <Text style={styles.h2}>Totals</Text>
          <View style={styles.card}>
            <BoxRow line="43500" label="Total tax payable" value={r.totalTaxPayableCents} />
            <BoxRow label="Total withheld (box 22 + ON)" value={-r.totalWithheldCents} />
            <View style={styles.rowStrong}>
              <Text style={{ ...styles.labelInk, fontFamily: "Helvetica-Bold" }}>
                {r.refundOrOwingCents < 0 ? "Refund (48400)" : "Balance owing (48500)"}
              </Text>
              <Text style={styles.value}>{fmt(Math.abs(r.refundOrOwingCents))}</Text>
            </View>
          </View>
        </View>

        {/* Warnings */}
        {live.warnings.length > 0 ? (
          <View style={styles.warnings} wrap={false}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Review items</Text>
            {live.warnings.map((w, i) => (
              <Text key={i}>· {w}</Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Prep summary only — not a filed T1. Prepared from Invoiced rate file {r.ratesEditionTag}.
          {"\n"}
          This is not a substitute for professional tax advice. Saïd files the actual T1 via NETFILE or an authorized EFILE preparer.
        </Text>
      </Page>
    </Document>
  );
}
