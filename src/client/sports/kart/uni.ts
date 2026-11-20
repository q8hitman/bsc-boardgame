// SPIKE: «حرم الجامعة» - after Sabah Al-Salem University City (Shadadiya), from photos and sources
// (docs/superpowers/specs/2026-11-20-kart-places-research.md). Day, desert sand with planted lawns and palm rows,
// Kuwait's yellow-and-black kerbs. Landmarks: the gate «جامعة الكويت ترحب بكم», the palm boulevard running up to
// «اللؤلؤة» (the white ribbed sphere of the convocation hall) with the white administration tower beside it, the
// central library (a white cube with a diamond lattice), the mosque (a dome in a lattice screen), the College of
// Science (angular glass blocks with diagonal frames, the brown-finned chemistry block) and its covered «جاليريا»,
// and the car parks under white tension shades. Two shortcuts: through the Galleria, and across the car park;
// and the sand beside the road can be cut across (slower, unless you are boosted or in a buggy).
import * as THREE from "three";
import { Track, type TrackDef } from "./track";

export const UNI: TrackDef = {
  name: "حرم الجامعة",
  edge: "slow",
  main: {
    width: 7.5,
    pts: [
      [0, 0, 0], [0, 0, 60], [0, 0, 115], [18, 0, 142], [34, 0, 170], [26, 0, 200], [2, 0, 214], [-35, 0, 222],
      [-85, 0, 214], [-125, 0, 190], [-165, 0, 148], [-180, 0, 95], [-168, 0, 48], [-140, 0, 10], [-100, 0, -45],
      [-55, 2.6, -62], [-15, 0, -40],
    ],
  },
  branches: [
    // «الجاليريا»: straight through the College of Science under a long roof
    { width: 4.6, from: [-125, 190], to: [-140, 10], pts: [[-131, 0, 140], [-136, 0, 92], [-139, 0, 48]], aiTake: 0.35 },
    // across the car park under the shades
    { width: 5, from: [-140, 10], to: [-15, -40], pts: [[-100, 0, -8], [-60, 0, -20]], aiTake: 0.3 },
  ],
  boosts: [[1, 0.1], [2, 0.16], [0, 0.42]],
};

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildUni(scene: THREE.Scene, track: Track) {
  scene.background = new THREE.Color(0xa9dcf5);
  scene.fog = new THREE.Fog(0xe9dfc8, 160, 460);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0xd9bf8a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(80, 140, -40);
  scene.add(sun);

  let seed = 21;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const main = track.paths[0];
  /** how far (x, z) is from the nearest road's edge (negative = on a road) */
  const clear = (x: number, z: number) => {
    const n = track.nearest(x, z, null);
    const p = track.paths[n.path];
    return Math.hypot(p.P[n.i].x - x, p.P[n.i].z - z) - p.width;
  };

  // ---------------------------------------------------------------- the ground: sand, lawns, paving round the plaza
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ color: 0xdcc28f }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-60, -0.05, 90);
  scene.add(sand);
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(150, 140), new THREE.MeshLambertMaterial({ color: 0xece3cf }));
  paving.rotation.x = -Math.PI / 2;
  paving.position.set(-20, -0.03, 165);
  scene.add(paving);
  // lawns in a grid either side of the boulevard and round the plaza (gaps between them are paths)
  const lawnSpots: THREE.Matrix4[] = [];
  for (let x = -90; x <= 70; x += 16)
    for (let z = -20; z <= 240; z += 16) {
      const cx = x + 7;
      const cz = z + 7;
      if (clear(cx, cz) < 6) continue;
      if (Math.hypot(cx, cz - 172) < 30) continue; // the Pearl's podium
      lawnSpots.push(new THREE.Matrix4().makeTranslation(cx, 0.02, cz));
    }
  const lawn = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 0.1, 13), new THREE.MeshLambertMaterial({ color: 0x6fae3e }), lawnSpots.length);
  lawnSpots.forEach((m, k) => lawn.setMatrixAt(k, m));
  scene.add(lawn);

  // ---------------------------------------------------------------- roads with Kuwaiti kerbs
  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const road: number[] = [];
  const line: number[] = [];
  const kerb: number[] = [];
  const kerbCol: number[] = [];
  const shoulder: number[] = [];
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
      // the slope down to the sand under raised road
      if (p.P[i].y > 0.3) for (const sd of [1, -1]) quad(shoulder, edge(i, sd * W, 0), edge(j, sd * W, 0), edge(i, sd * (W + p.P[i].y * 3), -p.P[i].y), edge(j, sd * (W + p.P[j].y * 3), -p.P[j].y));
      if (Math.floor(p.S[i] / 6) % 2 === 0) quad(line, edge(i, 0.16, lift + 0.02), edge(j, 0.16, lift + 0.02), edge(i, -0.16, lift + 0.02), edge(j, -0.16, lift + 0.02));
      for (const side of [1, -1]) {
        quad(line, edge(i, side * (W - 0.5), lift + 0.02), edge(j, side * (W - 0.5), lift + 0.02), edge(i, side * (W - 0.8), lift + 0.02), edge(j, side * (W - 0.8), lift + 0.02));
        // yellow and black kerb blocks, a little raised (open where another road joins)
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
  const mk = (pos: number[], mat: THREE.Material, col?: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    return m;
  };
  mk(road, new THREE.MeshLambertMaterial({ color: 0x55585e, side: THREE.DoubleSide }));
  mk(line, new THREE.MeshBasicMaterial({ color: 0xf5f5f0, side: THREE.DoubleSide }));
  mk(kerb, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), kerbCol);
  mk(shoulder, new THREE.MeshLambertMaterial({ color: 0xcfb27a, side: THREE.DoubleSide }));

  // boost pads
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

  // ---------------------------------------------------------------- palms: rows along the roads, two rows on the boulevard
  const frond = new THREE.ConeGeometry(0.5, 4.2, 4);
  frond.scale(1, 1, 0.25);
  frond.translate(0, 2.1, 0);
  const crownParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const f = frond.clone();
    f.rotateZ(1.25);
    f.rotateY((k / 8) * Math.PI * 2);
    crownParts.push(f.index ? f.toNonIndexed() : f);
  }
  const crownGeo = new THREE.BufferGeometry();
  {
    const all = crownParts.map((g) => g.attributes.position.array as Float32Array);
    const pos = new Float32Array(all.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of all) {
      pos.set(a, o);
      o += a.length;
    }
    crownGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    crownGeo.computeVertexNormals();
  }
  const palmAt: THREE.Vector3[] = [];
  const addPalm = (x: number, z: number) => {
    if (clear(x, z) < 1.8) return;
    if (palmAt.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 25)) return;
    palmAt.push(new THREE.Vector3(x, 0, z));
  };
  for (let i = 0; i < main.n; i += 20) {
    const n = main.normal(i);
    for (const sd of [1, -1]) addPalm(main.P[i].x + n.x * sd * (main.width + 4), main.P[i].z + n.z * sd * (main.width + 4));
    if (main.P[i].z < 112 && Math.abs(main.P[i].x) < 3) for (const sd of [1, -1]) addPalm(main.P[i].x + n.x * sd * (main.width + 10), main.P[i].z + n.z * sd * (main.width + 10));
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 8, 7), new THREE.MeshLambertMaterial({ color: 0x9a7448 }), palmAt.length);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f8f2f, side: THREE.DoubleSide }), palmAt.length);
  palmAt.forEach((q, k) => {
    const h = 0.85 + rnd() * 0.35;
    trunk.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(q.x, 4 * h, q.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
    crown.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(q.x, 8 * h, q.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(1, 1, 1)));
  });
  scene.add(trunk, crown);

  // ---------------------------------------------------------------- landmarks
  // «اللؤلؤة»: the convocation hall, a white ribbed sphere on a podium at the end of the boulevard
  const ribs = canvasTex(512, 256, (c) => {
    c.fillStyle = "#f7f7f4";
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = "#d6dadf";
    for (let x = 0; x < 512; x += 16) c.fillRect(x, 0, 4, 256);
    c.fillStyle = "#e4e7ea";
    for (let y = 0; y < 256; y += 32) c.fillRect(0, y, 512, 2);
  });
  const pearl = new THREE.Mesh(new THREE.SphereGeometry(20, 40, 24), new THREE.MeshPhongMaterial({ map: ribs, shininess: 60, specular: 0x666666 }));
  pearl.scale.set(1, 0.84, 1.1);
  pearl.position.set(0, 15, 172);
  scene.add(pearl);
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(24, 25, 2.4, 40), new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }));
  podium.position.set(0, 1.2, 172);
  scene.add(podium);

  // the administration tower: a tall white block with a square grid facade
  const grid = canvasTex(128, 256, (c) => {
    c.fillStyle = "#f2f2ee";
    c.fillRect(0, 0, 128, 256);
    c.fillStyle = "#8fb4c9";
    for (let y = 6; y < 256; y += 16) for (let x = 6; x < 128; x += 16) c.fillRect(x, y, 10, 10);
  });
  grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
  grid.repeat.set(2, 4);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(20, 62, 18), new THREE.MeshLambertMaterial({ map: grid }));
  tower.position.set(-34, 31, 160);
  scene.add(tower);

  // the central library: a white cube wrapped in a diamond lattice
  const lattice = canvasTex(256, 256, (c) => {
    c.fillStyle = "#3c4148";
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "#f6f4ee";
    c.lineWidth = 14;
    for (let k = -256; k <= 512; k += 64) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k + 256, 256);
      c.stroke();
      c.beginPath();
      c.moveTo(k, 256);
      c.lineTo(k + 256, 0);
      c.stroke();
    }
  });
  lattice.wrapS = lattice.wrapT = THREE.RepeatWrapping;
  lattice.repeat.set(2, 2);
  const library = new THREE.Mesh(new THREE.BoxGeometry(36, 38, 36), new THREE.MeshLambertMaterial({ map: lattice }));
  library.position.set(-66, 19, 262);
  scene.add(library);

  // the mosque: a dome in a lattice screen on a square base, and a slim minaret
  const mosque = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 30), new THREE.MeshLambertMaterial({ color: 0xece5d5 }));
  base.position.y = 5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ map: lattice }));
  dome.position.y = 10;
  const minaret = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 34, 10), new THREE.MeshLambertMaterial({ color: 0xf1ebdc }));
  minaret.position.set(17, 17, 17);
  mosque.add(base, dome, minaret);
  mosque.position.set(78, 0, 140);
  scene.add(mosque);

  // the College of Science: angular glass blocks with diagonal frames either side of the Galleria, and the
  // chemistry block with brown vertical fins
  const glassTex = canvasTex(256, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#9fd0dc");
    g.addColorStop(1, "#5e8fa3");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "rgba(255,255,255,0.85)";
    c.lineWidth = 5;
    for (let k = -256; k <= 512; k += 64) {
      c.beginPath();
      c.moveTo(k, 256);
      c.lineTo(k + 128, 0);
      c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,0.5)";
    c.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(256, y);
      c.stroke();
    }
  });
  glassTex.wrapS = glassTex.wrapT = THREE.RepeatWrapping;
  glassTex.repeat.set(3, 2);
  const glassMat = new THREE.MeshPhongMaterial({ map: glassTex, shininess: 90, specular: 0xffffff });
  const fins = canvasTex(128, 128, (c) => {
    c.fillStyle = "#6b3a22";
    c.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 10) {
      c.fillStyle = x % 20 ? "#c46a35" : "#d9824a";
      c.fillRect(x, 0, 6, 128);
    }
  });
  fins.wrapS = fins.wrapT = THREE.RepeatWrapping;
  fins.repeat.set(6, 3);
  /** a block whose top leans out at the ends (the faceted, angled look) */
  const angled = (w: number, h: number, d: number, lean: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) if (pos.getY(k) > 0) pos.setZ(k, pos.getZ(k) * (1 + lean));
    g.computeVertexNormals();
    return g;
  };
  const gal = track.paths[1];
  const college: [number, number, number, number, number, THREE.Material][] = [];
  for (const f of [0.22, 0.5, 0.78]) {
    const i = Math.round(f * (gal.n - 1));
    const n = gal.normal(i);
    for (const sd of [1, -1]) {
      const off = gal.width + 16;
      college.push([gal.P[i].x + n.x * sd * off, gal.P[i].z + n.z * sd * off, gal.heading(i), 26, f === 0.5 && sd < 0 ? -1 : 1, f === 0.5 && sd < 0 ? new THREE.MeshLambertMaterial({ map: fins }) : glassMat]);
    }
  }
  for (const [x, z, hd, h, , mat] of college) {
    if (clear(x, z) < 9) continue;
    const b = new THREE.Mesh(angled(18, h, 34, 0.18), mat);
    b.position.set(x, h / 2, z);
    b.rotation.y = hd;
    scene.add(b);
  }
  // the Galleria's roof: white portal frames and a long translucent roof over the shortcut
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f0 });
  const roof: number[] = [];
  for (let i = 0; i < gal.n - 1; i++) {
    const n = gal.normal(i);
    const m = gal.normal(i + 1);
    const W = gal.width + 0.6;
    const y0 = gal.P[i].y + 7;
    const a = new THREE.Vector3(gal.P[i].x + n.x * W, y0, gal.P[i].z + n.z * W);
    const b = new THREE.Vector3(gal.P[i + 1].x + m.x * W, y0, gal.P[i + 1].z + m.z * W);
    const c = new THREE.Vector3(gal.P[i].x - n.x * W, y0, gal.P[i].z - n.z * W);
    const d = new THREE.Vector3(gal.P[i + 1].x - m.x * W, y0, gal.P[i + 1].z - m.z * W);
    if (i > 14 && i < gal.n - 14) quad(roof, a, b, c, d);
    if (i > 14 && i < gal.n - 14 && i % 10 === 0) {
      for (const sd of [1, -1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), frameMat);
        post.position.set(gal.P[i].x + n.x * sd * W, 3.5, gal.P[i].z + n.z * sd * W);
        scene.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.5, 0.5, 0.5), frameMat);
      beam.position.set(gal.P[i].x, 7, gal.P[i].z);
      beam.rotation.y = gal.heading(i) + Math.PI / 2;
      scene.add(beam);
    }
  }
  mk(roof, new THREE.MeshPhongMaterial({ color: 0xcfe9f2, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));

  // signs
  const sign = (text: string, w: number, h: number, bg: string, fg: string, font: number) =>
    canvasTex(Math.round(w * 40), Math.round(h * 40), (c) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.fillStyle = fg;
      c.font = `bold ${font}px 'Noto Kufi Arabic', Tahoma, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, c.canvas.width / 2, c.canvas.height / 2 + 4);
    });
  /** a plane facing karts that come along heading `hd` (readable as they approach) */
  const board = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, hd: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = hd + Math.PI;
    scene.add(m);
    return m;
  };
  // «كلية العلوم» stone sign at the Galleria's mouth
  {
    const i = 20;
    const n = gal.normal(i);
    const x = gal.P[i].x + n.x * (gal.width + 4);
    const z = gal.P[i].z + n.z * (gal.width + 4);
    const stone = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 1.2), new THREE.MeshLambertMaterial({ color: 0x8c8f93 }));
    stone.position.set(x, 1.3, z);
    stone.rotation.y = gal.heading(i);
    scene.add(stone);
    const t = board(sign("كلية العلوم", 7, 2.4, "#8c8f93", "#ffffff", 46), 6.6, 2.3, x - Math.sin(gal.heading(i)) * 0.62, 1.3, z - Math.cos(gal.heading(i)) * 0.62, gal.heading(i));
    void t;
  }
  board(sign("نادي العلوم الحيوية", 20, 3, "#1b6b4a", "#ffffff", 64), 20, 3, college[0][0], 22, college[0][1], gal.heading(Math.round(0.22 * (gal.n - 1))));

  // the start gate: a beige arch with «جامعة الكويت ترحب بكم»
  const gate = new THREE.Group();
  const beige = new THREE.MeshLambertMaterial({ color: 0xd8c39a });
  for (const sd of [1, -1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 11, 2.6), beige);
    pillar.position.set(sd * (main.width + 2), 5.5, 0);
    gate.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(main.width * 2 + 7, 3.2, 2.4), beige);
  lintel.position.set(0, 12, 0);
  gate.add(lintel);
  const welcome = new THREE.Mesh(new THREE.PlaneGeometry(main.width * 2 + 5, 2.6), new THREE.MeshLambertMaterial({ map: sign("جامعة الكويت ترحب بكم", 20, 2.6, "#d8c39a", "#1d3b8f", 64) }));
  welcome.position.set(0, 12, -1.25);
  welcome.rotation.y = Math.PI;
  gate.add(welcome);
  gate.position.copy(main.P[0]);
  gate.rotation.y = main.heading(0);
  scene.add(gate);

  // a pedestrian bridge over the boulevard
  {
    const i = Math.round((60 / track.LEN) * main.n);
    const br = new THREE.Mesh(new THREE.BoxGeometry(main.width * 2 + 16, 2.6, 4), new THREE.MeshPhongMaterial({ color: 0xbfe0ea, transparent: true, opacity: 0.85 }));
    br.position.set(main.P[i].x, 8, main.P[i].z);
    br.rotation.y = main.heading(i) + Math.PI / 2;
    scene.add(br);
    for (const sd of [1, -1]) {
      const n = main.normal(i);
      const p = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 5), beige);
      p.position.set(main.P[i].x + n.x * sd * (main.width + 6), 4, main.P[i].z + n.z * sd * (main.width + 6));
      p.rotation.y = main.heading(i);
      scene.add(p);
    }
  }

  // the car park: rows of parked cars under white tension shades, both sides of the car-park shortcut
  const park = track.paths[2];
  const shade = new THREE.ConeGeometry(4.2, 1.4, 4);
  shade.rotateY(Math.PI / 4);
  const shades: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const cars: THREE.Matrix4[] = [];
  const carCols: THREE.Color[] = [];
  const palette = [0xf2f2f2, 0x222222, 0xb9bec4, 0x9e1b1b, 0x1f3f7a, 0xe8e2d0];
  for (let i = 18; i < park.n - 18; i += 9) {
    const n = park.normal(i);
    for (const sd of [1, -1])
      for (const row of [9, 15]) {
        const x = park.P[i].x + n.x * sd * (park.width + row);
        const z = park.P[i].z + n.z * sd * (park.width + row);
        if (clear(x, z) < 4) continue;
        shades.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 4.6, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), park.heading(i)), new THREE.Vector3(1, 1, 1)));
        posts.push(new THREE.Matrix4().makeTranslation(x, 2, z));
        if (rnd() < 0.8) {
          cars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.75, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), park.heading(i) + Math.PI / 2), new THREE.Vector3(1, 1, 1)));
          carCols.push(new THREE.Color(palette[Math.floor(rnd() * palette.length)]));
        }
      }
  }
  const shadeMesh = new THREE.InstancedMesh(shade, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), shades.length);
  shades.forEach((m, k) => shadeMesh.setMatrixAt(k, m));
  const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 6), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }), posts.length);
  posts.forEach((m, k) => postMesh.setMatrixAt(k, m));
  const carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 1.4, 1.9), new THREE.MeshLambertMaterial({ color: 0xffffff }), cars.length);
  cars.forEach((m, k) => {
    carMesh.setMatrixAt(k, m);
    carMesh.setColorAt(k, carCols[k]);
  });
  scene.add(shadeMesh, postMesh, carMesh);

  // low beige campus buildings round the edge, and the city on the horizon
  const blocks: THREE.Matrix4[] = [];
  let tries = 0;
  while (blocks.length < 40 && tries++ < 2000) {
    const x = rnd() * 520 - 330;
    const z = rnd() * 520 - 170;
    if (clear(x, z) < 22) continue;
    if (Math.hypot(x, z - 172) < 50 || Math.hypot(x + 66, z - 262) < 40 || Math.hypot(x - 78, z - 140) < 35 || Math.hypot(x + 34, z - 160) < 25) continue;
    blocks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 7, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(rnd() * 3) * (Math.PI / 2)), new THREE.Vector3(1 + rnd() * 1.5, 0.6 + rnd() * 1.2, 1 + rnd())));
  }
  const blockTex = canvasTex(128, 128, (c) => {
    c.fillStyle = "#e3d3b2";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#8a7d66";
    for (let y = 14; y < 128; y += 32) for (let x = 8; x < 128; x += 20) c.fillRect(x, y, 10, 14);
  });
  blockTex.wrapS = blockTex.wrapT = THREE.RepeatWrapping;
  blockTex.repeat.set(2, 1);
  const blockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(24, 14, 18), new THREE.MeshLambertMaterial({ map: blockTex }), blocks.length);
  blocks.forEach((m, k) => blockMesh.setMatrixAt(k, m));
  scene.add(blockMesh);
}
