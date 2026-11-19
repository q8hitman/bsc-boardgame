import { PITCH } from "../../../shared/football/types";
import { BOARD_H, END_X, FAR_BOARD_FOOT, HALF_L, HALF_W, NEAR_BOARD_TOP, PPM, PY, WORLD, wx, wy } from "./geom";

/** Pixel art drawn in code: the grass and its markings (one texture), the ball, shadows, the ad boards with the
 *  club's science jokes (logos generated as pixel art, text rasterised hard-edged so it reads as pixel lettering),
 *  the near stand's concrete tiers. Everything is drawn at 1 art pixel = 1 world pixel and never smoothed. */

export const FONT = '"Baloo Bhaijaan 2", system-ui, sans-serif';

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const css = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const shade = (c: [number, number, number], k: number): [number, number, number] => [
  Math.max(0, Math.min(255, Math.round(c[0] * k))),
  Math.max(0, Math.min(255, Math.round(c[1] * k))),
  Math.max(0, Math.min(255, Math.round(c[2] * k))),
];
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------------------------------------------ grass + markings */
export const PITCH_TEX = { x: WORLD.left, y: FAR_BOARD_FOOT - 2, w: WORLD.right - WORLD.left, h: NEAR_BOARD_TOP - FAR_BOARD_FOOT + 4 };

/** the pitch is drawn once per page and reused by every match after (it is the slowest thing to build: on a phone
 *  it used to stall the start of every match) */
let pitchCache: HTMLCanvasElement | null = null;
/** the fine grass grain (speckles, blades, mowing grain) as brightness offsets on a 512 x 256 tile: three hashes a
 *  pixel over the whole 3000 x 860 pitch was most of the build time, the tile repeats unnoticed under the mottling */
let grain: Float32Array | null = null;
const GW = 512;
const GH = 256;
function grainTile() {
  if (grain) return grain;
  grain = new Float32Array(GW * GH);
  for (let py = 0; py < GH; py++)
    for (let px = 0; px < GW; px++) {
      let k = 0;
      const r = hash(px, py);
      if (r < 0.1) k -= 0.07;
      else if (r < 0.17) k += 0.06;
      // little vertical blades, two pixels tall
      if (hash(px * 3 + 1, (py >> 1) * 7) < 0.045) k -= 0.12;
      else if (hash(px * 5 + 2, (py >> 1) * 11) < 0.02) k += 0.1;
      // diagonal mowing grain
      if (((px + (py >> 1)) & 7) === 0 && r < 0.5) k -= 0.03;
      grain[py * GW + px] = k;
    }
  return grain;
}
/** warm the pitch up ahead of time (the menu calls this while the player is still choosing) */
export function preparePitch() {
  drawPitch();
}

export function drawPitch(): HTMLCanvasElement {
  if (pitchCache) return pitchCache;
  pitchCache = buildPitch();
  return pitchCache;
}

