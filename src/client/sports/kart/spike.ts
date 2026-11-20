/** SPIKE (throwaway): سباق البط feel and speed test. One 3D track (hill, bridge over a pond, banked hairpin), your
 *  kart with drift + mini-turbo, 7 computer karts, a chase camera, laps, a timer and an FPS meter. Phone: drag on the
 *  left to steer, hold «درفت» on the right. Keyboard: arrows / WASD, Space or Shift = drift. Open with ?kart. */
import * as THREE from "three";
import { kartMesh } from "./kartModel";
import { profile } from "../../profile";
import "./kart.css";

const LAPS = 3;
const ROAD_W = 7; // half width (m)
const MAX_ROAD = 30;
const MAX_GRASS = 13;
const ACCEL = 16;
const BOOST = [0, 0.7, 1.3]; // seconds of boost per spark tier
const TIER_AT = [0.32, 0.85]; // drift charge (seconds of turning into it) for blue / orange sparks
const POND = { x: -35, z: 108, r: 26 };

// ---------------------------------------------------------------- the track: a closed curve with heights
const PTS: [number, number, number][] = [
  [0, 0, 0], [70, 0, -4], [130, 0, 10], [168, 0, 55], [172, 0, 108], [150, 0, 150], [110, 1, 168], [70, 5, 160],
  [32, 9, 140], [-8, 9.5, 118], [-55, 9.5, 102], [-92, 5, 104], [-125, 1.5, 82], [-140, 0, 40], [-128, 0, -4],
  [-92, 0, -30], [-48, 0, -26], [-18, 0, -10],
];
const curve = new THREE.CatmullRomCurve3(PTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, "centripetal");
const N = 1600;
const P: THREE.Vector3[] = [];
const T: THREE.Vector3[] = [];
const S: number[] = []; // distance along the track at each sample
for (let i = 0; i < N; i++) {
  P.push(curve.getPointAt(i / N));
  T.push(curve.getTangentAt(i / N).setY(0).normalize());
}
let LEN = 0;
for (let i = 0; i < N; i++) {
  S.push(LEN);
  LEN += P[i].distanceTo(P[(i + 1) % N]);
}
const normalAt = (i: number) => new THREE.Vector3(-T[i].z, 0, T[i].x); // left of travel

