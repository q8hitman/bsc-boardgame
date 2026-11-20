// SPIKE: a race-day campus full of things to look at. Science-club sculptures (a turning DNA helix, molecule
// balloons), a giant rubber duck bobbing in the Pearl's pool, hot-air balloons, banner gantries over the road, a big
// screen showing the ducks, a stage with a DJ duck and dancers, a bouncy castle, event tents, picnics, golf carts
// driving round, tyre stacks and cones by the kerbs, and the Kuwait skyline on the horizon.
import * as THREE from "three";
import { canvasTex, type Tick } from "./life";
import type { Path } from "./track";

export interface Ctx {
  scene: THREE.Scene;
  main: Path;
  /** free ground: a w x d footprint here keeps `margin` from roads and buildings */
  fits: (x: number, z: number, rot: number, w: number, d: number, margin?: number) => boolean;
  take: (x: number, z: number, rot: number, w: number, d: number) => void;
  clear: (x: number, z: number) => number;
  rnd: () => number;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
const COLS = [0xff3d6e, 0x2f8cff, 0xffd23f, 0x36c26b, 0xff8a1e, 0xc77dff, 0x29c7c7];

/** find a free spot near (x, z), trying a few nudges */
function spot(c: Ctx, x: number, z: number, w: number, d: number, rot = 0, margin = 3): [number, number] | null {
  for (let k = 0; k < 14; k++) {
    const a = k * 2.4;
    const r = k * 5;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (c.fits(px, pz, rot, w, d, margin)) {
      c.take(px, pz, rot, w, d);
      return [px, pz];
    }
  }
  return null;
}

/** a DNA double helix sculpture that turns slowly */
export function dnaHelix(c: Ctx, x: number, z: number): Tick | null {
  const at = spot(c, x, z, 9, 9);
  if (!at) return null;
  const g = new THREE.Group();
  const H = 22;
  const strandA = new THREE.MeshPhongMaterial({ color: 0x2f8cff, shininess: 90 });
  const strandB = new THREE.MeshPhongMaterial({ color: 0xff3d6e, shininess: 90 });
  const ptsA: THREE.Vector3[] = [];
  const ptsB: THREE.Vector3[] = [];
  for (let k = 0; k <= 60; k++) {
    const t = k / 60;
    const a = t * Math.PI * 6;
    ptsA.push(new THREE.Vector3(Math.cos(a) * 2.6, t * H, Math.sin(a) * 2.6));
    ptsB.push(new THREE.Vector3(Math.cos(a + Math.PI) * 2.6, t * H, Math.sin(a + Math.PI) * 2.6));
    if (k % 3 === 0) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 5.2, 6), lambert(COLS[(k / 3) % COLS.length]));
      rung.position.y = t * H;
      rung.rotation.z = Math.PI / 2;
      rung.rotation.y = -a;
      g.add(rung);
    }
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsA), 120, 0.45, 8), strandA));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsB), 120, 0.45, 8), strandB));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 1, 24), lambert(0xf2eee4));
  base.position.y = 0.5;
  const root = new THREE.Group();
  root.add(base);
  g.position.y = 1;
  root.add(g);
  root.position.set(at[0], 0, at[1]);
  c.scene.add(root);
  return (dt) => (g.rotation.y += dt * 0.4);
}

