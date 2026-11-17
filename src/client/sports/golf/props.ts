import * as THREE from "three";
import type { Hole, P } from "../../../shared/sports/golf";
import { surface, type Kit } from "./build";

/** Decorations and obstacles, all from primitives with a consistent toy-diorama look. */
type V = THREE.Vector2;
const v2 = (x: number, y: number) => new THREE.Vector2(x, y);
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ obstacles (sized to the physics radius)
export function makePost(kit: Kit, kind: string, r: number): THREE.Object3D {
  const g = new THREE.Group();
  seed = Math.round(r * 1000) + kind.length * 77;
  if (kind === "rock") {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.attributes.position;
    const ph = rnd() * 6;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.13 * Math.sin(x * 3.1 + ph) * Math.cos(z * 2.7 + ph) + 0.07 * Math.sin(y * 5 + x * 2);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();
    const m = mesh(geo, kit.std({ color: kit.theme === "island" ? "#a39a8c" : "#c99a63", roughness: 0.85 }));
    m.scale.set(r * 1.05, r * 0.8, r * 1.05);
    m.position.y = r * 0.35;
    g.add(m);
    const moss = mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, 1.1), kit.std({ color: "#6fae3e", roughness: 1, flatShading: true }));
    moss.scale.set(r * 0.7, r * 0.35, r * 0.6);
    moss.position.set(r * 0.1, r * 0.92, 0);
    void moss;
  } else if (kind === "coco") {
    const mat = kit.std({ color: "#6b4426", roughness: 0.9 });
    const hair = kit.std({ color: "#8a5a32", roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = mesh(new THREE.IcosahedronGeometry(r * 0.5, 2), i === 1 ? hair : mat, Math.cos(a) * r * 0.45, r * 0.45, Math.sin(a) * r * 0.45);
      c.scale.set(1, 0.92, 1.05);
      g.add(c);
    }
    const top = mesh(new THREE.IcosahedronGeometry(r * 0.46, 2), mat, 0, r * 1.05, 0);
    g.add(top);
  } else if (kind === "barrel") {
    const pts: V[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(v2(r * (0.84 + 0.16 * Math.sin(Math.PI * t)), t * r * 2.3));
    }
    const b = mesh(new THREE.LatheGeometry(pts, 20), kit.std({ map: kit.tex.wood("#a8692f"), roughness: 0.8 }));
    g.add(b);
    const band = kit.std({ color: "#3a3a40", metalness: 0.7, roughness: 0.4 });
    for (const t of [0.18, 0.82]) {
      const tor = mesh(new THREE.TorusGeometry(r * (0.84 + 0.16 * Math.sin(Math.PI * t)) + 0.006, 0.014, 6, 24), band, 0, t * r * 2.3, 0);
      tor.rotation.x = Math.PI / 2;
      g.add(tor);
    }
    const lid = mesh(new THREE.CircleGeometry(r * 0.84, 20), kit.std({ map: kit.tex.wood("#8f5a28"), roughness: 0.9 }), 0, r * 2.3 + 0.001, 0);
    lid.rotation.x = -Math.PI / 2;
    g.add(lid);
  } else if (kind === "dallah") {
    g.add(dallah(kit, r / 0.13));
  } else if (kind === "petri") {
    const dish = mesh(new THREE.CylinderGeometry(r, r, 0.09, 40, 1, true), kit.glass("#f2fbff", 0.45), 0, 0.045, 0);
    const agar = mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.05, 40), kit.std({ map: kit.tex.agar(["#ffb3d1", "#ffe08a", "#b8f5c8"][Math.round(r * 100) % 3]), roughness: 0.25, emissive: "#ffffff", emissiveIntensity: 0.08 }), 0, 0.027, 0);
    const ring = mesh(new THREE.TorusGeometry(r, 0.03, 10, 40), kit.std({ color: "#ff5fae", emissive: "#ff2e8f", emissiveIntensity: 0.7, roughness: 0.3 }), 0, 0.09, 0);
    ring.rotation.x = Math.PI / 2;
    ring.name = "ring";
    const base = mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.04, 0.02, 40), kit.std({ color: "#ffffff", roughness: 0.3 }), 0, 0.01, 0);
    g.add(base, agar, dish, ring);
  } else {
    g.add(mesh(new THREE.CylinderGeometry(r, r, 0.3, 16), kit.std({ color: "#999" }), 0, 0.15, 0));
  }
  return g;
}