/** nearest sample to (x, z), searching around a hint index (karts move a little each frame) */
function nearest(x: number, z: number, hint: number, span = 60): number {
  let best = hint;
  let bd = Infinity;
  for (let k = -span; k <= span; k++) {
    const i = (hint + k + N) % N;
    const dx = P[i].x - x;
    const dz = P[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
function nearestGlobal(x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < N; i += 4) {
    const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return nearest(x, z, best, 6);
}
const inPond = (x: number, z: number) => (x - POND.x) ** 2 + (z - POND.z) ** 2 < POND.r ** 2;
/** the ground: the road's height on and near the road, sloping down to the field; the pond is below */
function groundAt(x: number, z: number, i: number): { h: number; lat: number; road: boolean } {
  const n = normalAt(i);
  const lat = (x - P[i].x) * n.x + (z - P[i].z) * n.z;
  const off = Math.abs(lat) - ROAD_W;
  const road = off <= 0;
  if (road) return { h: P[i].y, lat, road };
  // the bridge: a deck with nothing under it over the pond
  if (P[i].y > 6 && inPond(x, z)) return { h: -2, lat, road };
  const fall = Math.max(0, 1 - off / 16);
  return { h: inPond(x, z) ? -2 : P[i].y * fall * fall, lat, road };
}

// ---------------------------------------------------------------- scene building
function buildTrack(scene: THREE.Scene) {
  // road ribbon, kerbs, centre dashes
  const road: number[] = [];
  const kerb: number[] = [];
  const kerbCol: number[] = [];
  const dash: number[] = [];
  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const edge = (i: number, off: number, lift = 0.05) => {
    const n = normalAt(i);
    return new THREE.Vector3(P[i].x + n.x * off, P[i].y + lift, P[i].z + n.z * off);
  };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    quad(road, edge(i, ROAD_W), edge(j, ROAD_W), edge(i, -ROAD_W), edge(j, -ROAD_W));
    for (const side of [1, -1]) {
      quad(kerb, edge(i, side * ROAD_W, 0.08), edge(j, side * ROAD_W, 0.08), edge(i, side * (ROAD_W + 1.2), 0.08), edge(j, side * (ROAD_W + 1.2), 0.08));
      const red = Math.floor(S[i] / 3) % 2 === 0;
      const c = red ? [0.86, 0.16, 0.14] : [0.97, 0.97, 0.95];
      for (let k = 0; k < 6; k++) kerbCol.push(...c);
    }
    if (Math.floor(S[i] / 4) % 2 === 0) quad(dash, edge(i, 0.18, 0.07), edge(j, 0.18, 0.07), edge(i, -0.18, 0.07), edge(j, -0.18, 0.07));
  }
  const mk = (pos: number[], mat: THREE.Material, colors?: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    return m;
  };
  mk(road, new THREE.MeshLambertMaterial({ color: 0x55595f, side: THREE.DoubleSide }));
  mk(kerb, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), kerbCol);
  mk(dash, new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }));

  // the field: a grid shaped by groundAt (computed against a coarse track for speed)
  const G = 140;
  const SIZE = 420;
  const ground = new THREE.PlaneGeometry(SIZE, SIZE, G, G);
  ground.rotateX(-Math.PI / 2);
  ground.translate(15, 0, 70);
  const pos = ground.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const i = nearestGlobal(x, z);
    const g = groundAt(x, z, i);
    // (the road itself sits on its own ribbon: keep the field just under it)
    pos.setY(v, g.road ? P[i].y - 0.3 : g.h - 0.02);
    const w = inPond(x, z) ? [0.75, 0.68, 0.45] : (Math.floor(x / 12) + Math.floor(z / 12)) % 2 ? [0.36, 0.72, 0.25] : [0.33, 0.67, 0.23];
    col.push(...w);
  }
  ground.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  ground.computeVertexNormals();
  scene.add(new THREE.Mesh(ground, new THREE.MeshLambertMaterial({ vertexColors: true })));

  // the pond
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 2, 40), new THREE.MeshLambertMaterial({ color: 0x3aa7e6, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.x, -0.6, POND.z);
  scene.add(water);

  // bridge pillars and rails where the road is high
  const pillar = new THREE.CylinderGeometry(0.8, 0.8, 1, 8);
  const pmat = new THREE.MeshLambertMaterial({ color: 0xd9cdb4 });
  const rail = new THREE.BoxGeometry(0.4, 0.9, 1);
  const rmat = new THREE.MeshLambertMaterial({ color: 0xf4a62a });
  for (let i = 0; i < N; i += 8) {
    if (P[i].y < 6) continue;
    for (const side of [1, -1]) {
      const e = edge(i, side * (ROAD_W + 1.6), 0);
      const r = new THREE.Mesh(rail, rmat);
      r.position.set(e.x, P[i].y + 0.45, e.z);
      r.scale.z = 4.2;
      r.rotation.y = Math.atan2(T[i].x, T[i].z);
      scene.add(r);
      if (i % 32 === 0) {
        const p = new THREE.Mesh(pillar, pmat);
        p.scale.y = P[i].y + 2;
        p.position.set(e.x, (P[i].y - 2) / 2, e.z);
        scene.add(p);
      }
    }
  }

  // trees and cones (instanced, off the road)
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), 160);
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6, 7), new THREE.MeshLambertMaterial({ color: 0x2f9e44 }), 160);
  const m = new THREE.Matrix4();
  let n = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (n < 160) {
    const x = rnd() * 400 - 185;
    const z = rnd() * 400 - 130;
    const i = nearestGlobal(x, z);
    const g = groundAt(x, z, i);
    if (Math.abs(g.lat) < ROAD_W + 6 || inPond(x, z)) continue;
    m.makeTranslation(x, g.h + 1.5, z);
    trunk.setMatrixAt(n, m);
    m.makeTranslation(x, g.h + 5.5, z);
    leaves.setMatrixAt(n, m);
    n++;
  }
  scene.add(trunk, leaves);

  // start / finish arch
  const arch = new THREE.Group();
  const post = new THREE.BoxGeometry(0.8, 7, 0.8);
  const am = new THREE.MeshLambertMaterial({ color: 0x1b1440 });
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(post, am);
    p.position.set(0, 3.5, side * (ROAD_W + 1.5));
    arch.add(p);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, ROAD_W * 2 + 4), new THREE.MeshLambertMaterial({ color: 0xffd23f }));
  banner.position.set(0, 7, 0);
  arch.add(banner);
  arch.position.copy(P[0]);
  arch.rotation.y = Math.atan2(T[0].x, T[0].z) - Math.PI / 2;
  scene.add(arch);
}

