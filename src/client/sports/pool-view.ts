import * as THREE from "three";
import { DUCKS } from "../../shared/data";
import { POCKETS } from "../../shared/pool/physics";
import { TURN_MS, placeWhite } from "../../shared/pool/rules";
import { TABLE, type PoolBall, type PoolShot, type PoolTable } from "../../shared/pool/types";
import type { Replay, Shot } from "../../shared/sports/types";
import type { GameState } from "../../shared/types";
import { ar } from "../net";
import { PoolAudio } from "./pool/audio";
import { PersonalHud, ScreenHud } from "./pool/hud";
import "./pool/pool.css";
import { OUT_X, OUT_Z, PoolScene } from "./pool/scene";
import type { SportView, SportViewFactory, SportViewOpts } from "./view";

/** بلياردو البط view.
 *  - "screen" (projector): a cinematic angled view of the table and a scoreboard; every shot is played back with
 *    the cue drawing back and striking.
 *  - "personal" (phone): the table from above (slightly tilted), fitted to the screen in portrait or landscape.
 *    On your turn: drag anywhere to turn the aim around the white (tap a ball to aim straight at it), pull the
 *    power bar down and let go to shoot, set side / top / back spin on the little white ball. With the white in
 *    hand, drag it to place it behind the head string first. */

const { r: R, length: L, width: W } = TABLE;
const HL = L / 2;
const HW = W / 2;
const now = () => performance.now();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);
/** cue draw-back before a replayed shot (others' shots, and every shot on the projector) */
const PRE = 0.62;
const MAX_PULL = 0.24;
/** the only aiming help: a short straight line from the white in the cue's direction (metres) */
const AIM_STUB = 0.22;

interface ReplayRT {
  r: Replay;
  pid: string;
  tracks: number[][];
  events: number[];
  ev: number;
  frames: number;
  t0: number;
  pre: number;
  aim: number;
  power: number;
  falls: Map<number, { frame: number; pocket: number }>;
  done: boolean;
  label: string;
  cueSound: boolean;
}

function trackAt(tr: number[], idx: number): [number, number] {
  const n = tr.length / 2;
  if (n <= 1) return [tr[0] ?? 0, tr[1] ?? 0];
  const f = clamp(idx, 0, n - 1);
  const j0 = Math.floor(f);
  const j1 = Math.min(n - 1, j0 + 1);
  const u = f - j0;
  return [tr[j0 * 2] + (tr[j1 * 2] - tr[j0 * 2]) * u, tr[j0 * 2 + 1] + (tr[j1 * 2 + 1] - tr[j0 * 2 + 1]) * u];
}

class PoolView implements SportView {
  private wrap: HTMLDivElement;
  private sc: PoolScene;
  private phud: PersonalHud | null = null;
  private shud: ScreenHud | null = null;
  private audio: PoolAudio;
  private s: GameState | null = null;
  private table: PoolTable | null = null;
  private rest: PoolBall[] = [];
  private potted: Record<string, number[]> = {};
  private replay: ReplayRT | null = null;
  private lastSeq = -1;
  private raf = 0;
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private dead = false;
  private last = now();
  private lastPos: { x: number; z: number }[] = Array.from({ length: 16 }, () => ({ x: NaN, z: NaN }));
  private popIn = new Map<number, number>();
  private shake = 0;
  private v = new THREE.Vector3();
  // input (personal)
  private onShot: ((shot: PoolShot) => void) | null = null;
  private turnKey = "";
  private aim = 0;
  private power = 0;
  private lastPower = 0.55;
  private spin = 0;
  private start = 0;
  private place: { x: number; y: number } | null = null;
  private drag: { id: number; mode: "aim" | "place"; phi: number; x0: number; y0: number; t0: number; moved: boolean } | null = null;
  private pdrag: { id: number; y0: number; h: number } | null = null;
  private sdrag: number | null = null;
  private pending: { at: number; shot: PoolShot } | null = null;
  private strikeAt = 0;
  private hintText = "";
  private hintUntil = 0;

  constructor(private root: HTMLElement, private opts: SportViewOpts) {
    this.wrap = document.createElement("div");
    this.wrap.className = `pl-root ${opts.mode}`;
    const canvas = document.createElement("canvas");
    this.wrap.appendChild(canvas);
    root.appendChild(this.wrap);
    this.sc = new PoolScene(canvas, opts.mode);
    if (this.personal) {
      this.phud = new PersonalHud(this.wrap);
      this.bindControls();
    } else this.shud = new ScreenHud(this.wrap);
    this.audio = new PoolAudio(opts.sound);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.wrap.addEventListener("pointerdown", this.down);
    this.wrap.addEventListener("pointermove", this.move);
    this.wrap.addEventListener("pointerup", this.up);
    this.wrap.addEventListener("pointercancel", this.cancel);
    this.wrap.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("keydown", this.key);
    addEventListener("blur", this.dropDrags);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.wrap.addEventListener("lostpointercapture", this.cancel);
    this.resize();
    this.kick();
  }

