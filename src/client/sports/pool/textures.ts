import * as THREE from "three";

/** Canvas-painted textures for the pool table (no image files, so the chunk stays small). */

export function rnd(seed: number) {
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

function tex(c: HTMLCanvasElement, aniso = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Value noise, tileable, for felt and leather. */
function noiseField(w: number, h: number, cell: number, r: () => number) {
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const g = Array.from({ length: gw * gh }, () => r());
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => g[(((j % gh) + gh) % gh) * gw + (((i % gw) + gw) % gw)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

export const FELT = "#16704a";

/** Cloth: fine fibres, a soft nap along the table, gentle mottling. Tileable (repeat it over the bed). */
export function feltTexture(aniso: number) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rnd(7);
  const n1 = noiseField(S, S, 64, r);
  const n2 = noiseField(S, S, 16, r);
  const img = g.createImageData(S, S);
  const base = [22, 112, 74];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const m = (n1(x, y) - 0.5) * 0.07 + (n2(x, y) - 0.5) * 0.05 + (r() - 0.5) * 0.11;
      const i = (y * S + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, base[0] * (1 + m)));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] * (1 + m)));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] * (1 + m)));
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // nap: very faint streaks along x
  for (let k = 0; k < 900; k++) {
    const y = r() * S;
    const x = r() * S;
    g.strokeStyle = r() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,20,10,0.05)";
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 10 + r() * 30, y + (r() - 0.5) * 1.5);
    g.stroke();
  }
  const t = tex(c, aniso);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A matching bump map for the cloth fuzz (linear). */
export function feltBump(aniso: number) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rnd(11);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 110 + r() * 40;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, aniso, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Printed marks on the bed: head / foot spots and a light-falloff overlay, in bed UV (0..1 over the cloth). */
export function bedOverlay(lenM: number, widM: number, headX: number, footX: number) {
  const W = 1024;
  const H = Math.round((W * widM) / lenM);
  const [c, g] = canvas(W, H);
  // warm pool of light in the middle, darker towards the cushions
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.62);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.55, "rgba(236,236,236,1)");
  rg.addColorStop(1, "rgba(150,150,150,1)");
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  const px = (x: number) => ((x + lenM / 2) / lenM) * W;
  const dot = (x: number) => {
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.arc(px(x), H / 2, 3.2, 0, Math.PI * 2);
    g.fill();
  };
  dot(headX);
  dot(footX);
  dot(0);
  return tex(c, 4);
}

/** Mahogany with a deep grain, for the rails and the apron (grain along u). */
export function woodTexture(aniso: number, seed = 3, dark = false) {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rnd(seed);
  const n = noiseField(W, H, 40, r);
  const img = g.createImageData(W, H);
  const a = dark ? [40, 18, 11] : [74, 30, 16];
  const b = dark ? [64, 30, 17] : [124, 58, 30];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // grain: stretched rings with a wobble
      const w = n(x * 0.15, y * 2.2) * 6 + y * 0.09;
      const ring = 0.5 + 0.5 * Math.sin(w * 3.1 + Math.sin(x * 0.004) * 2);
      const fine = (r() - 0.5) * 0.06;
      const t = Math.pow(ring, 2.2) * 0.75 + n(x * 0.5, y * 0.5) * 0.25 + fine;
      const i = (y * W + x) * 4;
      img.data[i] = a[0] + (b[0] - a[0]) * t;
      img.data[i + 1] = a[1] + (b[1] - a[1]) * t;
      img.data[i + 2] = a[2] + (b[2] - a[2]) * t;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // pores
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(20,6,2,${0.12 + r() * 0.2})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 6, 0.8);
  }
  const t = tex(c, aniso);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Dark brown leather for the pocket cups. */
export function leatherTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rnd(5);
  const n = noiseField(S, S, 32, r);
  const f = noiseField(S, S, 5, r);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = n(x, y) * 0.6 + f(x, y) * 0.4;
      const i = (y * S + x) * 4;
      img.data[i] = 46 + v * 16;
      img.data[i + 1] = 27 + v * 9;
      img.data[i + 2] = 18 + v * 5;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = tex(c, 2);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Floor: dark wooden planks with a warm pool of light. */
