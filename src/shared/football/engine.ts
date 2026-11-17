/** كورة البط match engine: a pure simulation stepped at a fixed dt (30 Hz). No timers, no Math.random: everything
 *  random comes from a seeded generator, so a match is deterministic given its seed and the inputs, and it runs
 *  headless as fast as the CPU allows (tools/football-sim.ts plays 3 minutes in well under a second).
 *
 *  The server (src/server/football.ts) owns the match flow around it (intro, half time, penalties, the end) and
 *  turns the engine into FbState / FbFrame. Inside the engine: kick-off freeze -> play -> goal celebration ->
 *  kick-off ..., the half clock, and single penalty kicks. Coordinates follow PITCH (metres, origin at the centre). */
import { aiThink, keeperThink } from "./ai";
import { FbAction, FbEvent, PITCH, type FbFrame, type FbInput, type FbPlayer, type FbState, type FbTeam } from "./types";

export type GoalKind = NonNullable<NonNullable<FbState["lastGoal"]>["kind"]>;

export const DT = 1 / 30;
export const HALF_L = PITCH.length / 2; // 32: goal line
export const HALF_W = PITCH.width / 2; // 20: side boards
export const GOAL_W = PITCH.goalWidth / 2; // 3.5: post at y = ±3.5
export const BALL_R = 0.2;
const POST_R = 0.1;

/** Gameplay tuning (metres, seconds). Exported so the tests and the report can quote them. */
export const TUNE = {
  /** normal movement is a jog; the sprint button (or a computer duck in a hurry) goes flat out on stamina */
  jogSpeed: 5.4,
  jogBall: 4.8,
  sprintSpeed: 8.2,
  sprintBall: 7.2,
  keeperSpeed: 6.3,
  /** snappy at a jog, heavy (wide turns) at a sprint (m/s²) */
  accel: 34,
  accelSprint: 13,
  /** stamina 0..1: a full bar is ~5 s of sprint, it refills in ~6 s; after running dry it must get back to `tiredUntil` */
  staminaDrain: 0.2,
  staminaRecover: 1 / 6,
  tiredUntil: 0.15,
  /** k with the ball: skill move (sideways burst, tackles miss), k without: a dash */
  trickTime: 0.35,
  trickSpeed: 7.0,
  trickCooldown: 1.2,
  /** a tackler beaten by a skill move stumbles this long */
  stumble: 0.45,
  dashTime: 0.25,
  dashSpeed: 9.5,
  dashCost: 0.12,
  dashCooldown: 1.0,
  /** first touch: cushioning a pass / loose ball (slow for this long); a hard ball can bounce off */
  trapTime: 0.2,
  /** ball ahead of the feet: tight at a jog, knocked on (between the two) at a sprint */
  sprintTouchMin: 0.75,
  sprintTouchMax: 1.15,
  /** pokes are this much likelier against a sprinting dribbler (the ball is out in front) */
  sprintPokeFactor: 1.5,
  duckR: 0.42,
  /** ball at the owner's feet, this far in front */
  dribbleDist: 0.5,
  pickupR: 0.72,
  keeperReach: 0.95,
  diveReach: 1.25,
  /** ground: decel = rollA + rollB * speed (m/s²) */
  rollA: 1.2,
  rollB: 0.32,
  gravity: 9.8,
  boardRest: 0.6,
  postRest: 0.55,
  passMin: 8,
  passMax: 24,
  /** shot speed: shotMin + (shotMax - shotMin) * power^1.6 (m/s) */
  shotMin: 13,
  shotMax: 32,
  /** a shot this fast or faster is a "big shot" (FbEvent.Screamer) */
  screamerKick: 25,
  /** lateral bend at full stick and full power (m/s²) */
  shotCurve: 8,
  /** a goal that crossed the line this fast is a "screamer" */
  screamerGoal: 20,
  /** how far a hard ball stretches the back netting (m behind the back-net line) */
  netGive: 0.35,
  /** seconds of holding b for a full-power shot */
  chargeTime: 0.9,
  slideSpeed: 9.5,
  slideTime: 0.45,
  slideCooldown: 1.2,
  slideReach: 1.0,
  fallTime: 0.6,
  /** standing tackle: an opponent this close to the ball can poke it away (rate per second, scaled by skill) */
  pokeR: 0.8,
  pokeRate: 2.2,
  /** a fresh owner can't be poked for this long */
  pokeGrace: 0.35,
  /** poke rate multiplier when the ball runs into the defender's body */
  blockFactor: 3,
  kickoffFreeze: 1.2,
  /** after the freeze, the kick-off waits up to this long for everybody to walk back to their spot */
  kickoffWalk: 2.5,
  /** goal stage: celebrate for celebrateT, then everybody jogs back; the kick-off comes at goalPause */
  goalPause: 4.5,
  celebrateT: 2.8,
  /** a person's solo control switches to a nearer duck only when it is this much nearer, after this long */
  switchMargin: 2.0,
  switchHold: 0.6,
};

export type EngStage = "idle" | "kickoff" | "play" | "goal" | "pen";

export interface Duck {
  slot: number;
  team: FbTeam;
  gk: boolean;
  skill: number;
  /** outfield role: 0 back, 1 left, 2 right, 3 front (the keeper: -1) */
  role: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** heading (unit) */
  hx: number;
  hy: number;
  face: 1 | -1;
  /** computer movement target and speed factor (0..1) */
  tx: number;
  ty: number;
  run: number;
  think: number;
  spotT: number;
  spotX: number;
  spotY: number;
  kickT: number;
  slide: number;
  sdx: number;
  sdy: number;
  slideCd: number;
  fall: number;
  /** beaten keeper on his knees (seconds left) */
  kneel: number;
  /** stamina 0..1, ran dry (no sprint until tiredUntil), sprinting this tick, the computer wants to sprint */
  stamina: number;
  tired: boolean;
  sprinting: boolean;
  wantSprint: boolean;
  /** skill move: time left, direction, cooldown; dash: time left, direction, cooldown; first-touch trap time */
  trick: number;
  tkx: number;
  tky: number;
  trickCd: number;
  dash: number;
  dkx: number;
  dky: number;
  dashCd: number;
  trap: number;
  /** dribble touch rhythm while sprinting */
  touch: number;
  lock: number;
  noPick: number;
  /** seconds since this duck got the ball */
  hasT: number;
  dive: number;
  dvx: number;
  dvy: number;
  /** keeper: the kick id it already decided about, and whether it saves it */
  saveShot: number;
  saveOk: boolean;
  /** shot charge 0..1 while b is held (-1 = not charging) */
  charge: number;
  celebrate: boolean;
  /** walking back slowly, head down (shown as Idle) */
  mope: boolean;
  /** a person asked this computer carrier for the ball (slot of the person's duck, until time) */
  wantBy: number;
  wantUntil: number;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number;
  /** a keeper holds it in his hands (can't be tackled) */
  held: boolean;
  last: number;
  lastTeam: FbTeam | -1;
  inNet: boolean;
  /** the team-mate a pass is meant for (-1 = none) */
  passTo: number;
  /** id of the last kick (keepers decide once per kick) */
  kick: number;
  /** the last kick was a shot */
  shot: boolean;
  /** sideways bend (m/s² along y) for spinT more seconds, and extra downward pull while in the air (dip) */
  spin: number;
  spinT: number;
  dip: number;
  /** where the last kick came from, the highest point since, and whether it was a header */
  fromX: number;
  fromY: number;
  maxZ: number;
  head: boolean;
}

export interface Person {
  pid: string;
  team: FbTeam;
  /** this person's own duck */
  own: number;
  active: boolean;
  x: number;
  y: number;
  a: boolean;
  b: boolean;
  aDown: boolean;
  bDown: boolean;
  bUp: boolean;
  /** sprint held, skill button held / pressed since the last tick */
  s: boolean;
  k: boolean;
  kDown: boolean;
  /** controlled slot right now and how long it has been */
  ctrl: number;
  ctrlT: number;
}

export interface PenKick {
  shooter: number;
  keeper: number;
  side: 1 | -1;
  t: number;
  kicked: boolean;
  kickT: number;
  result: boolean | null;
  /** computer shooter: when it shoots */
  at: number;
}

