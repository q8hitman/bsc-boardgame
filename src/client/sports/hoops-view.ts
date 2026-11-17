// سلة البط (Duck Hoops): a rooftop court in Kuwait City by night, one hoop per player.
// - personal: the camera stands at the player's spot; drag the ball and flick it up to shoot.
// - screen:   every hoop in a row, all shots play at once, with a leaderboard.
import * as THREE from "three";
import "./hoops/hoops.css";
import { DUCKS } from "../../shared/data";
import {
  HOOPS,
  HOOP_SHOTS,
  HOOP_SPOTS,
  RIM_Y,
  SLIDE_A,
  SLIDE_W,
  hoopSpot,
  hoopsIdeal,
  hoopsLaunch,
  type HoopsLane,
} from "../../shared/sports/hoops";
import type { Replay, Shot } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";
import { ar, esc } from "../net";
import { ballSvg } from "./hoops/art";
import { HoopsAudio } from "./hoops/audio";
import { SPACING, animateNet, makeAssets, makeLane, makeWorld, type Lane } from "./hoops/world";
import type { SportView, SportViewFactory } from "./view";

const G = 9.81;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpC = new THREE.Color();
const FLAME = ["#fff3a0", "#ffd23f", "#ffa01a", "#ff6a10", "#ff3a0a"].map((c) => new THREE.Color(c));
const CONF = ["#ffd23f", "#ff5a4a", "#2fd08c", "#3aa8ff", "#ff7dbe", "#fffdf6"].map((c) => new THREE.Color(c));

interface Play {
  rp: Replay;
  t0: number;
  n: number;
  hoop: number[];
  ev: number[];
  evI: number;
  /** shot taken while on fire */
  fire: boolean;
  /** this shot lit the fire: flames start at the net */
  ignite: boolean;
  pts: number;
  made: boolean;
  label: string;
  hoopFrom: number;
  dragOff: THREE.Vector3 | null;
  mine: boolean;
  shot?: Shot;
  round: number;
  ended: number;
}

interface Pending {
  t0: number;
  shot: Shot;
  v: [number, number, number];
  rel: [number, number, number];
  dragOff: THREE.Vector3;
  round: number;
}

interface LS {
  lane: Lane;
  idx: number;
  play: Play | null;
  pending: Pending | null;
  /** round 3 slide phase (radians) */
  phase: number;
  hoopX: number;
  rot: number;
  /** seconds since the ball came back into the hands (pop-in) */
  spawnT: number;
  ballPos: THREE.Vector3;
  ballVel: THREE.Vector3;
  onFire: boolean;
  /** remembered for "shot clock in hands" logic */
  canShoot: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);

class HoopsView implements SportView {
  private wrapEl: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private assets = makeAssets();
  private world;
  private lanes = new Map<string, LS>();
  private order: string[] = [];
  private s: GameState | null = null;
  private offset = 0;
  private lastSeq = -1;
  private round = -1;
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private zoom = 1;
  private audio: HoopsAudio;
  private cb: ((shot: Shot) => void) | null = null;
  private drag: { id: number; pts: { x: number; y: number; t: number }[]; x0: number; y0: number } | null = null;
  private dragOff = new THREE.Vector3();
  private dragTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camFov = 50;
  private camReady = false;
  private shake = 0;
  private shakeT = 0;
  private idleT = 0;
  private clockShown = "";
  private lastTick = -1;
  private buzzed = -1;
  private hudKey = "";
  private tagEls = new Map<string, HTMLDivElement>();
  private hud: HTMLDivElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.hud.querySelector<T>(sel)!;
  private dirty = true;
  private winners: string[] = [];