/** molecule balloons: atoms with bonds, floating and turning over the science buildings */
export function molecules(c: Ctx, spots: [number, number][]): Tick {
  const list = spots.map(([x, z], n) => {
    const g = new THREE.Group();
    const centre = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 12), new THREE.MeshPhongMaterial({ color: 0xff3d6e, shininess: 80 }));
    g.add(centre);
    for (let k = 0; k < 4; k++) {
      const dir = new THREE.Vector3(Math.cos(k * 1.9), Math.sin(k * 2.7) * 0.8, Math.sin(k * 1.9)).normalize();
      const atom = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), new THREE.MeshPhongMaterial({ color: [0xffffff, 0x2f8cff, 0xffd23f, 0x36c26b][k], shininess: 80 }));
      atom.position.copy(dir.clone().multiplyScalar(5));
      const bond = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 5, 8), lambert(0xdddddd));
      bond.position.copy(dir.clone().multiplyScalar(2.5));
      bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(atom, bond);
    }
    g.position.set(x, 34 + n * 4, z);
    c.scene.add(g);
    return g;
  });
  return (dt, t) =>
    list.forEach((g, n) => {
      g.rotation.y += dt * 0.5;
      g.rotation.x = Math.sin(t * 0.4 + n) * 0.3;
      g.position.y += Math.sin(t + n) * dt * 0.6;
    });
}

/** a giant yellow rubber duck bobbing in a pool */
export function rubberDuck(c: Ctx, x: number, z: number, s = 1): Tick {
  const g = new THREE.Group();
  const yellow = new THREE.MeshPhongMaterial({ color: 0xffd23f, shininess: 90, specular: 0xffffff });
  const body = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), yellow);
  body.scale.set(1, 0.75, 1.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.9, 18, 12), yellow);
  head.position.set(0, 2.6, 1.9);
  const bill = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), lambert(0xff8a1e));
  bill.scale.set(1, 0.4, 1.2);
  bill.position.set(0, 2.3, 3.7);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1, 1.8, 10), yellow);
  tail.position.set(0, 1.4, -3.6);
  tail.rotation.x = -0.9;
  g.add(body, head, bill, tail);
  for (const sd of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lambert(0x1b1440));
    eye.position.set(sd * 0.75, 3.1, 3.3);
    g.add(eye);
  }
  g.scale.setScalar(s);
  g.position.set(x, 0.6, z);
  c.scene.add(g);
  return (_dt, t) => {
    g.position.y = 0.6 + Math.sin(t * 1.4) * 0.2 * s;
    g.rotation.z = Math.sin(t * 1.1) * 0.06;
    g.rotation.y = Math.sin(t * 0.3) * 0.5;
  };
}

/** hot-air balloons in stripes, drifting slowly high over the campus */
export function hotAirBalloons(c: Ctx, centre: THREE.Vector3, n = 6): Tick {
  const list = Array.from({ length: n }, (_, k) => {
    const tex = canvasTex(64, 64, (cx) => {
      for (let x = 0; x < 64; x += 8) {
        cx.fillStyle = `#${COLS[(x / 8 + k) % COLS.length].toString(16).padStart(6, "0")}`;
        cx.fillRect(x, 0, 8, 64);
      }
    });
    const g = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshLambertMaterial({ map: tex }));
    env.scale.set(1, 1.15, 1);
    const neck = new THREE.Mesh(new THREE.ConeGeometry(4.2, 5, 16, 1, true), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    neck.position.y = -8.2;
    neck.rotation.x = Math.PI;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), lambert(0x9a6a3a));
    basket.position.y = -12;
    g.add(env, neck, basket);
    const a = (k / n) * Math.PI * 2;
    const r = 120 + c.rnd() * 140;
    g.position.set(centre.x + Math.cos(a) * r, 55 + c.rnd() * 45, centre.z + Math.sin(a) * r);
    c.scene.add(g);
    return { g, a, r, sp: 0.01 + c.rnd() * 0.02, ph: c.rnd() * 6 };
  });
  return (dt, t) =>
    list.forEach((b) => {
      b.a += b.sp * dt;
      b.g.position.x = centre.x + Math.cos(b.a) * b.r;
      b.g.position.z = centre.z + Math.sin(b.a) * b.r;
      b.g.position.y += Math.sin(t * 0.3 + b.ph) * dt * 0.8;
    });
}