export interface TeamCtx {
  has: boolean;
  chaser: number;
  presser: number;
  cover: number;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;

/** Ground pass: the start speed so a ball rolled `d` metres arrives at about `arrive` m/s. */
export function passSpeed(d: number, arrive = 5) {
  const a = TUNE.rollA;
  const b = TUNE.rollB;
  const c = a / b;
  const dist = (v0: number) => {
    const t = Math.log((v0 + c) / (arrive + c)) / b;
    return (v0 - arrive) / b - c * t;
  };
  let lo = arrive;
  let hi = 45;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (dist(m) < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Kick-off formation in the team's own frame (fx: -32 = own goal line, + = towards the other goal). By role. */
const KICK_FORM = [
  [-18, 0],
  [-8, -10],
  [-8, 10],
  [-0.7, 0],
];
const WAIT_FORM = [
  [-18, 0],
  [-10, -7],
  [-10, 7],
  [-7.2, 0],
];

export class FbEngine {
  ducks: Duck[];
  ball: Ball;
  ref = { x: 0, y: -12 };
  half: 1 | 2 = 1;
  stage: EngStage = "idle";
  stageT = 0;
  /** engine time (s) */
  time = 0;
  clock = 0;
  halfSeconds: number;
  /** the half is over (whistle): set by step(), the server reacts */
  halfOver = false;
  kickTeam: FbTeam = 0;
  score: [number, number] = [0, 0];
  /** increments on every goal; `lastGoal` says who */
  goalSeq = 0;
  lastGoal: { team: FbTeam; slot: number; speed: number; kind?: GoalKind } | null = null;
  /** the last ball into a net (goals and shoot-out goals): speed over the line and how it went in */
  goalInfo: { speed: number; kind?: GoalKind } | null = null;
  /** celebrations: the duck everybody runs to and where he runs */
  hero = -1;
  heroX = 0;
  heroY = 0;
  pen: PenKick | null = null;
  /** winners celebrate at full time (-1 = nobody) */
  winners: FbTeam | -1 = -1;
  events: [number, number][] = [];
  people = new Map<string, Person>();
  /** slot -> person controlling it this tick */
  ctrlBy: (Person | null)[] = [];
  ctx: [TeamCtx, TeamCtx] = [
    { has: false, chaser: -1, presser: -1, cover: -1 },
    { has: false, chaser: -1, presser: -1, cover: -1 },
  ];
  /** predicted loose-ball positions every 0.1 s for 2.5 s */
  path: { x: number; y: number }[] = [];
  rng: () => number;

  constructor(public roster: FbPlayer[], opts: { seed?: number; halfSeconds: number; skill?: (p: FbPlayer) => number }) {
    this.rng = mulberry32(opts.seed ?? 1);
    this.halfSeconds = opts.halfSeconds;
    const roleOrder = [3, 1, 2, 0];
    const outfieldN = [0, 0];
    this.ducks = roster.map((p) => {
      const role = p.gk ? -1 : roleOrder[outfieldN[p.team]++ % 4];
      return {
        slot: p.slot, team: p.team, gk: p.gk, skill: clamp(opts.skill ? opts.skill(p) : 0.6, 0.05, 1), role,
        x: 0, y: 0, vx: 0, vy: 0, hx: 1, hy: 0, face: 1, tx: 0, ty: 0, run: 0, think: (p.slot % 5) * 0.03, spotT: 0, spotX: 0, spotY: 0,
        kickT: 0, slide: 0, sdx: 0, sdy: 0, slideCd: 0, fall: 0, kneel: 0, lock: 0, noPick: 0, hasT: 0, dive: 0, dvx: 0, dvy: 0,
        stamina: 1, tired: false, sprinting: false, wantSprint: false, trick: 0, tkx: 0, tky: 0, trickCd: 0, dash: 0, dkx: 0, dky: 0, dashCd: 0, trap: 0, touch: 0,
        saveShot: -1, saveOk: false, charge: -1, celebrate: false, mope: false, wantBy: -1, wantUntil: 0,
      };
    });
    this.ctrlBy = this.ducks.map(() => null);
    this.ball = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, held: false, last: -1, lastTeam: -1, inNet: false, passTo: -1, kick: 0, shot: false,
      spin: 0, spinT: 0, dip: 0, fromX: 0, fromY: 0, maxZ: 0, head: false,
    };
    this.formation(0);
  }

  /** attack direction of a team in the current half: +1 = towards +x */
  dir(team: FbTeam): 1 | -1 {
    return (team === 0) === (this.half === 1) ? 1 : -1;
  }
  keeperOf(team: FbTeam) {
    return this.ducks.find((d) => d.team === team && d.gk)!;
  }
  ev(kind: number, slot = -1) {
    this.events.push([kind, slot]);
  }
  setStage(s: EngStage) {
    this.stage = s;
    this.stageT = 0;
  }

  // ------------------------------------------------------------------ people
  addPerson(pid: string, team: FbTeam, own: number) {
    this.people.set(pid, { pid, team, own, active: true, x: 0, y: 0, a: false, b: false, aDown: false, bDown: false, bUp: false, s: false, k: false, kDown: false, ctrl: own, ctrlT: 0 });
  }
  setActive(pid: string, active: boolean) {
    const p = this.people.get(pid);
    if (!p || p.active === active) return;
    p.active = active;
    if (!active) {
      if (this.ducks[p.ctrl]) this.ducks[p.ctrl].charge = -1;
      p.a = p.b = p.aDown = p.bDown = p.bUp = p.s = p.k = p.kDown = false;
      p.x = p.y = 0;
    }
  }
  input(pid: string, inp: FbInput) {
    const p = this.people.get(pid);
    if (!p) return;
    if (inp.a && !p.a) p.aDown = true;
    if (inp.b && !p.b) p.bDown = true;
    if (!inp.b && p.b) p.bUp = true;
    if (inp.k && !p.k) p.kDown = true;
    p.a = inp.a;
    p.b = inp.b;
    p.s = !!inp.s;
    p.k = !!inp.k;
    p.x = clamp(inp.x, -1, 1);
    p.y = clamp(inp.y, -1, 1);
  }
  /** room player id -> stamina of the duck they control (active people only), 2 decimals */
  stamina(): Record<string, number> {
    const st: Record<string, number> = {};
    for (const p of this.people.values()) if (p.active && p.ctrl >= 0) st[p.pid] = Math.round(this.ducks[p.ctrl].stamina * 100) / 100;
    return st;
  }
  /** room player id -> the slot they control (active people only) */
  control(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const p of this.people.values()) if (p.active && p.ctrl >= 0) c[p.pid] = p.ctrl;
    return c;
  }

  // ------------------------------------------------------------------ flow
  /** a duck's kick-off spot (team `kicking` gets the centre spot) in half `half` */
  spot(d: Duck, kicking: FbTeam, half = this.half) {
    const s: 1 | -1 = (d.team === 0) === (half === 1) ? 1 : -1;
    const f = d.gk ? [-HALF_L + 0.6, 0] : (d.team === kicking ? KICK_FORM : WAIT_FORM)[d.role];
    return { x: f[0] * s, y: f[1], s };
  }
  /** place both teams in kick-off formation (team `kicking` gets the centre spot); no stage change */
  formation(kicking: FbTeam) {
    for (const d of this.ducks) {
      const p = this.spot(d, kicking);
      Object.assign(d, { x: p.x, y: p.y, vx: 0, vy: 0, hx: p.s, hy: 0, face: p.s, tx: p.x, ty: p.y, slide: 0, fall: 0, kneel: 0, lock: 0, dive: 0, kickT: 0, charge: -1, celebrate: false, mope: false, noPick: 0, hasT: 0 });
    }
    this.resetBall(0, 0);
    this.ref = { x: 0, y: -10 };
  }
  private resetBall(x: number, y: number) {
    Object.assign(this.ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, held: false, inNet: false, passTo: -1, shot: false, spin: 0, spinT: 0, dip: 0, maxZ: 0, head: false });
  }
  /** kick-off: the ball on the centre spot, everybody walks back to their spot, a short freeze, then the kicking
   *  team's centre duck takes the ball (whoever is not back after kickoffWalk is put there) */
  kickoff(team: FbTeam) {
    this.kickTeam = team;
    this.next = null;
    this.pen = null;
    this.hero = -1;
    this.resetBall(0, 0);
    for (const d of this.ducks) Object.assign(d, { slide: 0, dive: 0, kickT: 0, charge: -1, celebrate: false, mope: false, noPick: 0, hasT: 0, saveShot: -1, trick: 0, dash: 0, trap: 0 });
    this.setStage("kickoff");
  }
  private allBack() {
    return this.ducks.every((d) => {
      const p = this.spot(d, this.kickTeam);
      return d.fall <= 0 && hyp(d.x - p.x, d.y - p.y) < 0.6;
    });
  }
  /** where the ducks walk while idle (half time: their spots for the next kick-off, ends swapped) */
  next: { half: 1 | 2; kick: FbTeam } | null = null;
  /** the intro / half time / full time: everybody stands (winners celebrate), or walks to `next` kick-off spots */
  idle(next: { half: 1 | 2; kick: FbTeam } | null = null) {
    this.next = next;
    this.setStage("idle");
  }
  setHalf(h: 1 | 2) {
    for (const d of this.ducks) Object.assign(d, { stamina: 1, tired: false });
    this.half = h;
    this.clock = 0;
    this.halfOver = false;
  }
  /** the host's whistle: the half ends now */
  endHalf() {
    if (this.halfOver) return;
    this.halfOver = true;
    this.ev(FbEvent.Whistle);
    this.ball.passTo = -1;
    this.setStage("idle");
  }
  /** full time: the winners run together and celebrate, the losers' keeper sits down, the rest trudge */
  finish(winners: FbTeam | -1) {
    this.winners = winners;
    this.pen = null;
    this.next = null;
    this.hero = -1;
    if (winners >= 0) {
      const own = [...this.people.values()].find((p) => p.team === winners && p.active);
      const mates = this.ducks.filter((d) => d.team === winners && !d.gk);
      const h = own ? this.ducks[own.own] : mates.sort((a, b) => hyp(a.x, a.y) - hyp(b.x, b.y))[0];
      this.hero = h.slot;
      this.heroX = clamp(h.x, -HALF_L + 4, HALF_L - 4);
      this.heroY = clamp(h.y, -HALF_W + 4, HALF_W - 4);
      this.keeperOf((1 - winners) as FbTeam).kneel = 2.4;
    }
    for (const d of this.ducks) d.mope = winners >= 0 && d.team !== winners;
    this.setStage("idle");
  }