/** Arabic coffee pot (brass). Height ≈ 0.42·s */
function dallah(kit: Kit, s: number) {
  const g = new THREE.Group();
  const brass = kit.std({ color: "#e0b047", metalness: 0.85, roughness: 0.28, envMapIntensity: 1.4 });
  const prof: [number, number][] = [
    [0, 0], [0.13, 0], [0.135, 0.02], [0.12, 0.05], [0.1, 0.1], [0.085, 0.15], [0.06, 0.2], [0.045, 0.24], [0.05, 0.255],
    [0.07, 0.27], [0.075, 0.29], [0.06, 0.31], [0.045, 0.33], [0.05, 0.345], [0.03, 0.37], [0.012, 0.4], [0.02, 0.41], [0, 0.43],
  ];
  const body = mesh(new THREE.LatheGeometry(prof.map(([x, y]) => v2(x * s, y * s)), 28), brass);
  g.add(body);
  const spout = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08 * s, 0.1 * s, 0), new THREE.Vector3(0.15 * s, 0.2 * s, 0), new THREE.Vector3(0.17 * s, 0.3 * s, 0), new THREE.Vector3(0.24 * s, 0.33 * s, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(spout, 16, 0.016 * s, 8, false), brass));
  const handle = mesh(new THREE.TorusGeometry(0.075 * s, 0.012 * s, 8, 20, Math.PI * 1.1), brass, -0.07 * s, 0.2 * s, 0);
  handle.rotation.z = Math.PI * 0.45;
  g.add(handle);
  return g;
}

// ------------------------------------------------------------------ trees
function palm(kit: Kit, s: number, dates: boolean) {
  const g = new THREE.Group();
  const H = (dates ? 3.0 : 2.7) * s;
  const bend = (dates ? 0.25 : 0.7) * s;
  const segs = 10;
  const barkA = kit.std({ color: dates ? "#7b5b3c" : "#8d6a45", roughness: 0.95, flatShading: true });
  const barkB = kit.std({ color: dates ? "#6a4c30" : "#a88058", roughness: 0.95, flatShading: true });
  const at = (t: number) => new THREE.Vector3(bend * t * t, t * H, 0);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const a = at(t0), b = at(t1);
    const r0 = (0.15 - 0.06 * t0) * s, r1 = (0.15 - 0.06 * t1) * s;
    const geo = new THREE.CylinderGeometry(r1 * 1.08, r0, a.distanceTo(b) * 1.04, 9);
    const m = mesh(geo, i % 2 ? barkA : barkB);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(m);
  }
  const top = at(1);
  const greens = dates ? ["#6e8f37", "#86a744", "#5c7d2e"] : ["#2f9e44", "#45b957", "#268a3a"];
  const n = dates ? 11 : 9;
  for (let i = 0; i < n; i++) {
    const len = (dates ? 1.5 : 1.35) * s * (0.85 + rnd() * 0.3);
    const w = (dates ? 0.26 : 0.4) * s;
    const geo = new THREE.PlaneGeometry(len, w, 12, 2);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k) + len / 2;
      const t = x / len;
      const zz = p.getY(k) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, t) * 1.05))), 0.6);
      const droop = (dates ? 0.55 : 0.75) * t * t * len;
      p.setXYZ(k, x, -droop + Math.abs(zz) * 0.35, zz);
    }
    geo.computeVertexNormals();
    const m = mesh(geo, kit.std({ color: greens[i % greens.length], roughness: 0.75, side: THREE.DoubleSide }));
    m.position.copy(top);
    m.rotation.y = (i / n) * Math.PI * 2 + rnd() * 0.3;
    m.rotation.z = (dates ? 0.5 : 0.35) + rnd() * 0.25 - (i % 3 === 0 ? 0.5 : 0);
    g.add(m);
  }
  const fruit = kit.std({ color: dates ? "#d9822b" : "#6b4426", roughness: 0.6 });
  for (let i = 0; i < (dates ? 5 : 3); i++) {
    const a = (i / (dates ? 5 : 3)) * Math.PI * 2;
    if (dates) {
      const cl = new THREE.Group();
      for (let k = 0; k < 6; k++) cl.add(mesh(new THREE.SphereGeometry(0.035 * s, 6, 5), fruit, (rnd() - 0.5) * 0.1 * s, -k * 0.035 * s, (rnd() - 0.5) * 0.1 * s));
      cl.position.set(top.x + Math.cos(a) * 0.14 * s, top.y - 0.12 * s, Math.sin(a) * 0.14 * s);
      g.add(cl);
    } else g.add(mesh(new THREE.SphereGeometry(0.075 * s, 10, 8), fruit, top.x + Math.cos(a) * 0.1 * s, top.y - 0.1 * s, Math.sin(a) * 0.1 * s));
  }
  return g;
}