/** banner gantries over the road: two posts and a beam carrying a sign facing the karts */
export function gantries(c: Ctx, at: number[], texts: [string, string, string][]) {
  at.forEach((f, n) => {
    const i = Math.round(f * (c.main.n - 1));
    const p = c.main.P[i];
    const nn = c.main.normal(i);
    const hd = c.main.heading(i);
    const W = c.main.width + 1.4;
    const [text, bg, fg] = texts[n % texts.length];
    const post = new THREE.CylinderGeometry(0.35, 0.35, 9, 10);
    for (const sd of [1, -1]) {
      const m = new THREE.Mesh(post, lambert(0xf4f4f0));
      m.position.set(p.x + nn.x * sd * W, 4.5, p.z + nn.z * sd * W);
      c.scene.add(m);
    }
    const tex = canvasTex(1024, 128, (cx) => {
      cx.fillStyle = bg;
      cx.fillRect(0, 0, 1024, 128);
      cx.fillStyle = fg;
      cx.font = "bold 76px 'Noto Kufi Arabic', Tahoma, sans-serif";
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      cx.fillText(text, 512, 72);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    sign.position.set(p.x, 8, p.z);
    sign.rotation.y = hd + Math.PI;
    c.scene.add(sign);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 1, 0.4, 0.4), lambert(0xf4f4f0));
    beam.position.set(p.x, 9.4, p.z);
    beam.rotation.y = hd;
    c.scene.add(beam);
  });
}

/** a big screen beside the road showing the club ducks one after another */
export function bigScreen(c: Ctx, f: number, heads: string[]): Tick | null {
  const i = Math.round(f * (c.main.n - 1));
  const nn = c.main.normal(i);
  const hd = c.main.heading(i);
  const x = c.main.P[i].x + nn.x * (c.main.width + 9);
  const z = c.main.P[i].z + nn.z * (c.main.width + 9);
  if (!c.fits(x, z, hd, 14, 3, 2)) return null;
  c.take(x, z, hd, 14, 3);
  const cv = document.createElement("canvas");
  cv.width = 320;
  cv.height = 180;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const imgs = heads.map((h) => {
    const im = new Image();
    im.src = `assets/heads/${h}.png`;
    return im;
  });
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(14, 8.4, 0.6), lambert(0x22232a));
  frame.position.y = 9;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(13, 7.4), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, 9, -0.32);
  screen.rotation.y = Math.PI;
  const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 5, 1), lambert(0x5c6168));
  leg.position.y = 2.5;
  g.add(frame, screen, leg);
  g.position.set(x, 0, z);
  g.rotation.y = hd + Math.PI / 2 + (Math.sign(nn.x * Math.sin(hd) + nn.z * Math.cos(hd)) || 1) * 0; // faces across to the road
  g.lookAt(c.main.P[i].x, 0, c.main.P[i].z);
  c.scene.add(g);
  let k = 0;
  let next = 0;
  return (_dt, t) => {
    if (t < next) return;
    next = t + 2.2;
    const im = imgs[k++ % imgs.length];
    const grad = ctx.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, "#1d3b8f");
    grad.addColorStop(1, "#ff3d6e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 320, 180);
    if (im.complete && im.naturalWidth) ctx.drawImage(im, 110, 20, 140, 140);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 26px 'Noto Kufi Arabic', Tahoma, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("سباق البط", 160, 30);
    tex.needsUpdate = true;
  };
}

