import type { SportRules } from "./index";
import type { Replay, Shot } from "./types";

/** سلة البط (Duck Hoops): 3 rounds × 5 shots, everyone on their own hoop at the same time.
 *
 *  World (metres, one player's own hoop): the rim centre rests at (0, RIM_Y, 0), the backboard is behind it (−z) and
 *  the shooter stands in front (+z). Round 1 close and straight, round 2 farther from an angle, round 3 from far away
 *  while the hoop slides side to side along x.
 *
 *  Shot (from the phone):
 *  - `aim`: radians, 0 = straight at the hoop's resting spot, + = to the shooter's right.
 *  - `power`: 0..1 (flick speed). Each spot has its own sweet spot (`HOOP_SPOTS[r].power`).
 *  - `start`: round 3 only: the sliding hoop's phase when the ball left the hand, as phase/π (−1..1), so the server
 *    plays the hoop exactly where the phone showed it. Ignored in rounds 1–2.
 *  - `spin`: unused.
 *
 *  Replay: `ball` = ball centre per sample (30 fps). `bodies[0]` = the hoop's x per sample (empty when it stands
 *  still), `bodies[1]` = events, flat triples [sample, type, value]: 1 rim hit (value = impact speed × 100),
 *  2 backboard, 3 floor bounce, 4 through the net (value = points), 5 result (value = points, sample = last). */

export const HOOP_SHOTS = 5;
export const BALL_R = 0.12;
/** rim tube centre radius and tube thickness */
export const RIM_R = 0.235;
export const RIM_TUBE = 0.011;
export const RIM_Y = 3.05;
/** backboard box (relative to the hoop's x): front face, back face, width, bottom, top */
export const BOARD = { front: -0.385, back: -0.425, half: 0.9, bottom: 2.9, top: 3.95 };
/** round 3's sliding hoop: x = A·sin(π·start + ω·t) */
export const SLIDE_A = 0.55;
export const SLIDE_W = (2 * Math.PI) / 5.5;

export interface HoopSpot {
  /** distance from the spot to the hoop on the floor */
  dist: number;
  /** angle of the spot around the hoop (radians, + = the shooter stands to the hoop's right side as seen from the court) */
  angle: number;
  /** launch elevation */
  launch: number;
  /** the flick power that drops it dead centre */
  power: number;
  moving: boolean;
  name: string;
}

export const HOOP_SPOTS: HoopSpot[] = [
  { dist: 3.4, angle: 0, launch: (62 * Math.PI) / 180, power: 0.42, moving: false, name: "قريبة" },
  { dist: 5.0, angle: (24 * Math.PI) / 180, launch: (58 * Math.PI) / 180, power: 0.57, moving: false, name: "من الزاوية" },
  { dist: 6.75, angle: 0, launch: (55 * Math.PI) / 180, power: 0.7, moving: true, name: "السلة تتحرك!" },
];

export interface HoopsShot {
  /** points scored (fire bonus included), 0 = miss */
  pts: number;
  /** 0 air/board miss, 1 rimmed out, 2 in off the rim/board, 3 swish */
  kind: number;
  /** taken while on fire (makes count double) */
  fire: boolean;
}

/** One player's hoop. JSON only. */
export interface HoopsLane {
  round: number;
  /** per round, per shot */
  shots: HoopsShot[][];
  /** makes in a row (carries across rounds) */
  streak: number;
  /** on fire: 3 makes in a row, makes count double until a miss */
  fire: boolean;
  /** longest streak this game */
  best: number;
}

const G = 9.81;
const STEP = 1 / 240;
const PER_SAMPLE = 8; // 30 fps
const MAX_T = 2.5;

type V3 = [number, number, number];

/** Where the shooter stands and where the ball leaves the hand, in the hoop's frame. `dir` points from the spot to
 *  the hoop on the floor, `right` is the shooter's right. */
export function hoopSpot(round: number) {
  const sp = HOOP_SPOTS[Math.max(0, Math.min(HOOP_SPOTS.length - 1, round))];
  const spot: V3 = [Math.sin(sp.angle) * sp.dist, 0, Math.cos(sp.angle) * sp.dist];
  const dir: V3 = [-Math.sin(sp.angle), 0, -Math.cos(sp.angle)];
  const right: V3 = [-dir[2], 0, dir[0]];
  const release: V3 = [spot[0] + dir[0] * 0.3, 2.0, spot[2] + dir[2] * 0.3];
  /** floor distance from the release point to the rim centre */
  const reach = sp.dist - 0.3;
  return { ...sp, spot, dir, right, release, reach };
}