// ------------------------------------------------------------------ island bits
function rubberDuck(kit: Kit, s: number) {
  const g = new THREE.Group();
  const yel = kit.std({ color: "#ffd93b", roughness: 0.35 });
  const body = mesh(new THREE.SphereGeometry(0.5 * s, 24, 16), yel, 0, 0.25 * s, 0);
  body.scale.set(1.25, 0.72, 0.95);
  const tail = mesh(new THREE.ConeGeometry(0.18 * s, 0.35 * s, 12), yel, -0.62 * s, 0.42 * s, 0);
  tail.rotation.z = 0.9;
  const head = mesh(new THREE.SphereGeometry(0.3 * s, 20, 14), yel, 0.36 * s, 0.78 * s, 0);
  const beak = mesh(new THREE.SphereGeometry(0.15 * s, 14, 10), kit.std({ color: "#ff8a1f", roughness: 0.4 }), 0.64 * s, 0.72 * s, 0);
  beak.scale.set(1.3, 0.45, 1);
  const eyeM = kit.std({ color: "#1b1230", roughness: 0.2 });
  const e1 = mesh(new THREE.SphereGeometry(0.05 * s, 10, 8), eyeM, 0.56 * s, 0.88 * s, 0.13 * s);
  const e2 = mesh(new THREE.SphereGeometry(0.05 * s, 10, 8), eyeM, 0.56 * s, 0.88 * s, -0.13 * s);
  g.add(body, tail, head, beak, e1, e2);
  g.userData.bob = Math.random() * 6;
  return g;
}

function hut(kit: Kit) {
  const g = new THREE.Group();
  const wood = kit.std({ map: kit.tex.wood("#b57a44"), roughness: 0.85 });
  const walls = mesh(new THREE.BoxGeometry(1.5, 1.0, 1.3), wood, 0, 0.5, 0);
  const roof = mesh(new THREE.ConeGeometry(1.35, 0.95, 4, 1), kit.std({ color: "#e2be6a", roughness: 1, flatShading: true }), 0, 1.45, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.05, 1, 0.95);
  const fringe = mesh(new THREE.CylinderGeometry(1.0, 1.08, 0.14, 4, 1, true), kit.std({ color: "#c99d4a", roughness: 1, side: THREE.DoubleSide }), 0, 1.0, 0);
  fringe.rotation.y = Math.PI / 4;
  fringe.scale.set(1.05, 1, 0.95);
  const door = mesh(new THREE.PlaneGeometry(0.42, 0.7), kit.std({ color: "#4a2d1a" }), 0.76, 0.38, 0);
  door.rotation.y = Math.PI / 2;
  const win = mesh(new THREE.PlaneGeometry(0.34, 0.3), kit.std({ color: "#7fd9ff", emissive: "#2aa6d8", emissiveIntensity: 0.3 }), 0, 0.6, 0.66);
  const sign = mesh(new THREE.BoxGeometry(0.06, 0.24, 0.7), kit.std({ color: "#ffd23f" }), 0.8, 0.86, 0);
  g.add(walls, roof, fringe, door, win, sign);
  return g;
}

function rocks(kit: Kit) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = makePost(kit, "rock", 0.25 + rnd() * 0.3);
    r.position.set((rnd() - 0.5) * 1.1, 0, (rnd() - 0.5) * 0.9);
    g.add(r);
  }
  return g;
}

function boat(kit: Kit) {
  const g = new THREE.Group();
  const hull = mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.std({ color: "#ff5a4a", roughness: 0.5, side: THREE.DoubleSide }));
  hull.scale.set(1.1, 0.42, 0.45);
  const trim = mesh(new THREE.TorusGeometry(1, 0.04, 8, 32), kit.std({ color: "#ffffff", roughness: 0.4 }));
  trim.rotation.x = Math.PI / 2;
  trim.scale.set(1.1, 0.45, 1);
  const seat = mesh(new THREE.BoxGeometry(0.12, 0.05, 0.8), kit.std({ map: kit.tex.wood("#c08850") }), 0, -0.1, 0);
  const oar = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), kit.std({ color: "#c08850" }), 0.2, 0.05, 0.35);
  oar.rotation.z = 1.3;
  g.add(hull, trim, seat, oar);
  g.userData.bob = Math.random() * 6;
  return g;
}

