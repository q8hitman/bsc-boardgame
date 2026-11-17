// Canvas-painted textures for سلة البط: basketball, backboards, net, hardwood, the Kuwait City night skyline.
import * as THREE from "three";

export const INK = "#2b1b45";
export const GOLD = "#ffd23f";
export const CREAM = "#fffdf6";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

/** small deterministic random */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ------------------------------------------------------------------ basketball
/** Equirectangular basketball: pebbled orange leather with the classic black seams. Returns colour + bump maps. */
export function ballTextures() {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  const { c: bc, g: bg } = canvas(W / 2, H / 2);
  const img = g.createImageData(W, H);
  const bimg = bg.createImageData(W / 2, H / 2);
  const r = rng(7);
  const noise = new Float32Array(W * H);
  for (let i = 0; i < noise.length; i++) noise[i] = r();
  const seamW = 0.03;
  const curve = 0.82;
  for (let y = 0; y < H; y++) {
    const th = ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const ph = ((x + 0.5) / W) * Math.PI * 2;
      const dx = -Math.cos(ph) * Math.sin(th);
      const dy = Math.cos(th);
      const dz = Math.sin(ph) * Math.sin(th);
      // angular distance to each seam
      const s1 = Math.abs(Math.asin(Math.max(-1, Math.min(1, dy))));
      const s2 = Math.abs(Math.asin(Math.max(-1, Math.min(1, dz))));
      const s3 = Math.abs(Math.acos(Math.min(1, Math.abs(dx))) - curve);
      const s = Math.min(s1, s2, s3);
      const i = y * W + x;
      // pebbles: fine bumps + soft blotches
      const peb = noise[i] * 0.55 + noise[(i * 7 + 13) % noise.length] * 0.45;
      const blot = 0.5 + 0.5 * Math.sin(ph * 3 + th * 5) * Math.sin(ph * 7 - th * 2);
      const groove = s < seamW ? 1 : s < seamW * 1.8 ? 1 - (s - seamW) / (seamW * 0.8) : 0;
      let R = 226 - 22 * peb + 10 * blot;
      let G = 104 - 16 * peb + 6 * blot;
      let B = 34 - 10 * peb;
      // seam shading: dark line with a darker groove edge
      if (s < seamW) {
        R = 38 + 10 * peb;
        G = 22 + 6 * peb;
        B = 16;
      } else if (groove > 0) {
        R *= 1 - 0.35 * groove;
        G *= 1 - 0.35 * groove;
        B *= 1 - 0.35 * groove;
      }
      const o = i * 4;
      img.data[o] = R;
      img.data[o + 1] = G;
      img.data[o + 2] = B;
      img.data[o + 3] = 255;
      if (!(x & 1) && !(y & 1)) {
        const bo = ((y >> 1) * (W >> 1) + (x >> 1)) * 4;
        const v = s < seamW ? 40 : 170 + 70 * (noise[i] > 0.62 ? 1 : 0) - 60 * groove;
        bimg.data[bo] = bimg.data[bo + 1] = bimg.data[bo + 2] = v;
        bimg.data[bo + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  bg.putImageData(bimg, 0, 0);
  const map = tex(c);
  const bump = tex(bc, false);
  return { map, bump };
}

/** a flat basketball for the HUD (SVG string) */
export function ballSvg(px: number, dim = false) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="hb${dim ? "d" : ""}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${dim ? "#8a7a99" : "#ffb35c"}"/><stop offset=".55" stop-color="${dim ? "#5d4d72" : "#f0731e"}"/><stop offset="1" stop-color="${dim ? "#3c2f52" : "#b8470c"}"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#hb${dim ? "d" : ""})" stroke="${INK}" stroke-width="2.6"/><g fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round" opacity="${dim ? 0.6 : 0.9}"><path d="M20 2v36M2 20h36"/><path d="M8 6.5c5 4 7.5 8.5 7.5 13.5S13 29.5 8 33.5M32 6.5c-5 4-7.5 8.5-7.5 13.5S27 29.5 32 33.5"/></g></svg>`;
}

// ------------------------------------------------------------------ backboard
/** Arcade backboard: cream glass panel, chunky ink frame, the player's colour, gold target square and their duck. */
export function boardTexture(duck: HTMLImageElement | null, color: string) {
  const W = 1024;
  const H = 598;
  const { c, g } = canvas(W, H);
  // panel
  const bgG = g.createLinearGradient(0, 0, 0, H);
  bgG.addColorStop(0, "#ffffff");
  bgG.addColorStop(0.6, "#f6f1ff");
  bgG.addColorStop(1, "#e9e1fb");
  g.fillStyle = bgG;
  g.fillRect(0, 0, W, H);
  // soft pattern: tiny diagonal stripes in the player's colour
  g.save();
  g.globalAlpha = 0.07;
  g.strokeStyle = color;
  g.lineWidth = 18;
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + H, 0);
    g.stroke();
  }
  g.restore();
  // frame: ink, then colour band, then thin gold
  g.lineJoin = "round";
  roundRect(g, 14, 14, W - 28, H - 28, 40);
  g.lineWidth = 28;
  g.strokeStyle = INK;
  g.stroke();
  roundRect(g, 38, 38, W - 76, H - 76, 26);
  g.lineWidth = 12;
  g.strokeStyle = color;
  g.stroke();
  roundRect(g, 50, 50, W - 100, H - 100, 20);
  g.lineWidth = 3;
  g.strokeStyle = "rgba(43,27,69,.35)";
  g.stroke();
  // target square (59×45 cm, bottom at rim height)
  const sw = Math.round((0.59 / 1.8) * W);
  const sh = Math.round((0.45 / 1.05) * H);
  const sx = (W - sw) / 2;
  const sy = H - Math.round((0.15 / 1.05) * H) - sh;
  roundRect(g, sx, sy, sw, sh, 10);
  g.lineWidth = 26;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = 13;
  g.strokeStyle = GOLD;
  g.stroke();
  // duck badge above the square
  const by = sy - 18;
  if (duck && duck.complete && duck.naturalWidth) {
    const h = Math.min(170, by - 60);
    const w = (duck.naturalWidth / duck.naturalHeight) * h;
    g.save();
    g.shadowColor = "rgba(43,27,69,.35)";
    g.shadowOffsetY = 6;
    g.shadowBlur = 8;
    g.drawImage(duck, (W - w) / 2, by - h, w, h);
    g.restore();
  }
  // stars either side
  const star = (cx: number, cy: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = GOLD;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = INK;
    g.stroke();
  };
  star(W / 2 - 200, by - 70, 26);
  star(W / 2 + 200, by - 70, 26);
  star(W / 2 - 280, by - 40, 16);
  star(W / 2 + 280, by - 40, 16);
  // glass shine
  g.save();
  g.globalAlpha = 0.35;
  const sh2 = g.createLinearGradient(0, 0, W, H);
  sh2.addColorStop(0, "rgba(255,255,255,0)");
  sh2.addColorStop(0.42, "rgba(255,255,255,0)");
  sh2.addColorStop(0.47, "rgba(255,255,255,.9)");
  sh2.addColorStop(0.55, "rgba(255,255,255,0)");
  sh2.addColorStop(0.6, "rgba(255,255,255,.5)");
  sh2.addColorStop(0.63, "rgba(255,255,255,0)");
  g.fillStyle = sh2;
  roundRect(g, 52, 52, W - 104, H - 104, 18);
  g.fill();
  g.restore();
  return tex(c);
}

