/** Mini-golf maps: 3 courses x 3 holes. Pure data (metres, top-down x/z plane; +z = towards the tee / bottom of
 *  the plan, -z = towards the cup). Used by the physics (golf.ts, server + one-device mode) and by the 3D view. */

export type P = [number, number];

/** A smooth bump (h > 0) or dip (h < 0): h·exp(-(d/r)²). With `ring`, the bump is a ring at that radius
 *  (a volcano rim) and `notch` (radians, 0 = +x, π/2 = +z) cuts a low gap into it. */
export interface Hump { x: number; z: number; r: number; h: number; ring?: number; notch?: number }
/** A ramp that rises by `h` from `a` to `b` (smooth step) and stays up beyond `b`, within `w` either side of the axis. */
export interface Ramp { a: P; b: P; w: number; h: number }
/** A half-pipe that snakes along z: centre x0 + amp·sin(2π(z - z0)/period), height k·(dx)² (at most `max`). */
export interface Valley { z0: number; z1: number; x0: number; amp: number; period: number; k: number; max: number }
/** Round obstacle. `bounce` > 1 = a springy bumper (petri dish) that kicks the ball away. */
export interface Post { x: number; z: number; r: number; kind: string; bounce?: number }
/** Capsule obstacle (a lying glass tube, a log). */
export interface Pipe { a: P; b: P; r: number; kind: string }
/** Solid polygon obstacle. */
export interface Block { pts: P[]; kind: string; h?: number }
/** Walkable plank over water from a to b, `w` either side. */
export interface Bridge { a: P; b: P; w: number }
/** Transport tube: a ball that rolls into the mouth at `a` (radius r) comes out at `b` heading `dir`. */
export interface Tube { a: P; b: P; dir: number; r: number }
/** Decoration only (the view draws it; the ball never touches it). */
export interface Prop { kind: string; x: number; z: number; s?: number; r?: number }

export interface Hole {
  name: string;
  /** one-line idea shown under the hole name */
  tip: string;
  par: number;
  tee: P;
  cup: P;
  /** playable area; a wall on every edge except the `open` ones (sea beyond them) */
  outline: P[];
  /** indexes i of edges outline[i] -> outline[i+1] that have no wall */
  open?: number[];
  water?: P[][];
  sand?: P[][];
  humps?: Hump[];
  ramps?: Ramp[];
  valleys?: Valley[];
  posts?: Post[];
  pipes?: Pipe[];
  blocks?: Block[];
  bridges?: Bridge[];
  tubes?: Tube[];
  props?: Prop[];
}

export type Theme = "island" | "desert" | "lab";
export interface Course { id: string; name: string; theme: Theme; holes: Hole[] }

// ------------------------------------------------------------------ shape helpers (deterministic)
/** wobbly ellipse (organic pond / sand trap) */
function blob(cx: number, cz: number, rx: number, rz: number, wob = 0.08, seed = 1, n = 22, rot = 0): P[] {
  const out: P[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * Math.sin(a * 3 + seed) + wob * 0.6 * Math.sin(a * 5 + seed * 2.3);
    const x = Math.cos(a) * rx * k, z = Math.sin(a) * rz * k;
    out.push([r3(cx + x * c - z * s), r3(cz + x * s + z * c)]);
  }
  return out;
}
/** arc points (angles in radians, 0 = +x, π/2 = +z), from a0 to a1 inclusive */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, n: number): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([r3(cx + Math.cos(a) * r), r3(cz + Math.sin(a) * r)]);
  }
  return out;
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const D = Math.PI / 180;

// ------------------------------------------------------------------ جزيرة البط (tropical island)
const volcano = (() => {
  const cz = -1.6, R = 3.3;
  const a0 = Math.acos(1.2 / R); // where the approach lane meets the round green
  const ring = arc(0, cz, R, a0, -Math.PI - a0, 26);
  const outline: P[] = [[-1.1, 6], [1.1, 6], ...ring];
  // the far side of the green has no wall: overshoot the volcano and you are in the sea
  const open: number[] = [];
  for (let i = 0; i < outline.length - 1; i++) {
    const mz = (outline[i][1] + outline[i + 1][1]) / 2;
    if (mz < cz - R * 0.42) open.push(i);
  }
  return { outline, open };
})();