  constructor(private root: HTMLElement, private opts: Parameters<SportViewFactory>[1]) {
    this.wrapEl = document.createElement("div");
    this.wrapEl.className = "hp-root";
    root.appendChild(this.wrapEl);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.wrapEl.appendChild(this.renderer.domElement);
    this.world = makeWorld(this.renderer, this.assets, () => (this.dirty = true));
    this.audio = new HoopsAudio(opts.sound);
    this.hud = document.createElement("div");
    this.hud.className = `hp-hud ${opts.mode === "screen" ? "hp-screen" : "hp-personal"}`;
    this.hud.innerHTML =
      opts.mode === "screen"
        ? `<div class="hp-head hp-panel"><div class="ttl">سلة <em>البط</em></div><div class="rnd"></div><div class="hp-clock hp-panel">${this.ringSvg()}<b class="hp-num"></b></div></div>
           <div class="hp-lb hp-panel"><h3>الترتيب</h3><div class="rows"></div></div><div class="hp-tags"></div><div class="hp-floats"></div>
           <div class="hp-banner hp-panel"><b></b><span></span></div>`
        : `<div class="hp-top"><div class="hp-score hp-panel"><b class="hp-num">٠</b><small>نقطة</small></div>
             <div class="hp-mid"><div class="hp-round hp-panel"></div><div class="hp-shots"></div></div>
             <div class="hp-clock hp-panel">${this.ringSvg()}<b class="hp-num"></b></div></div>
           <div class="hp-fire"><div class="hp-pip"></div><div class="hp-pip"></div><div class="hp-pip"></div><div class="hp-firetag">نار ×٢</div></div>
           <div class="hp-others"></div><div class="hp-floats"></div>
           <div class="hp-pop"></div><div class="hp-banner hp-panel"><b></b><span></span></div>
           <div class="hp-swipe"></div><div class="hp-hint hp-panel"><i></i><span>اسحب الكرة لفوق وافلتها</span></div>
           <div class="hp-wait hp-panel">خلصت رمياتك · انتظر الباقين</div>`;
    this.wrapEl.appendChild(this.hud);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrapEl);
    this.resize();
    if (opts.mode === "personal") {
      const el = this.wrapEl;
      el.addEventListener("pointerdown", this.onDown);
      el.addEventListener("pointermove", this.onMove);
      el.addEventListener("pointerup", this.onUp);
      el.addEventListener("pointercancel", this.onCancel);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  private ringSvg() {
    return `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="rgba(43,27,69,.15)" stroke-width="4.5"/><circle class="arc" cx="20" cy="20" r="17" fill="none" stroke="#2b1b45" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg>`;
  }

  // ------------------------------------------------------------------ sizing
  private resize() {
    // layout size (the display may CSS-scale its stage; the HUD lives in layout pixels)
    this.w = Math.max(1, this.wrapEl.clientWidth);
    this.h = Math.max(1, this.wrapEl.clientHeight);
    const r = this.wrapEl.getBoundingClientRect();
    this.zoom = r.width > 0 ? r.width / this.w : 1;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    const land = this.w > this.h * 1.15;
    let s: number;
    if (this.opts.mode === "screen") s = clamp(Math.min(this.w / 1250, this.h / 700), 0.6, 2);
    else s = land ? clamp(this.h / 400, 0.72, 1.3) : clamp(Math.min(this.w / 390, this.h / 720), 0.78, 1.5);
    this.hud.style.setProperty("--s", s.toFixed(3));
    this.hud.classList.toggle("land", land);
    this.dirty = true;
  }

  private pxScale() {
    return (this.h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  // ------------------------------------------------------------------ state
  private get sp() {
    return this.s?.sport;
  }
  private me() {
    return this.opts.me();
  }
  private data(pid: string) {
    return this.sp?.lanes[pid] as HoopsLane | undefined;
  }
  private now() {
    return Date.now() + this.offset;
  }

  render(s: GameState) {
    this.s = s;
    if (s.serverNow) this.offset = s.serverNow - Date.now();
    const sp = s.sport;
    if (!sp || sp.id !== "hoops") return;
    // lanes = players
    const ids = s.players.map((p) => p.id);
    if (ids.join() !== this.order.join()) this.syncLanes(s);
    if (sp.round !== this.round) this.onRound(sp.round, this.round >= 0);
    for (const p of s.players) {
      const ls = this.lanes.get(p.id);
      const d = this.data(p.id);
      if (!ls || !d) continue;
      ls.canShoot = s.phase !== "final" && s.phase !== "end" && HOOPS.canShoot(d);
      if (!ls.play) ls.onFire = d.fire;
    }
    if (s.phase === "final" || s.phase === "end") this.winners = s.winnerIds ?? [];
    this.updateHud();
  }

  private syncLanes(s: GameState) {
    const keep = new Set(s.players.map((p) => p.id));
    for (const [pid, ls] of this.lanes) {
      if (!keep.has(pid)) {
        ls.lane.dispose();
        this.lanes.delete(pid);
        this.tagEls.get(pid)?.remove();
        this.tagEls.delete(pid);
      }
    }
    s.players.forEach((p, i) => {
      let ls = this.lanes.get(p.id);
      if (!ls) {
        const lane = makeLane(this.assets, p.id, p.duck, DUCKS[p.duck]?.color ?? "#ffd23f", () => (this.dirty = true));
        this.world.scene.add(lane.group);
        ls = {
          lane,
          idx: i,
          play: null,
          pending: null,
          phase: i * 1.9,
          hoopX: 0,
          rot: -HOOP_SPOTS[Math.max(0, this.round)]?.angle || 0,
          spawnT: 1,
          ballPos: new THREE.Vector3(),
          ballVel: new THREE.Vector3(),
          onFire: false,
          canShoot: true,
        };
        this.lanes.set(p.id, ls);
      }
      ls.idx = i;
      ls.lane.group.position.x = (i - (s.players.length - 1) / 2) * SPACING;
    });
    this.order = s.players.map((p) => p.id);
    this.world.layout(this.order.length);
    this.hudKey = "";
  }

  private onRound(round: number, announce: boolean) {
    this.round = round;
    this.buzzed = -1;
    for (const ls of this.lanes.values()) ls.spawnT = 0;
    if (announce || this.s?.phase === "sport") this.banner(`الجولة ${ar(round + 1)}`, HOOP_SPOTS[round]?.name ?? "");
  }

  anim(s: GameState) {
    if (s.seq === this.lastSeq) return;
    this.lastSeq = s.seq;
    this.render(s);
    const a = s.anim;
    if (a.kind === "shot") this.startPlay(a.playerId, a.replay);
    else if (a.kind === "sportRound") {
      if (a.round > 0) this.audio.buzzer();
      this.banner(`الجولة ${ar(a.round + 1)}`, HOOP_SPOTS[a.round]?.name ?? "");
    } else if (a.kind === "win") {
      this.winners = s.winnerIds ?? [a.playerId];
      for (const pid of this.winners) this.confetti(pid);
      if (this.opts.mode === "personal" && this.winners.includes(this.me())) this.pop("فزت!", "", "fire");
      this.hudKey = "";
      this.updateHud();
    }
  }

  setInput(onShot: ((shot: Shot) => void) | null) {
    this.cb = onShot;
    if (!onShot && this.drag) this.endDrag();
  }

  // ------------------------------------------------------------------ replays
  private startPlay(pid: string, rp: Replay) {
    const ls = this.lanes.get(pid);
    const d = this.data(pid);
    if (!ls || !d || !rp?.ball?.length) return;
    const round = d.round;
    const rec = d.shots[round]?.[d.shots[round].length - 1];
    const ev = rp.bodies?.[1] ?? [];
    const res = ev.length >= 3 ? ev[ev.length - 1] : 0;
    const mine = this.opts.mode === "personal" && pid === this.me();
    const pend = mine ? ls.pending : null;
    const made = !!rec && rec.kind >= 2;
    ls.play = {
      rp,
      t0: pend ? pend.t0 : performance.now(),
      n: rp.ball.length / 3,
      hoop: rp.bodies?.[0] ?? [],
      ev,
      evI: 0,
      fire: !!rec?.fire,
      ignite: made && !rec?.fire && d.fire,
      pts: rec?.pts ?? res,
      made,
      label: rp.label ?? "",
      hoopFrom: ls.hoopX,
      dragOff: pend ? pend.dragOff : null,
      mine,
      shot: pend?.shot,
      round,
      ended: -1,
    };
    ls.pending = null;
    ls.spawnT = 1;
    ls.lane.ball.visible = true;
    if (!pend) this.audio.release();
  }

  /** ball position (lane-local) at replay time t */
  private sample(p: Play, t: number, out: THREE.Vector3) {
    const f = clamp(t / p.rp.dt, 0, p.n - 1);
    const i = Math.min(p.n - 2, Math.floor(f));
    const k = f - i;
    const b = p.rp.ball;
    const P = (j: number, c: number) => b[clamp(j, 0, p.n - 1) * 3 + c];
    // Catmull-Rom through the samples
    const k2 = k * k;
    const k3 = k2 * k;
    for (let c = 0; c < 3; c++) {
      const p0 = P(i - 1, c);
      const p1 = P(i, c);
      const p2 = P(i + 1, c);
      const p3 = P(i + 2, c);
      out.setComponent(c, 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3));
    }
    return out;
  }

  private hoopAt(p: Play, t: number) {
    if (!p.hoop.length) return 0;
    const f = clamp(t / p.rp.dt, 0, p.hoop.length - 1);
    const i = Math.min(p.hoop.length - 2, Math.floor(f));
    const x = p.hoop.length > 1 ? p.hoop[i] + (p.hoop[i + 1] - p.hoop[i]) * (f - i) : p.hoop[0];
    // ease in from wherever the idle hoop was
    return x + (p.hoopFrom - p.hoop[0]) * Math.max(0, 1 - t / 0.35);
  }

  private event(ls: LS, p: Play, type: number, value: number) {
    const lane = ls.lane;
    const mine = p.mine || (this.opts.mode === "personal" && lane.pid === this.me());
    const loud = this.opts.mode === "screen" ? 0.55 : mine ? 1 : 0.25;
    if (type === 1) {
      const v = value / 100;
      if (loud > 0.3) this.audio.rim(v * loud);
      lane.wobbleV += Math.min(0.25, v * 0.05) * (Math.random() < 0.5 ? -1 : 1);
      lane.netKick = Math.max(lane.netKick * Math.exp(-3 * lane.netT), 0.25);
      lane.netT = 0;
      if (mine) this.kick(Math.min(0.06, 0.012 + v * 0.008));
    } else if (type === 2) {
      if (loud > 0.3) this.audio.board(value / 100);
      lane.glowKick = 1;
      if (mine) this.kick(0.02);
    } else if (type === 3) {
      if (loud > 0.3 || p.mine) this.audio.bounce((value / 100) * (mine ? 1 : 0.5));
    } else if (type === 4) {
      const swish = p.label.startsWith("سويش") || (p.pts > 0 && p.rp.bodies?.[1]?.every((x, i) => i % 3 !== 1 || x > 2));
      lane.netKick = swish ? 1 : 0.7;
      lane.netT = 0;
      if (loud > 0.3) this.audio.swish(swish ? 1 : 0.7);
      this.burst(ls, swish ? 70 : 40, p.fire || p.ignite);
      const d = this.data(lane.pid);
      if (mine || this.opts.mode === "screen") this.audio.score(value, d?.streak ?? 1);
      if (p.ignite) {
        ls.onFire = true;
        if (loud > 0.3) this.audio.ignite();
        this.fireBurst(ls);
      }
      this.floatAt(ls, `+${ar(value)}`, value >= 3 ? "big" : "", p.fire || p.ignite);
      if (this.opts.mode === "screen") this.floatAt(ls, p.label, "lbl", p.fire || p.ignite, 0.45);
      if (mine) this.pop(p.label, "", p.ignite ? "fire" : "");
      if (this.opts.mode === "personal" && !mine) this.ping(lane.pid);
    } else if (type === 5) {
      if (!p.made) {
        ls.onFire = false;
        if (mine) {
          this.audio.miss();
          this.pop(p.label, this.tip(p), "miss");
        } else if (this.opts.mode === "screen") this.floatAt(ls, p.label, "lbl", false, 0.45);
      }
      this.hudKey = "";
      this.dirty = true;
    }
  }

  /** a coaching tip after a miss (power or aim, whichever was further off) */
  private tip(p: Play) {
    if (!p.shot) return "";
    const ideal = hoopsIdeal(p.round, p.shot.start);
    const ep = (p.shot.power - ideal.power) / 0.05;
    const ea = (p.shot.aim - ideal.aim) / 0.07;
    if (Math.abs(ep) < 1 && Math.abs(ea) < 1) return "قريبة!";
    if (Math.abs(ep) >= Math.abs(ea)) return ep > 0 ? "قوية زيادة، خففها" : "ضعيفة، ارمها أقوى";
    return ea > 0 ? "رحت يمين شوي" : "رحت يسار شوي";
  }

  // ------------------------------------------------------------------ juice
  private kick(a: number) {
    this.shake = Math.max(this.shake, a);
  }

  private rimWorld(ls: LS, out: THREE.Vector3) {
    out.set(ls.hoopX, RIM_Y, 0);
    return ls.lane.group.localToWorld(out);
  }

  private burst(ls: LS, n: number, fire: boolean) {
    const c = this.rimWorld(ls, tmpV.clone()).add(new THREE.Vector3(0, -0.2, 0));
    const lc = new THREE.Color(ls.lane.color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.6;
      const v = new THREE.Vector3(Math.cos(a) * sp, 0.6 + Math.random() * 2.8, Math.sin(a) * sp);
      const col = fire ? FLAME[(Math.random() * FLAME.length) | 0] : i % 3 === 0 ? lc : i % 3 === 1 ? CONF[0] : CONF[5];
      this.world.sparks.emit(c, v, 0.6 + Math.random() * 0.6, 0.16 + Math.random() * 0.1, 0.02, col, { drag: 1.6, grav: 5 });
    }
  }

  private fireBurst(ls: LS) {
    const c = this.rimWorld(ls, tmpV.clone());
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 2.6, 1.5 + Math.random() * 2, Math.sin(a) * 2.6);
      this.world.flames.emit(c, v, 0.7 + Math.random() * 0.4, 0.5, 0.05, FLAME[(Math.random() * FLAME.length) | 0], { drag: 2.2, grav: -1 });
    }
  }