/** The hoop's x offset at time `t` (s) after release, for a shot with phase `start` (−1..1). 0 when not sliding. */
export function hoopX(round: number, start: number, t: number) {
  if (!HOOP_SPOTS[round]?.moving) return 0;
  return SLIDE_A * Math.sin(Math.PI * start + SLIDE_W * t);
}
const hoopV = (round: number, start: number, t: number) =>
  HOOP_SPOTS[round]?.moving ? SLIDE_A * SLIDE_W * Math.cos(Math.PI * start + SLIDE_W * t) : 0;

/** Distance error (m, along the shot) for a power error: gentle near the sweet spot, then quickly a big miss. */
function depthError(e: number) {
  return 2.0 * e + Math.sign(e) * Math.max(0, Math.abs(e) - 0.12) * 5;
}
/** Aim assist: an aim error (radians, against the perfect aim) becomes a sideways miss at the hoop. The same angle
 *  window at every distance (a far hoop is smaller on the screen), then quickly a full miss. */
function sideError(e: number, reach: number) {
  const a = Math.abs(e);
  return Math.sign(e) * (a <= 0.25 ? a * 1.4 : 0.35 + (a - 0.25) * Math.max(1.4, reach));
}

/** Launch speed so the ball passes through a point `x` metres away (floor distance) and `h` metres higher. */
function launchSpeed(x: number, h: number, th: number) {
  const den = 2 * Math.cos(th) ** 2 * (x * Math.tan(th) - h);
  return Math.sqrt((G * x * x) / Math.max(1e-3, den));
}

/** Where the ball is aimed (at rim height) and its launch velocity, for a shot. Shared with the views' prediction. */
export function hoopsLaunch(round: number, shot: Shot) {
  const sp = hoopSpot(round);
  const start = sp.moving ? Math.max(-1, Math.min(1, shot.start || 0)) : 0;
  const h = RIM_Y - sp.release[1];
  const delta = depthError(shot.power - sp.power);
  const aim = Math.max(-1.2, Math.min(1.2, shot.aim || 0));
  let tArr = 1;
  let target: V3 = [0, RIM_Y, 0];
  let v: V3 = [0, 0, 0];
  for (let it = 0; it < 4; it++) {
    const hx = hoopX(round, start, tArr);
    const along = hx * sp.dir[0];
    const side = hx * sp.right[0];
    const depth = Math.max(1.0, sp.reach + along + delta);
    const ideal = Math.atan2(side, sp.reach);
    const lateral = side + sideError(aim - ideal, sp.reach);
    target = [sp.release[0] + sp.dir[0] * depth + sp.right[0] * lateral, RIM_Y, sp.release[2] + sp.dir[2] * depth + sp.right[2] * lateral];
    const dx = target[0] - sp.release[0];
    const dz = target[2] - sp.release[2];
    const x = Math.max(1.0, Math.hypot(dx, dz));
    const speed = launchSpeed(x, h, sp.launch);
    const vh = speed * Math.cos(sp.launch);
    v = [(dx / x) * vh, speed * Math.sin(sp.launch), (dz / x) * vh];
    tArr = x / vh;
  }
  return { start, target, v, tArr, release: sp.release };
}

/** The perfect shot from this round's spot (the hoop phase matters in round 3). */
export function hoopsIdeal(round: number, start = 0): Shot {
  const sp = hoopSpot(round);
  const { tArr } = hoopsLaunch(round, { aim: 0, power: sp.power, spin: 0, start });
  return { aim: Math.atan2(hoopX(round, start, tArr) * sp.right[0], sp.reach), power: sp.power, spin: 0, start };
}

const mm = (x: number) => Math.round(x * 1000) / 1000;

export interface HoopsResult {
  made: boolean;
  /** 0 air/board miss, 1 rimmed out, 2 in off the rim/board, 3 swish */
  kind: number;
  rimHits: number;
  boardHits: number;
  ball: number[];
  hoop: number[];
  events: number[];
  ms: number;
}

