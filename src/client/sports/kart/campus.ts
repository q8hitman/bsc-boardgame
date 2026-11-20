// SPIKE: «حرم الجامعة» on the real map. Buildings, roads and footpaths of the southern colleges of Sabah Al-Salem
// University City come from OpenStreetMap (tools/kart/osm_campus.py -> maps/campus.json; map data (c) OpenStreetMap
// contributors, ODbL), at 0.7 scale, x = east, z = south. The race goes round the College of Science (north
// building): east along the north road, south down the lane between the College of Science and the College of Life
// Sciences, west along the spine between the two rows of colleges, north up the passage between Engineering and
// Science. (Two lanes are widened a little so karts fit: see tools/kart/osm_campus.py.) The shortcut is the
// college's own north-south galleria, straight through the building under a bridge, with pillars to weave round.
import * as THREE from "three";
import { Track, type TrackDef } from "./track";
import { balloonArch, bannerTex, birds, canvasTex, crowd, flags, greenery, lamps, noiseTex, sky, walkers, type Tick } from "./life";
import MAP from "./maps/campus.json";

type XZ = [number, number];
interface Building {
  pts: XZ[];
  h: number;
  kind: string;
  name: string;
}
const buildings = MAP.buildings as unknown as Building[];
const roads = MAP.roads as unknown as [XZ[], number][];
const footpaths = MAP.paths as unknown as XZ[][];

export const CAMPUS: TrackDef = {
  name: "حرم الجامعة",
  edge: "slow",
  main: {
    width: 5.5,
    pts: [
      [-40, 0, -82], [0, 0, -80], [40, 0, -76], [68, 0, -68], [78, 0, -45], [78, 0, 0], [78, 0, 50], [78, 0, 100],
      [70, 0, 122], [45, 0, 118], [20, 0, 106], [0, 0, 90], [-30, 0, 84], [-60, 0, 82], [-80, 0, 74], [-84.5, 0, 60],
      [-84.5, 0, 0], [-84, 0, -55], [-75, 0, -78],
    ],
  },
  branches: [
    // the galleria straight through the College of Science (indoors: tiled floor, a little slower, pillars)
    { width: 4.2, from: [3, -80], to: [3, 90], pts: [[3, 0, -50], [3, 0, 0], [3, 0, 60]], aiTake: 0.3, rough: true },
  ],
  boosts: [[1, 0.08], [0, 0.3], [0, 0.62]],
};

/** footprints karts can't drive through (buildings, galleria pillars), with their bounding boxes */
export interface Solid {
  pts: XZ[];
  minx: number;
  maxx: number;
  minz: number;
  maxz: number;
}
export const solid = (pts: XZ[]): Solid => ({
  pts,
  minx: Math.min(...pts.map((p) => p[0])),
  maxx: Math.max(...pts.map((p) => p[0])),
  minz: Math.min(...pts.map((p) => p[1])),
  maxz: Math.max(...pts.map((p) => p[1])),
});

/** push a point out of any solid it is in; returns true if it hit one */
export function pushOut(solids: Solid[], k: { x: number; z: number }, margin = 0.9): boolean {
  let hit = false;
  for (const s of solids) {
    if (k.x < s.minx - margin || k.x > s.maxx + margin || k.z < s.minz - margin || k.z > s.maxz + margin) continue;
    // inside (or within the margin of) the polygon?
    let inside = false;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    const P = s.pts;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [ax, az] = P[j];
      const [cx, cz] = P[i];
      if (cz > k.z !== az > k.z && k.x < ((ax - cx) * (k.z - cz)) / (az - cz) + cx) inside = !inside;
      const ex = cx - ax;
      const ez = cz - az;
      const t = Math.max(0, Math.min(1, ((k.x - ax) * ex + (k.z - az) * ez) / (ex * ex + ez * ez || 1)));
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d = (k.x - px) ** 2 + (k.z - pz) ** 2;
      if (d < best) {
        best = d;
        bx = px;
        bz = pz;
      }
    }
    const dist = Math.sqrt(best);
    if (!inside && dist >= margin) continue;
    // out to the edge, plus the margin
    let nx = k.x - bx;
    let nz = k.z - bz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    if (inside) {
      nx = -nx;
      nz = -nz;
    }
    k.x = bx + nx * margin;
    k.z = bz + nz * margin;
    hit = true;
  }
  return hit;
}

