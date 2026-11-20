// SPIKE: the duck karts. Every duck has its own kart: a body style, its colours and a touch of its own.
//  - classic: open tube go-kart, big rear tyres, engine and twin exhausts (the default)
//  - bubble:  a round bubble car with white-wall tyres and a big bow on the back (fayzah)
//  - racer:   a low wedge racer with front and rear wings and a racing stripe (tima)
//  - buggy:   a lifted dune buggy, chunky tread tyres, roll cage, spare tyre (ali)
//  - muscle:  a boxy hot-rod with a blower and chrome stacks on the hood, flames down the sides (ahmad)
// All styles keep the orange duck-bill nose. Forward is +z, the floor is y = 0. Each kart is merged into one mesh
// per material (a few draw calls); geometry is shared between karts of the same style.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type KartStyle = "classic" | "bubble" | "racer" | "buggy" | "muscle";
export interface KartLook {
  style: KartStyle;
  paint: number;
  accent: number;
}
/** each duck's kart (others get a classic kart in a seat colour) */
export const LOOKS: Record<string, KartLook> = {
  fayzah: { style: "bubble", paint: 0xff7aa8, accent: 0xe8283a },
  tima: { style: "racer", paint: 0x22c4c4, accent: 0xffffff },
  ali: { style: "buggy", paint: 0x7a8a3a, accent: 0xffb21e },
  ahmad: { style: "muscle", paint: 0x2f6cff, accent: 0xff7a1a },
};

type Mat = "paint" | "accent" | "tyre" | "hub" | "chrome" | "metal" | "seat" | "bill" | "white" | "glass";
type Part = { geo: THREE.BufferGeometry; mat: Mat };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function tube(points: THREE.Vector3[], r: number, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.15);
  return new THREE.TubeGeometry(curve, closed ? 64 : 24, r, 8, closed);
}

/** a tyre: a lathed rounded-box cross-section, axis along x */
function tyre(r: number, w: number, hubFrac = 0.55): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const hub = r * hubFrac;
  const round = Math.min(w, r - hub) * 0.45;
  pts.push(new THREE.Vector2(hub, -w / 2));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - round + Math.cos(a) * round, -w / 2 + round + Math.sin(a) * round));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - round + Math.cos(a) * round, w / 2 - round + Math.sin(a) * round));
  }
  pts.push(new THREE.Vector2(hub, w / 2));
  const g = new THREE.LatheGeometry(pts, 18);
  g.rotateZ(Math.PI / 2);
  return g;
}

const cyl = (r: number, len: number, seg = 12) => new THREE.CylinderGeometry(r, r, len, seg);

function roundedSlab(w: number, h: number, depth: number, rad: number, bevel = 0.05): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + rad, y);
  s.lineTo(x + w - rad, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rad);
  s.lineTo(x + w, y + h - rad);
  s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  s.lineTo(x + rad, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rad);
  s.lineTo(x, y + rad);
  s.quadraticCurveTo(x, y, x + rad, y);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** a side profile (z forward, y up) extruded across x, centred */
function profile(pts: [number, number][], width: number, bevel = 0.08): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> world z
  return g;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function wheels(add: (g: THREE.BufferGeometry, m: Mat) => void, spec: [number, number, number, number][], opts: { white?: boolean; tread?: boolean } = {}) {
  for (const [x, z, r, w] of spec) {
    add(at(tyre(r, w), x, r, z), "tyre");
    if (opts.tread) {
      // chunky lugs around the tread
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        add(at(new THREE.BoxGeometry(w * 0.95, 0.09, 0.16), x, r + Math.cos(a) * r, z + Math.sin(a) * r, a), "tyre");
      }
    }
    if (opts.white) add(at(new THREE.TorusGeometry(r * 0.66, r * 0.07, 6, 18), x + Math.sign(x) * (w / 2 - 0.02), r, z, 0, Math.PI / 2), "white");
    add(at(cyl(r * 0.5, w * 0.9, 14), x + Math.sign(x) * 0.03, r, z, 0, 0, Math.PI / 2), "hub");
    add(at(cyl(r * 0.18, w * 0.95, 8), x + Math.sign(x) * 0.06, r, z, 0, 0, Math.PI / 2), "chrome");
  }
}