  /** one penalty: `shooter` shoots at the goal on side `side` (+1 = the +x goal), `keeper` defends it */
  startPen(shooter: number, keeper: number, side: 1 | -1) {
    this.pen = { shooter, keeper, side, t: 0, kicked: false, kickT: 0, result: null, at: 1.3 + this.rng() * 1.0 };
    let i = 0;
    for (const d of this.ducks) {
      Object.assign(d, { vx: 0, vy: 0, slide: 0, fall: 0, kneel: 0, lock: 0, dive: 0, kickT: 0, charge: -1, celebrate: false, mope: false, noPick: 0 });
      if (d.slot === shooter || d.slot === keeper) continue;
      d.x = -side * 3;
      d.y = -9 + (i++ * 18) / 8;
      d.hx = side;
      d.hy = 0;
      d.face = side;
    }
    const spot = side * (HALF_L - PITCH.penSpot);
    const s = this.ducks[shooter];
    Object.assign(s, { x: spot - side * 1.3, y: 0, hx: side, hy: 0, face: side });
    const k = this.ducks[keeper];
    Object.assign(k, { x: side * (HALF_L - 0.5), y: 0, hx: -side, hy: 0, face: -side as 1 | -1, saveShot: -1 });
    this.resetBall(spot, 0);
    this.ball.last = -1;
    this.ball.lastTeam = -1;
    this.ref = { x: spot - side * 4, y: -6 };
    this.setStage("pen");
  }

  // ------------------------------------------------------------------ step
  step() {
    const dt = DT;
    this.time += dt;
    this.stageT += dt;
    if (this.stage === "kickoff" && this.stageT >= TUNE.kickoffFreeze && (this.stageT >= TUNE.kickoffFreeze + TUNE.kickoffWalk || this.allBack())) {
      this.formation(this.kickTeam);
      const k = this.ducks.filter((d) => d.team === this.kickTeam && !d.gk).sort((a, b) => hyp(a.x, a.y) - hyp(b.x, b.y))[0];
      this.take(k);
      this.ev(FbEvent.Whistle);
      this.setStage("play");
    }
    if (this.stage === "goal" && this.stageT >= TUNE.goalPause && this.lastGoal) this.kickoff((1 - this.lastGoal.team) as FbTeam);

    this.updateControl(dt);
    this.updateContext();
    for (const d of this.ducks) this.drive(d, dt);
    this.collide();
    for (let i = 0; i < 3; i++) this.moveBall(dt / 3);
    this.touches(dt);
    this.moveRef(dt);
    if (this.stage === "play") {
      this.clock += dt;
      if (this.clock >= this.halfSeconds && !this.shotInFlight()) this.endHalf();
    }
    if (this.stage === "pen") this.penTick(dt);
    // a solo person follows a new carrier straight away (so frames never show them off the ball)
    this.updateControl(0);
  }

  /** the clock may run a moment past time while a shot is on its way */
  private shotInFlight() {
    const b = this.ball;
    if (this.clock > this.halfSeconds + 3 || b.owner >= 0 || !b.shot) return false;
    const sp = hyp(b.vx, b.vy);
    return sp > 7 && Math.abs(b.x) > HALF_L - 22 && Math.sign(b.vx) === Math.sign(b.x);
  }