function buildPitch(): HTMLCanvasElement {
  const { x: ox, y: oy, w, h } = PITCH_TEX;
  const gr = grainTile();
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const d = img.data;
  const light = rgb(0x5cab37);
  const dark = rgb(0x4c9a2e);
  const apron = rgb(0x3e7a2c);
  const stripe = 3.2 * PPM;
  // low-frequency mottling, 48-px cells, bilinear
  const cell = 48;
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const lf = new Float32Array(gw * gh).map((_, i) => hash(i % gw, ((i / gw) | 0) + 777) - 0.5);
  const endPx = END_X * PPM;
  // per column: the stripe colour and where it falls between two mottling cells (the inner loop only adds)
  const colR = new Float32Array(w);
  const colG = new Float32Array(w);
  const colB = new Float32Array(w);
  const colI = new Int32Array(w);
  const colU = new Float32Array(w);
  for (let px = 0; px < w; px++) {
    const X = px + ox;
    const base = Math.abs(X) > endPx ? apron : Math.floor((X + HALF_L * PPM) / stripe) % 2 === 0 ? light : dark;
    colR[px] = base[0];
    colG[px] = base[1];
    colB[px] = base[2];
    const fx = px / cell;
    colI[px] = fx | 0;
    colU[px] = fx - (fx | 0);
  }
  for (let py = 0; py < h; py++) {
    const Y = py + oy;
    // the far side is a touch darker, like the reference's light falloff
    const fall = 0.94 + 0.08 * ((Y - FAR_BOARD_FOOT) / (NEAR_BOARD_TOP - FAR_BOARD_FOOT));
    const fy = py / cell;
    const iy = fy | 0;
    const v = fy - iy;
    const r0 = iy * gw;
    const r1 = r0 + gw;
    const grow = (py & (GH - 1)) * GW;
    let o = py * w * 4;
    for (let px = 0; px < w; px++) {
      const ix = colI[px];
      const u = colU[px];
      const lv = (lf[r0 + ix] * (1 - u) + lf[r0 + ix + 1] * u) * (1 - v) + (lf[r1 + ix] * (1 - u) + lf[r1 + ix + 1] * u) * v;
      const k = fall + Math.round(lv * 10) * 0.012 + gr[grow + (px & (GW - 1))];
      // (a clamped array: >255 is 255)
      d[o] = colR[px] * k;
      d[o + 1] = colG[px] * k;
      d[o + 2] = colB[px] * k;
      d[o + 3] = 255;
      o += 4;
    }
  }
  // ---- markings
  const line = rgb(0xeef6e8);
  const worn = rgb(0xcfe0c6);
  const put = (X: number, Y: number) => {
    const px = Math.round(X - ox);
    const py = Math.round(Y - oy);
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const o = (py * w + px) * 4;
    const c2 = hash(px * 13, py * 7) < 0.07 ? worn : line;
    d[o] = c2[0];
    d[o + 1] = c2[1];
    d[o + 2] = c2[2];
  };
  /** a crisp line in metres: 3 px wide across x, 2 px tall across y */
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0) * PPM, Math.abs(y1 - y0) * PY)) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const X = Math.round((x0 + (x1 - x0) * t) * PPM);
      const Y = Math.round((y0 + (y1 - y0) * t) * PY);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 0; b++) put(X + a, Y + b);
    }
  };
  const arc = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, keep?: (x: number, y: number) => boolean) => {
    const n = Math.ceil(r * PPM * 8);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (keep && !keep(x, y)) continue;
      const X = Math.round(x * PPM);
      const Y = Math.round(y * PY);
      for (let p = -1; p <= 1; p++) for (let q = -1; q <= 0; q++) put(X + p, Y + q);
    }
  };
  const L = HALF_L;
  const W = HALF_W;
  seg(-L, -W, L, -W);
  seg(-L, W, L, W);
  seg(-L, -W, -L, W);
  seg(L, -W, L, W);
  seg(0, -W, 0, W);
  arc(0, 0, PITCH.centreRadius);
  arc(0, 0, 0.28);
  arc(0, 0, 0.14);
  for (const s of [-1, 1]) {
    const gx = s * L;
    const bx = s * (L - PITCH.boxDepth);
    const bw = PITCH.boxWidth / 2;
    seg(gx, -bw, bx, -bw);
    seg(gx, bw, bx, bw);
    seg(bx, -bw, bx, bw);
    const sx = s * (L - 3.5);
    seg(gx, -6, sx, -6);
    seg(gx, 6, sx, 6);
    seg(sx, -6, sx, 6);
    const ps = s * (L - PITCH.penSpot);
    arc(ps, 0, 0.22);
    arc(ps, 0, 0.11);
    arc(ps, 0, 5, 0, Math.PI * 2, (x) => Math.abs(x) < L - PITCH.boxDepth - 0.05);
    for (const t of [-1, 1]) arc(gx, t * W, 1, 0, Math.PI * 2, (x, y) => Math.abs(x) <= L && Math.abs(y) <= W);
  }
  g.putImageData(img, 0, 0);
  // ---- soft shapes on top: board shadow along the far side, the darker grass inside the nets
  g.fillStyle = "rgba(10,40,10,.28)";
  g.fillRect(0, FAR_BOARD_FOOT - oy, w, 5);
  g.fillStyle = "rgba(10,40,10,.14)";
  g.fillRect(0, FAR_BOARD_FOOT - oy + 5, w, 3);
  for (const s of [-1, 1]) {
    const x0 = Math.round(wx(s * L)) - ox;
    const x1 = Math.round(wx(s * (L + PITCH.goalDepth))) - ox;
    const y0 = Math.round(wy(-PITCH.goalWidth / 2)) - oy;
    const y1 = Math.round(wy(PITCH.goalWidth / 2)) - oy;
    g.fillStyle = "rgba(8,30,8,.22)";
    g.fillRect(Math.min(x0, x1) + (s > 0 ? 2 : 0), y0, Math.abs(x1 - x0) - 2, y1 - y0);
  }
  return c;
}