export function buildCampus(scene: THREE.Scene, track: Track): { tick: Tick; sun: THREE.DirectionalLight; solids: Solid[] } {
  scene.background = new THREE.Color(0xbfe3f5);
  scene.fog = new THREE.Fog(0xe6dcc4, 200, 620);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0xc9a86a, 1.2));
  const SUN_DIR = new THREE.Vector3(0.55, 0.75, -0.35).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 340 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  sun.userData.dir = SUN_DIR;
  scene.add(sun, sun.target);
  const ticks: Tick[] = [sky(scene, "#4fa6e6", "#eef4f2", SUN_DIR)];
  const flat = new Set<THREE.Object3D>();
  const solids: Solid[] = [];
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const main = track.paths[0];
  const gal = track.paths[1];
  const clear = (x: number, z: number) => {
    const n = track.nearest(x, z, null);
    const p = track.paths[n.path];
    return Math.hypot(p.P[n.i].x - x, p.P[n.i].z - z) - p.width;
  };
  const inBuilding = (x: number, z: number, m = 2) => {
    const k = { x, z };
    return pushOut(solids, k, m);
  };

  // ---------------------------------------------------------------- ground
  const sandTex = noiseTex("#dcc28f", ["#c9ab74", "#e8d3a6", "#bf9f66", "#f0dfba"], 256, [140, 140], (c) => {
    c.strokeStyle = "rgba(170,135,80,0.25)";
    c.lineWidth = 2;
    for (let y = 8; y < 256; y += 22) {
      c.beginPath();
      for (let x = 0; x <= 256; x += 8) c.lineTo(x, y + Math.sin(x / 18 + y) * 4);
      c.stroke();
    }
  });
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: sandTex }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, -0.06, 0);
  scene.add(sand);
  flat.add(sand);
  // the paved plaza round the colleges (from just outside the race line inward)
  const paveTex = noiseTex("#e9e1cf", ["#d8cdb4", "#f6efe0"], 128, [1, 1], (c) => {
    c.strokeStyle = "rgba(160,145,115,0.5)";
    c.lineWidth = 2;
    for (let k = 0; k <= 128; k += 32) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k, 128);
      c.moveTo(0, k);
      c.lineTo(128, k);
      c.stroke();
    }
  });
  paveTex.repeat.set(1 / 6, 1 / 6);
  const plazaShape = new THREE.Shape([new THREE.Vector2(-300, 140), new THREE.Vector2(140, 170), new THREE.Vector2(150, -130), new THREE.Vector2(-300, -140)]);
  const plaza = new THREE.Mesh(new THREE.ShapeGeometry(plazaShape), new THREE.MeshLambertMaterial({ map: paveTex }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = -0.03;
  scene.add(plaza);
  flat.add(plaza);

  // ---------------------------------------------------------------- the real roads and footpaths (drawn, not raced)
  const ribbon = (lines: [XZ[], number][], y: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    for (const [pts, w] of lines)
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / L) * (w / 2);
        const nz = ((bx - ax) / L) * (w / 2);
        const A = [ax + nx, y, az + nz];
        const B = [bx + nx, y, bz + nz];
        const C = [ax - nx, y, az - nz];
        const D = [bx - nx, y, bz - nz];
        pos.push(...A, ...B, ...C, ...B, ...D, ...C);
        uv.push(1, 0, 1, L / 8, 0, 0, 1, L / 8, 0, L / 8, 0, 0);
        // a round cap at each joint so bends don't show cracks
        if (i > 0) {
          for (let k = 0; k < 6; k++) {
            const a0 = (k / 6) * Math.PI * 2;
            const a1 = ((k + 1) / 6) * Math.PI * 2;
            pos.push(ax, y, az, ax + (Math.cos(a0) * w) / 2, y, az + (Math.sin(a0) * w) / 2, ax + (Math.cos(a1) * w) / 2, y, az + (Math.sin(a1) * w) / 2);
            uv.push(0.5, 0, 0.5, 0.1, 0.5, 0.1);
          }
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const asphalt = noiseTex("#55585e", ["#3f4247", "#6a6d73", "#4a4d52", "#777a80"], 128, [1, 1], (c) => {
    c.fillStyle = "rgba(30,30,34,0.18)";
    for (const x of [24, 40, 88, 104]) c.fillRect(x, 0, 6, 128);
  });
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  const realRoads = new THREE.Mesh(ribbon(roads, -0.01), new THREE.MeshLambertMaterial({ map: asphalt, side: THREE.DoubleSide }));
  scene.add(realRoads);
  flat.add(realRoads);
  const foot = new THREE.Mesh(ribbon(footpaths.map((p) => [p, 2.2] as [XZ[], number]), 0.0), new THREE.MeshLambertMaterial({ color: 0xd9ccb0, side: THREE.DoubleSide }));
  scene.add(foot);
  flat.add(foot);

  // ---------------------------------------------------------------- the race roads with Kuwaiti kerbs
  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const road: number[] = [];
  const roadUV: number[] = [];
  const line: number[] = [];
  const kerb: number[] = [];
  const kerbCol: number[] = [];
  track.paths.forEach((p, pi) => {
    const W = p.width;
    const lift = pi ? 0.07 : 0.05;
    const edge = (i: number, off: number, up = lift) => {
      const n = p.normal(i);
      return new THREE.Vector3(p.P[i].x + n.x * off, p.P[i].y + up, p.P[i].z + n.z * off);
    };
    const last = p.closed ? p.n : p.n - 1;
    for (let i = 0; i < last; i++) {
      const j = p.wrap(i + 1);
      quad(road, edge(i, W), edge(j, W), edge(i, -W), edge(j, -W));
      const vi = p.S[i] / 8;
      const vj = (p.S[i] + p.P[i].distanceTo(p.P[j])) / 8;
      roadUV.push(1, vi, 1, vj, 0, vi, 1, vj, 0, vj, 0, vi);
      if (Math.floor(p.S[i] / 6) % 2 === 0) quad(line, edge(i, 0.16, lift + 0.02), edge(j, 0.16, lift + 0.02), edge(i, -0.16, lift + 0.02), edge(j, -0.16, lift + 0.02));
      if (pi) continue; // (the galleria is indoors: no kerbs)
      for (const side of [1, -1]) {
        quad(line, edge(i, side * (W - 0.5), lift + 0.02), edge(j, side * (W - 0.5), lift + 0.02), edge(i, side * (W - 0.8), lift + 0.02), edge(j, side * (W - 0.8), lift + 0.02));
        const e = edge(i, side * (W + 0.3), 0);
        if (track.onRoad(e.x, e.z, p.P[i].y, pi)) continue;
        const a = edge(i, side * W, lift + 0.18);
        const b = edge(j, side * W, lift + 0.18);
        const c = edge(i, side * (W + 0.6), lift + 0.18);
        const d = edge(j, side * (W + 0.6), lift + 0.18);
        quad(kerb, a, b, c, d);
        quad(kerb, edge(i, side * (W + 0.6), 0), edge(j, side * (W + 0.6), 0), c, d);
        const col = Math.floor(p.S[i] / 1.2) % 2 === 0 ? [0.98, 0.8, 0.1] : [0.1, 0.1, 0.12];
        for (let k = 0; k < 12; k++) kerbCol.push(...col);
      }
    }
  });
  const mk = (pos: number[], mat: THREE.Material, col?: number[], uv?: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    flat.add(m);
    return m;
  };
  mk(road, new THREE.MeshLambertMaterial({ map: asphalt, side: THREE.DoubleSide }), undefined, roadUV);
  mk(line, new THREE.MeshBasicMaterial({ color: 0xf5f5f0, side: THREE.DoubleSide }));
  mk(kerb, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), kerbCol);
  const chevron = canvasTex(128, 128, (c) => {
    c.fillStyle = "#ff8a1e";
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = "#fff6c9";
    c.lineWidth = 14;
    for (const y of [30, 70, 110]) {
      c.beginPath();
      c.moveTo(18, y);
      c.lineTo(64, y - 30);
      c.lineTo(110, y);
      c.stroke();
    }
  });
  for (const [pi, f] of track.def.boosts) {
    const p = track.paths[pi];
    const i = Math.round(f * (p.n - 1));
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.5), new THREE.MeshBasicMaterial({ map: chevron }));
    pad.rotation.order = "YXZ";
    pad.rotation.set(-Math.PI / 2, p.heading(i), 0);
    pad.position.set(p.P[i].x, p.P[i].y + 0.12, p.P[i].z);
    scene.add(pad);
  }

  // ---------------------------------------------------------------- the buildings, at their real footprints
  const windowsTex = (wall: string, glass: string, fin?: string) =>
    canvasTex(128, 128, (c) => {
      c.fillStyle = wall;
      c.fillRect(0, 0, 128, 128);
      c.fillStyle = glass;
      for (let y = 10; y < 128; y += 32) c.fillRect(0, y, 128, 16);
      if (fin) {
        c.fillStyle = fin;
        for (let x = 0; x < 128; x += 12) c.fillRect(x, 0, 5, 128);
      }
    });
  const glassDiag = canvasTex(256, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#a8d6e2");
    g.addColorStop(1, "#5e8fa3");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 6;
    for (let k = -256; k <= 512; k += 64) {
      c.beginPath();
      c.moveTo(k, 256);
      c.lineTo(k + 128, 0);
      c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,0.45)";
    c.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(256, y);
      c.stroke();
    }
  });
  const tile = (t: THREE.Texture, w: number, h: number) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / w, 1 / h);
    return t;
  };
  const roof = new THREE.MeshLambertMaterial({ color: 0xd9d6cf });
  const wallMats: Record<string, THREE.Material> = {
    science: new THREE.MeshPhongMaterial({ map: tile(glassDiag, 18, 18), shininess: 90, specular: 0xffffff }),
    engineering: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#c9ccd2", "#6f8fa6"), 10, 9) }),
    life: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#7a4026", "#3b2a22", "#c8703a"), 9, 9) }),
    business: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#e3d3b2", "#7e8c96"), 9, 7) }),
    college: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#ddd2bd", "#7f8f9c"), 9, 7) }),
    admin: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#f2f2ee", "#8fb4c9"), 6, 6) }),
    house: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#e6d6b8", "#8a7d66"), 6, 4) }),
    other: new THREE.MeshLambertMaterial({ map: tile(windowsTex("#d8ccb4", "#8a8f94"), 6, 5) }),
  };
  for (const b of buildings) {
    const shape = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    // a round building: the white dome (likely «اللؤلؤة», the convocation hall)
    const round = b.pts.length >= 12 && b.kind !== "science" && b.kind !== "engineering" && Math.abs(Math.max(...b.pts.map((p) => p[0])) - Math.min(...b.pts.map((p) => p[0])) - (Math.max(...b.pts.map((p) => p[1])) - Math.min(...b.pts.map((p) => p[1])))) < 6;
    if (round) {
      const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length;
      const cz = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
      const r = (Math.max(...b.pts.map((p) => p[0])) - Math.min(...b.pts.map((p) => p[0]))) / 2;
      const ribs = canvasTex(512, 256, (c) => {
        c.fillStyle = "#f7f7f4";
        c.fillRect(0, 0, 512, 256);
        c.fillStyle = "#d6dadf";
        for (let x = 0; x < 512; x += 16) c.fillRect(x, 0, 4, 256);
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 36, 20), new THREE.MeshPhongMaterial({ map: ribs, shininess: 60, specular: 0x666666 }));
      dome.scale.set(1, 0.8, 1);
      dome.position.set(cx, r * 0.55, cz);
      scene.add(dome);
      solids.push(solid(b.pts));
      continue;
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, [roof, wallMats[b.kind] ?? wallMats.other]);
    scene.add(m);
    solids.push(solid(b.pts));
  }
  // the bridge joining the two halves of the College of Science over the galleria
  {
    const parts = buildings.filter((b) => b.kind === "science");
    const zs = parts.flatMap((b) => b.pts.map((p) => p[1]));
    const z0 = Math.min(...zs) + 8;
    const z1 = Math.max(...zs) - 8;
    const h = parts[0]?.h ?? 19;
    // the gap the two halves leave: the galleria runs down its middle
    const GX = (Math.max(...parts[0].pts.map((p) => p[0])) + Math.min(...parts[1].pts.map((p) => p[0]))) / 2;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(16, h * 0.45, z1 - z0), wallMats.science);
    bridge.position.set(GX, h - (h * 0.45) / 2, (z0 + z1) / 2);
    scene.add(bridge);
    // the galleria's ceiling lights
    for (let z = z0 + 4; z < z1; z += 8) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 1), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      l.position.set(GX, h * 0.55 - 0.2, z);
      scene.add(l);
    }
    // pillars to weave round inside the galleria
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0xf0ede6 });
    let k = 0;
    for (let z = z0 + 10; z < z1 - 6; z += 13) {
      const x = GX + (k++ % 2 ? 2.3 : -2.3);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, h * 0.55, 10), pillarMat);
      p.position.set(x, (h * 0.55) / 2, z);
      scene.add(p);
      const c: XZ[] = [];
      for (let a = 0; a < 8; a++) c.push([x + Math.cos((a / 8) * Math.PI * 2) * 0.7, z + Math.sin((a / 8) * Math.PI * 2) * 0.7]);
      solids.push(solid(c));
    }
    // «كلية العلوم» over the galleria's north mouth
    const sign = canvasTex(512, 96, (c) => {
      c.fillStyle = "#2b3a4a";
      c.fillRect(0, 0, 512, 96);
      c.fillStyle = "#ffffff";
      c.font = "bold 52px 'Noto Kufi Arabic', Tahoma, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("كلية العلوم", 256, 52);
    });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: sign }));
    s.position.set(GX, h * 0.55 + 1.6, z0 - 0.3);
    s.rotation.y = Math.PI; // facing north, toward karts coming in
    scene.add(s);
  }

  // ---------------------------------------------------------------- trees, lamps, flags, crowds, walkers, birds
  const frond = new THREE.ConeGeometry(0.5, 4.2, 4);
  frond.scale(1, 1, 0.25);
  frond.translate(0, 2.1, 0);
  const crownPos: number[] = [];
  for (let k = 0; k < 8; k++) {
    const f = frond.clone().toNonIndexed();
    f.rotateZ(1.25);
    f.rotateY((k / 8) * Math.PI * 2);
    crownPos.push(...(f.attributes.position.array as Float32Array));
  }
  const crownGeo = new THREE.BufferGeometry();
  crownGeo.setAttribute("position", new THREE.Float32BufferAttribute(crownPos, 3));
  crownGeo.computeVertexNormals();
  const palmAt: THREE.Vector3[] = [];
  for (let i = 0; i < main.n; i += 16) {
    const n = main.normal(i);
    for (const sd of [1, -1]) {
      const x = main.P[i].x + n.x * sd * (main.width + 3.5);
      const z = main.P[i].z + n.z * sd * (main.width + 3.5);
      if (clear(x, z) < 1.8 || inBuilding(x, z, 2.5)) continue;
      if (gal.P.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 9 ** 2)) continue;
      if (palmAt.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 25)) continue;
      palmAt.push(new THREE.Vector3(x, 0, z));
    }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 8, 7), new THREE.MeshLambertMaterial({ color: 0x9a7448 }), palmAt.length);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f8f2f, side: THREE.DoubleSide }), palmAt.length);
  palmAt.forEach((q, k) => {
    const h = 0.85 + rnd() * 0.35;
    trunk.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(q.x, 4 * h, q.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
    crown.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(q.x, 8 * h, q.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(1, 1, 1)));
  });
  scene.add(trunk, crown);

  const lampSpots: { x: number; z: number; face: number }[] = [];
  for (let i = 10; i < main.n; i += 40) {
    const n = main.normal(i);
    for (const sd of [1, -1]) {
      const x = main.P[i].x + n.x * sd * (main.width + 1.8);
      const z = main.P[i].z + n.z * sd * (main.width + 1.8);
      if (clear(x, z) < 1 || inBuilding(x, z, 1.5)) continue;
      lampSpots.push({ x, z, face: Math.atan2(-n.z * -sd, n.x * -sd) });
    }
  }
  lamps(scene, lampSpots, [bannerTex("نادي العلوم الحيوية", "#1b6b4a", "#ffffff"), bannerTex("سباق البط", "#ff8a1e", "#ffffff"), bannerTex("جامعة الكويت", "#1d3b8f", "#ffffff"), bannerTex("كلية العلوم", "#2b3a4a", "#ffffff")]);

  const n0 = main.normal(0);
  ticks.push(flags(scene, [1, -1].map((sd) => ({ x: main.P[0].x + n0.x * sd * (main.width + 5), z: main.P[0].z + n0.z * sd * (main.width + 5), face: main.heading(0) + Math.PI / 2, h: 12 }))));
  balloonArch(scene, main.P[0], main.heading(0), main.width);

  const bushes: THREE.Vector3[] = [];
  for (let i = 0; i < main.n; i += 7) {
    const n = main.normal(i);
    for (const sd of [1, -1]) {
      const off = main.width + 5 + rnd() * 3;
      const x = main.P[i].x + n.x * sd * off;
      const z = main.P[i].z + n.z * sd * off;
      const nearGal = gal.P.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 10 ** 2);
      if (clear(x, z) > 3 && !nearGal && !inBuilding(x, z, 2) && rnd() < 0.55) bushes.push(new THREE.Vector3(x, 0, z));
    }
  }
  greenery(scene, bushes, bushes.filter((_, k) => k % 6 === 0));

  const crowdSpots: THREE.Vector3[] = [];
  for (let i = main.n - 70; i < main.n + 70; i += 5) {
    const k = main.wrap(i);
    const n = main.normal(k);
    for (const sd of [1, -1])
      for (const off of [3.5, 5]) {
        const x = main.P[k].x + n.x * sd * (main.width + off);
        const z = main.P[k].z + n.z * sd * (main.width + off);
        if (clear(x, z) > 2 && !inBuilding(x, z, 1.5)) crowdSpots.push(new THREE.Vector3(x, 0, z));
      }
  }
  // students waiting at the galleria's two mouths (outside, by the doors)
  for (const i of [6, gal.n - 7]) {
    const n = gal.normal(i);
    for (const sd of [1, -1]) for (const off of [6.5, 8]) crowdSpots.push(new THREE.Vector3(gal.P[i].x + n.x * sd * off, 0, gal.P[i].z + n.z * sd * off));
  }
  ticks.push(crowd(scene, crowdSpots));
  // walkers on the real footpaths
  const routes: [THREE.Vector3, THREE.Vector3][] = [];
  for (const p of footpaths) {
    if (routes.length > 24) break;
    for (let i = 0; i < p.length - 1 && routes.length <= 24; i += 2) {
      const a = new THREE.Vector3(p[i][0], 0.05, p[i][1]);
      const b = new THREE.Vector3(p[i + 1][0], 0.05, p[i + 1][1]);
      if (a.distanceTo(b) < 8 || clear(a.x, a.z) < 2 || clear(b.x, b.z) < 2) continue;
      routes.push([a, b]);
    }
  }
  ticks.push(walkers(scene, routes));
  ticks.push(birds(scene, new THREE.Vector3(-80, 0, 0), 12));

  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (flat.has(o)) {
      m.receiveShadow = true;
      return;
    }
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return { tick: (dt, t, cam) => ticks.forEach((f) => f(dt, t, cam)), sun, solids };
}
