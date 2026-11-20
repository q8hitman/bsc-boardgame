/** SPIKE (throwaway): سباق البط feel and speed test. One 3D track (hill, bridge over a pond, banked hairpin), your
 *  kart with drift + mini-turbo, 7 computer karts, a chase camera, laps, a timer and an FPS meter. Phone: drag on the
 *  left to steer, hold «درفت» on the right. Keyboard: arrows / WASD, Space or Shift = drift. Open with ?kart. */
import * as THREE from "three";
import { kartMesh, lookFor, LOOKS, STYLES, statsFor, type KartLook, type KartStats, type KartStyle } from "./kartModel";
import { Track } from "./track";
import { NEON, buildNeon } from "./neon";
import { UNI, buildUni } from "./uni";
import { CAMPUS, buildCampus, pushOut, type Solid } from "./campus";
import { profile } from "../../profile";
import "./kart.css";

const LAPS = 3;
const MAX_ROAD = 30;
const MAX_GRASS = 13;
/** what a kart's 1..5 stats mean on the road */
const topOf = (st: KartStats) => 28 + st.speed * 1.1; // 29.1 .. 33.5 m/s
const accelOf = (st: KartStats) => 9 + st.accel * 2.6; // 11.6 .. 22 m/s²
const gripOf = (st: KartStats) => 0.78 + st.handling * 0.09; // 0.87 .. 1.23 x turning
const roughOf = (st: KartStats) => 8 + st.offroad * 1.8; // 9.8 .. 17 m/s off the road
const sparkOf = (st: KartStats) => 0.8 + st.drift * 0.1; // drift charge rate
const ACCEL = 16;
const BOOST = [0, 0.7, 1.3, 1.9]; // seconds of boost per spark tier
const TIER_AT = [0.32, 0.85, 1.5]; // drift charge (seconds of turning into it) for blue / orange / purple sparks
const SPARK = [0xfff3b0, 0x3fb8ff, 0xff9a2a, 0xd65cff]; // the sparks' colour at each tier (0 = just starting)
const tierOf = (t: number) => (t >= TIER_AT[2] ? 3 : t >= TIER_AT[1] ? 2 : t >= TIER_AT[0] ? 1 : 0);

// (spike: the campus by default; ?t=neon the neon city; ?t=campus the campus on the bare OpenStreetMap footprints)
const PICK = new URLSearchParams(location.search).get("t") ?? "uni";
const NEON_PICKED = PICK === "neon";
const track = new Track(NEON_PICKED ? NEON : PICK === "uni" ? UNI : CAMPUS);
const main = track.paths[0];
const LEN = track.LEN;
/** boost pads in the world */
const PADS = track.def.boosts.map(([pi, f]) => {
  const p = track.paths[pi];
  return p.P[Math.round(f * (p.n - 1))];
});

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
  /** which road (0 = main, 1.. = shortcuts) */
  path: number;
  /** the last spot on solid road (to come back to after a fall) */
  safe: { path: number; i: number };
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
  look: KartLook;
  stats: KartStats;
  kartGroup: THREE.Group;
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
  const look = lookFor(char, color);
  const km = kartMesh(look);
  body.add(km.group);
  km.group.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  const sprite = duckSprite(char);
  if (sprite.userData.seated) sprite.position.set(0, km.seatY, km.seatZ);
  body.add(sprite);
  g.add(body);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);
  scene.add(g);
  const k: Kart = { g, body, x: 0, y: 0, z: 0, vy: 0, heading: 0, speed: 0, i: 0, path: 0, safe: { path: 0, i: 0 }, progress: 0, lap: 0, me, drift: 0, driftT: 0, boostT: 0, air: false, lane: 0, pace: 1, blob, fallT: 0, sprite, look, stats: statsFor(look), kartGroup: km.group };
  if (me) {
    const sparkMat = new THREE.MeshBasicMaterial({ color: SPARK[1] });
    k.sparks = [];
    for (const x of [-1.05, 1.05])
      for (let j = 0; j < 7; j++) {
        const s = new THREE.Mesh(new THREE.TetrahedronGeometry(j === 0 ? 0.32 : 0.16), sparkMat);
        s.userData = { x, j };
        s.visible = false;
        body.add(s);
        k.sparks.push(s);
      }
  }
  return k;
}