/* ------------------------------------------------------------------ ball */
/** 10x10 ball, 12 rolling frames in a strip (rolling towards +x), shaded from the top left */
export function drawBall(): HTMLCanvasElement {
  const S = 10;
  const N = 12;
  const c = canvas(S * N, S);
  const g = c.getContext("2d")!;
  const img = g.createImageData(S * N, S);
  // icosahedron vertices = the black patches
  const p = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a, b * p], [a, b * p, 0], [b * p, 0, a]);
  const vn = v.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  const R = S / 2 - 0.3;
  for (let f = 0; f < N; f++) {
    const ang = (f / N) * Math.PI * 2 * 0.4; // 0.4 turn per cycle keeps the pattern changing smoothly
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - S / 2) / R;
        const dy = (y + 0.5 - S / 2) / R;
        const rr = dx * dx + dy * dy;
        if (rr > 1) continue;
        const dz = Math.sqrt(1 - rr);
        // roll around the vertical screen axis... a ball rolling along x spins around y
        const rx = dx * ca + dz * sa;
        const rz = -dx * sa + dz * ca;
        const ry = dy;
        let best = -2;
        for (const q of vn) best = Math.max(best, q[0] * rx + q[1] * ry + q[2] * rz);
        const patch = best > 0.935;
        const light = -dx * 0.5 - dy * 0.6 + dz * 0.6;
        let col: [number, number, number] = patch ? [40, 40, 52] : [250, 250, 246];
        if (!patch) col = light > 0.55 ? [255, 255, 255] : light > -0.1 ? [236, 236, 230] : [196, 198, 196];
        else if (light > 0.6) col = [74, 74, 88];
        const edge = rr > 0.72;
        if (edge && !patch && light < 0.2) col = [150, 156, 160];
        const o = (y * S * N + f * S + x) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = 255;
      }
  }
  // dark outline
  const d = img.data;
  const W2 = S * N;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= W2 || y >= S ? 0 : d[(y * W2 + x) * 4 + 3]);
  const out: number[] = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < W2; x++) {
      if (a(x, y)) {
        const fx = x % S;
        const l = fx === 0 ? 0 : a(x - 1, y);
        const r = fx === S - 1 ? 0 : a(x + 1, y);
        if (!l || !r || !a(x, y - 1) || !a(x, y + 1)) out.push(x, y);
      }
    }
  for (let i = 0; i < out.length; i += 2) {
    const o = (out[i + 1] * W2 + out[i]) * 4;
    d[o] = 38;
    d[o + 1] = 34;
    d[o + 2] = 44;
  }
  g.putImageData(img, 0, 0);
  return withBlurFrame(c, S, N);
}