/** a stage with speakers, lights and a DJ duck; the dancers come from the crowd helper */
export function stage(c: Ctx, x: number, z: number): { tick: Tick; front: THREE.Vector3[] } | null {
  const at = spot(c, x, z, 18, 12);
  if (!at) return null;
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 1.4, 10), lambert(0x2a2a33));
  deck.position.y = 0.7;
  const back = new THREE.Mesh(new THREE.BoxGeometry(16, 9, 0.6), lambert(0x1b1440));
  back.position.set(0, 5.5, -4.7);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.6, 11), lambert(0xffd23f));
  roof.position.y = 10.2;
  g.add(deck, back, roof);
  for (const sd of [1, -1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), lambert(0xffd23f));
    pillar.position.set(sd * 7.8, 5.5, 4.6);
    const spk = new THREE.Mesh(new THREE.BoxGeometry(2, 3.4, 1.6), lambert(0x111111));
    spk.position.set(sd * 6.6, 3.1, 3.4);
    g.add(pillar, spk);
  }
  const lights = COLS.slice(0, 5).map((col, k) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
    l.position.set(-6 + k * 3, 9.6, 4.4);
    g.add(l);
    return l;
  });
  const dj = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 1.6), lambert(0x3a3a46));
  dj.position.set(0, 2, -1);
  g.add(dj);
  const label = canvasTex(512, 96, (cx) => {
    cx.fillStyle = "#1b1440";
    cx.fillRect(0, 0, 512, 96);
    cx.fillStyle = "#ffd23f";
    cx.font = "bold 56px 'Noto Kufi Arabic', Tahoma, sans-serif";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("حفلة البط", 256, 52);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshBasicMaterial({ map: label }));
  sign.position.set(0, 8, -4.35);
  g.add(sign);
  const rot = c.rnd() * Math.PI * 2;
  g.position.set(at[0], 0, at[1]);
  g.rotation.y = rot;
  c.scene.add(g);
  const front: THREE.Vector3[] = [];
  for (let r = 0; r < 3; r++)
    for (let k = -3; k <= 3; k++) {
      const lx = k * 2;
      const lz = 8 + r * 2;
      front.push(new THREE.Vector3(at[0] + lx * Math.cos(rot) + lz * Math.sin(rot), 0, at[1] - lx * Math.sin(rot) + lz * Math.cos(rot)));
    }
  return {
    front,
    tick: (_dt, t) => lights.forEach((l, k) => (l.visible = Math.floor(t * 4 + k) % 2 === 0)),
  };
}

/** a bouncy castle: towers and walls in bright colours, wobbling */
export function bouncyCastle(c: Ctx, x: number, z: number): Tick | null {
  const at = spot(c, x, z, 12, 12);
  if (!at) return null;
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 10), lambert(0x2f8cff));
  base.position.y = 0.8;
  g.add(base);
  for (const [px, pz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 12), lambert(0xff3d6e));
    tower.position.set(px, 3, pz);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2, 12), lambert(0xffd23f));
    top.position.set(px, 7, pz);
    g.add(tower, top);
  }
  for (const [px, pz, w, d] of [[0, -4.6, 8, 0.8], [0, 4.6, 8, 0.8], [-4.6, 0, 0.8, 8]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d), lambert(0x36c26b));
    wall.position.set(px, 3, pz);
    g.add(wall);
  }
  g.position.set(at[0], 0, at[1]);
  c.scene.add(g);
  return (_dt, t) => g.scale.set(1 + Math.sin(t * 5) * 0.015, 1 - Math.sin(t * 5) * 0.02, 1 + Math.sin(t * 5) * 0.015);
}

/** event tents: white peaked canopies in a cluster */
export function tents(c: Ctx, x: number, z: number, n: number) {
  for (let k = 0; k < n; k++) {
    const at = spot(c, x + (k % 3) * 9, z + Math.floor(k / 3) * 9, 7, 7, 0, 2);
    if (!at) continue;
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.4, 4), lambert(0xffffff));
    top.rotation.y = Math.PI / 4;
    top.position.y = 4.4;
    g.add(top);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.5, 6.6), lambert(COLS[k % COLS.length]));
    trim.position.y = 3.2;
    g.add(trim);
    for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 5), lambert(0xdddddd));
      p.position.set(px, 1.6, pz);
      g.add(p);
    }
    const table = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 1.4), lambert(0xffffff));
    table.position.y = 0.45;
    g.add(table);
    g.position.set(at[0], 0, at[1]);
    c.scene.add(g);
  }
}

