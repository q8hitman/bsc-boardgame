// SPIKE: «سوق المباركية» at golden hour, from photos of the souq: covered lanes under dark wooden gable roofs with
// white iron trusses, lanterns on wooden posts, Kuwait flags and strings of lights across, shopfronts full of dates,
// spices, sweets, fabrics, perfume and carpets; the cobbled courtyard with the Sheikh Mubarak kiosk (beige, wooden
// balcony, outside stair, flag) and cafe tables under white shades and palms; low beige buildings outside and the
// city towers behind. Shortcuts: «السوق الأبيض», a narrow white lane under a dark ceiling; and a run over the
// rooftops with a jump back down to the street.
import * as THREE from "three";
import { Track, type TrackDef } from "./track";
import { canvasTex, crowd, flags, noiseTex, sky, walkers, type Tick } from "./life";
import { skyline } from "./fun";

// the jump off the roof: a gap in the rooftop road just before it drops to the street (fractions along it)
const GAP_A = 0.61;
const GAP_B = 0.72;

export const SOUQ: TrackDef = {
  name: "سوق المباركية",
  edge: "wall",
  main: {
    width: 6.5,
    pts: [
      [-40, 0, 0], [20, 0, 0], [80, 0, 0], [130, 0, 10], [152, 0, 45], [152, 0, 95], [130, 0, 126], [80, 0, 136],
      [20, 0, 136], [-30, 0, 130], [-62, 0, 104], [-72, 0, 60], [-64, 0, 22],
    ],
  },
  branches: [
    // «السوق الأبيض»: straight through the shops, narrow, under a low ceiling
    { width: 3.8, from: [80, 0], to: [80, 136], pts: [[82, 0, 40], [80, 0, 70], [78, 0, 100]], aiTake: 0.3 },
    // over the rooftops: up the stair, along the roofs, jump down to the street
    { width: 4.4, from: [-30, 130], to: [-64, 22], pts: [[-36, 0, 118], [-40, 0, 108], [-43, 2, 98], [-47, 4.5, 88], [-50, 6, 74], [-54, 6, 62], [-58, 1.8, 50], [-60, 0, 39]], gaps: [[GAP_A, GAP_B]], aiTake: 0.35 },
  ],
  boosts: [[1, 0.1], [2, 0.18], [0, 0.55]],
};

/** which parts of the main road are covered lanes (fractions along it) */
const COVERED: [number, number][] = [[0.08, 0.36], [0.45, 0.62]];