export function floorTexture(aniso: number) {
  const W = 1024;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const r = rnd(21);
  const rows = 14;
  const ph = H / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 300;
    while (x < W) {
      const len = 280 + r() * 360;
      const s = 0.8 + r() * 0.35;
      g.fillStyle = `rgb(${(58 * s) | 0},${(34 * s) | 0},${(22 * s) | 0})`;
      g.fillRect(x, i * ph, len, ph);
      for (let k = 0; k < 10; k++) {
        g.strokeStyle = `rgba(${r() < 0.5 ? "20,8,4" : "120,80,50"},${0.08 + r() * 0.1})`;
        g.lineWidth = 0.8 + r();
        const yy = i * ph + r() * ph;
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 4, x + len * 0.6, yy + (r() - 0.5) * 4, x + len, yy + (r() - 0.5) * 3);
        g.stroke();
      }
      g.fillStyle = "rgba(10,4,2,.7)";
      g.fillRect(x, i * ph, 2, ph);
      x += len;
    }
    g.fillStyle = "rgba(10,4,2,.7)";
    g.fillRect(0, i * ph, W, 2);
  }
  const t = tex(c, aniso);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Soft round contact shadow (dark centre). */
export function blobTexture() {
  const [c, g] = canvas(128, 128);
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(0,8,4,0.9)");
  rg.addColorStop(0.3, "rgba(0,8,4,0.6)");
  rg.addColorStop(0.65, "rgba(0,8,4,0.18)");
  rg.addColorStop(1, "rgba(0,8,4,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Wide soft shadow under the table on the floor. */
export function tableShadowTexture() {
  const [c, g] = canvas(256, 256);
  const rg = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  rg.addColorStop(0, "rgba(0,0,0,0.85)");
  rg.addColorStop(0.6, "rgba(0,0,0,0.5)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Soft white glow (aim dots, ring). */
export function glowTexture() {
  const [c, g] = canvas(64, 64);
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.45, "rgba(255,255,255,.9)");
  rg.addColorStop(0.7, "rgba(255,255,255,.25)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function ringTexture() {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 6;
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

/** Pool ball colours (1..8; 9..15 are the stripes of 1..7). */
export const BALL_COLORS = ["#f7f3e8", "#f3b70f", "#1d47b8", "#d3241c", "#4f2386", "#f06a10", "#0f7a3c", "#7c1418", "#121212"];
export const ballColor = (n: number) => BALL_COLORS[n === 0 ? 0 : n > 8 ? n - 8 : n];

/** A pool ball skin (equirectangular): solids, stripes with a white body, the number in a white circle on two
 *  sides. Western numerals, like real balls. */
export function ballTexture(n: number) {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const ivory = "#f6f1e4";
  const col = ballColor(n);
  const stripe = n > 8;
  g.fillStyle = n === 0 ? ivory : stripe ? ivory : col;
  g.fillRect(0, 0, W, H);
  if (stripe) {
    // a band of ±38° around the equator
    const half = (38 / 180) * H;
    g.fillStyle = col;
    g.fillRect(0, H / 2 - half, W, half * 2);
  }
  if (n > 0) {
    for (const u of [0.25, 0.75]) {
      const x = u * W;
      const y = H / 2;
      const rad = H * 0.115;
      g.fillStyle = ivory;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#16120e";
      g.font = `700 ${Math.round(rad * (n > 9 ? 1.08 : 1.25))}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(n), x, y + rad * 0.06);
      if (n === 6 || n === 9) g.fillRect(x - rad * 0.32, y + rad * 0.62, rad * 0.64, rad * 0.09);
    }
  }
  // a whisper of wear
  const r = rnd(100 + n);
  for (let k = 0; k < 160; k++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1);
  }
  return tex(c, 4);
}

/** Simple environment for reflections: a warm room; `bulbs` adds the bright lamp right above (only the balls get
 *  that one: flat surfaces seen from above would reflect the bulbs everywhere, environment maps being "far away"). */
export function envScene(bulbs: boolean) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0d0806);
  const add = (geo: THREE.BufferGeometry, color: number, k: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    s.add(m);
    return m;
  };
  // three lamp bulbs above the table
  if (bulbs) for (const x of [-0.72, 0, 0.72]) add(new THREE.CircleGeometry(0.09, 24).rotateX(Math.PI / 2), 0xfff2d6, 16, x, 1.3, 0);
  // the lamp's long shade (darker strip)
  add(new THREE.BoxGeometry(2.2, 0.05, 0.4), 0x1f4a2c, 1, 0, 1.55, 0);
  // warm walls and a dim window
  add(new THREE.PlaneGeometry(14, 4), 0x3a2216, 1, 0, 1.5, -5);
  add(new THREE.PlaneGeometry(14, 4), 0x2a1810, 1, 0, 1.5, 5);
  add(new THREE.PlaneGeometry(10, 4).rotateY(Math.PI / 2), 0x30201a, 1, -6, 1.5, 0);
  add(new THREE.PlaneGeometry(10, 4).rotateY(Math.PI / 2), 0x30201a, 1, 6, 1.5, 0);
  add(new THREE.PlaneGeometry(1.6, 1.0), 0x7fa6d8, 0.8, -2.5, 1.7, -4.9);
  add(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), 0x1a0f0a, 1, 0, -0.8, 0);
  return s;
}