function umbrella(kit: Kit) {
  const g = new THREE.Group();
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const x = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? "#ffffff" : "#ff5a4a";
    x.fillRect(i * 32, 0, 32, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  kit.texs.add(t);
  const top = mesh(new THREE.ConeGeometry(0.95, 0.38, 16, 1, true), kit.std({ map: t, side: THREE.DoubleSide, roughness: 0.7 }), 0, 1.75, 0);
  const pole = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 8), kit.std({ color: "#f5f5f5" }), 0, 0.95, 0);
  pole.rotation.z = 0.08;
  const towel = mesh(new THREE.BoxGeometry(0.6, 0.015, 1.2), kit.std({ color: "#3aa8ff", roughness: 1 }), 0.55, 0.01, 0.2);
  g.add(top, pole, towel);
  return g;
}

// ------------------------------------------------------------------ desert bits
function tent(kit: Kit) {
  const g = new THREE.Group();
  const sadu = kit.std({ map: kit.tex.sadu(), roughness: 0.95, side: THREE.DoubleSide });
  const blk = kit.std({ color: "#2b211d", roughness: 1, side: THREE.DoubleSide });
  // sagging black goat-hair roof over three poles
  const roofG = new THREE.PlaneGeometry(3.2, 2.2, 16, 8);
  const p = roofG.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const ridge = Math.exp(-Math.pow((x % 1.6) / 0.25, 2)) * 0.12;
    p.setZ(i, 1.3 - Math.pow(Math.abs(y) / 1.1, 1.6) * 0.55 + ridge * 0 - Math.cos((x / 1.6) * Math.PI) * 0.06);
  }
  roofG.computeVertexNormals();
  const roof = mesh(roofG, blk);
  roof.rotation.x = -Math.PI / 2;
  g.add(roof);
  // back wall in Sadu weave
  const back = mesh(new THREE.PlaneGeometry(3.2, 0.95), sadu, 0, 0.47, -1.08);
  const side1 = mesh(new THREE.PlaneGeometry(2.2, 0.8), sadu, -1.6, 0.4, 0);
  side1.rotation.y = Math.PI / 2;
  g.add(back, side1);
  const poleM = kit.std({ color: "#8a6a44", roughness: 0.9 });
  for (const x of [-1.5, 0, 1.5]) for (const z of [-1.05, 1.05]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85 + (Math.abs(z) < 2 ? 0 : 0), 6), poleM, x, 0.42, z));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), poleM, 0, 0.67, 0));
  // rug + cushions + coffee
  const rug = mesh(new THREE.BoxGeometry(2.4, 0.02, 1.4), sadu, 0, 0.01, 0.1);
  g.add(rug);
  const cush = kit.std({ color: "#b3202a", roughness: 0.9 });
  for (const x of [-0.9, 0, 0.9]) {
    const c = mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), cush, x, 0.1, -0.8);
    g.add(c);
  }
  const d = dallah(kit, 1.1);
  d.position.set(0.3, 0.02, 0.5);
  g.add(d);
  const cupM = kit.std({ color: "#ffffff", roughness: 0.3 });
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.04, 10), cupM, 0.6 + i * 0.09, 0.04, 0.6));
  return g;
}

function kuwaitTowers(kit: Kit, s: number) {
  const g = new THREE.Group();
  const white = kit.std({ color: "#eef1f5", roughness: 0.35, metalness: 0.2 });
  const seq = kit.std({ map: kit.tex.sequins(), roughness: 0.25, metalness: 0.55, envMapIntensity: 1.4 });
  // main tower
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.55, 18, 20), white, 0, 9, 0));
  g.add(mesh(new THREE.ConeGeometry(0.12, 3.5, 12), white, 0, 19.7, 0));
  const big = mesh(new THREE.SphereGeometry(2.6, 32, 20), seq, 0, 9.5, 0);
  const small = mesh(new THREE.SphereGeometry(1.5, 28, 16), seq, 0, 14.2, 0);
  g.add(big, small);
  // second tower with one sphere
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.4, 13, 16), white, 4.2, 6.5, 1.2));
  g.add(mesh(new THREE.ConeGeometry(0.08, 2.5, 10), white, 4.2, 14.2, 1.2));
  g.add(mesh(new THREE.SphereGeometry(1.7, 28, 16), seq, 4.2, 8.6, 1.2));
  // the thin third spire
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.25, 9, 12), white, -2.8, 4.5, 1.4));
  g.add(mesh(new THREE.ConeGeometry(0.05, 1.6, 8), white, -2.8, 9.8, 1.4));
  g.scale.setScalar(s * 0.55);
  return g;
}