// ---------------------------------------------------------------- karts
interface Kart {
  g: THREE.Group;
  body: THREE.Group;
  x: number;
  y: number;
  z: number;
  vy: number;
  heading: number;
  speed: number;
  i: number;
  progress: number;
  lap: number;
  me: boolean;
  // drift
  drift: number; // -1 / 0 / 1
  driftT: number;
  boostT: number;
  air: boolean;
  // computer
  lane: number;
  pace: number;
  sparks?: THREE.Mesh[];
  blob: THREE.Mesh;
  fallT: number;
  sprite: THREE.Sprite;
}
const COLORS = [0xe8493d, 0x2f8cff, 0x36c26b, 0xffd23f, 0xc77dff, 0xff8a4c, 0x29c7c7, 0xff6b8b];

/** the ducks drawn seated for the kart, 4 views each (back, back-right 45, right side, front-right 45; the left
 *  side is the mirror). Others fall back to their football idle frame. */
const KART_ART = ["tima", "ahmad", "ali", "fayzah"];
const PX = 0.031; // world units per sprite pixel (same as the football ducks)

function duckSprite(char: string): THREE.Sprite {
  const seated = KART_ART.includes(char);
  const tex = new THREE.TextureLoader().load(seated ? `assets/kart/${char}.png` : `assets/football/${char}-blue.png`, (t) => {
    const img = t.image as HTMLImageElement;
    const cells = seated ? 4 : 6;
    s.scale.set((img.width / cells) * PX * 1.15, img.height * PX * 1.15, 1);
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(seated ? 1 / 4 : 1 / 6, 1);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.5 }));
  s.center.set(0.5, 0);
  s.position.set(0, seated ? 0.36 : 0.5, seated ? -0.42 : -0.2);
  s.userData.seated = seated;
  return s;
}

/** MK64-style: show the view of the duck that faces the camera (8 directions from 4 drawings, mirrored) */
function faceCamera(k: Kart, cam: THREE.Vector3) {
  const s = k.sprite;
  if (!s.userData.seated) return;
  const dx = cam.x - k.x;
  const dz = cam.z - k.z;
  const h = k.heading + k.body.rotation.y;
  const right = -Math.cos(h) * dx + Math.sin(h) * dz;
  const back = -(Math.sin(h) * dx + Math.cos(h) * dz);
  const ang = (Math.atan2(Math.abs(right), back) * 180) / Math.PI;
  const idx = ang < 22.5 ? 0 : ang < 67.5 ? 1 : ang < 120 ? 2 : 3;
  const flip = right < 0 && idx > 0;
  const t = (s.material as THREE.SpriteMaterial).map!;
  t.repeat.x = flip ? -1 / 4 : 1 / 4;
  t.offset.x = flip ? (idx + 1) / 4 : idx / 4;
}

function makeKart(scene: THREE.Scene, color: number, char: string, me: boolean): Kart {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(kartMesh(color));
  const sprite = duckSprite(char);
  body.add(sprite);
  g.add(body);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);
  scene.add(g);
  const k: Kart = { g, body, x: 0, y: 0, z: 0, vy: 0, heading: 0, speed: 0, i: 0, progress: 0, lap: 0, me, drift: 0, driftT: 0, boostT: 0, air: false, lane: 0, pace: 1, blob, fallT: 0, sprite };
  if (me) {
    k.sparks = [-0.95, 0.95].map((x) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), new THREE.MeshBasicMaterial({ color: 0x55c8ff }));
      s.position.set(x * 1.02, 0.25, -1.45);
      s.visible = false;
      body.add(s);
      return s;
    });
  }
  return k;
}