/** a 13th frame: the ball spinning too fast to see its patches (a grey-white smear with a crisp rim) */
function withBlurFrame(src: HTMLCanvasElement, S: number, N: number): HTMLCanvasElement {
  const c = canvas(S * (N + 1), S);
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  const d = src.getContext("2d")!.getImageData(0, 0, S * N, S).data;
  const out = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      for (let f = 0; f < N; f++) {
        const o = (y * S * N + f * S + x) * 4;
        r += d[o];
        gg += d[o + 1];
        b += d[o + 2];
        a = Math.max(a, d[o + 3]);
      }
      // two flat tones only, like a hand-drawn motion frame
      const l = (r + gg + b) / (3 * N);
      const tone = l > 200 ? [244, 244, 240] : l > 120 ? [196, 200, 204] : [44, 40, 52];
      out.data.set([tone[0], tone[1], tone[2], a], (y * S + x) * 4);
    }
  g.putImageData(out, S * N, 0);
  return c;
}

/** a team flag on a pole, two frames (waving) side by side, 18x24 each */
export function drawFlag(col: number): HTMLCanvasElement {
  const c = canvas(36, 24);
  const g = c.getContext("2d")!;
  const [r, gg, b] = rgb(col);
  const lite = shade([r, gg, b], 1.35);
  const dark = shade([r, gg, b], 0.7);
  for (let f = 0; f < 2; f++) {
    const ox = f * 18;
    g.fillStyle = "#2a2430";
    g.fillRect(ox + 1, 0, 3, 24);
    g.fillStyle = "#cfc8bb";
    g.fillRect(ox + 2, 0, 1, 24);
    g.fillStyle = "#ffd23f";
    g.fillRect(ox + 1, 0, 3, 2);
    for (let x = 0; x < 13; x++) {
      const wave = Math.round(Math.sin(x * 0.6 + f * 2.4) * 1.5);
      g.fillStyle = "#14101e";
      g.fillRect(ox + 4 + x, 2 + wave, 1, 12);
      g.fillStyle = css(x % 4 < 2 ? [r, gg, b] : dark);
      g.fillRect(ox + 4 + x, 3 + wave, 1, 10);
      g.fillStyle = css(lite);
      g.fillRect(ox + 4 + x, 3 + wave, 1, 2);
      g.fillStyle = "rgba(255,255,255,.9)";
      g.fillRect(ox + 4 + x, 7 + wave, 1, 2);
    }
  }
  return c;
}

/** the kick impact: a chunky 8-point pixel star, white with a yellow rim */
export function drawBurst(): HTMLCanvasElement {
  const R = 12;
  const c = canvas(R * 2 + 1, R * 2 + 1);
  const g = c.getContext("2d")!;
  const img = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const dx = x - R;
      const dy = y - R;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const spike = R * (0.42 + 0.58 * Math.pow(Math.abs(Math.cos(a * 4)), 6));
      if (r > spike) continue;
      const col = r > spike - 1.6 ? [255, 210, 63] : [255, 255, 245];
      img.data.set([col[0], col[1], col[2], 255], (y * c.width + x) * 4);
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** a soft-edged pixel ellipse (stepped alpha), for shadows */
export function drawShadow(w: number, h: number, alpha = 0.42): HTMLCanvasElement {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      const r = dx * dx + dy * dy;
      if (r > 1) continue;
      const o = (y * w + x) * 4;
      img.data[o + 3] = Math.round(255 * alpha * (r < 0.55 ? 1 : 0.6));
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** the control ring under a duck: a pixel ellipse outline, 2 px thick, with a darker under-edge */
export function drawRing(w: number, h: number, col: number, glow = false): HTMLCanvasElement {
  const pad = glow ? 3 : 1;
  const c = canvas(w + pad * 2, h + pad * 2);
  const g = c.getContext("2d")!;
  const img = g.createImageData(c.width, c.height);
  const [r, gg, b] = rgb(col);
  const lite = shade([r, gg, b], 1.35);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const dx = (x + 0.5 - c.width / 2) / (w / 2);
      const dy = (y + 0.5 - c.height / 2) / (h / 2);
      const e = Math.sqrt(dx * dx + dy * dy);
      const px = 2.2 / (w / 2);
      const o = (y * c.width + x) * 4;
      if (Math.abs(e - 1) < px * 0.62) {
        const front = dy > 0;
        const cc = front ? lite : [r, gg, b];
        img.data.set([cc[0], cc[1], cc[2], 255], o);
      } else if (glow && Math.abs(e - 1) < px * 1.6) {
        img.data.set([255, 255, 255, 90], o);
      }
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** the marker over the controlled duck: a chunky pixel arrow pointing down */
/** a little grey rain cloud for a sad duck (two frames side by side: the rain drops move) */
export function drawCloud(): HTMLCanvasElement {
  const rows = [
    "0000111110000000",
    "0001222221100000",
    "0112222222211100",
    "1222232222222210",
    "1222222222322221",
    "1222222222222221",
    "0111111111111110",
  ];
  const W = 16;
  const c = canvas(W * 2, 14);
  const g = c.getContext("2d")!;
  for (const f of [0, 1]) {
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "0") return;
        g.fillStyle = ch === "1" ? "#2b2a3a" : ch === "3" ? "#c9cbd8" : "#8e90a4";
        g.fillRect(f * W + x, y, 1, 1);
      }),
    );
    g.fillStyle = "#6fb8ff";
    for (const [x, y] of [[3, 8], [7, 9], [11, 8]]) g.fillRect(f * W + x, y + f * 2, 1, 2);
  }
  return c;
}