function waterTowers(kit: Kit, s: number) {
  const g = new THREE.Group();
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 128;
  const x = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? "#ffffff" : "#2f8fd8";
    x.fillRect(0, i * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  kit.texs.add(t);
  const striped = kit.std({ map: t, roughness: 0.4, metalness: 0.1 });
  const stem = kit.std({ color: "#f0f2f5", roughness: 0.5 });
  const spots: [number, number, number][] = [[0, 0, 1], [3.2, 1.5, 0.85], [-3, 1.8, 0.9], [1.4, -2.6, 0.8], [-1.6, -2.4, 0.95]];
  for (const [px, pz, k] of spots) {
    const h = 7 * k;
    g.add(mesh(new THREE.CylinderGeometry(0.35 * k, 0.5 * k, h, 14), stem, px, h / 2, pz));
    const top = mesh(new THREE.SphereGeometry(1.5 * k, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), striped, px, h + 0.5 * k, pz);
    top.scale.set(1, 0.75, 1);
    const under = mesh(new THREE.ConeGeometry(1.4 * k, 1.6 * k, 24, 1, true), striped, px, h - 0.15 * k, pz);
    under.rotation.x = Math.PI;
    g.add(top, under);
  }
  g.scale.setScalar(s * 0.5);
  return g;
}

function lantern(kit: Kit) {
  const g = new THREE.Group();
  const brass = kit.std({ color: "#c8952e", metalness: 0.8, roughness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 8), brass, 0, 0.025, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 8), kit.std({ color: "#ffb347", emissive: "#ff9a1f", emissiveIntensity: 1.1, transparent: true, opacity: 0.85 }), 0, 0.19, 0));
  g.add(mesh(new THREE.ConeGeometry(0.15, 0.16, 8), brass, 0, 0.41, 0));
  g.add(mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12), brass, 0, 0.52, 0));
  g.scale.setScalar(1.6);
  return g;
}

// ------------------------------------------------------------------ lab bits
function flask(kit: Kit, s: number, liquid = "#ff5fae") {
  const g = new THREE.Group();
  const prof = (k: number): V[] => [v2(0, 0), v2(0.4 * k, 0), v2(0.42 * k, 0.03), v2(0.38 * k, 0.12), v2(0.13 * k, 0.62), v2(0.1 * k, 0.7), v2(0.1 * k, 0.95), v2(0.12 * k, 0.98)];
  const glass = mesh(new THREE.LatheGeometry(prof(1).map((p) => p.multiplyScalar(s)), 28), kit.glass("#eafcff", 0.3));
  const liq: V[] = [v2(0, 0.01), v2(0.37, 0.01), v2(0.36, 0.12), v2(0.25, 0.36), v2(0, 0.36)].map((p) => p.multiplyScalar(s));
  const lm = mesh(new THREE.LatheGeometry(liq, 24), kit.std({ color: liquid, emissive: liquid, emissiveIntensity: 0.35, roughness: 0.15, transparent: true, opacity: 0.88 }));
  const cork = mesh(new THREE.CylinderGeometry(0.11 * s, 0.09 * s, 0.12 * s, 12), kit.std({ color: "#c8955a", roughness: 0.9 }), 0, 1.0 * s, 0);
  g.add(lm, glass, cork);
  return g;
}

function beaker(kit: Kit, s = 1, liquid = "#4fd2ff") {
  const g = new THREE.Group();
  const glass = mesh(new THREE.CylinderGeometry(0.32 * s, 0.32 * s, 0.75 * s, 28, 1, true), kit.glass("#eafcff", 0.3), 0, 0.375 * s, 0);
  const base = mesh(new THREE.CircleGeometry(0.32 * s, 28), kit.glass("#eafcff", 0.35), 0, 0.005, 0);
  base.rotation.x = -Math.PI / 2;
  const liq = mesh(new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.42 * s, 24), kit.std({ color: liquid, emissive: liquid, emissiveIntensity: 0.3, roughness: 0.15, transparent: true, opacity: 0.85 }), 0, 0.22 * s, 0);
  g.add(liq, glass, base);
  const tick = kit.basic({ color: "#ffffff", transparent: true, opacity: 0.8 });
  for (let i = 0; i < 4; i++) {
    const t = mesh(new THREE.PlaneGeometry(0.1 * s, 0.012 * s), tick, 0, (0.18 + i * 0.13) * s, 0.322 * s);
    g.add(t);
  }
  return g;
}