function bill(add: (g: THREE.BufferGeometry, m: Mat) => void, y: number, z: number, w = 1.35) {
  const b = new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.scale(w, 0.42, 1);
  add(at(b, 0, y, z), "bill");
}

function seat(add: (g: THREE.BufferGeometry, m: Mat) => void, y: number, z: number, h = 0.95) {
  add(at(roundedSlab(0.82, 0.62, 0.12, 0.18), 0, y, z, Math.PI / 2), "seat");
  add(at(roundedSlab(0.86, h, 0.12, 0.3), 0, y + 0.42, z - 0.4, -0.32), "seat");
}

function wheelAndColumn(add: (g: THREE.BufferGeometry, m: Mat) => void, y: number, z: number) {
  add(at(cyl(0.035, 0.75, 6), 0, y - 0.26, z + 0.3, -0.95), "metal");
  add(at(new THREE.TorusGeometry(0.2, 0.04, 6, 16), 0, y, z, -0.6), "seat");
}

/** the parts of a style, in kart space; seatY/seatZ = where the duck sits */
function build(style: KartStyle): { parts: Part[]; seatY: number; seatZ: number } {
  const p: Part[] = [];
  const add = (geo: THREE.BufferGeometry, mat: Mat) => p.push({ geo, mat });
  const R = 0.075;
  if (style === "classic") {
    add(tube([v(0, 0.32, 1.45), v(0.42, 0.32, 1.3), v(0.66, 0.32, 0.65), v(0.68, 0.32, -0.6), v(0.56, 0.32, -1.25), v(0, 0.32, -1.32), v(-0.56, 0.32, -1.25), v(-0.68, 0.32, -0.6), v(-0.66, 0.32, 0.65), v(-0.42, 0.32, 1.3)], R, true), "paint");
    add(tube([v(-0.5, 0.32, 1.22), v(-0.58, 0.44, 1.62), v(-0.3, 0.5, 1.82), v(0.3, 0.5, 1.82), v(0.58, 0.44, 1.62), v(0.5, 0.32, 1.22)], R), "paint");
    for (const sx of [-1, 1]) {
      add(tube([v(0.62 * sx, 0.32, 0.55), v(1.02 * sx, 0.36, 0.42), v(1.05 * sx, 0.36, -0.2), v(0.66 * sx, 0.32, -0.38)], R), "paint");
      add(tube([v(0.6 * sx, 0.32, -0.1), v(0.62 * sx, 0.62, -0.32), v(0.6 * sx, 0.32, -0.62)], R * 0.85), "paint");
    }
    add(tube([v(-0.56, 0.32, -1.25), v(-0.95, 0.38, -1.55), v(-0.7, 0.42, -1.78), v(0.7, 0.42, -1.78), v(0.95, 0.38, -1.55), v(0.56, 0.32, -1.25)], R), "paint");
    add(at(roundedSlab(1.1, 2.4, 0.04, 0.3), 0, 0.3, 0.05, Math.PI / 2), "metal");
    wheels(add, [[-1.02, -0.88, 0.5, 0.56], [1.02, -0.88, 0.5, 0.56], [-0.92, 1.0, 0.38, 0.42], [0.92, 1.0, 0.38, 0.42]]);
    add(at(cyl(0.05, 2.0, 6), 0, 0.5, -0.88, 0, 0, Math.PI / 2), "metal");
    add(at(cyl(0.04, 1.8, 6), 0, 0.38, 1.0, 0, 0, Math.PI / 2), "metal");
    seat(add, 0.42, -0.35);
    wheelAndColumn(add, 0.88, 0.32);
    add(at(new THREE.BoxGeometry(0.62, 0.36, 0.34), 0, 0.56, -1.12), "metal");
    add(at(new THREE.BoxGeometry(0.4, 0.14, 0.26), 0, 0.8, -1.12), "metal");
    for (const sx of [-0.2, 0.2]) {
      add(at(cyl(0.085, 0.5, 10), sx, 0.68, -1.42, Math.PI / 2), "chrome");
      add(at(cyl(0.065, 0.02, 10), sx, 0.68, -1.68, Math.PI / 2), "tyre");
    }
    bill(add, 0.36, 1.58);
    return { parts: p, seatY: 0.36, seatZ: -0.42 };
  }
  if (style === "bubble") {
    // a round shell, open at the top, sitting low between four small white-wall wheels
    const shell = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68);
    shell.scale(0.95, 0.62, 1.55);
    add(at(shell, 0, 0.82, 0), "paint");
    // a cream band round the middle
    const band = new THREE.TorusGeometry(1, 0.06, 6, 40);
    band.scale(0.97, 1.58, 1);
    add(at(band, 0, 0.62, 0, Math.PI / 2), "white");
    wheels(add, [[-0.86, -0.9, 0.38, 0.36], [0.86, -0.9, 0.38, 0.36], [-0.82, 0.95, 0.34, 0.32], [0.82, 0.95, 0.34, 0.32]], { white: true });
    seat(add, 0.62, -0.25, 0.8);
    wheelAndColumn(add, 1.0, 0.45);
    // round headlights
    for (const sx of [-0.45, 0.45]) add(at(new THREE.SphereGeometry(0.17, 12, 8), sx, 0.78, 1.42), "white");
    // the big bow on the back: two loops and a knot, tails hanging
    for (const sx of [-1, 1]) {
      const loop = new THREE.SphereGeometry(0.26, 14, 10);
      loop.scale(1.25, 0.8, 0.45);
      add(at(loop, sx * 0.3, 0.98, -1.5, 0, 0, sx * 0.35), "accent");
      add(at(new THREE.BoxGeometry(0.13, 0.4, 0.07), sx * 0.16, 0.7, -1.54, 0, 0, sx * 0.4), "accent");
    }
    add(at(new THREE.SphereGeometry(0.13, 12, 8), 0, 0.98, -1.52), "accent");
    bill(add, 0.62, 1.48, 1.2);
    return { parts: p, seatY: 0.56, seatZ: -0.32 };
  }
  if (style === "racer") {
    // a low wedge: nose near the ground, rising to the cockpit, flat tail
    add(profile([[1.95, 0.32], [1.95, 0.42], [0.6, 0.78], [-0.1, 0.82], [-1.55, 0.86], [-1.7, 0.62], [-1.7, 0.3], [0.2, 0.26]], 1.25), "paint");
    // side pods
    for (const sx of [-1, 1]) add(at(roundedSlab(0.36, 1.5, 0.34, 0.14), sx * 0.78, 0.5, -0.35, Math.PI / 2), "paint");
    // the stripe down the middle (over the nose and behind the seat)
    add(at(new THREE.BoxGeometry(0.3, 0.04, 1.3), 0, 0.76, 1.05, -0.26), "accent");
    add(at(new THREE.BoxGeometry(0.3, 0.04, 0.8), 0, 0.89, -1.2), "accent");
    // front wing and rear wing on posts
    add(at(roundedSlab(2.0, 0.42, 0.06, 0.12, 0.03), 0, 0.28, 2.0, Math.PI / 2), "accent");
    add(at(new THREE.BoxGeometry(0.06, 0.24, 0.42), 1.0, 0.36, 2.0), "paint");
    add(at(new THREE.BoxGeometry(0.06, 0.24, 0.42), -1.0, 0.36, 2.0), "paint");
    add(at(roundedSlab(1.9, 0.4, 0.06, 0.12, 0.03), 0, 1.12, -1.68, Math.PI / 2 - 0.12), "accent");
    for (const sx of [-0.5, 0.5]) add(at(new THREE.BoxGeometry(0.08, 0.3, 0.18), sx, 0.98, -1.6), "metal");
    for (const sx of [-1, 1]) add(at(new THREE.BoxGeometry(0.06, 0.4, 0.5), sx * 0.95, 1.1, -1.68), "paint");
    wheels(add, [[-1.05, -1.0, 0.48, 0.6], [1.05, -1.0, 0.48, 0.6], [-1.0, 1.15, 0.4, 0.46], [1.0, 1.15, 0.4, 0.46]]);
    seat(add, 0.6, -0.3, 0.85);
    wheelAndColumn(add, 1.02, 0.35);
    // twin exhausts under the rear wing
    for (const sx of [-0.25, 0.25]) add(at(cyl(0.08, 0.3, 10), sx, 0.6, -1.78, Math.PI / 2), "chrome");
    bill(add, 0.36, 2.0, 1.1);
    return { parts: p, seatY: 0.64, seatZ: -0.38 };
  }
  if (style === "buggy") {
    // a lifted tub on a frame with big tread tyres and a roll cage
    add(profile([[1.45, 0.62], [1.2, 0.98], [-0.9, 1.0], [-1.3, 0.8], [-1.3, 0.55], [1.1, 0.5]], 1.35), "paint");
    // the cage: two hoops and a top bar each side
    for (const z of [-0.85, 0.35]) add(tube([v(-0.64, 0.98, z), v(-0.6, 1.95, z), v(0, 2.1, z), v(0.6, 1.95, z), v(0.64, 0.98, z)], 0.06), "accent");
    for (const sx of [-0.6, 0.6]) add(tube([v(sx, 1.97, 0.35), v(sx, 2.0, -0.25), v(sx, 1.97, -0.85)], 0.055), "accent");
    // bull bar and lights
    add(tube([v(-0.7, 0.55, 1.55), v(-0.7, 1.05, 1.7), v(0.7, 1.05, 1.7), v(0.7, 0.55, 1.55)], 0.07), "accent");
    for (const sx of [-0.35, 0.35]) add(at(cyl(0.13, 0.1, 12), sx, 1.98, 0.4, Math.PI / 2), "white");
    // the spare tyre on the back
    add(at(tyre(0.36, 0.28), 0, 0.92, -1.45, 0, Math.PI / 2), "tyre");
    add(at(cyl(0.18, 0.26, 12), 0, 0.92, -1.45, Math.PI / 2), "hub");
    wheels(add, [[-1.0, -0.85, 0.58, 0.6], [1.0, -0.85, 0.58, 0.6], [-0.98, 1.05, 0.55, 0.56], [0.98, 1.05, 0.55, 0.56]], { tread: true });
    seat(add, 0.98, -0.3, 0.85);
    wheelAndColumn(add, 1.42, 0.38);
    bill(add, 0.66, 1.42, 1.15);
    return { parts: p, seatY: 0.92, seatZ: -0.38 };
  }
  // muscle: a boxy hot-rod body with a blower and chrome stacks through the hood, flames along the sides
  add(profile([[1.85, 0.4], [1.85, 0.82], [0.55, 0.92], [0.3, 0.86], [-1.0, 0.86], [-1.55, 0.95], [-1.65, 0.7], [-1.65, 0.38], [1.2, 0.32]], 1.45), "paint");
  add(at(new THREE.BoxGeometry(0.62, 0.34, 0.8), 0, 1.05, 1.05), "metal");
  add(at(new THREE.BoxGeometry(0.7, 0.12, 0.5), 0, 1.28, 1.05), "chrome");
  for (const sx of [-0.18, 0.18]) for (const sz of [0.9, 1.2]) add(at(cyl(0.08, 0.35, 10), sx, 1.45, sz), "chrome");
  // flames: orange teeth along each side
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const f = new THREE.ConeGeometry(0.14, 0.7 - k * 0.08, 3);
      add(at(f, sx * 0.75, 0.62, 1.2 - k * 0.42, Math.PI / 2 + 0.1, 0, sx * Math.PI / 2), "accent");
    }
  }
  // tail lights and a chrome rear bumper
  for (const sx of [-0.5, 0.5]) add(at(new THREE.BoxGeometry(0.34, 0.14, 0.06), sx, 0.78, -1.68), "accent");
  add(at(new THREE.BoxGeometry(1.5, 0.12, 0.12), 0, 0.42, -1.72), "chrome");
  // side exhaust pipes
  for (const sx of [-1, 1]) add(at(cyl(0.09, 1.6, 10), sx * 0.82, 0.38, -0.2, Math.PI / 2), "chrome");
  wheels(add, [[-1.08, -1.0, 0.6, 0.66], [1.08, -1.0, 0.6, 0.66], [-1.0, 1.2, 0.42, 0.42], [1.0, 1.2, 0.42, 0.42]]);
  seat(add, 0.86, -0.45, 0.9);
  wheelAndColumn(add, 1.3, 0.3);
  bill(add, 0.42, 1.95, 1.25);
  return { parts: p, seatY: 0.8, seatZ: -0.52 };
}

