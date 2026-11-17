import * as THREE from "three";
import { DUCKS } from "../../shared/data";
import { BALL_R, HEAD_Z, LANE_HALF, PIN_COM, RACK, ballSpeed, ballXAt, startX, type BowlingLane } from "../../shared/sports/bowling";
import type { Replay, Shot } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";
import { ar } from "../net";
import { sfx } from "../sfx";
import { BowlingAudio } from "./bowling/audio";
import "./bowling/bowling.css";
import { PersonalHud, ScreenHud, popKind } from "./bowling/hud";
import { Alley, type LaneSpec } from "./bowling/scene";
import { HEAD_V, PIT_V, zv } from "./bowling/space";
import type { SportView, SportViewFactory } from "./view";

/** 3D bowling. "screen": every player's lane side by side (projector). "personal": the camera sits behind this
 *  player's ball; they drag it sideways to place it and flick it up the lane to bowl; neighbours bowl beside them. */

type Pose = [number, number, number, number, number]; // x, y, z(physics), tx, tz
const MAX_START = LANE_HALF - BALL_R - 0.02;
const AIM_GAIN = 0.06;
const now = () => performance.now();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBounce = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
const rackPose = (pos: number[], i: number): Pose => [pos[i * 2], PIN_COM, pos[i * 2 + 1], 0, 0];

/** Read pin `i`'s pose at sample `idx` (fractional) from a replay. */
function pinAt(r: Replay, i: number, idx: number): Pose | null {
  const a = r.bodies?.[i];
  if (!a || a.length < 6) return null;
  const k = a[0];
  const n = (a.length - 1) / 5;
  const f = clamp(idx - k, 0, n - 1);
  const j0 = Math.floor(f);
  const j1 = Math.min(n - 1, j0 + 1);
  const u = f - j0;
  const o0 = 1 + j0 * 5;
  const o1 = 1 + j1 * 5;
  if (a[o0 + 1] < 0) return null; // already swept
  // tilt: interpolate the vector (fine at 30 fps)
  return [0, 1, 2, 3, 4].map((c) => a[o0 + c] + (a[o1 + c] - a[o0 + c]) * u) as Pose;
}
function ballAt(r: Replay, idx: number): [number, number, number] {
  const n = r.ball.length / 3;
  const f = clamp(idx, 0, n - 1);
  const j0 = Math.floor(f);
  const j1 = Math.min(n - 1, j0 + 1);
  const u = f - j0;
  return [0, 1, 2].map((c) => r.ball[j0 * 3 + c] + (r.ball[j1 * 3 + c] - r.ball[j0 * 3 + c]) * u) as [number, number, number];
}

interface LaneRT {
  pid: string;
  /** pins shown at rest */
  shown: { standing: boolean[]; pos: number[] };
  latest?: BowlingLane;
  phase: "rest" | "replay" | "hold" | "sweep" | "drop";
  t0: number;
  replay?: { r: Replay; n: number; impact: number; labelAt: number; crashed: boolean; popped: boolean; moved: number };
  /** pin poses when a sweep starts */
  from?: (Pose | null)[];
  /** after the sweep, drop a fresh rack */
  dropNext?: boolean;
  ballShownAt: number;
  ballWasShown: boolean;
}

class BowlingView implements SportView {
  private wrap: HTMLDivElement;
  private alley: Alley;
  private phud: PersonalHud | null = null;
  private shud: ScreenHud | null = null;
  private audio: BowlingAudio;
  private lanes: LaneRT[] = [];
  private laneKey = "";
  private s: GameState | null = null;
  private lastSeq = -1;
  private raf = 0;
  private ro: ResizeObserver;
  private last = now();
  private w = 1;
  private h = 1;
  private dead = false;
  // personal camera
  private camPos = new THREE.Vector3(0, 1.4, 3);
  private camLook = new THREE.Vector3(0, 0, -6);
  private camFov = 45;
  private shake = 0;
  // input
  private onShot: ((shot: Shot) => void) | null = null;
  private aimStart = 0;
  private drag: { id: number; pts: { x: number; y: number; t: number }[]; x0: number; wx0: number; stroke: boolean } | null = null;
  private pending: { at: number; shot: Shot } | null = null;
  private hintUntil = 0;
  private hintText = "";
  private v = new THREE.Vector3();