function microscope(kit: Kit) {
  const g = new THREE.Group();
  const white = kit.std({ color: "#f4f6fb", roughness: 0.35 });
  const dark = kit.std({ color: "#2b2f3a", roughness: 0.4, metalness: 0.4 });
  const chrome = kit.std({ color: "#dfe5ee", roughness: 0.15, metalness: 0.9 });
  g.add(mesh(new THREE.BoxGeometry(1.0, 0.16, 1.3), white, 0, 0.08, 0));
  const arm = mesh(new THREE.TorusGeometry(0.55, 0.12, 10, 24, Math.PI * 0.75), white, -0.25, 0.65, 0);
  arm.rotation.z = -0.2;
  arm.rotation.y = Math.PI / 2;
  g.add(arm);
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.95, 0.3), white, 0, 0.6, -0.45));
  g.add(mesh(new THREE.BoxGeometry(0.75, 0.06, 0.7), dark, 0, 0.62, 0.15));
  const tube = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 16), dark, 0, 1.28, 0.12);
  tube.rotation.x = 0.35;
  g.add(tube);
  const eye = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 14), chrome, 0, 1.72, -0.05);
  eye.rotation.x = 0.35;
  g.add(eye);
  for (let i = 0; i < 3; i++) {
    const ob = mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.22, 10), chrome, -0.08 + i * 0.08, 0.83, 0.3);
    g.add(ob);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), chrome, 0.24, 0.62, -0.45));
  g.scale.setScalar(1.15);
  return g;
}

function rack(kit: Kit) {
  const g = new THREE.Group();
  const wood = kit.std({ color: "#ffffff", roughness: 0.35 });
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.06, 0.4), wood, 0, 0.03, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.05, 0.4), wood, 0, 0.42, 0));
  for (const x of [-0.72, 0.72]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), wood, x, 0.22, 0));
  const cols = ["#ff5fae", "#ffd23f", "#4fd2ff", "#8bd346", "#9b7bff"];
  cols.forEach((c, i) => {
    const x = -0.56 + i * 0.28;
    const tube = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 14, 1, true), kit.glass("#eafcff", 0.32), x, 0.42, 0);
    const liq = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.3 + (i % 3) * 0.1, 12), kit.std({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.2 }), x, 0.2 + (i % 3) * 0.05, 0);
    const bot = mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.std({ color: c, roughness: 0.2 }), x, 0.05, 0);
    g.add(liq, tube, bot);
  });
  return g;
}

function dna(kit: Kit, s: number) {
  const g = new THREE.Group();
  const a = kit.std({ color: "#3aa8ff", roughness: 0.3 });
  const b = kit.std({ color: "#ff5fae", roughness: 0.3 });
  const rung = [kit.std({ color: "#ffd23f", roughness: 0.4 }), kit.std({ color: "#8bd346", roughness: 0.4 })];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const ang = t * Math.PI * 4;
    const y = 0.3 + t * 3.2;
    const p1 = new THREE.Vector3(Math.cos(ang) * 0.5, y, Math.sin(ang) * 0.5);
    const p2 = new THREE.Vector3(-p1.x, y, -p1.z);
    g.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), a, p1.x, p1.y, p1.z));
    g.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), b, p2.x, p2.y, p2.z));
    const r = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), rung[i % 2], 0, y, 0);
    r.rotation.z = Math.PI / 2;
    r.rotation.y = -ang;
    g.add(r);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.22, 24), kit.std({ color: "#2b2f3a", roughness: 0.4, metalness: 0.5 }), 0, 0.11, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.4, 8), kit.std({ color: "#dfe5ee", metalness: 0.9, roughness: 0.2 }), 0, 1.8, 0));
  g.scale.setScalar(s);
  g.userData.spin = 0.25;
  return g;
}

