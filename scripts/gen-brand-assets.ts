/**
 * Brand-asset generator — emits the 6 brand assets into `public/brand-assets/`
 * and promotes the Invoiced app icon into the canonical PWA paths so iOS
 * Add-to-Home picks it up. The variant explorer (15 candidates) was retired
 * after Saïd picked the winners on 2026-05-10; see git history to revive.
 *
 *   app-icon-invoiced.png       1024×1024  → also promoted to PWA paths
 *   app-icon-landing.png        1024×1024  → for the Landing repo
 *   apple-id-photo.png          1024×1024  → Apple ID profile photo
 *   ios-contact-poster.png      1284×2778  → iOS Contact Poster
 *   iphone-home-wallpaper.png   1290×2796  → iPhone Home Screen
 *   iphone-lock-wallpaper.png   1290×2796  → iPhone Lock Screen
 *
 * Run:   pnpm gen-brand-assets
 *
 * The infinity glyph is auto-cropped from `public/banner.png` (alpha bbox).
 */
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

// ---------- Paths & palette ----------
const OUT_DIR = "public/brand-assets";
const BANNER = "public/banner.png";

const DARK = "#0a0a14";
const G_CYAN = "#22d3ee";
const G_INDIGO = "#6366f1";
const G_FUCHSIA = "#d946ef";

// System font stack. On Windows this falls back to Segoe UI Variable
// (geometric sans, similar character to Geist). Quoting matters.
const SANS = `"Inter","Segoe UI Variable","Segoe UI","Helvetica Neue",Arial,sans-serif`;
const SERIF = `"Times New Roman",Georgia,serif`;
const MONO = `"JetBrains Mono","SF Mono",Consolas,monospace`;

// ---------- Infinity glyph crop (cached as Buffer) ----------
type GlyphCache = { buf: Buffer; w: number; h: number };
let glyph: GlyphCache | null = null;

async function findGlyphBBox(): Promise<{ left: number; top: number; width: number; height: number }> {
  const { data, info } = await sharp(BANNER).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const colOpaque = new Array(W).fill(false);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const a = data[(row + x) * ch + 3] ?? 0;
      if (a > 20) colOpaque[x] = true;
    }
  }
  // First opaque column → first transparent column after it: isolates the
  // infinity glyph from the wordmark (banner is "[infinity] [gap] [text]").
  let glyphStart = -1;
  for (let x = 0; x < W; x++) if (colOpaque[x]) { glyphStart = x; break; }
  let glyphEnd = -1;
  for (let x = glyphStart; x < W; x++) if (!colOpaque[x]) { glyphEnd = x; break; }
  let topY = H, botY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = glyphStart; x < glyphEnd; x++) {
      const a = data[(y * W + x) * ch + 3] ?? 0;
      if (a > 20) { if (y < topY) topY = y; if (y > botY) botY = y; }
    }
  }
  return { left: glyphStart, top: topY, width: glyphEnd - glyphStart, height: botY - topY + 1 };
}

async function getGlyph(): Promise<GlyphCache> {
  if (glyph) return glyph;
  const bbox = await findGlyphBBox();
  const buf = await sharp(BANNER).extract(bbox).png().toBuffer();
  glyph = { buf, w: bbox.width, h: bbox.height };
  return glyph;
}

async function glyphAtWidth(targetW: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const g = await getGlyph();
  const aspect = g.h / g.w;
  const w = Math.round(targetW);
  const h = Math.round(targetW * aspect);
  const buf = await sharp(g.buf).resize(w, h, { fit: "contain" }).png().toBuffer();
  return { buf, w, h };
}

// ---------- SVG helpers ----------
const gradientDefs = `
  <defs>
    <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="${G_CYAN}"/>
      <stop offset="50%" stop-color="${G_INDIGO}"/>
      <stop offset="100%" stop-color="${G_FUCHSIA}"/>
    </linearGradient>
    <linearGradient id="brandH" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"  stop-color="${G_CYAN}"/>
      <stop offset="50%" stop-color="${G_INDIGO}"/>
      <stop offset="100%" stop-color="${G_FUCHSIA}"/>
    </linearGradient>
    <radialGradient id="aurora" cx="20%" cy="10%" r="120%">
      <stop offset="0%"  stop-color="#1f1747"/>
      <stop offset="45%" stop-color="#0d0a26"/>
      <stop offset="100%" stop-color="${DARK}"/>
    </radialGradient>
    <radialGradient id="aurora2" cx="80%" cy="90%" r="110%">
      <stop offset="0%"  stop-color="#3a1457"/>
      <stop offset="50%" stop-color="#0d0a26"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
  </defs>
`;