  constructor(private root: HTMLElement, private opts: { mode: "screen" | "personal"; me: () => string; sound: boolean }) {
    this.wrap = document.createElement("div");
    this.wrap.className = `bw-root ${opts.mode}`;
    const canvas = document.createElement("canvas");
    this.wrap.appendChild(canvas);
    root.appendChild(this.wrap);
    this.alley = new Alley(canvas);
    if (opts.mode === "personal") this.phud = new PersonalHud(this.wrap);
    else this.shud = new ScreenHud(this.wrap);
    this.audio = new BowlingAudio(opts.sound);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.wrap.addEventListener("pointerdown", this.down);
    this.wrap.addEventListener("pointermove", this.move);
    this.wrap.addEventListener("pointerup", this.up);
    this.wrap.addEventListener("pointercancel", this.cancel);
    this.wrap.addEventListener("contextmenu", (e) => e.preventDefault());
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  private get personal() {
    return this.opts.mode === "personal";
  }
  private get myIdx() {
    const me = this.opts.me();
    return this.lanes.findIndex((l) => l.pid === me && !!me);
  }

  // ------------------------------------------------------------------ state
  render(s: GameState) {
    const first = !this.s;
    this.s = s;
    const sp = s.sport;
    if (!sp) return;
    this.ensureLanes(s);
    if (first) this.lastSeq = s.seq; // an old shot is not replayed when the view opens
    else if (s.anim.kind === "shot" && s.seq !== this.lastSeq) this.anim(s);
    for (const l of this.lanes) {
      if (!l.pid) continue;
      const lane = sp.lanes[l.pid] as BowlingLane | undefined;
      if (!lane) continue;
      l.latest = lane;
      if (l.phase === "rest") this.applyLatest(l);
    }
    this.refreshHud();
    if (this.shud) this.placeTags();
  }

  /** Scores on the overlays: a player's card only moves on once their ball has hit the pins on screen. */
  private shownCard = new Map<string, { lane: unknown; cards: (number | null)[]; total: number }>();
  private refreshHud() {
    const s = this.s;
    const sp = s?.sport;
    if (!s || !sp) return;
    const lanes = { ...sp.lanes };
    const cards = { ...sp.cards };
    const total = { ...sp.total };
    for (const l of this.lanes) {
      if (!l.pid) continue;
      const playing = l.phase === "replay" || l.phase === "hold";
      const snap = this.shownCard.get(l.pid);
      if (playing && snap) {
        lanes[l.pid] = snap.lane;
        cards[l.pid] = snap.cards;
        total[l.pid] = snap.total;
      } else if (sp.lanes[l.pid]) this.shownCard.set(l.pid, { lane: sp.lanes[l.pid], cards: sp.cards[l.pid] ?? [], total: sp.total[l.pid] ?? 0 });
    }
    const shown = { ...s, sport: { ...sp, lanes, cards, total } };
    this.phud?.update(shown, this.opts.me());
    this.shud?.update(shown);
  }

  anim(s: GameState) {
    if (s.seq === this.lastSeq) return;
    this.lastSeq = s.seq;
    const a = s.anim;
    if (a.kind === "shot") {
      const l = this.lanes.find((x) => x.pid === a.playerId);
      if (!l) return;
      this.startReplay(l, a.replay, s);
    } else if (a.kind === "sportRound") {
      for (const l of this.lanes) {
        if (l.phase === "replay" || l.phase === "hold") continue;
        const lane = l.pid ? (s.sport?.lanes[l.pid] as BowlingLane | undefined) : undefined;
        if (lane) l.latest = lane;
        l.shown = { standing: Array(10).fill(true), pos: RACK.flat() };
        this.setPhase(l, "drop");
      }
      if (this.opts.sound) sfx.whoosh();
    } else if (a.kind === "win") {
      const i = this.lanes.findIndex((l) => l.pid === a.playerId);
      if (i >= 0) {
        this.alley.burst(i, 140);
        setTimeout(() => !this.dead && this.alley.burst(i, 120), 600);
      }
    }
  }

  setInput(cb: ((shot: Shot) => void) | null) {
    this.onShot = this.personal ? cb : null;
    if (!this.onShot) this.drag = null;
  }

  private ensureLanes(s: GameState) {
    const key = s.players.map((p) => `${p.id}:${p.duck}:${p.name}`).join("|") + this.opts.mode;
    if (key === this.laneKey) return;
    this.laneKey = key;
    const specs: LaneSpec[] = s.players.map((p) => ({ key: p.id, name: p.name, duck: p.duck, color: DUCKS[p.duck]?.color ?? "#ffd23f", num: "" }));
    // phones: an empty decoration lane on each side so the alley feels full
    if (this.personal) {
      specs.unshift({ key: "", name: "", duck: null, color: "#9b7bff", num: "" });
      specs.push({ key: "", name: "", duck: null, color: "#3ee8ff", num: "" });
    }
    specs.forEach((x, i) => (x.num = ar(i + 1)));
    const old = new Map(this.lanes.map((l) => [l.pid, l]));
    this.alley.build(specs, !this.personal);
    this.lanes = specs.map((x) => {
      const prev = x.key ? old.get(x.key) : undefined;
      return prev ?? { pid: x.key, shown: { standing: Array(10).fill(true), pos: RACK.flat() }, phase: "rest", t0: 0, ballShownAt: 0, ballWasShown: false };
    });
    this.resize();
    const mi = this.myIdx;
    if (mi >= 0) {
      const x0 = this.alley.laneX(mi);
      this.camPos.x = x0;
      this.camLook.x = x0;
      if (this.alley.sign) this.alley.sign.position.x = x0;
    }
  }

  /** Show the server's lane on the deck (pins removed by a sweep, a fresh rack dropped in). */
  private applyLatest(l: LaneRT) {
    const lane = l.latest;
    if (!lane) return;
    const same = lane.standing.every((v, i) => v === l.shown.standing[i]) && lane.pos.every((v, i) => Math.abs(v - l.shown.pos[i]) < 1e-3);
    if (same) return;
    const fresh = lane.standing.every(Boolean);
    const from = l.shown.standing.map((up, i) => (up ? rackPose(l.shown.pos, i) : null));
    l.from = from;
    l.dropNext = fresh;
    this.setPhase(l, "sweep");
  }

  private setPhase(l: LaneRT, p: LaneRT["phase"]) {
    l.phase = p;
    l.t0 = now();
  }

  private startReplay(l: LaneRT, r: Replay, s: GameState) {
    const n = r.ball.length / 3;
    let impact = Infinity;
    let moved = 0;
    for (const a of r.bodies ?? []) {
      if (a.length > 6 && a[2] >= 0) {
        impact = Math.min(impact, a[0] + 1);
        moved++;
      }
    }
    const labelAt = Number.isFinite(impact) ? Math.min(n - 1, impact + 26) : Math.max(0, n - 14);
    l.replay = { r, n, impact, labelAt, crashed: false, popped: false, moved };
    l.from = undefined;
    const lane = s.sport?.lanes[l.pid] as BowlingLane | undefined;
    if (lane) l.latest = lane;
    this.setPhase(l, "replay");
    // my own throw: start the clock when it left my hand so the ball does not jump back
    if (this.pending && l.pid === this.opts.me()) {
      l.t0 = Math.max(now() - 400, this.pending.at);
      this.pending = null;
    }
    const i = this.lanes.indexOf(l);
    const mine = i === this.myIdx;
    this.audio.rollStart(i, this.panOf(i), mine || !this.personal ? 1 : 0.25);
  }

  private panOf(i: number) {
    if (this.personal) return clamp((i - Math.max(0, this.myIdx)) * 0.5, -1, 1);
    return this.lanes.length > 1 ? (i / (this.lanes.length - 1)) * 1.4 - 0.7 : 0;
  }

  // ------------------------------------------------------------------ frame loop
  private loop = () => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.lanes.forEach((l, i) => this.updateLane(l, i, t));
    this.alley.pinsDone();
    this.alley.stepParticles(dt);
    this.updateFlash(dt);
    if (this.personal) this.updateCamera(dt);
    this.updateAim(t);
    this.alley.render();
  };