export function makeProp(kit: Kit, p: { kind: string; s?: number; r?: number }): THREE.Object3D | null {
  seed = Math.round(((p.s ?? 1) * 997 + (p.r ?? 0) * 131 + p.kind.length * 17) * 13) || 7;
  const s = p.s ?? 1;
  switch (p.kind) {
    case "palm": return palm(kit, s, false);
    case "datepalm": return palm(kit, s, true);
    case "hut": return hut(kit);
    case "rocks": return rocks(kit);
    case "duck": return rubberDuck(kit, 0.8 * s);
    case "boat": return boat(kit);
    case "umbrella": { const u = umbrella(kit); u.scale.setScalar(0.7); return u; }
    case "tent": return tent(kit);
    case "towers": return kuwaitTowers(kit, s);
    case "watertowers": return waterTowers(kit, s);
    case "lantern": return lantern(kit);
    case "dune": return null;
    case "microscope": return microscope(kit);
    case "flask": return flask(kit, s, ["#ff5fae", "#8bd346", "#ffd23f"][Math.round(s * 10) % 3]);
    case "beaker": return beaker(kit, s);
    case "rack": return rack(kit);
    case "dna": return dna(kit, s);
  }
  return null;
}

// ------------------------------------------------------------------ the world around the course
export interface World {
  group: THREE.Group;
  bobbers: THREE.Object3D[];
  spinners: THREE.Object3D[];
}

function bbox(h: Hole) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of h.outline) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
}

function superellipse(cx: number, cz: number, hx: number, hz: number, n = 64, pw = 4): P[] {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 2 / pw) * hx, cz + Math.sign(s) * Math.pow(Math.abs(s), 2 / pw) * hz]);
  }
  return out;
}

function skyDome(kit: Kit, cols: [string, string, string]) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(cols[0]) }, mid: { value: new THREE.Color(cols[1]) }, hor: { value: new THREE.Color(cols[2]) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.7, h)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}",
  });
  kit.mats.add(mat);
  const m = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

function cloud(kit: Kit) {
  const g = new THREE.Group();
  const m = kit.std({ color: "#ffffff", roughness: 1, emissive: "#ffffff", emissiveIntensity: 0.35, flatShading: false });
  for (let i = 0; i < 5; i++) {
    const s = 1.6 + rnd() * 1.6;
    const p = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), m);
    p.position.set(i * 2 - 4, rnd() * 0.8, rnd() * 1.5);
    p.scale.y = 0.65;
    g.add(p);
  }
  return g;
}