async function baseCanvas(w: number, h: number, fill: "black" | "dark" | "aurora" | "aurora2"): Promise<sharp.Sharp> {
  if (fill === "black" || fill === "dark") {
    const color = fill === "black" ? "#000000" : DARK;
    return sharp({ create: { width: w, height: h, channels: 4, background: color } });
  }
  const id = fill === "aurora" ? "aurora" : "aurora2";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    ${gradientDefs}
    <rect width="${w}" height="${h}" fill="url(#${id})"/>
    <circle cx="${w * 0.18}" cy="${h * 0.12}" r="${Math.max(w, h) * 0.35}" fill="${G_INDIGO}" opacity="0.18"/>
    <circle cx="${w * 0.85}" cy="${h * 0.92}" r="${Math.max(w, h) * 0.3}" fill="${G_FUCHSIA}" opacity="0.12"/>
    <circle cx="${w * 0.7}" cy="${h * 0.2}" r="${Math.max(w, h) * 0.18}" fill="${G_CYAN}" opacity="0.08"/>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return sharp(png);
}

// ============================================================================
// Hero-gradient app icon — used for both Invoiced and Landing
// ============================================================================
async function genHeroIcon(wordmark: string, outFile: string) {
  const SIZE = 1024;
  const g = await glyphAtWidth(SIZE * 0.6);
  const titleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE * 0.25}">
    ${gradientDefs}
    <text x="50%" y="65%" text-anchor="middle"
          font-family='${SANS}' font-size="${SIZE * 0.16}" font-weight="700"
          fill="url(#brandH)" letter-spacing="-2">${wordmark}</text>
  </svg>`;
  const titlePng = await sharp(Buffer.from(titleSvg)).png().toBuffer();
  const titleH = Math.round(SIZE * 0.25);
  await (await baseCanvas(SIZE, SIZE, "black"))
    .composite([
      { input: g.buf, left: Math.round((SIZE - g.w) / 2), top: Math.round(SIZE * 0.18) },
      { input: titlePng, left: 0, top: SIZE - titleH - Math.round(SIZE * 0.12) },
    ])
    .png()
    .toFile(outFile);
}

// ============================================================================
// Apple ID — glyph + brand-gradient "Unbounded Technologies"
// ============================================================================
async function genAppleIdFinal() {
  const SIZE = 1024;
  const g = await glyphAtWidth(SIZE * 0.55);
  const titleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE * 0.22}">
    ${gradientDefs}
    <text x="50%" y="48%" text-anchor="middle"
          font-family='${SANS}' font-size="${SIZE * 0.075}" font-weight="700"
          fill="url(#brandH)" letter-spacing="-1">Unbounded</text>
    <text x="50%" y="86%" text-anchor="middle"
          font-family='${SANS}' font-size="${SIZE * 0.075}" font-weight="700"
          fill="url(#brandH)" letter-spacing="-1">Technologies</text>
  </svg>`;
  const titlePng = await sharp(Buffer.from(titleSvg)).png().toBuffer();
  const titleH = Math.round(SIZE * 0.22);
  await (await baseCanvas(SIZE, SIZE, "aurora"))
    .composite([
      { input: g.buf, left: Math.round((SIZE - g.w) / 2), top: Math.round(SIZE * 0.16) },
      { input: titlePng, left: 0, top: SIZE - titleH - Math.round(SIZE * 0.07) },
    ])
    .png()
    .toFile(path.join(OUT_DIR, "apple-id-photo.png"));
}