// ------------------------------------------------------------------ net
/** Diamond net lattice tile (repeats around the net). */
export function netTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.lineCap = "round";
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  for (const [w, col] of [
    [11, "rgba(60,40,90,.55)"],
    [7, "#fffaf0"],
  ] as const) {
    g.lineWidth = w;
    g.strokeStyle = col;
    line(-S / 2, 0, S / 2, S);
    line(S / 2, 0, S * 1.5, S);
    line(S / 2, 0, -S / 2, S);
    line(S * 1.5, 0, S / 2, S);
  }
  // knots
  g.fillStyle = "#ffffff";
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [S / 2, S / 2],
    [0, S],
    [S, S],
  ])
    g.fillRect(x - 5, y - 5, 10, 10);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ hardwood
export function woodTexture() {
  const W = 1024;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const r = rng(11);
  const planks = 10;
  const pw = W / planks;
  for (let i = 0; i < planks; i++) {
    let y = -r() * 400;
    while (y < H) {
      const len = 260 + r() * 420;
      const tone = r();
      const base = [
        Math.round(196 + tone * 34),
        Math.round(128 + tone * 30),
        Math.round(72 + tone * 22),
      ];
      const grd = g.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
      grd.addColorStop(0, `rgb(${base[0] - 10},${base[1] - 8},${base[2] - 6})`);
      grd.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`);
      grd.addColorStop(1, `rgb(${base[0] - 14},${base[1] - 10},${base[2] - 8})`);
      g.fillStyle = grd;
      g.fillRect(i * pw, y, pw, len);
      // grain
      g.save();
      g.beginPath();
      g.rect(i * pw, y, pw, len);
      g.clip();
      for (let k = 0; k < 9; k++) {
        const gx = i * pw + 6 + r() * (pw - 12);
        g.strokeStyle = `rgba(90,45,15,${0.06 + r() * 0.1})`;
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        g.moveTo(gx, y);
        const wob = 3 + r() * 6;
        for (let yy = y; yy < y + len; yy += 20) g.lineTo(gx + Math.sin(yy / (40 + k * 7)) * wob, yy);
        g.stroke();
      }
      g.restore();
      // seam at the plank end
      g.fillStyle = "rgba(60,30,10,.55)";
      g.fillRect(i * pw, y + len - 2, pw, 2);
      y += len;
    }
    g.fillStyle = "rgba(55,28,10,.6)";
    g.fillRect(i * pw, 0, 2, H);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Painted court lines for one lane (local frame: x −2.6..2.6, z −0.9..7.5): key, circle, arc, three spot marks. */
export const MAT = { x0: -2.6, x1: 2.6, z0: -0.9, z1: 7.5 };
export function laneMatTexture(color: string, spots: [number, number][]) {
  const PPM = 90; // pixels per metre
  const W = Math.round((MAT.x1 - MAT.x0) * PPM);
  const H = Math.round((MAT.z1 - MAT.z0) * PPM);
  const { c, g } = canvas(W, H);
  const X = (x: number) => (x - MAT.x0) * PPM;
  const Z = (z: number) => (z - MAT.z0) * PPM;
  // key (paint)
  const kw = 1.9;
  const kz = 3.2;
  g.fillStyle = "rgba(60,30,110,.78)";
  g.fillRect(X(-kw / 2), Z(-0.9), kw * PPM, (kz + 0.9) * PPM);
  // a soft colour glow inside the key
  const kg = g.createLinearGradient(0, Z(-0.9), 0, Z(kz));
  kg.addColorStop(0, "rgba(0,0,0,0)");
  kg.addColorStop(1, hexA(color, 0.35));
  g.fillStyle = kg;
  g.fillRect(X(-kw / 2), Z(-0.9), kw * PPM, (kz + 0.9) * PPM);
  g.strokeStyle = "rgba(255,248,230,.92)";
  g.lineWidth = 0.06 * PPM;
  g.strokeRect(X(-kw / 2), Z(-0.9), kw * PPM, (kz + 0.9) * PPM);
  // free-throw circle
  g.beginPath();
  g.arc(X(0), Z(kz), 0.95 * PPM, 0, Math.PI);
  g.stroke();
  g.setLineDash([0.22 * PPM, 0.16 * PPM]);
  g.beginPath();
  g.arc(X(0), Z(kz), 0.95 * PPM, Math.PI, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // the long arc (round 3) in gold
  g.strokeStyle = hexA("#ffd23f", 0.9);
  g.lineWidth = 0.07 * PPM;
  g.beginPath();
  g.arc(X(0), Z(0), 6.45 * PPM, Math.PI / 2 - 0.36, Math.PI / 2 + 0.36);
  g.stroke();
  // spot marks: numbered discs
  spots.forEach(([sx, sz], i) => {
    const cx = X(sx);
    const cy = Z(sz);
    const R = 0.36 * PPM;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = "rgba(43,27,69,.85)";
    g.fill();
    g.lineWidth = 0.06 * PPM;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = "#ffd23f";
    g.font = `800 ${Math.round(R * 1.15)}px "Baloo Bhaijaan 2", system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // canvas top = towards the hoop, so the shooter reads it upright
    g.fillText("١٢٣"[i], cx, cy + R * 0.08);
  });
  const t = tex(c);
  return t;
}