/** change a kart's body (the duck stays) */
function setLook(k: Kart, look: KartLook) {
  k.body.remove(k.kartGroup);
  const km = kartMesh(look);
  k.body.add(km.group);
  km.group.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  k.kartGroup = km.group;
  if (k.sprite.userData.seated) k.sprite.position.set(0, km.seatY, km.seatZ);
  k.look = look;
  k.stats = statsFor(look);
}
const STYLE_ORDER = Object.keys(STYLES) as KartStyle[];
/** a style in the colours of the first duck who drives it */
const sampleLook = (st: KartStyle): KartLook => Object.values(LOOKS).find((l) => l.style === st) ?? { style: st, paint: 0xe8493d, accent: 0xffffff };

function placeOnGrid(k: Kart, slot: number) {
  // two by two behind the line
  const back = 8 + Math.floor(slot / 2) * 7;
  let i = 0;
  let d = 0;
  while (d < back) {
    i = main.wrap(i - 1);
    d += main.P[i].distanceTo(main.P[main.wrap(i + 1)]);
  }
  const n = main.normal(i);
  const side = slot % 2 ? -3.2 : 3.2;
  k.x = main.P[i].x + n.x * side;
  k.z = main.P[i].z + n.z * side;
  k.y = main.P[i].y;
  k.i = i;
  k.path = 0;
  k.safe = { path: 0, i };
  k.heading = main.heading(i);
  k.progress = main.prog[i] - LEN;
  k.lane = side;
}

// ---------------------------------------------------------------- input
interface Input {
  /** the gas pedal (holding drift counts as gas too, so one thumb can do both) */
  gas: boolean;
  steer: number;
  brake: boolean;
  drift: boolean;
  item: boolean;
}
function controls(root: HTMLElement): (dt: number) => Input {
  const keys = new Set<string>();
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  const ui = document.createElement("div");
  ui.className = "kt-ctrl";
  ui.innerHTML = `<div class="kt-stick"><div class="kt-hint">حط صبعك واسحب يمين ويسار</div><i class="kt-knob"></i></div>
    <div class="kt-btns"><button class="kt-drift" type="button">درفت</button><div class="kt-row"><button class="kt-brake" type="button">بريك</button><button class="kt-gas" type="button">بنزين</button></div></div>`;
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
    const dx = Math.max(-75, Math.min(75, e.clientX - ox));
    const dy = e.clientY - oy;
    // a small dead zone, then a soft curve: small moves make small turns, the edge is a full turn
    const m = Math.max(0, Math.abs(dx) - 8) / 67;
    touchSteer = Math.sign(dx) * (0.35 * m + 0.65 * m * m);
    // braking only on a clear pull straight down (not a finger sliding while steering)
    touchBrake = dy > 90 && dy > Math.abs(dx) * 2;
    knob.style.transform = `translate(${dx}px, ${Math.max(-20, Math.min(90, dy))}px)`;
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
  const gasBtn = hold(".kt-gas");
  const brakeBtn = hold(".kt-brake");
  let smooth = 0;
  return (dt: number) => {
    const kl = keys.has("ArrowLeft") || keys.has("KeyA");
    const kr = keys.has("ArrowRight") || keys.has("KeyD");
    const want = kl || kr ? (kl ? -1 : 0) + (kr ? 1 : 0) : touchSteer;
    // eases toward the stick (faster when letting go or switching sides, so it never feels late)
    const rate = Math.abs(want) < Math.abs(smooth) || want * smooth < 0 ? 10 : 6;
    smooth += Math.sign(want - smooth) * Math.min(Math.abs(want - smooth), rate * dt);
    return {
      // (Input.steer is in heading terms: + turns toward +x, the kart's LEFT; so the player's right is negative)
      steer: -smooth,
      brake: keys.has("ArrowDown") || keys.has("KeyS") || touchBrake || brakeBtn(),
      drift: keys.has("Space") || keys.has("ShiftLeft") || keys.has("ShiftRight") || driftBtn(),
      item: keys.has("KeyE"),
      gas: keys.has("ArrowUp") || keys.has("KeyW") || gasBtn(),
    };
  };
}