  private confetti(pid: string) {
    const ls = this.lanes.get(pid);
    if (!ls) return;
    const c = this.rimWorld(ls, tmpV.clone()).add(new THREE.Vector3(0, 1.4, 0));
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      const v = new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp);
      this.world.sparks.emit(c, v, 1.4 + Math.random() * 1.2, 0.22, 0.06, CONF[i % CONF.length], { drag: 1.2, grav: 4 });
    }
  }

  private flames(ls: LS, dt: number) {
    const b = ls.lane.ball;
    b.getWorldPosition(tmpV);
    const v = ls.ballVel;
    const n = Math.max(1, Math.round(dt * 160));
    const personalMine = this.opts.mode === "personal" && ls.lane.pid === this.me();
    const sz = personalMine ? 0.3 : 0.42;
    for (let i = 0; i < n; i++) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.5 - v.x * 0.15, 1.1 + Math.random() * 0.9, (Math.random() - 0.5) * 0.5 - v.z * 0.15);
      const col = FLAME[Math.min(FLAME.length - 1, (Math.random() * FLAME.length) | 0)];
      this.world.flames.emit(tmpV2.copy(tmpV).add(jitter), vel, 0.28 + Math.random() * 0.3, sz * (0.7 + Math.random() * 0.5), 0.02, col, { drag: 2.5, grav: -0.8 });
    }
  }

  // ------------------------------------------------------------------ HUD
  private banner(title: string, sub: string) {
    const b = this.q(".hp-banner");
    b.querySelector("b")!.textContent = title;
    b.querySelector("span")!.textContent = sub;
    b.classList.remove("show");
    void b.offsetWidth;
    b.classList.add("show");
  }

  private pop(label: string, tip: string, cls: string) {
    const el = this.hud.querySelector<HTMLDivElement>(".hp-pop");
    if (!el) return;
    el.className = `hp-pop ${cls}`;
    el.innerHTML = `<div class="lbl">${esc(label)}</div>${tip ? `<div class="tip">${esc(tip)}</div>` : ""}`;
    void el.offsetWidth;
    el.classList.add("go");
  }

  private floatAt(ls: LS, text: string, cls: string, hot: boolean, up = 0) {
    const p = this.rimWorld(ls, tmpV.clone()).add(new THREE.Vector3(0, -0.15 - up * 1.4, 0));
    p.project(this.camera);
    if (p.z > 1) return;
    const el = document.createElement("div");
    el.className = `hp-float ${cls} ${hot ? "hot" : ""}`;
    el.textContent = text;
    el.style.left = `${((p.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - p.y) / 2) * 100}%`;
    if (cls === "lbl") el.style.fontSize = "calc(var(--s) * 24px)";
    this.q(".hp-floats").appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  private ping(pid: string) {
    const el = this.hud.querySelector<HTMLElement>(`.hp-chip[data-p="${CSS.escape(pid)}"]`);
    if (!el) return;
    el.classList.remove("ping");
    void el.offsetWidth;
    el.classList.add("ping");
  }

  private updateHud() {
    const s = this.s;
    const sp = this.sp;
    if (!s || !sp) return;
    const round = sp.round;
    const rn = `الجولة ${ar(round + 1)} من ${ar(sp.rounds)} · <span>${esc(HOOP_SPOTS[round]?.name ?? "")}</span>`;
    // personal
    if (this.opts.mode === "personal") {
      const me = this.me();
      const d = this.data(me);
      const total = sp.total[me] ?? 0;
      const shots = d?.shots[round] ?? [];
      const others = s.players.filter((p) => p.id !== me).map((p) => ({ p, t: sp.total[p.id] ?? 0, f: !!this.data(p.id)?.fire }));
      const best = Math.max(total, ...others.map((o) => o.t));
      const key = JSON.stringify([rn, total, shots, d?.streak, d?.fire, others.map((o) => [o.p.id, o.t, o.f]), best]);
      if (key !== this.hudKey) {
        const prevTotal = this.q(".hp-score b").textContent;
        this.hudKey = key;
        this.q(".hp-round").innerHTML = rn;
        const sc = this.q(".hp-score");
        sc.querySelector("b")!.textContent = ar(total);
        if (prevTotal !== ar(total) && total > 0) {
          sc.classList.remove("bump");
          void sc.offsetWidth;
          sc.classList.add("bump");
        }
        // 5 slots: results so far, then balls
        let slots = "";
        for (let i = 0; i < HOOP_SHOTS; i++) {
          const r = shots[i];
          if (r) slots += r.pts ? `<div class="hp-slot made ${r.fire ? "hot" : ""} hp-num">${ar(r.pts)}</div>` : `<div class="hp-slot miss">✕</div>`;
          else slots += `<div class="hp-slot ${i === shots.length ? "next" : ""}">${ballSvg(26, false)}</div>`;
        }
        this.q(".hp-shots").innerHTML = slots;
        const fire = this.q(".hp-fire");
        fire.classList.toggle("hot", !!d?.fire);
        fire.querySelectorAll(".hp-pip").forEach((el, i) => el.classList.toggle("on", (d?.streak ?? 0) > i));
        others.sort((a, b) => b.t - a.t);
        this.q(".hp-others").innerHTML = others
          .slice(0, 7)
          .map((o) => `<div class="hp-chip ${o.t === best && o.t > 0 ? "lead" : ""} ${o.f ? "hot" : ""}" data-p="${esc(o.p.id)}"><img src="assets/tokens/token${o.p.duck}.png" alt=""><span class="hp-num">${ar(o.t)}</span></div>`)
          .join("");
      }
      return;
    }
    // screen: head + leaderboard + tags
    const ranked = [...s.players].sort((a, b) => (sp.total[b.id] ?? 0) - (sp.total[a.id] ?? 0));
    const key = JSON.stringify([rn, ranked.map((p) => [p.id, p.name, sp.total[p.id], this.data(p.id)?.fire, this.data(p.id)?.shots[round]]), this.winners]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.q(".hp-head .rnd").innerHTML = rn;
    let rank = 0;
    let prev = -1;
    this.q(".hp-lb .rows").innerHTML = ranked
      .map((p, i) => {
        const t = sp.total[p.id] ?? 0;
        if (t !== prev) rank = i + 1;
        prev = t;
        return `<div class="hp-row ${rank === 1 && t > 0 ? "first" : ""}"><div class="rk hp-num">${ar(rank)}</div><img src="assets/tokens/token${p.duck}.png" alt=""><div class="nm">${esc(p.name)}</div>${this.data(p.id)?.fire ? `<div class="fl"></div>` : ""}<div class="sc hp-num">${ar(t)}</div></div>`;
      })
      .join("");
    const tags = this.q(".hp-tags");
    for (const p of s.players) {
      let el = this.tagEls.get(p.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "hp-tag";
        tags.appendChild(el);
        this.tagEls.set(p.id, el);
      }
      const d = this.data(p.id);
      const shots = d?.shots[round] ?? [];
      let dots = "";
      for (let i = 0; i < HOOP_SHOTS; i++) {
        const r = shots[i];
        dots += `<div class="dot ${r ? (r.pts ? (r.fire ? "hot" : "made") : "miss") : ""}"></div>`;
      }
      el.className = `hp-tag ${d?.fire ? "hot" : ""} ${this.winners.includes(p.id) ? "win" : ""}`;
      el.innerHTML = `<div class="card"><img src="assets/tokens/token${p.duck}.png" alt=""><div class="nm">${esc(p.name)}</div><div class="sc hp-num">${ar(sp.total[p.id] ?? 0)}</div></div><div class="dots">${dots}</div>`;
    }
  }

  private clock() {
    const s = this.s;
    const el = this.hud.querySelector<HTMLElement>(".hp-clock");
    if (!s || !el) return;
    const live = s.phase === "sport" && !!s.phaseEndsAt;
    const left = live ? Math.max(0, (s.phaseEndsAt! - this.now()) / 1000) : 0;
    const secs = Math.ceil(left);
    const txt = live ? ar(secs) : "–";
    const frac = live ? clamp(left / HOOPS.roundSeconds, 0, 1) : 0;
    const k = `${txt}|${frac.toFixed(2)}`;
    if (k === this.clockShown) return;
    this.clockShown = k;
    el.querySelector("b")!.textContent = txt;
    (el.querySelector(".arc") as SVGCircleElement).style.strokeDashoffset = String(106.8 * (1 - frac));
    el.classList.toggle("low", live && secs <= 5);
    el.classList.toggle("off", !live);
    if (live && secs <= 5 && secs > 0 && secs !== this.lastTick) {
      this.lastTick = secs;
      if (this.opts.mode === "screen" || this.lanes.get(this.me())?.canShoot) this.audio.tick();
    }
    if (live && secs === 0 && this.buzzed !== this.round) {
      this.buzzed = this.round;
      this.audio.buzzer();
    }
  }

  /** screen: name tags float above each hoop */
  private placeTags() {
    for (const [pid, el] of this.tagEls) {
      const ls = this.lanes.get(pid);
      if (!ls) continue;
      const p = ls.lane.group.localToWorld(tmpV.set(ls.hoopX, 4.25, -0.4)).project(this.camera);
      const x = ((p.x + 1) / 2) * this.w;
      const y = ((1 - p.y) / 2) * this.h;
      el.style.transform = `translate(${(x - 0.5).toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.left = "0";
      el.style.top = "0";
    }
  }

  // ------------------------------------------------------------------ input
  private myLane() {
    return this.opts.mode === "personal" ? this.lanes.get(this.me()) : undefined;
  }

  private armed() {
    const ls = this.myLane();
    const sp = this.sp;
    if (!this.cb || !ls || !sp || this.s?.phase !== "sport") return false;
    if (ls.play || ls.pending || !ls.canShoot) return false;
    if ((sp.busyUntil[this.me()] ?? 0) > this.now() + 150) return false;
    return true;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.armed() || this.drag) return;
    this.wrapEl.setPointerCapture?.(e.pointerId);
    this.drag = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }], x0: e.clientX, y0: e.clientY };
    this.idleT = 0;
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    d.pts.push({ x: e.clientX, y: e.clientY, t: now });
    while (d.pts.length > 2 && now - d.pts[0].t > 260) d.pts.shift();
    this.dragTargetFrom((e.clientX - d.x0) / this.zoom, (e.clientY - d.y0) / this.zoom);
  };

  /** the ball follows the finger (clamped), in the camera plane at the ball's depth */
  private dragTargetFrom(dx: number, dy: number) {
    const dist = 1.3;
    const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / this.h;
    const right = clamp(dx * wpp, -0.45, 0.45);
    const up = clamp(-dy * wpp, -0.3, 0.55);
    const cr = tmpV.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const cu = tmpV2.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.dragTarget.copy(cr).multiplyScalar(right).addScaledVector(cu, up);
  }

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    d.pts.push({ x: e.clientX, y: e.clientY, t: now });
    // release velocity over the last ~90 ms
    let j = d.pts.length - 1;
    while (j > 0 && now - d.pts[j - 1].t < 90) j--;
    const a = d.pts[Math.max(0, j - 1)];
    const b = d.pts[d.pts.length - 1];
    const dt = Math.max(16, b.t - a.t) / 1000;
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const tx = e.clientX - d.x0;
    const ty = e.clientY - d.y0;
    this.endDrag(false);
    const speed = Math.hypot(vx, vy);
    if (vy > -260 || ty > -24 || !this.armed()) {
      this.dragTarget.set(0, 0, 0);
      return;
    }
    // power: log of the flick speed (CSS px/s), the same on every screen size
    const power = clamp(Math.log(speed / 385) / Math.log(4900 / 385), 0, 1);
    // direction: half the release velocity, half the whole swipe
    const nv = Math.hypot(vx, vy) || 1;
    const nt = Math.hypot(tx, ty) || 1;
    let ux = vx / nv + tx / nt;
    let uy = vy / nv + ty / nt;
    const un = Math.hypot(ux, uy) || 1;
    ux /= un;
    uy /= un;
    const aim = this.aimFromScreen(ux, uy);
    const ls = this.myLane()!;
    const round = this.sp!.round;
    const start = HOOP_SPOTS[round]?.moving ? wrap(ls.phase) / Math.PI : 0;
    const shot: Shot = { aim, power, spin: 0, start };
    const L = hoopsLaunch(round, shot);
    ls.pending = { t0: performance.now(), shot, v: L.v, rel: L.release, dragOff: this.dragOff.clone(), round };
    this.dragTarget.set(0, 0, 0);
    this.dragOff.set(0, 0, 0);
    this.audio.release();
    const cb = this.cb;
    cb?.(shot);
    setTimeout(() => {
      // never answered (rejected): give the ball back
      if (ls.pending && performance.now() - ls.pending.t0 > 2400) {
        ls.pending = null;
        ls.spawnT = 0;
      }
    }, 2600);
  };

  /** WYSIWYG aim: follow the swipe from the ball on screen up to the rim's height, and see where that is in the world */
  private aimFromScreen(ux: number, uy: number) {
    const ls = this.myLane();
    if (!ls) return 0;
    const g = ls.lane.group;
    const round = Math.max(0, this.round);
    const spot = hoopSpot(round);
    const ball = ls.lane.ball.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const rim = g.localToWorld(new THREE.Vector3(0, RIM_Y, 0)).project(this.camera);
    const bx = ((ball.x + 1) / 2) * this.w;
    const by = ((1 - ball.y) / 2) * this.h;
    const ry = ((1 - rim.y) / 2) * this.h;
    const k = uy < -0.15 ? (ry - by) / uy : (ry - by) / -0.15;
    const sx = bx + ux * Math.abs(k);
    // ray through that screen point, met with the vertical plane through the rim (facing the shooter)
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -((ry / this.h) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = g.worldToLocal(ray.ray.origin.clone());
    const dirL = g.worldToLocal(ray.ray.origin.clone().add(ray.ray.direction)).sub(o);
    const n = new THREE.Vector3(spot.dir[0], 0, spot.dir[2]);
    const den = dirL.dot(n);
    if (Math.abs(den) < 1e-4) return 0;
    const tHit = -o.dot(n) / den; // plane through the origin (rim centre) with normal = dir
    const hit = o.addScaledVector(dirL, tHit);
    const rel = hit.sub(new THREE.Vector3(spot.release[0], 0, spot.release[2]));
    const side = rel.x * spot.right[0] + rel.z * spot.right[2];
    const fwd = rel.x * spot.dir[0] + rel.z * spot.dir[2];
    return clamp(Math.atan2(side, Math.max(0.5, fwd)), -1.2, 1.2);
  }

  private onCancel = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) this.endDrag();
  };

  private endDrag(reset = true) {
    if (this.drag) this.wrapEl.releasePointerCapture?.(this.drag.id);
    this.drag = null;
    if (reset) this.dragTarget.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ cameras
  private personalCamera(ls: LS, dt: number, snap: boolean) {
    const round = Math.max(0, this.round);
    const sp = hoopSpot(round);
    const g = ls.lane.group;
    const rel = new THREE.Vector3(...sp.release);
    const dir = new THREE.Vector3(...sp.dir);
    const camL = rel.clone().addScaledVector(dir, -1.3).add(new THREE.Vector3(0, 0.45, 0));
    // frame it: rim high on the screen, ball low; wide enough for the backboard
    const hx = ls.hoopX;
    const rimL = new THREE.Vector3(hx * 0.5, RIM_Y, 0);
    const hdR = Math.hypot(rimL.x - camL.x, rimL.z - camL.z);
    const eR = Math.atan2(RIM_Y + 0.12 - camL.y, hdR);
    const hdB = Math.hypot(rel.x - camL.x, rel.z - camL.z);
    const eB = Math.atan2(rel.y - camL.y, hdB);
    const land = this.camera.aspect > 1.15;
    const yR = land ? 0.3 : 0.3;
    const yB = land ? -0.62 : -0.64;
    let lo = eB;
    let hi = eR;
    for (let i = 0; i < 40; i++) {
      const p = (lo + hi) / 2;
      const r = Math.tan(eR - p) / Math.tan(p - eB);
      if (r > -yR / yB) lo = p;
      else hi = p;
    }
    let pitch = (lo + hi) / 2;
    let T = Math.tan(eR - pitch) / yR;
    const Tmin = 1.25 / (hdR * this.camera.aspect);
    if (T < Tmin) {
      T = Tmin;
      pitch = eR - Math.atan(yR * T);
    }
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(T));
    const look = camL.clone().add(new THREE.Vector3(dir.x * Math.cos(pitch), Math.sin(pitch), dir.z * Math.cos(pitch)));
    // aim the view at the hoop's rest line (the hoop slides within it)
    g.updateMatrixWorld();
    const pw = g.localToWorld(camL.clone());
    const lw = g.localToWorld(look);
    const k = snap ? 1 : ease(3.2, dt);
    this.camPos.lerp(pw, k);
    this.camLook.lerp(lw, k);
    this.camFov += (fov - this.camFov) * k;
  }

  private screenCamera(dt: number, snap: boolean) {
    const n = Math.max(1, this.order.length);
    const aspect = this.camera.aspect;
    const fov = 34;
    const T = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    // leave room on the right for the leaderboard
    const halfW = ((n - 1) * SPACING) / 2 + 1.7;
    const usable = aspect > 1.3 ? 0.8 : 1;
    const dist = Math.max(11, halfW / (T * aspect * usable));
    const look = new THREE.Vector3(0, 2.4, 1.6);
    const pos = new THREE.Vector3(0, 2.4 + dist * 0.2, 1.6 + dist);
    const k = snap ? 1 : ease(2, dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camFov += (fov - this.camFov) * k;
    // shift the picture left of the leaderboard
    this.camera.filmOffset = aspect > 1.3 ? (1 - usable) * 0.5 * this.camera.getFilmWidth() * 0.9 : 0;
  }

  // ------------------------------------------------------------------ frame loop
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.order.length) {
      this.renderer.render(this.world.scene, this.camera);
      return;
    }
    const round = Math.max(0, this.round);
    const moving = !!HOOP_SPOTS[round]?.moving;
    const targetRot = -(HOOP_SPOTS[round]?.angle ?? 0);
    const mine = this.myLane();
    this.idleT += dt;

    for (const ls of this.lanes.values()) {
      const lane = ls.lane;
      // lanes swivel to face their spot
      ls.rot += (targetRot - ls.rot) * ease(2.5, dt);
      lane.group.rotation.y = ls.rot;
      const spot = hoopSpot(round);
      const p = ls.play;
      let t = 0;
      if (p) t = (now - p.t0) / 1000;
      // hoop x
      if (p && p.hoop.length) ls.hoopX = this.hoopAt(p, t);
      else if (moving) {
        ls.phase += SLIDE_W * dt;
        const target = SLIDE_A * Math.sin(ls.phase);
        ls.hoopX += (target - ls.hoopX) * (ls.pending ? 1 : ease(10, dt));
      } else ls.hoopX += (0 - ls.hoopX) * ease(3, dt);
      lane.hoop.position.x = ls.hoopX;
      // rim wobble (spring)
      lane.wobbleV += (-lane.wobble * 180 - lane.wobbleV * 9) * dt;
      lane.wobble += lane.wobbleV * dt;
      lane.rimGroup.rotation.x = lane.wobble * 0.5;
      lane.rimGroup.rotation.z = lane.wobble * 0.3;
      lane.glowKick = Math.max(0, lane.glowKick - dt * 2.5);
      (lane.boardGlow.material as THREE.MeshBasicMaterial).opacity = 0.32 + lane.glowKick * 0.5 + (ls.onFire ? 0.25 + 0.1 * Math.sin(now / 90) : 0);
      // spot ring + duck
      lane.spotRing.position.set(spot.spot[0], 0.012, spot.spot[2]);
      lane.spotRing.scale.setScalar(1 + 0.06 * Math.sin(now / 260 + ls.idx));
      const isMe = !!mine && mine === ls;
      lane.duckSprite.visible = !isMe;
      lane.duckSprite.position.set(spot.spot[0] - spot.dir[0] * 0.25, 0, spot.spot[2] - spot.dir[2] * 0.25);
      lane.spotRing.visible = !isMe;

      // ball
      const b = lane.ball;
      let inNet: THREE.Vector3 | null = null;
      const prev = tmpV2.copy(ls.ballPos);
      if (p) {
        this.sample(p, t, ls.ballPos);
        if (p.dragOff) {
          const f = Math.max(0, 1 - t / 0.18);
          ls.ballPos.addScaledVector(lane.group.worldToLocal(tmpV.copy(p.dragOff).add(lane.group.getWorldPosition(new THREE.Vector3()))), f * f);
        }
        while (p.evI + 2 < p.ev.length && p.ev[p.evI] * p.rp.dt <= t) {
          this.event(ls, p, p.ev[p.evI + 1], p.ev[p.evI + 2]);
          p.evI += 3;
        }
        const end = (p.n - 1) * p.rp.dt;
        b.visible = true;
        b.scale.setScalar(1);
        if (t > end) {
          // rest a moment where it ended, then fade
          if (p.ended < 0) p.ended = now;
          const after = (now - p.ended) / 1000;
          b.scale.setScalar(Math.max(0.01, 1 - after / 0.35));
          if (after > 0.35) {
            ls.play = null;
            ls.spawnT = 0;
            if (p.mine && moving) ls.phase = Math.PI * (p.shot?.start ?? 0) + SLIDE_W * end;
            else if (moving && p.hoop.length > 1) {
              const m = p.hoop.length;
              const x = p.hoop[m - 1] / SLIDE_A;
              const v = (p.hoop[m - 1] - p.hoop[m - 2]) / p.rp.dt / (SLIDE_A * SLIDE_W);
              ls.phase = Math.atan2(clamp(x, -1, 1), v);
            }
          }
        }
        // ball inside the net?
        const lx = ls.ballPos.x - ls.hoopX;
        const ly = ls.ballPos.y - RIM_Y;
        if (ly < 0.05 && ly > -0.6 && Math.hypot(lx, ls.ballPos.z) < 0.3) inNet = new THREE.Vector3(lx, ly, ls.ballPos.z);
      } else if (ls.pending) {
        const q = ls.pending;
        const tt = (now - q.t0) / 1000;
        ls.ballPos.set(q.rel[0] + q.v[0] * tt, q.rel[1] + q.v[1] * tt - 0.5 * G * tt * tt, q.rel[2] + q.v[2] * tt);
        const f = Math.max(0, 1 - tt / 0.18);
        ls.ballPos.add(lane.group.worldToLocal(tmpV.copy(q.dragOff).add(lane.group.getWorldPosition(new THREE.Vector3()))).multiplyScalar(f * f));
        b.visible = true;
        b.scale.setScalar(1);
      } else if (ls.canShoot && this.s?.phase !== "final" && this.s?.phase !== "end") {
        // in the hands, ready
        ls.spawnT += dt;
        const pop = Math.min(1, ls.spawnT / 0.3);
        const sc = pop < 1 ? 1 - Math.pow(1 - pop, 3) * 1 + Math.sin(pop * Math.PI) * 0.15 : 1;
        b.visible = true;
        const held = new THREE.Vector3(...spot.release);
        if (isMe) {
          this.dragOff.lerp(this.dragTarget, ease(this.drag ? 30 : 12, dt));
          const off = lane.group.worldToLocal(tmpV.copy(this.dragOff).add(lane.group.getWorldPosition(new THREE.Vector3())));
          held.add(off);
          held.y += Math.sin(now / 420) * 0.012;
          b.scale.setScalar(Math.max(0.01, sc) * (this.drag ? 1.06 : 1));
        } else {
          held.y += 0.05 * Math.abs(Math.sin(now / 300 + ls.idx));
          b.scale.setScalar(Math.max(0.01, sc));
        }
        ls.ballPos.copy(held);
      } else b.visible = false;
      ls.ballVel.copy(ls.ballPos).sub(prev).divideScalar(Math.max(1e-3, dt));
      b.position.copy(ls.ballPos);
      // spin: backspin while flying
      if (p || ls.pending) {
        const v = ls.ballVel;
        const ax = tmpV.set(v.z, 0, -v.x);
        const len = ax.length();
        // premultiplied in the parent (lane) frame
        if (len > 0.3) b.rotateOnWorldAxis(ax.normalize(), -dt * 14);
      }
      // shadow
      lane.shadow.visible = b.visible;
      lane.shadow.position.set(ls.ballPos.x, 0.012, ls.ballPos.z);
      const hgt = Math.max(0, ls.ballPos.y);
      lane.shadow.scale.setScalar(0.42 + hgt * 0.14);
      (lane.shadow.material as THREE.MeshBasicMaterial).opacity = 0.75 * clamp(1 - hgt / 6, 0.15, 1) * b.scale.x;
      // flames
      const hot = p ? p.fire || (p.ignite && p.evI >= p.ev.length - 3) : ls.onFire;
      if (hot && b.visible && b.scale.x > 0.3) this.flames(ls, dt);
      animateNet(lane, dt, inNet);
    }

    // camera
    if (mine) this.personalCamera(mine, dt, !this.camReady);
    else this.screenCamera(dt, !this.camReady);
    this.camReady = true;
    this.shake = Math.max(0, this.shake - dt * 0.18);
    this.shakeT += dt;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const a = this.shake;
      this.camera.position.x += Math.sin(this.shakeT * 61) * a;
      this.camera.position.y += Math.sin(this.shakeT * 47 + 1) * a;
    }
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    } else this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    const scale = this.pxScale();
    this.world.sparks.mat.uniforms.scale.value = scale;
    this.world.flames.mat.uniforms.scale.value = scale;
    this.world.update(dt, now);

    // HUD live bits
    this.clock();
    if (this.opts.mode === "screen") this.placeTags();
    else {
      const armed = this.armed();
      const myShots = mine ? (this.data(this.me())?.shots ?? []).reduce((a, r) => a + r.length, 0) : 1;
      const firstTime = myShots === 0;
      this.q(".hp-hint").classList.toggle("show", armed && !this.drag && (firstTime || this.idleT > 6));
      this.q(".hp-swipe").classList.toggle("show", armed && !this.drag && (firstTime || this.idleT > 6));
      const d = this.data(this.me());
      const done = !!d && this.s?.phase === "sport" && !HOOPS.canShoot(d) && !mine?.play;
      this.q(".hp-wait").classList.toggle("show", done);
      if (!armed) this.idleT = 0;
    }
    this.renderer.render(this.world.scene, this.camera);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.wrapEl;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    for (const ls of this.lanes.values()) ls.lane.dispose();
    this.lanes.clear();
    const seen = new Set<unknown>();
    this.world.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !seen.has(m.geometry)) {
        seen.add(m.geometry);
        m.geometry.dispose();
      }
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mt of mats) {
        if (seen.has(mt)) continue;
        seen.add(mt);
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
        if (mt instanceof THREE.ShaderMaterial) (mt.uniforms.map?.value as THREE.Texture | undefined)?.dispose();
        mt.dispose();
      }
    });
    this.world.scene.environment?.dispose();
    const a = this.assets;
    a.ball.map?.dispose();
    a.ball.bumpMap?.dispose();
    a.ball.dispose();
    a.ballGeo.dispose();
    [a.net, a.glow, a.shadow, a.spark].forEach((t) => t.dispose());
    a.ducks.forEach((d) => d.tex.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.audio.destroy();
    el.remove();
  }
}

export const createHoopsView: SportViewFactory = (root, opts) => new HoopsView(root, opts);