/** picnic blankets on the lawns */
export function picnics(c: Ctx, n: number, area: [number, number, number, number]): THREE.Vector3[] {
  const sitters: THREE.Vector3[] = [];
  const tex = (a: string, b: string) =>
    canvasTex(32, 32, (cx) => {
      for (let y = 0; y < 32; y += 8) for (let x = 0; x < 32; x += 8) {
        cx.fillStyle = (x + y) % 16 ? a : b;
        cx.fillRect(x, y, 8, 8);
      }
    });
  const mats = [tex("#ff3d6e", "#ffffff"), tex("#2f8cff", "#ffffff"), tex("#36c26b", "#ffffff")].map((t) => new THREE.MeshLambertMaterial({ map: t }));
  for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
    const x = area[0] + c.rnd() * (area[1] - area[0]);
    const z = area[2] + c.rnd() * (area[3] - area[2]);
    const rot = c.rnd() * Math.PI;
    if (!c.fits(x, z, rot, 4, 3, 3)) continue;
    c.take(x, z, rot, 4, 3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), mats[k % 3]);
    m.rotation.order = "YXZ";
    m.rotation.set(-Math.PI / 2, rot, 0);
    m.position.set(x, 0.12, z);
    c.scene.add(m);
    sitters.push(new THREE.Vector3(x + 0.8, 0, z), new THREE.Vector3(x - 0.8, 0, z + 0.4));
    k++;
  }
  return sitters;
}

/** golf carts driving round little loops on the paths */
export function golfCarts(c: Ctx, n: number): Tick {
  const carts: { g: THREE.Group; cx: number; cz: number; r: number; a: number; sp: number }[] = [];
  for (let k = 0, tries = 0; k < n && tries < 800; tries++) {
    const cx = -120 + c.rnd() * 240;
    const cz = -40 + c.rnd() * 320;
    const r = 8 + c.rnd() * 6;
    let ok = true;
    for (let a = 0; a < Math.PI * 2 && ok; a += 0.5) ok = c.fits(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0, 3, 3, 2);
    if (!ok) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 2.6), lambert(0xffffff));
    body.position.y = 0.8;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 2.2), lambert(COLS[k % COLS.length]));
    roof.position.y = 2.3;
    g.add(body, roof);
    for (const [px, pz] of [[-0.7, 0.9], [0.7, 0.9], [-0.7, -0.9], [0.7, -0.9]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 4), lambert(0x777777));
      post.position.set(px, 1.65, pz);
      g.add(post);
    }
    c.scene.add(g);
    carts.push({ g, cx, cz, r, a: c.rnd() * 6, sp: 0.4 + c.rnd() * 0.3 });
    k++;
  }
  return (dt) =>
    carts.forEach((q) => {
      q.a += q.sp * dt;
      q.g.position.set(q.cx + Math.cos(q.a) * q.r, 0, q.cz + Math.sin(q.a) * q.r);
      q.g.rotation.y = -q.a;
    });
}