  private updateLane(l: LaneRT, i: number, t: number) {
    const A = this.alley;
    const el = (t - l.t0) / 1000;
    const sp = this.s?.sport;
    const canShoot = !!sp && this.s?.phase === "sport" && sp.open.includes(l.pid);
    const mine = i === this.myIdx;
    let ballShown = false;

    if (l.phase === "replay" && l.replay) {
      const R = l.replay;
      const idx = el / R.r.dt;
      const [bx, by, bz] = ballAt(R.r, idx);
      A.setBall(i, by > -0.15, bx, by, -zv(bz));
      ballShown = true;
      for (let k = 0; k < 10; k++) {
        const p = pinAt(R.r, k, idx);
        if (p) A.setPin(i, k, p[0], p[1], -zv(p[2]), p[3], p[4], 1, true);
        else A.setPin(i, k, 0, 0, 0, 0, 0, 0, false);
      }
      const gutter = Math.abs(bx) > LANE_HALF;
      this.audio.rollUpdate(i, clamp(bz / HEAD_Z, 0, 1), gutter);
      if (!R.crashed && idx >= R.impact) {
        R.crashed = true;
        this.audio.rollStop(i, 0.6);
        this.audio.crash(clamp(R.moved / 10, 0.15, 1) * (mine || !this.personal ? 1 : 0.35), this.panOf(i));
        if (mine) this.shake = Math.max(this.shake, 0.012 + R.moved * 0.004);
        this.impactFlash(i, R.moved);
      }
      if (!R.popped && idx >= R.labelAt) {
        R.popped = true;
        this.labelPop(l, i, R.r.label ?? "");
      }
      if (idx >= R.n - 1) {
        this.audio.rollStop(i, 0.2);
        this.setPhase(l, "hold");
      }
    } else if (l.phase === "hold" && l.replay) {
      const R = l.replay;
      for (let k = 0; k < 10; k++) {
        const p = pinAt(R.r, k, R.n - 1);
        if (p) A.setPin(i, k, p[0], p[1], -zv(p[2]), p[3], p[4], 1, true);
        else A.setPin(i, k, 0, 0, 0, 0, 0, 0, false);
      }
      A.setBall(i, false);
      if (!R.popped) {
        R.popped = true;
        this.labelPop(l, i, R.r.label ?? "");
      }
      if (el > 0.75) {
        // sweep away what fell, keep what stands
        l.from = Array.from({ length: 10 }, (_, k) => pinAt(R.r, k, R.n - 1));
        l.replay = undefined;
        const lane = l.latest;
        l.dropNext = !!lane && lane.standing.every(Boolean);
        this.setPhase(l, "sweep");
        this.refreshHud();
      }
    } else if (l.phase === "sweep") {
      const lane = l.latest;
      const target = lane ? { standing: lane.standing, pos: lane.pos } : l.shown;
      const u = clamp(el / 0.5, 0, 1);
      const e = u * u * (3 - 2 * u);
      for (let k = 0; k < 10; k++) {
        const f = l.from?.[k];
        if (!f) {
          A.setPin(i, k, 0, 0, 0, 0, 0, 0, false);
          continue;
        }
        if (target.standing[k] && !l.dropNext) {
          const g = rackPose(target.pos, k);
          A.setPin(i, k, f[0] + (g[0] - f[0]) * e, f[1] + (g[1] - f[1]) * e, -zv(f[2] + (g[2] - f[2]) * e), f[3] * (1 - e), f[4] * (1 - e), 1, true);
        } else {
          // the sweep: down pins sink away
          A.setPin(i, k, f[0], f[1] - e * 0.35, -zv(f[2] + e * 0.25), f[3], f[4], 1 - e * 0.9, u < 1);
        }
      }
      if (u >= 1) {
        l.shown = { standing: [...target.standing], pos: [...target.pos] };
        if (l.dropNext) {
          l.shown = { standing: Array(10).fill(true), pos: RACK.flat() };
          this.setPhase(l, "drop");
        } else this.setPhase(l, "rest");
        l.dropNext = false;
        l.from = undefined;
        if ((l.phase as string) === "rest") this.applyLatest(l);
      }
    } else if (l.phase === "drop") {
      for (let k = 0; k < 10; k++) {
        const u = clamp((el - k * 0.035) / 0.6, 0, 1);
        const p = rackPose(l.shown.pos, k);
        A.setPin(i, k, p[0], p[1] + (1 - easeOutBounce(u)) * 0.75, -zv(p[2]), 0, 0, 1, true);
      }
      if (el > 0.95) {
        this.setPhase(l, "rest");
        this.applyLatest(l);
      }
    } else {
      for (let k = 0; k < 10; k++) {
        const up = l.shown.standing[k];
        const p = rackPose(l.shown.pos, k);
        A.setPin(i, k, p[0], p[1], -zv(p[2]), 0, 0, 1, up);
      }
    }

    // the ball waiting at the foul line
    if (!ballShown) {
      const waiting = canShoot && (l.phase === "rest" || l.phase === "drop" || l.phase === "sweep");
      if (waiting) {
        if (!l.ballWasShown) l.ballShownAt = t;
        const pop = clamp((t - l.ballShownAt) / 350, 0, 1);
        const sc = pop < 1 ? 1 - Math.pow(1 - pop, 3) * Math.cos(pop * 7) * 0.9 : 1;
        if (mine && this.pending) {
          // just thrown: roll forward until the server's replay takes over
          const e = (t - this.pending.at) / 1000;
          const v0 = ballSpeed(this.pending.shot.power);
          const z = v0 * Math.cos(this.pending.shot.aim) * e;
          A.setBall(i, true, startX(this.pending.shot.start) + v0 * Math.sin(this.pending.shot.aim) * e, BALL_R, -zv(z));
          if (e > 3) this.pending = null;
        } else A.setBall(i, true, mine ? this.aimStart * MAX_START : 0, BALL_R * clamp(sc, 0.01, 1.2), 0.0, false, clamp(sc, 0.01, 1.2));
      } else A.setBall(i, false);
      l.ballWasShown = waiting;
    } else l.ballWasShown = false;
  }

