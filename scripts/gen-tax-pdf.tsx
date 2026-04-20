/**
 * Regenerates TAX_OPTIMIZATION.pdf from TAX_OPTIMIZATION.md at the repo root.
 * Handles a pragmatic subset of markdown: headings, paragraphs, bullets,
 * numbered lists, blockquotes, hr, tables, bold, italic, inline code, links.
 */
import React from "react";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Link,
  renderToBuffer,
} from "@react-pdf/renderer";

type Inline =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; content: string; url: string };

type Block =
  | { type: "h1" | "h2" | "h3" | "h4"; inlines: Inline[] }
  | { type: "p"; inlines: Inline[] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][] }
  | { type: "hr" }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

// Preprocess: emoji / symbols not in Helvetica glyph set -> text tokens
function sanitize(s: string): string {
  return s
    .replace(/🚨/g, "(!)")
    .replace(/❌/g, "[X]")
    .replace(/✅/g, "[Y]")
    .replace(/⏳/g, "...")
    .replace(/·/g, "|")
    .replace(/—/g, "--")
    .replace(/–/g, "-")
    .replace(/“|”/g, '"')
    .replace(/‘|’/g, "'")
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=");
}

function parseInline(raw: string): Inline[] {
  const text = sanitize(raw);
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ type: "text", content: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    // bold **...**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push({ type: "bold", content: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // inline code `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push({ type: "code", content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // link [text](url)
    if (text[i] === "[") {
      const rb = text.indexOf("]", i + 1);
      if (rb !== -1 && text[rb + 1] === "(") {
        const rp = text.indexOf(")", rb + 2);
        if (rp !== -1) {
          flush();
          out.push({
            type: "link",
            content: text.slice(i + 1, rb),
            url: text.slice(rb + 2, rp),
          });
          i = rp + 1;
          continue;
        }
      }
    }
    // italic *...*  (single-star, not part of **)
    if (
      text[i] === "*" &&
      text[i + 1] !== "*" &&
      text[i - 1] !== "*" &&
      text[i - 1] !== " " === false && // allow beginning or after space
      /\S/.test(text[i + 1] || "")
    ) {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1 && text[end + 1] !== "*") {
        flush();
        out.push({ type: "italic", content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

function parseBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1]!.length as 1 | 2 | 3 | 4;
      blocks.push({ type: `h${level}` as "h1" | "h2" | "h3" | "h4", inlines: parseInline(h[2]!) });
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        buf.push(lines[i]!.slice(2));
        i++;
      }
      blocks.push({ type: "quote", inlines: parseInline(buf.join(" ")) });
      continue;
    }

    // table detection: header line + separator line
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|[\s:\-|]+\|$/.test(lines[i + 1]!.trim())
    ) {
      const parseRow = (s: string) =>
        s
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => parseInline(c.trim()));
      const header = parseRow(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(parseRow(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^[-*]\s+/, "")));
        i++;
        // fold continuation lines (two-space indent) into last item
        while (i < lines.length && /^ {2,}\S/.test(lines[i]!)) {
          const last = items[items.length - 1]!;
          items[items.length - 1] = [
            ...last,
            ...parseInline(" " + lines[i]!.trim()),
          ];
          i++;
        }
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^\d+\.\s+/, "")));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // paragraph: collect until blank line or new block
    const pBuf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|>\s|[-*]\s|\d+\.\s|---+$|\|)/.test(lines[i]!)
    ) {
      pBuf.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "p", inlines: parseInline(pBuf.join(" ")) });
  }
  return blocks;
}

// Rendering

