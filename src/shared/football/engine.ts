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
  accel: 36,
  accelSprint: 19,
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
  rollA: 1.0,
  rollB: 0.2,
  gravity: 9.8,
  boardRest: 0.6,
  postRest: 0.55,
  passMin: 8,
  passMax: 24,
  /** a ground pass arrives at about this speed (m/s): crisp, so it is not cut out on the way */
  passArrive: 9,
  /** a pass is led at most this far ahead of a running team-mate (m) */
  passLead: 3.5,
  /** an opponent cannot react to a ball for this long after it is kicked (s), unless it hits him */
  cutReact: 0.14,
  /** holding the pass button at least this long (s) makes it a lofted through ball / a cross; it goes by itself at passAuto */
  lobHold: 0.22,
  passAuto: 0.55,
  /** a ball landing from the air keeps this much of its pace (grass takes the rest) */
  landDamp: 0.72,
  /** the ball at the feet follows the boot on a spring (1/s): it swings round on a turn instead of being nailed on */
  dribbleSpring: 16,
  /** the ball more than this far from where the boot wants it (m) is no longer his */
  dribbleLose: 1.4,
  /** a computer defender against a person: stands off this far (jockeying), and now and then lunges in */
  jockeyR: 1.5,
  lungeTime: 0.4,
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
  chargeTime: 0.75,
  slideSpeed: 10,
  slideTime: 0.4,
  slideCooldown: 1.1,
  slideReach: 1.05,
  /** a person's slide bends towards a ball carrier this close in front (aim assist), within this angle (cos) */
  slideAssistR: 3.5,
  slideAssistCos: 0.7,
  /** and while sliding it turns towards the ball close ahead at up to this rate (rad/s) */
  slideTurn: 3.2,
  /** a slide that wins the ball: the slider keeps it and is up this quickly (s of slide left at most) */
  slideWinRest: 0.1,
  /** getting up after a slide that missed */
  slideRecover: 0.28,
  fallTime: 0.5,
  /** a carrier moving away from a defender behind him shields the ball: pokes from behind are this much rarer */
  shieldFactor: 0.4,
  /** braking / turning back is quicker than speeding up (multiplier on accel when the stick points against the run) */
  brakeFactor: 1.7,
  /** a tapped shot still has this much power (0..1); holding fills the rest */
  shotTapPower: 0.4,
  /** standing tackle: a defender this close to the ball commits to one (a computer duck: rate per second scaled by
   *  skill; a person's duck: when he runs in within pokeR). It is never a silent dice roll: he leans in for
   *  tackleWind seconds (you see it coming and can turn away), then for tackleHit seconds his boot gets the ball if
   *  it is within tackleReach of it. A miss leaves him stumbling for tackleMiss. */
  pokeR: 0.8,
  pokeRate: 1.6,
  tackleStart: 1.25,
  tackleWind: 0.16,
  tackleHit: 0.12,
  tackleReach: 0.62,
  tackleMiss: 0.42,
  tackleCd: 0.9,
  /** a fresh owner can't be poked for this long */
  pokeGrace: 0.4,
  /** poke rate multiplier when the ball runs into the defender's body */
  blockFactor: 2.5,
  kickoffFreeze: 1.2,
  /** after the freeze, the kick-off waits up to this long for everybody to walk back to their spot */
  kickoffWalk: 2.5,
  /** goal stage: celebrate for celebrateT, then everybody jogs back; the kick-off comes at goalPause */
  goalPause: 4.5,
  celebrateT: 2.8,
  /** a person's solo control switches to a nearer duck only when it is this much nearer, after this long */
  switchMargin: 2.0,
  switchHold: 0.9,
  /** a computer defender starts reacting to a new pass after about this long (s, less for skilled ones) */
  aiReadPass: 0.28,
  /** a person nearest the carrier but further than this (m) from him: a computer team-mate presses meanwhile */
  helpPress: 3,
  /** a computer duck tackling a PERSON's carrier leans in this long first (s, by difficulty easy / normal / hard): long
   *  enough to see the "!" and turn away. Against the computer it stays tackleWind. */
  aiWindVsPerson: [0.5, 0.4, 0.3],
  /** how often a computer duck goes in on a person's carrier (multiplier on pokeRate, by difficulty) */
  aiRateVsPerson: [0.4, 0.65, 0.95],
  /** a person's carrier who turns at least this much (cos between his heading at the lean-in and at the contact)
   *  while a tackle is coming has dodged it: the tackler stumbles */
  dodgeCos: 0.55,
};

/** difficulty against people: 0 easy, 1 normal, 2 hard */
export type FbLevel = 0 | 1 | 2;

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
  /** a jockeying defender lunges in for the ball until this time */
  lunge: number;
  /** a committed standing tackle: time left (lean in, then the contact window), its direction, the wait before the
   *  next one, and the stumble after a miss / being beaten (shown as a stagger) */
  /** coming short for the carrier: the spot, re-picked at shortT */
  shortX: number;
  shortY: number;
  shortT: number;
  tackle: number;
  tdx: number;
  tdy: number;
  tackleCd: number;
  stagger: number;
  /** the carrier's heading when this tackle started (a sharp turn since = dodged) and whether it was on a person */
  tox: number;
  toy: number;
  tOnPerson: boolean;
  /** a pass going past him: the kick id he already decided about, and whether he gets a foot to it */
  cutKick: number;
  cutOk: boolean;
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
  /** id of the last kick (keepers decide once per kick) and when it was struck (engine time) */
  kick: number;
  kickAt: number;
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
  /** A let go since the last tick; how long A has been held for the current pass (-1 = not passing) */
  aUp: boolean;
  aT: number;
  bDown: boolean;
  bUp: boolean;
  /** sprint held, skill button held / pressed since the last tick */
  s: boolean;
  k: boolean;
  kDown: boolean;
  /** chip asked for (the sprint key held, not a phone's pushed-out stick) */
  c: boolean;
  /** controlled slot right now and how long it has been */
  ctrl: number;
  ctrlT: number;
  /** with the ball: who the pass would go to right now (slot + 100 * kind: 0 a pass to feet, 1 a through ball /
   *  long ball (A held), 2 a cross), -1 = nobody / no ball. Sent to the screens to mark the receiver. */
  aim: number;
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
  /** a person's team defending: the computer duck in `cover` doubles up on the carrier with the person */
  double: boolean;
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

