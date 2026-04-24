// Generates a seamless DQIII HD-2D-inspired parallax tile for the TopBar pill.
// Run with `pnpm tsx scripts/gen-dq-landscape.ts`.
// Output: public/sprites/dq-landscape.svg — tileable (x=0 ≡ x=W).
//
// Visual brief:
//   HD-2D-style layered depth, vivid DQ palette, atmospheric haze on far layers,
//   crisp pixel-like shapes in the foreground. Biomes flow forest → beach →
//   mountains → volcano, with a short forest tail re-emerging from volcanic ash
//   at the very end so the wrap x=W → x=0 is visually continuous.

import { writeFileSync } from "node:fs";

const W = 2000;
const H = 100;

// Biome slots (forest at x=0 AND at the wrap tail so tile[x≈W] ≡ tile[x≈0]).
const B1 = 0;    // pine forest (main)                      0–500
const B2 = 500;  // beach / coast (daytime sea + sand)      500–950
const B3 = 950;  // snowy mountains                         950–1400
const B4 = 1400; // volcano                                 1400–1800
const B5 = 1800; // forest wrap tail (ash clears to pines)  1800–2000

const parts: string[] = [];

parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">`,
);

// ─────────────── Sky (single horizontal gradient, wraps 0→W) ───────────────
// Dawn pink at 0% and 100% so the loop is seamless.
parts.push(`
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0"    stop-color="#7AA6C8"/> <!-- forest teal (B1 0–500) -->
    <stop offset="0.20" stop-color="#8FB8D2"/>
    <stop offset="0.27" stop-color="#B8DCE8"/> <!-- beach pale azure (B2 500–950) -->
    <stop offset="0.42" stop-color="#A7D8E8"/>
    <stop offset="0.475" stop-color="#C8DDEC"/> <!-- beach→snow cool bright -->
    <stop offset="0.54" stop-color="#D8E6F2"/> <!-- snowy mountain ice-blue (B3 950–1400) -->
    <stop offset="0.64" stop-color="#BCCEDE"/>
    <stop offset="0.70" stop-color="#8C6A7A"/> <!-- snow→volcano dusky transition -->
    <stop offset="0.78" stop-color="#7A3345"/> <!-- volcano deep red (B4 1400–1800) -->
    <stop offset="0.84" stop-color="#B04A3E"/> <!-- volcano peak (ashy fire-glow) -->
    <stop offset="0.90" stop-color="#6A4658"/> <!-- volcano cool-down / ash -->
    <stop offset="0.95" stop-color="#6F8896"/> <!-- ash-cloud fade toward forest (B5 1800–2000) -->
    <stop offset="1"    stop-color="#7AA6C8"/> <!-- back to forest teal — seamless wrap -->
  </linearGradient>
  <linearGradient id="skyBottom" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.12"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#skyBottom)"/>
`);

// ─────────────── Helpers ───────────────
const GROUND_Y = 72; // top of near foreground
const MID_Y = 62;    // top of midground
const FAR_Y = 50;    // top of far hills/silhouettes

type PinePalette = { pineShadow: string; pineMid: string; pineHi: string; pineTrunk: string };

// Pine tree: classic DQ-style layered triangles with trunk.
function pine(cx: number, baseY: number, h: number, p: PinePalette) {
  const out: string[] = [];
  const topY = baseY - h;
  const trunkH = Math.max(3, Math.round(h * 0.18));
  const trunkW = Math.max(2, Math.round(h * 0.06));
  out.push(`<rect x="${cx - Math.floor(trunkW / 2)}" y="${baseY - trunkH}" width="${trunkW}" height="${trunkH}" fill="${p.pineTrunk}"/>`);
  const halfBase = Math.round(h * 0.42);
  const halfMid = Math.round(h * 0.33);
  const halfTop = Math.round(h * 0.22);
  const y1 = baseY - trunkH;
  const y2 = y1 - Math.round(h * 0.28);
  const y3 = y2 - Math.round(h * 0.26);
  out.push(`<polygon points="${cx - halfBase},${y1} ${cx + halfBase},${y1} ${cx},${y1 - Math.round(h * 0.35)}" fill="${p.pineShadow}"/>`);
  out.push(`<polygon points="${cx - halfMid},${y2} ${cx + halfMid},${y2} ${cx},${y2 - Math.round(h * 0.3)}" fill="${p.pineMid}"/>`);
  out.push(`<polygon points="${cx - halfTop},${y3} ${cx + halfTop},${y3} ${cx},${topY}" fill="${p.pineHi}"/>`);
  return out.join("");
}

