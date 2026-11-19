import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DUCKS } from "../../shared/data";
import { BALL_R, CUP_R, GOLF, MAX_STROKES, courseOf, heightAt, holeOf, surfaceAt, wallsOf, type GolfBall, type Hole } from "../../shared/sports/golf";
import type { Replay, Shot } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";
import { ar, esc, pieceSrc } from "../net";
import { sfx } from "../sfx";
import { GolfAudio } from "./golf/audio";
import { Kit, LOOKS, buildHole, type BuiltHole } from "./golf/build";
import { buildWorld, makePost, type World } from "./golf/props";
import { Tex } from "./golf/tex";
import type { SportView, SportViewFactory, SportViewOpts } from "./view";
import "./golf/golf.css";

/** Mini-golf in three.js. "personal": a chase camera on your ball, slingshot input, others as ghosts.
 *  "screen": the whole hole from a 3/4 view with every ball, name tags and a live leaderboard. */
export const createGolfView: SportViewFactory = (root, opts) => new GolfView(root, opts);

interface Rep {
  b: number[];
  dt: number;
  t0: number;
  n: number;
  label?: string;
  events: { t: number; kind: "wall" | "boing" | "cup" | "splash" | "tube"; v: number; x: number; z: number }[];
  ei: number;
  ended: boolean;
}
interface BallObj {
  id: string;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  tag: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  rep: Rep | null;
  hidden: boolean;
  hideAt: number;
  pop: number;
  ghost: boolean;
  duck: number;
}

const TAU = Math.PI * 2;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const tokenSrc = (duck: number) => pieceSrc(duck);
const CONF_COLORS = ["#ffd23f", "#ff5a4a", "#2fd08c", "#3aa8ff", "#ff7dbe", "#9b7bff", "#ffffff"];