const BRAND = "#6366F1";
const MUTED = "#6b7280";
const INK = "#111827";
const BODY = "#1f2937";
const BG_CODE = "#f3f4f6";
const HR = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    paddingBottom: 64,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BODY,
    lineHeight: 1.45,
  },
  h1: { fontSize: 22, fontWeight: "bold", marginTop: 4, marginBottom: 10, color: BRAND },
  h2: { fontSize: 15, fontWeight: "bold", marginTop: 18, marginBottom: 8, color: INK },
  h3: { fontSize: 12, fontWeight: "bold", marginTop: 12, marginBottom: 4, color: INK },
  h4: { fontSize: 10.5, fontWeight: "bold", marginTop: 8, marginBottom: 2, color: "#374151" },
  p: { marginBottom: 6 },
  quoteWrap: {
    marginTop: 6,
    marginBottom: 10,
    paddingLeft: 10,
    paddingTop: 4,
    paddingBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: BRAND,
  },
  quoteText: { color: MUTED },
  ul: { marginBottom: 8 },
  ol: { marginBottom: 8 },
  li: { flexDirection: "row", marginBottom: 2 },
  bullet: { width: 12, fontWeight: "bold", color: BRAND },
  liText: { flex: 1 },
  hr: { borderBottomWidth: 1, borderBottomColor: HR, marginTop: 12, marginBottom: 12 },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  code: { color: "#b91c1c" },
  link: { color: BRAND, textDecoration: "underline" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 8,
    color: MUTED,
    textAlign: "center",
  },
  tableWrap: { marginTop: 4, marginBottom: 10, borderWidth: 0.5, borderColor: HR },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: HR },
  tableCell: { flex: 1, padding: 5, fontSize: 9 },
  tableHeader: { backgroundColor: "#f9fafb", fontWeight: "bold" },
});

function renderInline(inlines: Inline[]) {
  return inlines.map((seg, idx) => {
    if (seg.type === "bold") return <Text key={idx} style={styles.bold}>{seg.content}</Text>;
    if (seg.type === "italic") return <Text key={idx} style={styles.italic}>{seg.content}</Text>;
    if (seg.type === "code") return <Text key={idx} style={styles.code}>{seg.content}</Text>;
    if (seg.type === "link") return <Link key={idx} src={seg.url} style={styles.link}>{seg.content}</Link>;
    return <Text key={idx}>{seg.content}</Text>;
  });
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "h1") return <Text style={styles.h1}>{renderInline(block.inlines)}</Text>;
  if (block.type === "h2") return <Text style={styles.h2}>{renderInline(block.inlines)}</Text>;
  if (block.type === "h3") return <Text style={styles.h3}>{renderInline(block.inlines)}</Text>;
  if (block.type === "h4") return <Text style={styles.h4}>{renderInline(block.inlines)}</Text>;
  if (block.type === "p") return <Text style={styles.p}>{renderInline(block.inlines)}</Text>;
  if (block.type === "quote")
    return (
      <View style={styles.quoteWrap}>
        <Text style={styles.quoteText}>{renderInline(block.inlines)}</Text>
      </View>
    );
  if (block.type === "hr") return <View style={styles.hr} />;
  if (block.type === "ul") {
    return (
      <View style={styles.ul}>
        {block.items.map((item, i) => (
          <View key={i} style={styles.li}>
            <Text style={styles.bullet}>{"•"}</Text>
            <Text style={styles.liText}>{renderInline(item)}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.type === "ol") {
    return (
      <View style={styles.ol}>
        {block.items.map((item, i) => (
          <View key={i} style={styles.li}>
            <Text style={styles.bullet}>{`${i + 1}.`}</Text>
            <Text style={styles.liText}>{renderInline(item)}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.type === "table") {
    return (
      <View style={styles.tableWrap}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          {block.header.map((cell, i) => (
            <Text key={i} style={styles.tableCell}>{renderInline(cell)}</Text>
          ))}
        </View>
        {block.rows.map((row, ri) => (
          <View key={ri} style={styles.tableRow}>
            {row.map((cell, ci) => (
              <Text key={ci} style={styles.tableCell}>{renderInline(cell)}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  }
  return null;
}

function Doc({ blocks }: { blocks: Block[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Document
      title="Tax Optimization Playbook — Unbounded Technologies Inc."
      author="Unbounded Technologies Inc."
      creator="invoiced/gen-tax-pdf"
    >
      <Page size="LETTER" style={styles.page} wrap>
        {blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </Page>
    </Document>
  );
}

async function main() {
  const root = process.cwd();
  const mdPath = resolve(root, "TAX_OPTIMIZATION.md");
  const pdfPath = resolve(root, "TAX_OPTIMIZATION.pdf");
  const md = await readFile(mdPath, "utf8");
  const blocks = parseBlocks(md);
  const buffer = await renderToBuffer(<Doc blocks={blocks} />);
  await rm(pdfPath, { force: true });
  await writeFile(pdfPath, buffer);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${pdfPath} (${(buffer.length / 1024).toFixed(1)} KB, ${blocks.length} blocks)`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