  private labelPop(l: LaneRT, i: number, label: string) {
    if (!label) return;
    const kind = popKind(label);
    const mine = i === this.myIdx;
    if (kind === "strike") this.alley.burst(i, mine || !this.personal ? 110 : 50);
    if (this.personal) {
      if (mine) {
        this.phud?.pop(label, "");
        if (this.opts.sound) {
          if (kind === "strike") sfx.fanfare();
          else if (kind === "spare") sfx.star();
          else if (kind === "gutter") sfx.bad();
          else sfx.pop();
        }
      }
    } else {
      const p = this.project(this.alley.laneX(i), 0.9, -HEAD_V - 0.2);
      const sc = clamp(this.laneWidthPx() / 260, 0.45, 1.2);
      this.shud?.pop(label, p.x, p.y, sc);
      if (this.opts.sound) {
        if (kind === "strike") sfx.star();
        else if (kind === "spare") sfx.coin();
      }
    }
    void l;
  }

  // ------------------------------------------------------------------ effects
  private flashT = 0;
  private flashLane = 0;
  private flashK = 0;
  private impactFlash(i: number, moved: number) {
    this.flashT = 1;
    this.flashLane = i;
    this.flashK = clamp(moved / 10, 0.25, 1);
  }
  private updateFlash(dt: number) {
    const f = this.alley.flash;
    const m = f.material as THREE.MeshBasicMaterial;
    if (this.flashT <= 0) {
      m.opacity = 0;
      f.visible = false;
      return;
    }
    this.flashT = Math.max(0, this.flashT - dt * 3.2);
    f.visible = true;
    f.position.set(this.alley.laneX(this.flashLane), 0.25, -HEAD_V - 0.25);
    f.quaternion.copy(this.alley.camera.quaternion);
    f.scale.setScalar(0.6 + (1 - this.flashT) * 1.4 * this.flashK);
    m.opacity = this.flashT * 0.85 * this.flashK;
  }