const ISLAND: Course = {
  id: "island",
  name: "جزيرة البط",
  theme: "island",
  holes: [
    {
      name: "شاطئ البط",
      tip: "إحماء: طريق مفتوح للحفرة",
      par: 2,
      tee: [0, 4.4],
      cup: [0.5, -3.7],
      outline: [[-1.3, 5.2], [1.3, 5.2], [1.5, 1.6], [2.3, -0.6], [2.3, -4], [1.4, -5], [-1.4, -5], [-2.3, -4], [-2.3, -0.6], [-1.5, 1.6]],
      water: [blob(-1.3, -2.3, 0.55, 0.85, 0.07, 2)],
      sand: [blob(1.55, -1.3, 0.42, 0.62, 0.1, 4)],
      humps: [{ x: 1, z: 1.4, r: 0.75, h: 0.09 }],
      posts: [{ x: -0.45, z: -0.6, r: 0.24, kind: "rock" }, { x: 1.35, z: 3.4, r: 0.2, kind: "coco" }],
      props: [
        { kind: "palm", x: -3.5, z: -1.6, s: 1.1, r: 0.4 }, { kind: "palm", x: 3.6, z: -3.4, s: 1.2, r: 2 },
        { kind: "palm", x: -2.5, z: 3.6, s: 0.9, r: 4 }, { kind: "hut", x: 4.6, z: 1.2, r: -1.9 },
        { kind: "rocks", x: -3.2, z: -4.6 }, { kind: "duck", x: -6.5, z: 2.5 }, { kind: "duck", x: 7.5, z: -5 },
        { kind: "boat", x: -7.8, z: -4.5, r: 0.6 }, { kind: "umbrella", x: 3.3, z: 3.6 },
      ],
    },
    {
      name: "الجسر الخشبي",
      tip: "الجسر أقصر طريق… بس لا تطيح بالماي",
      par: 3,
      tee: [-1.6, 5.1],
      cup: [-1.6, -4.6],
      outline: [[-3.2, 6], [3.2, 6], [3.2, -5.2], [2.4, -6], [-2.4, -6], [-3.2, -5.2]],
      water: [[[-3.26, 1.6], [-2.2, 1.8], [-1.2, 1.95], [0.1, 1.55], [0.48, 0.45], [0.32, -0.9], [-0.2, -1.7], [-1.6, -1.95], [-2.5, -1.8], [-3.26, -1.6]]],
      bridges: [{ a: [-1.6, 2.3], b: [-1.6, -2.35], w: 0.3 }],
      humps: [{ x: 1.85, z: -0.1, r: 0.85, h: 0.13 }],
      posts: [{ x: 2.35, z: 2.7, r: 0.22, kind: "coco" }, { x: 0.9, z: -3.3, r: 0.24, kind: "barrel" }],
      sand: [blob(1.9, -4.7, 0.6, 0.38, 0.08, 7)],
      props: [
        { kind: "palm", x: -4, z: 0.2, s: 1.2, r: 1 }, { kind: "palm", x: 4.1, z: -2.5, s: 1.1, r: 3 },
        { kind: "palm", x: -3.9, z: -4.8, s: 0.95, r: 5 }, { kind: "hut", x: 5.4, z: 3.1, r: -2.2 },
        { kind: "rocks", x: 3.9, z: 5.4 }, { kind: "duck", x: -7, z: -2 }, { kind: "boat", x: 7.5, z: -6, r: -0.5 },
        { kind: "duck", x: 6.5, z: 6.5 }, { kind: "umbrella", x: -4.1, z: 4.4 },
      ],
    },
    {
      name: "البركان",
      tip: "اطلع فوق الفوهة… وإذا زودتها تطيح بالبحر",
      par: 2,
      tee: [0, 5.2],
      cup: [0, -2.2],
      outline: volcano.outline,
      open: volcano.open,
      humps: [
        { x: 0, z: -2.2, r: 0.42, h: 0.3, ring: 0.95, notch: Math.PI },
        { x: 0, z: -2.2, r: 0.55, h: -0.05 },
      ],
      posts: [{ x: -1.9, z: 0.1, r: 0.26, kind: "rock" }, { x: 1.95, z: -0.6, r: 0.24, kind: "rock" }, { x: 0.75, z: 2.9, r: 0.2, kind: "coco" }],
      sand: [blob(-1.6, -2.6, 0.45, 0.5, 0.1, 3)],
      props: [
        { kind: "palm", x: -2.4, z: 3.6, s: 1.1, r: 2 }, { kind: "palm", x: 2.5, z: 2.6, s: 1.2, r: 0.5 },
        { kind: "rocks", x: 2.1, z: 4.8 }, { kind: "duck", x: -5, z: -6.8 }, { kind: "duck", x: 4.6, z: -7.2 },
        { kind: "boat", x: 7.8, z: -2.5, r: 1.2 }, { kind: "hut", x: -4.6, z: 4.4, r: 2 },
      ],
    },
  ],
};

