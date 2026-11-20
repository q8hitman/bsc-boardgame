// SPIKE: «مدينة النيون» - a night city of neon. Glowing road edges and rails, towers with lit windows, signs and
// duck billboards on the roofs, a raised skyway. Two shortcuts:
//  - «نفق الصعود»: a narrow climbing alley straight up to the skyway (a boost pad at its mouth)
//  - «قفزة القناة»: a ramp over the canal across the hairpin; too slow and you drop in the water
import * as THREE from "three";
import { Track, type TrackDef } from "./track";

export const NEON: TrackDef = {
  name: "مدينة النيون",
  edge: "wall",
  main: {
    width: 7.5,
    pts: [
      [0, 0, 0], [50, 0, 0], [95, 0, 10], [128, 0, 38], [152, 4, 72], [160, 9, 115], [138, 13, 158], [92, 13, 175],
      [45, 12, 170], [5, 9, 152], [-25, 5, 125], [-45, 1, 92], [-52, 0, 60], [-75, 0, 35], [-100, 0, 10], [-95, 0, -25],
      [-65, 0, -38], [-30, 0, -25],
    ],
  },
  branches: [
    { width: 4.2, from: [128, 38], to: [92, 175], pts: [[120, 2, 70], [112, 7, 110], [104, 11, 145]], aiTake: 0.3 },
    { width: 5, from: [-52, 60], to: [-65, -38], pts: [[-50, 0, 40], [-51, 4.2, 20], [-55, 0.4, 2], [-59, 0, -14]], gaps: [[0.45, 0.56]], aiTake: 0.35 },
  ],
  boosts: [[1, 0.12], [2, 0.26], [0, 0.03]],
};