/** The physics: fixed time step, deterministic. */
export function simulateHoops(round: number, shot: Shot): HoopsResult {
  const sp = hoopSpot(round);
  const L = hoopsLaunch(round, shot);
  const p: V3 = [...L.release];
  const v: V3 = [...L.v];
  const ball: number[] = [];
  const hoop: number[] = [];
  const events: number[] = [];
  let made = false;
  let rimHits = 0;
  let boardHits = 0;
  let tMade = -1;
  let tFloor = -1;
  let lastRim = -1;
  let lastBoard = -1;
  let step = 0;
  let t = 0;
  const sample = () => Math.round(step / PER_SAMPLE);
  const record = () => {
    ball.push(mm(p[0]), mm(p[1]), mm(p[2]));
    if (sp.moving) hoop.push(mm(hoopX(round, L.start, t)));
  };
  record();
  for (;;) {
    step++;
    t = step * STEP;
    const hx = hoopX(round, L.start, t);
    const hv = hoopV(round, L.start, t);
    const prevY = p[1];
    v[1] -= G * STEP;
    p[0] += v[0] * STEP;
    p[1] += v[1] * STEP;
    p[2] += v[2] * STEP;

    // rim: a circle of tube centres; the ball touches the nearest point of it
    {
      const dx = p[0] - hx;
      const dz = p[2];
      const rho = Math.hypot(dx, dz) || 1e-6;
      const c: V3 = [hx + (dx / rho) * RIM_R, RIM_Y, (dz / rho) * RIM_R];
      const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      const min = BALL_R + RIM_TUBE;
      if (dist < min && dist > 1e-9) {
        const n: V3 = [d[0] / dist, d[1] / dist, d[2] / dist];
        p[0] += n[0] * (min - dist);
        p[1] += n[1] * (min - dist);
        p[2] += n[2] * (min - dist);
        const rel: V3 = [v[0] - hv, v[1], v[2]];
        const vn = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
        if (vn < 0) {
          const e = 0.58;
          const tx = rel[0] - vn * n[0];
          const ty = rel[1] - vn * n[1];
          const tz = rel[2] - vn * n[2];
          const f = 0.82;
          v[0] = tx * f - e * vn * n[0] + hv;
          v[1] = ty * f - e * vn * n[1];
          v[2] = tz * f - e * vn * n[2];
          if (-vn > 0.35 && t - lastRim > 0.08) {
            rimHits++;
            events.push(sample(), 1, Math.round(-vn * 100));
          }
          lastRim = t;
        }
      }
    }
    // backboard: a box
    {
      const qx = Math.max(hx - BOARD.half, Math.min(hx + BOARD.half, p[0]));
      const qy = Math.max(BOARD.bottom, Math.min(BOARD.top, p[1]));
      const qz = Math.max(BOARD.back, Math.min(BOARD.front, p[2]));
      const d: V3 = [p[0] - qx, p[1] - qy, p[2] - qz];
      let dist = Math.hypot(d[0], d[1], d[2]);
      if (dist < BALL_R) {
        let n: V3;
        if (dist < 1e-9) {
          n = [0, 0, 1];
          dist = 0;
        } else n = [d[0] / dist, d[1] / dist, d[2] / dist];
        p[0] += n[0] * (BALL_R - dist);
        p[1] += n[1] * (BALL_R - dist);
        p[2] += n[2] * (BALL_R - dist);
        const rel: V3 = [v[0] - hv, v[1], v[2]];
        const vn = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
        if (vn < 0) {
          const e = 0.62;
          const f = 0.9;
          v[0] = (rel[0] - vn * n[0]) * f - e * vn * n[0] + hv;
          v[1] = (rel[1] - vn * n[1]) * f - e * vn * n[1];
          v[2] = (rel[2] - vn * n[2]) * f - e * vn * n[2];
          if (t - lastBoard > 0.08) {
            boardHits++;
            events.push(sample(), 2, Math.round(-vn * 100));
          }
          lastBoard = t;
        }
      }
    }
    // through the hoop: the centre crosses the rim plane downwards inside the ring
    const ox = p[0] - hx;
    const oz = p[2];
    const rho = Math.hypot(ox, oz);
    if (!made && prevY >= RIM_Y && p[1] < RIM_Y && v[1] < 0 && rho < RIM_R - RIM_TUBE) {
      made = true;
      tMade = t;
    }
    // the net catches the ball and slows it down
    if (made && p[1] < RIM_Y && p[1] > RIM_Y - 0.48 && rho < RIM_R + 0.02) {
      const k = Math.min(1, 7 * STEP);
      v[0] += (hv - v[0]) * k - ox * 10 * STEP;
      v[2] += -v[2] * k - oz * 10 * STEP;
      if (v[1] < -2.4) v[1] += (-2.4 - v[1]) * Math.min(1, 9 * STEP);
    }
    // floor
    if (p[1] < BALL_R) {
      p[1] = BALL_R;
      if (v[1] < 0) {
        if (v[1] < -0.9) events.push(sample(), 3, Math.round(-v[1] * 100));
        v[1] = -v[1] * 0.68;
        v[0] *= 0.86;
        v[2] *= 0.86;
        if (tFloor < 0) tFloor = t;
      }
    }
    if (step % PER_SAMPLE !== 0) continue;
    record();
    const done = made ? t >= tMade + 0.8 : tFloor >= 0 ? t >= Math.max(tFloor + 0.45, 1.3) : false;
    if (done || t >= MAX_T - 1e-9) break;
  }
  const kind = made ? (rimHits + boardHits === 0 ? 3 : 2) : rimHits > 0 ? 1 : 0;
  const n = ball.length / 3;
  return { made, kind, rimHits, boardHits, ball, hoop, events, ms: Math.round((n - 1) * STEP * PER_SAMPLE * 1000) };
}