function placeOnGrid(k: Kart, slot: number) {
  // two by two behind the line
  const back = 8 + Math.floor(slot / 2) * 7;
  let i = 0;
  let d = 0;
  while (d < back) {
    i = (i - 1 + N) % N;
    d += P[i].distanceTo(P[(i + 1) % N]);
  }
  const n = normalAt(i);
  const side = slot % 2 ? -3 : 3;
  k.x = P[i].x + n.x * side;
  k.z = P[i].z + n.z * side;
  k.y = P[i].y;
  k.i = i;
  k.heading = Math.atan2(T[i].x, T[i].z);
  k.progress = S[i] - LEN;
  k.lane = side;
}

// ---------------------------------------------------------------- input
interface Input {
  steer: number;
  brake: boolean;
  drift: boolean;
  item: boolean;
}
function controls(root: HTMLElement): () => Input {
  const keys = new Set<string>();
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  const ui = document.createElement("div");
  ui.className = "kt-ctrl";
  ui.innerHTML = `<div class="kt-stick"><div class="kt-hint">اسحب يمين ويسار</div><i class="kt-knob"></i></div>
    <div class="kt-btns"><button class="kt-drift" type="button">درفت</button><button class="kt-item" type="button">غرض</button></div>`;
  root.appendChild(ui);
  const zone = ui.querySelector<HTMLDivElement>(".kt-stick")!;
  const knob = ui.querySelector<HTMLElement>(".kt-knob")!;
  let touchSteer = 0;
  let touchBrake = false;
  let sid = -1;
  let ox = 0;
  let oy = 0;
  zone.addEventListener("pointerdown", (e) => {
    sid = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    zone.setPointerCapture(e.pointerId);
    zone.classList.add("on");
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== sid) return;
    const dx = Math.max(-60, Math.min(60, e.clientX - ox));
    const dy = e.clientY - oy;
    touchSteer = dx / 60;
    touchBrake = dy > 50;
    knob.style.transform = `translate(${dx}px, ${Math.max(-20, Math.min(60, dy))}px)`;
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== sid) return;
    sid = -1;
    touchSteer = 0;
    touchBrake = false;
    knob.style.transform = "";
    zone.classList.remove("on");
  };
  zone.addEventListener("pointerup", up);
  zone.addEventListener("pointercancel", up);
  const hold = (sel: string) => {
    const b = ui.querySelector<HTMLButtonElement>(sel)!;
    let on = false;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      on = true;
      b.classList.add("on");
      b.setPointerCapture(e.pointerId);
    });
    const off = () => {
      on = false;
      b.classList.remove("on");
    };
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => on;
  };
  const driftBtn = hold(".kt-drift");
  const itemBtn = hold(".kt-item");
  return () => {
    const kl = keys.has("ArrowLeft") || keys.has("KeyA");
    const kr = keys.has("ArrowRight") || keys.has("KeyD");
    const steer = kl || kr ? (kl ? -1 : 0) + (kr ? 1 : 0) : touchSteer;
    return {
      steer,
      brake: keys.has("ArrowDown") || keys.has("KeyS") || touchBrake,
      drift: keys.has("Space") || keys.has("ShiftLeft") || keys.has("ShiftRight") || driftBtn(),
      item: keys.has("KeyE") || itemBtn(),
    };
  };
}