export function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Center-court logo: a big gold ring with the duck and the game's name. */
export function logoTexture(duck: HTMLImageElement | null) {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const cx = S / 2;
  g.beginPath();
  g.arc(cx, cx, 480, 0, Math.PI * 2);
  g.fillStyle = "rgba(43,27,69,.82)";
  g.fill();
  g.lineWidth = 26;
  g.strokeStyle = "#ffd23f";
  g.stroke();
  g.beginPath();
  g.arc(cx, cx, 420, 0, Math.PI * 2);
  g.lineWidth = 8;
  g.strokeStyle = "rgba(255,253,246,.8)";
  g.stroke();
  if (duck && duck.complete && duck.naturalWidth) {
    const h = 420;
    const w = (duck.naturalWidth / duck.naturalHeight) * h;
    g.drawImage(duck, cx - w / 2, cx - h / 2 - 90, w, h);
  }
  g.fillStyle = "#ffd23f";
  g.font = `800 150px "Baloo Bhaijaan 2", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 22;
  g.strokeStyle = "#2b1b45";
  g.strokeText("سلة البط", cx, cx + 250);
  g.fillText("سلة البط", cx, cx + 250);
  return tex(c);
}

// ------------------------------------------------------------------ glows & particles
export function glowTexture(inner = "rgba(255,255,255,1)", mid = "rgba(255,255,255,.35)") {
  const S = 128;
  const { c, g } = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, mid);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c);
}

export function shadowTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(10,5,25,.85)");
  gr.addColorStop(0.45, "rgba(10,5,25,.45)");
  gr.addColorStop(1, "rgba(10,5,25,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c);
}

/** 4-point sparkle with a soft core */
export function sparkTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  const m = S / 2;
  const gr = g.createRadialGradient(m, m, 0, m, m, m);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.15, "rgba(255,255,255,.8)");
  gr.addColorStop(0.4, "rgba(255,255,255,.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(255,255,255,.95)";
  g.beginPath();
  g.moveTo(m, 2);
  g.quadraticCurveTo(m + 6, m - 6, S - 2, m);
  g.quadraticCurveTo(m + 6, m + 6, m, S - 2);
  g.quadraticCurveTo(m - 6, m + 6, 2, m);
  g.quadraticCurveTo(m - 6, m - 6, m, 2);
  g.fill();
  return tex(c);
}

// ------------------------------------------------------------------ Kuwait City by night
/** Panorama behind the court (covers ~200° of a cylinder): dusk-purple sky, stars, moon, layered skyline with lit
 *  windows, Al Hamra tower, Liberation Tower and the Kuwait Towers glowing in the middle. */
export function skylineTexture() {
  const W = 4096;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const r = rng(2026);
  const hz = H * 0.8; // horizon
  // sky
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, "#0d0824");
  sky.addColorStop(0.45, "#241450");
  sky.addColorStop(0.78, "#4a2577");
  sky.addColorStop(0.93, "#a2407e");
  sky.addColorStop(1, "#ff8a5c");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 420; i++) {
    const x = r() * W;
    const y = r() * hz * 0.62;
    const s = r();
    g.fillStyle = `rgba(255,${230 + Math.round(s * 25)},${200 + Math.round(s * 55)},${0.25 + s * 0.6})`;
    g.fillRect(x, y, s > 0.93 ? 3 : 1.6, s > 0.93 ? 3 : 1.6);
  }
  // crescent moon
  {
    const mx = W * 0.71;
    const my = H * 0.17;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 160);
    halo.addColorStop(0, "rgba(255,240,200,.35)");
    halo.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = halo;
    g.fillRect(mx - 160, my - 160, 320, 320);
    g.fillStyle = "#fff4d6";
    g.beginPath();
    g.arc(mx, my, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b1040";
    g.beginPath();
    g.arc(mx + 18, my - 10, 38, 0, Math.PI * 2);
    g.fill();
  }
  // city glow on the horizon
  const glow = g.createLinearGradient(0, hz - 260, 0, hz + 40);
  glow.addColorStop(0, "rgba(255,120,90,0)");
  glow.addColorStop(1, "rgba(255,150,100,.45)");
  g.fillStyle = glow;
  g.fillRect(0, hz - 260, W, 300);

  const windows = (x: number, y: number, w: number, h: number, lit: number, warm: boolean, cell = 9) => {
    for (let wy = y + 8; wy < y + h - 4; wy += cell + 3) {
      for (let wx = x + 5; wx < x + w - 5; wx += cell) {
        if (r() > lit) continue;
        const k = r();
        g.fillStyle = warm
          ? `rgba(255,${200 + Math.round(k * 40)},${110 + Math.round(k * 60)},${0.55 + k * 0.4})`
          : `rgba(${180 + Math.round(k * 60)},${220 + Math.round(k * 30)},255,${0.45 + k * 0.4})`;
        g.fillRect(wx, wy, cell - 4, cell - 3);
      }
    }
  };
  // three layers of towers, far → near
  const layers = [
    { col: "#3a2463", hmin: 40, hmax: 170, lit: 0.18, wmin: 30, wmax: 80, cell: 7 },
    { col: "#24164a", hmin: 60, hmax: 260, lit: 0.3, wmin: 40, wmax: 110, cell: 9 },
    { col: "#150c30", hmin: 40, hmax: 200, lit: 0.42, wmin: 60, wmax: 150, cell: 11 },
  ];
  const landmarks = { towers: W * 0.5, hamra: W * 0.36, liberation: W * 0.63 };
  layers.forEach((L, li) => {
    let x = -20;
    while (x < W) {
      const w = L.wmin + r() * (L.wmax - L.wmin);
      // keep a gap around the Kuwait Towers so they stand out
      if (li > 0 && Math.abs(x + w / 2 - landmarks.towers) < 210) {
        x += w * 0.6;
        continue;
      }
      const near = li === 2 ? 0.45 : 1;
      const h = (L.hmin + r() * (L.hmax - L.hmin)) * near;
      const top = hz - h;
      g.fillStyle = L.col;
      const kind = r();
      g.beginPath();
      if (kind < 0.15) {
        // slanted top
        g.moveTo(x, hz);
        g.lineTo(x, top + 20);
        g.lineTo(x + w, top);
        g.lineTo(x + w, hz);
      } else if (kind < 0.3) {
        // stepped
        g.rect(x, top + 30, w, h - 30);
        g.rect(x + w * 0.2, top, w * 0.6, 32);
      } else g.rect(x, top, w, h);
      g.fill();
      windows(x, top + 10, w, h - 10, L.lit, r() < 0.7, L.cell);
      if (r() < 0.25 && h > 120) {
        g.fillStyle = L.col;
        g.fillRect(x + w / 2 - 1.5, top - 40, 3, 40);
        g.fillStyle = "#ff4060";
        g.beginPath();
        g.arc(x + w / 2, top - 42, 4, 0, Math.PI * 2);
        g.fill();
      }
      x += w + r() * 18 - 4;
    }
  });
  // Al Hamra tower: tall, with the carved curve on one side
  {
    const x = landmarks.hamra;
    const w = 120;
    const h = 560;
    const top = hz - h;
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, "#2a1a52");
    gr.addColorStop(1, "#140b2c");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, hz);
    g.lineTo(x, top + 30);
    g.quadraticCurveTo(x + w * 0.2, top, x + w * 0.5, top);
    g.lineTo(x + w, top + 10);
    g.lineTo(x + w, hz - h * 0.45);
    g.quadraticCurveTo(x + w * 0.35, hz - h * 0.4, x + w * 0.55, hz);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    windows(x, top + 20, w, h, 0.5, false, 8);
    g.restore();
    g.strokeStyle = "rgba(160,200,255,.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + w, hz - h * 0.45);
    g.quadraticCurveTo(x + w * 0.35, hz - h * 0.4, x + w * 0.55, hz);
    g.stroke();
  }
  // Liberation Tower
  {
    const x = landmarks.liberation;
    const h = 600;
    g.fillStyle = "#1a1036";
    g.beginPath();
    g.moveTo(x - 30, hz);
    g.lineTo(x - 16, hz - h * 0.78);
    g.lineTo(x + 16, hz - h * 0.78);
    g.lineTo(x + 30, hz);
    g.fill();
    // the pod
    g.beginPath();
    g.ellipse(x, hz - h * 0.8, 46, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,210,120,.85)";
    for (let i = -3; i <= 3; i++) g.fillRect(x + i * 11 - 3, hz - h * 0.8 - 3, 6, 6);
    g.fillStyle = "#1a1036";
    g.fillRect(x - 4, hz - h, 8, h * 0.2);
    g.fillStyle = "#ff4060";
    g.beginPath();
    g.arc(x, hz - h - 4, 5, 0, Math.PI * 2);
    g.fill();
    windows(x - 14, hz - h * 0.7, 28, h * 0.6, 0.35, true, 7);
  }
  // the Kuwait Towers, lit up
  {
    const x = landmarks.towers;
    const H1 = 520;
    const halo = g.createRadialGradient(x, hz - H1 * 0.5, 20, x, hz - H1 * 0.5, 380);
    halo.addColorStop(0, "rgba(90,220,255,.32)");
    halo.addColorStop(1, "rgba(90,220,255,0)");
    g.fillStyle = halo;
    g.fillRect(x - 400, hz - H1 - 200, 800, H1 + 200);
    const needle = (nx: number, h: number, w: number) => {
      const gr = g.createLinearGradient(nx - w, 0, nx + w, 0);
      gr.addColorStop(0, "#5f6f9a");
      gr.addColorStop(0.5, "#dfe8ff");
      gr.addColorStop(1, "#4a5680");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(nx - w, hz);
      g.lineTo(nx - 2, hz - h);
      g.lineTo(nx + 2, hz - h);
      g.lineTo(nx + w, hz);
      g.fill();
    };
    const sphere = (sx: number, sy: number, R: number) => {
      const glow2 = g.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 1.9);
      glow2.addColorStop(0, "rgba(80,230,255,.45)");
      glow2.addColorStop(1, "rgba(80,230,255,0)");
      g.fillStyle = glow2;
      g.fillRect(sx - R * 2, sy - R * 2, R * 4, R * 4);
      const sg = g.createRadialGradient(sx - R * 0.35, sy - R * 0.4, R * 0.1, sx, sy, R);
      sg.addColorStop(0, "#9ff6ff");
      sg.addColorStop(0.5, "#1aa4c8");
      sg.addColorStop(1, "#0a3a66");
      g.fillStyle = sg;
      g.beginPath();
      g.arc(sx, sy, R, 0, Math.PI * 2);
      g.fill();
      // the famous discs, row by row
      g.save();
      g.beginPath();
      g.arc(sx, sy, R, 0, Math.PI * 2);
      g.clip();
      for (let lat = -80; lat <= 80; lat += 13) {
        const la = (lat * Math.PI) / 180;
        const ry = sy + Math.sin(la) * R;
        const rr = Math.cos(la) * R;
        const n = Math.max(3, Math.round(rr / 7));
        for (let k = 0; k < n; k++) {
          const lo = -Math.PI / 2 + ((k + 0.5) / n) * Math.PI;
          const dx = Math.sin(lo) * rr;
          const d = Math.cos(lo) * Math.cos(la);
          g.fillStyle = k % 3 === 0 ? `rgba(255,230,140,${0.5 + d * 0.5})` : `rgba(140,255,240,${0.25 + d * 0.6})`;
          g.beginPath();
          g.ellipse(sx + dx, ry, 2.6 * (0.4 + d * 0.6), 2.6, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      g.strokeStyle = "rgba(200,250,255,.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, R, 0, Math.PI * 2);
      g.stroke();
    };
    // third (plain) tower, second tower with one sphere, main tower with two
    needle(x + 92, H1 * 0.6, 9);
    needle(x - 70, H1 * 0.78, 12);
    sphere(x - 70, hz - H1 * 0.78 * 0.58, 40);
    needle(x, H1, 15);
    sphere(x, hz - H1 * 0.45, 58);
    sphere(x, hz - H1 * 0.67, 32);
    g.fillStyle = "#ff4060";
    g.beginPath();
    g.arc(x, hz - H1 - 3, 4, 0, Math.PI * 2);
    g.fill();
  }
  // sea of lights below the skyline + haze
  g.fillStyle = "#0e0722";
  g.fillRect(0, hz, W, H - hz);
  for (let i = 0; i < 900; i++) {
    const x = r() * W;
    const y = hz + 4 + Math.pow(r(), 1.6) * (H - hz - 8);
    const k = r();
    g.fillStyle = k < 0.7 ? `rgba(255,200,120,${0.3 + k * 0.5})` : `rgba(150,200,255,${0.3 + k * 0.4})`;
    g.fillRect(x, y, 2 + k * 2, 1.5 + k);
  }
  const haze = g.createLinearGradient(0, hz - 60, 0, hz + 60);
  haze.addColorStop(0, "rgba(255,130,110,0)");
  haze.addColorStop(0.5, "rgba(255,130,110,.18)");
  haze.addColorStop(1, "rgba(255,130,110,0)");
  g.fillStyle = haze;
  g.fillRect(0, hz - 60, W, 120);
  const t = tex(c);
  return { tex: t, horizon: hz / H };
}