// ============================================================================
// Contact poster — italic editorial on aurora
// ============================================================================
async function genPosterFinal() {
  const W = 1284, H = 2778;
  const g = await glyphAtWidth(W * 0.65);
  const editSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    ${gradientDefs}
    <text x="${W * 0.08}" y="${H * 0.58}"
          font-family='${SERIF}' font-style="italic" font-size="${W * 0.095}" font-weight="500"
          fill="#f8fafc">Building software,</text>
    <text x="${W * 0.08}" y="${H * 0.625}"
          font-family='${SERIF}' font-style="italic" font-size="${W * 0.095}" font-weight="500"
          fill="url(#brandH)">unbounded.</text>
    <line x1="${W * 0.08}" y1="${H * 0.71}" x2="${W * 0.32}" y2="${H * 0.71}"
          stroke="#cbd5e1" stroke-width="2" opacity="0.7"/>
    <text x="${W * 0.08}" y="${H * 0.745}"
          font-family='${SANS}' font-size="${W * 0.034}" font-weight="600"
          fill="#f1f5f9" letter-spacing="2">SAÏD AÏSSANI</text>
    <text x="${W * 0.08}" y="${H * 0.78}"
          font-family='${SANS}' font-size="${W * 0.028}" font-weight="400"
          fill="#cbd5e1" letter-spacing="1">Founder · Unbounded Technologies Inc.</text>
    <text x="${W * 0.08}" y="${H * 0.94}"
          font-family='${MONO}' font-size="${W * 0.03}" font-weight="500"
          fill="#e2e8f0" letter-spacing="2">unboundedtechnologies.com</text>
  </svg>`;
  const editPng = await sharp(Buffer.from(editSvg)).png().toBuffer();
  await (await baseCanvas(W, H, "aurora2"))
    .composite([
      { input: g.buf, left: Math.round(W * 0.18), top: Math.round(H * 0.18) },
      { input: editPng, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, "ios-contact-poster.png"));
}

// ============================================================================
// Wallpapers — matched aurora pair
// ============================================================================
async function genWallpaperFinals() {
  const W = 1290, H = 2796;

  // Home: faint corner glyph + full company name top center.
  {
    const g = await glyphAtWidth(W * 0.35);
    const fadeAlpha = await sharp(g.buf)
      .composite([{ input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}">
          <rect width="${g.w}" height="${g.h}" fill="white" opacity="0.78"/>
        </svg>`
      ), blend: "dest-in" }])
      .png().toBuffer();
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      ${gradientDefs}
      <text x="50%" y="${H * 0.058}" text-anchor="middle"
            font-family='${SANS}' font-size="${W * 0.04}" font-weight="700"
            fill="url(#brandH)" letter-spacing="3">Unbounded Technologies Inc.</text>
    </svg>`;
    const overlayPng = await sharp(Buffer.from(overlay)).png().toBuffer();
    await (await baseCanvas(W, H, "aurora"))
      .composite([
        { input: fadeAlpha, left: Math.round(W * 0.62), top: Math.round(H * 0.82) },
        { input: overlayPng, left: 0, top: 0 },
      ])
      .png()
      .toFile(path.join(OUT_DIR, "iphone-home-wallpaper.png"));
  }

  // Lock: big infinity + brand-gradient wordmark on aurora.
  {
    const big = await glyphAtWidth(W * 0.78);
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      ${gradientDefs}
      <text x="50%" y="${H * 0.82}" text-anchor="middle"
            font-family='${SANS}' font-size="${W * 0.07}" font-weight="800"
            fill="url(#brandH)" letter-spacing="6">UNBOUNDED</text>
      <text x="50%" y="${H * 0.86}" text-anchor="middle"
            font-family='${SANS}' font-size="${W * 0.034}" font-weight="500"
            fill="#cbd5e1" letter-spacing="10">TECHNOLOGIES INC.</text>
    </svg>`;
    const overlayPng = await sharp(Buffer.from(overlay)).png().toBuffer();
    await (await baseCanvas(W, H, "aurora2"))
      .composite([
        { input: big.buf, left: Math.round((W - big.w) / 2), top: Math.round(H * 0.55 - big.h / 2) },
        { input: overlayPng, left: 0, top: 0 },
      ])
      .png()
      .toFile(path.join(OUT_DIR, "iphone-lock-wallpaper.png"));
  }
}

// ============================================================================
// Promote — write the home-screen icon into the canonical PWA paths.
//
// The src/app/{icon,apple-icon}*.png entries use Next.js App Router file
// conventions: Next emits cache-busted <link> tags (/apple-icon?v=hash) so iOS
// "Add to Home Screen" re-fetches the icon instead of using a stale copy.
// Multiple apple-icon sizes cover iPhone (180), iPad Pro (167), iPad (152), and
// older iPhone (120). Manifest still reads from public/icons/*.
// ============================================================================
async function promoteToPWA() {
  const SOURCE = path.join(OUT_DIR, "app-icon-invoiced.png");
  const targets: { out: string; size: number }[] = [
    { out: "public/icons/icon-192.png", size: 192 },
    { out: "public/icons/icon-512.png", size: 512 },
    { out: "public/icons/icon-1024.png", size: 1024 },
    { out: "public/icons/icon-maskable-512.png", size: 512 },
    { out: "public/apple-touch-icon.png", size: 180 },
    { out: "src/app/icon.png", size: 192 },
    { out: "src/app/apple-icon.png", size: 180 },
    { out: "src/app/apple-icon0.png", size: 167 },
    { out: "src/app/apple-icon1.png", size: 152 },
    { out: "src/app/apple-icon2.png", size: 120 },
  ];
  for (const { out, size } of targets) {
    await sharp(SOURCE).resize(size, size, { fit: "cover" }).png().toFile(out);
    console.log(`  ✓ ${out} (${size}×${size})`);
  }
}