// ---------------------------------------------------------------- the race
export function startKartSpike(app: HTMLElement) {
  document.body.style.overflow = "hidden";
  app.innerHTML = `<div class="kt-root"><canvas class="kt-cv"></canvas>
    <div class="kt-hud"><div class="kt-pos" id="ktPos">١/٨</div><div class="kt-lap" id="ktLap">لفة ١/${LAPS}</div><div class="kt-time" id="ktTime">0:00.0</div></div>
    <div class="kt-fps" id="ktFps"></div><div class="kt-msg" id="ktMsg"></div><div class="kt-boost" id="ktBoost"></div>
    <div class="kt-car" id="ktCar"></div></div>`;
  const root = app.querySelector<HTMLDivElement>(".kt-root")!;
  const cv = app.querySelector<HTMLCanvasElement>(".kt-cv")!;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !NEON_PICKED;
  // a little punchier colour (filmic, a touch brighter) for a sunny race day
  if (!NEON_PICKED) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
  }
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 400);
  const size = () => {
    // (a hidden or collapsing page reports 0: fall back to the window, never a broken camera)
    const w = root.clientWidth || innerWidth;
    const h = root.clientHeight || innerHeight;
    if (!(w > 0 && h > 0)) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", size);
  size();
  let life: ReturnType<typeof buildUni> | null = null;
  /** buildings and pillars karts bump off */
  let solids: Solid[] = [];
  if (NEON_PICKED) buildNeon(scene, track);
  else if (PICK === "uni") {
    const u = buildUni(scene, track);
    life = u;
    solids = u.solids;
  }
  else {
    const c = buildCampus(scene, track);
    life = c;
    solids = c.solids;
  }
  let lifeT = 0;
  /** what moves on the track, and the sun's shadow box kept round your kart */
  const live = (dt: number) => {
    if (!life) return;
    lifeT += dt;
    life.tick(dt, lifeT, camera);
    const d = life.sun.userData.dir as THREE.Vector3;
    life.sun.target.position.set(me.x, 0, me.z);
    life.sun.position.set(me.x + d.x * 150, d.y * 150, me.z + d.z * 150);
  };

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
  // (spike: try any kart on your duck: ?car=racer, or the button before the start)
  const asked = new URLSearchParams(location.search).get("car") as KartStyle | null;
  if (asked && STYLES[asked]) setLook(me, { ...sampleLook(asked) });
  const carEl = app.querySelector<HTMLDivElement>("#ktCar")!;
  const LABELS: [keyof KartStats, string][] = [["speed", "السرعة"], ["accel", "التسارع"], ["handling", "التحكم"], ["weight", "الوزن"], ["offroad", "البر"], ["drift", "الدرفت"]];
  const drawCar = () => {
    const st = me.stats;
    carEl.innerHTML = `<b>${STYLES[me.look.style].name}</b>${LABELS.map(([k, n]) => `<div class="kt-stat"><span>${n}</span><i>${"<s></s>".repeat(st[k])}${"<u></u>".repeat(5 - st[k])}</i></div>`).join("")}<button type="button" id="ktNext">جرّب سيارة ثانية</button><button type="button" class="go" id="ktGo">يلا نبدأ!</button>`;
    carEl.querySelector<HTMLButtonElement>("#ktGo")!.onclick = (e) => {
      e.stopPropagation();
      ready = true;
      carEl.style.display = "none";
    };
    carEl.querySelector<HTMLButtonElement>("#ktNext")!.onclick = (e) => {
      e.stopPropagation();
      const next = STYLE_ORDER[(STYLE_ORDER.indexOf(me.look.style) + 1) % STYLE_ORDER.length];
      setLook(me, next === lookFor(myChar, 0).style ? lookFor(myChar, 0) : sampleLook(next));
      drawCar();
    };
  };
  drawCar();
  // (debug handle for testing the feel from the console)
  (window as unknown as { __kart: unknown }).__kart = {
    me, karts, LEN, track, camera, solids: () => solids, force: undefined as Input | undefined,
    // (testing: the point n samples ahead of a kart on its road, carrying on along the main road after a shortcut)
    ahead: (k: Kart, n: number) => aheadOf(k, n),
  };

  const $ = (id: string) => app.querySelector<HTMLElement>(`#${id}`)!;
  let t0 = performance.now();
  let countdown = 3;
  // the race waits on the kart panel until you press go
  let ready = false;
  let raceT = 0;
  let finished = false;
  let last = performance.now();
  let fpsN = 0;
  let fpsT = 0;
  const camPos = new THREE.Vector3(me.x, me.y + 6, me.z - 10);
  const look = new THREE.Vector3();
  const ar = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

  let driftWait = 0;
  function stepMe(dt: number, inp: Input) {
    const k = me;
    const g = track.ground(k.x, k.z, k.y, { path: k.path, i: k.i });
    const onRoad = g.road;
    const st = k.stats;
    let top = (onRoad ? (g.rough ? roughOf(st) + 9 : topOf(st)) : roughOf(st)) * (k.drift ? 0.97 : 1);
    if (k.boostT > 0) {
      k.boostT -= dt;
      top = topOf(st) + 10;
    }
    // gas to go; let go and it rolls to a stop; the brake slows hard (and backs up once stopped)
    const going = inp.gas || inp.drift || k.boostT > 0;
    const target = inp.brake ? -8 : going ? top : 0;
    const acc = accelOf(st);
    const a = k.speed < target ? (k.boostT > 0 ? acc * 2.2 : acc) : inp.brake ? -ACCEL * 1.8 : going ? -ACCEL * 0.9 : -7;
    k.speed += Math.sign(target - k.speed) * Math.min(Math.abs(target - k.speed), Math.abs(a) * dt);
    // drift: press while turning; you keep turning that way, the stick makes it tighter or wider; release = boost
    if (inp.drift && !k.drift && !k.air && !driftWait && k.speed > 10) {
      k.vy = 3.2; // a little hop
      k.air = true;
      if (Math.abs(inp.steer) > 0.15) {
        k.drift = Math.sign(inp.steer);
        k.driftT = 0;
      } else driftWait = 0.35;
    }
    if (driftWait > 0) {
      driftWait -= dt;
      if (!inp.drift) driftWait = 0;
      else if (Math.abs(inp.steer) > 0.15) {
        k.drift = Math.sign(inp.steer);
        k.driftT = 0;
        driftWait = 0;
      }
    }
    if (k.drift && (!inp.drift || k.speed < 8)) {
      const tier = tierOf(k.driftT);
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
      else k.driftT += dt * sparkOf(st) * (0.8 + 0.5 * Math.max(0, inp.steer * k.drift)); // widening the drift (stick out) still charges
      turn = k.drift * (1.0 + 0.7 * (inp.steer * k.drift)) * 1.45 * (0.85 + 0.15 * gripOf(st));
    } else {
      const heavy = 1 - 0.4 * Math.min(1, Math.abs(k.speed) / topOf(st));
      turn = inp.steer * 2.5 * gripOf(st) * heavy * sp * (k.speed < 0 ? -1 : 1);
    }
    k.heading += turn * dt;
    const slip = k.drift ? k.drift * 0.3 : 0;
    k.x += Math.sin(k.heading - slip * 0.35) * k.speed * dt;
    k.z += Math.cos(k.heading - slip * 0.35) * k.speed * dt;
    // sparks
    // the sparks at the back wheels change colour as the drift charges (white-yellow, blue, orange, purple)
    const tier = !k.drift ? -1 : tierOf(k.driftT);
    const now = performance.now();
    k.sparks!.forEach((s, n) => {
      s.visible = tier >= 0 && (n % 7 === 0 || Math.random() < 0.6);
      if (!s.visible) return;
      if (n === 0) (s.material as THREE.MeshBasicMaterial).color.setHex(SPARK[tier]);
      const { x, j } = s.userData as { x: number; j: number };
      const sc = tier === 0 ? 0.6 : 1 + tier * 0.25;
      s.scale.setScalar(sc);
      s.position.set(x + (Math.random() - 0.5) * 0.4, 0.15 + Math.random() * (0.25 + j * 0.06), -1.3 - j * 0.12 - Math.random() * 0.3);
      s.rotation.set(now * 0.01 + j, now * 0.013, 0);
    });
    k.body.rotation.y = slip;
  }

  /** the road point n samples ahead of a kart (off the end of a shortcut: on along the main road) */
  function aheadOf(k: Kart, n: number) {
    const p = track.paths[k.path];
    if (p.closed) return { p, i: p.wrap(k.i + n) };
    const j = k.i + n;
    if (j < p.n) return { p, i: j };
    return { p: main, i: main.wrap(p.exit + (j - (p.n - 1))) };
  }
  const lastI = new Map<Kart, number>();
  const stuck = new Map<Kart, number>();
  function stepAI(k: Kart, dt: number) {
    // stuck against something for a while: back on the middle of the road a little further on
    const st = k.speed < 5 ? (stuck.get(k) ?? 0) + dt : 0;
    stuck.set(k, st);
    if (st > 1.2) {
      const p0 = track.paths[k.path];
      const j = p0.wrap(k.i + 6);
      k.i = j;
      k.x = p0.P[j].x;
      k.z = p0.P[j].z;
      k.heading = p0.heading(j);
      k.lane = 0;
      k.speed = 12;
      stuck.set(k, 0);
    }
    // they drive the line (lane offset), a touch faster when behind you, slower when far ahead
    const gap = k.progress - me.progress;
    const rubber = gap > 40 ? 0.94 : gap < -40 ? 1.06 : 1;
    if (k.boostT > 0) k.boostT -= dt;
    const g0 = track.ground(k.x, k.z, k.y, { path: k.path, i: k.i });
    const top = (g0.road || g0.edgeX !== undefined ? (g0.rough ? roughOf(k.stats) + 9 : topOf(k.stats)) : roughOf(k.stats)) * k.pace * rubber + (k.boostT > 0 ? 10 : 0);
    k.speed += (top - k.speed) * Math.min(1, dt * 0.8);
    // at a shortcut's mouth, maybe take it
    if (k.path === 0) {
      const was = lastI.get(k) ?? k.i;
      for (let b = 1; b < track.paths.length; b++) {
        const br = track.paths[b];
        const passed = was <= k.i ? br.enter > was && br.enter <= k.i : br.enter > was || br.enter <= k.i;
        if (passed && Math.random() < br.aiTake) {
          k.path = b;
          k.i = 0;
          break;
        }
      }
    } else if (k.i >= track.paths[k.path].n - 3) {
      const br = track.paths[k.path];
      k.path = 0;
      k.i = track.nearestLocal(0, k.x, k.z, br.exit, 20);
    }
    lastI.set(k, k.i);
    const { p, i: ahead } = aheadOf(k, 14);
    const lane = Math.max(-(p.width - 2.2), Math.min(p.width - 2.2, k.lane));
    const n = p.normal(ahead);
    const tx = p.P[ahead].x + n.x * lane;
    const tz = p.P[ahead].z + n.z * lane;
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
    const prevProg = track.paths[k.path].prog[k.i];
    if (k.me) {
      // you can be on any road: the nearest one at your height
      const nn = track.nearest(k.x, k.z, k.y, k.path);
      k.path = nn.path;
      k.i = nn.i;
    } else k.i = track.nearestLocal(k.path, k.x, k.z, k.i);
    const p = track.paths[k.path];
    // progress along the track (laps); a shortcut's progress is mapped onto the main road
    let ds = p.prog[k.i] - prevProg;
    if (ds < -LEN / 2) ds += LEN;
    if (ds > LEN / 2) ds -= LEN;
    k.progress += ds;
    const lap = Math.floor(k.progress / LEN) + 1;
    if (lap > k.lap) k.lap = lap;
    const g = track.ground(k.x, k.z, k.y, { path: k.path, i: k.i });
    // already well below the road (fell short of a jump): keep falling, don't pop back up through it
    if (k.air && k.y < g.h - 1.2) g.h = -60;
    // walls: off the road on a walled track you slide along the rail
    if (g.edgeX !== undefined && !k.air && k.y > g.h - 1) {
      k.x = g.edgeX;
      k.z = g.edgeZ!;
      k.speed *= 1 - 1.2 * dt;
    }
    // buildings: you bump off them
    if (solids.length && pushOut(solids, k, 1.1)) {
      k.speed *= 1 - 3 * dt;
      // a computer kart that hits a wall steers back toward the middle of the road
      if (!k.me) k.lane *= 1 - 4 * dt;
    }
    // height: on the ground, or flying off a crest / over a gap
    k.vy -= 30 * dt;
    k.y += k.vy * dt;
    if (k.y <= g.h) {
      if (k.air && k.vy < -12 && k.me) shake = 0.25;
      k.vy = k.air ? 0 : (g.h - k.y) / dt;
      k.y = g.h;
      k.air = false;
    } else if (k.y > g.h + 0.4) k.air = true;
    if (g.road && !k.air) k.safe = { path: k.path, i: k.i };
    // boost pads
    for (const q of PADS)
      if (!k.air && (q.x - k.x) ** 2 + (q.z - k.z) ** 2 < 2.4 ** 2 && Math.abs(q.y - k.y) < 1.5 && k.boostT < 0.9) {
        k.boostT = 1.0;
        if (k.me) flashBoost(1);
      }
    // fell (into the canal, off the edge): back on the road a moment later
    if (k.y < -5) {
      k.fallT += dt;
      if (k.fallT > 0.9) {
        // (after a fall on a shortcut, back where it left the main road)
        const at = k.safe.path === 0 ? k.safe.i : track.paths[k.safe.path].enter;
        k.path = 0;
        k.i = at;
        k.x = main.P[at].x;
        k.z = main.P[at].z;
        k.y = main.P[at].y + 1.5;
        k.vy = 0;
        k.speed = 6;
        k.heading = main.heading(at);
        k.fallT = 0;
        k.drift = 0;
        k.air = true;
        lastI.set(k, at);
      }
    }
    k.g.position.set(k.x, k.y, k.z);
    k.g.rotation.y = k.heading;
    // tilt with the slope of the road
    const q = track.paths[k.path];
    const ahead = q.P[q.wrap(k.i + 4)];
    const behind = q.P[q.wrap(k.i - 4)];
    const pitch = Math.atan2(ahead.y - behind.y, Math.max(0.1, ahead.distanceTo(behind)));
    k.g.rotation.x = k.air ? k.g.rotation.x : -pitch;
    const gh = g.h < -10 ? -2.4 : g.h;
    k.blob.position.set(k.x, gh + 0.05, k.z);
    (k.blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - (k.y - gh) * 0.04);
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
          const push = 2.2 - d;
          const wa = A.stats.weight;
          const wb = B.stats.weight;
          const pa = (push * wb) / (wa + wb);
          const pb = (push * wa) / (wa + wb);
          A.x -= (dx / d) * pa;
          A.z -= (dz / d) * pa;
          B.x += (dx / d) * pb;
          B.z += (dz / d) * pb;
        }
      }
  }

  let shake = 0;
  const boostEl = $("ktBoost");
  function flashBoost(tier: number) {
    boostEl.textContent = tier === 3 ? "تيربو!!!" : tier === 2 ? "تيربو!!" : "تيربو!";
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
    const inp = force ?? read(dt);
    // countdown
    if (!ready) {
      t0 = now;
    } else if (countdown > 0) {
      const left = 3 - (now - t0) / 1000;
      const c = Math.ceil(left);
      $("ktMsg").textContent = c > 0 ? ar(c) : "انطلق!";
      if (left <= 0) {
        countdown = 0;
        carEl.style.display = "none";
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
    // (a tall phone screen sees less to the sides: sit further back so the kart doesn't fill it)
    const tall = camera.aspect < 1 ? 1.5 : 1;
    const back = (5.4 + Math.max(0, me.speed - MAX_ROAD) * 0.12) * tall;
    const ch = me.heading - (me.drift ? me.drift * 0.25 : 0);
    const want = new THREE.Vector3(me.x - Math.sin(ch) * back, Math.max(me.y, track.ground(me.x, me.z, me.y, { path: me.path, i: me.i }).h) + 2.4 * tall, me.z - Math.cos(ch) * back);
    camPos.lerp(want, Math.min(1, dt * 14));
    // (never inside a building: slide the camera out of walls)
    if (solids.length) pushOut(solids, camPos, 0.7);
    camera.position.copy(camPos);
    if (shake > 0) {
      shake -= dt;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    look.set(me.x + Math.sin(me.heading) * 6, me.y + 1.2, me.z + Math.cos(me.heading) * 6);
    camera.lookAt(look);
    for (const k of karts) {
      faceCamera(k, camera.position);
      // (a kart right on top of the camera would fill the screen: hide it for that moment)
      if (!k.me) k.g.visible = camera.position.distanceToSquared(k.g.position) > 3.2 ** 2;
    }
    const fov = 60 + Math.max(0, me.speed - 20) * 0.4 + (me.boostT > 0 ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.2) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    live(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  // (testing: step the race by hand where requestAnimationFrame doesn't run)
  Object.assign((window as unknown as { __kart: object }).__kart, {
    step: (ms: number) => frame(ms, true),
    go: () => {
      ready = true;
      carEl.style.display = "none";
    },
    hold: (on: boolean) => (held = on),
    // (testing: look at a kart up close from an angle, in degrees around it)
    show: (deg: number, dist = 4.5, h = 1.6, idx = 7) => {
      held = true;
      const k = karts[idx];
      const a = k.heading + (deg * Math.PI) / 180;
      camera.position.set(k.x + Math.sin(a) * dist, k.y + h, k.z + Math.cos(a) * dist);
      camera.lookAt(k.x, k.y + 0.8, k.z);
      for (const o of karts) faceCamera(o, camera.position);
      live(0);
      renderer.render(scene, camera);
    },
  });
}