  // ------------------------------------------------------------------ control
  private updateControl(dt: number) {
    this.ctrlBy.fill(null);
    const b = this.ball;
    const ownerTeam = b.owner >= 0 ? this.ducks[b.owner].team : -1;
    for (const t of [0, 1] as FbTeam[]) {
      const ps = [...this.people.values()].filter((p) => p.team === t && p.active);
      const solo = ps.length === 1;
      for (const p of ps) {
        const prev = p.ctrl;
        if (this.stage === "pen" || !solo) p.ctrl = p.own;
        else {
          const owner = b.owner >= 0 ? this.ducks[b.owner] : null;
          if (owner && owner.team === t && !owner.gk) p.ctrl = owner.slot;
          else if (b.owner < 0 && b.passTo >= 0 && this.ducks[b.passTo].team === t && !this.ducks[b.passTo].gk) p.ctrl = b.passTo;
          else if (ownerTeam !== t) {
            const cur = this.ducks[p.ctrl];
            const near = this.nearestOutfield(t, -1);
            if (!cur || cur.gk || cur.team !== t) p.ctrl = near.slot;
            else if (near.slot !== cur.slot && p.ctrlT > TUNE.switchHold && cur.slide <= 0) {
              const dc = hyp(cur.x - b.x, cur.y - b.y);
              const dn = hyp(near.x - b.x, near.y - b.y);
              if (dn < dc - TUNE.switchMargin) p.ctrl = near.slot;
            }
          }
          // b without the ball: switch now to the duck nearest the ball (not the one we have)
          if (p.bDown && !(owner && owner.slot === p.ctrl) && ownerTeam !== t && !this.nearBall(this.ducks[p.ctrl], 1.6)) {
            p.bDown = false;
            p.bUp = false;
            p.ctrl = this.nearestOutfield(t, p.ctrl).slot;
          }
        }
        if (p.ctrl !== prev) {
          if (this.ducks[prev]) this.ducks[prev].charge = -1;
          p.ctrlT = 0;
        } else p.ctrlT += dt;
        this.ctrlBy[p.ctrl] = p;
      }
    }
  }
  nearestOutfield(team: FbTeam, not: number) {
    const b = this.ball;
    let best: Duck | null = null;
    let bd = Infinity;
    for (const d of this.ducks) {
      if (d.team !== team || d.gk || d.slot === not) continue;
      const dist = hyp(d.x - b.x, d.y - b.y) + (d.fall > 0 ? 3 : 0);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best!;
  }
  private nearBall(d: Duck | undefined, r: number) {
    const b = this.ball;
    return !!d && b.owner < 0 && b.z < 1.2 && hyp(d.x - b.x, d.y - b.y) < r;
  }
  isHuman(d: Duck) {
    return !!this.ctrlBy[d.slot];
  }

  /** who chases a loose ball / presses the carrier, per team (the computer leaves it to a person who is closer) */
  private updateContext() {
    const b = this.ball;
    this.path = [];
    if (b.owner < 0) {
      let x = b.x;
      let y = b.y;
      let vx = b.vx;
      let vy = b.vy;
      for (let i = 0; i < 25; i++) {
        for (let k = 0; k < 3; k++) {
          const sp = hyp(vx, vy);
          if (sp > 0) {
            const ns = Math.max(0, sp - (TUNE.rollA + TUNE.rollB * sp) * (0.1 / 3));
            vx *= ns / sp;
            vy *= ns / sp;
          }
          x += vx * (0.1 / 3);
          y += vy * (0.1 / 3);
          if (Math.abs(y) > HALF_W - BALL_R) {
            y = Math.sign(y) * (HALF_W - BALL_R);
            vy = -vy * TUNE.boardRest;
          }
          if (Math.abs(x) > HALF_L - BALL_R && Math.abs(y) > GOAL_W) {
            x = Math.sign(x) * (HALF_L - BALL_R);
            vx = -vx * TUNE.boardRest;
          }
        }
        this.path.push({ x, y });
      }
    }
    const ownerTeam = b.owner >= 0 ? this.ducks[b.owner].team : -1;
    for (const t of [0, 1] as FbTeam[]) {
      const c = this.ctx[t];
      c.has = ownerTeam === t;
      c.chaser = c.presser = c.cover = -1;
      const mine = this.ducks.filter((d) => d.team === t && !d.gk && d.fall <= 0);
      if (b.owner < 0) {
        if (b.passTo >= 0 && this.ducks[b.passTo].team === t && !this.ducks[b.passTo].gk) {
          c.chaser = b.passTo;
          continue;
        }
        let best = -1;
        let bt = Infinity;
        for (const d of mine) {
          const tt = this.reach(d).t * (this.isHuman(d) ? 0.8 : 1);
          if (tt < bt) {
            bt = tt;
            best = d.slot;
          }
        }
        c.chaser = best;
      } else if (ownerTeam !== t && !b.held) {
        const o = this.ducks[b.owner];
        // who can get in front of him: distance to where he will be, and a duck he has already passed counts less
        const g = -this.dir(t);
        const ax = o.x + o.vx * 0.5;
        const ay = o.y + o.vy * 0.5;
        const cost = (d: Duck) => hyp(d.x - ax, d.y - ay) + ((o.x - d.x) * g > 1 ? 5 : 0);
        const byDist = mine.sort((p, q) => cost(p) - cost(q));
        if (!byDist.length) continue;
        c.presser = byDist[0].slot;
        // a person presses: the nearest computer duck covers; near our goal the computer doubles up anyway
        const danger = Math.abs(o.x - -this.dir(t) * HALF_L) < 20;
        if (this.isHuman(byDist[0])) c.cover = byDist.find((d) => !this.isHuman(d))?.slot ?? -1;
        else if (danger) c.cover = byDist.find((d, i) => i > 0 && !this.isHuman(d))?.slot ?? -1;
      }
    }
  }
  /** earliest time (and place) this duck can meet the loose ball */
  reach(d: Duck): { t: number; x: number; y: number } {
    const sp = d.gk ? TUNE.keeperSpeed : d.stamina > 0.25 && !d.tired ? TUNE.sprintSpeed * 0.92 : TUNE.jogSpeed;
    for (let i = 0; i < this.path.length; i++) {
      const p = this.path[i];
      const t = (i + 1) * 0.1;
      if (hyp(p.x - d.x, p.y - d.y) - TUNE.pickupR <= sp * t + 0.2) return { t, x: p.x, y: p.y };
    }
    const last = this.path[this.path.length - 1] ?? this.ball;
    return { t: 2.5 + hyp(last.x - d.x, last.y - d.y) / sp, x: last.x, y: last.y };
  }

  // ------------------------------------------------------------------ ducks
  private drive(d: Duck, dt: number) {
    d.kickT = Math.max(0, d.kickT - dt);
    d.slideCd = Math.max(0, d.slideCd - dt);
    d.noPick = Math.max(0, d.noPick - dt);
    d.trickCd = Math.max(0, d.trickCd - dt);
    d.dashCd = Math.max(0, d.dashCd - dt);
    const mine = this.ball.owner === d.slot;
    if (mine) d.hasT += dt;
    else d.hasT = 0;
    let wx = 0;
    let wy = 0;
    let top = d.gk ? TUNE.keeperSpeed : mine ? TUNE.jogBall : TUNE.jogSpeed;
    d.sprinting = false;
    const frozen = (this.stage === "idle" && !this.halfOver && this.winners < 0) || (this.stage === "pen" && d.slot !== this.pen?.keeper);
    if (d.kneel > 0) {
      d.kneel -= dt;
      d.vx = 0;
      d.vy = 0;
    } else if (d.fall > 0) {
      d.fall -= dt;
      d.vx *= 0.8;
      d.vy *= 0.8;
    } else if (d.slide > 0) {
      d.slide -= dt;
      const k = Math.max(0.25, d.slide / TUNE.slideTime);
      d.vx = d.sdx * TUNE.slideSpeed * k;
      d.vy = d.sdy * TUNE.slideSpeed * k;
      if (d.slide <= 0) d.lock = 0.22;
    } else if (d.dive > 0) {
      d.dive -= dt;
      d.vx = d.dvx;
      d.vy = d.dvy;
      if (d.dive <= 0) d.lock = 0.35;
    } else if (d.lock > 0) {
      d.lock -= dt;
      d.vx *= 0.7;
      d.vy *= 0.7;
    } else if (d.trick > 0) {
      // skill move: a sharp burst to the side / round, the ball glued to the feet
      d.trick -= dt;
      d.vx = d.tkx * TUNE.trickSpeed;
      d.vy = d.tky * TUNE.trickSpeed;
    } else if (frozen) {
      d.vx = d.vy = 0;
      if (this.stage === "pen") this.penDuck(d, dt);
    } else {
      const p = this.ctrlBy[d.slot];
      let want = false;
      let ability = 1;
      if (p && this.stage === "play") {
        [wx, wy] = this.personDrive(d, p, dt);
        want = p.s;
      } else {
        this.computerDrive(d, dt);
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = hyp(dx, dy);
        if (dist > 0.15) {
          const k = Math.min(1, dist / 1.6) * d.run;
          wx = (dx / dist) * k;
          wy = (dy / dist) * k;
        }
        ability = 0.95 + 0.05 * d.skill;
        want = d.wantSprint && this.stage === "play";
      }
      if (want && !d.gk && !d.tired && d.stamina > 0 && hyp(wx, wy) > 0.5 && d.trap <= 0) {
        d.sprinting = true;
        top = mine ? TUNE.sprintBall : TUNE.sprintSpeed;
      }
      top *= ability;
      if (d.trap > 0) {
        d.trap -= dt;
        top *= 0.45;
      }
      if (d.dash > 0) {
        d.dash -= dt;
        top = TUNE.dashSpeed;
        wx = d.dkx;
        wy = d.dky;
      }
      const tvx = wx * top;
      const tvy = wy * top;
      const ax = tvx - d.vx;
      const ay = tvy - d.vy;
      const am = hyp(ax, ay);
      const maxA = (d.sprinting ? TUNE.accelSprint : d.dash > 0 ? TUNE.accel * 2 : TUNE.accel) * dt;
      if (am > maxA) {
        d.vx += (ax / am) * maxA;
        d.vy += (ay / am) * maxA;
      } else {
        d.vx = tvx;
        d.vy = tvy;
      }
    }
    // stamina: drains while sprinting, refills otherwise; running dry stops the sprint until it is back a bit
    if (d.sprinting) {
      d.stamina -= TUNE.staminaDrain * dt;
      if (d.stamina <= 0) {
        d.stamina = 0;
        d.tired = true;
      }
    } else {
      d.stamina = Math.min(1, d.stamina + TUNE.staminaRecover * dt);
      if (d.tired && d.stamina >= TUNE.tiredUntil) d.tired = false;
    }
    if (mine && d.sprinting) d.touch += dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    const lim = d.gk ? HALF_L - 0.25 : HALF_L - 0.4;
    d.x = clamp(d.x, -lim, lim);
    d.y = clamp(d.y, -HALF_W + 0.4, HALF_W - 0.4);
    const sp = hyp(d.vx, d.vy);
    if (sp > 0.5 && d.slide <= 0 && d.fall <= 0 && d.dive <= 0 && d.kneel <= 0) {
      d.hx = d.vx / sp;
      d.hy = d.vy / sp;
    }
    if (Math.abs(d.hx) > 0.2) d.face = d.hx > 0 ? 1 : -1;
  }

  private computerDrive(d: Duck, dt: number) {
    if (this.stage === "goal" && this.lastGoal) {
      const g = this.lastGoal;
      const back = this.spot(d, (1 - g.team) as FbTeam);
      if (this.stageT >= TUNE.celebrateT) {
        // everybody jogs back for the kick-off
        d.celebrate = d.mope = false;
        d.tx = back.x;
        d.ty = back.y;
        d.run = 0.85;
      } else if (d.team === g.team) this.joinParty(d, true);
      else {
        // heads down, slowly back (the keeper first sits in his goal for a moment: see scored())
        d.celebrate = false;
        d.mope = true;
        d.tx = back.x;
        d.ty = back.y;
        d.run = 0.17;
      }
      return;
    }
    if (this.stage === "kickoff") {
      const p = this.spot(d, this.kickTeam);
      d.celebrate = d.mope = false;
      d.tx = p.x;
      d.ty = p.y;
      d.run = 0.9;
      return;
    }
    if (this.stage === "idle") {
      if (this.next) {
        const p = this.spot(d, this.next.kick, this.next.half);
        d.celebrate = d.mope = false;
        d.tx = p.x;
        d.ty = p.y;
        d.run = 0.5;
        return;
      }
      if (this.winners >= 0 && d.team === this.winners) return this.joinParty(d, false);
      d.celebrate = false;
      d.tx = d.x;
      d.ty = d.y;
      d.run = this.winners >= 0 ? 0.1 : 0;
      return;
    }
    d.mope = false;
    d.celebrate = false;
    d.think -= dt;
    if (d.think > 0 && !(this.ball.owner === d.slot && d.hasT < dt * 1.5)) return;
    d.think = 0.1 + (1 - d.skill) * 0.12 + this.rng() * 0.04;
    if (d.gk) keeperThink(this, d);
    else aiThink(this, d);
  }

  /** celebration: the hero sprints off (to the corner after a goal), the team-mates run to him and huddle round */
  private joinParty(d: Duck, goal: boolean) {
    d.mope = false;
    const h = this.ducks[this.hero];
    if (!h) {
      d.celebrate = true;
      d.tx = d.x;
      d.ty = d.y;
      d.run = 0;
      return;
    }
    if (d === h) {
      d.celebrate = true;
      d.tx = this.heroX;
      d.ty = this.heroY;
      d.run = 1;
      return;
    }
    if (d.gk && goal) {
      // the scoring keeper celebrates in his own box
      d.celebrate = true;
      d.tx = d.x;
      d.ty = d.y;
      d.run = 0;
      return;
    }
    const mates = this.ducks.filter((m) => m.team === d.team && m !== h && (!m.gk || !goal));
    const i = mates.indexOf(d);
    const a = (i / Math.max(1, mates.length)) * Math.PI * 2 + 0.6;
    d.tx = h.x + Math.cos(a) * 1.05;
    d.ty = h.y + Math.sin(a) * 1.05;
    d.run = 1;
    d.celebrate = hyp(d.x - h.x, d.y - h.y) < 2.6;
  }

  /** a person's duck: joystick moves it, a passes / slides, b charges a shot (or switches, see updateControl) */
  private personDrive(d: Duck, p: Person, dt: number): [number, number] {
    let jx = p.x;
    let jy = p.y;
    const m = hyp(jx, jy);
    if (m < 0.15) jx = jy = 0;
    else if (m > 1) {
      jx /= m;
      jy /= m;
    }
    if (m >= 0.3) {
      // turn on the spot even before the duck picks up speed (so passes go where the stick points)
      const mm = Math.min(1, m);
      d.hx = jx / mm;
      d.hy = jy / mm;
    }
    const b = this.ball;
    const mine = b.owner === d.slot;
    const ownerTeam = b.owner >= 0 ? this.ducks[b.owner].team : -1;
    if (p.aDown) {
      p.aDown = false;
      if (mine) {
        const px = m >= 0.3 ? jx : d.hx;
        const py = m >= 0.3 ? jy : d.hy;
        this.pass(d, this.pickPass(d, px, py), 0.03, px, py);
      }
      else if (ownerTeam === d.team) {
        const o = this.ducks[b.owner];
        o.wantBy = d.slot;
        o.wantUntil = this.time + 1.5;
        o.think = 0;
      } else if (d.slideCd <= 0) this.slideStart(d, d.hx, d.hy);
    }
    if (p.kDown) {
      p.kDown = false;
      const kx = m >= 0.3 ? jx : 0;
      const ky = m >= 0.3 ? jy : 0;
      if (mine) this.trickStart(d, kx, ky);
      else this.dashStart(d, kx || d.hx, ky || d.hy);
    }
    if (p.bDown) {
      p.bDown = false;
      if (mine || this.nearBall(d, 1.6)) d.charge = 0;
    }
    if (d.charge >= 0) {
      if (p.b) d.charge = Math.min(1, d.charge + dt / TUNE.chargeTime);
    }
    if (p.bUp) {
      p.bUp = false;
      if (d.charge >= 0 && (mine || this.nearBall(d, 1.2))) {
        const bend = Math.abs(jy) > 0.25 ? jy : 0;
        const aim = bend ? jy * 3.1 : this.autoAim(d);
        this.shoot(d, d.charge, aim, 0.75, bend);
      }
      d.charge = -1;
    }
    return [jx, jy];
  }

  /** where a shot goes without a joystick bend: the corner away from the keeper */
  autoAim(d: Duck) {
    const k = this.keeperOf((1 - d.team) as FbTeam);
    if (Math.abs(k.y) > 0.4) return k.y > 0 ? -2.5 : 2.5;
    return d.y > 0 ? -2.4 : 2.4;
  }

  /** best team-mate for a pass in direction (dx, dy); -1 = into space that way */
  pickPass(d: Duck, dx: number, dy: number): number {
    let best = -1;
    let bs = -Infinity;
    const dm = hyp(dx, dy) || 1;
    dx /= dm;
    dy /= dm;
    for (const m of this.ducks) {
      if (m.team !== d.team || m.slot === d.slot) continue;
      const vx = m.x - d.x;
      const vy = m.y - d.y;
      const dist = hyp(vx, vy);
      if (dist < 2) continue;
      const cos = (vx * dx + vy * dy) / dist;
      if (cos < 0.6) continue;
      const risk = this.laneRisk(d, m.x, m.y);
      const sc = cos * 3 - dist * 0.04 - (risk < 1.2 ? 1.2 : 0) - (m.gk ? 1 : 0);
      if (sc > bs) {
        bs = sc;
        best = m.slot;
      }
    }
    return best;
  }
  /** smallest distance from an opponent to the line from d to (x, y) */
  laneRisk(d: Duck, x: number, y: number) {
    let min = 99;
    const lx = x - d.x;
    const ly = y - d.y;
    const l2 = lx * lx + ly * ly || 1;
    for (const o of this.ducks) {
      if (o.team === d.team) continue;
      const t = clamp(((o.x - d.x) * lx + (o.y - d.y) * ly) / l2, 0, 1);
      const dd = hyp(d.x + lx * t - o.x, d.y + ly * t - o.y) - (o.gk ? 0.5 : 0);
      if (dd < min) min = dd;
    }
    return min;
  }

  // ------------------------------------------------------------------ actions
  private release(d: Duck, x: number, y: number) {
    const b = this.ball;
    b.owner = -1;
    b.held = false;
    b.last = d.slot;
    b.lastTeam = d.team;
    b.kick++;
    b.x = clamp(x, -HALF_L + BALL_R + 0.05, HALF_L - BALL_R - 0.05);
    b.y = clamp(y, -HALF_W + BALL_R, HALF_W - BALL_R);
    b.fromX = d.x;
    b.fromY = d.y;
    b.maxZ = 0;
    b.spin = b.spinT = b.dip = 0;
    b.head = false;
    d.noPick = 0.3;
    d.kickT = 0.25;
    d.charge = -1;
  }
  /** pass to a team-mate (slot >= 0, led to where he is running) or (to = -1) into space along (sx, sy) */
  pass(d: Duck, to: number, err = 0.03, sx = d.hx, sy = d.hy) {
    if (this.ball.owner !== d.slot) return;
    const b = this.ball;
    let tx: number;
    let ty: number;
    if (to >= 0) {
      const m = this.ducks[to];
      const d0 = hyp(m.x - d.x, m.y - d.y);
      const tEst = d0 / 15;
      tx = m.x + m.vx * tEst * 0.8;
      ty = m.y + m.vy * tEst * 0.8;
    } else {
      const sm = hyp(sx, sy) || 1;
      tx = d.x + (sx / sm) * 13;
      ty = d.y + (sy / sm) * 13;
    }
    tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
    ty = clamp(ty, -HALF_W + 1, HALF_W - 1);
    let dx = tx - d.x;
    let dy = ty - d.y;
    const dist = Math.max(1, hyp(dx, dy));
    dx /= dist;
    dy /= dist;
    const a = (this.rng() - 0.5) * 2 * err;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
    let sp: number;
    let vz = 0;
    const s = this.dir(d.team);
    const cross = to >= 0 && Math.abs(d.y) > 8 && HALF_L - d.x * s < 14 && Math.abs(ty) < 7 && HALF_L - tx * s < 14;
    if (cross) {
      // a cross from the wing: arrives at head height
      const T = clamp(dist / 15, 0.6, 1.1);
      vz = (1.5 + 0.5 * TUNE.gravity * T * T) / T;
      sp = clamp(dist / T, 8, TUNE.passMax);
    } else if (dist > 26) {
      vz = clamp(3 + (dist - 26) * 0.15, 3, 6.5);
      const tf = (2 * vz) / TUNE.gravity;
      sp = clamp(dist / (tf + 0.9), 12, TUNE.passMax);
    } else sp = clamp(passSpeed(dist, 5) * (1 + (this.rng() - 0.5) * err * 2), TUNE.passMin, TUNE.passMax);
    this.release(d, d.x + dx * 0.6, d.y + dy * 0.6);
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.vz = vz;
    b.z = 0;
    b.passTo = to;
    b.shot = false;
    d.hx = dx;
    d.hy = dy;
    this.ev(FbEvent.Pass, d.slot);
  }
  /** shot at the goal this duck attacks: power 0..1, aimY across the mouth, spread multiplier, bend -1..1 (the ball
   *  starts off line and curls in towards aimY). Strong shots are much faster and dip; weak ones are slow and low. */
  shoot(d: Duck, power: number, aimY: number, spread = 1, bend = 0) {
    const b = this.ball;
    if (b.owner >= 0 && b.owner !== d.slot) return;
    const side = this.stage === "pen" && this.pen ? this.pen.side : this.dir(d.team);
    const gx = side * HALF_L;
    power = clamp(power, 0, 1);
    const dist = hyp(gx - b.x, aimY - b.y);
    const sigma = (0.3 + power * power * 0.8 + dist * 0.022 + (1 - d.skill) * 0.35) * spread;
    const gy = aimY + this.gauss() * sigma;
    const sp = TUNE.shotMin + (TUNE.shotMax - TUNE.shotMin) * Math.pow(power, 1.6);
    const t = dist / (sp * 0.85);
    const curve = clamp(bend, -1, 1) * TUNE.shotCurve * (0.4 + 0.6 * power);
    let dx = gx - b.x;
    let dy = gy - 0.5 * curve * t * t - b.y;
    const m = hyp(dx, dy) || 1;
    dx /= m;
    dy /= m;
    const vz = 0.5 + power * power * 3.4 + this.rng() * 1.2 * power;
    const bx = b.owner === d.slot ? d.x + dx * 0.6 : b.x;
    const by = b.owner === d.slot ? d.y + dy * 0.6 : b.y;
    this.release(d, bx, by);
    b.z = Math.max(b.z, 0.05);
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.vz = vz;
    b.passTo = -1;
    b.shot = true;
    b.spin = curve;
    b.spinT = curve ? t + 0.15 : 0;
    b.dip = power > 0.7 ? (power - 0.7) * 20 : 0;
    d.hx = dx;
    d.hy = dy;
    this.ev(FbEvent.Kick, d.slot);
    if (sp >= TUNE.screamerKick) this.ev(FbEvent.Screamer, d.slot);
    if (this.stage === "pen" && this.pen && d.slot === this.pen.shooter) {
      this.pen.kicked = true;
      // the keeper guesses at the kick
      const k = this.ducks[this.pen.keeper];
      const realSide = gy > 0.9 ? 1 : gy < -0.9 ? -1 : 0;
      const guess = this.rng() < 0.15 + 0.15 * k.skill ? realSide : [-1, 0, 1][Math.floor(this.rng() * 3)];
      k.saveShot = b.kick;
      k.saveOk = this.rng() < 0.38;
      if (guess !== 0) {
        k.dive = 0.5;
        k.dvx = 0;
        k.dvy = guess * 6.2;
      }
    }
  }
  /** keeper / computer clears it long (lofted) towards a point */
  boot(d: Duck, x: number, y: number) {
    const b = this.ball;
    if (b.owner !== d.slot) return;
    let dx = x - d.x;
    let dy = y - d.y;
    const dist = Math.max(1, hyp(dx, dy));
    dx /= dist;
    dy /= dist;
    const vz = clamp(4 + dist * 0.08, 4, 8);
    const sp = clamp(dist / ((2 * vz) / TUNE.gravity + 0.8), 12, 24);
    this.release(d, d.x + dx * 0.7, d.y + dy * 0.7);
    b.z = 0.6;
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.vz = vz;
    b.passTo = -1;
    b.shot = false;
    this.ev(FbEvent.Kick, d.slot);
  }
  /** the ball arrives at head height: near the goal he attacks a duck heads it at goal, elsewhere he flicks it on */
  private header(d: Duck) {
    const b = this.ball;
    const s = this.dir(d.team);
    const gx = s * HALF_L;
    const toGoal = hyp(gx - d.x, d.y);
    const p = this.ctrlBy[d.slot];
    this.release(d, b.x, b.y);
    b.head = true;
    b.passTo = -1;
    if (toGoal < 16 && Math.abs(d.y) < 11) {
      const aim = p && Math.abs(p.y) > 0.25 ? p.y * 3 : this.autoAim(d);
      const gy = aim + this.gauss() * (0.6 + (1 - d.skill) * 0.6 + toGoal * 0.03);
      const dx = gx - b.x;
      const dy = gy - b.y;
      const m = hyp(dx, dy) || 1;
      const sp = 11 + this.rng() * 5 + d.skill * 2;
      b.vx = (dx / m) * sp;
      b.vy = (dy / m) * sp;
      b.vz = -1 + this.rng() * 2.2;
      b.shot = true;
      this.ev(FbEvent.Kick, d.slot);
    } else {
      b.vx = s * 8 + (this.rng() - 0.5) * 4;
      b.vy = (this.rng() - 0.5) * 5 + d.vy * 0.3;
      b.vz = 2.5;
      b.shot = false;
      this.ev(FbEvent.Pass, d.slot);
    }
    b.head = true;
  }
  /** skill move with the ball: a quick feint / step-over / roulette towards (dx, dy) (no direction: sideways, left
   *  and right in turn). Tackles in this window miss. */
  trickStart(d: Duck, dx: number, dy: number) {
    if (this.ball.owner !== d.slot || d.trick > 0 || d.trickCd > 0 || d.gk) return;
    let m = hyp(dx, dy);
    if (m < 0.2) {
      const side = d.slot % 2 === Math.round(this.time) % 2 ? 1 : -1;
      dx = -d.hy * side + d.hx * 0.3;
      dy = d.hx * side + d.hy * 0.3;
      m = hyp(dx, dy);
    }
    d.tkx = dx / m;
    d.tky = dy / m;
    d.trick = TUNE.trickTime;
    d.trickCd = TUNE.trickCooldown + TUNE.trickTime;
    d.charge = -1;
  }
  /** without the ball: a short burst of speed (costs a little stamina) */
  dashStart(d: Duck, dx: number, dy: number) {
    if (d.dash > 0 || d.dashCd > 0 || d.gk || d.stamina < TUNE.dashCost || d.slide > 0 || d.fall > 0) return;
    const m = hyp(dx, dy) || 1;
    d.dkx = dx / m;
    d.dky = dy / m;
    d.dash = TUNE.dashTime;
    d.dashCd = TUNE.dashCooldown;
    d.stamina -= TUNE.dashCost;
  }
  /** a tackler is beaten by a skill move: he stumbles */
  private beaten(d: Duck) {
    d.slide = 0;
    d.lock = TUNE.stumble;
    d.noPick = TUNE.stumble;
    d.vx *= 0.3;
    d.vy *= 0.3;
  }
  slideStart(d: Duck, dx: number, dy: number) {
    if (d.slide > 0 || d.fall > 0 || d.slideCd > 0 || d.gk) return;
    const m = hyp(dx, dy) || 1;
    d.sdx = dx / m;
    d.sdy = dy / m;
    d.slide = TUNE.slideTime;
    d.slideCd = TUNE.slideCooldown + TUNE.slideTime;
    d.charge = -1;
    if (this.ball.owner === d.slot) this.release(d, this.ball.x, this.ball.y);
  }
  private take(d: Duck) {
    const b = this.ball;
    b.owner = d.slot;
    b.last = d.slot;
    b.lastTeam = d.team;
    b.passTo = -1;
    b.shot = false;
    b.vz = 0;
    d.hasT = 0;
    const s = this.dir(d.team);
    b.held = d.gk && Math.abs(d.x - -s * HALF_L) < PITCH.boxDepth && Math.abs(d.y) < PITCH.boxWidth / 2;
    for (const o of this.ducks) if (o.team === d.team && o !== d) o.wantBy = -1;
    this.glue();
  }
  /** the owned ball sits at the owner's feet (in the keeper's hands) */
  private glue() {
    const b = this.ball;
    const o = this.ducks[b.owner];
    // tight at a jog (and in a skill move); knocked on ahead at a sprint, touch after touch
    const dd = b.held ? 0.3 : o.trick > 0 ? 0.35 : o.sprinting
      ? TUNE.sprintTouchMin + (TUNE.sprintTouchMax - TUNE.sprintTouchMin) * (0.5 - 0.5 * Math.cos(o.touch * Math.PI * 4))
      : TUNE.dribbleDist;
    b.x = clamp(o.x + o.hx * dd, -HALF_L + BALL_R + 0.05, HALF_L - BALL_R - 0.05);
    b.y = clamp(o.y + o.hy * dd, -HALF_W + BALL_R, HALF_W - BALL_R);
    b.z = b.held ? 0.7 : 0;
    b.vx = o.vx;
    b.vy = o.vy;
    b.vz = 0;
  }

  // ------------------------------------------------------------------ ball
  private moveBall(dt: number) {
    const b = this.ball;
    if (b.owner >= 0) return this.glue();
    // vertical
    if (b.spinT > 0) {
      b.vy += b.spin * dt;
      b.spinT -= dt;
    }
    if (b.z > 0 || b.vz > 0) {
      b.vz -= (TUNE.gravity + b.dip) * dt;
      b.z += b.vz * dt;
      if (b.z > b.maxZ) b.maxZ = b.z;
      if (b.z <= 0) {
        b.z = 0;
        b.dip = 0;
        b.spin *= 0.5;
        if (b.vz < -1.5) {
          b.vz = -b.vz * 0.5;
          b.vx *= 0.85;
          b.vy *= 0.85;
        } else b.vz = 0;
      }
      const k = 1 - 0.1 * dt;
      b.vx *= k;
      b.vy *= k;
    } else {
      const sp = hyp(b.vx, b.vy);
      if (sp > 0) {
        const ns = Math.max(0, sp - (TUNE.rollA + TUNE.rollB * sp) * dt);
        b.vx *= ns / sp;
        b.vy *= ns / sp;
      }
    }
    if (b.inNet && b.z <= 0 && b.vz <= 0) {
      // the grass inside the goal: a slow ball trickles in and stops just over the line
      const sp = hyp(b.vx, b.vy);
      if (sp > 0) {
        const ns = Math.max(0, sp - 5 * dt);
        b.vx *= ns / sp;
        b.vy *= ns / sp;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // posts
    if (b.z < PITCH.goalHeight) {
      for (const px of [-HALF_L, HALF_L])
        for (const py of [-GOAL_W, GOAL_W]) {
          const dx = b.x - px;
          const dy = b.y - py;
          const d = hyp(dx, dy);
          if (d < BALL_R + POST_R && d > 0) {
            const nx = dx / d;
            const ny = dy / d;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              b.vx -= (1 + TUNE.postRest) * vn * nx;
              b.vy -= (1 + TUNE.postRest) * vn * ny;
              b.spinT = b.dip = 0;
              if (-vn > 3) this.ev(FbEvent.Post);
            }
            b.x = px + nx * (BALL_R + POST_R);
            b.y = py + ny * (BALL_R + POST_R);
          }
        }
    }
    // side boards
    if (Math.abs(b.y) > HALF_W - BALL_R) {
      b.y = Math.sign(b.y) * (HALF_W - BALL_R);
      if (Math.abs(b.vy) > 3) this.ev(FbEvent.Board);
      b.vy = -b.vy * TUNE.boardRest;
      b.spinT = 0;
    }
    const side = b.x >= 0 ? 1 : -1;
    const ax = Math.abs(b.x);
    const ay = Math.abs(b.y);
    if (!b.inNet && ax > HALF_L - BALL_R) {
      const comingIn = b.vx * side > 0;
      if (ay >= GOAL_W) {
        // end board (outside the goal mouth)
        if (ax < HALF_L + BALL_R) {
          b.x = side * (HALF_L - BALL_R);
          if (comingIn) {
            if (Math.abs(b.vx) > 3) this.ev(FbEvent.Board);
            b.vx = -b.vx * TUNE.boardRest;
          }
        }
      } else if (b.z >= PITCH.goalHeight - BALL_R && b.z <= PITCH.goalHeight + BALL_R && ax < HALF_L + BALL_R) {
        // crossbar
        b.x = side * (HALF_L - BALL_R);
        if (comingIn) {
          b.vx = -b.vx * 0.5;
          b.vz = Math.abs(b.vz) * 0.4 + 1.5;
          this.ev(FbEvent.Post);
        }
      } else if (b.z > PITCH.goalHeight + BALL_R && ax < HALF_L + BALL_R) {
        // over the bar: off the board behind the goal, back into play
        b.x = side * (HALF_L - BALL_R);
        if (comingIn) {
          b.vx = -b.vx * 0.45;
          this.ev(FbEvent.Board);
        }
      } else if (ax >= HALF_L + BALL_R) {
        b.inNet = true;
        this.scored(side);
      }
    }
    // inside the goal: side netting, back netting, roof
    if (Math.abs(b.x) > HALF_L) {
      if (Math.abs(b.y) > GOAL_W - BALL_R) {
        b.y = Math.sign(b.y) * (GOAL_W - BALL_R);
        b.vy = -b.vy * 0.2;
      }
      // back netting gives: a hard ball punches into it (up to netGive), loses its pace and drops; the net then
      // eases it back. A slow ball never gets this far.
      const backX = HALF_L + PITCH.goalDepth - BALL_R;
      const over = Math.abs(b.x) - backX;
      if (over > 0) {
        const out = b.vx * side;
        if (out > 0) {
          b.vx *= 0.5;
          b.vy *= 0.75;
          b.vz *= 0.6;
          b.spinT = b.dip = 0;
          if (over > TUNE.netGive) {
            b.x = side * (backX + TUNE.netGive);
            b.vx = 0;
          }
        } else b.vx = -side * Math.max(-out, Math.min(3, over * 8));
      }
      if (b.z > PITCH.goalHeight - BALL_R) {
        b.z = PITCH.goalHeight - BALL_R;
        b.vz = -Math.abs(b.vz) * 0.2;
      }
    }
    this.keeperContact();
  }

  /** the ball went fully over the line on side `side` (+1 = the +x goal) */
  private scored(side: 1 | -1) {
    const b = this.ball;
    this.ev(FbEvent.Net);
    const speed = Math.round(hyp(b.vx, b.vy, b.vz) * 10) / 10;
    if (this.stage === "pen" && this.pen && this.pen.result === null) {
      this.pen.result = true;
      this.goalInfo = { speed, kind: "pen" };
      this.ducks[this.pen.shooter].celebrate = true;
      return;
    }
    if (this.stage !== "play") return;
    // the team attacking that side scores
    const team: FbTeam = this.dir(0) === side ? 0 : 1;
    this.score[team]++;
    const slot = b.last >= 0 && this.ducks[b.last].team === team ? b.last : -1;
    let kind: GoalKind | undefined;
    if (slot < 0) kind = "own";
    else if (b.head) kind = "header";
    else if (b.maxZ >= 2 && b.z > 0.3 && b.vz < 0) kind = "lob";
    else if (speed >= TUNE.screamerGoal) kind = "screamer";
    else if (hyp(b.fromX - side * HALF_L, b.fromY) < 9 || speed < 8) kind = "tap";
    this.goalInfo = { speed, kind };
    this.lastGoal = { team, slot, speed, kind };
    this.goalSeq++;
    b.passTo = -1;
    // the scorer (an own goal: the nearest attacker) runs to the corner by that goal; the beaten keeper sits down
    const hero = slot >= 0 ? this.ducks[slot] : this.ducks.filter((d) => d.team === team && !d.gk).sort((p, q) => hyp(p.x - b.x, p.y - b.y) - hyp(q.x - b.x, q.y - b.y))[0];
    this.hero = hero.slot;
    // towards the corner flag (and the crowd) by that goal, at most 12 m, so the team-mates can catch him
    const cx = side * (HALF_L - 1.6) - hero.x;
    const cy = (hero.y >= 0 ? 1 : -1) * (HALF_W - 1.6) - hero.y;
    const cl = hyp(cx, cy) || 1;
    const run = Math.min(12, cl);
    this.heroX = hero.x + (cx / cl) * run;
    this.heroY = hero.y + (cy / cl) * run;
    const k = this.keeperOf((1 - team) as FbTeam);
    k.dive = 0;
    k.kneel = 1.6;
    for (const d of this.ducks) d.charge = -1;
    this.setStage("goal");
  }

  /** keepers: decide once per kick whether they get to it, then catch / parry on contact */
  private keeperContact() {
    const b = this.ball;
    if (b.owner >= 0 || b.inNet) return;
    for (const t of [0, 1] as FbTeam[]) {
      const k = this.keeperOf(t);
      if (k.fall > 0 || k.kneel > 0) continue;
      const goalX = this.stage === "pen" && this.pen ? (this.pen.keeper === k.slot ? this.pen.side * HALF_L : NaN) : -this.dir(t) * HALF_L;
      if (!Number.isFinite(goalX)) continue;
      const toGoal = Math.sign(goalX) * b.vx;
      // decide about a shot coming in
      if (this.stage !== "pen" && b.lastTeam !== t && k.saveShot !== b.kick && toGoal > 4) {
        const tt = (k.x - b.x) / b.vx;
        if (tt > 0 && tt < 0.9) {
          const py = b.y + b.vy * tt;
          if (Math.abs(py) < GOAL_W + 1.2) {
            k.saveShot = b.kick;
            const dy = py - k.y;
            const sp = hyp(b.vx, b.vy);
            const p = clamp(0.38 + k.skill * 0.6 - Math.max(0, sp - 17) * 0.028 - Math.max(0, Math.abs(dy) - 1) * 0.16 - (tt < 0.22 ? 0.2 : 0), 0.05, 0.92);
            k.saveOk = this.rng() < p;
            if (Math.abs(dy) > 0.8 && k.lock <= 0) {
              k.dive = 0.5;
              k.dvx = 0;
              k.dvy = clamp(dy / Math.max(tt, 0.2), -8, 8) * (k.saveOk ? 1 : 0.7);
            }
          }
        }
      }
      const reach = k.dive > 0 ? TUNE.diveReach : TUNE.keeperReach;
      const dist = hyp(b.x - k.x, b.y - k.y);
      if (dist > reach || b.z > PITCH.goalHeight + 0.3 || k.noPick > 0) continue;
      const sp = hyp(b.vx, b.vy);
      const inBox = Math.abs(k.x - goalX) < PITCH.boxDepth + 1;
      if (!inBox) continue;
      const decided = k.saveShot === b.kick;
      if (decided && !k.saveOk) continue;
      if (!decided && (sp < 10 || (b.lastTeam === t && sp < 14))) continue; // rolling ball / back-pass: ordinary pickup
      if (!decided && sp > 15 && b.lastTeam !== t) {
        // an unexpected shot right at him: usually still saved
        k.saveShot = b.kick;
        k.saveOk = this.rng() < 0.4 + 0.4 * k.skill;
        if (!k.saveOk) continue;
      }
      if (sp < 16 || this.rng() < 0.45) {
        this.take(k);
        b.held = true;
        k.hasT = 0;
        this.glue();
      } else {
        // parry it away from goal
        const out = -Math.sign(goalX);
        b.vx = out * (3 + this.rng() * 4);
        b.vy = (b.y >= k.y ? 1 : -1) * (4 + this.rng() * 5);
        b.vz = 2 + this.rng() * 2;
        b.last = k.slot;
        b.lastTeam = t;
        b.shot = false;
        b.kick++;
        k.noPick = 0.5;
      }
      this.ev(FbEvent.Save, k.slot);
      if (this.stage === "pen" && this.pen && this.pen.result === null) this.pen.result = false;
    }
  }

  /** pick-ups, standing tackles (pokes) and slide tackles */
  private touches(dt: number) {
    const b = this.ball;
    if (this.stage !== "play" && this.stage !== "pen") return;
    if (b.inNet) return;
    // slides
    for (const d of this.ducks) {
      if (d.slide <= 0) continue;
      if (b.owner >= 0 && this.ducks[b.owner].team !== d.team && !b.held) {
        const o = this.ducks[b.owner];
        if (hyp(o.x - d.x, o.y - d.y) < TUNE.slideReach || hyp(b.x - d.x, b.y - d.y) < TUNE.slideReach * 0.9) {
          if (o.trick > 0) {
            this.beaten(d);
            continue;
          }
          this.release(o, b.x, b.y);
          o.noPick = TUNE.fallTime;
          o.fall = TUNE.fallTime;
          o.vx *= 0.3;
          o.vy *= 0.3;
          b.vx = d.sdx * 4.5 + d.vx * 0.2;
          b.vy = d.sdy * 4.5 + d.vy * 0.2;
          b.last = d.slot;
          b.lastTeam = d.team;
          d.noPick = 0;
          this.ev(FbEvent.Tackle, d.slot);
        }
      } else if (b.owner < 0 && b.z < 0.5 && hyp(b.x - d.x, b.y - d.y) < TUNE.slideReach * 0.9 && d.noPick <= 0) {
        b.vx = d.sdx * 6 + d.vx * 0.2;
        b.vy = d.sdy * 6 + d.vy * 0.2;
        b.last = d.slot;
        b.lastTeam = d.team;
        b.passTo = -1;
        b.shot = false;
        b.kick++;
        d.noPick = 0.25;
        this.ev(FbEvent.Tackle, d.slot);
      }
    }
    if (b.owner >= 0) {
      // pokes: an opponent at the ball can knock it away
      if (b.held) return;
      const o = this.ducks[b.owner];
      if (o.hasT < TUNE.pokeGrace) return;
      for (const d of this.ducks) {
        if (d.team === o.team || d.fall > 0 || d.slide > 0 || d.noPick > 0 || d.lock > 0) continue;
        const bd = hyp(b.x - d.x, b.y - d.y);
        if (bd > TUNE.pokeR) continue;
        const rate = this.isHuman(d) ? 2.6 : TUNE.pokeRate * (0.5 + d.skill);
        // dribbling straight into a duck's feet (the ball runs into his body) is much riskier than him reaching in
        const block = bd < TUNE.duckR + BALL_R ? TUNE.blockFactor : 1;
        const exposed = o.sprinting ? TUNE.sprintPokeFactor : 1;
        if (this.rng() < rate * block * exposed * dt) {
          if (o.trick > 0) {
            // he goes for it and the skill move takes the ball away from him
            this.beaten(d);
            continue;
          }
          this.release(o, b.x, b.y);
          o.noPick = 0.45;
          // knocked off his foot, sideways and back towards the tackler's side
          let dx = d.x - o.x;
          let dy = d.y - o.y;
          const m = hyp(dx, dy) || 1;
          dx /= m;
          dy /= m;
          const side = this.rng() < 0.5 ? 1 : -1;
          b.vx = dx * 2.5 - dy * side * 2.5 + d.vx * 0.3;
          b.vy = dy * 2.5 + dx * side * 2.5 + d.vy * 0.3;
          b.last = d.slot;
          b.lastTeam = d.team;
          d.noPick = 0;
          this.ev(FbEvent.Tackle, d.slot);
          // a clean tackle more often than not: he comes away with it
          if (this.rng() < (this.isHuman(d) ? 0.55 : 0.4 + 0.25 * d.skill)) this.take(d);
          else d.noPick = 0.1;
          return;
        }
      }
      return;
    }
    if (this.stage === "pen") return;
    // a ball at head height: headers
    if (b.z > 0.9 && b.z < 2.1) {
      for (const d of this.ducks) {
        if (d.gk || d.fall > 0 || d.slide > 0 || d.noPick > 0) continue;
        if (hyp(b.x - d.x, b.y - d.y) > 0.75) continue;
        return this.header(d);
      }
    }
    // loose ball: the nearest duck that can, takes it
    let best: Duck | null = null;
    let bd = Infinity;
    for (const d of this.ducks) {
      if (d.fall > 0 || d.slide > 0 || d.noPick > 0) continue;
      // a keeper who is beaten by this kick doesn't get to scoop it up either
      if (d.gk && d.saveShot === b.kick && !d.saveOk) continue;
      const r = d.gk ? TUNE.keeperReach : TUNE.pickupR;
      if (b.z > (d.gk ? 2.2 : 0.9)) continue;
      const dist = hyp(b.x - d.x, b.y - d.y);
      if (dist < r && dist < bd) {
        bd = dist;
        best = d;
      }
    }
    if (!best) return;
    const rel = hyp(b.vx - best.vx, b.vy - best.vy);
    if (!best.gk && rel > 15 && b.lastTeam !== best.team) {
      // a hard shot past his legs: often it just gets through
      if (b.shot && this.rng() < 0.45) {
        best.noPick = 0.25;
        return;
      }
      // a hard shot / pass at him: controls it sometimes, otherwise it deflects
      if (this.rng() > 0.25 + best.skill * 0.3) {
        b.vx = b.vx * -0.25 + (this.rng() - 0.5) * 6;
        b.vy = b.vy * 0.3 + (this.rng() - 0.5) * 6;
        b.vz = this.rng() * 2;
        b.last = best.slot;
        b.lastTeam = best.team;
        b.shot = false;
        b.kick++;
        best.noPick = 0.3;
        return;
      }
    }
    const inVx = b.vx;
    const inVy = b.vy;
    const atX = b.x;
    const atY = b.y;
    this.take(best);
    if (!best.gk && rel > 3) {
      // first touch: cushion it; a hard ball can bounce off the foot (a third of its pace, a little sideways)
      best.trap = TUNE.trapTime;
      const bounce = clamp((rel - 12) / 12, 0, 0.6) * (1.2 - best.skill);
      if (this.rng() < bounce) {
        this.release(best, atX, atY);
        best.kickT = 0;
        best.noPick = 0.25;
        b.vx = inVx * 0.3 + (this.rng() - 0.5) * 2;
        b.vy = inVy * 0.3 + (this.rng() - 0.5) * 2;
        b.vz = this.rng() * 1.5;
      }
    }
  }

  private collide() {
    const ds = this.ducks;
    const r2 = TUNE.duckR * 2;
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i];
        const c = ds[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = hyp(dx, dy);
        if (d >= r2 || d === 0) continue;
        const push = (r2 - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
      }
  }

  private moveRef(dt: number) {
    const b = this.ball;
    const tx = clamp(b.x * 0.75, -HALF_L + 6, HALF_L - 6);
    const ty = clamp(b.y > 0 ? b.y - 7 : b.y + 7, -HALF_W + 2, HALF_W - 2);
    const dx = tx - this.ref.x;
    const dy = ty - this.ref.y;
    const d = hyp(dx, dy);
    const step = Math.min(d, 5.5 * dt);
    if (d > 0.5) {
      this.ref.x += (dx / d) * step;
      this.ref.y += (dy / d) * step;
    }
  }

  // ------------------------------------------------------------------ penalties
  /** before the kick: the shooter aims (a person with the joystick and b, the computer on its own) */
  private penDuck(d: Duck, dt: number) {
    const pk = this.pen;
    if (!pk || d.slot !== pk.shooter || pk.kicked) return;
    const p = this.ctrlBy[d.slot];
    if (p) {
      if (p.bDown) {
        p.bDown = false;
        d.charge = 0;
      }
      if (d.charge >= 0 && p.b) d.charge = Math.min(1, d.charge + dt / TUNE.chargeTime);
      p.aDown = false;
      if (p.bUp) {
        p.bUp = false;
        if (d.charge >= 0) this.penKick(d, 0.45 + d.charge * 0.55, p.y * 3.2, 0.55);
      }
      if (pk.t > 10 && !pk.kicked) this.penKick(d, 0.6, (this.rng() - 0.5) * 4);
    } else if (pk.t >= pk.at) {
      const r = this.rng();
      const aim = r < 0.15 ? 0 : (r < 0.57 ? -1 : 1) * (1.8 + this.rng() * 1.1);
      this.penKick(d, 0.62 + this.rng() * 0.33, aim, 0.55);
    }
  }
  private penKick(d: Duck, power: number, aimY: number, spread = 0.8) {
    const b = this.ball;
    // step up to the ball, then strike
    d.x = b.x - (this.pen!.side * 0.5);
    this.take(d);
    this.shoot(d, power, aimY, spread);
  }
  private penTick(dt: number) {
    const pk = this.pen;
    if (!pk) return;
    pk.t += dt;
    if (!pk.kicked || pk.result !== null) return;
    pk.kickT += dt;
    const b = this.ball;
    const sp = hyp(b.vx, b.vy);
    if (pk.kickT > 0.3 && (b.vx * pk.side < 0 || sp < 1.5 || pk.kickT > 3)) pk.result = false;
  }

  // ------------------------------------------------------------------ helpers
  gauss() {
    const u = Math.max(1e-9, this.rng());
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  action(d: Duck): number {
    if (d.kneel > 0) return FbAction.Kneel;
    if (d.fall > 0) return FbAction.Fall;
    if (d.dive > 0) return FbAction.Dive;
    if (d.slide > 0) return FbAction.Slide;
    if (d.celebrate) return FbAction.Celebrate;
    if (d.mope) return FbAction.Idle;
    if (d.trick > 0) return FbAction.Skill;
    if (d.trap > 0) return FbAction.Trap;
    if (d.kickT > 0) return FbAction.Kick;
    const sp = hyp(d.vx, d.vy);
    if ((d.sprinting || d.dash > 0) && sp > 6) return FbAction.Sprint;
    if (sp > 0.6) return FbAction.Run;
    return FbAction.Idle;
  }
  /** the snapshot for the screens (numbers rounded to 2 decimals); drains the events */
  frame(t: number): FbFrame {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const b = this.ball;
    const p: number[] = [];
    for (const d of this.ducks) p.push(r2(d.x), r2(d.y), d.face, this.action(d));
    const f: FbFrame = { t, b: [r2(b.x), r2(b.y), r2(b.z), b.owner], p, r: [r2(this.ref.x), r2(this.ref.y)], c: this.control() };
    if (this.events.length) f.ev = this.events.splice(0);
    if (this.people.size) {
      const st = this.stamina();
      if (Object.keys(st).length) f.st = st;
    }
    return f;
  }
}