// ------------------------------------------------------------------ الصحراء (Kuwait desert)
const DESERT: Course = {
  id: "desert",
  name: "الصحراء",
  theme: "desert",
  holes: [
    {
      name: "الكثبان",
      tip: "الكثبان تميّل الكرة… اقرا الرمل",
      par: 2,
      tee: [0, 4.7],
      cup: [-0.3, -3.9],
      outline: [[-2, 5.5], [2, 5.5], [2.2, -3.8], [1.4, -5], [-1.4, -5], [-2.2, -3.8]],
      humps: [{ x: 0.45, z: 2, r: 0.8, h: 0.2 }, { x: -1, z: 0, r: 0.9, h: 0.22 }, { x: 0.95, z: -1.6, r: 0.8, h: 0.2 }],
      sand: [blob(1.45, 0.4, 0.42, 0.85, 0.1, 1), blob(-1.4, -2.7, 0.4, 0.6, 0.1, 5), blob(0.75, -4.3, 0.5, 0.33, 0.08, 9)],
      posts: [{ x: 1.3, z: 3.7, r: 0.22, kind: "dallah" }],
      props: [
        { kind: "datepalm", x: -3, z: 2.5, s: 1.1 }, { kind: "datepalm", x: 3.2, z: -2, s: 1.25 },
        { kind: "tent", x: -4.6, z: -2.6, r: 0.4 }, { kind: "towers", x: -7.2, z: -2.5, s: 0.8 },
        { kind: "watertowers", x: -10, z: -13, s: 1 }, { kind: "dune", x: 7, z: 4 },
      ],
    },
    {
      name: "الخيمة",
      tip: "ارتد من الجدار المايل وادخل على الحفرة",
      par: 3,
      tee: [1.7, 4.6],
      cup: [-3.7, -2.3],
      outline: [[0.5, 5.4], [2.9, 5.4], [2.9, -2.1], [1.5, -3.6], [-4.6, -3.6], [-4.6, -1], [0.5, -1]],
      sand: [blob(-2.55, -3.05, 0.55, 0.3, 0.06, 2), blob(-2.55, -1.55, 0.55, 0.3, 0.06, 6)],
      humps: [{ x: 1.7, z: 1.3, r: 0.7, h: -0.08 }],
      posts: [{ x: -0.9, z: -1.55, r: 0.22, kind: "dallah" }],
      props: [
        { kind: "tent", x: -1.8, z: 1.5, r: 0.15, s: 1.15 }, { kind: "datepalm", x: 4, z: 0.5, s: 1.2 },
        { kind: "datepalm", x: -5.6, z: -4.6, s: 1 }, { kind: "towers", x: -3.5, z: 4.5, s: 0.75 },
        { kind: "watertowers", x: 9, z: -10, s: 0.9 }, { kind: "dune", x: -7, z: 5 },
      ],
    },
    {
      name: "أبراج الكويت",
      tip: "الأرض مايلة لليسار… والحفرة فوق الهضبة",
      par: 3,
      tee: [0.8, 6.2],
      cup: [-0.6, -5.9],
      outline: [[-1.8, 7], [1.8, 7], [2.2, 2], [2.2, -4.5], [1.6, -7.2], [-1.6, -7.2], [-2.2, -4.5], [-2.2, 2]],
      ramps: [
        { a: [-2.3, 2.7], b: [2.3, 2.7], w: 2.2, h: 0.3 },
        { a: [0, -1.2], b: [0, -2.8], w: 3, h: 0.35 },
      ],
      humps: [{ x: 0.8, z: -0.1, r: 0.6, h: -0.1 }],
      sand: [blob(0.25, -4.85, 0.55, 0.32, 0.07, 3), blob(-1.55, 0.6, 0.38, 0.75, 0.1, 8)],
      posts: [{ x: 1.35, z: -3.7, r: 0.22, kind: "dallah" }],
      props: [
        { kind: "towers", x: -7.5, z: -1.5, s: 0.85 }, { kind: "datepalm", x: -3.3, z: -3, s: 1.2 },
        { kind: "datepalm", x: 3.4, z: 3.2, s: 1 }, { kind: "tent", x: -4.5, z: 4, r: -0.5 },
        { kind: "watertowers", x: -9, z: -11, s: 0.9 }, { kind: "dune", x: 8, z: 5 },
      ],
    },
  ],
};

