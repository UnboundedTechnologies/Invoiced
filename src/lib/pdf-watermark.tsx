/**
 * Shared DRAFT watermark for React-PDF documents.
 *
 * Used across T1, T2, and HST prep-summary PDFs. The `top` value varies per
 * document because page 1 content density differs — callers pass it in.
 *
 * Applies `fixed` so the watermark shows on every page.
 */
import { Text, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  watermark: {
    position: "absolute",
    left: 50,
    right: 50,
    fontSize: 88,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 12,
    color: "#f2d5d5",
    textAlign: "center",
    transform: "rotate(-45deg)",
    transformOrigin: "center",
  },
});

export function DraftWatermark({ top = 500, label = "DRAFT" }: { top?: number; label?: string }) {
  return (
    <Text style={[styles.watermark, { top }]} fixed>
      {label}
    </Text>
  );
}