  // ------------------------------------------------------------------ camera
  private aimPose() {
    const a = this.w / this.h;
    const x0 = this.alley.laneX(Math.max(0, this.myIdx));
    if (a < 0.8) return { pos: new THREE.Vector3(x0, 1.38, 3.0), look: new THREE.Vector3(x0, 0, -6.2), fov: 50 };
    if (a < 1.35) return { pos: new THREE.Vector3(x0, 1.3, 2.75), look: new THREE.Vector3(x0, 0.02, -6.5), fov: 42 };
    return { pos: new THREE.Vector3(x0, 1.6, 4.5), look: new THREE.Vector3(x0, 0, -3.3), fov: 31 };
  }

  private updateCamera(dt: number) {
    const cam = this.alley.camera;
    const mi = this.myIdx;
    const l = mi >= 0 ? this.lanes[mi] : null;
    const aim = this.aimPose();
    let pos = aim.pos;
    let look = aim.look;
    let fov = aim.fov;
    let k = 4.5;
    const x0 = aim.pos.x;
    const a = this.w / this.h;
    const deckPos = new THREE.Vector3(x0, a < 0.8 ? 0.88 : 0.98, -HEAD_V + (a < 0.8 ? 3.2 : 3.5));
    const deckLook = new THREE.Vector3(x0, 0.1, -HEAD_V - 0.35);
    const deckFov = a < 0.8 ? 40 : a < 1.35 ? 34 : 30;
    if (l && (l.phase === "replay" || l.phase === "hold" || (l.phase === "sweep" && l.from))) {
      let bz = HEAD_Z;
      let bx = 0;
      if (l.phase === "replay" && l.replay) {
        const b = ballAt(l.replay.r, (now() - l.t0) / 1000 / l.replay.r.dt);
        bz = b[2];
        bx = b[0];
      }
      const zb = -zv(Math.min(bz, HEAD_Z));
      const follow = a < 1.35
        ? { pos: new THREE.Vector3(x0 + bx * 0.5, 1.05, zb + 2.9), look: new THREE.Vector3(x0 + bx * 0.25, 0.05, zb - 5.5) }
        : { pos: new THREE.Vector3(x0 + bx * 0.5, 1.2, zb + 3.6), look: new THREE.Vector3(x0 + bx * 0.25, 0, zb - 4) };
      const u = clamp((bz - 9) / 7, 0, 1);
      const e = u * u * (3 - 2 * u);
      pos = follow.pos.clone().lerp(deckPos, e);
      look = follow.look.clone().lerp(deckLook, e);
      fov = aim.fov + (deckFov - aim.fov) * e;
      k = l.phase === "replay" ? 5 : 3;
    } else if (l && this.pending) {
      k = 2;
    }
    const s = 1 - Math.exp(-dt * k);
    this.camPos.lerp(pos, s);
    this.camLook.lerp(look, s);
    this.camFov += (fov - this.camFov) * s;
    this.shake = Math.max(0, this.shake - dt * 0.08);
    const sh = this.shake;
    cam.position.copy(this.camPos).add(this.v.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0));
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - this.camFov) > 0.01) {
      cam.fov = this.camFov;
      cam.updateProjectionMatrix();
    }
  }

  private fitScreenCamera() {
    const cam = this.alley.camera;
    const n = this.lanes.length;
    const W = n * 2.0;
    const boardFrac = 0.33;
    const full = this.w * (1 - boardFrac);
    cam.fov = 20;
    cam.aspect = full / this.h;
    cam.setViewOffset(full, this.h, 0, 0, this.w, this.h);
    // the projector looks at the business end: the last part of every lane and the pin decks, big
    const target = new THREE.Vector3(0, 0.1, -HEAD_V + 0.6);
    const dir = new THREE.Vector3(0, 1.05, 1).normalize();
    const pts = [
      [-W / 2, 0, -HEAD_V + 2.7], [W / 2, 0, -HEAD_V + 2.7], [-W / 2, 0, -PIT_V - 0.4], [W / 2, 0, -PIT_V - 0.4], [-W / 2, 2.1, -HEAD_V + 0.25], [W / 2, 2.1, -HEAD_V + 0.25],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    // full-image NDC: x in [-1, 1] of the lanes area, which is [-1, 1 - 2*boardFrac] of the canvas
    let lo = 2;
    let hi = 120;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const fits = pts.every((p) => {
        const q = p.clone().project(cam);
        const xFull = (q.x + 1) / 2 * (this.w / full) * 2 - 1;
        return Math.abs(xFull) < 0.95 && q.y > -0.8 && q.y < 0.9;
      });
      if (fits) hi = d;
      else lo = d;
    }
    cam.position.copy(target).addScaledVector(dir, hi);
    cam.lookAt(target);
    const fog = this.alley.scene.fog as THREE.Fog;
    fog.near = hi + 6;
    fog.far = hi + 40;
    cam.far = hi + 60;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }

  private project(x: number, y: number, z: number) {
    const q = this.v.set(x, y, z).project(this.alley.camera);
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h };
  }
  private laneWidthPx() {
    if (this.lanes.length < 2) return 300;
    const a = this.project(this.alley.laneX(0), 0, -HEAD_V + 2.5).x;
    const b = this.project(this.alley.laneX(1), 0, -HEAD_V + 2.5).x;
    return Math.abs(b - a);
  }
  private placeTags() {
    if (!this.shud) return;
    const w = this.laneWidthPx();
    this.lanes.forEach((l, i) => {
      if (!l.pid) return;
      const p = this.project(this.alley.laneX(i), 0, -HEAD_V + 2.75);
      this.shud!.placeTag(l.pid, p.x, Math.min(p.y + 10, this.h - 80), w - 8);
    });
    const sc = clamp(w / 240, 0.5, 1);
    this.shud.el.style.setProperty("--tag", String(sc));
    this.shud.el.querySelectorAll<HTMLElement>(".bw-tag").forEach((t) => {
      t.style.fontSize = `${Math.round(24 * sc)}px`;
      t.classList.toggle("narrow", w < 190);
    });
  }

  private resize() {
    const w = Math.max(1, this.wrap.clientWidth);
    const h = Math.max(1, this.wrap.clientHeight);
    const rect = this.wrap.getBoundingClientRect();
    const css = rect.width > 0 ? rect.width / w : 1;
    this.w = w;
    this.h = h;
    const dpr = Math.min(2, (devicePixelRatio || 1) * css);
    this.alley.renderer.setPixelRatio(dpr);
    this.alley.renderer.setSize(w, h, false);
    const cam = this.alley.camera;
    if (this.personal) {
      cam.clearViewOffset();
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    } else if (this.lanes.length) {
      this.fitScreenCamera();
      this.placeTags();
    }
  }

  // ------------------------------------------------------------------ input (personal)
  private canAim() {
    const mi = this.myIdx;
    if (!this.onShot || mi < 0 || this.pending) return false;
    const l = this.lanes[mi];
    return l.phase !== "replay" && l.phase !== "hold";
  }

  /** x across the lane (physics) under a screen point, on the vertical plane of the foul line */
  private worldX(px: number, py: number) {
    const cam = this.alley.camera;
    const ndc = new THREE.Vector3((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1, 0.5);
    const p = ndc.unproject(cam);
    const d = p.sub(cam.position).normalize();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);
    const hit = new THREE.Vector3();
    const ok = new THREE.Ray(cam.position.clone(), d).intersectPlane(plane, hit);
    return (ok ? hit.x : cam.position.x) - this.alley.laneX(Math.max(0, this.myIdx));
  }

  private local(e: PointerEvent) {
    const r = this.wrap.getBoundingClientRect();
    const k = r.width / this.w || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k, t: e.timeStamp || now() };
  }

  private down = (e: PointerEvent) => {
    if (!this.canAim() || this.drag) return;
    e.preventDefault();
    const p = this.local(e);
    try {
      this.wrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.drag = { id: e.pointerId, pts: [p], x0: this.aimStart, wx0: this.worldX(p.x, p.y), stroke: false };
    this.wrap.classList.add("dragging");
  };

  private move = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const ce of evs.length ? evs : [e]) d.pts.push(this.local(ce));
    if (d.pts.length > 240) d.pts.splice(0, d.pts.length - 240);
    const cur = d.pts[d.pts.length - 1];
    const anchor = this.anchor(d.pts);
    const up = d.pts[anchor].y - cur.y;
    if (up < Math.max(14, this.h * 0.03) && !d.stroke) {
      // placing the ball along the foul line
      const wx = this.worldX(cur.x, cur.y);
      this.aimStart = clamp(d.x0 + (wx - d.wx0) / MAX_START, -1, 1);
    } else d.stroke = true;
  };

  private up = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.wrap.classList.remove("dragging");
    d.pts.push(this.local(e));
    const shot = this.readStroke(d.pts);
    if (!d.stroke) return;
    if (!shot) {
      this.flashHint("اسحب لفوق أسرع!");
      return;
    }
    if (!this.onShot || !this.canAim()) return;
    this.pending = { at: now(), shot };
    this.onShot(shot);
    this.alley.guide.visible = false;
    if (this.opts.sound) sfx.whoosh();
    setTimeout(() => {
      // the server said no (time up / not my turn): give the ball back
      if (this.pending && this.pending.shot === shot && now() - this.pending.at > 2400) this.pending = null;
    }, 2500);
  };

  private cancel = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) {
      this.drag = null;
      this.wrap.classList.remove("dragging");
    }
  };

  /** index of the lowest point on screen (where the upward flick starts) */
  private anchor(pts: { y: number }[]) {
    let best = 0;
    for (let i = 0; i < pts.length; i++) if (pts[i].y >= pts[best].y - 0.5) best = i;
    return best;
  }

  /** Turn the stroke into a shot (null = too slow / too short). */
  private readStroke(pts: { x: number; y: number; t: number }[], live = false): Shot | null {
    const a = this.anchor(pts);
    const P = pts.slice(a);
    if (P.length < 2) return null;
    const first = P[0];
    const lastP = P[P.length - 1];
    const len = Math.hypot(lastP.x - first.x, lastP.y - first.y);
    if (len < Math.max(30, this.h * 0.07) && !live) return null;
    if (first.y - lastP.y < 10) return null;
    // the lane's "straight ahead" on screen, through the ball
    const mi = Math.max(0, this.myIdx);
    const bx = this.alley.laneX(mi) + this.aimStart * MAX_START;
    const s0 = this.project(bx, BALL_R, 0);
    const s1 = this.project(bx, BALL_R, -6);
    const Lx = s1.x - s0.x;
    const Ly = s1.y - s0.y;
    const ang = (vx: number, vy: number) => Math.atan2(Lx * vy - Ly * vx, Lx * vx + Ly * vy);
    // aim from the first 60% of the stroke, hook from how it bends after that
    let mid = 0;
    let acc = 0;
    const seg: number[] = [0];
    for (let i = 1; i < P.length; i++) {
      acc += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      seg.push(acc);
    }
    while (mid < P.length - 1 && seg[mid] < acc * 0.6) mid++;
    const m = P[Math.max(1, mid)];
    const a1 = ang(m.x - first.x, m.y - first.y);
    const a2 = mid < P.length - 1 ? ang(lastP.x - m.x, lastP.y - m.y) : a1;
    let bend = a2 - a1;
    bend = Math.sign(bend) * Math.max(0, Math.abs(bend) - 0.07);
    // speed: the fastest ~50 ms of the stroke, in screen heights per second
    let vmax = 0;
    for (let i = P.length - 1, j = P.length - 1; i > 0; i--) {
      while (j > i && P[j].t - P[i].t > 60) j--;
      const tt = P[j].t - P[i].t;
      if (tt >= 16) vmax = Math.max(vmax, Math.hypot(P[j].x - P[i].x, P[j].y - P[i].y) / (tt / 1000));
    }
    if (vmax === 0) {
      const tt = Math.max(16, lastP.t - first.t);
      vmax = len / (tt / 1000);
    }
    const vn = vmax / this.h;
    if (vn < 0.7 && !live) return null;
    return {
      aim: clamp(a1 * AIM_GAIN, -0.13, 0.13),
      power: clamp((vn - 0.8) / 3.4, 0.06, 1),
      spin: clamp(bend / 0.55, -1, 1),
      start: this.aimStart,
    };
  }

  private flashHint(text: string) {
    this.hintText = text;
    this.hintUntil = now() + 1600;
  }

  /** aim guide, ring under the ball and the hint */
  private updateAim(t: number) {
    const A = this.alley;
    const mi = this.myIdx;
    const able = this.personal && this.canAim() && mi >= 0 && this.lanes[mi].phase !== "sweep";
    this.wrap.classList.toggle("input", !!able);
    // ring
    if (able && !this.drag) {
      A.ring.visible = true;
      const x = A.laneX(mi) + this.aimStart * MAX_START;
      A.ring.position.set(x, 0.006, 0);
      const pulse = 0.85 + Math.sin(t / 260) * 0.12;
      A.ring.scale.setScalar(pulse);
      (A.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t / 260) * 0.3;
    } else A.ring.visible = false;
    // guide while drawing the stroke
    const d = this.drag;
    if (able && d && d.stroke) {
      const shot = this.readStroke(d.pts, true);
      if (shot) {
        const g = A.guide;
        const n = g.count;
        const m = new THREE.Matrix4();
        const c = new THREE.Color();
        const zEnd = HEAD_Z * 0.62;
        for (let k = 0; k < n; k++) {
          const z = 0.6 + (k / (n - 1)) * zEnd;
          const x = ballXAt(shot, z);
          m.makeTranslation(A.laneX(mi) + x, 0.008, -zv(z));
          g.setMatrixAt(k, m);
          const fade = Math.pow(1 - k / n, 1.4);
          c.setRGB(1 * fade, 0.82 * fade, 0.25 * fade);
          g.setColorAt(k, c);
        }
        g.instanceMatrix.needsUpdate = true;
        if (g.instanceColor) g.instanceColor.needsUpdate = true;
        g.visible = true;
      } else A.guide.visible = false;
    } else A.guide.visible = false;
    // hint
    if (this.phud) {
      let text: string | null = null;
      if (t < this.hintUntil) text = this.hintText;
      else if (able && !d) text = "اسحب الكرة لفوق وأطلقها!";
      this.phud.hint(text);
    }
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.wrap.removeEventListener("pointerdown", this.down);
    this.wrap.removeEventListener("pointermove", this.move);
    this.wrap.removeEventListener("pointerup", this.up);
    this.wrap.removeEventListener("pointercancel", this.cancel);
    this.audio.dispose();
    this.phud?.destroy();
    this.shud?.destroy();
    this.alley.dispose();
    this.wrap.remove();
    void this.root;
  }
}

export const createBowlingView: SportViewFactory = (root, opts) => new BowlingView(root, opts);