const PINK = 0xff3df0;
const CYAN = 0x2ef2ff;
const GOLD = 0xffc93d;

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildNeon(scene: THREE.Scene, track: Track) {
  scene.background = new THREE.Color(0x090320);
  scene.fog = new THREE.Fog(0x14073a, 70, 320);
  scene.add(new THREE.HemisphereLight(0x8a7cff, 0x220a44, 1.1));
  const moon = new THREE.DirectionalLight(0xc9b8ff, 0.9);
  moon.position.set(-60, 120, 30);
  scene.add(moon);

  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const mk = (pos: number[], mat: THREE.Material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    return m;
  };
  const road: number[] = [];
  const dash: number[] = [];
  const glowP: number[] = [];
  const glowC: number[] = [];
  const wallP: number[] = [];
  const wallC: number[] = [];
  const under: number[] = [];
  const pillars: THREE.Matrix4[] = [];
  track.paths.forEach((p, pi) => {
    const W = p.width;
    const edge = (i: number, off: number, lift = 0.04) => {
      const n = p.normal(i);
      return new THREE.Vector3(p.P[i].x + n.x * off, p.P[i].y + lift, p.P[i].z + n.z * off);
    };
    const last = p.closed ? p.n : p.n - 1;
    for (let i = 0; i < last; i++) {
      const j = p.wrap(i + 1);
      if (p.gap[i] && p.gap[j]) continue;
      // (a branch's ends lie on the main road: draw it a hair higher so they don't flicker)
      const lift = pi ? 0.06 : 0.04;
      quad(road, edge(i, W, lift), edge(j, W, lift), edge(i, -W, lift), edge(j, -W, lift));
      // the underside of raised road
      if (p.P[i].y > 1.5) quad(under, edge(i, -W, -0.6), edge(j, -W, -0.6), edge(i, W, -0.6), edge(j, W, -0.6));
      if (Math.floor(p.S[i] / 5) % 2 === 0) quad(dash, edge(i, 0.15, lift + 0.02), edge(j, 0.15, lift + 0.02), edge(i, -0.15, lift + 0.02), edge(j, -0.15, lift + 0.02));
      for (const side of [1, -1]) {
        // glowing edge strips (pink on the main road, cyan on shortcuts)
        const target = pi ? glowC : glowP;
        quad(target, edge(i, side * W, lift + 0.03), edge(j, side * W, lift + 0.03), edge(i, side * (W - 0.4), lift + 0.03), edge(j, side * (W - 0.4), lift + 0.03));
        // the rail, except where another road meets this one
        const e = edge(i, side * (W + 0.25), 0);
        if (!track.onRoad(e.x, e.z, p.P[i].y, pi)) {
          const e2 = edge(j, side * (W + 0.25), 0);
          const top = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.y + 0.8, v.z);
          quad(pi ? wallC : wallP, e, e2, top(e), top(e2));
        }
      }
      if (p.P[i].y > 2 && i % 34 === 0) {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(p.P[i].x, (p.P[i].y - 0.6) / 2 - 0.3, p.P[i].z), new THREE.Quaternion(), new THREE.Vector3(1, p.P[i].y - 0.3, 1));
        pillars.push(m);
      }
    }
  });
  mk(road, new THREE.MeshLambertMaterial({ color: 0x241d3d, side: THREE.DoubleSide }));
  mk(under, new THREE.MeshLambertMaterial({ color: 0x1a1430, side: THREE.DoubleSide }));
  mk(dash, new THREE.MeshBasicMaterial({ color: 0x9df8ff, side: THREE.DoubleSide }));
  mk(glowP, new THREE.MeshBasicMaterial({ color: PINK, side: THREE.DoubleSide }));
  mk(glowC, new THREE.MeshBasicMaterial({ color: CYAN, side: THREE.DoubleSide }));
  mk(wallP, new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  mk(wallC, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  const pil = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1, 1.6), new THREE.MeshLambertMaterial({ color: 0x2a2150, emissive: 0x120830 }), pillars.length);
  pillars.forEach((m, k) => pil.setMatrixAt(k, m));
  scene.add(pil);

  // the ground: dark with a glowing grid
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ color: 0x0e0822 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(30, -0.35, 70);
  scene.add(floor);
  const grid = new THREE.GridHelper(700, 70, 0x5a1d8a, 0x2a0f52);
  grid.position.set(30, -0.3, 70);
  scene.add(grid);

  // the canal under the jump: glowing water
  const jump = track.paths[2];
  if (jump) {
    const gi = jump.gap.findIndex((g) => g);
    const ge = jump.gap.lastIndexOf(true);
    const mid = jump.P[Math.round((gi + ge) / 2)];
    const water = new THREE.Mesh(new THREE.PlaneGeometry(26, 200), new THREE.MeshBasicMaterial({ color: 0x0bb7d6, transparent: true, opacity: 0.75 }));
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = jump.heading(Math.round((gi + ge) / 2)) + Math.PI / 2;
    water.position.set(mid.x, -0.22, mid.z);
    scene.add(water);
    // its banks
    for (const s of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 200), new THREE.MeshBasicMaterial({ color: CYAN }));
      const h = jump.heading(Math.round((gi + ge) / 2)) + Math.PI / 2;
      bank.rotation.y = h;
      bank.position.set(mid.x + Math.sin(h + Math.PI / 2) * 13 * s, 0, mid.z + Math.cos(h + Math.PI / 2) * 13 * s);
      scene.add(bank);
    }
  }

  // boost pads: orange chevrons
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
    pad.position.set(p.P[i].x, p.P[i].y + 0.1, p.P[i].z);
    scene.add(pad);
  }

  // towers with lit windows
  const windows = (hue: number) =>
    canvasTex(64, 128, (c) => {
      c.fillStyle = "#120a2a";
      c.fillRect(0, 0, 64, 128);
      for (let y = 4; y < 128; y += 8)
        for (let x = 4; x < 64; x += 8) {
          const r = Math.random();
          c.fillStyle = r < 0.35 ? `hsl(${hue}, 100%, ${60 + Math.random() * 25}%)` : r < 0.45 ? "#fff3b0" : "#1d1440";
          c.fillRect(x, y, 5, 5);
        }
    });
  const kinds = [
    { w: 14, h: 40, d: 14, hue: 290 },
    { w: 10, h: 26, d: 18, hue: 190 },
    { w: 18, h: 60, d: 16, hue: 320 },
  ];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const roofs: THREE.Vector3[] = [];
  for (const k of kinds) {
    const geo = new THREE.BoxGeometry(k.w, k.h, k.d);
    const tex = windows(k.hue);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.round(k.w / 6), Math.round(k.h / 10));
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 });
    const COUNT = 26;
    const im = new THREE.InstancedMesh(geo, mat, COUNT);
    let n = 0;
    let tries = 0;
    while (n < COUNT && tries++ < 3000) {
      const x = rnd() * 460 - 200;
      const z = rnd() * 460 - 160;
      const near = track.nearest(x, z, null);
      const q = track.paths[near.path].P[near.i];
      const dist = Math.hypot(q.x - x, q.z - z);
      if (dist < track.paths[near.path].width + Math.max(k.w, k.d) * 0.75 + 4) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, k.h / 2 - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.6), new THREE.Vector3(1, 0.7 + rnd() * 0.7, 1));
      im.setMatrixAt(n, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const s = new THREE.Vector3();
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      if (dist < 70) roofs.push(new THREE.Vector3(p.x, (k.h * s.y) - 0.3, p.z));
      n++;
    }
    im.count = n;
    scene.add(im);
  }

  // signs on the roofs: words and duck billboards, facing the middle of the city
  const word = (text: string, color: string, font = "bold 64px 'Noto Kufi Arabic', Tahoma, sans-serif") =>
    canvasTex(512, 160, (c) => {
      c.fillStyle = "rgba(10,4,30,0.85)";
      c.fillRect(0, 0, 512, 160);
      c.strokeStyle = color;
      c.lineWidth = 8;
      c.strokeRect(6, 6, 500, 148);
      c.font = font;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.shadowColor = color;
      c.shadowBlur = 18;
      c.fillStyle = "#ffffff";
      c.fillText(text, 256, 84);
    });
  const words = [word("حفلة البط", "#ff3df0"), word("DUCK PARTY", "#2ef2ff", "bold 72px Tahoma, sans-serif"), word("نادي العلوم الحيوية", "#ffc93d", "bold 52px 'Noto Kufi Arabic', Tahoma, sans-serif"), word("سباق البط", "#7dff6a")];
  const heads = ["fayzah", "tima", "ali", "ahmad"];
  const centre = new THREE.Vector3(30, 0, 70);
  roofs.slice(0, 18).forEach((r, k) => {
    let mat: THREE.Material;
    let w = 16;
    let h = 5;
    if (k % 3 === 2) {
      // a duck billboard: their head on a neon frame
      const img = new Image();
      const tex = canvasTex(256, 256, (c) => {
        c.fillStyle = "#14073a";
        c.fillRect(0, 0, 256, 256);
      });
      img.onload = () => {
        const c = (tex.image as HTMLCanvasElement).getContext("2d")!;
        c.strokeStyle = ["#ff3df0", "#2ef2ff", "#ffc93d"][k % 3];
        c.lineWidth = 12;
        c.strokeRect(8, 8, 240, 240);
        c.imageSmoothingEnabled = false;
        c.drawImage(img, 28, 28, 200, 200);
        tex.needsUpdate = true;
      };
      img.src = `assets/heads/${heads[k % heads.length]}.png`;
      mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      w = 9;
      h = 9;
    } else mat = new THREE.MeshBasicMaterial({ map: words[k % words.length], side: THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    sign.position.set(r.x, r.y + h / 2 + 1, r.z);
    sign.lookAt(centre.x, r.y + h / 2 + 1, centre.z);
    scene.add(sign);
  });

  // stars
  const sp: number[] = [];
  for (let k = 0; k < 500; k++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.15 + rnd() * 1.2;
    sp.push(Math.cos(a) * Math.cos(e) * 400 + 30, Math.sin(e) * 400, Math.sin(a) * Math.cos(e) * 400 + 70);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, fog: false })));

  // the start gate: two glowing posts and a banner
  const main = track.paths[0];
  const gate = new THREE.Group();
  for (const s of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), new THREE.MeshBasicMaterial({ color: s > 0 ? PINK : CYAN }));
    post.position.set(0, 4, s * (main.width + 1.2));
    gate.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, main.width * 2 + 3), new THREE.MeshBasicMaterial({ map: word("انطلق", "#ffc93d") }));
  banner.position.set(0, 8, 0);
  banner.rotation.y = Math.PI; // (the readable face toward the karts coming up to the line)
  gate.add(banner);
  gate.position.copy(main.P[0]);
  gate.rotation.y = main.heading(0) - Math.PI / 2;
  scene.add(gate);
  void GOLD;
}