const cache = new Map<KartStyle, { geos: Partial<Record<Mat, THREE.BufferGeometry>>; seatY: number; seatZ: number }>();
let shared: Partial<Record<Mat, THREE.Material>> | null = null;

function styleGeos(style: KartStyle) {
  let c = cache.get(style);
  if (c) return c;
  const b = build(style);
  const byMat: Partial<Record<Mat, THREE.BufferGeometry[]>> = {};
  for (const { geo, mat } of b.parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g.attributes.uv) g.deleteAttribute("uv");
    (byMat[mat] ??= []).push(g);
  }
  const geos: Partial<Record<Mat, THREE.BufferGeometry>> = {};
  for (const [m, list] of Object.entries(byMat) as [Mat, THREE.BufferGeometry[]][]) geos[m] = mergeGeometries(list)!;
  c = { geos, seatY: b.seatY, seatZ: b.seatZ };
  cache.set(style, c);
  return c;
}

function sharedMats() {
  if (shared) return shared;
  const phong = (color: number, shininess: number, specular = 0x333333) => new THREE.MeshPhongMaterial({ color, shininess, specular });
  shared = {
    tyre: phong(0x1d1d22, 8, 0x111111),
    hub: phong(0xffc531, 70, 0x886622),
    chrome: phong(0xdfe6ee, 120, 0xffffff),
    metal: phong(0x8c939c, 40, 0x444444),
    seat: phong(0x26262c, 50, 0x555555),
    bill: phong(0xff9a2a, 50, 0x553311),
    white: phong(0xfff6e6, 40, 0x444444),
  };
  return shared;
}

/** a kart for a look: the group, and where the duck sits */
export function kartMesh(look: KartLook): { group: THREE.Group; seatY: number; seatZ: number } {
  const c = styleGeos(look.style);
  const mats = sharedMats();
  const g = new THREE.Group();
  for (const [m, geo] of Object.entries(c.geos) as [Mat, THREE.BufferGeometry][]) {
    const mat =
      m === "paint" ? new THREE.MeshPhongMaterial({ color: look.paint, shininess: 80, specular: 0x666666 })
      : m === "accent" ? new THREE.MeshPhongMaterial({ color: look.accent, shininess: 70, specular: 0x555555 })
      : mats[m]!;
    g.add(new THREE.Mesh(geo, mat));
  }
  return { group: g, seatY: c.seatY, seatZ: c.seatZ };
}

/** the look for a duck: its own kart, or a classic kart in the given colour */
export const lookFor = (char: string, fallback: number): KartLook => LOOKS[char] ?? { style: "classic", paint: fallback, accent: 0xffffff };