  private get personal() {
    return this.opts.mode === "personal";
  }
  private get me() {
    return this.opts.me();
  }

  // ------------------------------------------------------------------ state
  render(s: GameState) {
    this.kick();
    const first = !this.s;
    this.s = s;
    const table = s.sport?.lanes.table as PoolTable | undefined;
    if (!table) return;
    if (first) {
      this.lastSeq = s.seq; // an old shot is not replayed when the view opens
      this.table = table;
      this.toRest(table);
    } else if (s.anim.kind === "shot" && s.seq !== this.lastSeq) this.anim(s);
    this.table = table;
    if (!this.replay) this.toRest(table);
    this.syncTurn();
  }

  private toRest(t: PoolTable) {
    for (const b of t.balls) {
      const was = this.rest.find((x) => x.n === b.n);
      if (!b.in && (!was || was.in)) this.popIn.set(b.n, now());
    }
    this.rest = t.balls.map((b) => ({ ...b }));
    this.potted = Object.fromEntries(Object.entries(t.potted).map(([k, v]) => [k, [...v]]));
  }

  anim(s: GameState) {
    if (s.seq === this.lastSeq) return;
    this.lastSeq = s.seq;
    const a = s.anim;
    if (a.kind === "shot") this.startReplay(a.replay, a.playerId);
  }

  setInput(cb: ((shot: Shot | PoolShot) => void) | null) {
    this.kick();
    this.onShot = this.personal ? (cb as ((shot: PoolShot) => void) | null) : null;
    if (!this.onShot) {
      this.drag = null;
      this.pdrag = null;
      this.power = 0;
    }
    this.syncTurn();
  }

  private myTurn() {
    const s = this.s;
    const t = this.table;
    return !!(this.onShot && s && t && s.phase === "sport" && t.shooter === this.me && s.sport?.open.includes(this.me) && !this.replay && !this.pending);
  }

  /** A new turn of mine: aim at something sensible, the white where it is (or at the hand spot). */
  private syncTurn() {
    const t = this.table;
    if (!t) return;
    const key = this.myTurn() ? `${t.shots}:${t.shooter}` : "";
    if (key === this.turnKey) return;
    this.turnKey = key;
    if (!key) return;
    const cue = t.balls.find((b) => b.n === 0)!;
    this.place = t.inHand ? placeWhite(this.rest.filter((b) => b.n !== 0), { x: cue.x, y: cue.y }) : null;
    this.aim = this.defaultAim(cue.x, cue.y);
    this.power = 0;
    this.spin = 0;
    this.start = 0;
    this.phud?.setSpin(0, 0);
    this.phud?.setPower(0);
  }