export function buildSouq(scene: THREE.Scene, track: Track): { tick: Tick; sun: THREE.DirectionalLight } {
  // golden hour: a warm low sun, a pink-orange sky, lights glowing
  scene.background = new THREE.Color(0xf6c89a);
  scene.fog = new THREE.Fog(0xf2c69c, 140, 460);
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x8a6a4a, 1.15));
  const SUN_DIR = new THREE.Vector3(-0.7, 0.42, 0.3).normalize();
  const sun = new THREE.DirectionalLight(0xffc27a, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 320 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  sun.userData.dir = SUN_DIR;
  scene.add(sun, sun.target);
  const ticks: Tick[] = [sky(scene, "#5b7fc9", "#ffb88a", SUN_DIR)];
  const main = track.paths[0];
  const room = (x: number, z: number, except = -1) => {
    let best = Infinity;
    track.paths.forEach((p, pi) => {
      if (pi === except) return;
      for (let i = 0; i < p.n; i += 2) best = Math.min(best, Math.hypot(p.P[i].x - x, p.P[i].z - z) - p.width);
    });
    return best;
  };
  const covered = (pi: number, i: number) => pi === 0 ? COVERED.some(([a, b]) => i >= a * main.n && i <= b * main.n) : pi === 1;

  // ---------------------------------------------------------------- ground: cobbles everywhere, paved lanes
  const cobble = noiseTex("#a39a8c", ["#8c8478", "#b9b0a2", "#7d766b"], 128, [160, 160], (c) => {
    c.strokeStyle = "rgba(60,55,50,0.45)";
    c.lineWidth = 2;
    for (let y = 0; y < 128; y += 16)
      for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
        c.beginPath();
        c.roundRect(x + 1, y + 1, 14, 14, 4);
        c.stroke();
      }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ map: cobble }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(40, -0.05, 70);
  scene.add(ground);
  const pave = noiseTex("#d9cbb3", ["#c9b99d", "#e6dac4"], 128, [1, 1], (c) => {
    c.strokeStyle = "rgba(120,100,80,0.35)";
    c.lineWidth = 2;
    for (let y = 0; y < 128; y += 32) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(128, y);
      c.stroke();
      for (let x = (y / 32) % 2 ? 16 : 0; x < 128; x += 32) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y + 32);
        c.stroke();
      }
    }
  });
  pave.wrapS = pave.wrapT = THREE.RepeatWrapping;
  const roadPos: number[] = [];
  const roadUV: number[] = [];
  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const edgeOf = (p: (typeof track.paths)[number], i: number, off: number, up = 0.04) => {
    const n = p.normal(i);
    return new THREE.Vector3(p.P[i].x + n.x * off, p.P[i].y + up, p.P[i].z + n.z * off);
  };
  const under: number[] = [];
  const underUV: number[] = [];
  const parapet: number[] = [];
  track.paths.forEach((p, pi) => {
    const W = p.width;
    const last = p.closed ? p.n : p.n - 1;
    for (let i = 0; i < last; i++) {
      const j = p.wrap(i + 1);
      if (p.gap[i] && p.gap[j]) continue;
      const up = pi ? 0.06 : 0.04;
      quad(roadPos, edgeOf(p, i, W, up), edgeOf(p, j, W, up), edgeOf(p, i, -W, up), edgeOf(p, j, -W, up));
      const vi = p.S[i] / 4;
      const vj = (p.S[i] + p.P[i].distanceTo(p.P[j])) / 4;
      roadUV.push(W / 2, vi, W / 2, vj, 0, vi, W / 2, vj, 0, vj, 0, vi);
      // raised roof runs and the stair: a solid block under them
      if (p.P[i].y > 0.4) {
        const si = p.S[i] / 8;
        const sj = (p.S[i] + p.P[i].distanceTo(p.P[j])) / 8;
        for (const sd of [1, -1]) {
          quad(under, edgeOf(p, i, sd * W, up), edgeOf(p, j, sd * W, up), edgeOf(p, i, sd * W, -p.P[i].y), edgeOf(p, j, sd * W, -p.P[j].y));
          underUV.push(si, p.P[i].y / 8, sj, p.P[j].y / 8, si, 0, sj, p.P[j].y / 8, sj, 0, si, 0);
          // a low parapet along the roof edge
          quad(parapet, edgeOf(p, i, sd * W, up + 0.7), edgeOf(p, j, sd * W, up + 0.7), edgeOf(p, i, sd * W, up), edgeOf(p, j, sd * W, up));
        }
      }
    }
  });
  const mkGeo = (pos: number[], uv?: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const roadMesh = new THREE.Mesh(mkGeo(roadPos, roadUV), new THREE.MeshLambertMaterial({ map: pave, side: THREE.DoubleSide }));
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);
  // the houses under the rooftop road: beige walls, wooden shutters, a door now and then
  const houseTex = canvasTex(128, 128, (c) => {
    c.fillStyle = "#e0cba4";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#cdb488";
    c.fillRect(0, 112, 128, 16);
    c.fillStyle = "#6a4326";
    c.fillRect(18, 22, 22, 30);
    c.fillRect(84, 22, 22, 30);
    c.fillStyle = "#5a3a22";
    c.fillRect(52, 66, 24, 46);
    c.fillStyle = "#3d2414";
    for (const x of [18, 84]) for (let k = 0; k < 5; k++) c.fillRect(x + 1, 24 + k * 6, 20, 2);
  }, [1, 1]);
  scene.add(new THREE.Mesh(mkGeo(under, underUV), new THREE.MeshLambertMaterial({ map: houseTex, side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(mkGeo(parapet), new THREE.MeshLambertMaterial({ color: 0xcdb486, side: THREE.DoubleSide })));

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
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.2), new THREE.MeshBasicMaterial({ map: chevron }));
    pad.rotation.order = "YXZ";
    pad.rotation.set(-Math.PI / 2, p.heading(i), 0);
    pad.position.set(p.P[i].x, p.P[i].y + 0.12, p.P[i].z);
    scene.add(pad);
  }

  // ---------------------------------------------------------------- shopfronts all along both sides
  const goods: [string, (c: CanvasRenderingContext2D) => void][] = [
    ["dates", (c) => {
      for (let k = 0; k < 5; k++) for (let r = 0; r < 3; r++) {
        c.fillStyle = ["#5a2d12", "#7a3d1a", "#8f5326"][r];
        c.beginPath();
        c.ellipse(14 + k * 25, 108 - r * 26, 11, 9, 0, 0, Math.PI * 2);
        c.fill();
      }
    }],
    ["spices", (c) => {
      ["#e4572e", "#f2b632", "#9b5523", "#c7302a", "#e9c46a", "#6a994e"].forEach((col, k) => {
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(4 + (k % 3) * 42, 120 - Math.floor(k / 3) * 44);
        c.lineTo(24 + (k % 3) * 42, 86 - Math.floor(k / 3) * 44);
        c.lineTo(44 + (k % 3) * 42, 120 - Math.floor(k / 3) * 44);
        c.fill();
      });
    }],
    ["fabric", (c) => {
      ["#1b1440", "#c9a227", "#7a1f2b", "#f2efe6", "#2a4d8f", "#3d2b1f"].forEach((col, k) => {
        c.fillStyle = col;
        c.fillRect(6 + k * 20, 18, 16, 104);
        c.fillStyle = "#e3c26a";
        c.fillRect(6 + k * 20, 18, 16, 4);
      });
    }],
    ["perfume", (c) => {
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
        c.fillStyle = ["#e8b84a", "#c06bd6", "#3fa7d6", "#e84a5f", "#7fd17a", "#f4f1e8"][(k + r) % 6];
        c.fillRect(8 + k * 20, 96 - r * 34, 12, 20);
        c.fillStyle = "#d4af37";
        c.fillRect(11 + k * 20, 90 - r * 34, 6, 6);
      }
    }],
    ["sweets", (c) => {
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
        c.fillStyle = ["#ff6fa3", "#ffd23f", "#7fd1ff", "#a0e57a", "#ff9f43", "#ffffff"][(k * 2 + r) % 6];
        c.beginPath();
        c.arc(12 + k * 20, 112 - r * 24, 8, 0, Math.PI * 2);
        c.fill();
      }
    }],
    ["carpets", (c) => {
      ["#8b1e2d", "#1f3b73", "#a0522d"].forEach((col, k) => {
        c.fillStyle = col;
        c.fillRect(8 + k * 40, 12, 34, 110);
        c.strokeStyle = "#e6c87a";
        c.lineWidth = 3;
        c.strokeRect(12 + k * 40, 18, 26, 98);
        c.beginPath();
        c.moveTo(25 + k * 40, 30);
        c.lineTo(36 + k * 40, 66);
        c.lineTo(25 + k * 40, 102);
        c.lineTo(14 + k * 40, 66);
        c.closePath();
        c.stroke();
      });
    }],
  ];
  const shopMats = goods.map(([, draw]) =>
    new THREE.MeshLambertMaterial({
      map: canvasTex(128, 128, (c) => {
        c.fillStyle = "#3a2618";
        c.fillRect(0, 0, 128, 128);
        const g = c.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, "#ffdf9e");
        g.addColorStop(1, "#c98b4a");
        c.fillStyle = g;
        c.fillRect(4, 8, 120, 118);
        draw(c);
        c.fillStyle = "#5a3a22";
        c.fillRect(0, 0, 128, 8);
      }),
      emissive: 0x2a1606,
    }),
  );
  const upper = canvasTex(128, 128, (c) => {
    c.fillStyle = "#e9dcc3";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#5a3a22";
    for (const x of [22, 78]) {
      c.beginPath();
      c.moveTo(x, 96);
      c.lineTo(x, 50);
      c.arc(x + 14, 50, 14, Math.PI, 0);
      c.lineTo(x + 28, 96);
      c.fill();
    }
    c.fillStyle = "#cdbb98";
    c.fillRect(0, 118, 128, 10);
  });
  const shopGeo = new THREE.PlaneGeometry(6.4, 6.4);
  const upperGeo = new THREE.PlaneGeometry(6.4, 7);
  const signGeo = new THREE.PlaneGeometry(5.8, 1.5);
  const shopsBy: THREE.Matrix4[][] = goods.map(() => []);
  const uppers: THREE.Matrix4[] = [];
  const signs: THREE.Matrix4[] = [];
  const shoppers: THREE.Vector3[] = [];
  let bay = 0;
  const placed: { x: number; z: number }[] = [];
  track.paths.forEach((p, pi) => {
    for (let i = 0; i < p.n; i += 10) {
      if (p.P[i].y > 0.5) continue;
      const n = p.normal(i);
      for (const sd of [1, -1]) {
        const off = p.width + 1.6;
        const x = p.P[i].x + n.x * sd * off;
        const z = p.P[i].z + n.z * sd * off;
        // no shop across another road (a raised one too), none on top of another shop (inside of a bend)
        if (room(x, z, pi) < 2 || room(p.P[i].x + n.x * sd * (p.width + 0.5), p.P[i].z + n.z * sd * (p.width + 0.5), pi) < 1) continue;
        if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 5.6)) continue;
        // and not under the raised rooftop road
        if (room(x, z) < 3 && track.paths.some((q) => q.P.some((v) => v.y > 0.4 && Math.hypot(v.x - x, v.z - z) < q.width + 4))) continue;
        placed.push({ x, z });
        // facing the road
        const rot = Math.atan2(-n.x * sd, -n.z * sd);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        shopsBy[bay++ % goods.length].push(new THREE.Matrix4().compose(new THREE.Vector3(x, 3.2, z), q, new THREE.Vector3(1, 1, 1)));
        uppers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 9.9, z), q, new THREE.Vector3(1, 1, 1)));
        signs.push(new THREE.Matrix4().compose(new THREE.Vector3(x - n.x * sd * 0.25, 7.2, z - n.z * sd * 0.25), q, new THREE.Vector3(1, 1, 1)));
        if (bay % 3 === 0 && pi !== 2) shoppers.push(new THREE.Vector3(p.P[i].x + n.x * sd * (p.width + 0.6), 0, p.P[i].z + n.z * sd * (p.width + 0.6)));
      }
    }
  });
  shopsBy.forEach((list, k) => {
    const im = new THREE.InstancedMesh(shopGeo, shopMats[k], list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    scene.add(im);
  });
  const upperMesh = new THREE.InstancedMesh(upperGeo, new THREE.MeshLambertMaterial({ map: upper }), uppers.length);
  uppers.forEach((m, j) => upperMesh.setMatrixAt(j, m));
  upperMesh.receiveShadow = true;
  // the shop names: made up, light and nostalgic (old prices, the neighbourhood shop, duck puns); no real shop,
  // nothing about anyone
  const NAMES: [string, string, string][] = [
    ["بقالة الفريج · الحساب بالدفتر", "#1d6b4a", "#fff6d8"],
    ["تمور أبو بطة · حلو مثل قلبك", "#5a2d12", "#ffd98a"],
    ["كل شي بربع دينار", "#8b1e2d", "#ffffff"],
    ["بهارات الحارّة · حارة وايد", "#c7302a", "#fff2c4"],
    ["عطور الريشة الفوّاحة", "#3b1f5a", "#ffd9f2"],
    ["حلويات زمان · بيض اللقلق", "#e86a92", "#ffffff"],
    ["خيّاط البشوت · نخيط حتى الجناح", "#1f3b73", "#ffe7a8"],
    ["نخي وباجلا · حار وطازج", "#a0522d", "#fff6d8"],
    ["شاي كرك · الكوب الأخير", "#7a4a1d", "#ffe3b0"],
    ["ألعاب الفريج · الدقيقة بـ ٢٥ فلس", "#2f8cff", "#ffffff"],
    ["قرطاسية الواجب · على باچر", "#36a36b", "#ffffff"],
    ["استوديو قُل كواك", "#1b1440", "#ffd23f"],
    ["تصليح سياكل · نبنشر بسرعة", "#444b55", "#ffffff"],
    ["مقهى يا هلا والله", "#6b3a1f", "#ffe7c2"],
    ["سجاد الجدة · يطير إذا تبي", "#8b1e2d", "#ffd98a"],
    ["خبز تنور · طلع من التنور", "#c98b2a", "#3a1f0a"],
    ["عسل النحلة النشيطة", "#e3a51a", "#3a1f0a"],
    ["كوكتيل ٩٠ فلس · مثل أيام أول", "#ff6f3c", "#ffffff"],
  ];
  const nameMats = NAMES.map(([text, bg, fg]) =>
    new THREE.MeshLambertMaterial({
      map: canvasTex(512, 132, (c) => {
        c.fillStyle = bg;
        c.fillRect(0, 0, 512, 132);
        c.strokeStyle = "#e6c87a";
        c.lineWidth = 6;
        c.strokeRect(6, 6, 500, 120);
        c.fillStyle = fg;
        let size = 46;
        c.font = `bold ${size}px 'Noto Kufi Arabic', Tahoma, sans-serif`;
        while (c.measureText(text).width > 470 && size > 24) c.font = `bold ${(size -= 2)}px 'Noto Kufi Arabic', Tahoma, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(text, 256, 72);
      }),
      emissive: 0x1a1006,
    }),
  );
  const byName: THREE.Matrix4[][] = NAMES.map(() => []);
  signs.forEach((m, j) => byName[(j * 7) % NAMES.length].push(m));
  byName.forEach((list, k) => {
    const im = new THREE.InstancedMesh(signGeo, nameMats[k], list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    scene.add(im);
  });
  scene.add(upperMesh);
  ticks.push(crowd(scene, shoppers));

  // the beige mass behind the shops (so the lanes read as built up), with parapets
  const blocks: THREE.Matrix4[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 2500 && blocks.length < 120; t++) {
    const x = -160 + rnd() * 420;
    const z = -90 + rnd() * 330;
    // keep the courtyard by the start open
    if (Math.hypot(x + 20, z - 30) < 32) continue;
    const s = 0.8 + rnd() * 0.7;
    const sx = 1 + rnd();
    const sz = 1 + rnd();
    const rot = Math.round(rnd() * 3) * (Math.PI / 2);
    // every part of the footprint (corners, edges, middle) at least a shop's depth behind the road
    const hx = 7 * sx + 1;
    const hz = 7 * sz + 1;
    let ok = room(x, z) > 4 + Math.hypot(hx, hz) * 0.2;
    for (let u = -1; ok && u <= 1; u += 0.5)
      for (let v = -1; ok && v <= 1; v += 0.5) {
        const lx = u * hx;
        const lz = v * hz;
        if (room(x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)) < 4) ok = false;
      }
    if (!ok) continue;
    blocks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 7 * s, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sx, s, sz)));
  }
  const blockTex = canvasTex(128, 128, (c) => {
    c.fillStyle = "#e3d1ae";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#7a5a3a";
    for (let y = 30; y < 120; y += 44) for (let x = 14; x < 128; x += 36) c.fillRect(x, y, 12, 18);
    c.fillStyle = "#cdb88f";
    c.fillRect(0, 0, 128, 10);
  });
  const blockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshLambertMaterial({ map: blockTex }), blocks.length);
  blocks.forEach((m, k) => blockMesh.setMatrixAt(k, m));
  blockMesh.castShadow = true;
  blockMesh.receiveShadow = true;
  scene.add(blockMesh);

  // ---------------------------------------------------------------- the covered lanes: posts, lanterns, trusses, roof
  const posts: THREE.Matrix4[] = [];
  const lanterns: THREE.Matrix4[] = [];
  const rafters: THREE.Matrix4[] = [];
  const ironwork: THREE.Matrix4[] = [];
  const roofPos: number[] = [];
  const skyPos: number[] = [];
  const hangFlags: { x: number; z: number; face: number; h?: number }[] = [];
  const bulbs: number[] = [];
  const bulbCol: number[] = [];
  const bulbColors = [0xfff2b0, 0xffd46a, 0x9fe0ff, 0xffffff].map((c) => new THREE.Color(c));
  track.paths.forEach((p, pi) => {
    const W = p.width + (pi === 1 ? 0.3 : 0.8);
    const H = pi === 1 ? 8 : 13.4;
    const ridge = pi === 1 ? 8.4 : 17;
    for (let i = 0; i < p.n - 1; i++) {
      if (!covered(pi, i)) continue;
      const n = p.normal(i);
      const m = p.normal(i + 1);
      const at = (k: number, off: number, y: number, nn = n) => new THREE.Vector3(p.P[k].x + nn.x * off, y, p.P[k].z + nn.z * off);
      // the roof: two sloping planes up to the ridge, a skylight strip along the top
      for (const sd of [1, -1]) quad(roofPos, at(i, sd * W, H), at(i + 1, sd * W, H, m), at(i, sd * 1.4, ridge), at(i + 1, sd * 1.4, ridge, m));
      quad(skyPos, at(i, 1.4, ridge), at(i + 1, 1.4, ridge, m), at(i, -1.4, ridge), at(i + 1, -1.4, ridge, m));
      const hd = p.heading(i);
      if (i % 10 === 0) {
        for (const sd of [1, -1]) {
          posts.push(new THREE.Matrix4().compose(at(i, sd * W, H / 2), new THREE.Quaternion(), new THREE.Vector3(1, H, 1)));
          lanterns.push(new THREE.Matrix4().makeTranslation(at(i, sd * (W - 0.6), H - 1.6).x, H - 1.6, at(i, sd * (W - 0.6), H - 1.6).z));
          // rafters from the posts to the ridge
          const a = at(i, sd * W, H);
          const b = at(i, 0, ridge);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const len = a.distanceTo(b);
          const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
          rafters.push(new THREE.Matrix4().compose(mid, qq, new THREE.Vector3(len, 1, 1)));
        }
        if (pi === 0) {
          // white iron arch under each truss
          ironwork.push(new THREE.Matrix4().compose(at(i, 0, H - 0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd + Math.PI / 2), new THREE.Vector3(W, W * 0.32, 1)));
        }
      }
      if (pi === 0 && i % 26 === 0) hangFlags.push({ ...{ x: p.P[i].x, z: p.P[i].z }, face: hd + Math.PI / 2, h: 0 });
      // strings of lights across the lane, sagging
      if (i % 14 === 7)
        for (let k = 0; k <= 16; k++) {
          const u = k / 16 - 0.5;
          const pnt = at(i, u * 2 * W, H - 0.6 - (1 - (2 * u) ** 2) * 1.1);
          bulbs.push(pnt.x, pnt.y, pnt.z);
          const c = bulbColors[k % bulbColors.length];
          bulbCol.push(c.r, c.g, c.b);
        }
    }
  });
  const wood = new THREE.MeshLambertMaterial({ color: 0x4a2e1c });
  const roofMesh = new THREE.Mesh(mkGeo(roofPos), new THREE.MeshLambertMaterial({ color: 0x3d281a, side: THREE.DoubleSide }));
  roofMesh.castShadow = true;
  scene.add(roofMesh);
  scene.add(new THREE.Mesh(mkGeo(skyPos), new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 1, 0.45), wood, posts.length);
  posts.forEach((mm, k) => postMesh.setMatrixAt(k, mm));
  const lanternMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.36, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }), lanterns.length);
  lanterns.forEach((mm, k) => lanternMesh.setMatrixAt(k, mm));
  const rafterMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 0.3), wood, rafters.length);
  rafters.forEach((mm, k) => rafterMesh.setMatrixAt(k, mm));
  // the white iron arches: a half ring
  const archGeo = new THREE.TorusGeometry(1, 0.06, 4, 24, Math.PI);
  archGeo.rotateZ(Math.PI);
  const ironMesh = new THREE.InstancedMesh(archGeo, new THREE.MeshLambertMaterial({ color: 0xf6f3ea }), ironwork.length);
  ironwork.forEach((mm, k) => ironMesh.setMatrixAt(k, mm));
  scene.add(postMesh, lanternMesh, rafterMesh, ironMesh);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(bulbs, 3));
  bg.setAttribute("color", new THREE.Float32BufferAttribute(bulbCol, 3));
  scene.add(new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.35, vertexColors: true })));
  // Kuwait flags hanging under the roof (a flag on a short pole from the ridge, waving gently)
  ticks.push(flags(scene, hangFlags.map((f) => ({ ...f, h: 15, hang: true }))));

  // ---------------------------------------------------------------- the courtyard by the start
  // the Sheikh Mubarak kiosk: a small beige house with a wooden balcony, an outside stair and a flag
  {
    const g = new THREE.Group();
    const beige = new THREE.MeshLambertMaterial({ color: 0xdcc59c });
    const house = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 8), beige);
    house.position.y = 3.5;
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.8, 8.4), new THREE.MeshLambertMaterial({ color: 0xcdb486 }));
    parapet.position.y = 7.4;
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 1.4), new THREE.MeshLambertMaterial({ map: canvasTex(64, 32, (c) => {
      c.fillStyle = "#6a4326";
      c.fillRect(0, 0, 64, 32);
      c.fillStyle = "#3d2414";
      for (let x = 2; x < 64; x += 5) c.fillRect(x, 2, 2, 28);
    }) }));
    balcony.position.set(0, 4.8, 4.6);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3, 0.2), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }));
    door.position.set(-2.5, 1.5, 4.05);
    g.add(house, parapet, balcony, door);
    for (let k = 0; k < 7; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1), beige);
      step.position.set(5.7, 0.25 + k * 0.5, 3.5 - k * 0.9);
      g.add(step);
    }
    g.position.set(-22, 0, 34);
    g.rotation.y = Math.PI;
    scene.add(g);
    ticks.push(flags(scene, [{ x: -22, z: 34, face: 0, h: 11 }]));
    // a «سوق المباركية» sign in calligraphy-style lettering on a beige panel
    const tex = canvasTex(512, 128, (c) => {
      c.fillStyle = "#e8d6b0";
      c.fillRect(0, 0, 512, 128);
      c.fillStyle = "#7a1f2b";
      c.font = "bold 70px 'Noto Kufi Arabic', Tahoma, serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("سوق المباركية", 256, 70);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshLambertMaterial({ map: tex }));
    const i = Math.round(0.08 * main.n);
    sign.position.set(main.P[i].x, 12, main.P[i].z);
    sign.rotation.y = main.heading(i) + Math.PI;
    scene.add(sign);
  }
  // cafe tables under white shades, and palms
  {
    const shade = new THREE.ConeGeometry(3.4, 1.2, 4);
    shade.rotateY(Math.PI / 4);
    const shades: THREE.Matrix4[] = [];
    const tables: THREE.Matrix4[] = [];
    const sitters: THREE.Vector3[] = [];
    for (let gx = -2; gx <= 2; gx++)
      for (let gz = 0; gz < 3; gz++) {
        const x = -20 + gx * 9;
        const z = 48 + gz * 9;
        const nn = track.nearest(x, z, null);
        const p = track.paths[nn.path];
        if (Math.hypot(p.P[nn.i].x - x, p.P[nn.i].z - z) - p.width < 5) continue;
        shades.push(new THREE.Matrix4().makeTranslation(x, 3.6, z));
        tables.push(new THREE.Matrix4().makeTranslation(x, 0.75, z));
        sitters.push(new THREE.Vector3(x + 1.4, 0, z), new THREE.Vector3(x - 1.4, 0, z + 0.3));
      }
    const sm = new THREE.InstancedMesh(shade, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), shades.length);
    shades.forEach((mm, k) => sm.setMatrixAt(k, mm));
    const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), tables.length);
    tables.forEach((mm, k) => tm.setMatrixAt(k, mm));
    scene.add(sm, tm);
    ticks.push(crowd(scene, sitters));
  }

  // walkers crossing the courtyard and the open streets
  const routes: [THREE.Vector3, THREE.Vector3][] = [];
  for (let t = 0; t < 900 && routes.length < 20; t++) {
    const x = -60 + rnd() * 80;
    const z = 15 + rnd() * 80;
    const a = rnd() * Math.PI * 2;
    const L = 8 + rnd() * 14;
    const bx = x + Math.cos(a) * L;
    const bz = z + Math.sin(a) * L;
    const ok = [[x, z], [bx, bz], [(x + bx) / 2, (z + bz) / 2]].every(([px, pz]) => {
      const nn = track.nearest(px, pz, null);
      const p = track.paths[nn.path];
      return Math.hypot(p.P[nn.i].x - px, p.P[nn.i].z - pz) - p.width > 3;
    });
    if (ok) routes.push([new THREE.Vector3(x, 0.05, z), new THREE.Vector3(bx, 0.05, bz)]);
  }
  ticks.push(walkers(scene, routes));

  // the city behind: Kuwait Towers, the Liberation Tower, Al Hamra (the souq is in the city centre)
  skyline(scene, new THREE.Vector3(40, 0, 70), Math.PI * 0.85, 300);

  scene.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh || mm === roadMesh) return;
    if (!((mm.material as THREE.Material) as THREE.MeshBasicMaterial).isMeshBasicMaterial) mm.receiveShadow = true;
  });
  ground.receiveShadow = true;
  return { tick: (dt, t, cam) => ticks.forEach((f) => f(dt, t, cam)), sun };
}