/** tyre stacks on the outside of bends, and cones along some kerbs */
export function trackside(c: Ctx) {
  const tyre = new THREE.TorusGeometry(0.55, 0.28, 6, 12);
  tyre.rotateX(Math.PI / 2);
  const tyres: THREE.Matrix4[] = [];
  const tyreCols: THREE.Color[] = [];
  const cones: THREE.Matrix4[] = [];
  const m = c.main;
  for (let i = 0; i < m.n; i += 6) {
    const a = m.heading(m.wrap(i - 10));
    const b = m.heading(m.wrap(i + 10));
    let bend = b - a;
    while (bend > Math.PI) bend -= Math.PI * 2;
    while (bend < -Math.PI) bend += Math.PI * 2;
    const nn = m.normal(i);
    if (Math.abs(bend) > 0.25) {
      // the outside of the bend
      const sd = bend > 0 ? -1 : 1;
      const x = m.P[i].x + nn.x * sd * (m.width + 2.2);
      const z = m.P[i].z + nn.z * sd * (m.width + 2.2);
      if (c.clear(x, z) < 1.5) continue;
      for (let h = 0; h < 3; h++) {
        tyres.push(new THREE.Matrix4().makeTranslation(x, 0.28 + h * 0.56, z));
        tyreCols.push(new THREE.Color(h === 1 ? 0xff3d3d : 0x222226));
      }
    } else if (i % 18 === 0) {
      for (const sd of [1, -1]) {
        const x = m.P[i].x + nn.x * sd * (m.width + 1.4);
        const z = m.P[i].z + nn.z * sd * (m.width + 1.4);
        if (c.clear(x, z) > 0.8) cones.push(new THREE.Matrix4().makeTranslation(x, 0.45, z));
      }
    }
  }
  const ti = new THREE.InstancedMesh(tyre, new THREE.MeshLambertMaterial({ color: 0xffffff }), tyres.length);
  tyres.forEach((mm, k) => {
    ti.setMatrixAt(k, mm);
    ti.setColorAt(k, tyreCols[k]);
  });
  const ci = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 0.9, 10), lambert(0xff7a1a), cones.length);
  cones.forEach((mm, k) => ci.setMatrixAt(k, mm));
  c.scene.add(ti, ci);
}

/** the Kuwait skyline far off on the horizon: Kuwait Towers, the Liberation Tower, Al Hamra */
export function skyline(scene: THREE.Scene, centre: THREE.Vector3, dir: number, dist: number) {
  const g = new THREE.Group();
  const tile = canvasTex(64, 64, (cx) => {
    cx.fillStyle = "#2c7fa3";
    cx.fillRect(0, 0, 64, 64);
    cx.fillStyle = "#7fd0e8";
    for (let y = 0; y < 64; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < 64; x += 8) cx.fillRect(x, y, 4, 4);
  });
  const sequin = new THREE.MeshLambertMaterial({ map: tile });
  const white = lambert(0xe8ecef);
  // Kuwait Towers: three needles, the big two with sequined spheres
  const tower = (x: number, h: number, balls: [number, number][]) => {
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.2, h, 12), white);
    needle.position.set(x, h / 2, 0);
    g.add(needle);
    for (const [y, r] of balls) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), sequin);
      b.position.set(x, y, 0);
      g.add(b);
    }
  };
  tower(0, 64, [[30, 9], [44, 5.5]]);
  tower(16, 50, [[28, 7]]);
  tower(26, 40, []);
  // the Liberation Tower: a tall tapering shaft with a ring and a mast
  const lib = new THREE.Mesh(new THREE.CylinderGeometry(2, 4.5, 90, 10), lambert(0xcfd6db));
  lib.position.set(-60, 45, 20);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 6, 16), lambert(0x9fb3bd));
  ring.position.set(-60, 76, 20);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 30, 6), white);
  mast.position.set(-60, 104, 20);
  g.add(lib, ring, mast);
  // Al Hamra: a tall tower with a curved cut
  const hamra = new THREE.Mesh(new THREE.BoxGeometry(14, 120, 14), lambert(0xc9c2b3));
  hamra.position.set(-110, 60, -10);
  hamra.rotation.y = 0.4;
  g.add(hamra);
  // other towers
  for (let k = 0; k < 9; k++) {
    const h = 30 + (k * 17) % 50;
    const b = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), lambert(k % 2 ? 0xb9c4cc : 0xd5cdbd));
    b.position.set(-150 + k * 22, h / 2, -30 - (k % 3) * 12);
    g.add(b);
  }
  g.position.set(centre.x + Math.sin(dir) * dist, 0, centre.z + Math.cos(dir) * dist);
  g.lookAt(centre.x, 0, centre.z);
  g.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mm) (mm as THREE.MeshLambertMaterial).fog = true;
  });
  scene.add(g);
}