// ---------------------------------------------------------------- the race
export function startKartSpike(app: HTMLElement) {
  document.body.style.overflow = "hidden";
  app.innerHTML = `<div class="kt-root"><canvas class="kt-cv"></canvas>
    <div class="kt-hud"><div class="kt-pos" id="ktPos">١/٨</div><div class="kt-lap" id="ktLap">لفة ١/${LAPS}</div><div class="kt-time" id="ktTime">0:00.0</div></div>
    <div class="kt-fps" id="ktFps"></div><div class="kt-msg" id="ktMsg">٣</div><div class="kt-boost" id="ktBoost"></div></div>`;
  const root = app.querySelector<HTMLDivElement>(".kt-root")!;
  const cv = app.querySelector<HTMLCanvasElement>(".kt-cv")!;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd8ff);
  scene.fog = new THREE.Fog(0x8fd8ff, 90, 260);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(60, 120, 40);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 400);
  const size = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", size);
  size();
  buildTrack(scene);

  // (spike: only the ducks drawn for the kart so far)
  const myChar = KART_ART.includes(profile().char) ? profile().char : "fayzah";
  const others = KART_ART.filter((c) => c !== myChar);
  const karts: Kart[] = [];
  for (let s = 0; s < 8; s++) {
    const me = s === 7;
    const k = makeKart(scene, COLORS[s], me ? myChar : others[s % others.length], me);
    placeOnGrid(k, s);
    k.pace = me ? 1 : 0.9 + 0.012 * s + Math.random() * 0.03;
    karts.push(k);
  }
  const me = karts[7];
  const read = controls(root);
  // (debug handle for testing the feel from the console)
  (window as unknown as { __kart: unknown }).__kart = { me, karts, LEN, P, T, N, force: undefined as Input | undefined };

  const $ = (id: string) => app.querySelector<HTMLElement>(`#${id}`)!;
  let t0 = performance.now();
  let countdown = 3;
  let raceT = 0;
  let finished = false;
  let last = performance.now();
  let fpsN = 0;
  let fpsT = 0;
  const camPos = new THREE.Vector3(me.x, me.y + 6, me.z - 10);
  const look = new THREE.Vector3();
  const ar = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

  function stepMe(dt: number, inp: Input) {
    const k = me;
    const g = groundAt(k.x, k.z, k.i);
    const onRoad = g.road;
    let top = (onRoad ? MAX_ROAD : MAX_GRASS) * (k.drift ? 0.97 : 1);
    if (k.boostT > 0) {
      k.boostT -= dt;
      top = MAX_ROAD + 10;
    }
    // throttle is automatic (non-gamers just steer); down brakes / reverses
    const target = inp.brake ? -8 : top;
    const a = k.speed < target ? (k.boostT > 0 ? ACCEL * 2.2 : ACCEL) : -ACCEL * (inp.brake ? 1.6 : 0.9);
    k.speed += Math.sign(target - k.speed) * Math.min(Math.abs(target - k.speed), Math.abs(a) * dt);
    // drift: press while turning; you keep turning that way, the stick makes it tighter or wider; release = boost
    if (inp.drift && !k.drift && !k.air && Math.abs(inp.steer) > 0.3 && k.speed > 12) {
      k.drift = Math.sign(inp.steer);
      k.driftT = 0;
      k.vy = 3.2; // a little hop
      k.air = true;
    }
    if (k.drift && (!inp.drift || k.speed < 8)) {
      const tier = k.driftT >= TIER_AT[1] ? 2 : k.driftT >= TIER_AT[0] ? 1 : 0;
      if (tier && k.speed >= 8) {
        k.boostT = BOOST[tier];
        flashBoost(tier);
      }
      k.drift = 0;
    }
    const sp = Math.min(1, Math.abs(k.speed) / 10);
    let turn: number;
    if (k.drift) {
      // sparks build only while actually turning into the drift on the road (no farming boosts on a straight)
      if (!onRoad) k.driftT = 0;
      else k.driftT += dt * (0.8 + 0.5 * Math.max(0, inp.steer * k.drift)); // widening the drift (stick out) still charges
      turn = k.drift * (1.0 + 0.8 * (inp.steer * k.drift)) * 1.4;
    } else {
      const heavy = 1 - 0.55 * Math.min(1, Math.abs(k.speed) / MAX_ROAD);
      turn = inp.steer * 2.4 * heavy * sp * (k.speed < 0 ? -1 : 1);
    }
    k.heading += turn * dt;
    const slip = k.drift ? -k.drift * 0.32 : 0;
    k.x += Math.sin(k.heading + slip * 0.5) * k.speed * dt;
    k.z += Math.cos(k.heading + slip * 0.5) * k.speed * dt;
    // sparks
    const tier = !k.drift ? -1 : k.driftT >= TIER_AT[1] ? 2 : k.driftT >= TIER_AT[0] ? 1 : 0;
    k.sparks!.forEach((s) => {
      s.visible = tier >= 1 && Math.floor(performance.now() / 60) % 2 === 0;
      (s.material as THREE.MeshBasicMaterial).color.setHex(tier === 2 ? 0xff9a2a : 0x55c8ff);
    });
    k.body.rotation.y = slip;
  }

  function stepAI(k: Kart, dt: number) {
    // they drive the line (lane offset), a touch faster when behind you, slower when far ahead
    const gap = k.progress - me.progress;
    const rubber = gap > 40 ? 0.94 : gap < -40 ? 1.06 : 1;
    k.speed += (MAX_ROAD * k.pace * rubber - k.speed) * Math.min(1, dt * 0.8);
    const ahead = (k.i + 14) % N;
    const n = normalAt(ahead);
    const tx = P[ahead].x + n.x * k.lane;
    const tz = P[ahead].z + n.z * k.lane;
    const want = Math.atan2(tx - k.x, tz - k.z);
    let d = want - k.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, d * 3 * dt));
    k.x += Math.sin(k.heading) * k.speed * dt;
    k.z += Math.cos(k.heading) * k.speed * dt;
    k.lane += (Math.sin(performance.now() / 2000 + k.pace * 40) * 3 - k.lane) * dt * 0.3;
  }

  function settle(k: Kart, dt: number) {
    const prevI = k.i;
    k.i = nearest(k.x, k.z, k.i);
    // progress along the track (laps)
    let ds = S[k.i] - S[prevI];
    if (ds < -LEN / 2) ds += LEN;
    if (ds > LEN / 2) ds -= LEN;
    k.progress += ds;
    const lap = Math.floor(k.progress / LEN) + 1;
    if (lap > k.lap) k.lap = lap;
    // height: on the ground, or flying off a crest
    const g = groundAt(k.x, k.z, k.i);
    k.vy -= 30 * dt;
    k.y += k.vy * dt;
    if (k.y <= g.h) {
      if (k.air && k.vy < -12 && k.me) shake = 0.25;
      k.vy = k.air ? 0 : (g.h - k.y) / dt;
      k.y = g.h;
      k.air = false;
    } else if (k.y > g.h + 0.4) k.air = true;
    // fell in the pond: back on the road a moment later
    if (g.h < -1 && k.y < -0.5) {
      k.fallT += dt;
      if (k.fallT > 0.8) {
        const n = normalAt(k.i);
        k.x = P[k.i].x + n.x * Math.max(-4, Math.min(4, g.lat));
        k.z = P[k.i].z + n.z * Math.max(-4, Math.min(4, g.lat));
        k.y = P[k.i].y + 2;
        k.vy = 0;
        k.speed = 6;
        k.heading = Math.atan2(T[k.i].x, T[k.i].z);
        k.fallT = 0;
        k.drift = 0;
      }
    }
    k.g.position.set(k.x, k.y, k.z);
    k.g.rotation.y = k.heading;
    // tilt with the slope of the road
    const ahead = P[(k.i + 4) % N];
    const behind = P[(k.i - 4 + N) % N];
    const pitch = Math.atan2(ahead.y - behind.y, ahead.distanceTo(behind));
    k.g.rotation.x = k.air ? k.g.rotation.x : -pitch;
    k.blob.position.set(k.x, g.h + 0.05, k.z);
    (k.blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - (k.y - g.h) * 0.04);
    void dt;
  }

  function bump() {
    for (let a = 0; a < karts.length; a++)
      for (let b = a + 1; b < karts.length; b++) {
        const A = karts[a];
        const B = karts[b];
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 2.2 && Math.abs(A.y - B.y) < 1.5) {
          const push = (2.2 - d) / 2;
          A.x -= (dx / d) * push;
          A.z -= (dz / d) * push;
          B.x += (dx / d) * push;
          B.z += (dz / d) * push;
        }
      }
  }

  let shake = 0;
  const boostEl = $("ktBoost");
  function flashBoost(tier: number) {
    boostEl.textContent = tier === 2 ? "تيربو!!" : "تيربو!";
    boostEl.className = `kt-boost on t${tier}`;
    setTimeout(() => (boostEl.className = "kt-boost"), 700);
  }

  let held = false;
  function frame(now: number, manual = false) {
    if (!manual) requestAnimationFrame(frame);
    if (held && !manual) return;
    // (a frame at the same moment, or an older timestamp, moves nothing: no divide by zero)
    const dt = Math.min(0.05, (now - last) / 1000);
    if (!(dt > 0.0005)) {
      renderer.render(scene, camera);
      return;
    }
    last = now;
    fpsN++;
    fpsT += dt;
    if (fpsT > 0.5) {
      $("ktFps").textContent = `${Math.round(fpsN / fpsT)} FPS`;
      fpsN = 0;
      fpsT = 0;
    }
    const force = (window as unknown as { __kart: { force?: Input } }).__kart.force;
    const inp = force ?? read();
    // countdown
    if (countdown > 0) {
      const left = 3 - (now - t0) / 1000;
      const c = Math.ceil(left);
      $("ktMsg").textContent = c > 0 ? ar(c) : "انطلق!";
      if (left <= 0) {
        countdown = 0;
        t0 = now;
        setTimeout(() => ($("ktMsg").textContent = ""), 600);
      }
    } else if (!finished) {
      raceT = (now - t0) / 1000;
      stepMe(dt, inp);
      for (const k of karts) if (!k.me) stepAI(k, dt);
      bump();
    }
    for (const k of karts) settle(k, dt);
    // HUD
    const order = [...karts].sort((a, b) => b.progress - a.progress);
    const pos = order.indexOf(me) + 1;
    $("ktPos").textContent = `${ar(pos)}/${ar(karts.length)}`;
    $("ktLap").textContent = `لفة ${ar(Math.min(LAPS, Math.max(1, me.lap)))}/${ar(LAPS)}`;
    $("ktTime").textContent = fmt(raceT);
    if (!finished && me.lap > LAPS) {
      finished = true;
      $("ktMsg").innerHTML = `خلصت! المركز ${ar(pos)}<small>${fmt(raceT)} · اضغط لسباق جديد</small>`;
      root.addEventListener("pointerdown", () => location.reload(), { once: true });
    }
    // chase camera: behind and above, swinging wider in a drift, pulled back by speed
    const back = 5.4 + Math.max(0, me.speed - MAX_ROAD) * 0.12;
    const ch = me.heading - (me.drift ? me.drift * 0.25 : 0);
    const want = new THREE.Vector3(me.x - Math.sin(ch) * back, Math.max(me.y, groundAt(me.x, me.z, me.i).h) + 2.4, me.z - Math.cos(ch) * back);
    camPos.lerp(want, Math.min(1, dt * 14));
    camera.position.copy(camPos);
    if (shake > 0) {
      shake -= dt;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    look.set(me.x + Math.sin(me.heading) * 6, me.y + 1.2, me.z + Math.cos(me.heading) * 6);
    camera.lookAt(look);
    for (const k of karts) faceCamera(k, camera.position);
    const fov = 60 + Math.max(0, me.speed - 20) * 0.4 + (me.boostT > 0 ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.2) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  // (testing: step the race by hand where requestAnimationFrame doesn't run)
  Object.assign((window as unknown as { __kart: object }).__kart, {
    step: (ms: number) => frame(ms, true),
    hold: (on: boolean) => (held = on),
    // (testing: look at a kart up close from an angle, in degrees around it)
    show: (deg: number, dist = 4.5, h = 1.6, idx = 7) => {
      held = true;
      const k = karts[idx];
      const a = k.heading + (deg * Math.PI) / 180;
      camera.position.set(k.x + Math.sin(a) * dist, k.y + h, k.z + Math.cos(a) * dist);
      camera.lookAt(k.x, k.y + 0.8, k.z);
      for (const o of karts) faceCamera(o, camera.position);
      renderer.render(scene, camera);
    },
  });
}