// ------------------------------------------------------------------ المختبر (bio lab)
const helix = (() => {
  const x0 = 0, amp = 0.85, period = 8, z0 = 7, half = 1.45;
  const cx = (z: number) => x0 + amp * Math.sin((2 * Math.PI * (z - z0)) / period);
  const zs: number[] = [];
  for (let z = 7; z >= -7.01; z -= 0.7) zs.push(r3(z));
  const left = zs.map((z): P => [r3(cx(z) - half), z]);
  const right = zs.map((z): P => [r3(cx(z) + half), z]).reverse();
  return { cx, outline: [...left, ...right] as P[], valley: { z0, z1: -7, x0, amp, period, k: 0.13, max: 0.26 } };
})();

const LAB: Course = {
  id: "lab",
  name: "المختبر",
  theme: "lab",
  holes: [
    {
      name: "طبق بتري",
      tip: "الأطباق ترد الكرة بقوة… استغلها",
      par: 2,
      tee: [0, 4.2],
      cup: [0, -3.8],
      outline: [[-2.4, 5], [2.4, 5], [2.4, -3.6], [1.6, -4.8], [-1.6, -4.8], [-2.4, -3.6]],
      posts: [
        { x: 0, z: 0.5, r: 0.42, kind: "petri", bounce: 1.2 }, { x: -1.25, z: -1.35, r: 0.36, kind: "petri", bounce: 1.2 },
        { x: 1.25, z: -1.35, r: 0.36, kind: "petri", bounce: 1.2 }, { x: 0, z: -2.45, r: 0.28, kind: "petri", bounce: 1.2 },
        { x: -1.45, z: 2.3, r: 0.3, kind: "petri", bounce: 1.2 }, { x: 1.5, z: 2.1, r: 0.3, kind: "petri", bounce: 1.2 },
      ],
      sand: [blob(-1.65, -3.6, 0.38, 0.38, 0.08, 4)],
      props: [
        { kind: "microscope", x: -3.8, z: -2.5, r: 0.5 }, { kind: "flask", x: 3.5, z: -3.2, s: 1 },
        { kind: "beaker", x: 3.4, z: 1.5 }, { kind: "rack", x: -3.5, z: 2.6, r: 1.57 }, { kind: "flask", x: -3.3, z: 5, s: 0.8 },
      ],
    },
    {
      name: "أنابيب الاختبار",
      tip: "الأنبوب الشفاف ينقلك… إذا دخلته",
      par: 3,
      tee: [-1.8, 4.7],
      cup: [1.8, -4.6],
      outline: [[-3, 5.5], [3, 5.5], [3, -5.5], [-3, -5.5]],
      pipes: [
        { a: [-3, 1.8], b: [1.35, 1.8], r: 0.13, kind: "glass" },
        { a: [-1.35, -1.6], b: [3, -1.6], r: 0.13, kind: "glass" },
      ],
      tubes: [{ a: [2.35, 4.75], b: [-2.35, -2.5], dir: -0.5, r: 0.22 }],
      posts: [{ x: 0.1, z: 0.1, r: 0.36, kind: "petri", bounce: 1.2 }],
      sand: [blob(1.85, -3.2, 0.5, 0.28, 0.06, 2)],
      props: [
        { kind: "beaker", x: -3.7, z: -3.6 }, { kind: "flask", x: 3.8, z: 2.4, s: 1.1 }, { kind: "microscope", x: 4, z: -4.5, r: 2.5 },
        { kind: "rack", x: -3.7, z: 0.2, r: 1.57 },
      ],
    },
    {
      name: "اللولب",
      tip: "الممر يلف مثل الـDNA… خل الحواف ترجعك",
      par: 3,
      tee: [r3(helix.cx(6.3)), 6.3],
      cup: [r3(helix.cx(-6.2)), -6.2],
      outline: helix.outline,
      valleys: [helix.valley],
      ramps: [{ a: [r3(helix.cx(-3.6)), -3.6], b: [r3(helix.cx(-4.9)), -4.9], w: 2.2, h: 0.22 }],
      posts: [{ x: r3(helix.cx(0.2) + 0.25), z: 0.2, r: 0.3, kind: "petri", bounce: 1.2 }],
      sand: [blob(r3(helix.cx(2.6) - 0.55), 2.6, 0.38, 0.5, 0.08, 6)],
      props: [
        { kind: "dna", x: -3.4, z: 1, s: 1.1 }, { kind: "microscope", x: 3.6, z: -4, r: 2.2 }, { kind: "flask", x: 3.3, z: 3.5, s: 1.1 },
        { kind: "beaker", x: -3.2, z: -5.5 }, { kind: "rack", x: 3.4, z: -0.6, r: 1.4 },
      ],
    },
  ],
};

export const COURSES: Course[] = [ISLAND, DESERT, LAB];
export const courseOf = (id?: string) => COURSES.find((c) => c.id === id) ?? COURSES[0];
export const D2R = D;
