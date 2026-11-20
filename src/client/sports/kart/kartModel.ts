// SPIKE: the duck kart, a classic open go-kart (tube frame in the driver's colour, fat tyres with big rear wheels,
// black bucket seat, steering column, engine with twin exhausts behind the seat) plus our own touch: an orange
// duck-bill nose. Forward is +z, the floor is y = 0. Merged into one mesh per material (a few draw calls per kart).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Part = { geo: THREE.BufferGeometry; mat: string };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function tube(points: THREE.Vector3[], r: number, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.15);
  return new THREE.TubeGeometry(curve, closed ? 64 : 24, r, 8, closed);
}

/** a tyre: a lathed rounded-box cross-section, axis along x */
function tyre(r: number, w: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const hub = r * 0.55;
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

function cyl(r: number, len: number, seg = 12): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg);
}

function roundedSlab(w: number, h: number, depth: number, rad: number): THREE.BufferGeometry {
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
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

/** the parts, in kart space */
function parts(): Part[] {
  const p: Part[] = [];
  const add = (geo: THREE.BufferGeometry, mat: string) => p.push({ geo, mat });
  const R = 0.075;
  // main frame: a rounded loop, narrow at the nose
  add(tube([v(0, 0.32, 1.45), v(0.42, 0.32, 1.3), v(0.66, 0.32, 0.65), v(0.68, 0.32, -0.6), v(0.56, 0.32, -1.25), v(0, 0.32, -1.32), v(-0.56, 0.32, -1.25), v(-0.68, 0.32, -0.6), v(-0.66, 0.32, 0.65), v(-0.42, 0.32, 1.3)], R, true), "frame");
  // the raised front bumper loop over the nose
  add(tube([v(-0.5, 0.32, 1.22), v(-0.58, 0.44, 1.62), v(-0.3, 0.5, 1.82), v(0.3, 0.5, 1.82), v(0.58, 0.44, 1.62), v(0.5, 0.32, 1.22)], R), "frame");
  // side bumpers between the wheels
  for (const sx of [-1, 1]) {
    add(tube([v(0.62 * sx, 0.32, 0.55), v(1.02 * sx, 0.36, 0.42), v(1.05 * sx, 0.36, -0.2), v(0.66 * sx, 0.32, -0.38)], R), "frame");
    // the upright hoop beside the seat
    add(tube([v(0.6 * sx, 0.32, -0.1), v(0.62 * sx, 0.62, -0.32), v(0.6 * sx, 0.32, -0.62)], R * 0.85), "frame");
  }
  // rear bumper behind the wheels
  add(tube([v(-0.56, 0.32, -1.25), v(-0.95, 0.38, -1.55), v(-0.7, 0.42, -1.78), v(0.7, 0.42, -1.78), v(0.95, 0.38, -1.55), v(0.56, 0.32, -1.25)], R), "frame");
  // floor pan
  add(at(roundedSlab(1.1, 2.4, 0.04, 0.3), 0, 0.3, 0.05, Math.PI / 2), "metal");
  // tyres, hubs and axles: big wide rears, smaller fronts
  for (const [x, z, r, w] of [[-1.02, -0.88, 0.5, 0.56], [1.02, -0.88, 0.5, 0.56], [-0.92, 1.0, 0.38, 0.42], [0.92, 1.0, 0.38, 0.42]]) {
    add(at(tyre(r, w), x, r, z), "tyre");
    add(at(cyl(r * 0.56, w * 0.9, 14), x + Math.sign(x) * 0.03, r, z, 0, 0, Math.PI / 2), "hub");
    add(at(cyl(r * 0.2, w * 0.95, 8), x + Math.sign(x) * 0.06, r, z, 0, 0, Math.PI / 2), "chrome");
  }
  add(at(cyl(0.05, 2.0, 6), 0, 0.5, -0.88, 0, 0, Math.PI / 2), "metal");
  add(at(cyl(0.04, 1.8, 6), 0, 0.38, 1.0, 0, 0, Math.PI / 2), "metal");
  // bucket seat: base and a tall rounded back, leaning back
  add(at(roundedSlab(0.82, 0.62, 0.12, 0.18), 0, 0.42, -0.35, Math.PI / 2), "seat");
  add(at(roundedSlab(0.86, 0.95, 0.12, 0.3), 0, 0.88, -0.74, -0.32), "seat");
  // steering column and wheel
  add(at(cyl(0.035, 0.75, 6), 0, 0.62, 0.62, -0.95), "metal");
  add(at(new THREE.TorusGeometry(0.2, 0.04, 6, 16), 0, 0.88, 0.32, -0.6), "seat");
  // engine block behind the seat and twin chrome exhausts pointing back
  add(at(new THREE.BoxGeometry(0.62, 0.36, 0.34), 0, 0.56, -1.12), "metal");
  add(at(new THREE.BoxGeometry(0.4, 0.14, 0.26), 0, 0.8, -1.12), "metal");
  for (const sx of [-0.2, 0.2]) {
    add(at(cyl(0.085, 0.5, 10), sx, 0.68, -1.42, Math.PI / 2), "chrome");
    add(at(cyl(0.065, 0.02, 10), sx, 0.68, -1.68, Math.PI / 2), "tyre");
  }
  // our touch: an orange duck-bill nose on the front bumper
  const bill = new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  bill.scale(1.35, 0.42, 1);
  add(at(bill, 0, 0.36, 1.58), "bill");
  return p;
}

let shared: { geos: Record<string, THREE.BufferGeometry>; mats: Record<string, THREE.Material> } | null = null;

function base() {
  if (shared) return shared;
  const byMat: Record<string, THREE.BufferGeometry[]> = {};
  for (const { geo, mat } of parts()) {
    const g = (geo.index ? geo.toNonIndexed() : geo);
    g.deleteAttribute("uv");
    (byMat[mat] ??= []).push(g);
  }
  const geos: Record<string, THREE.BufferGeometry> = {};
  for (const [m, list] of Object.entries(byMat)) geos[m] = mergeGeometries(list)!;
  const phong = (color: number, shininess: number, specular = 0x333333) => new THREE.MeshPhongMaterial({ color, shininess, specular });
  shared = {
    geos,
    mats: {
      tyre: phong(0x1d1d22, 8, 0x111111),
      hub: phong(0xffc531, 70, 0x886622),
      chrome: phong(0xdfe6ee, 120, 0xffffff),
      metal: phong(0x8c939c, 40, 0x444444),
      seat: phong(0x26262c, 50, 0x555555),
      bill: phong(0xff9a2a, 50, 0x553311),
    },
  };
  return shared;
}

/** one kart in the driver's colour (the frame); every other part is shared */
export function kartMesh(color: number): THREE.Group {
  const b = base();
  const g = new THREE.Group();
  for (const [m, geo] of Object.entries(b.geos)) {
    const mat = m === "frame" ? new THREE.MeshPhongMaterial({ color, shininess: 80, specular: 0x666666 }) : b.mats[m];
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}
