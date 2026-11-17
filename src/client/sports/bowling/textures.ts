import * as THREE from "three";
import { HEAD_Z, LANE_HALF, RACK } from "../../../shared/sports/bowling";
import { LANE_LEN, zv } from "./space";

/** Canvas-painted textures for the alley (no image files needed, so the chunk stays small). */

/** A small deterministic random, so every lane looks the same on every screen. */
function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
};

function tex(c: HTMLCanvasElement, aniso = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Wood boards across a width (39 boards on a real lane). `y0..y1` canvas rows, `tone(y)` = maple/pine mix. */
function boards(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, maple: (y: number) => number) {
  const r = rnd(seed);
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const shade = (r() - 0.5) * 0.09;
    for (let y = 0; y < h; y += 8) {
      const m = maple(y);
      // maple: pale honey, pine: warmer amber
      const R = (232 * m + 214 * (1 - m)) * (1 + shade);
      const G = (194 * m + 150 * (1 - m)) * (1 + shade);
      const B = (140 * m + 88 * (1 - m)) * (1 + shade);
      g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
      g.fillRect(i * bw, y, bw + 0.5, 8);
    }
    // grain: long thin streaks
    for (let k = 0; k < 18; k++) {
      const x = i * bw + r() * bw;
      const y = r() * h;
      const len = 40 + r() * 260;
      g.strokeStyle = `rgba(${r() < 0.5 ? "120,70,30" : "255,240,210"},${0.05 + r() * 0.08})`;
      g.lineWidth = 0.6 + r() * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + (r() - 0.5) * 2, y + len * 0.3, x + (r() - 0.5) * 2, y + len * 0.6, x + (r() - 0.5) * 1.5, y + len);
      g.stroke();
    }
    // board seams
    g.fillStyle = "rgba(90,50,20,.28)";
    g.fillRect(i * bw, 0, 1, h);
  }
}

