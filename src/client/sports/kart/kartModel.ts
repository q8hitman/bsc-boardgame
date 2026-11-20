// SPIKE: the duck karts. Every duck has its own kart: a body style, its colours and a touch of its own.
//  - classic: open tube go-kart, big rear tyres, engine and twin exhausts (the default)
//  - bubble:  a round bubble car with white-wall tyres and a big bow on the back (fayzah)
//  - racer:   a low wedge racer with front and rear wings and a racing stripe (tima)
//  - buggy:   a lifted dune buggy, chunky tread tyres, roll cage, spare tyre (ali)
//  - muscle:  a boxy hot-rod with a blower and chrome stacks on the hood, flames down the sides (ahmad)
//  - tub:     a bath tub on wheels: claw feet, a shower pipe, foam bubbles and a little rubber duck on the front
//  - flask:   a lab flask on wheels: a glass bulb of bubbling liquid, a cork and a burner flame behind (science club)
//  - pedalo:  a swan-like duck pedal boat on wheels, with a long neck at the front and a paddle wheel at the back
// Every style drives differently (KartStats): top speed, acceleration, handling, weight, off-road, drift.
// All styles keep the orange duck-bill nose. Forward is +z, the floor is y = 0. Each kart is merged into one mesh
// per material (a few draw calls); geometry is shared between karts of the same style.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type KartStyle = "classic" | "bubble" | "racer" | "buggy" | "muscle" | "tub" | "flask" | "pedalo";
export interface KartLook {
  style: KartStyle;
  paint: number;
  accent: number;
}
/** how a kart drives, each 1..5 */
export interface KartStats {
  speed: number;
  accel: number;
  handling: number;
  weight: number;
  offroad: number;
  /** how fast drift sparks build */
  drift: number;
}
export const STYLES: Record<KartStyle, { name: string; stats: KartStats }> = {
  classic: { name: "كارت كلاسيكي", stats: { speed: 3, accel: 3, handling: 3, weight: 3, offroad: 3, drift: 3 } },
  bubble: { name: "الفقاعة", stats: { speed: 2, accel: 5, handling: 4, weight: 1, offroad: 2, drift: 3 } },
  racer: { name: "الصاروخ", stats: { speed: 5, accel: 2, handling: 3, weight: 2, offroad: 1, drift: 3 } },
  buggy: { name: "بقي البر", stats: { speed: 3, accel: 3, handling: 2, weight: 4, offroad: 5, drift: 2 } },
  muscle: { name: "الهوت رود", stats: { speed: 5, accel: 1, handling: 2, weight: 5, offroad: 2, drift: 5 } },
  tub: { name: "البانيو", stats: { speed: 2, accel: 4, handling: 5, weight: 3, offroad: 3, drift: 4 } },
  flask: { name: "الدورق", stats: { speed: 4, accel: 4, handling: 2, weight: 2, offroad: 2, drift: 4 } },
  pedalo: { name: "قارب البط", stats: { speed: 3, accel: 3, handling: 4, weight: 3, offroad: 4, drift: 2 } },
};
/** each duck's own kart */
export const LOOKS: Record<string, KartLook> = {
  fayzah: { style: "bubble", paint: 0xff7aa8, accent: 0xe8283a },
  tima: { style: "racer", paint: 0x22c4c4, accent: 0xffffff },
  ali: { style: "buggy", paint: 0x7a8a3a, accent: 0xffb21e },
  ahmad: { style: "muscle", paint: 0x2f6cff, accent: 0xff7a1a },
  abdullah: { style: "flask", paint: 0x7ce3ff, accent: 0x2a2f8a },
  motivator: { style: "muscle", paint: 0xffd23f, accent: 0xe8283a },
  camel: { style: "buggy", paint: 0xc8954a, accent: 0x6b3a1e },
  abdulrahman: { style: "racer", paint: 0x1d3b8f, accent: 0xffd23f },
  rawan: { style: "tub", paint: 0xffffff, accent: 0xff7aa8 },
  shouq: { style: "pedalo", paint: 0xffffff, accent: 0xc77dff },
  loujain: { style: "bubble", paint: 0xc77dff, accent: 0xffffff },
  bassam: { style: "classic", paint: 0xe8493d, accent: 0xffffff },
  ruaa: { style: "flask", paint: 0x9dff8a, accent: 0x1e6b3a },
  hora: { style: "pedalo", paint: 0xfff3c4, accent: 0x2f8cff },
  zainab: { style: "tub", paint: 0xbfefff, accent: 0x2f8cff },
  amna: { style: "racer", paint: 0xff3d6e, accent: 0x1b1440 },
  hajar: { style: "bubble", paint: 0x36c26b, accent: 0xffd23f },
  abdullah2: { style: "classic", paint: 0x29c7c7, accent: 0x1b1440 },
  jenan: { style: "pedalo", paint: 0xffc0e0, accent: 0xff3d6e },
  maha: { style: "flask", paint: 0xffb0f0, accent: 0x7a2a8a },
  samiyeh: { style: "tub", paint: 0xfff6e6, accent: 0x36c26b },
  ritaj: { style: "racer", paint: 0xff8a4c, accent: 0xffffff },
  sheikha: { style: "muscle", paint: 0x7a2a8a, accent: 0xffd23f },
  aya: { style: "bubble", paint: 0x8fd8ff, accent: 0xff7aa8 },
  maryam: { style: "buggy", paint: 0xe85a8a, accent: 0xffffff },
  haneen: { style: "classic", paint: 0xffd23f, accent: 0x2f8cff },
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
  if (style === "tub") {
    // a white bath tub (a lathed oval bowl) on four claw feet with small wheels, a shower pipe arching over the back,
    // foam bubbles on the rim and a rubber duck toy on the front
    const bowl = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0.02), new THREE.Vector2(0.95, 0.25), new THREE.Vector2(1.0, 0.7), new THREE.Vector2(1.04, 0.78), new THREE.Vector2(0.95, 0.78)], 24);
    bowl.scale(0.95, 1, 1.65);
    add(at(bowl, 0, 0.42, -0.05), "paint");
    // a gold rim
    const rim = new THREE.TorusGeometry(1, 0.05, 6, 32);
    rim.scale(1.0, 1.72, 1);
    add(at(rim, 0, 1.2, -0.05, Math.PI / 2), "hub");
    for (const [x, z] of [[-0.7, -1.15], [0.7, -1.15], [-0.7, 1.05], [0.7, 1.05]]) {
      add(at(new THREE.ConeGeometry(0.14, 0.4, 6), x * 0.92, 0.55, z * 0.92, Math.PI), "hub");
    }
    wheels(add, [[-0.95, -1.05, 0.34, 0.3], [0.95, -1.05, 0.34, 0.3], [-0.95, 1.05, 0.34, 0.3], [0.95, 1.05, 0.34, 0.3]]);
    // foam bubbles on the rim
    for (const [x, y, z, r] of [[-0.8, 1.25, 0.6, 0.2], [-0.7, 1.32, 0.25, 0.16], [0.82, 1.24, -0.2, 0.22], [0.7, 1.3, 0.5, 0.15], [-0.75, 1.24, -0.9, 0.18], [0.6, 1.26, -1.3, 0.16]]) add(at(new THREE.SphereGeometry(r, 10, 8), x, y, z), "white");
    // the shower pipe and head over the back
    add(tube([v(0.7, 1.2, -1.55), v(0.7, 2.3, -1.6), v(0.3, 2.55, -1.35), v(0.05, 2.35, -1.05)], 0.05), "chrome");
    add(at(cyl(0.16, 0.08, 14), 0.05, 2.3, -1.0, 0.6), "chrome");
    // the rubber duck toy on the front rim
    add(at(new THREE.SphereGeometry(0.22, 12, 10), 0, 1.35, 1.55), "accent");
    add(at(new THREE.SphereGeometry(0.15, 12, 10), 0, 1.62, 1.66), "accent");
    const toyBill = new THREE.ConeGeometry(0.06, 0.16, 8);
    add(at(toyBill, 0, 1.6, 1.82, Math.PI / 2), "bill");
    seat(add, 0.56, -0.25, 0.7);
    wheelAndColumn(add, 1.2, 0.5);
    bill(add, 0.5, 1.62, 1.0);
    return { parts: p, seatY: 0.62, seatZ: -0.3 };
  }
  if (style === "flask") {
    // a lab flask: a low chassis carrying a big glass bulb of glowing liquid with a neck and a cork; the duck sits
    // in front of it; a burner flame behind, test tubes as exhausts
    add(at(roundedSlab(1.4, 3.2, 0.3, 0.4), 0, 0.45, 0, Math.PI / 2), "accent");
    const bulb = new THREE.SphereGeometry(0.85, 20, 14);
    add(at(bulb, 0, 1.25, -0.9), "glass");
    const liquid = new THREE.SphereGeometry(0.78, 20, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    add(at(liquid, 0, 1.25, -0.9), "paint");
    add(at(cyl(0.22, 0.6, 14), 0, 2.25, -0.9), "glass");
    add(at(cyl(0.25, 0.2, 14), 0, 2.6, -0.9), "seat");
    // bubbles rising in the liquid
    for (const [x, y, z, r] of [[0.2, 1.35, -0.4, 0.09], [-0.25, 1.55, -0.55, 0.07], [0.05, 1.75, -0.35, 0.06]]) add(at(new THREE.SphereGeometry(r, 8, 6), x, y, z), "white");
    // the burner and its flame
    add(at(cyl(0.18, 0.3, 10), 0, 0.75, -1.75), "metal");
    add(at(new THREE.ConeGeometry(0.16, 0.45, 10), 0, 1.1, -1.75), "bill");
    // test-tube exhausts
    for (const sx of [-0.55, 0.55]) add(at(cyl(0.1, 0.7, 10), sx, 0.75, -1.6, Math.PI / 2 - 0.3), "glass");
    wheels(add, [[-0.95, -1.0, 0.46, 0.5], [0.95, -1.0, 0.46, 0.5], [-0.9, 1.1, 0.4, 0.42], [0.9, 1.1, 0.4, 0.42]]);
    seat(add, 0.62, 0.35, 0.75);
    wheelAndColumn(add, 1.1, 1.0);
    bill(add, 0.48, 1.72, 1.2);
    return { parts: p, seatY: 0.66, seatZ: 0.3 };
  }
  if (style === "pedalo") {
    // a duck pedal boat on wheels: a rounded hull, a long neck rising at the front with a head and bill,
    // little wings on the sides and a paddle wheel at the back
    const hull = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65);
    hull.scale(1.0, 0.75, 1.75);
    add(at(hull, 0, 0.95, -0.1), "paint");
    add(tube([v(0, 1.0, 1.35), v(0, 1.6, 1.65), v(0, 2.2, 1.55), v(0, 2.45, 1.3)], 0.2), "paint");
    add(at(new THREE.SphereGeometry(0.34, 14, 10), 0, 2.55, 1.35), "paint");
    const beak = new THREE.ConeGeometry(0.14, 0.4, 10);
    add(at(beak, 0, 2.5, 1.75, Math.PI / 2), "bill");
    for (const sx of [-0.18, 0.18]) add(at(new THREE.SphereGeometry(0.06, 8, 6), sx, 2.65, 1.6), "seat");
    for (const sx of [-1, 1]) {
      const wing = new THREE.SphereGeometry(0.5, 12, 8);
      wing.scale(0.25, 0.55, 1.1);
      add(at(wing, sx * 0.98, 1.15, -0.3, 0.25, 0, sx * 0.3), "accent");
    }
    // the paddle wheel
    add(at(cyl(0.45, 0.7, 12), 0, 0.85, -1.85, 0, 0, Math.PI / 2), "accent");
    for (let k = 0; k < 6; k++) add(at(new THREE.BoxGeometry(0.72, 0.08, 0.55), 0, 0.85 + Math.cos((k / 6) * Math.PI * 2) * 0.4, -1.85 + Math.sin((k / 6) * Math.PI * 2) * 0.4, (k / 6) * Math.PI * 2), "white");
    wheels(add, [[-0.95, -0.95, 0.38, 0.36], [0.95, -0.95, 0.38, 0.36], [-0.9, 0.95, 0.36, 0.34], [0.9, 0.95, 0.36, 0.34]], { white: true });
    seat(add, 0.66, -0.35, 0.75);
    wheelAndColumn(add, 1.12, 0.45);
    return { parts: p, seatY: 0.7, seatZ: -0.4 };
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
    glass: new THREE.MeshPhongMaterial({ color: 0xd8f6ff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
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
/** the stats of a duck's kart */
export const statsFor = (look: KartLook): KartStats => STYLES[look.style].stats;