export function drawMarker(col: number): HTMLCanvasElement {
  const rows = ["0111111110", "1222222221", "0122222210", "0012222100", "0001221000", "0000110000"];
  const c = canvas(10, rows.length);
  const g = c.getContext("2d")!;
  const [r, gg, b] = rgb(col);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === "0") return;
      g.fillStyle = ch === "1" ? "#1a1430" : `rgb(${r},${gg},${b})`;
      g.fillRect(x, y, 1, 1);
    }),
  );
  g.fillStyle = "rgba(255,255,255,.75)";
  g.fillRect(2, 1, 3, 1);
  return c;
}

/* ------------------------------------------------------------------ hard-edged text */
/** Rasterise text with no anti-aliasing: draw it, then snap every pixel to fill or nothing. */
export function pixelText(text: string, px: number, fill: string, outline?: string, weight = 800): HTMLCanvasElement {
  const m = canvas(4, 4).getContext("2d")!;
  m.font = `${weight} ${px}px ${FONT}`;
  const tw = Math.ceil(m.measureText(text).width) + 4;
  const th = Math.ceil(px * 1.5);
  const c = canvas(tw + 2, th + 2);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.font = m.font;
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, 2, th / 2 + 1 + px * 0.08);
  const img = g.getImageData(0, 0, c.width, c.height);
  const a = new Uint8Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3] > 110 ? 1 : 0;
  const f = rgb(parseInt(fill.slice(1), 16));
  const o2 = outline ? rgb(parseInt(outline.slice(1), 16)) : null;
  const out = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = y * c.width + x;
      if (a[i]) out.data.set([f[0], f[1], f[2], 255], i * 4);
      else if (o2) {
        // outline: any filled neighbour (4-way) plus the drop below-right
        const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < c.width && yy < c.height && a[yy * c.width + xx];
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1) || n(x - 1, y - 1)) out.data.set([o2[0], o2[1], o2[2], 255], i * 4);
      }
    }
  g.clearRect(0, 0, c.width, c.height);
  g.putImageData(out, 0, 0);
  return trimCanvas(c);
}

function trimCanvas(c: HTMLCanvasElement) {
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let x1 = -1;
  let y0 = c.height;
  let y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return c;
  const o = canvas(x1 - x0 + 1, y1 - y0 + 1);
  o.getContext("2d")!.drawImage(c, -x0, -y0);
  return o;
}