// ============================================================================
// HTML viewer (finals only)
// ============================================================================
async function genIndexHtml() {
  const items = [
    { src: "app-icon-invoiced.png", label: "Invoiced app icon", desc: "1024×1024 · promoted to PWA paths. iOS Add-to-Home picks this up.", aspect: "1/1" },
    { src: "app-icon-landing.png", label: "Landing app icon", desc: "1024×1024 · sister icon for the Landing repo (same artwork, 'Landing' wordmark).", aspect: "1/1" },
    { src: "apple-id-photo.png", label: "Apple ID profile photo", desc: "1024×1024 · circle-safe. Glyph + 'Unbounded Technologies' in brand gradient.", aspect: "1/1" },
    { src: "ios-contact-poster.png", label: "iOS Contact Poster", desc: "1284×2778 · italic editorial on aurora.", aspect: "1284/2778" },
    { src: "iphone-home-wallpaper.png", label: "iPhone Home Screen wallpaper", desc: "1290×2796 · aurora + faint corner glyph + full company name top.", aspect: "1290/2796" },
    { src: "iphone-lock-wallpaper.png", label: "iPhone Lock Screen wallpaper", desc: "1290×2796 · big infinity + UNBOUNDED TECHNOLOGIES INC. on aurora.", aspect: "1290/2796" },
  ];

  const cssVars = `--bg:${DARK};--fg:#e2e8f0;--muted:#94a3b8;--card:#15152a;--border:rgba(255,255,255,0.08);`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Invoiced — brand finals</title>
<style>
  :root{${cssVars}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:${SANS};line-height:1.45;padding:48px 24px 96px}
  h1{font-size:28px;margin:0 0 8px;background:linear-gradient(135deg,${G_CYAN},${G_INDIGO},${G_FUCHSIA});-webkit-background-clip:text;background-clip:text;color:transparent}
  .lead{color:var(--muted);max-width:740px;margin:0 0 40px;font-size:14px}
  .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .frame{background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .frame img{display:block;width:100%;height:auto}
  .meta{padding:14px 16px}
  .label{font-weight:600;font-size:14px;margin:0 0 4px}
  .desc{color:var(--muted);font-size:12.5px;margin:0}
  a.full{display:inline-block;margin-top:8px;font-size:11px;font-family:${MONO};color:#cbd5e1;text-decoration:none;border:1px solid var(--border);padding:3px 8px;border-radius:5px}
  a.full:hover{border-color:${G_INDIGO}}
</style>
</head>
<body>
  <h1>Invoiced — brand finals</h1>
  <p class="lead">The 5 selections (plus the Landing icon twin). Icon V1 is already promoted to <code>public/apple-touch-icon.png</code> + <code>public/icons/icon-*.png</code>. AirDrop the others to your iPhone.</p>
  <div class="row">
    ${items.map(it => `
    <div class="card">
      <div class="frame" style="aspect-ratio:${it.aspect}"><img src="./${it.src}" alt="${it.label}"/></div>
      <div class="meta">
        <p class="label">${it.label}</p>
        <p class="desc">${it.desc}</p>
        <a class="full" href="./${it.src}" target="_blank" rel="noopener">view full size</a>
      </div>
    </div>`).join("")}
  </div>
</body>
</html>`;
  await fs.writeFile(path.join(OUT_DIR, "index.html"), html, "utf8");
}

// ============================================================================
// Entry point
// ============================================================================
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("→ Cropping infinity glyph from banner.png…");
  const g = await getGlyph();
  console.log(`  ✓ Glyph: ${g.w}×${g.h}`);

  console.log("→ Hero icons (Invoiced + Landing)");
  await genHeroIcon("Invoiced", path.join(OUT_DIR, "app-icon-invoiced.png"));
  await genHeroIcon("Landing", path.join(OUT_DIR, "app-icon-landing.png"));

  console.log("→ Apple ID");
  await genAppleIdFinal();

  console.log("→ Contact poster");
  await genPosterFinal();

  console.log("→ Wallpapers (matched pair)");
  await genWallpaperFinals();

  console.log("→ Promoting icon to PWA paths");
  await promoteToPWA();

  console.log("→ Writing index.html viewer");
  await genIndexHtml();

  console.log("\n✅ Done. Open public/brand-assets/index.html");
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
