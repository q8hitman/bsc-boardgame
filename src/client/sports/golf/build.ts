import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BALL_R, CUP_R, heightAt, inPoly, type Hole, type P, type Theme } from "../../../shared/sports/golf";
import { Tex } from "./tex";

// ------------------------------------------------------------------ art direction per course
export interface Look {
  felt: [string, string];
  wall: string;
  wallTex: "wood" | "stone" | "plastic";
  cap: string;
  base: string[];
  sand: [string, string];
  sandRough: number;
  water: [string, string];
  sky: [string, string, string];
  fog: [number, number];
  sun: string;
  sunI: number;
  sunDir: [number, number, number];
  hemi: [string, string, number];
  tee: string;
}

export const LOOKS: Record<Theme, Look> = {
  island: {
    felt: ["#259a3a", "#33ad47"],
    wall: "#c07a3e",
    wallTex: "wood",
    cap: "#fff2d6",
    base: ["#5d8f2e", "#7a5533", "#6a4a2c", "#8a6238", "#5e3f24"],
    sand: ["#f1d595", "#c9a05a"],
    sandRough: 1,
    water: ["#12a9c4", "#075a96"],
    sky: ["#2f9be0", "#8fd4f6", "#e6fbff"],
    fog: [38, 95],
    sun: "#fff0d2",
    sunI: 2.7,
    sunDir: [-5, 9, 4],
    hemi: ["#bfe6ff", "#d9b980", 0.75],
    tee: "#2a7d38",
  },
  desert: {
    felt: ["#3f9433", "#4ea83f"],
    wall: "#e2aa6c",
    wallTex: "stone",
    cap: "#a8472c",
    base: ["#d79c5e", "#c4864c", "#e3b077", "#b8783f", "#cf9455"],
    sand: ["#f3cf8c", "#c99550"],
    sandRough: 1,
    water: ["#4fd2e6", "#1a7fb0"],
    sky: ["#3f8fd6", "#9fd0f0", "#ffe2b0"],
    fog: [40, 110],
    sun: "#ffd7a0",
    sunI: 3,
    sunDir: [6, 7, 5],
    hemi: ["#cfe6ff", "#d9a466", 0.75],
    tee: "#3c7a2b",
  },
  lab: {
    felt: ["#16998a", "#20ac9b"],
    wall: "#f3f5fb",
    wallTex: "plastic",
    cap: "#8f6bff",
    base: ["#e6ebf4", "#d6dce8", "#e6ebf4", "#cfd6e3"],
    sand: ["#d7b9ff", "#a57de8"],
    sandRough: 0.55,
    water: ["#7ff0ff", "#2aa6d8"],
    sky: ["#b9c8dc", "#dbe6f2", "#eef4fa"],
    fog: [30, 70],
    sun: "#ffffff",
    sunI: 2.4,
    sunDir: [-4, 9, 3],
    hemi: ["#eef6ff", "#8c96a8", 0.95],
    tee: "#1d7f72",
  },
};

export const WALL_T = 0.15;

/** the felt mixes towards a per-vertex tint (attribute "tint": rgb + amount), keeping a little of the felt texture */
function feltMat(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 tint;\nvarying vec4 vTint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTint = tint;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vTint;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vTint.rgb * (0.55 + 2.2 * l), vTint.a); }");
  };
  m.customProgramCacheKey = () => "golf-felt";
  return m;
}
export const WALL_H = 0.15;