/* ------------------------------------------------------------------ ad boards */
const LOGOS = ["dna", "petri", "micro", "flask", "duck", "leaf", "microbe", "ball"] as const;
type Logo = (typeof LOGOS)[number];
interface Ad {
  bg: number;
  bg2: number;
  fg: string;
  ink: string;
  logo?: Logo;
  text: string;
  size?: number;
}
const ADS: Ad[] = [
  { bg: 0xe8452c, bg2: 0xc8321e, fg: "#ffffff", ink: "#5a1208", logo: "dna", text: "DNA" },
  { bg: 0x1d2a6b, bg2: 0x141d4f, fg: "#ffd23f", ink: "#05081e", logo: "duck", text: "BSC" },
  { bg: 0xffd23f, bg2: 0xf2b81c, fg: "#1d1a3a", ink: "#fff6c8", logo: "micro", text: "نادي العلوم البيولوجية", size: 17 },
  { bg: 0x14a3a0, bg2: 0x0d8784, fg: "#ffffff", ink: "#063b3a", logo: "petri", text: "Petri" },
  { bg: 0xe3256b, bg2: 0xbf1653, fg: "#ffffff", ink: "#4d0721", logo: "microbe", text: "ميكروب FC" },
  { bg: 0x23232e, bg2: 0x18181f, fg: "#7cfc6a", ink: "#000000", logo: "flask", text: "مختبر البط" },
  { bg: 0x3b8f2a, bg2: 0x2d7520, fg: "#ffffff", ink: "#123d0c", logo: "leaf", text: "Cell+" },
  { bg: 0xf08a24, bg2: 0xd56f12, fg: "#ffffff", ink: "#5a2a04", logo: "ball", text: "كرة البط" },
  { bg: 0x6a2bd8, bg2: 0x5320b0, fg: "#ffffff", ink: "#22094f", logo: "dna", text: "بيولوجي" },
  { bg: 0xf3f3f0, bg2: 0xd9dcd8, fg: "#1d2a6b", ink: "#ffffff", logo: "petri", text: "BSC Lab" },
];

function boardPanel(ad: Ad, logos: HTMLImageElement | null, goal = false): HTMLCanvasElement {
  const label = goal ? pixelText(ad.text, 24, ad.fg, ad.ink, 800) : pixelText(ad.text, ad.size ?? 21, ad.fg, ad.ink, 800);
  const logoW = ad.logo && logos ? 32 : 0;
  const w = Math.max(150, label.width + logoW + 34);
  const h = BOARD_H;
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const bg = rgb(ad.bg);
  const bg2 = rgb(ad.bg2);
  g.fillStyle = css(bg);
  g.fillRect(0, 0, w, h);
  g.fillStyle = css(bg2);
  g.fillRect(0, Math.round(h * 0.62), w, h);
  // LED scan lines
  g.fillStyle = "rgba(0,0,0,.07)";
  for (let y = 1; y < h; y += 2) g.fillRect(0, y, w, 1);
  g.fillStyle = css(shade(bg, 1.25));
  g.fillRect(0, 0, w, 2);
  g.fillStyle = css(shade(bg2, 0.6));
  g.fillRect(0, h - 3, w, 3);
  g.fillStyle = "#14121c";
  g.fillRect(0, 0, 2, h);
  g.fillRect(w - 1, 0, 1, h);
  const cx = Math.round((w - (label.width + (logoW ? logoW + 6 : 0))) / 2);
  if (logoW && logos) {
    const i = LOGOS.indexOf(ad.logo!);
    g.drawImage(logos, i * 32, 0, 32, 32, cx, 2, 32, 32);
  }
  g.drawImage(label, cx + (logoW ? logoW + 6 : 0), Math.round((h - label.height) / 2));
  return c;
}

