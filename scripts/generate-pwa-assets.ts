/**
 * One-shot PWA asset generator. Reads `public/logo.png` and writes:
 *   - public/icons/icon-{192,512,1024}.png   manifest icons
 *   - public/icons/icon-maskable-512.png      Android-style maskable
 *   - public/apple-touch-icon.png             iOS home-screen 180×180
 *   - public/splash/apple-splash-*.png        iOS standalone splash for the
 *                                             5 most common device sizes
 *
 * Run:  pnpm gen-pwa-assets
 *
 * Idempotent — safe to re-run after swapping logo.png. Background colour
 * pinned to the same near-black we use as the aurora base so the splash +
 * dark theme blend.
 */
import sharp from "sharp";
import fs from "node:fs/promises";

const SOURCE = "public/logo.png";
const BG = "#0a0a14";

type IconSpec = { out: string; size: number; padding: number };
type SplashSpec = { out: string; w: number; h: number; label: string };

// All icons are composited onto a solid dark brand background — the source
// logo has white text ("UNBOUNDED TECHNOLOGIES INC") on transparent, and
// iOS renders PWA icons on a white surface by default, which makes the
// white text invisible. Padding leaves breathing room around the logo
// inside the icon canvas (Apple HIG suggests ~10-20%).
const ICONS: IconSpec[] = [
  { out: "public/icons/icon-192.png", size: 192, padding: 0.12 },
  { out: "public/icons/icon-512.png", size: 512, padding: 0.12 },
  { out: "public/icons/icon-1024.png", size: 1024, padding: 0.12 },
  { out: "public/apple-touch-icon.png", size: 180, padding: 0.1 },
];

const MASKABLE: IconSpec = {
  out: "public/icons/icon-maskable-512.png",
  size: 512,
  padding: 0.2,
};

const SPLASHES: SplashSpec[] = [
  { out: "public/splash/apple-splash-2048-2732.png", w: 2048, h: 2732, label: "iPad Pro 12.9 portrait" },
  { out: "public/splash/apple-splash-1668-2388.png", w: 1668, h: 2388, label: "iPad Pro 11 portrait" },
  { out: "public/splash/apple-splash-1284-2778.png", w: 1284, h: 2778, label: "iPhone Plus/Max portrait" },
  { out: "public/splash/apple-splash-1170-2532.png", w: 1170, h: 2532, label: "iPhone Pro portrait" },
  { out: "public/splash/apple-splash-750-1334.png", w: 750, h: 1334, label: "iPhone SE portrait" },
];

async function main() {
  await fs.mkdir("public/icons", { recursive: true });
  await fs.mkdir("public/splash", { recursive: true });

  console.log("→ Icons (logo composited on brand-dark background)");
  for (const { out, size, padding } of ICONS) {
    const innerSize = Math.round(size * (1 - padding * 2));
    const inner = await sharp(SOURCE).resize(innerSize, innerSize).png().toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: BG },
    })
      .composite([{ input: inner, gravity: "center" }])
      .png()
      .toFile(out);
    console.log(`  ✓ ${out} (${size}×${size}, ${(padding * 100).toFixed(0)}% padding)`);
  }

  console.log("→ Maskable icon (Android adaptive — safe-area padded)");
  const innerSize = Math.round(MASKABLE.size * (1 - MASKABLE.padding * 2));
  const inner = await sharp(SOURCE).resize(innerSize, innerSize).png().toBuffer();
  await sharp({
    create: { width: MASKABLE.size, height: MASKABLE.size, channels: 4, background: BG },
  })
    .composite([{ input: inner, gravity: "center" }])
    .png()
    .toFile(MASKABLE.out);
  console.log(`  ✓ ${MASKABLE.out} (${MASKABLE.size}×${MASKABLE.size}, ${(MASKABLE.padding * 100).toFixed(0)}% padding)`);

  console.log("→ iOS splash screens");
  for (const { out, w, h, label } of SPLASHES) {
    const logoSize = Math.round(Math.min(w, h) * 0.28);
    const logo = await sharp(SOURCE).resize(logoSize, logoSize).png().toBuffer();
    await sharp({
      create: { width: w, height: h, channels: 4, background: BG },
    })
      .composite([{ input: logo, gravity: "center" }])
      .png()
      .toFile(out);
    console.log(`  ✓ ${out} (${w}×${h}, ${label})`);
  }

  console.log("\n✅ PWA assets generated.");
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