export function buildWorld(kit: Kit, h: Hole): World {
  const g = new THREE.Group();
  const bobbers: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  const b = bbox(h);
  const L = kit.look;
  seed = 4242;
  if (kit.theme !== "lab") g.add(skyDome(kit, L.sky));

  if (kit.theme === "island") {
    const hx = b.hx + 2.6, hz = b.hz + 2.6;
    const sea = new THREE.Mesh(new THREE.CircleGeometry(150, 48), kit.water(L.water[0], L.water[1], { cx: b.cx, cz: b.cz, hx: hx + 0.4, hz: hz + 0.4 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.42;
    sea.receiveShadow = true;
    g.add(sea);
    // the beach the course sits on, sloping into the sea
    const beachPoly = superellipse(b.cx, b.cz, hx + 0.6, hz + 0.6, 72, 4);
    const bh = (x: number, z: number) => {
      const qx = Math.abs(x - b.cx) / (hx + 0.6), qz = Math.abs(z - b.cz) / (hz + 0.6);
      const d = Math.pow(Math.pow(qx, 4) + Math.pow(qz, 4), 0.25);
      return -0.28 - 0.32 * THREE.MathUtils.smoothstep(d, 0.8, 1.0) + 0.04 * Math.sin(x * 1.3) * Math.sin(z * 1.1);
    };
    const beach = new THREE.Mesh(surface(beachPoly, bh, { cell: 0.5, uv: 0.35 }), kit.std({ map: kit.tex.sand("#e9cc8c", "#b98d4c"), roughness: 1 }));
    beach.receiveShadow = true;
    g.add(beach);
    // far islands and clouds
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      const isl = new THREE.Mesh(new THREE.SphereGeometry(6 + rnd() * 5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), kit.std({ color: i % 2 ? "#3f9b4a" : "#4caf50", roughness: 1, flatShading: true }));
      isl.position.set(b.cx + Math.cos(a) * 70, -1.2, b.cz + Math.sin(a) * 70);
      isl.scale.y = 0.35;
      g.add(isl);
    }
    for (let i = 0; i < 7; i++) {
      const c = cloud(kit);
      const a = (i / 7) * Math.PI * 2;
      c.position.set(b.cx + Math.cos(a) * 85, 22 + rnd() * 14, b.cz + Math.sin(a) * 85);
      c.lookAt(b.cx, c.position.y, b.cz);
      g.add(c);
    }
  } else if (kit.theme === "desert") {
    const R = 120;
    const ground: P[] = superellipse(b.cx, b.cz, R, R, 48, 2);
    const dh = (x: number, z: number) => {
      const qx = Math.max(0, Math.abs(x - b.cx) - b.hx - 1.2), qz = Math.max(0, Math.abs(z - b.cz) - b.hz - 1.2);
      const far = Math.min(1, Math.hypot(qx, qz) / 14);
      return -0.5 + far * far * (1.6 + 1.4 * Math.sin(x * 0.11 + 1) * Math.cos(z * 0.09) + 0.8 * Math.sin(x * 0.23 + z * 0.17));
    };
    const sand = new THREE.Mesh(surface(ground, dh, { cell: 2.2, uv: 0.18 }), kit.std({ map: kit.tex.sand("#efc787", "#c8904b"), roughness: 1 }));
    sand.receiveShadow = true;
    g.add(sand);
    // sun glow in the sky
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.tex.glow(), color: "#fff1c9", transparent: true, depthWrite: false, fog: false }));
    kit.mats.add(sun.material);
    sun.position.set(b.cx + 60, 30, b.cz - 110);
    sun.scale.setScalar(40);
    g.add(sun);
    for (let i = 0; i < 4; i++) {
      const c = cloud(kit);
      c.position.set(b.cx - 60 + i * 40, 30 + rnd() * 10, b.cz - 100 - rnd() * 20);
      c.scale.setScalar(0.8);
      g.add(c);
    }
  } else {
    // a big lab bench in a tiled room
    const top = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 7, 0.4, b.hz * 2 + 6), kit.std({ color: "#2e3442", roughness: 0.35, metalness: 0.1 }));
    top.position.set(b.cx, -0.75, b.cz);
    top.receiveShadow = true;
    g.add(top);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 7.1, 0.08, b.hz * 2 + 6.1), kit.std({ color: "#8f6bff", roughness: 0.4 }));
    edge.position.set(b.cx, -0.67, b.cz);
    g.add(edge);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 6.6, 3, b.hz * 2 + 5.6), kit.std({ color: "#eef2f8", roughness: 0.5 }));
    cab.position.set(b.cx, -2.45, b.cz);
    g.add(cab);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), kit.std({ color: "#b7c0cf", roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.9;
    g.add(floor);
    const tiles = kit.tex.tiles("#ffffff", "#c9d3df");
    const wallMat = kit.std({ map: tiles, roughness: 0.3 });
    tiles.repeat.set(30, 8);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(90, 24), wallMat);
    back.position.set(b.cx, 8, b.z0 - 9);
    g.add(back);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(90, 24), wallMat);
      w.position.set(b.cx + sx * 20, 8, b.cz);
      w.rotation.y = -sx * Math.PI / 2;
      g.add(w);
    }
    // a shelf of bottles on the back wall + a glowing window
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(12, 0.15, 0.8), kit.std({ color: "#ffffff", roughness: 0.4 }));
    shelf.position.set(b.cx - 4, 2.6, b.z0 - 8.5);
    g.add(shelf);
    for (let i = 0; i < 7; i++) {
      const f = i % 2 ? flask(kit, 0.9, ["#ff5fae", "#4fd2ff", "#ffd23f", "#8bd346"][i % 4]) : beaker(kit, 0.9, ["#9b7bff", "#ff9a1f", "#4fd2ff"][i % 3]);
      f.position.set(b.cx - 9 + i * 1.6, 2.68, b.z0 - 8.5);
      g.add(f);
    }
    const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), kit.basic({ color: "#dff4ff" }));
    win.position.set(b.cx + 7, 6.5, b.z0 - 8.95);
    g.add(win);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.25, 0.2), kit.std({ color: "#8f6bff" }));
    frame.position.set(b.cx + 7, 6.5, b.z0 - 8.9);
    g.add(frame);
    const frame2 = frame.clone();
    frame2.rotation.z = Math.PI / 2;
    frame2.scale.x = 0.62;
    g.add(frame2);
  }

  for (const p of h.props ?? []) {
    const o = makeProp(kit, p);
    if (!o) continue;
    const onWater = kit.theme === "island" && (p.kind === "duck" || p.kind === "boat");
    const baseY = kit.theme === "island" ? (onWater ? -0.42 : -0.3) : kit.theme === "desert" ? -0.5 : -0.55;
    o.position.set(p.x, baseY, p.z);
    o.rotation.y = p.r ?? 0;
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
    });
    if (o.userData.bob !== undefined) bobbers.push(o);
    if (o.userData.spin) spinners.push(o);
    g.add(o);
  }
  return { group: g, bobbers, spinners };
}
