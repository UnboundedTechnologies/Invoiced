/**
 * Trims transparent/white edges from public/logo.png and writes:
 *   public/logo.png              (tight crop, 512×512 max, for display)
 *   public/logo-full.png         (the original, kept for high-res PDF use)
 *
 * Run:  pnpm optimize-logo
 */
import sharp from "sharp";
import { copyFile, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";

const SRC = resolve("public/logo.png");
const BACKUP = resolve("public/logo-full.png");

async function main() {
  const beforeSize = (await stat(SRC)).size;
  const beforeMeta = await sharp(SRC).metadata();
  console.log(
    `Before:  ${beforeMeta.width}×${beforeMeta.height}px, ${(beforeSize / 1024).toFixed(1)} KB`,
  );

  // Keep original as logo-full.png for PDF use if not already backed up
  try {
    await stat(BACKUP);
    console.log("• logo-full.png already exists - keeping backup untouched.");
  } catch {
    await copyFile(SRC, BACKUP);
    console.log("• Saved original to public/logo-full.png.");
  }

  // Trim transparent/near-uniform edges, resize to 512 square (contain), re-encode with max compression
  const tmp = resolve("public/logo.tmp.png");
  await sharp(BACKUP)
    .trim({ threshold: 10 }) // remove near-transparent/white edges
    .resize({
      width: 512,
      height: 512,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: false })
    .toFile(tmp);

  await rename(tmp, SRC);

  const afterSize = (await stat(SRC)).size;
  const afterMeta = await sharp(SRC).metadata();
  console.log(
    `After:   ${afterMeta.width}×${afterMeta.height}px, ${(afterSize / 1024).toFixed(1)} KB`,
  );
  console.log(`Saved:   ${(((beforeSize - afterSize) / beforeSize) * 100).toFixed(1)}% size reduction.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