export const HOOPS: SportRules<HoopsLane> = {
  id: "hoops",
  name: "سلة البط",
  sub: "رميات سلة، الكل يرمي بنفس الوقت",
  better: "high",
  rounds: () => 3,
  roundSeconds: 40,
  startRound(round, prev) {
    const shots = (prev?.shots ?? []).map((r) => r.map((x) => ({ ...x })));
    while (shots.length <= round) shots.push([]);
    return { round, shots, streak: prev?.streak ?? 0, fire: prev?.fire ?? false, best: prev?.best ?? 0 };
  },
  canShoot: (l) => (l.shots[l.round]?.length ?? 0) < HOOP_SHOTS,
  forfeit(l) {
    const shots = l.shots.map((r) => [...r]);
    const r = (shots[l.round] ??= []);
    while (r.length < HOOP_SHOTS) r.push({ pts: 0, kind: 0, fire: false });
    return { ...l, shots, streak: 0, fire: false };
  },
  shoot(l, shot, round) {
    const r = Math.max(0, Math.min(HOOP_SPOTS.length - 1, l.round ?? round));
    const sim = simulateHoops(r, shot);
    const shots = l.shots.map((x) => x.map((y) => ({ ...y })));
    while (shots.length <= r) shots.push([]);
    const base = sim.kind === 3 ? 3 : sim.kind === 2 ? 2 : 0;
    const wasFire = l.fire;
    const pts = wasFire ? base * 2 : base;
    shots[r].push({ pts, kind: sim.kind, fire: wasFire });
    const streak = sim.made ? l.streak + 1 : 0;
    const fire = sim.made && (wasFire || streak >= 3);
    const ignite = fire && !wasFire;
    const label = !sim.made
      ? sim.kind === 1 ? "طلعت!" : "طاح!"
      : ignite ? "نار!"
      : `${sim.kind === 3 ? "سويش!" : sim.boardHits && !sim.rimHits ? "بالزجاج!" : "دخلت!"}${wasFire ? " ×٢" : ""}`;
    const last = sim.ball.length / 3 - 1;
    const events = [...sim.events];
    // through the net: the first sample after the make (found from the ball path)
    if (sim.made) {
      let k = 0;
      for (let i = 1; i <= last; i++) {
        if (sim.ball[i * 3 + 1] < RIM_Y && sim.ball[(i - 1) * 3 + 1] >= RIM_Y - 0.001) k = i;
      }
      events.push(k, 4, pts);
    }
    events.push(last, 5, pts);
    const replay: Replay = { dt: (STEP * PER_SAMPLE), ball: sim.ball, bodies: [sim.hoop, events], label };
    const lane: HoopsLane = { round: r, shots, streak, fire, best: Math.max(l.best ?? 0, streak) };
    return { lane, replay, ms: sim.ms };
  },
  card(l, rounds) {
    const cards = Array.from({ length: rounds }, (_, i) => {
      const r = l.shots[i];
      return r && (r.length || i < l.round) ? r.reduce((a, b) => a + b.pts, 0) : null;
    });
    return { cards, total: cards.reduce<number>((a, b) => a + (b ?? 0), 0) };
  },
  botShot(l, round, skill) {
    const r = Math.max(0, Math.min(HOOP_SPOTS.length - 1, l?.round ?? round));
    const start = HOOP_SPOTS[r].moving ? Math.random() * 2 - 1 : 0;
    const ideal = hoopsIdeal(r, start);
    const s = Math.max(0, Math.min(1, skill));
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
    // a person: the farther, the shakier; in round 3 the lead on the moving hoop is a guess too
    const far = 1 + r * 0.1;
    const sp = (0.03 + 0.08 * (1 - s)) * far;
    const sa = (0.022 + 0.07 * (1 - s)) * far;
    return {
      aim: ideal.aim * (HOOP_SPOTS[r].moving ? 0.75 + 0.5 * Math.random() : 1) + gauss() * sa,
      power: Math.max(0, Math.min(1, ideal.power + gauss() * sp)),
      spin: 0,
      start,
    };
  },
};