/** All materials made for a hole, so the hole can be thrown away in one go. */
export class Kit {
  mats = new Set<THREE.Material>();
  texs = new Set<THREE.Texture>();
  waters: { uniforms: { uTime: { value: number } } }[] = [];
  constructor(public tex: Tex, public look: Look, public theme: Theme) {}
  std(p: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.MeshStandardMaterial(p);
    this.mats.add(m);
    return m;
  }
  basic(p: THREE.MeshBasicMaterialParameters) {
    const m = new THREE.MeshBasicMaterial(p);
    this.mats.add(m);
    return m;
  }
  /** glass that still reads without transmission (cheap on phones) */
  glass(tint = "#dff6ff", opacity = 0.28) {
    return this.std({ color: tint, transparent: true, opacity, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
  }
  /** animated water (pond or sea); `shore` = rounded box the sea foams around */
  water(shallow: string, deep: string, shore?: { cx: number; cz: number; hx: number; hz: number }) {
    // scene.environment would mirror the studio lights as white blobs: keep the water fairly rough
    const m = this.std({ color: "#ffffff", roughness: 0.62, metalness: 0, transparent: true, opacity: 0.95 });
    const u = {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(shallow) },
      uDeep: { value: new THREE.Color(deep) },
      uShore: { value: new THREE.Vector4(shore?.cx ?? 0, shore?.cz ?? 0, shore?.hx ?? 0, shore?.hz ?? 0) },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vWPos; uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec4 uShore;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float k = 0.0;
  if (uShore.z > 0.0) {
    vec2 q = abs(p - uShore.xy) / uShore.zw;
    float d = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25); // 1 at the beach line
    k = clamp((d - 1.0) * 1.1, 0.0, 1.0);
  } else {
    k = 0.7;
  }
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, k));
  float w = sin(p.x * 2.3 + uTime * 1.1) * sin(p.y * 2.1 - uTime * 0.9) + 0.6 * sin((p.x + p.y) * 3.7 + uTime * 1.6) + 0.4 * sin((p.x - p.y) * 5.3 - uTime * 1.3);
  float caus = pow(1.0 - abs(sin(w * 1.7)), 14.0);
  col = mix(col, col * 1.6 + 0.02, caus * mix(0.55, 0.3, k));
  if (uShore.z > 0.0) {
    float band = (1.0 - smoothstep(0.0, 0.07, k)) * (0.55 + 0.45 * sin(uTime * 1.6 + p.x * 1.3 + p.y * 0.7));
    col = mix(col, vec3(1.0), clamp(band, 0.0, 1.0) * 0.85);
  }
  diffuseColor.rgb = col;
}`,
        );
    };
    m.customProgramCacheKey = () => "golf-water";
    this.waters.push({ uniforms: u });
    return m;
  }
  dispose() {
    this.mats.forEach((m) => m.dispose());
    this.mats.clear();
    this.texs.forEach((t) => t.dispose());
    this.texs.clear();
  }
}

// ------------------------------------------------------------------ geometry helpers
/** clips a polygon to an axis-aligned square (Sutherland-Hodgman) */
function clipSquare(poly: P[], x0: number, z0: number, x1: number, z1: number): P[] {
  let out = poly;
  const planes: [(p: P) => number, number, number][] = [
    [(p) => p[0] - x0, 0, x0], [(p) => x1 - p[0], 0, x1], [(p) => p[1] - z0, 1, z0], [(p) => z1 - p[1], 1, z1],
  ];
  for (const [f] of planes) {
    const inp = out;
    out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out;
}

/** A surface following the ground, cut exactly to `poly`. uv = world (z, x) * uvScale so stripes run down the hole. */
export function surface(poly: P[], hf: (x: number, z: number) => number, opts: { cell?: number; y?: number; uv?: number; shade?: (x: number, z: number) => number; tint?: (x: number, z: number) => [number, number, number, number] }) {
  const cell = opts.cell ?? 0.25, yOff = opts.y ?? 0, uvs = opts.uv ?? 0.25;
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const [x, z] of poly) {
    bx0 = Math.min(bx0, x); bz0 = Math.min(bz0, z); bx1 = Math.max(bx1, x); bz1 = Math.max(bz1, z);
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], tin: number[] = [];
  const e = 0.02;
  const vert = (x: number, z: number) => {
    const y = hf(x, z);
    const nx = -(hf(x + e, z) - hf(x - e, z)) / (2 * e), nz = -(hf(x, z + e) - hf(x, z - e)) / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    pos.push(x, y + yOff, z);
    nor.push(nx / l, 1 / l, nz / l);
    uv.push(z * uvs, x * uvs);
    if (opts.shade) {
      const s = opts.shade(x, z);
      col.push(s, s, s);
    }
    if (opts.tint) tin.push(...opts.tint(x, z));
  };
  for (let z = Math.floor(bz0 / cell) * cell; z < bz1; z += cell)
    for (let x = Math.floor(bx0 / cell) * cell; x < bx1; x += cell) {
      const piece = clipSquare(poly, x, z, x + cell, z + cell);
      if (piece.length < 3) continue;
      const tris = THREE.ShapeUtils.triangulateShape(piece.map(([a, b]) => new THREE.Vector2(a, b)), []);
      for (const [i, j, k] of tris) {
        const a = piece[i], b = piece[j], c = piece[k];
        const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (Math.abs(cy) < 1e-9) continue;
        const [p, q, r] = cy > 0 ? [a, b, c] : [a, c, b];
        vert(p[0], p[1]);
        vert(q[0], q[1]);
        vert(r[0], r[1]);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (opts.shade) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  if (opts.tint) g.setAttribute("tint", new THREE.Float32BufferAttribute(tin, 4));
  return g;
}

/** quads with flat normals */
class Quads {
  pos: number[] = [];
  uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], ua: number[] = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

function distToSeg(x: number, z: number, a: P, b: P) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** the outward normal of edge a-b of polygon `poly` */
function outward(poly: P[], a: P, b: P): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l, nz = dx / l;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return inPoly(mx + nx * 0.03, mz + nz * 0.03, poly) ? [-nx, -nz] : [nx, nz];
}

const shadowed = <T extends THREE.Object3D>(o: T, cast = true, recv = true) => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = recv;
    }
  });
  return o;
};

export interface BuiltHole {
  group: THREE.Group;
  flag: THREE.Mesh;
  flagBase: Float32Array;
  bumpers: { obj: THREE.Object3D; x: number; z: number; r: number; hit: number }[];
  bubbles: { mesh: THREE.Mesh; curve: THREE.Curve<THREE.Vector3>; off: number }[];
  /** points that must be on screen for an overview */
  frame: THREE.Vector3[];
}

/** Builds the playable hole: floor, walls, base, water, sand, bridges, obstacles, tube, cup + flag. */
export function buildHole(h: Hole, kit: Kit, holeNo: number, makePost: (kind: string, r: number) => THREE.Object3D): BuiltHole {
  const g = new THREE.Group();
  const L = kit.look;
  const hf = (x: number, z: number) => heightAt(h, x, z);
  const n = h.outline.length;
  const walled = (i: number) => !h.open?.includes(i);
  const edges: [P, P][] = [];
  for (let i = 0; i < n; i++) if (walled(i)) edges.push([h.outline[i], h.outline[(i + 1) % n]]);

  // ---- felt floor, a soft contact shade along the walls
  const shade = (x: number, z: number) => {
    let d = 9;
    for (const [a, b] of edges) d = Math.min(d, distToSeg(x, z, a, b));
    for (const p of h.posts ?? []) d = Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r);
    for (const p of h.pipes ?? []) d = Math.min(d, distToSeg(x, z, p.a, p.b) - p.r);
    // contact shade along walls + lighter on crests, darker in hollows so slopes read at a glance
    const y = hf(x, z);
    return (1 - 0.32 * Math.exp(-Math.max(0, d) / 0.11)) * (1 + Math.max(-0.25, Math.min(0.35, y * 1.3)));
  };
  // volcano rims turn rocky brown, dunes golden: the shape of the ground reads at a glance
  const rock = new THREE.Color("#8a4f2c"), dune = new THREE.Color("#b9b04a");
  const tint = (x: number, z: number): [number, number, number, number] => {
    let best = 0, ring = false;
    for (const m of h.humps ?? []) {
      if (m.h <= 0) continue;
      const dd = Math.hypot(x - m.x, z - m.z);
      const q = m.ring ? (dd - m.ring) / m.r : dd / m.r;
      let f = Math.exp(-q * q * 0.8);
      if (m.ring && m.notch !== undefined) {
        let da = Math.atan2(z - m.z, x - m.x) - m.notch;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        f *= 1 - 0.85 * Math.exp(-(da * da) / (0.38 * 0.38));
      }
      if (f > best) {
        best = f;
        ring = !!m.ring;
      }
    }
    const c = ring ? rock : dune;
    return [c.r, c.g, c.b, best * (ring ? 0.82 : 0.5)];
  };
  const felt = kit.tex.felt(L.felt[0], L.felt[1]);
  const floor = new THREE.Mesh(
    surface(h.outline, hf, { cell: 0.22, uv: 0.25, shade, tint }),
    feltMat(kit.std({ map: felt, vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 })),
  );
  floor.receiveShadow = true;
  g.add(floor);

  // ---- walls: a body (wood / sandstone / plastic) with a bright rounded-looking cap, posts on the corners
  const body = new Quads(), cap = new Quads();
  const BOT = -0.55;
  for (let i = 0; i < n; i++) {
    if (!walled(i)) continue;
    const a = h.outline[i], b = h.outline[(i + 1) % n];
    const [nx, nz] = outward(h.outline, a, b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / 0.45));
    let u = 0;
    for (let s = 0; s < k; s++) {
      const p0: P = [a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k];
      const p1: P = [a[0] + ((b[0] - a[0]) * (s + 1)) / k, a[1] + ((b[1] - a[1]) * (s + 1)) / k];
      const y0 = hf(p0[0], p0[1]) + WALL_H, y1 = hf(p1[0], p1[1]) + WALL_H;
      const i0 = [p0[0], y0, p0[1]], i1 = [p1[0], y1, p1[1]];
      const o0 = [p0[0] + nx * WALL_T, y0, p0[1] + nz * WALL_T], o1 = [p1[0] + nx * WALL_T, y1, p1[1] + nz * WALL_T];
      const ib0 = [p0[0], BOT, p0[1]], ib1 = [p1[0], BOT, p1[1]];
      const ob0 = [o0[0], BOT, o0[2]], ob1 = [o1[0], BOT, o1[2]];
      const du = len / k;
      // inner face (towards the ball), outer face
      body.quad(ib0, ib1, i1, i0, [u, 0], [u + du, 0], [u + du, 0.7], [u, 0.7]);
      body.quad(ob1, ob0, o0, o1, [u + du, 0], [u, 0], [u, 0.7], [u + du, 0.7]);
      // cap: slightly proud of the body
      const e = 0.022, ch = 0.045;
      const ci0 = [p0[0] - nx * e, y0, p0[1] - nz * e], ci1 = [p1[0] - nx * e, y1, p1[1] - nz * e];
      const co0 = [p0[0] + nx * (WALL_T + e), y0, p0[1] + nz * (WALL_T + e)], co1 = [p1[0] + nx * (WALL_T + e), y1, p1[1] + nz * (WALL_T + e)];
      const up = (p: number[], d = ch) => [p[0], p[1] + d, p[2]];
      cap.quad(up(ci0), up(ci1), up(co1), up(co0));
      cap.quad(ci0, ci1, up(ci1), up(ci0));
      cap.quad(co1, co0, up(co0), up(co1));
      u += du;
    }
  }
  const wallMap = L.wallTex === "wood" ? kit.tex.wood(L.wall) : L.wallTex === "stone" ? kit.tex.strata(["#e8b679", "#dda266", "#e4ae72", "#d69a5e"]) : null;
  const wallMat = kit.std({ color: wallMap ? "#ffffff" : L.wall, map: wallMap, roughness: L.wallTex === "plastic" ? 0.35 : 0.8, metalness: 0, side: THREE.DoubleSide });
  const capMat = kit.std({ color: L.cap, roughness: L.wallTex === "plastic" ? 0.25 : 0.55, metalness: 0, side: THREE.DoubleSide });
  g.add(shadowed(new THREE.Mesh(body.geo(), wallMat)));
  g.add(shadowed(new THREE.Mesh(cap.geo(), capMat)));
  // corner posts
  const postGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    if (!walled(i) && !walled(prev)) continue;
    const p = h.outline[i];
    const a = h.outline[prev], b = h.outline[(i + 1) % n];
    const n1 = outward(h.outline, a, p), n2 = outward(h.outline, p, b);
    let bx = n1[0] + n2[0], bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const y = hf(p[0], p[1]) + WALL_H + 0.045;
    const r = WALL_T * 0.72;
    const cyl = new THREE.CylinderGeometry(r, r, y - BOT + 0.02, 16);
    cyl.translate(p[0] + bx * WALL_T * 0.5, (y + BOT) / 2 + 0.01, p[1] + bz * WALL_T * 0.5);
    const top = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    top.scale(1, 0.55, 1);
    top.translate(p[0] + bx * WALL_T * 0.5, y + 0.02, p[1] + bz * WALL_T * 0.5);
    postGeos.push(cyl.toNonIndexed(), top.toNonIndexed());
    cyl.dispose();
    top.dispose();
  }
  if (postGeos.length) {
    const merged = mergeGeometries(postGeos);
    postGeos.forEach((x) => x.dispose());
    g.add(shadowed(new THREE.Mesh(merged, capMat)));
  }

  // ---- the base the course stands on (earth / sandstone / plastic tray)
  const side = new Quads();
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = h.outline[i], b = h.outline[(i + 1) % n];
    const [nx, nz] = outward(h.outline, a, b);
    const off = walled(i) ? WALL_T : 0;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / 0.4));
    for (let s = 0; s < k; s++) {
      const p0: P = [a[0] + ((b[0] - a[0]) * s) / k + nx * off, a[1] + ((b[1] - a[1]) * s) / k + nz * off];
      const p1: P = [a[0] + ((b[0] - a[0]) * (s + 1)) / k + nx * off, a[1] + ((b[1] - a[1]) * (s + 1)) / k + nz * off];
      const t0 = walled(i) ? BOT + 0.02 : hf(p0[0] - nx * off, p0[1] - nz * off);
      const t1 = walled(i) ? BOT + 0.02 : hf(p1[0] - nx * off, p1[1] - nz * off);
      const du = len / k / 1.2;
      side.quad([p1[0], -1.1, p1[1]], [p0[0], -1.1, p0[1]], [p0[0], t0, p0[1]], [p1[0], t1, p1[1]], [u + du, 0], [u, 0], [u, 1], [u + du, 1]);
      u += du;
    }
  }
  const sideTex = kit.tex.strata(L.base);
  g.add(shadowed(new THREE.Mesh(side.geo(), kit.std({ map: sideTex, roughness: kit.theme === "lab" ? 0.4 : 0.95, side: THREE.DoubleSide })), false, true));

  // ---- sand / gel
  const sandTex = kit.tex.sand(L.sand[0], L.sand[1]);
  for (const s of h.sand ?? []) {
    const edge = (x: number, z: number) => {
      let d = 9;
      for (let i = 0; i < s.length; i++) d = Math.min(d, distToSeg(x, z, s[i], s[(i + 1) % s.length]));
      return 0.82 + 0.18 * Math.min(1, d / 0.12);
    };
    const m = new THREE.Mesh(
      surface(s, hf, { cell: 0.12, y: 0.006, uv: 0.5, shade: edge }),
      kit.std({ map: sandTex, vertexColors: true, roughness: L.sandRough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: kit.theme === "lab" ? 1.2 : 0.3 }),
    );
    m.receiveShadow = true;
    g.add(m);
    // a soft lip around the bunker
    g.add(rim(s, hf, 0.025, kit.std({ color: kit.theme === "lab" ? "#b896ff" : "#e9c983", roughness: 0.9 }), 0.004));
  }

  // ---- ponds (inside the walls)
  for (const w of h.water ?? []) {
    const clipped = w; // the floor under it is hidden by the water itself
    const m = new THREE.Mesh(surface(clipped, () => 0, { cell: 0.3, y: 0.014, uv: 1 }), kit.water(L.water[0], L.water[1]));
    m.renderOrder = 1;
    g.add(m);
    g.add(rim(w.filter((p) => inPoly(p[0], p[1], h.outline) || true), () => 0, 0.05, kit.std({ color: kit.theme === "island" ? "#e9d6a4" : "#d9c39a", roughness: 0.9 }), 0.012, h.outline));
  }

  // ---- bridges
  const woodMat = kit.std({ map: kit.tex.wood("#b4773f"), roughness: 0.85 });
  for (const br of h.bridges ?? []) {
    const ax = br.b[0] - br.a[0], az = br.b[1] - br.a[1];
    const len = Math.hypot(ax, az);
    const ang = Math.atan2(az, ax);
    const bg = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const k = Math.floor(len / 0.15);
    for (let i = 0; i <= k; i++) {
      const pl = new THREE.BoxGeometry(0.13, 0.04, br.w * 2 + 0.1);
      pl.rotateY(((i * 7) % 5) * 0.012 - 0.024);
      pl.translate(-len / 2 + (i * len) / k, 0.0, 0);
      geos.push(pl);
    }
    for (const sgn of [-1, 1]) {
      const beam = new THREE.BoxGeometry(len + 0.2, 0.06, 0.07);
      beam.translate(0, -0.045, sgn * (br.w + 0.0));
      geos.push(beam);
      for (const e of [-1, 1]) {
        const post = new THREE.CylinderGeometry(0.05, 0.055, 0.5, 8);
        post.translate((e * (len + 0.1)) / 2, -0.15, sgn * (br.w + 0.06));
        geos.push(post);
      }
    }
    const merged = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    geos.forEach((x) => x.dispose());
    const mesh = new THREE.Mesh(merged, woodMat);
    bg.add(mesh);
    bg.position.set((br.a[0] + br.b[0]) / 2, 0.02, (br.a[1] + br.b[1]) / 2);
    bg.rotation.y = -ang;
    g.add(shadowed(bg));
  }

  // ---- posts / bumpers
  const bumpers: BuiltHole["bumpers"] = [];
  for (const p of h.posts ?? []) {
    const o = makePost(p.kind, p.r);
    o.position.set(p.x, hf(p.x, p.z), p.z);
    o.rotation.y = (p.x * 7.1 + p.z * 3.3) % 6.28;
    g.add(shadowed(o));
    if (p.bounce) bumpers.push({ obj: o, x: p.x, z: p.z, r: p.r, hit: -9 });
  }

  // ---- glass tube walls
  for (const p of h.pipes ?? []) {
    const ax = p.b[0] - p.a[0], az = p.b[1] - p.a[1];
    const len = Math.hypot(ax, az);
    const grp = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, len, 24, 1, true), kit.glass("#e8fbff", 0.3));
    glass.rotation.z = Math.PI / 2;
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.62, p.r * 0.62, len - 0.06, 16), kit.std({ color: "#ff6fb5", emissive: "#ff2e8f", emissiveIntensity: 0.35, roughness: 0.2, transparent: true, opacity: 0.85 }));
    liquid.rotation.z = Math.PI / 2;
    liquid.position.y = -p.r * 0.2;
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.12, p.r * 0.12, len * 0.92, 8), kit.basic({ color: "#ffffff", transparent: true, opacity: 0.55 }));
    hl.rotation.z = Math.PI / 2;
    hl.position.set(0, p.r * 0.62, p.r * 0.35);
    grp.add(glass, liquid, hl);
    for (const e of [-1, 1]) {
      const stop = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.12, p.r * 1.12, 0.09, 20), kit.std({ color: "#8f6bff", roughness: 0.4 }));
      stop.rotation.z = Math.PI / 2;
      stop.position.x = (e * len) / 2;
      grp.add(stop);
    }
    // a white cradle under it
    const cr = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, p.r * 1.6), kit.std({ color: "#ffffff", roughness: 0.3 }));
    cr.position.y = -p.r + 0.025;
    grp.add(cr);
    grp.position.set((p.a[0] + p.b[0]) / 2, hf((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2) + p.r, (p.a[1] + p.b[1]) / 2);
    grp.rotation.y = -Math.atan2(az, ax);
    g.add(shadowed(grp));
  }

  // ---- transport tube
  const bubbles: BuiltHole["bubbles"] = [];
  for (const t of h.tubes ?? []) {
    const ya = hf(t.a[0], t.a[1]), yb = hf(t.b[0], t.b[1]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(t.r + 0.02, 0.045, 12, 32), kit.std({ color: "#3ff0d0", emissive: "#19d6b4", emissiveIntensity: 0.9, roughness: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(t.a[0], ya + 0.03, t.a[1]);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(t.r, 32), kit.basic({ color: "#0d2c33" }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(t.a[0], ya + 0.012, t.a[1]);
    g.add(ring, hole);
    // exit mouth facing `dir`
    const dx = Math.cos(t.dir), dz = Math.sin(t.dir);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 24, 1, true), kit.glass("#cffaff", 0.4));
    mouth.rotation.z = Math.PI / 2;
    const mg = new THREE.Group();
    mg.add(mouth);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 10, 28), kit.std({ color: "#3ff0d0", emissive: "#19d6b4", emissiveIntensity: 0.9 }));
    lip.rotation.y = Math.PI / 2;
    lip.position.x = 0.17;
    mg.add(lip);
    mg.position.set(t.b[0] - dx * 0.2, yb + 0.17, t.b[1] - dz * 0.2);
    mg.rotation.y = -t.dir;
    g.add(mg);
    // the glass pipe arcing over the course
    const pts = [
      new THREE.Vector3(t.a[0], ya - 0.1, t.a[1]),
      new THREE.Vector3(t.a[0], ya + 0.9, t.a[1]),
      new THREE.Vector3((t.a[0] * 2 + t.b[0]) / 3 + 1.0, 1.7, (t.a[1] * 2 + t.b[1]) / 3),
      new THREE.Vector3((t.a[0] + t.b[0] * 2) / 3 - 0.4, 1.7, (t.a[1] + t.b[1] * 2) / 3),
      new THREE.Vector3(t.b[0] - dx * 1.1, yb + 0.7, t.b[1] - dz * 1.1),
      new THREE.Vector3(t.b[0] - dx * 0.45, yb + 0.17, t.b[1] - dz * 0.45),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.15, 16, false), kit.glass("#d8fbff", 0.26));
    g.add(pipe);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), kit.std({ color: "#7cfff0", emissive: "#2ff5d6", emissiveIntensity: 1.2 }));
      g.add(b);
      bubbles.push({ mesh: b, curve, off: i / 5 });
    }
  }

  // ---- tee mat
  const [tx, tz] = h.tee;
  const tee = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.03, 32), kit.std({ color: L.tee, roughness: 0.95 }));
  tee.position.set(tx, hf(tx, tz) + 0.012, tz);
  tee.receiveShadow = true;
  g.add(tee);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), kit.std({ color: "#ffd23f", roughness: 0.4 }));
    m.position.set(tx + s * 0.26, hf(tx, tz) + 0.04, tz);
    g.add(shadowed(m));
  }

  // ---- cup + flag
  const [cx, cz] = h.cup;
  const cy = hf(cx, cz);
  const cupG = new THREE.Group();
  cupG.position.set(cx, cy, cz);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R, CUP_R, 0.26, 32, 1, true), kit.std({ color: "#3b3f46", roughness: 0.8, side: THREE.BackSide }));
  inner.position.y = -0.12;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 32), kit.basic({ color: "#15171c" }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -0.24;
  const lipR = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.03, 40), kit.std({ color: "#ffffff", roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3 }));
  lipR.rotation.x = -Math.PI / 2;
  lipR.position.y = 0.008;
  // dark disc that hides the felt over the hole (drawn before the felt via stencil-less trick: slightly above + depth)
  const holeDisc = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 32), kit.basic({ color: "#1b1e24", polygonOffset: true, polygonOffsetFactor: -2 }));
  holeDisc.rotation.x = -Math.PI / 2;
  holeDisc.position.y = 0.006;
  holeDisc.userData.cupDisc = true;
  cupG.add(inner, bottom, lipR, holeDisc);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.15, 10), kit.std({ color: "#ffffff", roughness: 0.3, metalness: 0.2 }));
  pole.position.y = 0.575;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), kit.std({ color: "#ffd23f", roughness: 0.3, metalness: 0.4 }));
  knob.position.y = 1.16;
  const fg = new THREE.PlaneGeometry(0.5, 0.33, 14, 6);
  fg.translate(0.25, 0, 0);
  const flag = new THREE.Mesh(fg, kit.std({ map: kit.tex.flag(String(holeNo).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d])), side: THREE.DoubleSide, roughness: 0.7 }));
  flag.position.set(0, 0.97, 0);
  cupG.add(pole, knob, flag);
  shadowed(cupG);
  holeDisc.castShadow = false;
  g.add(cupG);
  const flagBase = new Float32Array((fg.attributes.position.array as Float32Array).slice());

  const frame: THREE.Vector3[] = h.outline.map(([x, z]) => new THREE.Vector3(x, hf(x, z), z));
  frame.push(new THREE.Vector3(cx, cy + 1.2, cz));
  void BALL_R;
  return { group: g, flag, flagBase, bumpers, bubbles, frame };
}

/** a tube along a closed polygon (pond edge, bunker lip). Points outside `clip` are pulled in. */
function rim(poly: P[], hf: (x: number, z: number) => number, r: number, mat: THREE.Material, y = 0, clip?: P[]) {
  const pts = poly.map(([x, z]) => new THREE.Vector3(x, hf(x, z) + y, z));
  void clip;
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, poly.length * 4, r, 8, true), mat);
  m.scale.y = 0.6;
  m.position.y = y * 0.4;
  m.receiveShadow = true;
  return m;
}