// Rounded hill mound.
function hill(cx: number, baseY: number, rx: number, ry: number, fill: string, highlight?: string) {
  let s = `<ellipse cx="${cx}" cy="${baseY}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
  if (highlight) {
    s += `<ellipse cx="${cx - Math.round(rx * 0.3)}" cy="${baseY - Math.round(ry * 0.55)}" rx="${Math.round(rx * 0.55)}" ry="${Math.max(1, Math.round(ry * 0.35))}" fill="${highlight}" fill-opacity="0.55"/>`;
  }
  return s;
}

// ─────────────── Pine Forest (main biome + wrap tail) ───────────────
// All features are placed on an absolute grid so the wrap tail (B5..W) visually
// continues into the main biome (0..B2) when tiled.
function pineForest(x0: number, x1: number) {
  const out: string[] = [];
  const w = x1 - x0;
  const pal = {
    floorBase: "#2E5A38",
    floorHi: "#436E48",
    pineShadowFar: "#0D2A16",
    pineMidFar: "#1B3D25",
    pineHiFar: "#275C33",
    pineShadow: "#173C22",
    pineMid: "#276039",
    pineHi: "#4AA159",
    pineTrunk: "#3B1E10",
    trunkFar: "#1C0E07",
  };
  const farPine: PinePalette = {
    pineShadow: pal.pineShadowFar,
    pineMid: pal.pineMidFar,
    pineHi: pal.pineHiFar,
    pineTrunk: pal.trunkFar,
  };

  // Atmospheric teal haze overlay near top of biome
  out.push(`<rect x="${x0}" y="0" width="${w}" height="${MID_Y - 6}" fill="#4A7E9B" fill-opacity="0.12"/>`);

  // Dense BACK pine wall (absolute every 12 px)
  const farSpacing = 12;
  const farFirst = Math.floor(x0 / farSpacing) * farSpacing;
  for (let x = farFirst - farSpacing; x <= x1 + farSpacing; x += farSpacing) {
    if (x < x0 - farSpacing || x > x1 + farSpacing) continue;
    const varH = 14 + (((x / farSpacing) % 5) + 5) % 5;
    out.push(pine(x, FAR_Y + 12, varH, farPine));
  }

  // Forest floor
  out.push(`<rect x="${x0}" y="${MID_Y + 2}" width="${w}" height="${H - (MID_Y + 2)}" fill="${pal.floorBase}"/>`);
  out.push(`<rect x="${x0}" y="${MID_Y + 2}" width="${w}" height="2" fill="${pal.floorHi}"/>`);

  // Sunbeams (abs every 100 px)
  const beamSpacing = 100;
  const beamFirst = Math.ceil(x0 / beamSpacing) * beamSpacing;
  for (let sx = beamFirst - beamSpacing; sx <= x1 + beamSpacing; sx += beamSpacing) {
    if (sx < x0 - 20 || sx > x1 + 20) continue;
    out.push(`<polygon points="${sx},10 ${sx + 18},10 ${sx + 8},${H} ${sx - 10},${H}" fill="#FFF8D0" fill-opacity="0.08"/>`);
  }

  // Mid-sized pines (abs grid every 55 px, deterministic height)
  const midSpacing = 55;
  const midHeights = [28, 32, 26, 30, 34, 27, 31, 29, 33, 26];
  const midFirst = Math.floor(x0 / midSpacing);
  const midLast = Math.ceil(x1 / midSpacing);
  for (let i = midFirst - 1; i <= midLast + 1; i++) {
    const cx = i * midSpacing + 30;
    if (cx < x0 - 20 || cx > x1 + 20) continue;
    const h = midHeights[((i % midHeights.length) + midHeights.length) % midHeights.length]!;
    out.push(pine(cx, GROUND_Y + 4, h, pal));
  }

  // Ground speckles (abs every 27 px)
  const specSpacing = 27;
  const specFirst = Math.floor(x0 / specSpacing);
  const specLast = Math.ceil(x1 / specSpacing);
  for (let i = specFirst; i <= specLast; i++) {
    const sx = i * specSpacing + 12;
    if (sx < x0 || sx > x1) continue;
    const kind = ((i % 4) + 4) % 4;
    if (kind === 0) out.push(`<rect x="${sx}" y="${GROUND_Y + 4}" width="3" height="2" fill="#5A6B42"/>`);
    else if (kind === 1) out.push(`<rect x="${sx}" y="${GROUND_Y + 7}" width="2" height="1" fill="#8C7A4F"/>`);
    else if (kind === 2) {
      out.push(`<rect x="${sx}" y="${GROUND_Y + 6}" width="1" height="3" fill="#F2EAD0"/>`);
      out.push(`<rect x="${sx - 1}" y="${GROUND_Y + 5}" width="3" height="2" fill="#C33A3A"/>`);
    } else out.push(`<rect x="${sx}" y="${GROUND_Y + 8}" width="2" height="1" fill="#6B5A38"/>`);
  }

  // Fireflies (abs every 45 px)
  const flySpacing = 45;
  const flyFirst = Math.floor(x0 / flySpacing);
  const flyLast = Math.ceil(x1 / flySpacing);
  for (let i = flyFirst; i <= flyLast; i++) {
    const fx = i * flySpacing + 25;
    if (fx < x0 || fx > x1) continue;
    const fy = 40 + (((i % 4) + 4) % 4) * 8;
    out.push(`<rect x="${fx}" y="${fy}" width="1" height="1" fill="#FFF4B0"/>`);
  }

  return out.join("");
}
parts.push(pineForest(B1, B2));

// ─────────────── Snowy Mountains ───────────────
function snowMountains(x0: number, x1: number) {
  const out: string[] = [];
  const w = x1 - x0;
  const pal = {
    farMtn: "#A7B8CE",
    farMtnShadow: "#89A0BA",
    nearMtn: "#6B7A92",
    nearMtnShadow: "#475468",
    snow: "#F5F7FA",
    snowShadow: "#C9D3E2",
    snowGround: "#EAF2F8",
    snowGroundHi: "#FFFFFF",
    snowGroundShadow: "#C2CED8",
    iceBlue: "#9CC6DA",
    pineShadow: "#1A3A28",
    pineMid: "#2E5A40",
    pineHi: "#4A8A5C",
    pineTrunk: "#3B1E10",
    snowCap: "#FFFFFF",
  };

  // Atmospheric icy haze
  out.push(`<rect x="${x0}" y="0" width="${w}" height="${FAR_Y}" fill="#D6E4F0" fill-opacity="0.24"/>`);

  // Far mountain range (hazy, pale blue-gray)
  const farPeaks = [30, 22, 34, 24, 30, 26, 32] as const;
  for (let i = 0; i < farPeaks.length; i++) {
    const cx = x0 + 30 + i * 65;
    const peakY = FAR_Y - (farPeaks[i] ?? 26) + 12;
    out.push(`<polygon points="${cx - 48},${FAR_Y + 8} ${cx + 48},${FAR_Y + 8} ${cx},${peakY}" fill="${pal.farMtn}"/>`);
    out.push(`<polygon points="${cx},${FAR_Y + 8} ${cx + 48},${FAR_Y + 8} ${cx},${peakY}" fill="${pal.farMtnShadow}" fill-opacity="0.55"/>`);
    // far snow caps
    out.push(`<polygon points="${cx - 8},${peakY + 6} ${cx + 8},${peakY + 6} ${cx},${peakY}" fill="${pal.snow}" fill-opacity="0.85"/>`);
  }

  // Near mountains (bigger, heavily snow-capped, almost fully snowy)
  const nearPeaks = [
    { cx: x0 + 60, peak: 12 },
    { cx: x0 + 160, peak: 6 },
    { cx: x0 + 250, peak: 16 },
    { cx: x0 + 340, peak: 10 },
    { cx: x0 + 420, peak: 20 },
  ];
  for (const p of nearPeaks) {
    // mountain body
    out.push(`<polygon points="${p.cx - 55},${MID_Y + 4} ${p.cx + 55},${MID_Y + 4} ${p.cx},${p.peak}" fill="${pal.nearMtn}"/>`);
    // shadow side
    out.push(`<polygon points="${p.cx},${MID_Y + 4} ${p.cx + 55},${MID_Y + 4} ${p.cx},${p.peak}" fill="${pal.nearMtnShadow}" fill-opacity="0.55"/>`);
    // LARGE snow cap covering upper ~60% of peak
    const capBase = p.peak + 20;
    out.push(`<polygon points="${p.cx - 26},${capBase} ${p.cx + 26},${capBase} ${p.cx},${p.peak}" fill="${pal.snow}"/>`);
    // snow drip finger lines down the slope
    out.push(`<polygon points="${p.cx - 26},${capBase} ${p.cx - 18},${capBase + 6} ${p.cx - 10},${capBase}" fill="${pal.snow}"/>`);
    out.push(`<polygon points="${p.cx + 10},${capBase} ${p.cx + 18},${capBase + 6} ${p.cx + 26},${capBase}" fill="${pal.snow}"/>`);
    // cap shadow on the dark side
    out.push(`<polygon points="${p.cx},${capBase} ${p.cx + 26},${capBase} ${p.cx},${p.peak}" fill="${pal.snowShadow}" fill-opacity="0.55"/>`);
  }

  // Snowy ground
  out.push(`<rect x="${x0}" y="${GROUND_Y - 2}" width="${w}" height="${H - (GROUND_Y - 2)}" fill="${pal.snowGround}"/>`);
  out.push(`<rect x="${x0}" y="${GROUND_Y - 2}" width="${w}" height="2" fill="${pal.snowGroundHi}"/>`);
  // Subtle blue shadow drifts on the snow
  for (let i = 0; i < 8; i++) {
    const dx = x0 + 20 + i * 55;
    out.push(`<ellipse cx="${dx}" cy="${GROUND_Y + 5}" rx="18" ry="2" fill="${pal.snowGroundShadow}" fill-opacity="0.4"/>`);
  }

  // Snow-laden pine trees (dark foliage with white snow dollops on top)
  const pinePal: PinePalette = {
    pineShadow: pal.pineShadow,
    pineMid: pal.pineMid,
    pineHi: pal.pineHi,
    pineTrunk: pal.pineTrunk,
  };
  const snowPineSpacing = 55;
  const snowPineHeights = [20, 17, 22, 19, 24, 18, 21];
  for (let i = 0; i < 8; i++) {
    const cx = x0 + 25 + i * snowPineSpacing;
    if (cx > x1 - 10) break;
    const h = snowPineHeights[i % snowPineHeights.length]!;
    out.push(pine(cx, GROUND_Y, h, pinePal));
    // snow dollop on the canopy
    const snowY = GROUND_Y - Math.round(h * 0.18) - Math.round(h * 0.84);
    out.push(`<ellipse cx="${cx - 3}" cy="${snowY + 4}" rx="4" ry="1.5" fill="${pal.snowCap}"/>`);
    out.push(`<ellipse cx="${cx + 2}" cy="${snowY + 8}" rx="3" ry="1.2" fill="${pal.snowCap}"/>`);
    out.push(`<rect x="${cx - 1}" y="${snowY - 1}" width="2" height="2" fill="${pal.snowCap}"/>`);
  }

  // Icicle accents on a mid mountain ridge (decorative)
  for (let i = 0; i < 6; i++) {
    const ix = x0 + 40 + i * 70;
    out.push(`<polygon points="${ix},${MID_Y + 5} ${ix + 3},${MID_Y + 5} ${ix + 1.5},${MID_Y + 10}" fill="${pal.iceBlue}" fill-opacity="0.85"/>`);
  }

  // Drifting snowflakes (tiny white dots)
  for (let i = 0; i < 20; i++) {
    const sx = x0 + 15 + i * 23;
    const sy = 15 + (((i * 7) % 30));
    out.push(`<rect x="${sx}" y="${sy}" width="1" height="1" fill="#FFFFFF" fill-opacity="0.85"/>`);
  }

  return out.join("");
}
parts.push(snowMountains(B3, B4));

// ─────────────── Beach / Coast (daytime) ───────────────
function beachCoast(x0: number, x1: number) {
  const out: string[] = [];
  const w = x1 - x0;
  const pal = {
    seaDeep: "#2458A4",
    seaMid: "#3A7EC2",
    seaShallow: "#6FB6DC",
    seaFoam: "#CFEAF2",
    sandBase: "#EFD29A",
    sandHi: "#F9E3B2",
    sandEdge: "#C89C62",
    shellWhite: "#FAF0E0",
    shellPink: "#F4B3B3",
    palmFrond: "#2E7D42",
    palmFrondHi: "#56A562",
    palmTrunk: "#7B5030",
    roofRed: "#B64B3E",
    roofShadow: "#842E22",
    wall: "#F2E2BE",
    wallShadow: "#C6A87A",
    windowGlow: "#FDE085",
    shipHull: "#5A3A24",
    shipSail: "#FFFFFF",
    shipSailShadow: "#D5C4A0",
  };

  // Soft sunlit haze
  out.push(`<rect x="${x0}" y="0" width="${w}" height="${H}" fill="#FFF4D0" fill-opacity="0.06"/>`);

  // Distant landmass silhouette (softened, hazy)
  out.push(`<path d="M${x0},${MID_Y - 2} Q${x0 + 70},${MID_Y - 10} ${x0 + 140},${MID_Y - 4} T${x0 + 280},${MID_Y - 6} T${x1},${MID_Y - 2} L${x1},${MID_Y + 8} L${x0},${MID_Y + 8} Z" fill="#93B1C8" fill-opacity="0.55"/>`);

  // Sea bands: shallow-mid-deep gradient via stripes
  out.push(`<rect x="${x0}" y="${MID_Y}" width="${w}" height="3" fill="${pal.seaShallow}"/>`);
  out.push(`<rect x="${x0}" y="${MID_Y + 3}" width="${w}" height="4" fill="${pal.seaMid}"/>`);
  out.push(`<rect x="${x0}" y="${MID_Y + 7}" width="${w}" height="${GROUND_Y - (MID_Y + 7)}" fill="${pal.seaDeep}"/>`);

  // Foam-edge just before shore
  out.push(`<rect x="${x0}" y="${GROUND_Y - 2}" width="${w}" height="1" fill="${pal.seaFoam}"/>`);

  // Wave highlights (sunlit sparkles)
  for (let i = 0; i < 30; i++) {
    const wx = x0 + 6 + i * 16;
    const wy = MID_Y + 2 + (i % 4) * 3;
    out.push(`<rect x="${wx}" y="${wy}" width="4" height="1" fill="${pal.seaFoam}" fill-opacity="0.8"/>`);
  }

  // A sailing ship, mid-left
  const shx = x0 + 110;
  const shy = MID_Y + 6;
  out.push(`<rect x="${shx - 12}" y="${shy}" width="24" height="4" fill="${pal.shipHull}"/>`);
  out.push(`<rect x="${shx - 12}" y="${shy + 3}" width="24" height="1" fill="#2E1A0A"/>`);
  out.push(`<rect x="${shx - 5}" y="${shy - 14}" width="1" height="14" fill="#1F1108"/>`);
  out.push(`<rect x="${shx + 6}" y="${shy - 11}" width="1" height="11" fill="#1F1108"/>`);
  out.push(`<polygon points="${shx - 4},${shy - 14} ${shx - 4},${shy - 2} ${shx + 4},${shy - 2}" fill="${pal.shipSail}"/>`);
  out.push(`<polygon points="${shx + 7},${shy - 11} ${shx + 7},${shy - 3} ${shx + 12},${shy - 3}" fill="${pal.shipSailShadow}"/>`);

  // Coastal town with red roofs (on the back landmass)
  const townX = x0 + 300;
  const townBase = MID_Y + 2;
  out.push(`<rect x="${townX}" y="${townBase - 10}" width="80" height="10" fill="${pal.wall}"/>`);
  out.push(`<rect x="${townX}" y="${townBase - 10}" width="80" height="2" fill="${pal.wallShadow}"/>`);
  for (let i = 0; i < 5; i++) {
    const rx = townX + 4 + i * 16;
    out.push(`<polygon points="${rx},${townBase - 10} ${rx + 14},${townBase - 10} ${rx + 7},${townBase - 18}" fill="${pal.roofRed}"/>`);
    out.push(`<polygon points="${rx + 7},${townBase - 10} ${rx + 14},${townBase - 10} ${rx + 7},${townBase - 18}" fill="${pal.roofShadow}"/>`);
  }
  for (let i = 0; i < 4; i++) {
    out.push(`<rect x="${townX + 10 + i * 18}" y="${townBase - 6}" width="2" height="3" fill="${pal.windowGlow}"/>`);
  }
  // Harbor tower
  out.push(`<rect x="${townX + 80}" y="${townBase - 24}" width="8" height="24" fill="${pal.wall}"/>`);
  out.push(`<polygon points="${townX + 80},${townBase - 24} ${townX + 88},${townBase - 24} ${townX + 84},${townBase - 30}" fill="${pal.roofRed}"/>`);
  out.push(`<rect x="${townX + 83}" y="${townBase - 18}" width="2" height="2" fill="${pal.windowGlow}"/>`);

  // Sandy beach foreground
  out.push(`<rect x="${x0}" y="${GROUND_Y}" width="${w}" height="${H - GROUND_Y}" fill="${pal.sandBase}"/>`);
  out.push(`<rect x="${x0}" y="${GROUND_Y}" width="${w}" height="2" fill="${pal.sandHi}"/>`);
  out.push(`<rect x="${x0}" y="${GROUND_Y + 2}" width="${w}" height="1" fill="${pal.sandEdge}"/>`);

  // A pair of palm trees near the shore
  const palms = [x0 + 60, x0 + 420];
  for (const px of palms) {
    // curving trunk
    out.push(`<path d="M${px},${GROUND_Y} Q${px + 3},${GROUND_Y - 10} ${px + 1},${GROUND_Y - 22}" stroke="${pal.palmTrunk}" stroke-width="2" fill="none"/>`);
    // fronds
    out.push(`<ellipse cx="${px - 6}" cy="${GROUND_Y - 24}" rx="9" ry="2" fill="${pal.palmFrond}" transform="rotate(-22 ${px - 6} ${GROUND_Y - 24})"/>`);
    out.push(`<ellipse cx="${px + 7}" cy="${GROUND_Y - 24}" rx="9" ry="2" fill="${pal.palmFrond}" transform="rotate(22 ${px + 7} ${GROUND_Y - 24})"/>`);
    out.push(`<ellipse cx="${px}" cy="${GROUND_Y - 27}" rx="2" ry="5" fill="${pal.palmFrondHi}"/>`);
    out.push(`<rect x="${px + 3}" y="${GROUND_Y - 20}" width="1" height="1" fill="#DEA75A"/>`);
  }

  // Shells & pebbles on the sand
  for (let i = 0; i < 14; i++) {
    const tx = x0 + 18 + i * 30;
    if (i % 3 === 0) out.push(`<circle cx="${tx}" cy="${GROUND_Y + 6}" r="1.2" fill="${pal.shellWhite}"/>`);
    else if (i % 3 === 1) out.push(`<rect x="${tx}" y="${GROUND_Y + 5}" width="2" height="1" fill="${pal.shellPink}"/>`);
    else out.push(`<rect x="${tx}" y="${GROUND_Y + 7}" width="1" height="1" fill="#5F4020"/>`);
  }

  return out.join("");
}
parts.push(beachCoast(B2, B3));

// ─────────────── Volcano ───────────────
function volcano(x0: number, x1: number) {
  const out: string[] = [];
  const w = x1 - x0;
  const pal = {
    ridgeFar: "#3E2A36",
    ridgeMid: "#2A1E24",
    ridgeShadow: "#140E12",
    coneDark: "#1F1519",
    coneMid: "#3A2428",
    coneHi: "#553336",
    lavaDeep: "#E23C1E",
    lavaMid: "#FF7636",
    lavaHi: "#FFD15C",
    craterGlow: "#FFD15C",
    craterHot: "#FFE88A",
    ashCloud: "#5E4C5C",
    ashCloudHi: "#806E82",
    groundBase: "#261A1F",
    groundHi: "#3A272D",
    groundEdge: "#120A0E",
    emberGlow: "#FFB04A",
    deadTreeBark: "#2A1410",
    deadTreeDark: "#18080A",
  };

  // Red ash haze overlay
  out.push(`<rect x="${x0}" y="0" width="${w}" height="${H}" fill="#7A2B2B" fill-opacity="0.08"/>`);

  // Background jagged volcanic ridges (distant)
  for (let i = 0; i < 6; i++) {
    const cx = x0 + 30 + i * 65;
    const peakY = FAR_Y - (i % 2 === 0 ? 18 : 10) + 14;
    out.push(`<polygon points="${cx - 40},${FAR_Y + 8} ${cx + 40},${FAR_Y + 8} ${cx},${peakY}" fill="${pal.ridgeFar}"/>`);
  }

  // Ash cloud plumes (far, billowing)
  for (let i = 0; i < 3; i++) {
    const cx = x0 + 80 + i * 140;
    out.push(`<ellipse cx="${cx}" cy="${FAR_Y - 20}" rx="32" ry="12" fill="${pal.ashCloud}" fill-opacity="0.6"/>`);
    out.push(`<ellipse cx="${cx - 10}" cy="${FAR_Y - 24}" rx="18" ry="8" fill="${pal.ashCloudHi}" fill-opacity="0.5"/>`);
    out.push(`<ellipse cx="${cx + 14}" cy="${FAR_Y - 18}" rx="14" ry="6" fill="${pal.ashCloud}" fill-opacity="0.7"/>`);
  }

  // MAIN volcano cone (center-left of biome, large)
  const vcx = x0 + 170;
  const vbase = MID_Y + 4;
  const vtop = 12; // Y of crater rim
  const vHalfBase = 70;
  // cone body
  out.push(`<polygon points="${vcx - vHalfBase},${vbase} ${vcx + vHalfBase},${vbase} ${vcx + 10},${vtop} ${vcx - 10},${vtop}" fill="${pal.coneMid}"/>`);
  // shadow side (right)
  out.push(`<polygon points="${vcx},${vbase} ${vcx + vHalfBase},${vbase} ${vcx + 10},${vtop}" fill="${pal.coneDark}" fill-opacity="0.7"/>`);
  // highlight (left edge)
  out.push(`<polygon points="${vcx - vHalfBase},${vbase} ${vcx - 40},${vbase} ${vcx - 8},${vtop + 6}" fill="${pal.coneHi}" fill-opacity="0.35"/>`);

  // Crater rim & glow
  out.push(`<rect x="${vcx - 10}" y="${vtop - 1}" width="20" height="3" fill="${pal.lavaDeep}"/>`);
  out.push(`<rect x="${vcx - 8}" y="${vtop}" width="16" height="2" fill="${pal.lavaMid}"/>`);
  out.push(`<rect x="${vcx - 6}" y="${vtop + 1}" width="12" height="1" fill="${pal.craterHot}"/>`);
  // Crater glow halo
  out.push(`<ellipse cx="${vcx}" cy="${vtop - 2}" rx="14" ry="4" fill="${pal.craterGlow}" fill-opacity="0.25"/>`);

  // Lava streams running down the cone (3 rivulets)
  const lavaPaths = [
    `M${vcx - 4},${vtop + 2} L${vcx - 14},${vbase}`,
    `M${vcx + 3},${vtop + 2} L${vcx + 22},${vbase - 3}`,
    `M${vcx},${vtop + 2} L${vcx + 4},${vbase}`,
  ];
  for (const d of lavaPaths) {
    out.push(`<path d="${d}" stroke="${pal.lavaDeep}" stroke-width="2" fill="none"/>`);
    out.push(`<path d="${d}" stroke="${pal.lavaHi}" stroke-width="1" fill="none"/>`);
  }

  // Ash column rising from crater
  out.push(`<ellipse cx="${vcx}" cy="${vtop - 10}" rx="10" ry="5" fill="${pal.ashCloudHi}" fill-opacity="0.8"/>`);
  out.push(`<ellipse cx="${vcx - 3}" cy="${vtop - 18}" rx="14" ry="6" fill="${pal.ashCloud}" fill-opacity="0.7"/>`);
  out.push(`<ellipse cx="${vcx + 4}" cy="${vtop - 26}" rx="18" ry="7" fill="${pal.ashCloud}" fill-opacity="0.55"/>`);

  // Secondary smaller cone on the right
  const v2cx = x0 + 340;
  const v2top = 26;
  const v2base = MID_Y + 4;
  out.push(`<polygon points="${v2cx - 35},${v2base} ${v2cx + 35},${v2base} ${v2cx},${v2top}" fill="${pal.coneMid}"/>`);
  out.push(`<polygon points="${v2cx},${v2base} ${v2cx + 35},${v2base} ${v2cx},${v2top}" fill="${pal.coneDark}" fill-opacity="0.6"/>`);
  out.push(`<rect x="${v2cx - 4}" y="${v2top}" width="8" height="2" fill="${pal.lavaMid}"/>`);

  // Dark volcanic rock ground
  out.push(`<rect x="${x0}" y="${GROUND_Y - 2}" width="${w}" height="${H - (GROUND_Y - 2)}" fill="${pal.groundBase}"/>`);
  out.push(`<rect x="${x0}" y="${GROUND_Y - 2}" width="${w}" height="1" fill="${pal.groundHi}"/>`);
  out.push(`<rect x="${x0}" y="${GROUND_Y - 1}" width="${w}" height="1" fill="${pal.groundEdge}"/>`);

  // Cracked-rock hint (thin bright fissures)
  for (let i = 0; i < 10; i++) {
    const rx = x0 + 20 + i * 42;
    out.push(`<rect x="${rx}" y="${GROUND_Y + 3}" width="6" height="1" fill="${pal.lavaDeep}" fill-opacity="0.8"/>`);
    out.push(`<rect x="${rx + 1}" y="${GROUND_Y + 4}" width="3" height="1" fill="${pal.lavaHi}" fill-opacity="0.7"/>`);
  }

  // Lava pools (foreground hot puddles)
  const pools = [
    { cx: x0 + 80,  rx: 14, ry: 3 },
    { cx: x0 + 230, rx: 10, ry: 2 },
    { cx: x0 + 330, rx: 12, ry: 2 },
  ];
  for (const p of pools) {
    out.push(`<ellipse cx="${p.cx}" cy="${GROUND_Y + 8}" rx="${p.rx + 2}" ry="${p.ry + 1}" fill="${pal.lavaDeep}"/>`);
    out.push(`<ellipse cx="${p.cx}" cy="${GROUND_Y + 8}" rx="${p.rx}" ry="${p.ry}" fill="${pal.lavaMid}"/>`);
    out.push(`<ellipse cx="${p.cx}" cy="${GROUND_Y + 7}" rx="${Math.max(2, p.rx - 4)}" ry="${Math.max(1, p.ry - 1)}" fill="${pal.lavaHi}"/>`);
    // glow radiating
    out.push(`<ellipse cx="${p.cx}" cy="${GROUND_Y + 6}" rx="${p.rx + 6}" ry="${p.ry + 3}" fill="${pal.craterGlow}" fill-opacity="0.12"/>`);
  }

  // Dead / burnt tree silhouettes
  const deadTrees = [x0 + 50, x0 + 155, x0 + 290, x0 + 385];
  for (const tx of deadTrees) {
    out.push(`<rect x="${tx}" y="${GROUND_Y - 12}" width="2" height="12" fill="${pal.deadTreeBark}"/>`);
    // jagged branches
    out.push(`<line x1="${tx + 1}" y1="${GROUND_Y - 9}" x2="${tx - 4}" y2="${GROUND_Y - 14}" stroke="${pal.deadTreeDark}" stroke-width="1"/>`);
    out.push(`<line x1="${tx + 1}" y1="${GROUND_Y - 7}" x2="${tx + 6}" y2="${GROUND_Y - 11}" stroke="${pal.deadTreeDark}" stroke-width="1"/>`);
    out.push(`<line x1="${tx + 1}" y1="${GROUND_Y - 10}" x2="${tx + 4}" y2="${GROUND_Y - 15}" stroke="${pal.deadTreeDark}" stroke-width="1"/>`);
  }

  // Floating embers (warm glow dots in mid-air)
  for (let i = 0; i < 14; i++) {
    const ex = x0 + 15 + i * 30;
    const ey = 18 + ((i * 11) % 30);
    out.push(`<rect x="${ex}" y="${ey}" width="1" height="1" fill="${pal.emberGlow}"/>`);
    if (i % 3 === 0) out.push(`<rect x="${ex + 1}" y="${ey + 1}" width="1" height="1" fill="${pal.lavaMid}" fill-opacity="0.8"/>`);
  }

  return out.join("");
}
parts.push(volcano(B4, B5));

// Wrap tail — pine forest again (deterministic abs-X positioning makes the tile's
// last 200 px visually continue into the main pine forest at x=0, so the seam vanishes).
parts.push(pineForest(B5, W));

// ─────────────── Biome-boundary gradient blends (smooth ground color jumps) ───────────────
function boundaryBlend(x: number, colorLeft: string, colorRight: string, width = 40) {
  const id = `blend-${x}`;
  return `
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${colorLeft}"/>
      <stop offset="1" stop-color="${colorRight}"/>
    </linearGradient>
  </defs>
  <rect x="${x - width / 2}" y="${MID_Y}" width="${width}" height="${H - MID_Y}" fill="url(#${id})"/>
  `;
}
parts.push(boundaryBlend(B2, "#2E5A38", "#2458A4", 40)); // pine floor → deep sea
parts.push(boundaryBlend(B3, "#EFD29A", "#EAF2F8", 50)); // beach sand → snow ground
parts.push(boundaryBlend(B4, "#EAF2F8", "#261A1F", 40)); // snow ground → volcanic rock
parts.push(boundaryBlend(B5, "#261A1F", "#2E5A38", 70)); // volcanic rock → forest floor (wide blend to soften the transition)
// No blend at W — pine forest wrap tail ends where pine forest at x=0 begins, identical content.

parts.push(`</svg>`);

writeFileSync("public/sprites/dq-landscape.svg", parts.join("\n"));
console.log(`wrote public/sprites/dq-landscape.svg (${W}×${H})`);