/** The lane: foul line at the top of the canvas (v = 1 at z = 0), pit at the bottom. */
export function laneTexture(aniso: number) {
  const W = 256;
  const H = 2048;
  const [c, g] = canvas(W, H);
  const pxPerM = H / LANE_LEN;
  const yOf = (zPhys: number) => zv(zPhys) * pxPerM;
  const xOf = (x: number) => ((x + LANE_HALF) / (2 * LANE_HALF)) * W;
  const deckY = yOf(HEAD_Z - 0.6);
  boards(g, W, H, 39, 7, (y) => (y < yOf(4.6) ? 1 : y > deckY ? 1 : y < yOf(5.4) ? 1 - (y - yOf(4.6)) / (yOf(5.4) - yOf(4.6)) : 0));
  // maple/pine joint and the deck joint: a thin darker line
  g.fillStyle = "rgba(80,40,10,.35)";
  g.fillRect(0, deckY, W, 2);
  // lighting baked in: brighter on the pin deck, a soft lengthwise gloss streak in the middle (oil)
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, "rgba(255,255,255,0.06)");
  lg.addColorStop(0.5, "rgba(0,0,0,0.06)");
  lg.addColorStop(0.86, "rgba(0,0,0,0.02)");
  lg.addColorStop(0.93, "rgba(255,244,220,0.16)");
  lg.addColorStop(1, "rgba(255,244,220,0.1)");
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  const side = g.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, "rgba(40,15,0,.2)");
  side.addColorStop(0.12, "rgba(0,0,0,0)");
  side.addColorStop(0.88, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(40,15,0,.2)");
  g.fillStyle = side;
  g.fillRect(0, 0, W, H);

  // foul line
  g.fillStyle = "#1d0f2b";
  g.fillRect(0, 0, W, 5);
  // guide dots at 7 ft (2.13 m): boards 3,5,8,11,14 from each side
  const boardX = (b: number) => xOf(-LANE_HALF + (b - 0.5) * ((2 * LANE_HALF) / 39));
  const dot = (x: number, y: number, r: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2);
    g.fill();
  };
  for (const b of [3, 5, 8, 11, 14]) {
    dot(boardX(b), yOf(2.13), 2.6, "#2b1b45");
    dot(boardX(40 - b), yOf(2.13), 2.6, "#2b1b45");
  }
  // targeting arrows (15 ft), every 5th board, in a V
  for (const b of [5, 10, 15, 20, 25, 30, 35]) {
    const off = Math.abs(b - 20) / 5;
    const y = yOf(4.57 + (3 - off) * 0.3);
    const x = boardX(b);
    const aw = 5.5;
    const ah = 34;
    g.fillStyle = "#3a1d5c";
    g.beginPath();
    g.moveTo(x, y + ah);
    g.lineTo(x - aw, y);
    g.lineTo(x + aw, y);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,210,63,.9)";
    g.beginPath();
    g.moveTo(x, y + ah - 9);
    g.lineTo(x - aw + 2.2, y + 3);
    g.lineTo(x + aw - 2.2, y + 3);
    g.closePath();
    g.fill();
  }
  // range finders (34–40 ft)
  for (const b of [10, 30]) {
    g.fillStyle = "rgba(43,27,69,.55)";
    g.fillRect(boardX(b) - 1.2, yOf(10.4), 2.4, yOf(12.2) - yOf(10.4));
  }
  // pin spots
  for (const [x, z] of RACK) {
    g.fillStyle = "rgba(43,27,69,.55)";
    g.beginPath();
    g.ellipse(xOf(x), yOf(z), 3.8, 3.8 * 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, aniso);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** The approach behind the foul line: lighter boards + approach dots. Canvas top = foul line. */
export function approachTexture(aniso: number, lenM: number) {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  boards(g, W, H, 39, 11, () => 1);
  g.fillStyle = "rgba(255,255,255,.06)";
  g.fillRect(0, 0, W, H);
  const yOf = (m: number) => (m / lenM) * H;
  const xOf = (b: number) => ((b - 0.5) / 39) * W;
  for (const d of [0.6, 3.7]) {
    for (const b of [3, 5, 8, 11, 14, 20, 26, 29, 32, 35, 37]) {
      g.fillStyle = "#2b1b45";
      g.beginPath();
      g.arc(xOf(b), yOf(d), 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = "#1d0f2b";
  g.fillRect(0, 0, W, 6);
  g.fillStyle = "rgba(255,80,120,.95)";
  g.fillRect(0, 6, W, 2);
  return tex(c, aniso);
}

/** Soft round contact shadow. */
export function blobTexture() {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(20,8,30,0.85)");
  r.addColorStop(0.35, "rgba(20,8,30,0.55)");
  r.addColorStop(1, "rgba(20,8,30,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Soft additive glow (aim ring, impact flash). */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A ring texture (pulsing circle under the ball while it waits to be thrown). */
export function ringTexture() {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 7;
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const css = (c: number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Marbled urethane ball in a duck colour, with three finger holes. */
export function ballTexture(color: string, seed: number) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const base = hexToRgb(color);
  const dark = mix(base.map((v) => v * 0.5), [40, 0, 60], 0.2);
  const light = mix(base, [255, 255, 255], 0.65);
  const deep = mix(base.map((v) => v * 0.22), [30, 0, 50], 0.3);
  g.fillStyle = css(base);
  g.fillRect(0, 0, W, H);
  const r = rnd(seed);
  // swirls: many soft bezier ribbons that wrap around (u repeats)
  const ribbon = (col: number[], alpha: number, width: number) => {
    const y0 = r() * H;
    const amp = 20 + r() * 60;
    const f = 1 + Math.floor(r() * 3);
    const ph = r() * Math.PI * 2;
    g.strokeStyle = css(col, alpha);
    g.lineWidth = width;
    g.lineCap = "round";
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 8) {
      const y = y0 + Math.sin((x / W) * Math.PI * 2 * f + ph) * amp + Math.sin((x / W) * Math.PI * 2 * (f + 2) + ph * 1.7) * amp * 0.35;
      if (x < 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  g.filter = "blur(6px)";
  for (let i = 0; i < 9; i++) ribbon(dark, 0.6, 18 + r() * 30);
  g.filter = "blur(2px)";
  for (let i = 0; i < 10; i++) ribbon(light, 0.35, 3 + r() * 8);
  for (let i = 0; i < 7; i++) ribbon(deep, 0.5, 4 + r() * 10);
  g.filter = "none";
  for (let i = 0; i < 6; i++) ribbon(light, 0.5, 1 + r() * 1.5);
  // sparkle flecks (pearl)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.22})`;
    g.fillRect(r() * W, r() * H, 1.4, 1.4);
  }
  // finger holes near the "top" of the ball (stretched horizontally because of the sphere mapping)
  const hole = (x: number, y: number, rx: number) => {
    const ry = rx * 1.15;
    const rg = g.createRadialGradient(x, y, 0, x, y, rx);
    rg.addColorStop(0, "#050208");
    rg.addColorStop(0.75, "#0d0614");
    rg.addColorStop(1, css(mix(base, [0, 0, 0], 0.4)));
    g.fillStyle = rg;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.35)";
    g.lineWidth = 1.2;
    g.stroke();
  };
  hole(W * 0.25 - 11, H * 0.4, 7);
  hole(W * 0.25 + 11, H * 0.4, 7);
  hole(W * 0.25, H * 0.53, 8.5);
  return tex(c, 4);
}

/** Load an image (duck token) once. */
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(src: string) {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

const FONT = '"Baloo Bhaijaan 2", system-ui, sans-serif';

/** The masking unit above a lane's pins: a neon panel with the lane number, the player's duck and name. */
export function maskingTexture(opts: { num: string; name: string; color: string; duck: number | null }) {
  const W = 1024;
  const H = 300;
  const [c, g] = canvas(W, H);
  const t = tex(c, 4);
  const col = opts.color;
  const draw = (img: HTMLImageElement | null) => {
    g.clearRect(0, 0, W, H);
    // background: deep night purple with a soft vignette
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#2a1452");
    bg.addColorStop(1, "#140828");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // starry dots
    const r = rnd(opts.num.charCodeAt(0) * 31 + 5);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.4})`;
      const s = r() * 2.2 + 0.6;
      g.beginPath();
      g.arc(r() * W, r() * H, s, 0, Math.PI * 2);
      g.fill();
    }
    // diagonal light rays from behind the duck
    g.save();
    g.translate(W / 2, H * 0.62);
    for (let i = 0; i < 14; i++) {
      g.rotate((Math.PI * 2) / 14);
      g.fillStyle = "rgba(255,255,255,0.045)";
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-40, -700);
      g.lineTo(40, -700);
      g.closePath();
      g.fill();
    }
    g.restore();
    // neon frame
    const neon = (draw: () => void, colr: string, width: number) => {
      g.save();
      g.strokeStyle = colr;
      g.shadowColor = colr;
      for (const [b, w] of [[38, width * 2.4], [16, width * 1.4], [4, width]] as const) {
        g.shadowBlur = b;
        g.lineWidth = w;
        g.globalAlpha = w === width ? 1 : 0.45;
        draw();
        g.stroke();
      }
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.lineWidth = Math.max(1.5, width * 0.4);
      g.strokeStyle = "rgba(255,255,255,.9)";
      draw();
      g.stroke();
      g.restore();
    };
    const rr = (x: number, y: number, w: number, h: number, rad: number) => () => {
      g.beginPath();
      g.roundRect(x, y, w, h, rad);
    };
    neon(rr(16, 16, W - 32, H - 32, 34), col, 7);
    // pins in neon on both sides
    const pinPath = (x: number, y: number, s: number) => () => {
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x - 26 * s, y - 2 * s, x - 30 * s, y - 60 * s, x - 13 * s, y - 92 * s);
      g.bezierCurveTo(x - 6 * s, y - 104 * s, x - 13 * s, y - 116 * s, x - 9 * s, y - 128 * s);
      g.bezierCurveTo(x - 6 * s, y - 140 * s, x + 6 * s, y - 140 * s, x + 9 * s, y - 128 * s);
      g.bezierCurveTo(x + 13 * s, y - 116 * s, x + 6 * s, y - 104 * s, x + 13 * s, y - 92 * s);
      g.bezierCurveTo(x + 30 * s, y - 60 * s, x + 26 * s, y - 2 * s, x, y);
    };
    neon(pinPath(120, 238, 1.15), "#ff4fa3", 5);
    neon(pinPath(176, 238, 0.9), "#ff4fa3", 4);
    neon(pinPath(W - 120, 238, 1.15), "#3ee8ff", 5);
    neon(pinPath(W - 176, 238, 0.9), "#3ee8ff", 4);
    // duck token in the middle
    if (img) {
      const s = 190;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 40;
      g.drawImage(img, W / 2 - s / 2 - 150, H / 2 - s / 2 + 6, s, s * (img.height / img.width || 1));
      g.restore();
    }
    // name in neon letters
    g.save();
    g.font = `800 ${opts.name.length > 7 ? 74 : 92}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.direction = "rtl";
    const tx = img ? W / 2 + 70 : W / 2;
    const ty = H / 2 + 10;
    for (const [b, a] of [[44, 0.9], [20, 0.9], [6, 1]] as const) {
      g.shadowColor = col;
      g.shadowBlur = b;
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fillText(opts.name, tx, ty);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,.92)";
    g.fillText(opts.name, tx, ty);
    g.restore();
    // lane number badge
    g.save();
    g.font = `800 54px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffd23f";
    g.shadowColor = "#ffd23f";
    g.shadowBlur = 18;
    g.fillText(opts.num, W - 64, 64);
    g.fillText(opts.num, 64, 64);
    g.restore();
    t.needsUpdate = true;
  };
  draw(null);
  const fontReady = document.fonts?.load ? document.fonts.load(`800 60px ${FONT}`).catch(() => null) : Promise.resolve(null);
  const imgP = opts.duck == null ? Promise.resolve(null) : loadImage(`assets/tokens/token${opts.duck}.png`);
  void Promise.all([imgP, fontReady]).then(([img]) => draw(img));
  return t;
}

/** Big neon title sign over the alley. */
export function signTexture(text: string) {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const t = tex(c, 4);
  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.font = `800 150px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.direction = "rtl";
    const y = H / 2 + 14;
    for (const [b, a] of [[60, 0.8], [26, 0.9], [8, 1]] as const) {
      g.shadowColor = "#ff4fa3";
      g.shadowBlur = b;
      g.globalAlpha = a;
      g.fillStyle = "#ff4fa3";
      g.fillText(text, W / 2, y);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,.95)";
    g.fillStyle = "rgba(255,225,240,.95)";
    g.fillText(text, W / 2, y);
    t.needsUpdate = true;
  };
  draw();
  if (document.fonts?.load) void document.fonts.load(`800 60px ${FONT}`).then(draw).catch(() => {});
  return t;
}

/** Back wall panels with vertical neon tubes and a subtle pattern. */
export function wallTexture() {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a0b33");
  bg.addColorStop(1, "#0d0519");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // little bubbles / cells (biology club!)
  const r = rnd(99);
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = r() * H;
    const s = 4 + r() * 16;
    g.strokeStyle = `rgba(${r() < 0.5 ? "62,232,255" : "255,79,163"},${0.12 + r() * 0.16})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.stroke();
  }
  const t = tex(c, 2);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Dark curtain behind the pit. */
export function curtainTexture() {
  const W = 256;
  const H = 128;
  const [c, g] = canvas(W, H);
  for (let x = 0; x < W; x++) {
    const v = 14 + Math.sin(x * 0.35) * 6 + Math.sin(x * 0.11) * 4;
    g.fillStyle = `rgb(${v + 6},${v},${v + 16})`;
    g.fillRect(x, 0, 1, H);
  }
  const t = tex(c, 1);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** The ceiling/sky gradient used for the scene background. */
export function backgroundTexture() {
  const [c, g] = canvas(4, 256);
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, "#07020f");
  lg.addColorStop(0.55, "#1b0b33");
  lg.addColorStop(1, "#2a1145");
  g.fillStyle = lg;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Kickback walls beside the pin deck: glossy dark panels with neon chevrons and little bubbles. */
export function kickbackTexture() {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#4a2a7a");
  bg.addColorStop(0.5, "#2a1550");
  bg.addColorStop(1, "#150a2c");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const r = rnd(5);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${r() < 0.5 ? "62,232,255" : "255,79,163"},${0.12 + r() * 0.18})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(r() * W, H * 0.25 + r() * H * 0.7, 6 + r() * 22, 0, Math.PI * 2);
    g.stroke();
  }
  // neon chevrons pointing at the pins
  for (let i = 0; i < 6; i++) {
    const x = 90 + i * 150;
    for (const [b, a] of [[18, 0.5], [4, 1]] as const) {
      g.save();
      g.shadowColor = "#ffd23f";
      g.shadowBlur = b;
      g.globalAlpha = a * (0.35 + i * 0.12);
      g.strokeStyle = "#ffd23f";
      g.lineWidth = 9;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(x, H * 0.36);
      g.lineTo(x + 40, H * 0.56);
      g.lineTo(x, H * 0.76);
      g.stroke();
      g.restore();
    }
  }
  // glossy top edge
  const gl = g.createLinearGradient(0, 0, 0, 40);
  gl.addColorStop(0, "rgba(255,255,255,.35)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gl;
  g.fillRect(0, 0, W, 40);
  return tex(c, 4);
}
