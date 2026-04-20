/**
 * Trim + resize the corp banner for use inside the invoice PDF.
 * Output: public/banner-pdf.png (1200px wide, transparent, optimized).
 *
 * Run: pnpm tsx scripts/optimize-banner.ts
 */
import sharp from "sharp";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const SRC = resolve("public/banner.png");
const OUT = resolve("public/banner-pdf.png");

async function main() {
  const beforeSize = (await stat(SRC)).size;
  const meta = await sharp(SRC).metadata();
  console.log(`Source: ${meta.width}x${meta.height}, ${(beforeSize / 1024).toFixed(1)} KB`);

  await sharp(SRC)
    .trim({ threshold: 10 })
    .resize({ width: 1200, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toFile(OUT);

  const afterSize = (await stat(OUT)).size;
  const afterMeta = await sharp(OUT).metadata();
  console.log(`Output: ${afterMeta.width}x${afterMeta.height}, ${(afterSize / 1024).toFixed(1)} KB`);
  console.log(`Saved ${(((beforeSize - afterSize) / beforeSize) * 100).toFixed(1)}%.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