class GolfView implements SportView {
  private wrap: HTMLDivElement;
  private hud: HTMLDivElement;
  private tags: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private tex: Tex;
  private kit: Kit | null = null;
  private built: BuiltHole | null = null;
  private world: World | null = null;
  private hole: Hole | null = null;
  private holeKey = "";
  private holeIdx = 0;
  private balls = new Map<string, BallObj>();
  private ballGeo = new THREE.SphereGeometry(BALL_R * VIS, 32, 18);
  private st: GameState | null = null;
  private lastSeq = -1;
  private first = true;
  private raf = 0;
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private audio: GolfAudio;
  private envTex: THREE.Texture | null = null;
  private offset = 0; // server clock - local clock
  private personal: boolean;
  private input: ((s: Shot) => void) | null = null;
  private pending = 0;
  private drag: { id: number; sx: number; sy: number; cx: number; cy: number; aim: number; power: number } | null = null;
  private aimG = new THREE.Group();
  private arrow!: THREE.Mesh;
  private arrowMat!: THREE.MeshBasicMaterial;
  private dots!: THREE.InstancedMesh;
  private ring!: THREE.Mesh;
  private ringBg!: THREE.Mesh;
  private marker!: THREE.Mesh;
  private camPos = new THREE.Vector3(0, 12, 12);
  private camLook = new THREE.Vector3();
  private camYaw = -Math.PI / 2;
  private snapCam = true;
  private particles!: THREE.Points;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pNext = 0;
  private last = performance.now();
  private hintKey = "";
  private clockSec = -1;
  private boardKey = "";
  private stripKey = "";
  private destroyed = false;
  private els: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement, private opts: SportViewOpts) {
    this.personal = opts.mode === "personal";
    this.audio = new GolfAudio(opts.sound);
    this.wrap = document.createElement("div");
    this.wrap.className = `gv ${this.personal ? "gv-personal" : "gv-screen"}`;
    root.appendChild(this.wrap);
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.wrap.appendChild(this.renderer.domElement);
    this.tex = new Tex(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    const pm = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTex = pm.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pm.dispose();
    this.scene.environment = this.envTex;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight("#ffffff", "#888888", 1);
    this.sun = new THREE.DirectionalLight("#ffffff", 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.aimG);
    this.makeAimBits();
    this.makeParticles();
    this.pVel = new Float32Array(400 * 3);
    this.pLife = new Float32Array(400);

    this.hud = document.createElement("div");
    this.hud.className = "gv-hud";
    this.hud.innerHTML = this.personal
      ? `<div class="gv-tags"></div>
        <div class="gv-top"><div class="gv-badge"><small>حفرة</small><b data-e="no">١</b></div><div class="gv-title"><b data-e="name"></b><span data-e="sub"></span></div><div class="gv-sp"></div>${this.clockHtml()}</div>
        <div class="gv-pips" data-e="pips"></div>
        <div class="gv-power" data-e="power"><span data-e="pw">٠٪</span><div class="bar"><i data-e="pwbar"></i></div></div>
        <div class="gv-strip" data-e="strip"></div>
        <div class="gv-hint" data-e="hint"></div>
        <div class="gv-big" data-e="big"></div>
        <div class="gv-confetti" data-e="conf"></div>`
      : `<div class="gv-tags"></div>
        <div class="gv-top">${this.clockHtml()}<div class="gv-title"><b data-e="name"></b><span data-e="sub"></span></div><div class="gv-badge"><small>حفرة</small><b data-e="no">١</b></div></div>
        <div class="gv-board" data-e="board"></div>
        <div class="gv-tipbox" data-e="tip"></div>
        <div class="gv-confetti" data-e="conf"></div>`;
    this.wrap.appendChild(this.hud);
    this.hud.querySelectorAll<HTMLElement>("[data-e]").forEach((e) => (this.els[e.dataset.e!] = e));
    this.tags = this.hud.querySelector(".gv-tags")!;

    if (this.personal) {
      const el = this.wrap;
      el.addEventListener("pointerdown", this.onDown);
      el.addEventListener("pointermove", this.onMove);
      el.addEventListener("pointerup", this.onUp);
      el.addEventListener("pointercancel", this.onCancel);
      el.addEventListener("lostpointercapture", this.onCancel);
    }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private clockHtml() {
    return `<div class="gv-clock off" data-e="clock"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="17"/><circle class="fg" data-e="clockfg" cx="20" cy="20" r="17" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg><b data-e="sec">٠</b></div>`;
  }

  // ------------------------------------------------------------------ SportView
  render(s: GameState) {
    if (this.destroyed) return;
    this.st = s;
    if (s.serverNow) {
      const o = s.serverNow - Date.now();
      this.offset = Math.abs(o - this.offset) > 1500 ? o : this.offset * 0.7 + o * 0.3;
    }
    const sp = s.sport;
    if (!sp || sp.id !== "golf") return;
    const course = PEEK?.course ?? sp.course, round = PEEK ? PEEK.round : sp.round;
    const key = `${course ?? ""}|${round}`;
    if (key !== this.holeKey) this.loadHole(course, round);
    this.syncBalls(s);
    if (this.first) {
      this.first = false;
      this.lastSeq = s.seq;
    } else this.takeShot(s);
    this.updateHud(s);
  }

  anim(s: GameState) {
    if (this.destroyed) return;
    if (s.anim.kind === "shot") {
      if (this.first) this.render(s);
      else {
        this.st = s;
        this.takeShot(s);
      }
    }
  }

  setInput(cb: ((shot: Shot) => void) | null) {
    this.input = this.personal ? cb : null;
    if (!cb) this.cancelDrag();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.wrap;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("lostpointercapture", this.onCancel);
    this.clearHole();
    for (const b of this.balls.values()) b.mat.dispose();
    this.balls.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.ballGeo.dispose();
    this.envTex?.dispose();
    this.tex.dispose();
    this.audio.destroy();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.wrap.remove();
  }

  // ------------------------------------------------------------------ hole
  private clearHole() {
    if (this.built) {
      this.scene.remove(this.built.group);
      disposeTree(this.built.group);
    }
    if (this.world) {
      this.scene.remove(this.world.group);
      disposeTree(this.world.group);
    }
    this.kit?.dispose();
    this.built = null;
    this.world = null;
    this.kit = null;
  }

  private loadHole(course: string | undefined, round: number) {
    this.clearHole();
    const c = courseOf(course);
    this.hole = holeOf(course, round);
    this.holeIdx = round;
    this.holeKey = `${course ?? ""}|${round}`;
    const look = LOOKS[c.theme];
    this.kit = new Kit(this.tex, look, c.theme);
    const kit = this.kit;
    this.world = buildWorld(kit, this.hole);
    this.built = buildHole(this.hole, kit, round + 1, (kind, r) => makePost(kit, kind, r));
    this.scene.add(this.world.group, this.built.group);
    this.scene.background = new THREE.Color(look.sky[2]);
    this.scene.fog = new THREE.Fog(look.sky[2], look.fog[0], look.fog[1]);
    this.hemi.color.set(look.hemi[0]);
    this.hemi.groundColor.set(look.hemi[1]);
    this.hemi.intensity = look.hemi[2];
    this.sun.color.set(look.sun);
    this.sun.intensity = look.sunI;
    // the shadow camera hugs the hole
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of this.hole.outline) {
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 3.5;
    const d = new THREE.Vector3(...look.sunDir).normalize();
    this.sun.position.set(cx + d.x * 30, d.y * 30, cz + d.z * 30);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 5; sc.far = 70;
    sc.updateProjectionMatrix();
    for (const b of this.balls.values()) {
      b.rep = null;
      b.hidden = false;
      b.hideAt = 0;
    }
    this.cancelDrag();
    this.snapCam = true;
    this.boardKey = "";
    this.stripKey = "";
  }

  // ------------------------------------------------------------------ balls
  private syncBalls(s: GameState) {
    const sp = s.sport!;
    const me = this.opts.me();
    const seen = new Set<string>();
    for (const p of s.players) {
      const lane = sp.lanes[p.id] as GolfBall | undefined;
      if (!lane) continue;
      seen.add(p.id);
      let b = this.balls.get(p.id);
      const ghost = this.personal && p.id !== me;
      if (!b || b.duck !== p.duck || b.ghost !== ghost) {
        if (b) this.removeBall(b);
        b = this.makeBall(p.id, p.duck, ghost);
        this.balls.set(p.id, b);
      }
      b.tag.querySelector("span")!.textContent = p.name;
      if (PEEK && this.hole) {
        // preview: balls staged around the hole (screenshots / menu thumbnail)
        const i = s.players.indexOf(p);
        const [tx, tz] = this.hole.tee, [cx, cz] = this.hole.cup;
        const f = [0.15, 0.55, 0.8, 0.35, 0.95, 0.68][i % 6];
        b.x = tx + (cx - tx) * f + Math.sin(i * 2.3) * 0.45;
        b.z = tz + (cz - tz) * f + Math.cos(i * 1.7) * 0.3;
        b.y = heightAt(this.hole, b.x, b.z) + BALL_R;
        b.hidden = false;
      } else if (!b.rep) {
        b.x = lane.x;
        b.z = lane.z;
        b.y = this.hole ? heightAt(this.hole, lane.x, lane.z) + BALL_R : BALL_R;
        if (lane.holed && !b.hidden && !b.hideAt) b.hidden = true;
        if (!lane.holed) b.hidden = false;
      }
    }
    for (const [id, b] of this.balls) if (!seen.has(id)) this.removeBall(b);
  }

  private makeBall(id: string, duck: number, ghost: boolean): BallObj {
    const col = DUCKS[duck]?.color ?? "#ffd23f";
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.ball(col), roughness: 0.32, metalness: 0, envMapIntensity: 1.1, transparent: ghost, opacity: ghost ? 0.55 : 1, depthWrite: !ghost });
    const mesh = new THREE.Mesh(this.ballGeo, mat);
    mesh.castShadow = !ghost;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.scene.add(mesh);
    const tag = document.createElement("div");
    tag.className = `gv-tag${ghost ? " ghost" : ""}${this.personal && !ghost ? " me" : ""}`;
    tag.style.setProperty("--c", col);
    tag.innerHTML = `${this.personal ? "" : `<img src="${tokenSrc(duck)}" alt="">`}<span></span>`;
    this.tags.appendChild(tag);
    return { id, mesh, mat, tag, x: 0, y: BALL_R, z: 0, rep: null, hidden: false, hideAt: 0, pop: 0, ghost, duck };
  }

  private removeBall(b: BallObj) {
    this.scene.remove(b.mesh);
    b.mat.dispose();
    b.tag.remove();
    this.balls.delete(b.id);
  }

  private takeShot(s: GameState) {
    if (s.seq === this.lastSeq || PEEK) return;
    this.lastSeq = s.seq;
    const a = s.anim;
    if (a.kind !== "shot") return;
    const b = this.balls.get(a.playerId);
    if (!b || !this.hole) return;
    this.startReplay(b, a.replay);
    if (a.playerId === this.opts.me()) this.pending = 0;
  }

  private startReplay(b: BallObj, r: Replay) {
    const h = this.hole!;
    const n = Math.floor(r.ball.length / 3);
    if (n < 1) return;
    const ev: Rep["events"] = [];
    const P = (i: number) => [r.ball[i * 3], r.ball[i * 3 + 1], r.ball[i * 3 + 2]];
    const bumpers = h.posts?.filter((p) => p.bounce) ?? [];
    let wet = false, cupped = false;
    for (let i = 1; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i);
      const jump = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      if (jump > 0.6) {
        if (!r.label?.startsWith("ماي") || i < n - 1) ev.push({ t: i * r.dt, kind: "tube", v: 1, x: p1[0], z: p1[2] });
        continue;
      }
      if (!wet && r.label?.startsWith("ماي") && surfaceAt(h, p1[0], p1[2]) === "water") {
        wet = true;
        ev.push({ t: i * r.dt, kind: "splash", v: 1, x: p1[0], z: p1[2] });
      }
      if (!cupped && Math.hypot(p1[0] - h.cup[0], p1[2] - h.cup[1]) < CUP_R && p1[1] < heightAt(h, h.cup[0], h.cup[1]) + BALL_R - 0.05) {
        cupped = true;
        ev.push({ t: i * r.dt, kind: "cup", v: 1, x: h.cup[0], z: h.cup[1] });
      }
      if (i < n - 1) {
        const p2 = P(i + 1);
        const ax = p1[0] - p0[0], az = p1[2] - p0[2], bx = p2[0] - p1[0], bz = p2[2] - p1[2];
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
        if (la > 0.012 && lb > 0.012 && lb < 0.6) {
          const cos = (ax * bx + az * bz) / (la * lb);
          if (cos < 0.8) {
            const near = bumpers.some((q) => Math.hypot(p1[0] - q.x, p1[2] - q.z) < q.r + BALL_R + 0.2);
            const last = ev[ev.length - 1];
            if (!last || i * r.dt - last.t > 0.1) ev.push({ t: i * r.dt, kind: near ? "boing" : "wall", v: (la / r.dt + lb / r.dt) / 2, x: p1[0], z: p1[2] });
          }
        }
      }
    }
    b.rep = { b: r.ball, dt: r.dt, t0: performance.now(), n, label: r.label, events: ev, ei: 0, ended: false };
    b.hidden = false;
    b.hideAt = 0;
    const isMe = b.id === this.opts.me();
    if (this.wantSound(b)) {
      const p1 = P(Math.min(1, n - 1)), p0 = P(0);
      this.audio.putt(Math.min(1, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / r.dt / 7));
    }
    if (isMe) this.cancelDrag();
  }

  private wantSound(b: BallObj) {
    return this.opts.sound && (!this.personal || b.id === this.opts.me());
  }

  private stepReplay(b: BallObj, now: number) {
    const r = b.rep!;
    const t = (now - r.t0) / 1000;
    const f = t / r.dt;
    let i = Math.floor(f);
    const px = b.x, pz = b.z;
    if (i >= r.n - 1) {
      i = r.n - 1;
      b.x = r.b[i * 3];
      b.y = r.b[i * 3 + 1];
      b.z = r.b[i * 3 + 2];
    } else {
      const k = f - i;
      const a = i * 3, c = (i + 1) * 3;
      const jump = Math.hypot(r.b[c] - r.b[a], r.b[c + 2] - r.b[a + 2]) > 0.6;
      if (jump) {
        b.x = r.b[a];
        b.y = r.b[a + 1];
        b.z = r.b[a + 2];
      } else {
        b.x = r.b[a] + (r.b[c] - r.b[a]) * k;
        b.y = r.b[a + 1] + (r.b[c + 1] - r.b[a + 1]) * k;
        b.z = r.b[a + 2] + (r.b[c + 2] - r.b[a + 2]) * k;
      }
    }
    // teleport (tube exit / back from the water): pop in
    if (Math.hypot(b.x - px, b.z - pz) > 0.6) b.pop = now;
    while (r.ei < r.events.length && r.events[r.ei].t <= t) this.fire(b, r.events[r.ei++]);
    // springy bumpers
    if (this.built)
      for (const q of this.built.bumpers) if (Math.hypot(b.x - q.x, b.z - q.z) < q.r + BALL_R + 0.03 && now - q.hit > 250) q.hit = now;
    if (i >= r.n - 1 && !r.ended) {
      r.ended = true;
      this.endReplay(b);
    }
  }

  private fire(b: BallObj, e: Rep["events"][number]) {
    const snd = this.wantSound(b);
    if (e.kind === "wall") snd && this.audio.wall(e.v);
    else if (e.kind === "boing") snd && this.audio.boing();
    else if (e.kind === "tube") snd && this.audio.whoosh();
    else if (e.kind === "cup") {
      if (snd) this.audio.cup();
      this.burst(e.x, (this.hole ? heightAt(this.hole, e.x, e.z) : 0) + 0.05, e.z, 70, "confetti");
    } else if (e.kind === "splash") {
      if (snd) this.audio.splash();
      this.burst(e.x, 0.05, e.z, 46, "splash");
    }
  }

  private endReplay(b: BallObj) {
    const r = b.rep!;
    const me = this.opts.me();
    const lane = this.st?.sport?.lanes[b.id] as GolfBall | undefined;
    const holed = !!lane?.holed && r.label !== undefined && !r.label.startsWith("ماي") && !r.label.startsWith("خلص");
    const water = !!r.label?.startsWith("ماي");
    if (holed) b.hideAt = performance.now() + 900;
    if (r.label) {
      if (this.personal && b.id === me) {
        const hio = r.label === GOLF_HIO;
        const strokes = lane?.strokes[lane.hole] ?? 0;
        const par = this.hole?.par ?? 3;
        const sub = holed ? (hio ? "ضربة وحدة بس!" : `${ar(strokes)} ${strokes === 1 ? "ضربة" : "ضربات"} · بار ${ar(par)}`) : water ? "رجعت الكرة لمكانها" : "";
        this.bigText(r.label, sub, hio ? "hio" : holed ? "holed" : water ? "water" : "out");
        if (holed) this.confetti(hio ? 90 : 50);
        if (this.opts.sound && holed) (hio ? sfx.fanfare : sfx.star)();
        if (this.opts.sound && !holed && !water) sfx.bad();
      } else if (!this.personal) {
        const p = this.st?.players.find((x) => x.id === b.id);
        if (p) this.toast(b, `${p.name}: ${r.label}`, water);
        if (this.opts.sound && r.label === GOLF_HIO) sfx.fanfare();
        else if (this.opts.sound && holed) sfx.coin();
      }
    }
    b.rep = null;
    // settle on the lane's resting spot
    if (lane && this.hole) {
      b.x = lane.x;
      b.z = lane.z;
      b.y = holed ? heightAt(this.hole, lane.x, lane.z) + BALL_R - 0.17 : heightAt(this.hole, lane.x, lane.z) + BALL_R;
    }
  }

  // ------------------------------------------------------------------ input (slingshot)
  private myBall() {
    const me = this.opts.me();
    return me ? this.balls.get(me) : undefined;
  }
  private myLane() {
    const me = this.opts.me();
    return me ? (this.st?.sport?.lanes[me] as GolfBall | undefined) : undefined;
  }
  private canAim() {
    const b = this.myBall(), lane = this.myLane();
    return !!(this.input && b && !b.rep && lane && GOLF.canShoot(lane) && this.st?.phase === "sport" && (!this.pending || performance.now() - this.pending > 2500));
  }

  private toLocal(e: PointerEvent) {
    const r = this.wrap.getBoundingClientRect();
    const k = this.w / (r.width || 1);
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }

  private onDown = (e: PointerEvent) => {
    this.audio.wake();
    if (this.drag || !this.canAim()) return;
    if (e.button !== undefined && e.button > 0) return;
    const [x, y] = this.toLocal(e);
    this.drag = { id: e.pointerId, sx: x, sy: y, cx: x, cy: y, aim: 0, power: 0 };
    try {
      this.wrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    [d.cx, d.cy] = this.toLocal(e);
    this.updateAim();
    e.preventDefault();
  };
  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    [d.cx, d.cy] = this.toLocal(e);
    this.updateAim();
    const shoot = d.power >= 0.03 && this.canAim();
    const shot: Shot = { aim: d.aim, power: d.power, spin: 0, start: 0 };
    this.cancelDrag();
    if (shoot && this.input) {
      this.pending = performance.now();
      this.input(shot);
      if (navigator.vibrate) navigator.vibrate(18);
    }
  };
  private onCancel = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) this.cancelDrag();
  };
  private cancelDrag() {
    this.drag = null;
    this.aimG.visible = false;
    this.els.power?.classList.remove("on");
    this.wrap.classList.remove("aiming");
  }

  private updateAim() {
    const d = this.drag, b = this.myBall();
    if (!d || !b || !this.hole) return;
    const dx = d.sx - d.cx, dy = d.sy - d.cy;
    const len = Math.hypot(dx, dy);
    const maxDrag = Math.max(110, Math.min(300, Math.min(this.w, this.h) * 0.42));
    if (len < 12) {
      d.power = 0;
      this.aimG.visible = false;
      this.els.power.classList.remove("on");
      return;
    }
    // direction: from the ball's screen spot, the way the finger was pulled from (slingshot)
    const bp = new THREE.Vector3(b.x, b.y, b.z).project(this.camera);
    const bx = (bp.x + 1) * 0.5 * this.w, by = (1 - bp.y) * 0.5 * this.h;
    const tx = bx + (dx / len) * 60, ty = by + (dy / len) * 60;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((tx / this.w) * 2 - 1, 1 - (ty / this.h) * 2), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.y);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return;
    d.aim = Math.atan2(hit.z - b.z, hit.x - b.x);
    d.power = Math.min(1, (len - 12) / maxDrag);
    this.drawAim(b, d.aim, d.power);
    this.els.power.classList.add("on");
    this.wrap.classList.add("aiming");
    this.els.pw.textContent = `${ar(Math.round(d.power * 100))}٪`;
    (this.els.pwbar as HTMLElement).style.width = `${Math.round(d.power * 100)}%`;
  }

  private makeAimBits() {
    // arrow along +x, unit length shaft + head
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.045);
    shape.lineTo(0.82, -0.045);
    shape.lineTo(0.82, -0.12);
    shape.lineTo(1, 0);
    shape.lineTo(0.82, 0.12);
    shape.lineTo(0.82, 0.045);
    shape.lineTo(0, 0.045);
    const ag = new THREE.ShapeGeometry(shape);
    ag.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
    this.arrow = new THREE.Mesh(ag, this.arrowMat);
    this.arrow.renderOrder = 20;
    const dg = new THREE.CircleGeometry(0.03, 12);
    dg.rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthTest: false }), 90);
    this.dots.renderOrder = 19;
    this.dots.frustumCulled = false;
    this.ringBg = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 48), new THREE.MeshBasicMaterial({ color: "#2b1b45", transparent: true, opacity: 0.45, depthTest: false }));
    this.ringBg.rotation.x = -Math.PI / 2;
    this.ringBg.renderOrder = 18;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 48, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: "#ffd23f", depthTest: false, transparent: true }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 19;
    this.aimG.add(this.dots, this.ringBg, this.ring, this.arrow);
    this.aimG.visible = false;
    // "your ball" marker
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.2, 40), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 5;
    this.scene.add(this.marker);
  }

  private drawAim(b: BallObj, aim: number, power: number) {
    const h = this.hole!;
    const col = new THREE.Color().setHSL(0.33 - power * 0.33, 0.85, 0.55);
    this.aimG.visible = true;
    this.aimG.position.set(0, 0, 0);
    const y = b.y - BALL_R + 0.02;
    this.arrow.position.set(b.x + Math.cos(aim) * 0.24, y + 0.01, b.z + Math.sin(aim) * 0.24);
    this.arrow.rotation.y = -aim;
    this.arrow.scale.set(0.3 + power * 1.9, 1, 1 + power * 0.4);
    this.arrowMat.color.copy(col);
    this.ringBg.position.set(b.x, y, b.z);
    this.ring.position.set(b.x, y + 0.001, b.z);
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(0.2, 0.25, 48, 1, Math.PI / 2, -Math.max(0.01, power * TAU));
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(col);
    // dotted path until the first wall, then a short bounce stub
    const walls = wallsOf(h);
    const posts = h.posts ?? [], pipes = h.pipes ?? [];
    let x = b.x, z = b.z, dx = Math.cos(aim), dz = Math.sin(aim);
    const m = new THREE.Matrix4();
    let k = 0, travelled = 0, sinceDot = 0, bounced = false, after = 0;
    const step = 0.03;
    const maxLen = 1.2 + power * 9;
    while (k < 90 && travelled < maxLen) {
      x += dx * step;
      z += dz * step;
      travelled += step;
      sinceDot += step;
      if (bounced) after += step;
      if (bounced && after > 0.8) break;
      if (surfaceAt(h, x, z) === "water" && !bounced) {
        // stop the hint at the water's edge
      }
      // collision
      let nx = 0, nz = 0, hit = false;
      for (let i = 0; i < walls.length && !hit; i += 4) {
        const q = closestPt(x, z, walls[i], walls[i + 1], walls[i + 2], walls[i + 3]);
        const ddx = x - q[0], ddz = z - q[1], dd = Math.hypot(ddx, ddz);
        if (dd < BALL_R) {
          hit = true;
          nx = ddx / (dd || 1);
          nz = ddz / (dd || 1);
        }
      }
      for (const p of posts) {
        const ddx = x - p.x, ddz = z - p.z, dd = Math.hypot(ddx, ddz);
        if (!hit && dd < p.r + BALL_R) {
          hit = true;
          nx = ddx / dd;
          nz = ddz / dd;
        }
      }
      for (const p of pipes) {
        const q = closestPt(x, z, p.a[0], p.a[1], p.b[0], p.b[1]);
        const ddx = x - q[0], ddz = z - q[1], dd = Math.hypot(ddx, ddz);
        if (!hit && dd < p.r + BALL_R) {
          hit = true;
          nx = ddx / dd;
          nz = ddz / dd;
        }
      }
      if (hit) {
        if (bounced) break;
        const vn = dx * nx + dz * nz;
        dx -= 2 * vn * nx;
        dz -= 2 * vn * nz;
        x += nx * 0.02;
        z += nz * 0.02;
        bounced = true;
        continue;
      }
      if (sinceDot >= 0.16 && travelled > 0.3) {
        sinceDot = 0;
        const fade = bounced ? 0.7 - after * 0.6 : 1 - (travelled / maxLen) * 0.55;
        const s = Math.max(0.35, fade);
        m.makeScale(s, 1, s).setPosition(x, heightAt(h, x, z) + 0.015, z);
        this.dots.setMatrixAt(k++, m);
      }
    }
    this.dots.count = k;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ effects
  private makeParticles() {
    const n = 400;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3).fill(-100);
    const col = new Float32Array(n * 3).fill(1);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, map: this.tex.glow(), transparent: true, depthWrite: false, sizeAttenuation: true });
    this.particles = new THREE.Points(g, m);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 10;
    this.scene.add(this.particles);
  }

  private burst(x: number, y: number, z: number, count: number, kind: "confetti" | "splash") {
    const pos = this.particles.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.particles.geometry.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = this.pNext++ % 400;
      const a = Math.random() * TAU;
      const sp = kind === "splash" ? 0.4 + Math.random() * 0.9 : 0.6 + Math.random() * 1.6;
      pos.setXYZ(k, x, y, z);
      this.pVel[k * 3] = Math.cos(a) * sp * (kind === "splash" ? 0.6 : 1);
      this.pVel[k * 3 + 1] = kind === "splash" ? 1.6 + Math.random() * 1.8 : 2.2 + Math.random() * 2.4;
      this.pVel[k * 3 + 2] = Math.sin(a) * sp * (kind === "splash" ? 0.6 : 1);
      this.pLife[k] = kind === "splash" ? 0.7 + Math.random() * 0.4 : 1.3 + Math.random() * 0.8;
      c.set(kind === "splash" ? (Math.random() < 0.5 ? "#ffffff" : "#9ff2ff") : CONF_COLORS[i % CONF_COLORS.length]);
      col.setXYZ(k, c.r, c.g, c.b);
    }
    pos.needsUpdate = col.needsUpdate = true;
  }

  private stepParticles(dt: number) {
    const pos = this.particles.geometry.attributes.position as THREE.BufferAttribute;
    let any = false;
    for (let k = 0; k < 400; k++) {
      if (this.pLife[k] <= 0) continue;
      any = true;
      this.pLife[k] -= dt;
      this.pVel[k * 3 + 1] -= 6.5 * dt;
      const x = pos.getX(k) + this.pVel[k * 3] * dt;
      const y = pos.getY(k) + this.pVel[k * 3 + 1] * dt;
      const z = pos.getZ(k) + this.pVel[k * 3 + 2] * dt;
      if (this.pLife[k] <= 0 || y < -0.5) {
        this.pLife[k] = 0;
        pos.setXYZ(k, 0, -100, 0);
      } else pos.setXYZ(k, x, y, z);
    }
    if (any) pos.needsUpdate = true;
  }

  private bigText(label: string, sub: string, kind: string) {
    const el = this.els.big;
    if (!el) return;
    el.className = "gv-big";
    void el.offsetWidth;
    el.className = `gv-big show ${kind}`;
    el.innerHTML = `<b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
  }

  private confetti(n: number) {
    const box = this.els.conf;
    if (!box) return;
    let html = "";
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 100;
      html += `<i style="left:${x}%;background:${CONF_COLORS[i % CONF_COLORS.length]};--x:${(Math.random() - 0.5) * 160}px;--r:${(Math.random() - 0.5) * 1400}deg;--d:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * 0.35}s"></i>`;
    }
    box.innerHTML = html;
    window.setTimeout(() => {
      if (!this.destroyed) box.innerHTML = "";
    }, 3800);
  }

  private toast(b: BallObj, text: string, water: boolean) {
    const t = document.createElement("div");
    t.className = `gv-toast${water ? " water" : ""}`;
    t.textContent = text;
    this.tags.appendChild(t);
    const v = new THREE.Vector3(b.x, b.y + 0.35, b.z).project(this.camera);
    const x = (v.x + 1) * 0.5 * this.w, y = (1 - v.y) * 0.5 * this.h;
    t.style.transform = `translate(-50%, -100%) translate(${x}px, ${y - 30}px)`;
    t.style.left = "0";
    t.style.top = "0";
    t.style.translate = "none";
    t.style.transform = `translate(${x}px, ${y - 30}px) translate(-50%, -100%)`;
    window.setTimeout(() => t.remove(), 2500);
  }

  // ------------------------------------------------------------------ HUD
  private updateHud(s: GameState) {
    const sp = s.sport;
    if (!sp || !this.hole) return;
    const h = this.hole;
    const c = courseOf(PEEK?.course ?? sp.course);
    this.els.no.textContent = ar(this.holeIdx + 1);
    this.els.name.textContent = h.name;
    const me = this.opts.me();
    const lane = this.myLane();
    if (this.personal) {
      const n = lane?.strokes[lane.hole] ?? 0;
      this.els.sub.innerHTML = `${esc(c.name)} · بار ${ar(h.par)} · المجموع <i>${ar(me ? sp.total[me] ?? 0 : 0)}</i>`;
      let pips = "";
      for (let i = 0; i < MAX_STROKES; i++) pips += `<i class="${i < Math.min(n, MAX_STROKES) ? "on" : ""}"></i>`;
      this.els.pips.innerHTML = `${pips}<span>${lane?.holed ? "في الحفرة" : `ضربة ${ar(Math.min(MAX_STROKES, n + (lane?.done ? 0 : 1)))}`}</span>`;
      // others
      const others = s.players.filter((p) => p.id !== me).slice(0, 7);
      const key = others.map((p) => {
        const l = sp.lanes[p.id] as GolfBall | undefined;
        return `${p.id}${p.duck}${l?.strokes[l.hole]}${l?.holed}`;
      }).join("|");
      if (key !== this.stripKey) {
        this.stripKey = key;
        this.els.strip.innerHTML = others
          .map((p) => {
            const l = sp.lanes[p.id] as GolfBall | undefined;
            const v = l?.strokes[l.hole] ?? 0;
            return `<div class="gv-chip${l?.holed ? " in" : ""}" title="${esc(p.name)}"><img src="${tokenSrc(p.duck)}" alt=""><b>${l?.holed ? "✓" : ar(v)}</b></div>`;
          })
          .join("");
      }
    } else {
      this.els.sub.innerHTML = `${esc(c.name)} · بار ${ar(h.par)} · ${ar(this.holeIdx + 1)} من ${ar(sp.rounds)}`;
      this.els.tip.innerHTML = `<b>فكرة الحفرة:</b> ${esc(h.tip)}`;
      const rows = [...s.players].sort((a, b) => (sp.total[a.id] ?? 0) - (sp.total[b.id] ?? 0) || a.name.localeCompare(b.name));
      const key = rows.map((p) => {
        const l = sp.lanes[p.id] as GolfBall | undefined;
        return `${p.id}${p.duck}${sp.total[p.id]}${l?.strokes[l.hole]}${l?.holed}${l?.done}`;
      }).join("|");
      if (key !== this.boardKey) {
        this.boardKey = key;
        let rank = 0, prev = -1;
        this.els.board.innerHTML =
          `<h3><span>الترتيب</span><span>الضربات</span></h3>` +
          rows
            .map((p, i) => {
              const l = sp.lanes[p.id] as GolfBall | undefined;
              const tot = sp.total[p.id] ?? 0;
              if (tot !== prev) rank = i + 1;
              prev = tot;
              const v = l?.strokes[l.hole] ?? 0;
              const st = l?.holed ? `<small class="in">في الحفرة · ${ar(v)}</small>` : l?.done ? `<small>خلص · ${ar(v)}</small>` : `<small>هالحفرة: ${ar(v)}</small>`;
              return `<div class="gv-row${rank === 1 && tot > 0 ? " lead" : ""}"><div class="rk">${ar(rank)}</div><img src="${tokenSrc(p.duck)}" alt=""><div class="nm">${esc(p.name)}${st}</div><div class="sw" style="background:${DUCKS[p.duck]?.color}"></div><div class="tt">${ar(tot)}</div></div>`;
            })
            .join("");
      }
    }
  }

  private updateClock() {
    const s = this.st;
    const el = this.els.clock;
    if (!el) return;
    if (!s || s.phase !== "sport" || !s.phaseEndsAt) {
      if (!el.classList.contains("off")) el.classList.add("off");
      return;
    }
    const left = Math.max(0, s.phaseEndsAt - this.offset - Date.now());
    const total = GOLF.roundSeconds * 1000;
    const sec = Math.ceil(left / 1000);
    el.classList.remove("off");
    if (sec !== this.clockSec) {
      this.clockSec = sec;
      this.els.sec.textContent = ar(sec);
      el.classList.toggle("low", sec <= 10);
    }
    this.els.clockfg.setAttribute("stroke-dashoffset", String(106.8 * (1 - Math.min(1, left / total))));
  }

  private updateHint() {
    if (!this.personal) return;
    const el = this.els.hint;
    const lane = this.myLane();
    const b = this.myBall();
    let key = "", text = "";
    if (this.st?.phase === "sport" && lane && b) {
      if (this.drag && this.drag.power > 0) key = "";
      else if (this.canAim()) {
        key = "on";
        text = "اسحب ورا وفك";
      } else if (lane.done && !b.rep) {
        key = "wait";
        text = "خلصت الحفرة · انتظر الباقين";
      }
    }
    if (key + text !== this.hintKey) {
      this.hintKey = key + text;
      el.className = `gv-hint${key ? ` on ${key === "wait" ? "wait" : ""}` : ""}`;
      if (text) el.textContent = text;
    }
  }

  // ------------------------------------------------------------------ camera
  private resize() {
    const w = this.root.clientWidth || 1, h = this.root.clientHeight || 1;
    const rect = this.root.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / w : 1;
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * scale));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 50 : 42;
    this.camera.updateProjectionMatrix();
    const u = this.personal ? Math.max(0.78, Math.min(1.45, Math.min(w / 390, h / 560))) : Math.max(0.6, Math.min(2.4, Math.min(w / 1000, h / 560)));
    this.wrap.style.setProperty("--u", `${u}px`);
    this.wrap.classList.toggle("short", h < 460);
    this.snapCam = true;
  }

  /** camera that frames `pts` looking along `yaw` at `pitch`; `ox` shifts the frame centre (screen panel) */
  private fit(pts: THREE.Vector3[], yaw: number, pitch: number, ox = 0, margin = 1.1): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const f = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), -Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f).normalize();
    const ty = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / margin;
    const tx = ty * this.camera.aspect;
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.multiplyScalar(1 / pts.length);
    let D = 1;
    const tmp = new THREE.Vector3();
    for (let it = 0; it < 4; it++) {
      D = 0.5;
      for (const p of pts) {
        tmp.subVectors(p, c);
        const px = tmp.dot(r), py = tmp.dot(u), pz = tmp.dot(f);
        D = Math.max(D, Math.abs(px) / (tx * (1 - Math.abs(ox))) - pz, Math.abs(py) / ty - pz);
      }
      // recentre on the projected extents
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        tmp.subVectors(p, c);
        const depth = tmp.dot(f) + D;
        const nx = tmp.dot(r) / (depth * tx), ny = tmp.dot(u) / (depth * ty);
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
      }
      const sx = ((x0 + x1) / 2 - ox) * D * tx, sy = ((y0 + y1) / 2) * D * ty;
      c.addScaledVector(r, sx).addScaledVector(u, sy);
    }
    return { pos: c.clone().addScaledVector(f, -D), look: c };
  }

  private updateCamera(dt: number, now: number) {
    const h = this.hole;
    if (!h) return;
    const hf = (x: number, z: number) => heightAt(h, x, z);
    const me = this.myBall();
    let want: { pos: THREE.Vector3; look: THREE.Vector3 };
    let k = 2.6;
    if (this.personal && me) {
      const ball = new THREE.Vector3(me.x, me.y, me.z);
      const cup = new THREE.Vector3(h.cup[0], hf(h.cup[0], h.cup[1]), h.cup[1]);
      if (!me.rep && !this.drag) {
        const dist = Math.hypot(cup.x - ball.x, cup.z - ball.z);
        if (dist > 0.3) this.camYaw = lerpAngle(this.camYaw, Math.atan2(cup.z - ball.z, cup.x - ball.x), damp(3, dt));
      }
      const portrait = this.w / this.h < 0.9;
      const pitch = portrait ? 0.84 : 0.74;
      const span = portrait ? 1.25 : 1.4;
      const pts = [ball, cup, cup.clone().add(new THREE.Vector3(0, 1.1, 0))];
      for (const [dx, dz] of [[span, 0], [-span, 0], [0, span], [0, -span]]) pts.push(new THREE.Vector3(ball.x + dx, ball.y, ball.z + dz));
      want = this.fit(pts, this.camYaw, pitch, 0, 1.06);
      // never zoom out so far that the ball is a speck: then frame the ball and the way ahead
      const maxD = portrait ? 7.6 : 6.8;
      if (want.pos.distanceTo(want.look) > maxD) {
        const ahead = new THREE.Vector3(Math.cos(this.camYaw), 0, Math.sin(this.camYaw)).multiplyScalar(4.2).add(ball);
        ahead.y = hf(ahead.x, ahead.z);
        const p2 = [ball, ahead];
        for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) p2.push(new THREE.Vector3(ball.x + dx, ball.y, ball.z + dz));
        want = this.fit(p2, this.camYaw, pitch, 0, 1.05);
      }
      k = me.rep ? 3.2 : 2.4;
    } else {
      const yaw = Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]) + Math.sin(now / 6000) * 0.035;
      const ox = this.personal || PEEK?.thumb ? 0 : -Math.min(0.32, (280 * parseFloat(this.wrap.style.getPropertyValue("--u") || "1")) / this.w);
      want = this.fit(this.built?.frame ?? [], yaw, 0.76, ox, 1.04);
      k = 1.6;
    }
    if (this.snapCam) {
      // start high above the hole and swoop in
      this.snapCam = false;
      const yaw = Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]);
      const over = this.fit(this.built?.frame ?? [want.look], yaw, 1.2, 0, 1.0);
      this.camPos.copy(over.pos).lerp(want.pos, 0.2).add(new THREE.Vector3(0, 2, 0));
      this.camLook.copy(over.look).lerp(want.look, 0.3);
    }
    const a = damp(k, dt);
    this.camPos.lerp(want.pos, a);
    this.camLook.lerp(want.look, a);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ------------------------------------------------------------------ frame loop
  private loop() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    if (!this.hole || !this.built) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // balls
    for (const b of this.balls.values()) {
      const ox = b.x, oz = b.z;
      if (b.rep) this.stepReplay(b, now);
      if (b.hideAt && now > b.hideAt) {
        b.hidden = true;
        b.hideAt = 0;
      }
      const dx = b.x - ox, dz = b.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 0.6) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz / d, 0, -dx / d), d / BALL_R);
        b.mesh.quaternion.premultiply(q);
      }
      b.mesh.position.set(b.x, b.y + BALL_R * (VIS - 1), b.z);
      const pop = b.pop ? Math.min(1, (now - b.pop) / 350) : 1;
      b.mesh.scale.setScalar(pop < 1 ? 0.3 + 0.7 * easeOutBack(pop) : 1);
      b.mesh.visible = !b.hidden;
      // name tags
      const showTag = !b.hidden && (!this.personal || b.ghost) && !PEEK?.thumb;
      if (showTag) {
        const v = new THREE.Vector3(b.x, b.y + BALL_R + 0.06, b.z).project(this.camera);
        const x = (v.x + 1) * 0.5 * this.w, y = (1 - v.y) * 0.5 * this.h;
        const off = v.z > 1 || x < -60 || x > this.w + 60 || y < -40 || y > this.h + 40;
        b.tag.classList.toggle("hidden", off);
        if (!off) b.tag.style.transform = `translate(${x.toFixed(1)}px, ${(y - 6).toFixed(1)}px) translate(-50%, -100%)`;
      } else b.tag.classList.add("hidden");
    }
    // my marker
    const me = this.myBall();
    const showMarker = this.personal && !!me && !me.hidden && !me.rep;
    this.marker.visible = showMarker;
    if (showMarker && me) {
      const pulse = this.canAim() ? 1 + Math.sin(t * 5) * 0.12 : 1;
      this.marker.position.set(me.x, me.y - BALL_R + 0.012, me.z);
      this.marker.scale.setScalar(pulse);
      (this.marker.material as THREE.MeshBasicMaterial).color.set(DUCKS[me.duck]?.color ?? "#fff");
    }
    if (this.drag && me) this.ring.position.set(me.x, me.y - BALL_R + 0.021, me.z);
    // flag waves
    const fg = this.built.flag.geometry.attributes.position as THREE.BufferAttribute;
    const base = this.built.flagBase;
    for (let i = 0; i < fg.count; i++) {
      const x = base[i * 3];
      fg.setZ(i, Math.sin(x * 9 - t * 5.5) * 0.045 * (x / 0.5) + Math.sin(x * 4 - t * 2.3) * 0.02 * (x / 0.5));
    }
    fg.needsUpdate = true;
    this.built.flag.geometry.computeVertexNormals();
    // bumpers
    for (const q of this.built.bumpers) {
      const e = (now - q.hit) / 1000;
      const s = e < 0.6 ? 1 + Math.sin(e * 30) * 0.12 * Math.exp(-e * 6) : 1;
      q.obj.scale.set(s, 1 + (s - 1) * 0.5, s);
      const ring = q.obj.getObjectByName("ring") as THREE.Mesh | undefined;
      if (ring) (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + (e < 0.5 ? (0.5 - e) * 3 : 0);
    }
    for (const bb of this.built.bubbles) {
      const p = bb.curve.getPointAt((t * 0.18 + bb.off) % 1);
      bb.mesh.position.copy(p);
    }
    if (this.kit) for (const w of this.kit.waters) w.uniforms.uTime.value = t;
    if (this.world) {
      for (const o of this.world.bobbers) {
        o.position.y = -0.42 + Math.sin(t * 1.3 + o.userData.bob) * 0.04;
        o.rotation.z = Math.sin(t * 1.1 + o.userData.bob) * 0.06;
      }
      for (const o of this.world.spinners) o.rotation.y += dt * o.userData.spin;
    }
    this.stepParticles(dt);
    this.updateCamera(dt, now);
    this.updateClock();
    this.updateHint();
    if (this.pending && now - this.pending > 2500) this.pending = 0;
    this.renderer.render(this.scene, this.camera);
  }
}

/** `?golfpeek=lab:2` shows that course's hole 2 instead of the live one, with the balls staged on it. View only (the game
 *  itself is untouched); used for review screenshots and the menu thumbnail. */
const PEEK = (() => {
  try {
    const m = /^(\w+):(\d)$/.exec(new URLSearchParams(location.search).get("golfpeek") ?? "");
    return m ? { course: m[1], round: Math.max(0, +m[2] - 1), thumb: new URLSearchParams(location.search).has("golfthumb") } : null;
  } catch {
    return null;
  }
})();

/** the ball is drawn a little bigger than its physics radius so it reads on a phone */
const VIS = 1.3;
const GOLF_HIO = "هول إن ون!";

function closestPt(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + dx * t, az + dz * t];
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
}

const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