/** One long board strip (the length of the far or near side), the ads shuffled so the two sides differ. */
/** the ad boards and the near stand are the same every match: drawn once per page */
const boardCache = new Map<string, HTMLCanvasElement>();
export function drawBoards(len: number, seed: number, logos: HTMLImageElement | null, goal = false): HTMLCanvasElement {
  const key = `b${len},${seed},${goal},${logos ? 1 : 0}`;
  let c = boardCache.get(key);
  if (!c) boardCache.set(key, (c = buildBoards(len, seed, logos, goal)));
  return c;
}
function buildBoards(len: number, seed: number, logos: HTMLImageElement | null, goal: boolean): HTMLCanvasElement {
  const c = canvas(len, BOARD_H + 4);
  const g = c.getContext("2d")!;
  const goalAds: Ad[] = [
    { bg: 0xffd23f, bg2: 0xf2b81c, fg: "#e8452c", ink: "#5a1208", text: "قووول!" },
    { bg: 0xe8452c, bg2: 0xc8321e, fg: "#ffffff", ink: "#5a1208", text: "GOAL!" },
    { bg: 0x1d2a6b, bg2: 0x141d4f, fg: "#ffd23f", ink: "#05081e", text: "قووول!" },
  ];
  const list = goal ? goalAds : ADS;
  const panels = list.map((a) => boardPanel(a, logos, goal));
  let x = 0;
  let i = seed % panels.length;
  while (x < len) {
    const p = panels[i % panels.length];
    g.drawImage(p, x, 4);
    x += p.width;
    i += goal ? 1 : 3;
  }
  // the top cap of the boards (seen from above)
  g.fillStyle = "#2a2838";
  g.fillRect(0, 0, len, 4);
  g.fillStyle = "#5a5870";
  g.fillRect(0, 0, len, 1);
  return c;
}

/** the end boards: seen edge-on, a narrow padded wall */
export function drawEndBoard(): HTMLCanvasElement {
  const top = FAR_BOARD_FOOT - BOARD_H;
  const bottom = NEAR_BOARD_TOP + BOARD_H;
  const h = bottom - top;
  const c = canvas(10, h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#1d2a6b";
  g.fillRect(0, 0, 10, h);
  g.fillStyle = "#2c3d8f";
  g.fillRect(1, 0, 4, h);
  g.fillStyle = "#4a5cb0";
  g.fillRect(1, 0, 1, h);
  g.fillStyle = "#0d1236";
  g.fillRect(9, 0, 1, h);
  for (let y = 6; y < h; y += 24) {
    g.fillStyle = "#ffd23f";
    g.fillRect(2, y, 3, 8);
  }
  return c;
}

/** the near stand behind the bottom boards: concrete steps and seat backs (the fans are sprites on top) */
export function drawNearStand(width: number, height: number): HTMLCanvasElement {
  const key = `n${width},${height}`;
  let c = boardCache.get(key);
  if (!c) boardCache.set(key, (c = buildNearStand(width, height)));
  return c;
}
function buildNearStand(width: number, height: number): HTMLCanvasElement {
  const c = canvas(width, height);
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c2240";
  g.fillRect(0, 0, width, height);
  const step = 30;
  for (let r = 0; r * step < height; r++) {
    const y = r * step;
    g.fillStyle = "#3a4262";
    g.fillRect(0, y, width, 6);
    g.fillStyle = "#59617f";
    g.fillRect(0, y, width, 1);
    g.fillStyle = "#262c4a";
    g.fillRect(0, y + 6, width, step - 6);
    for (let x = (r % 2) * 9; x < width; x += 18) {
      const blue = hash(x, r) < 0.75;
      g.fillStyle = blue ? "#2850b8" : "#d9dbe6";
      g.fillRect(x + 2, y + 8, 13, 12);
      g.fillStyle = blue ? "#3c6ad6" : "#f2f3f8";
      g.fillRect(x + 3, y + 9, 11, 2);
      g.fillStyle = blue ? "#183277" : "#a6a9b8";
      g.fillRect(x + 2, y + 19, 13, 2);
    }
  }
  // a railing along the top (nearest the pitch)
  g.fillStyle = "#8b93ab";
  g.fillRect(0, 0, width, 2);
  return c;
}

export const STAND_SRC = "assets/football/stadium/stand.png";
export const FANS_SRC = "assets/football/stadium/fans.png";
export const LOGOS_SRC = "assets/football/stadium/logos.png";
export const FAN_W = 43;
export const FAN_H = 39;
export const FAN_KINDS = 12;

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