/** how long a ground pass of `d` metres takes when it arrives at `arrive` m/s */
export function rollTime(d: number, arrive: number) {
  const b = TUNE.rollB;
  const c = TUNE.rollA / b;
  const v0 = passSpeed(d, arrive);
  return Math.log((v0 + c) / (arrive + c)) / b;
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
    { has: false, chaser: -1, presser: -1, cover: -1, double: false },
    { has: false, chaser: -1, presser: -1, cover: -1, double: false },
  ];
  /** predicted loose-ball positions every 0.1 s for 2.5 s */
  path: { x: number; y: number; z: number }[] = [];
  rng: () => number;

  /** difficulty against people (computer ducks vs a person's carrier): 0 easy, 1 normal, 2 hard */
  level: FbLevel = 1;
  constructor(public roster: FbPlayer[], opts: { seed?: number; halfSeconds: number; skill?: (p: FbPlayer) => number; level?: FbLevel }) {
    this.rng = mulberry32(opts.seed ?? 1);
    this.level = opts.level ?? 1;
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
        saveShot: -1, saveOk: false, charge: -1, celebrate: false, mope: false, wantBy: -1, wantUntil: 0, lunge: 0, shortX: 0, shortY: 0, shortT: 0, tackle: 0, tdx: 1, tdy: 0, tackleCd: 0, stagger: 0, tox: 1, toy: 0, tOnPerson: false, cutKick: -1, cutOk: false,
      };
    });
    this.ctrlBy = this.ducks.map(() => null);
    this.ball = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, held: false, last: -1, lastTeam: -1, inNet: false, passTo: -1, kick: 0, kickAt: 0, shot: false,
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
    this.people.set(pid, { pid, team, own, active: true, x: 0, y: 0, a: false, b: false, aDown: false, aUp: false, aT: -1, bDown: false, bUp: false, s: false, k: false, kDown: false, c: false, ctrl: own, ctrlT: 0, aim: -1 });
  }
  setActive(pid: string, active: boolean) {
    const p = this.people.get(pid);
    if (!p || p.active === active) return;
    p.active = active;
    if (!active) {
      if (this.ducks[p.ctrl]) this.ducks[p.ctrl].charge = -1;
      p.a = p.b = p.aDown = p.aUp = p.bDown = p.bUp = p.s = p.k = p.kDown = false;
      p.aT = -1;
      p.x = p.y = 0;
    }
  }
  input(pid: string, inp: FbInput) {
    const p = this.people.get(pid);
    if (!p) return;
    if (inp.a && !p.a) p.aDown = true;
    if (!inp.a && p.a) p.aUp = true;
    if (inp.b && !p.b) p.bDown = true;
    if (!inp.b && p.b) p.bUp = true;
    if (inp.k && !p.k) p.kDown = true;
    p.a = inp.a;
    p.b = inp.b;
    p.s = !!inp.s;
    p.k = !!inp.k;
    p.c = !!inp.c;
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
              // the player is running his duck at the ball himself: leave him on it unless another is much closer
              // (control jumping away from the duck you are steering felt like losing him)
              const sm = hyp(p.x, p.y);
              const chasing = sm > 0.3 && dc > 0.5 && ((b.x - cur.x) * p.x + (b.y - cur.y) * p.y) / (sm * dc) > 0.6;
              if (dn < dc - TUNE.switchMargin * (chasing ? 2.5 : 1)) p.ctrl = near.slot;
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
  /** a person plays on this team (people's team-mates help more actively) */
  teamHasPerson(t: FbTeam) {
    for (const p of this.people.values()) if (p.team === t && p.active) return true;
    return false;
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
      let z = b.z;
      let vx = b.vx;
      let vy = b.vy;
      let vz = b.vz;
      const h = 0.1 / 3;
      for (let i = 0; i < 25; i++) {
        for (let k = 0; k < 3; k++) {
          if (z > 0 || vz > 0) {
            // in the air: gravity, a little drag; a hard landing bounces and loses pace
            vz -= TUNE.gravity * h;
            z += vz * h;
            vx *= 1 - 0.1 * h;
            vy *= 1 - 0.1 * h;
            if (z <= 0) {
              z = 0;
              if (vz < -1.5) {
                vz = -vz * 0.5;
                vx *= TUNE.landDamp;
                vy *= TUNE.landDamp;
              } else vz = 0;
            }
          } else {
            const sp = hyp(vx, vy);
            if (sp > 0) {
              const ns = Math.max(0, sp - (TUNE.rollA + TUNE.rollB * sp) * h);
              vx *= ns / sp;
              vy *= ns / sp;
            }
          }
          x += vx * h;
          y += vy * h;
          if (Math.abs(y) > HALF_W - BALL_R) {
            y = Math.sign(y) * (HALF_W - BALL_R);
            vy = -vy * TUNE.boardRest;
          }
          if (Math.abs(x) > HALF_L - BALL_R && Math.abs(y) > GOAL_W) {
            x = Math.sign(x) * (HALF_L - BALL_R);
            vx = -vx * TUNE.boardRest;
          }
        }
        this.path.push({ x, y, z });
      }
    }
    const ownerTeam = b.owner >= 0 ? this.ducks[b.owner].team : -1;
    for (const t of [0, 1] as FbTeam[]) {
      const c = this.ctx[t];
      c.has = ownerTeam === t;
      c.chaser = c.presser = c.cover = -1;
      c.double = false;
      const mine = this.ducks.filter((d) => d.team === t && !d.gk && d.fall <= 0);
      if (b.owner < 0) {
        if (b.passTo >= 0 && this.ducks[b.passTo].team === t && !this.ducks[b.passTo].gk) {
          c.chaser = b.passTo;
          continue;
        }
        // the computer's chaser is its own fastest duck to the ball; a person's team-mates leave it to him only when
        // he is clearly first there (before, they stood off whenever he was a little nearer, even if he was not
        // going for it, and a person's team lost most loose balls)
        let best = -1;
        let bt = Infinity;
        let ht = Infinity;
        for (const d of mine) {
          const tt = this.reach(d).t;
          if (this.isHuman(d)) ht = Math.min(ht, tt);
          else if (tt < bt) {
            bt = tt;
            best = d.slot;
          }
        }
        c.chaser = ht < bt - 0.6 ? -1 : best;
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
        const danger = Math.abs(o.x - -this.dir(t) * HALF_L) < 20;
        if (this.isHuman(byDist[0])) {
          // a person nearest the carrier: if he is not on him yet, the nearest team-mate presses meanwhile; if he
          // is, a team-mate comes in to double up (the computer's own defence does the same)
          const ai = byDist.find((d) => !this.isHuman(d));
          if (ai) {
            if (hyp(byDist[0].x - o.x, byDist[0].y - o.y) > TUNE.helpPress) c.presser = ai.slot;
            else c.cover = ai.slot;
            c.double = true;
          }
        } else if (this.teamHasPerson(t)) {
          // a person's team: the computer duck nearest the carrier goes at him (and tackles), and the next one helps
          // when he is in our half; the person joins in where he likes
          c.cover = byDist.find((d, i) => i > 0 && !this.isHuman(d) && (danger || Math.abs(o.x - -this.dir(t) * HALF_L) < HALF_L))?.slot ?? -1;
          c.double = c.cover >= 0;
        } else if (danger) c.cover = byDist.find((d, i) => i > 0 && !this.isHuman(d))?.slot ?? -1;
      }
    }
  }
  /** earliest time (and place) this duck can meet the loose ball */
  reach(d: Duck): { t: number; x: number; y: number } {
    const sp = d.gk ? TUNE.keeperSpeed : d.stamina > 0.25 && !d.tired ? TUNE.sprintSpeed * 0.92 : TUNE.jogSpeed;
    for (let i = 0; i < this.path.length; i++) {
      const p = this.path[i];
      if (p.z > (d.gk ? 2.2 : 0.9)) continue;
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
    d.tackleCd = Math.max(0, d.tackleCd - dt);
    d.stagger = Math.max(0, d.stagger - dt);
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
      // a person's slide homes in a little on the ball ahead (a dodge can still beat it)
      if (this.ctrlBy[d.slot]) this.slideHome(d, dt);
      // fast off the mark, easing out along the grass (no sudden stop)
      const u = clamp(d.slide / TUNE.slideTime, 0, 1);
      const k = Math.max(0.22, u * (1.15 - 0.15 * u));
      d.vx = d.sdx * TUNE.slideSpeed * k;
      d.vy = d.sdy * TUNE.slideSpeed * k;
      // up again: at once with the ball, quickly after poking it loose, slower after a miss
      if (d.slide <= 0) d.lock = this.ball.owner === d.slot ? 0 : this.ball.last === d.slot && this.ball.owner < 0 ? 0.08 : TUNE.slideRecover;
    } else if (d.dive > 0) {
      d.dive -= dt;
      d.vx = d.dvx;
      d.vy = d.dvy;
      if (d.dive <= 0) d.lock = 0.35;
    } else if (d.tackle > 0) {
      // a standing tackle: a step in towards the ball while leaning, planted for the contact
      d.tackle -= dt;
      const v = d.tackle > TUNE.tackleHit ? (d.tOnPerson ? 1.6 : 3) : 1.2;
      d.vx = d.tdx * v;
      d.vy = d.tdy * v;
      if (d.tackle <= 0) {
        // missed: off balance for a moment, the carrier gets away
        d.lock = TUNE.tackleMiss;
        d.noPick = TUNE.tackleMiss * 0.6;
        d.stagger = TUNE.tackleMiss;
        d.tackleCd = TUNE.tackleCd;
      }
    } else if (d.lock > 0) {
      d.lock -= dt;
      const f = Math.pow(0.7, dt * 30);
      d.vx *= f;
      d.vy *= f;
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
        // a sprint in play, and team-mates racing to the hero to celebrate
        want = d.wantSprint && (this.stage === "play" || (this.stage !== "kickoff" && hyp(d.tx - d.x, d.ty - d.y) > 2.5));
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
      let maxA = (d.sprinting ? TUNE.accelSprint : d.dash > 0 ? TUNE.accel * 2 : TUNE.accel) * dt;
      // stopping / turning back bites harder than speeding up: tight, responsive changes of direction
      if (tvx * d.vx + tvy * d.vy < 0 || hyp(tvx, tvy) < hyp(d.vx, d.vy) - 0.5) maxA *= TUNE.brakeFactor;
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
    if (this.stage !== "play") d.wantSprint = false;
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
    // a computer defender reads a new pass like a person would: a moment late. Planning from the ball's exact
    // path the instant it was kicked cut out passes no player could have (keepers keep their own timing)
    const bl = this.ball;
    if (!d.gk && bl.owner < 0 && !bl.shot && bl.lastTeam >= 0 && bl.lastTeam !== d.team && this.time - bl.kickAt < TUNE.aiReadPass * (1.3 - d.skill * 0.6)) return;
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
    d.wantSprint = !d.gk && hyp(d.tx - d.x, d.ty - d.y) > 2.5;
    d.celebrate = hyp(d.x - h.x, d.y - h.y) < 2.6;
  }

  /** a person's duck: joystick moves it, a passes / slides, b charges a shot (or switches, see updateControl) */
  private personDrive(d: Duck, p: Person, dt: number): [number, number] {
    let jx = p.x;
    let jy = p.y;
    let m = hyp(jx, jy);
    if (m < 0.15) jx = jy = 0;
    else if (m > 1) {
      jx /= m;
      jy /= m;
    }
    // receiving a pass: he goes to meet the ball by himself (where he can first reach it), unless the stick
    // clearly asks for something else
    const bl = this.ball;
    if (bl.owner < 0 && bl.passTo === d.slot) {
      const r = this.reach(d);
      let rx = r.x - d.x;
      let ry = r.y - d.y;
      const rl = hyp(rx, ry);
      if (rl > 0.3) {
        rx /= rl;
        ry /= rl;
        const agree = m < 0.3 || (jx * rx + jy * ry) / Math.max(0.01, Math.min(1, m)) > 0.3;
        if (agree) {
          jx = rx;
          jy = ry;
          m = 1;
        }
      }
    }
    // defending assist (like FIFA's contain): running at the other team's carrier, he goes to the goal-side spot in
    // front of him instead of chasing the ball itself, so a beginner who just runs at the ball stays between him and
    // the goal and the tackle comes by itself; a stick pointing elsewhere is obeyed
    {
      const ow = this.ball.owner >= 0 ? this.ducks[this.ball.owner] : null;
      if (ow && ow.team !== d.team && m >= 0.3 && !d.gk && !p.aDown) {
        const cx = ow.x - d.x;
        const cy = ow.y - d.y;
        const cd = hyp(cx, cy);
        if (cd < 7 && cd > 0.2 && (jx * cx + jy * cy) / (cd * Math.min(1, m)) > 0.5) {
          const gx = -this.dir(d.team) * HALF_L - ow.x;
          const gy = -ow.y;
          const gm = hyp(gx, gy) || 1;
          const off = cd > 2.5 ? 1.2 : 0.55;
          const tx = ow.x + ow.vx * 0.3 + (gx / gm) * off - d.x;
          const ty = ow.y + ow.vy * 0.3 + (gy / gm) * off - d.y;
          const tm = hyp(tx, ty);
          if (tm > 0.15) {
            const k = Math.min(1, m);
            jx = (tx / tm) * k;
            jy = (ty / tm) * k;
          }
        }
      }
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
      // with the ball: the pass goes when A is let go (a tap = along the ground, held = lofted over the top)
      if (mine) p.aT = 0;
      else if (ownerTeam === d.team) {
        const o = this.ducks[b.owner];
        o.wantBy = d.slot;
        o.wantUntil = this.time + 1.5;
        o.think = 0;
      } else {
        // without the ball: right at the carrier = a standing tackle (safe), further = a slide
        const o = b.owner >= 0 ? this.ducks[b.owner] : null;
        const od = o ? hyp(o.x - d.x, o.y - d.y) : 99;
        if (o && od < 1.7 && d.tackle <= 0 && d.tackleCd <= 0 && d.lock <= 0 && d.fall <= 0 && d.slide <= 0) {
          const ax = b.x + b.vx * TUNE.tackleWind - d.x;
          const ay = b.y + b.vy * TUNE.tackleWind - d.y;
          const am = hyp(ax, ay) || 1;
          d.tdx = ax / am;
          d.tdy = ay / am;
          d.tOnPerson = false;
          d.tackle = TUNE.tackleWind + TUNE.tackleHit;
          d.hx = d.tdx;
          d.hy = d.tdy;
        } else if (d.slideCd <= 0) {
          const [ax, ay] = this.slideAim(d, d.hx, d.hy);
          this.slideStart(d, ax, ay);
        }
      }
    }
    if (p.aT >= 0) {
      if (!mine) p.aT = -1;
      else {
        if (p.a) p.aT += dt;
        if (p.aUp || !p.a || p.aT >= TUNE.passAuto) {
          const px = m >= 0.3 ? jx : d.hx;
          const py = m >= 0.3 ? jy : d.hy;
          if (p.aT >= TUNE.lobHold) this.through(d, px, py);
          else this.pass(d, this.pickPass(d, px, py, 26), 0.02, px, py);
          p.aT = -1;
        }
      }
    }
    p.aUp = false;
    p.aim = -1;
    if (mine) {
      const px = m >= 0.3 ? jx : d.hx;
      const py = m >= 0.3 ? jy : d.hy;
      if (p.aT >= TUNE.lobHold) {
        const s = this.dir(d.team);
        const toLine = HALF_L - d.x * s;
        const towardsBox = px * s > -0.2 && -Math.sign(d.y) * py > -0.2;
        if (toLine < 20 && Math.abs(d.y) > 6 && towardsBox) {
          const inBox = this.ducks
            .filter((q) => q.team === d.team && q !== d && !q.gk && q.fall <= 0 && HALF_L - q.x * s < 15 && Math.abs(q.y) < 9)
            .sort((q, r) => Math.abs(q.y) - Math.abs(r.y));
          p.aim = inBox[0] ? inBox[0].slot + 200 : -1;
        } else {
          const t = this.pickPass(d, px, py);
          p.aim = t >= 0 ? t + 100 : -1;
        }
      } else p.aim = this.pickPass(d, px, py, 26);
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
    // shoot held before the ball arrived: the charge starts when it is at his feet
    if (p.b && d.charge < 0 && mine) d.charge = 0;
    if (d.charge >= 0) {
      if (p.b) d.charge = Math.min(1, d.charge + dt / TUNE.chargeTime);
    }
    if (p.bUp) {
      p.bUp = false;
      if (d.charge >= 0 && (mine || this.nearBall(d, 1.2))) {
        // the stick across the goal picks the corner (and curls it a little); no stick: the open corner
        const bend = Math.abs(jy) > 0.25 ? jy * 0.7 : 0;
        const aim = Math.abs(jy) > 0.25 ? clamp(jy * 3.2, -2.9, 2.9) : this.autoAim(d);
        const power = TUNE.shotTapPower + (1 - TUNE.shotTapPower) * d.charge;
        // (a chip keeps its own softer scale: the same hold lifts it the same height as before)
        if (p.c && mine) this.chip(d, 0.28 + 0.72 * Math.min(1, (d.charge * TUNE.chargeTime) / 0.9), aim);
        else this.shoot(d, power, aim, 0.6, bend, true);
      }
      d.charge = -1;
    }
    return [jx, jy];
  }

  /** where a shot goes without a joystick bend: the corner away from the keeper */
  autoAim(d: Duck) {
    const k = this.keeperOf((1 - d.team) as FbTeam);
    if (Math.abs(k.y) > 0.4) return k.y > 0 ? -2.85 : 2.85;
    return d.y > 0 ? -2.75 : 2.75;
  }

  /** the team-mate a pass along (dx, dy) is meant for; -1 = nobody that way (into space). The stick decides: the
   *  mate closest to its direction wins, and distance / a blocked lane only break near-ties (a few degrees), so the
   *  game never swaps the player's choice for "a better option" somewhere else. Any direction (back, square,
   *  across the whole pitch) works; `maxDist` limits a short pass. */
  pickPass(d: Duck, dx: number, dy: number, maxDist = 40): number {
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
      if (dist < 2 || dist > maxDist) continue;
      const cos = (vx * dx + vy * dy) / dist;
      // within ~70 degrees of the stick (a thumb on a phone is not precise)
      if (cos < 0.34) continue;
      const ang = Math.acos(clamp(cos, -1, 1));
      const risk = this.laneRisk(d, m.x, m.y);
      // 1 rad off the stick costs 6; a lane with a defender in it ~0.6 (about 6 degrees), 10 m of distance 0.25
      const sc = -ang * 6 - (risk < 1 ? 0.6 : risk < 1.8 ? 0.25 : 0) - dist * 0.025 - (m.gk ? 1.5 : 0);
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
    b.kickAt = this.time;
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
  pass(d: Duck, to: number, err = 0.03, sx = d.hx, sy = d.hy, atX?: number, atY?: number, arrive = TUNE.passArrive) {
    if (this.ball.owner !== d.slot) return;
    const b = this.ball;
    let tx: number;
    let ty: number;
    if (atX !== undefined && atY !== undefined) {
      tx = atX;
      ty = atY;
    } else if (to >= 0) {
      // where he will be when the ball gets there (a few rounds: the travel time depends on the distance)
      const m = this.ducks[to];
      let t = hyp(m.x - d.x, m.y - d.y) / 15;
      tx = m.x;
      ty = m.y;
      // (led into his stride, but never more than a few metres: a long lead is a race the defender wins)
      for (let i = 0; i < 3; i++) {
        const lead = Math.min(TUNE.passLead, hyp(m.vx, m.vy) * t * 0.7);
        const ms = hyp(m.vx, m.vy) || 1;
        tx = m.x + (m.vx / ms) * lead;
        ty = m.y + (m.vy / ms) * lead;
        t = rollTime(hyp(tx - d.x, ty - d.y), arrive);
      }
    } else {
      const sm = hyp(sx, sy) || 1;
      tx = d.x + (sx / sm) * 13;
      ty = d.y + (sy / sm) * 13;
    }
    tx = clamp(tx, -HALF_L + 1, HALF_L - 1);
    ty = clamp(ty, -HALF_W + 1, HALF_W - 1);
    // into space: the team-mate who gets there first runs onto it (and a person's control follows him)
    if (to < 0) to = this.runnerFor(d, tx, ty);
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
    } else sp = clamp(passSpeed(dist, arrive) * (1 + (this.rng() - 0.5) * err * 2), TUNE.passMin, TUNE.passMax);
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
  /** a person's held pass, along the stick, any distance (switching play across the whole pitch included):
   *  - wide in the last third with the stick towards the box: a cross dropping at head height for a team-mate;
   *  - a team-mate that way running forward into space: a through ball into his path;
   *  - a team-mate that way: a firm pass to him, driven along the ground when the lane is clear and not too far,
   *    lofted over the top when it is blocked or long;
   *  - nobody that way: lofted into the space, for whoever gets there first. */
  through(d: Duck, sx: number, sy: number) {
    if (this.ball.owner !== d.slot) return;
    const s = this.dir(d.team);
    const sm = hyp(sx, sy) || 1;
    sx /= sm;
    sy /= sm;
    const toLine = HALF_L - d.x * s;
    const towardsBox = sx * s > -0.2 && -Math.sign(d.y) * sy > -0.2;
    if (toLine < 20 && Math.abs(d.y) > 6 && towardsBox) {
      const mates = this.ducks.filter((m) => m.team === d.team && m !== d && !m.gk && m.fall <= 0);
      const inBox = mates.filter((m) => HALF_L - m.x * s < 15 && Math.abs(m.y) < 9).sort((p, q) => Math.abs(p.y) - Math.abs(q.y));
      const m = inBox[0];
      const tx = m ? m.x + m.vx * 0.7 : s * (HALF_L - PITCH.penSpot);
      const ty = m ? m.y + m.vy * 0.7 : -Math.sign(d.y) * 1.5;
      return this.lob(d, tx, ty, m ? m.slot : -1, 1.5);
    }
    const to = this.pickPass(d, sx, sy);
    if (to < 0) return this.lob(d, d.x + sx * 18, d.y + sy * 18, -1, 0);
    const m = this.ducks[to];
    const dist = hyp(m.x - d.x, m.y - d.y);
    const runFwd = m.vx * s;
    if (runFwd > 3 && (m.x - d.x) * s > -2) {
      // through ball: into his path, about where he will be when it lands, a couple of metres beyond
      const T = clamp(dist / 16, 0.6, 1.4);
      const tx = m.x + m.vx * T + s * 2;
      const ty = m.y + m.vy * T;
      if (this.laneRisk(d, tx, ty) > 1.8 && dist < 20) return this.pass(d, to, 0.02, sx, sy, tx, ty);
      return this.lob(d, tx, ty, to, 0);
    }
    if (this.laneRisk(d, m.x, m.y) > 1.6 && dist < 24) return this.pass(d, to, 0.02, sx, sy, undefined, undefined, 12);
    this.lob(d, m.x + m.vx * 0.6, m.y + m.vy * 0.6, to, 0);
  }
  /** the passer's team-mate (not the keeper) who can get to (x, y) first; -1 = nobody gets near it */
  runnerFor(d: Duck, x: number, y: number) {
    let best = -1;
    let bt = Infinity;
    for (const m of this.ducks) {
      if (m.team !== d.team || m === d || m.gk || m.fall > 0) continue;
      const t = hyp(m.x - x, m.y - y) / (m.stamina > 0.2 ? TUNE.sprintSpeed : TUNE.jogSpeed);
      if (t < bt) {
        bt = t;
        best = m.slot;
      }
    }
    return bt < 2.2 ? best : -1;
  }
  /** a lofted ball that comes down at (tx, ty) at height `arriveZ` (0 = on the grass, 1.5 = for a header) */
  lob(d: Duck, tx: number, ty: number, to: number, arriveZ: number) {
    const b = this.ball;
    if (b.owner !== d.slot) return;
    tx = clamp(tx, -HALF_L + 1.5, HALF_L - 1.5);
    ty = clamp(ty, -HALF_W + 1.5, HALF_W - 1.5);
    let dx = tx - d.x;
    let dy = ty - d.y;
    const dist = Math.max(1, hyp(dx, dy));
    dx /= dist;
    dy /= dist;
    // a long ball hangs longer (a higher arc) so it drops near the receiver instead of skidding past him; a cross
    // for a header is whipped in flatter
    const T = arriveZ > 0 ? clamp(dist / 16, 0.6, 1.4) : clamp(dist / 12, 0.75, 2.0);
    // (air drag: the ball slows ~10% a second while up)
    const sp = clamp(dist / (T * (1 - 0.05 * T)), 6, 26);
    const vz = (arriveZ + 0.5 * TUNE.gravity * T * T) / T;
    this.release(d, d.x + dx * 0.6, d.y + dy * 0.6);
    b.z = 0.05;
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.vz = vz;
    b.passTo = to >= 0 ? to : this.runnerFor(d, tx, ty);
    b.shot = false;
    d.hx = dx;
    d.hy = dy;
    this.ev(FbEvent.Pass, d.slot);
  }
  /** shot at the goal this duck attacks: power 0..1, aimY across the mouth, spread multiplier, bend -1..1 (the ball
   *  starts off line and curls in towards aimY). Strong shots are much faster and dip; weak ones are slow and low. */
  shoot(d: Duck, power: number, aimY: number, spread = 1, bend = 0, person = false) {
    // the computer shooting at a person's goal is less accurate on easy / normal (people must not be shot to bits)
    if (!person && this.teamHasPerson((1 - d.team) as FbTeam)) spread *= [1.6, 1.25, 1][this.level];
    const b = this.ball;
    if (b.owner >= 0 && b.owner !== d.slot) return;
    const side = this.stage === "pen" && this.pen ? this.pen.side : this.dir(d.team);
    const gx = side * HALF_L;
    power = clamp(power, 0, 1);
    const dist = hyp(gx - b.x, aimY - b.y);
    // a person's shot goes where they asked a bit more reliably (power still costs some accuracy)
    const sigma = (0.3 + power * power * (person ? 0.5 : 0.8) + dist * 0.022 + (1 - d.skill) * (person ? 0.15 : 0.35)) * spread;
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
    // struck from where the ball is (at his feet), not teleported round him: a ball behind the line of the shot
    // is nudged only a little towards the strike side
    const own = b.owner === d.slot;
    const bx = own ? b.x * 0.5 + (d.x + dx * 0.5) * 0.5 : b.x;
    const by = own ? b.y * 0.5 + (d.y + dy * 0.5) * 0.5 : b.y;
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
  /** a chip (shoot let go with sprint held): a soft, high ball that drops under the bar, over a keeper off his line */
  chip(d: Duck, power: number, aimY: number) {
    const b = this.ball;
    if (b.owner !== d.slot) return;
    const side = this.dir(d.team);
    const gx = side * (HALF_L - 0.5);
    const gy = aimY * 0.6 + this.gauss() * (0.4 + (1 - d.skill) * 0.3);
    const dist = hyp(gx - b.x, gy - b.y);
    // lands just under the bar at the goal line: the flight time from the distance, the arc from the time
    const T = clamp(dist / (9 + 6 * power), 0.7, 1.8);
    const vz = (1.6 + 0.5 * TUNE.gravity * T * T) / T;
    let dx = gx - b.x;
    let dy = gy - b.y;
    const m = hyp(dx, dy) || 1;
    dx /= m;
    dy /= m;
    const sp = dist / (T * (1 - 0.05 * T));
    this.release(d, b.x, b.y);
    b.z = 0.05;
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.vz = vz;
    b.passTo = -1;
    b.shot = true;
    d.hx = dx;
    d.hy = dy;
    this.ev(FbEvent.Kick, d.slot);
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
    // the ball was meant for him and he is not in a heading position at goal: he chests / thighs it down and keeps
    // it (a long ball arriving at chest height must not be flicked on to nobody)
    if (b.passTo === d.slot && !(toGoal < 16 && Math.abs(d.y) < 11)) {
      this.take(d);
      d.trap = TUNE.trapTime * 1.5;
      return;
    }
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
  /** the slide got the ball: he keeps it at his feet, the slide eases out quickly and he gets up running */
  private slideWin(d: Duck) {
    d.hx = d.sdx;
    d.hy = d.sdy;
    d.noPick = 0;
    d.slide = Math.min(d.slide, TUNE.slideWinRest);
    this.take(d);
    d.hasT = 0;
  }
  /** a tackler is beaten by a skill move: he stumbles */
  private beaten(d: Duck) {
    d.slide = 0;
    d.tackle = 0;
    d.stagger = TUNE.stumble;
    d.lock = TUNE.stumble;
    d.noPick = TUNE.stumble;
    d.vx *= 0.3;
    d.vy *= 0.3;
  }
  /** during a person's slide: turn it towards the ball by at most slideTurn rad/s while the ball is close ahead */
  private slideHome(d: Duck, dt: number) {
    const b = this.ball;
    if (b.z > 0.6 || (b.owner >= 0 && this.ducks[b.owner].team === d.team)) return;
    const tx = b.x - d.x;
    const ty = b.y - d.y;
    const dist = hyp(tx, ty);
    if (dist < 0.25 || dist > 2.6) return;
    const cos = (tx * d.sdx + ty * d.sdy) / dist;
    if (cos < 0.25) return;
    const cross = d.sdx * ty - d.sdy * tx;
    const want = Math.acos(clamp(cos, -1, 1)) * Math.sign(cross);
    const turn = clamp(want, -TUNE.slideTurn * dt, TUNE.slideTurn * dt);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    [d.sdx, d.sdy] = [d.sdx * c - d.sdy * sn, d.sdx * sn + d.sdy * c];
  }
  /** a person's slide: if the ball (a carrier or a loose ball) is just ahead, bend the slide to meet it */
  slideAim(d: Duck, dx: number, dy: number): [number, number] {
    const b = this.ball;
    const m = hyp(dx, dy) || 1;
    dx /= m;
    dy /= m;
    const o = b.owner >= 0 ? this.ducks[b.owner] : null;
    // where the ball will be when the slide gets there
    const lead = 0.18;
    // (a carried ball: at his feet, between his body and the ball)
    const tx = (o ? o.x + o.hx * 0.3 + o.vx * lead : b.x + b.vx * lead) - d.x;
    const ty = (o ? o.y + o.hy * 0.3 + o.vy * lead : b.y + b.vy * lead) - d.y;
    const dist = hyp(tx, ty);
    if (dist < 0.3 || dist > TUNE.slideAssistR || b.z > 0.6) return [dx, dy];
    const cos = (tx * dx + ty * dy) / dist;
    if (cos < TUNE.slideAssistCos) return [dx, dy];
    return [tx / dist, ty / dist];
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
  /** where the ball sits relative to its owner's boot: tight at a jog (and in a skill move), knocked on ahead at a
   *  sprint, touch after touch; in the keeper's hands */
  private footSpot(o: Duck): [number, number] {
    const b = this.ball;
    const dd = b.held ? 0.3 : o.trick > 0 ? 0.35 : o.sprinting
      ? TUNE.sprintTouchMin + (TUNE.sprintTouchMax - TUNE.sprintTouchMin) * (0.5 - 0.5 * Math.cos(o.touch * Math.PI * 4))
      : TUNE.dribbleDist;
    return [o.x + o.hx * dd, o.y + o.hy * dd];
  }
  /** put the owned ball exactly at the boot (taking it, the keeper's hands, skill moves, set pieces) */
  private glue() {
    const b = this.ball;
    const o = this.ducks[b.owner];
    const [tx, ty] = this.footSpot(o);
    b.x = clamp(tx, -HALF_L + BALL_R + 0.05, HALF_L - BALL_R - 0.05);
    b.y = clamp(ty, -HALF_W + BALL_R, HALF_W - BALL_R);
    b.z = b.held ? 0.7 : 0;
    b.vx = o.vx;
    b.vy = o.vy;
    b.vz = 0;
  }

  // ------------------------------------------------------------------ ball
  private moveBall(dt: number) {
    const b = this.ball;
    // the ball is always a simulated body: a dribbler steers its velocity towards his boot (it keeps its own
    // position and collides with the boards and posts like a loose ball); only hands and set pieces hold it
    let dribble: Duck | null = null;
    if (b.owner >= 0) {
      const o = this.ducks[b.owner];
      if (b.held || o.trick > 0 || this.stage !== "play") return this.glue();
      const [tx, ty] = this.footSpot(o);
      // (handed over by a set piece far from his boot: placed there, not flung across)
      if (hyp(b.x - tx, b.y - ty) > TUNE.dribbleLose) return this.glue();
      dribble = o;
      let cx = (tx - b.x) * TUNE.dribbleSpring;
      let cy = (ty - b.y) * TUNE.dribbleSpring;
      const cm = hyp(cx, cy);
      if (cm > 9) {
        cx *= 9 / cm;
        cy *= 9 / cm;
      }
      b.vx = o.vx + cx;
      b.vy = o.vy + cy;
      b.z = 0;
      b.vz = 0;
    } else {
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
          b.vx *= TUNE.landDamp;
          b.vy *= TUNE.landDamp;
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
    if (dribble) {
      // it got away from him (stuck on a board while he ran on, a hard turn into a post): loose
      const [tx, ty] = this.footSpot(dribble);
      if (b.owner >= 0 && hyp(b.x - tx, b.y - ty) > TUNE.dribbleLose) {
        b.owner = -1;
        b.last = dribble.slot;
        b.lastTeam = dribble.team;
        b.passTo = -1;
        dribble.noPick = 0.15;
      }
      return;
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
            // can he get a hand there in time? He reacts, then dives across; a ball near the top corner needs
            // reach upwards too. The geometry decides; skill only nudges the close calls.
            const react = 0.2 - 0.08 * k.skill;
            const diveV = 3.4 + 1.6 * k.skill;
            const reachY = TUNE.keeperReach + clamp(tt - react, 0, 0.45) * diveV;
            const zAt = Math.max(0, b.z + b.vz * tt - 0.5 * TUNE.gravity * tt * tt);
            const need = Math.abs(dy) + Math.max(0, zAt - 1.7) * 0.9;
            const margin = reachY - need;
            const p = clamp(0.45 + margin * 0.45 + (k.skill - 0.55) * 0.3, 0.03, 0.95);
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
          o.trick = 0;
          this.ev(FbEvent.Tackle, d.slot);
          // from the front / side: a clean slide, the slider comes away with it and is straight back on his feet
          // (no limbo with the ball rolling off and the control jumping to somebody else). From behind it only
          // pokes the ball loose ahead of him, and he is up quickly to chase it.
          const om = hyp(o.hx, o.hy) || 1;
          if ((d.sdx * o.hx + d.sdy * o.hy) / om < 0.35) this.slideWin(d);
          else {
            b.vx = d.sdx * 4.5 + d.vx * 0.2;
            b.vy = d.sdy * 4.5 + d.vy * 0.2;
            b.last = d.slot;
            b.lastTeam = d.team;
            b.kick++;
            d.noPick = 0;
            d.slide = Math.min(d.slide, TUNE.slideWinRest);
          }
        }
      } else if (b.owner < 0 && b.z < 0.5 && hyp(b.x - d.x, b.y - d.y) < TUNE.slideReach * 0.9 && d.noPick <= 0) {
        if (hyp(b.vx - d.vx, b.vy - d.vy) > 16) {
          // a hard shot / pass slid into: it deflects off the boot
          b.vx = d.sdx * 6 + d.vx * 0.2;
          b.vy = d.sdy * 6 + d.vy * 0.2;
          b.last = d.slot;
          b.lastTeam = d.team;
          b.passTo = -1;
          b.shot = false;
          b.kick++;
          d.noPick = 0.25;
        } else this.slideWin(d);
        this.ev(FbEvent.Tackle, d.slot);
      }
    }
    if (b.owner >= 0) {
      // standing tackles: a defender at the ball commits to one (seen coming), then gets it only if his boot reaches
      // it during the contact window; never a silent dice roll at the carrier's feet
      if (b.held) return;
      const o = this.ducks[b.owner];
      for (const d of this.ducks) {
        if (d.team === o.team || d.gk) continue;
        if (d.tackle > 0) {
          if (d.tackle > TUNE.tackleHit) continue;
          const fx = d.x + d.tdx * 0.45;
          const fy = d.y + d.tdy * 0.45;
          if (hyp(b.x - fx, b.y - fy) > TUNE.tackleReach) continue;
          d.tackle = 0;
          d.tackleCd = TUNE.tackleCd;
          if (o.trick > 0 || (d.tOnPerson && o.hx * d.tox + o.hy * d.toy < TUNE.dodgeCos)) {
            // he goes for it and the skill move (or a sharp turn away) takes the ball away from him
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
          if (this.rng() < (this.isHuman(d) ? 0.6 : 0.45 + 0.25 * d.skill)) this.take(d);
          else d.noPick = 0.1;
          return;
        }
        if (o.hasT < TUNE.pokeGrace || d.fall > 0 || d.slide > 0 || d.noPick > 0 || d.lock > 0 || d.tackleCd > 0 || d.kickT > 0) continue;
        const bd = hyp(b.x - d.x, b.y - d.y);
        if (bd > TUNE.tackleStart) continue;
        let go: boolean;
        const onPerson = !!this.ctrlBy[o.slot] && !this.ctrlBy[d.slot];
        if (this.ctrlBy[d.slot]) go = bd < TUNE.pokeR;
        else if (onPerson) {
          // a person's carrier: never from behind (his back to the defender shields the ball, running or standing),
          // never a dice roll at his feet: the defender has to be in front or at his side
          const ox = d.x - o.x;
          const oy = d.y - o.y;
          const om = hyp(ox, oy) || 1;
          const front = (ox * o.hx + oy * o.hy) / om;
          if (front < -0.25) continue;
          const block = bd < TUNE.duckR + BALL_R + 0.2 ? 1.8 : 1;
          const exposed = o.sprinting ? TUNE.sprintPokeFactor : 1;
          go = this.rng() < TUNE.pokeRate * TUNE.aiRateVsPerson[this.level] * (0.5 + d.skill) * block * exposed * dt;
        } else {
          // dribbling straight into a duck's feet invites the tackle; a sprinting carrier is exposed; one running
          // away from a defender behind him keeps his body between them
          const block = bd < TUNE.duckR + BALL_R + 0.2 ? TUNE.blockFactor : 1;
          const exposed = o.sprinting ? TUNE.sprintPokeFactor : 1;
          const osp = hyp(o.vx, o.vy);
          const behind = osp > 1.5 && ((d.x - o.x) * o.vx + (d.y - o.y) * o.vy) / osp < -0.1;
          const shield = behind ? TUNE.shieldFactor : 1;
          go = this.rng() < TUNE.pokeRate * (0.5 + d.skill) * block * exposed * shield * dt;
        }
        if (go) {
          // he aims where the ball will be when his boot gets there (against a person he reads only half of the run:
          // keep going and it still reaches you, turn and it misses)
          const wind = onPerson ? TUNE.aiWindVsPerson[this.level] : TUNE.tackleWind;
          const lead = onPerson ? wind * 0.5 : wind;
          const ax = b.x + b.vx * lead - d.x;
          const ay = b.y + b.vy * lead - d.y;
          const am = hyp(ax, ay) || 1;
          d.tdx = ax / am;
          d.tdy = ay / am;
          d.tox = o.hx;
          d.toy = o.hy;
          d.tOnPerson = onPerson;
          d.tackle = wind + TUNE.tackleHit;
          d.hx = d.tdx;
          d.hy = d.tdy;
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
    // a loose ball on the grass never goes through a duck: off a body that can't take it (just kicked it, down,
    // sliding past) it bounces away
    if (b.z < 0.9) {
      for (const d of this.ducks) {
        if (!(d.noPick > 0 || d.fall > 0 || d.slide > 0) || (d.slot === b.last && this.time - b.kickAt < 0.25)) continue;
        const dx = b.x - d.x;
        const dy = b.y - d.y;
        const dist = hyp(dx, dy);
        const R = TUNE.duckR * 0.8 + BALL_R;
        if (dist >= R || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const vn = (b.vx - d.vx) * nx + (b.vy - d.vy) * ny;
        if (vn < 0) {
          b.vx -= 1.45 * vn * nx;
          b.vy -= 1.45 * vn * ny;
          b.spinT = 0;
        }
        b.x = clamp(d.x + nx * R, -HALF_L - PITCH.goalDepth + BALL_R, HALF_L + PITCH.goalDepth - BALL_R);
        b.y = clamp(d.y + ny * R, -HALF_W + BALL_R, HALF_W - BALL_R);
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
      if (dist >= r) continue;
      // a ball just played past an opponent standing beside / behind it (pressing the passer) is gone: only one it
      // is actually heading at can block it in that first moment (before, a pass with a defender at your side was
      // "taken" on the very frame it left the boot: it looked like the pass went straight to him)
      if (!d.gk && b.lastTeam >= 0 && d.team !== b.lastTeam && this.time - b.kickAt < TUNE.cutReact && (d.x - b.x) * b.vx + (d.y - b.y) * b.vy <= 0) continue;
      if (!d.gk && b.lastTeam >= 0 && d.team !== b.lastTeam && dist > TUNE.duckR + BALL_R) {
        // an opponent the ball goes past (not into his body): just after the kick he has no time to react; a
        // quick ball beside him gets cut out only sometimes (decided once per kick)
        if (this.time - b.kickAt < TUNE.cutReact) continue;
        if (d.cutKick !== b.kick) {
          d.cutKick = b.kick;
          const rel = hyp(b.vx - d.vx, b.vy - d.vy);
          // (a computer duck cutting out a person's team's pass: less often on easy / normal)
          const vsPerson = !this.ctrlBy[d.slot] && this.teamHasPerson(b.lastTeam as FbTeam) ? [0.6, 0.8, 1][this.level] : 1;
          d.cutOk = this.rng() < clamp(1.2 - rel / 11, 0.12, 0.92) * (0.75 + 0.35 * d.skill) * vsPerson;
        }
        if (!d.cutOk) continue;
      }
      if (dist < bd) {
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
    if (d.tackle > 0) return d.tackle > TUNE.tackleHit ? FbAction.Lean : FbAction.Tackle;
    if (d.stagger > 0) return FbAction.Stagger;
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
      let pt: Record<string, number> | undefined;
      for (const q of this.people.values()) if (q.active && q.aim >= 0 && this.ball.owner === q.ctrl) (pt ??= {})[q.pid] = q.aim;
      if (pt) f.pt = pt;
    }
    return f;
  }
}