  private defaultAim(x: number, y: number) {
    const on = this.rest.filter((b) => b.n !== 0 && !b.in);
    if (!on.length) return 0;
    const near = on.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));
    // the break: straight at the front ball
    const target = on.length === 15 ? on.reduce((a, b) => (b.x < a.x ? b : a)) : near;
    return Math.atan2(target.y - y, target.x - x);
  }

  private whiteNow(): { x: number; y: number } {
    if (this.place) return this.place;
    const c = this.rest.find((b) => b.n === 0);
    return c ? { x: c.x, y: c.y } : { x: TABLE.headX - 0.22, y: 0 };
  }

  // ------------------------------------------------------------------ replay
  private startReplay(r: Replay, pid: string) {
    const tracks = (r.bodies ?? []).slice(0, 16).map((a) => (Array.isArray(a) ? a : []));
    while (tracks.length < 16) tracks.push([]);
    const events = r.bodies?.[16] ?? [];
    let frames = 1;
    for (const tr of tracks) frames = Math.max(frames, tr.length / 2);
    const falls = new Map<number, { frame: number; pocket: number }>();
    let power = 0.5;
    for (let i = 0; i + 4 < events.length; i += 5) {
      if (events[i + 1] === 3) falls.set(events[i + 2], { frame: events[i], pocket: events[i + 3] });
      if (events[i + 1] === 4) power = events[i + 4];
    }
    // the white's first movement gives the cue's direction
    const c = tracks[0];
    let aim = this.aim;
    for (let k = 1; k < c.length / 2; k++) {
      const dx = c[k * 2] - c[0];
      const dy = c[k * 2 + 1] - c[1];
      if (Math.hypot(dx, dy) > 0.004) {
        aim = Math.atan2(dy, dx);
        break;
      }
    }
    const mine = !!this.pending && pid === this.me;
    const pre = mine ? 0 : PRE;
    this.replay = {
      r, pid, tracks, events, ev: 0, frames, pre, aim, power, falls, done: false, label: r.label ?? "",
      t0: mine ? Math.max(now() - 60, this.strikeAt) : now() + pre * 1000, cueSound: !mine,
    };
    this.pending = null;
    this.drag = null;
    this.pdrag = null;
    this.power = 0;
    this.phud?.setPower(0);
    for (let n = 0; n < 16; n++) this.lastPos[n] = { x: NaN, z: NaN };
  }

  private finishReplay() {
    this.dirty = true;
    const R0 = this.replay;
    this.replay = null;
    if (this.table) this.toRest(this.table);
    if (R0?.label) {
      this.phud?.pop(R0.label);
      this.shud?.pop(R0.label);
    }
    this.audio.rolling(0);
    this.syncTurn();
  }

  private colorOf(pid: string) {
    const p = this.s?.players.find((x) => x.id === pid);
    return DUCKS[p?.duck ?? 0]?.color ?? "#ffd23f";
  }

  private panOf(x: number) {
    return this.personal ? 0 : clamp(x / HL, -1, 1) * 0.6;
  }

  private stepReplay(t: number) {
    const Rp = this.replay!;
    const sc = this.sc;
    sc.handRing.visible = false;
    sc.kitchen.visible = false;
    const el = (t - Rp.t0) / 1000;
    const dt = Rp.r.dt;
    if (el < 0) {
      // the cue draws back and strikes
      for (let n = 0; n < 16; n++) {
        const tr = Rp.tracks[n];
        const visible = tr.length >= 2 && !(n !== 0 && this.rest.find((b) => b.n === n)?.in && tr.length <= 2);
        const [x, y] = trackAt(tr, 0);
        sc.setBall(n, visible, x, y);
      }
      const u = clamp((el + Rp.pre) / Rp.pre, 0, 1);
      const pull = 0.03 + Rp.power * MAX_PULL * 0.8;
      const gap = u < 0.72 ? ease(u / 0.72) * pull : pull * (1 - Math.pow((u - 0.72) / 0.28, 2));
      const [cx, cy] = trackAt(Rp.tracks[0], 0);
      sc.setCue(true, cx, cy, Rp.aim, Math.max(0, gap), 0, 0, clamp(u * 4, 0, 1));
      return;
    }
    const idx = el / dt;
    // sounds and floats as their moment comes
    const E = Rp.events;
    while (Rp.ev + 4 < E.length && E[Rp.ev] <= idx) {
      const [fr, kind, a, b, k] = E.slice(Rp.ev, Rp.ev + 5);
      Rp.ev += 5;
      void fr;
      const [ax] = trackAt(Rp.tracks[a] ?? [], idx);
      if (kind === 4) {
        if (Rp.cueSound) this.audio.cue(k);
      } else if (kind === 1) {
        this.audio.click(k, this.panOf(ax));
        if (k > 2.4) this.shake = Math.max(this.shake, 0.004 * Math.min(1, k / 5));
      } else if (kind === 2) this.audio.cushion(k, this.panOf(ax));
      else if (kind === 3) {
        const p = POCKETS[b];
        this.audio.pocket(k, this.panOf(p?.x ?? 0));
        if (a !== 0 && p) {
          const list = (this.potted[Rp.pid] = [...(this.potted[Rp.pid] ?? [])]);
          if (!list.includes(a)) list.push(a);
          const sp = this.project(p.x, 0.05, p.y);
          (this.phud ?? this.shud)?.float("+١", sp.x, sp.y, this.colorOf(Rp.pid));
        }
      }
    }
    let rolling = 0;
    for (let n = 0; n < 16; n++) {
      const tr = Rp.tracks[n];
      if (tr.length < 2) {
        const b = this.rest.find((x) => x.n === n);
        sc.setBall(n, !!b && !b.in, b?.x, b?.y);
        continue;
      }
      const fall = Rp.falls.get(n);
      let [x, y] = trackAt(tr, idx);
      let h = R;
      let vis = true;
      let s = 1;
      if (fall) {
        const lastOn = Math.max(0, tr.length / 2 - 2);
        if (idx >= lastOn) {
          // slide over the lip towards the pocket's middle, then drop out of sight
          const [lx, ly] = trackAt(tr, lastOn);
          const p = POCKETS[fall.pocket] ?? { x: lx, y: ly };
          const e = ease(clamp(((idx - lastOn) * dt) / 0.16, 0, 1));
          x = lx + (p.x - lx) * e;
          y = ly + (p.y - ly) * e;
          const d = clamp(((idx - lastOn) * dt - 0.05) / 0.3, 0, 1);
          h = R - d * d * 0.12;
          s = 1 - d * 0.15;
          vis = d < 1;
        }
      }
      const lp = this.lastPos[n];
      if (Number.isFinite(lp.x)) {
        const dx = x - lp.x;
        const dz = y - lp.z;
        this.sc.roll(n, dx, dz);
        rolling += Math.hypot(dx, dz);
      }
      this.lastPos[n] = { x, z: y };
      sc.setBall(n, vis, x, y, h, s);
    }
    this.audio.rolling((rolling / Math.max(1e-3, this.frameDt)) * 0.7);
    // the cue follows through and fades
    const [cx, cy] = trackAt(Rp.tracks[0], 0);
    const fo = clamp(el / 0.45, 0, 1);
    sc.setCue(fo < 1, cx, cy, Rp.aim, -0.015 * Math.sin(Math.min(1, fo * 3) * Math.PI / 2) + fo * 0.12, 0, 0, 1 - fo);
    if (idx >= Rp.frames - 1 + 0.4 / dt && !Rp.done) {
      Rp.done = true;
      this.finishReplay();
    }
  }

  private frameDt = 1 / 60;

  // ------------------------------------------------------------------ frame loop
  /** Battery: full frame rate only while something moves (a replay, the cue strike, a drag, a pop-in). Otherwise
   *  a slow tick (the projector's camera drift, the pulsing ring of a white in hand, the turn clock) and no
   *  shadow-map updates; nothing at all in the lobby / end screens or while the page is hidden. */
  private dirty = true;
  private tick = 0;
  private kick = () => {
    this.dirty = true;
    this.schedule(0);
  };
  private schedule(ms: number) {
    if (this.dead || this.raf || (this.tick && ms > 0)) return;
    if (ms <= 0) {
      if (this.tick) clearTimeout(this.tick);
      this.tick = 0;
      this.raf = requestAnimationFrame(this.loop);
    } else
      this.tick = window.setTimeout(() => {
        this.tick = 0;
        this.raf = requestAnimationFrame(this.loop);
      }, ms);
  }
  private get animating() {
    return !!(this.replay || this.pending || this.drag || this.pdrag || this.sdrag || this.popIn.size || this.shake > 0 || Math.abs(this.camK - (this.replay ? 1 : 0)) > 0.01);
  }

  private loop = () => {
    this.raf = 0;
    if (this.dead) return;
    const t = now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.frameDt = Math.max(1e-3, dt);
    this.last = t;
    const phase = this.s?.phase;
    if ((phase === "lobby" || phase === "end") && !this.replay) {
      // paused: one last picture, then wait for the next state
      if (this.dirty) this.sc.render();
      this.dirty = false;
      return;
    }
    if (this.pending && t - this.pending.at > 3000) this.pending = null;
    const moving = this.animating;
    if (this.replay) this.stepReplay(t);
    else this.drawRest(t);
    this.updateAim(t);
    this.updateHud();
    this.updateCamera(dt, t);
    const idleAnim = !this.personal || this.sc.handRing.visible;
    if (moving || this.dirty || idleAnim) {
      // shadows only change when something on the table moved
      if (moving || this.dirty) this.sc.renderer.shadowMap.needsUpdate = true;
      this.sc.render();
    }
    this.dirty = false;
    if (moving || this.animating) this.schedule(0);
    else this.schedule(idleAnim ? 90 : 250);
  };

  /** the phone locked / the app lost focus mid-drag: drop it, never shoot later */
  private dropDrags = () => {
    this.drag = null;
    this.pdrag = null;
    this.sdrag = null;
    this.power = 0;
    this.phud?.setPower(0);
    this.wrap.classList.remove("place");
    this.kick();
  };
  private onVisibility = () => {
    if (document.hidden) this.dropDrags();
    else this.kick();
  };

  private drawRest(t: number) {
    const mine = this.myTurn() || !!this.pending;
    for (let n = 0; n < 16; n++) {
      const b = this.rest.find((x) => x.n === n);
      if (!b || b.in) {
        this.sc.setBall(n, false);
        continue;
      }
      let { x, y } = b;
      if (n === 0 && mine && this.place) ({ x, y } = this.place);
      const p0 = this.popIn.get(n);
      let s = 1;
      if (p0 !== undefined) {
        const u = clamp((t - p0) / 380, 0, 1);
        s = u < 1 ? 1 - Math.pow(1 - u, 3) * Math.cos(u * 6) : 1;
        if (u >= 1) this.popIn.delete(n);
      }
      this.sc.setBall(n, true, x, y, R * clamp(s, 0.05, 1.2), clamp(s, 0.05, 1.2));
    }
    // the white waiting in someone's hand
    const t0 = this.table;
    const cue = this.rest.find((b) => b.n === 0);
    const inHand = !!t0?.inHand && this.s?.phase === "sport" && !!cue && !cue.in;
    const ring = this.sc.handRing;
    ring.visible = inHand;
    if (inHand && cue) {
      const w = mine && this.place ? this.place : cue;
      ring.position.set(w.x, 0.0015, w.y);
      ring.scale.setScalar(0.9 + Math.sin(t / 240) * 0.1);
    }
    this.sc.kitchen.visible = inHand && (mine || !this.personal);
  }

  // ------------------------------------------------------------------ aiming (personal)
  private updateAim(t: number) {
    const sc = this.sc;
    const able = this.myTurn();
    this.wrap.classList.toggle("aim", able && !this.drag);
    this.phud?.controls(able || !!this.pending);
    if (this.replay) {
      sc.ghost.visible = false;
      sc.setGuide([]);
      this.hint(null, t);
      return;
    }
    if (!able && !this.pending) {
      sc.ghost.visible = false;
      sc.setGuide([]);
      if (!this.replay) sc.setCue(false);
      this.hint(null, t);
      return;
    }
    const wv = this.whiteNow();
    const balls = this.rest.map((b) => (b.n === 0 ? { ...b, x: wv.x, y: wv.y } : b));
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    // the cue: pulled back with the power, then the strike
    let gap = 0.035 + this.power * MAX_PULL;
    if (this.pending) {
      const u = clamp((t - this.pending.at) / 70, 0, 1);
      gap = (0.035 + this.pending.shot.power * MAX_PULL) * (1 - u * u);
    }
    sc.setCue(true, wv.x, wv.y, this.aim, gap, this.spin, this.start, 1);
    if (this.pending) {
      sc.ghost.visible = false;
      sc.setGuide([]);
      return;
    }
    // no prediction (the owner's call): no ghost ball, no paths after contact. Only a short line showing the
    // direction the cue points; where the balls go is for the player to judge.
    void balls;
    sc.ghost.visible = false;
    const lines: number[][] = [[wv.x + dx * R * 1.4, wv.y + dy * R * 1.4, wv.x + dx * (R + AIM_STUB), wv.y + dy * (R + AIM_STUB), 1, 1, 1, 0.7, 0.024]];
    sc.setGuide(lines);
    // hints
    if (this.pdrag) this.hint(`القوة ${ar(Math.round(this.power * 100))}٪ · فك عشان تضرب`, t);
    else if (this.table?.inHand && this.drag?.mode !== "aim") this.hint("البيضا بيدك: اسحبها وحطها ورا الخط", t);
    else this.hint("لف حوالين البيضا وصوّب · اسحب القوة لتحت وفك", t);
  }

  private hint(text: string | null, t: number) {
    if (!this.phud) return;
    this.phud.hint(t < this.hintUntil ? this.hintText : text);
  }

  private flashHint(text: string) {
    this.hintText = text;
    this.hintUntil = now() + 1600;
  }

  private updateHud() {
    const s = this.s;
    const t = this.table;
    if (!s || !t) return;
    // while a shot plays, the one who took it stays highlighted
    const turn = s.phase !== "sport" ? "" : this.replay ? this.replay.pid : s.sport?.open[0] ?? "";
    let clock: number | null = null;
    if (turn && !this.replay && s.phaseEndsAt) {
      const sn = this.opts.serverNow?.() ?? Date.now();
      clock = clamp((s.phaseEndsAt - sn) / TURN_MS, 0, 1);
    }
    const d = { s, table: t, potted: this.potted, turn, clock, replaying: !!this.replay };
    this.phud?.update(d, this.me);
    this.shud?.update(d);
  }

  // ------------------------------------------------------------------ camera
  private camTarget = new THREE.Vector3();
  private updateCamera(dt: number, t: number) {
    const cam = this.sc.camera;
    if (this.personal) {
      this.shake = Math.max(0, this.shake - dt * 0.02);
      if (this.shake > 0) {
        cam.position.copy(this.basePos).add(this.v.set((Math.random() - 0.5) * this.shake, 0, (Math.random() - 0.5) * this.shake));
      } else cam.position.copy(this.basePos);
      cam.lookAt(this.baseLook);
      return;
    }
    // projector: a slow drift around the table, a touch closer while balls run
    const run = this.replay ? 1 : 0;
    this.camK += (run - this.camK) * (1 - Math.exp(-dt * 1.2));
    const yaw = Math.sin(t / 9000) * 0.07;
    const dist = this.screenDist * (1 - this.camK * 0.035);
    const el = this.screenElev;
    const dir = this.v.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    this.camTarget.set(0, -0.05, 0.02);
    cam.position.copy(this.camTarget).addScaledVector(dir, dist);
    this.shake = Math.max(0, this.shake - dt * 0.02);
    if (this.shake > 0) cam.position.x += (Math.random() - 0.5) * this.shake;
    cam.lookAt(this.camTarget);
  }
  private camK = 0;
  private screenDist = 4;
  private screenElev = 0.86;
  private basePos = new THREE.Vector3(0, 4, 0);
  private baseLook = new THREE.Vector3();
  private portrait = true;

  /** Fit the table: personal = from above, as big as the HUD allows; screen = angled, left of the scoreboard. */
  private fit() {
    const cam = this.sc.camera;
    const w = this.w;
    const h = this.h;
    if (this.personal) {
      cam.clearViewOffset();
      cam.aspect = w / h;
      cam.fov = 34;
      this.portrait = h > w * 1.05;
      const tilt = 0.17;
      const look = new THREE.Vector3(0, 0, 0);
      const up = this.portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
      const back = this.portrait ? new THREE.Vector3(-Math.sin(tilt), Math.cos(tilt), 0) : new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      // HUD space (px): portrait = chips on top, turn pill below, power bar on the right; landscape = chips on the
      // right, controls on the left
      const fs = this.portrait ? clamp(w * 0.034, 11, 17) : clamp(h * 0.023 + w * 0.006, 10, 16);
      const m = this.portrait ? { t: 8 + fs * 4.2, b: 18 + fs * 2.6, l: 6, r: 6 + fs * 3.9 } : { t: 8, b: 10 + fs * 2.5, l: 14 + fs * 4, r: 12 + Math.min(w * 0.18, 190) };
      const cloth = [[-HL, 0, -HW], [HL, 0, -HW], [-HL, 0, HW], [HL, 0, HW]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const outer = [[-OUT_X, 0.05, -OUT_Z], [OUT_X, 0.05, -OUT_Z], [-OUT_X, 0.05, OUT_Z], [OUT_X, 0.05, OUT_Z]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      // the cloth goes in the middle of the HUD-free area
      const midX = (m.l + (w - m.r)) / 2 - w / 2;
      const midY = (m.t + (h - m.b)) / 2 - h / 2;
      cam.setViewOffset(w, h, -midX, -midY, w, h);
      let lo = 0.5;
      let hi = 30;
      const fits = (d: number) => {
        cam.position.copy(look).addScaledVector(back, d);
        cam.up.copy(up);
        cam.lookAt(look);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        const px = (p: THREE.Vector3) => {
          const q = p.clone().project(cam);
          return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h };
        };
        return cloth.every((p) => {
          const q = px(p);
          return q.x >= m.l && q.x <= w - m.r && q.y >= m.t && q.y <= h - m.b;
        }) && outer.every((p) => {
          const q = px(p);
          return q.x >= -2 && q.x <= w + 2 && q.y >= -2 && q.y <= h + 2;
        });
      };
      for (let i = 0; i < 32; i++) {
        const d = (lo + hi) / 2;
        if (fits(d)) hi = d;
        else lo = d;
      }
      fits(hi);
      this.basePos.copy(cam.position);
      this.baseLook.copy(look);
      return;
    }
    // projector: the scoreboard takes the right 30% (plus margins)
    const full = w * 0.67;
    cam.fov = 24;
    cam.aspect = full / h;
    cam.setViewOffset(full, h, 0, 0, w, h);
    cam.up.set(0, 1, 0);
    const target = new THREE.Vector3(0, -0.05, 0.02);
    const el = this.screenElev;
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    const pts = [[-OUT_X, 0.05, -OUT_Z], [OUT_X, 0.05, -OUT_Z], [-OUT_X, 0.05, OUT_Z], [OUT_X, 0.05, OUT_Z], [-OUT_X, -0.2, OUT_Z], [OUT_X, -0.2, OUT_Z]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    // (the lamp is allowed to hang into the top of the picture)
    let lo = 1;
    let hi = 30;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const ok = pts.every((p) => {
        const q = p.clone().project(cam);
        const xFull = ((q.x + 1) / 2) * (w / full) * 2 - 1;
        return Math.abs(xFull) < 0.93 && q.y > -0.9 && q.y < 0.62;
      });
      if (ok) hi = d;
      else lo = d;
    }
    this.screenDist = hi;
    cam.updateProjectionMatrix();
  }

  private project(x: number, y: number, z: number) {
    const q = this.v.set(x, y, z).project(this.sc.camera);
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h };
  }

  private resize() {
    this.kick();
    const w = Math.max(1, this.wrap.clientWidth);
    const h = Math.max(1, this.wrap.clientHeight);
    const rect = this.wrap.getBoundingClientRect();
    const css = rect.width > 0 ? rect.width / w : 1;
    this.w = w;
    this.h = h;
    const dpr = Math.min(2, (devicePixelRatio || 1) * css);
    this.sc.renderer.setPixelRatio(dpr);
    this.sc.renderer.setSize(w, h, false);
    this.fit();
  }

  // ------------------------------------------------------------------ input
  private local(e: PointerEvent) {
    const r = this.wrap.getBoundingClientRect();
    const k = r.width / this.w || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }

  /** the point on the table (at ball-centre height) under a screen point */
  private onTable(px: number, py: number) {
    const cam = this.sc.camera;
    const ndc = new THREE.Vector3((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1, 0.5);
    const p = ndc.unproject(cam);
    const d = p.sub(cam.position).normalize();
    const hit = new THREE.Vector3();
    const ok = new THREE.Ray(cam.position.clone(), d).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -R), hit);
    return ok ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
  }

  private down = (e: PointerEvent) => {
    this.kick();
    if (!this.myTurn() || this.drag) return;
    e.preventDefault();
    const p = this.local(e);
    const tp = this.onTable(p.x, p.y);
    const w = this.whiteNow();
    try {
      this.wrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const wp = this.project(w.x, R, w.y);
    const nearWhite = Math.hypot(tp.x - w.x, tp.y - w.y) < R * 3 || Math.hypot(p.x - wp.x, p.y - wp.y) < 34;
    const mode = this.table?.inHand && nearWhite ? "place" : "aim";
    this.drag = { id: e.pointerId, mode, phi: Math.atan2(tp.y - w.y, tp.x - w.x), x0: p.x, y0: p.y, t0: now(), moved: false };
    this.wrap.classList.toggle("place", mode === "place");
  };

  private move = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const p = this.local(e);
    if (Math.hypot(p.x - d.x0, p.y - d.y0) > 7) d.moved = true;
    const tp = this.onTable(p.x, p.y);
    if (d.mode === "place") {
      const others = this.rest.filter((b) => b.n !== 0);
      const want = { x: tp.x, y: tp.y };
      if (want.x > TABLE.headX) this.flashHint("لازم البيضا تكون ورا الخط");
      this.place = placeWhite(others, want);
      return;
    }
    const w = this.whiteNow();
    const phi = Math.atan2(tp.y - w.y, tp.x - w.x);
    const dist = Math.hypot(tp.x - w.x, tp.y - w.y);
    // finer turning when the finger is close to the white
    const k = clamp(dist / 0.35, 0.3, 1);
    this.aim = wrap(this.aim + wrap(phi - d.phi) * k);
    d.phi = phi;
  };

  private up = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.wrap.classList.remove("place");
    if (d.mode === "aim" && !d.moved && now() - d.t0 < 350) {
      // a tap: aim at that spot (straight at a ball when tapped on one)
      const p = this.local(e);
      const tp = this.onTable(p.x, p.y);
      const w = this.whiteNow();
      const ball = this.rest.find((b) => b.n !== 0 && !b.in && Math.hypot(b.x - tp.x, b.y - tp.y) < R * 1.6);
      const tx = ball ? ball.x : tp.x;
      const ty = ball ? ball.y : tp.y;
      if (Math.hypot(tx - w.x, ty - w.y) > R * 1.5) this.aim = Math.atan2(ty - w.y, tx - w.x);
    }
  };

  private cancel = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    this.wrap.classList.remove("place");
    this.kick();
  };

  private bindControls() {
    const hud = this.phud!;
    const pw = hud.power;
    const stop = (e: Event) => e.stopPropagation();
    pw.addEventListener("pointerdown", (e) => {
      stop(e);
      this.kick();
      if (!this.myTurn()) return;
      e.preventDefault();
      try {
        pw.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const track = pw.querySelector(".track")!.getBoundingClientRect();
      this.pdrag = { id: e.pointerId, y0: e.clientY, h: Math.max(80, track.height) };
      this.power = 0;
    });
    pw.addEventListener("pointermove", (e) => {
      stop(e);
      const d = this.pdrag;
      if (!d || d.id !== e.pointerId) return;
      this.power = clamp((e.clientY - d.y0) / (d.h * 0.92), 0, 1);
      hud.setPower(this.power);
    });
    const release = (e: PointerEvent, fire: boolean) => {
      stop(e);
      const d = this.pdrag;
      if (!d || d.id !== e.pointerId) return;
      this.pdrag = null;
      if (fire && this.power > 0.03) this.fire(this.power);
      else {
        if (fire) this.flashHint("اسحب القوة لتحت أكثر");
        this.power = 0;
        hud.setPower(0);
      }
    };
    pw.addEventListener("pointerup", (e) => release(e, true));
    pw.addEventListener("pointercancel", (e) => release(e, false));
    pw.addEventListener("lostpointercapture", (e) => release(e, false));
    // keyboard / scripted click on the power button: shoot with the last power
    pw.addEventListener("click", (e) => {
      stop(e);
      if (e.detail === 0 && this.myTurn()) this.fire(this.power > 0.03 ? this.power : this.lastPower);
    });
    const sp = hud.spin;
    const setSpin = (e: PointerEvent) => {
      const r = sp.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      this.spin = clamp(x, -1, 1);
      this.start = clamp(y, -1, 1);
      hud.setSpin(this.spin, this.start);
    };
    sp.addEventListener("pointerdown", (e) => {
      stop(e);
      this.kick();
      if (!this.myTurn()) return;
      e.preventDefault();
      try {
        sp.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.sdrag = e.pointerId;
      setSpin(e);
    });
    sp.addEventListener("pointermove", (e) => {
      stop(e);
      if (this.sdrag === e.pointerId) setSpin(e);
    });
    const endSpin = (e: PointerEvent) => {
      stop(e);
      if (this.sdrag === e.pointerId) this.sdrag = null;
      // a tap right in the middle clears it
      if (Math.hypot(this.spin, this.start) < 0.18) {
        this.spin = this.start = 0;
        hud.setSpin(0, 0);
      }
    };
    sp.addEventListener("pointerup", endSpin);
    sp.addEventListener("pointercancel", endSpin);
    sp.addEventListener("lostpointercapture", endSpin);
  }

  private key = (e: KeyboardEvent) => {
    if (!this.myTurn() || e.target instanceof HTMLInputElement) return;
    const step = e.shiftKey ? 0.05 : 0.006;
    if (e.key === "ArrowLeft") this.aim = wrap(this.aim + step);
    else if (e.key === "ArrowRight") this.aim = wrap(this.aim - step);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      this.lastPower = clamp(this.lastPower + (e.key === "ArrowUp" ? 0.05 : -0.05), 0.05, 1);
      this.phud?.setPower(this.lastPower);
      this.flashHint(`القوة ${ar(Math.round(this.lastPower * 100))}٪`);
    } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) this.fire(this.lastPower);
    else return;
    e.preventDefault();
    this.kick();
  };

  private fire(power: number) {
    if (!this.onShot || !this.myTurn()) return;
    this.kick();
    const w = this.whiteNow();
    const shot: PoolShot = { aim: this.aim, power: clamp(power, 0, 1), spin: this.spin, start: this.start };
    if (this.table?.inHand) shot.place = { x: w.x, y: w.y };
    this.lastPower = shot.power;
    this.pending = { at: now(), shot };
    this.strikeAt = now() + 70;
    this.power = 0;
    this.phud?.setPower(0);
    setTimeout(() => !this.dead && this.audio.cue(shot.power), 60);
    this.onShot(shot);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.tick);
    removeEventListener("blur", this.dropDrags);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.wrap.removeEventListener("lostpointercapture", this.cancel);
    this.ro.disconnect();
    this.wrap.removeEventListener("pointerdown", this.down);
    this.wrap.removeEventListener("pointermove", this.move);
    this.wrap.removeEventListener("pointerup", this.up);
    this.wrap.removeEventListener("pointercancel", this.cancel);
    removeEventListener("keydown", this.key);
    this.audio.dispose();
    this.phud?.destroy();
    this.shud?.destroy();
    this.sc.dispose();
    this.wrap.remove();
    void this.root;
  }
}


export const createPoolView: SportViewFactory = (root, opts) => new PoolView(root, opts);
