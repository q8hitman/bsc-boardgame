import type { SportRules } from "./index";
import type { Replay, Shot } from "./types";

/* Bowling: 5 frames of real ten-pin scoring, everyone on their own lane at the same time.
 *
 * Physics runs here (server, or in-page in one-device mode) and is pure + deterministic: the same lane and shot
 * always give the same replay. Units are metres and seconds. Lane coordinates, seen from the bowler:
 *   x = across the lane (0 = middle, + = right), z = down the lane (0 = foul line, HEAD_Z = head pin), y = up.
 *
 * Replay format (see types.ts):
 *   ball   = [x, y, z] per sample (ball centre)
 *   bodies = one array per pin (10, rack order 1..10): [k, x, y, z, tx, tz, x, y, z, tx, tz, ...]
 *            k = index of the first stored sample (a pin is still until something hits it, so the samples before
 *            k are all the same as the first stored one); after the last stored sample the pin stays put.
 *            (x, y, z) = the pin's centre of mass, (tx, tz) = fall direction (horizontal unit vector) * tilt angle
 *            in radians (0 = upright, π/2 = lying on the deck). y < 0 at the start = pin already swept away. */

/** One player's lane (plain JSON). */
export interface BowlingLane {
  /** current frame, 0-based */
  frame: number;
  /** pins knocked down by each roll, per frame */
  rolls: number[][];
  /** which of the 10 pins (rack order 1..10) are standing right now */
  standing: boolean[];
  /** x, z of every pin (20 numbers); standing pins stay where they slid to, like on a real deck */
  pos: number[];
}

// ------------------------------------------------------------------ geometry (metres)
export const FRAMES = 5;
export const LANE_HALF = 0.527; // lane is 1.054 m wide
export const GUTTER_W = 0.235;
export const KICK_X = LANE_HALF + GUTTER_W; // kickback walls beside the pin deck
export const BALL_R = 0.108;
export const HEAD_Z = 18.29;
export const ROW = 0.2639; // 12" triangle: rows are 12·cos30° apart
export const PIT_Z = HEAD_Z + 0.868;
export const BACK_Z = PIT_Z + 0.75; // pit cushion / curtain
export const PIN_H = 0.381;
export const PIN_COM = 0.145; // centre of mass above the base
export const PIN_BELLY = 0.0605;
export const DECK_Z = HEAD_Z - 0.55; // where the pin deck starts (hook stops there)
const START_X = LANE_HALF - BALL_R - 0.02;

/** Rack positions, pin 1..10 (index 0..9): [x, z]. */
export const RACK: [number, number][] = [
  [0, HEAD_Z],
  [-0.1524, HEAD_Z + ROW],
  [0.1524, HEAD_Z + ROW],
  [-0.3048, HEAD_Z + 2 * ROW],
  [0, HEAD_Z + 2 * ROW],
  [0.3048, HEAD_Z + 2 * ROW],
  [-0.4572, HEAD_Z + 3 * ROW],
  [-0.1524, HEAD_Z + 3 * ROW],
  [0.1524, HEAD_Z + 3 * ROW],
  [0.4572, HEAD_Z + 3 * ROW],
];
const ADJ: [number, number][] = [
  [0, 1], [0, 2], [1, 2], [1, 3], [1, 4], [2, 4], [2, 5], [3, 4], [4, 5],
  [3, 6], [3, 7], [4, 7], [4, 8], [5, 8], [5, 9], [6, 7], [7, 8], [8, 9],
];

// ------------------------------------------------------------------ tuning
const G = 9.81;
/** Physics knobs (exported so tools can tune them; the game never changes them). */
export const TUNE = {
  BALL_M: 7.3,
  HOOK: 0.75, // lateral m/s² at full spin, in the back end
  E_BALL_PIN: 0.75,
  E_PIN_PIN: 0.72,
  E_KICK: 0.45,
  TIP: 0.17, // rad: past this a pin topples, below it it wobbles back
  GL: 52, // gravity torque / inertia (rad/s²)
  K_TILT: 9, // rad/s of tilt per m/s of impulse
  MU_STAND: 0.5,
  MU_LIE: 0.8,
  PIN_R: 0.07,
  JITTER: 0.08,
  HOP: 0.5,
};
const PIN_M = 1.55;
const BALL_DRAG = 0.22; // m/s² of slowdown down the lane
const DOWN_TILT = 0.5;
const SIM_DT = 1 / 600;
const SAMPLE_DT = 1 / 30;
const MAX_T = 4.4;

/** Ball speed (m/s) for a power 0..1: a soft roll still reaches the pins. */
export const ballSpeed = (power: number) => 5.6 + 3.4 * Math.max(0, Math.min(1, power));
export const startX = (start: number) => Math.max(-1, Math.min(1, start)) * START_X;
const clampAim = (a: number) => Math.max(-0.15, Math.min(0.15, a));
const hookRamp = (z: number) => {
  if (z >= DECK_Z) return 0;
  const t = Math.max(0, Math.min(1, (z - 4.5) / 8.5));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ scoring
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Can this frame still be rolled? (frames 1-4: 2 rolls or a strike; frame 5: bonus rolls after a strike/spare) */
function frameOpen(f: number[], last: boolean): boolean {
  if (!last) return f.length === 0 || (f.length === 1 && f[0] < 10);
  if (f.length < 2) return true;
  if (f.length === 2) return f[0] === 10 || f[0] + f[1] >= 10;
  return false;
}

/** Cumulative score after each frame (null until the frame and its bonus rolls are known) and the running total
 *  (pins + whatever bonus is already known, so the leaderboard moves during the game). */
export function scoreFrames(rolls: number[][], frames = FRAMES): { cards: (number | null)[]; total: number } {
  const flat: number[] = [];
  const firstIdx: number[] = [];
  for (let i = 0; i < frames; i++) {
    firstIdx.push(flat.length);
    flat.push(...(rolls[i] ?? []));
  }
  const cards: (number | null)[] = [];
  let run = 0;
  let total = 0;
  let broken = false;
  for (let i = 0; i < frames; i++) {
    const f = rolls[i] ?? [];
    const k = firstIdx[i];
    const last = i === frames - 1;
    let val: number;
    let known: boolean;
    if (last) {
      val = sum(f);
      known = f.length > 0 && !frameOpen(f, true);
    } else if (f[0] === 10) {
      const bonus = flat.slice(k + 1, k + 3);
      val = 10 + sum(bonus);
      known = bonus.length === 2;
    } else if (f.length === 2 && f[0] + f[1] === 10) {
      const bonus = flat.slice(k + 2, k + 3);
      val = 10 + sum(bonus);
      known = bonus.length === 1;
    } else {
      val = sum(f);
      known = f.length === 2;
    }
    total += val;
    if (!broken && known) {
      run += val;
      cards.push(run);
    } else {
      broken = true;
      cards.push(null);
    }
  }
  return { cards, total };
}

/** Text for the mini boxes of a frame: "X", "/", "-", digits (latin; the views convert). */
export function frameMarks(f: number[], last: boolean): string[] {
  const out: string[] = [];
  let rack = 0; // pins knocked on the current rack
  for (let i = 0; i < f.length; i++) {
    const n = f[i];
    const fresh = rack === 0;
    if (fresh && n === 10) {
      out.push("X");
      rack = last ? 0 : 10;
    } else if (!fresh && rack + n === 10) {
      out.push("/");
      rack = 0;
    } else {
      out.push(n === 0 ? "-" : String(n));
      rack = fresh ? n : 0;
    }
    if (!last && out.length >= 2) break;
  }
  return out;
}

// ------------------------------------------------------------------ deterministic noise
function hash(...v: number[]) {
  let h = 2166136261 >>> 0;
  for (const x of v) {
    const n = Math.round(x * 100000) | 0;
    h = Math.imul(h ^ (n & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ (n >>> 16), 16777619) >>> 0;
  }
  return h;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ ball path without pins (bots aim with it)
/** Where the ball is across the lane when it reaches `zAt` (ignores gutters and pins). */
export function ballXAt(shot: Shot, zAt: number): number {
  const v0 = ballSpeed(shot.power);
  const a = clampAim(shot.aim);
  let x = startX(shot.start);
  let z = 0;
  let vx = v0 * Math.sin(a);
  let vz = v0 * Math.cos(a);
  const dt = 1 / 240;
  for (let i = 0; i < 4000 && z < zAt; i++) {
    vx += shot.spin * TUNE.HOOK * hookRamp(z) * dt;
    vz = Math.max(2, vz - BALL_DRAG * dt);
    x += vx * dt;
    z += vz * dt;
  }
  return x;
}

// ------------------------------------------------------------------ the simulation
interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  y: number; // pins: extra height while hopping; ball: centre height
  vy: number;
  tx: number; // tilt vector (fall direction * angle)
  tz: number;
  wx: number; // tilt rate vector
  wz: number;
  yaw: number; // yaw rate (lying pins spin)
  out: boolean; // left the deck (gutter / pit)
  live: boolean; // pins: in play at all this roll
  lying: boolean;
}

const tiltOf = (b: Body) => Math.hypot(b.tx, b.tz);
const pinY = (b: Body) => {
  const t = tiltOf(b);
  return Math.max(PIN_COM * Math.cos(t) + 0.026 * Math.sin(t), PIN_BELLY) + b.y;
};

/** The pin's collision shape: a segment (along its axis, horizontal projection) and a radius. */
function pinShape(b: Body): [number, number, number, number, number] {
  const t = tiltOf(b);
  if (t < 0.02) return [b.x, b.z, b.x, b.z, TUNE.PIN_R];
  const dx = b.tx / t;
  const dz = b.tz / t;
  const s = Math.sin(Math.min(t, Math.PI / 2));
  const a0 = (-PIN_COM + 0.05) * s;
  const a1 = (PIN_H - PIN_COM - 0.09) * s;
  return [b.x + dx * a0, b.z + dz * a0, b.x + dx * a1, b.z + dz * a1, 0.06 - 0.012 * s];
}

/** Closest points between segments p1-q1 and p2-q2 (2D). Returns [s, t, distance², c1x, c1z, c2x, c2z]. */
function segSeg(p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number) {
  const d1x = q1x - p1x, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2z = q2z - p2z;
  const rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) {
    s = t = 0;
  } else if (a < 1e-9) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1z * rz;
    if (e < 1e-9) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1x * d2x + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1x = p1x + d1x * s, c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t, c2z = p2z + d2z * t;
  return [c1x, c1z, c2x, c2z, (c2x - c1x) ** 2 + (c2z - c1z) ** 2] as const;
}

export interface RollResult {
  standing: boolean[];
  pos: number[];
  knocked: number;
  gutter: boolean;
  replay: Replay;
  ms: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Roll one ball at the pins that are standing. Pure. */
export function simulateRoll(standing: boolean[], pos: number[], shot: Shot): RollResult {
  const rand = rng(hash(shot.aim, shot.power, shot.spin, shot.start, ...pos));
  const v0 = ballSpeed(shot.power);
  const aim = clampAim(shot.aim);
  const spin = Math.max(-1, Math.min(1, shot.spin));
  const ball = { x: startX(shot.start), z: 0, y: BALL_R, vx: v0 * Math.sin(aim), vz: v0 * Math.cos(aim), vy: 0, gutter: 0, pit: false };
  const pins: Body[] = RACK.map((_, i) => ({
    x: pos[i * 2] ?? RACK[i][0],
    z: pos[i * 2 + 1] ?? RACK[i][1],
    vx: 0, vz: 0, y: 0, vy: 0, tx: 0, tz: 0, wx: 0, wz: 0, yaw: 0,
    out: false, live: !!standing[i], lying: false,
  }));
  const ballS: number[] = [];
  const pinS: number[][] = pins.map(() => []);
  const sample = () => {
    ballS.push(r3(ball.x), r3(ball.y), r3(ball.z));
    pins.forEach((p, i) => {
      if (!p.live) pinS[i].push(r3(p.x), -1, r3(p.z), 0, 0); // y < 0 = not on the deck (already swept)
      else pinS[i].push(r3(p.x), r3(pinY(p)), r3(p.z), r3(p.tx), r3(p.tz));
    });
  };

  let t = 0;
  let nextSample = 0;
  let quiet = 0;
  let touched = false;
  const steps = Math.ceil(MAX_T / SIM_DT);
  for (let step = 0; step <= steps; step++) {
    if (t >= nextSample - 1e-9) {
      sample();
      nextSample += SAMPLE_DT;
    }
    const dt = SIM_DT;
    // ---- ball
    if (!ball.pit) {
      if (ball.gutter) {
        const gx = ball.gutter * (LANE_HALF + GUTTER_W / 2);
        ball.x += (gx - ball.x) * Math.min(1, dt * 14);
        ball.vx = 0;
        ball.y += (BALL_R - 0.055 - ball.y) * Math.min(1, dt * 14);
      } else {
        ball.vx += spin * TUNE.HOOK * hookRamp(ball.z) * dt;
        if (Math.abs(ball.x) > LANE_HALF && ball.z < PIT_Z) {
          ball.gutter = Math.sign(ball.x);
        }
      }
      ball.vz = Math.max(0.6, ball.vz - BALL_DRAG * dt);
      if (ball.z > PIT_Z) ball.pit = true;
    } else {
      ball.vy -= G * dt;
      ball.y = Math.max(BALL_R - 0.32, ball.y + ball.vy * dt);
      if (ball.z > BACK_Z - BALL_R) {
        ball.z = BACK_Z - BALL_R;
        ball.vz = -0.15 * Math.abs(ball.vz);
      }
      ball.vx *= 1 - 3 * dt;
      ball.vz *= 1 - 1.5 * dt;
    }
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;

    // ---- pins
    for (const p of pins) {
      if (!p.live) continue;
      let tilt = tiltOf(p);
      // gravity on the tilt: wobble back below TUNE.TIP, topple above
      if (tilt > 1e-5 && !p.lying) {
        const ux = p.tx / tilt, uz = p.tz / tilt;
        const acc = TUNE.GL * Math.sin(tilt - TUNE.TIP);
        p.wx += ux * acc * dt;
        p.wz += uz * acc * dt;
        if (tilt < TUNE.TIP) {
          const damp = Math.exp(-2.6 * dt);
          p.wx *= damp;
          p.wz *= damp;
        }
      }
      const before = Math.sin(Math.min(tilt, Math.PI / 2));
      p.tx += p.wx * dt;
      p.tz += p.wz * dt;
      tilt = tiltOf(p);
      if (tilt >= Math.PI / 2) {
        // landed on its side: bounce a little, then lie
        const ux = p.tx / tilt, uz = p.tz / tilt;
        p.tx = ux * (Math.PI / 2);
        p.tz = uz * (Math.PI / 2);
        const wr = p.wx * ux + p.wz * uz;
        if (wr > 0.6 && !p.lying) {
          p.wx = -ux * wr * 0.22;
          p.wz = -uz * wr * 0.22;
          p.yaw += (rand() - 0.5) * 3;
        } else {
          p.wx = p.wz = 0;
          p.lying = true;
        }
        tilt = Math.PI / 2;
      } else if (tilt < 0.004 && Math.hypot(p.wx, p.wz) < 0.04) {
        p.tx = p.tz = p.wx = p.wz = 0;
        tilt = 0;
      }
      // pivot on the base: the centre of mass moves along the fall direction
      if (tilt > 1e-5) {
        const after = Math.sin(tilt);
        const ux = p.tx / tilt, uz = p.tz / tilt;
        p.x += ux * PIN_COM * (after - before);
        p.z += uz * PIN_COM * (after - before);
      }
      // yaw: a lying pin spins around
      if (p.yaw && tilt > 0.6) {
        const c = Math.cos(p.yaw * dt), s = Math.sin(p.yaw * dt);
        const nx = p.tx * c - p.tz * s;
        p.tz = p.tx * s + p.tz * c;
        p.tx = nx;
        p.yaw *= Math.exp(-3.5 * dt);
      }
      // hop / flight (the floor is lower in the gutters and the pit)
      const floor = p.z > PIT_Z + 0.03 ? -0.3 : Math.abs(p.x) > LANE_HALF + 0.03 ? -0.07 : 0;
      if (p.y > floor + 1e-4 || p.vy > 0) {
        p.vy -= G * dt;
        p.y += p.vy * dt;
        if (p.y <= floor) {
          p.y = floor;
          p.vy = p.vy < -1.2 ? -p.vy * 0.3 : 0;
        }
      } else {
        p.y = floor;
        p.vy = 0;
        // floor friction
        const sp = Math.hypot(p.vx, p.vz);
        if (sp > 0) {
          const dec = (p.lying || tilt > 0.9 ? TUNE.MU_LIE : TUNE.MU_STAND) * G * dt;
          const k = Math.max(0, sp - dec) / sp;
          p.vx *= k;
          p.vz *= k;
        }
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      // kickbacks (side walls by the deck) and the pit cushion
      if (p.z > DECK_Z - 0.4) {
        if (Math.abs(p.x) > KICK_X - 0.05) {
          p.x = Math.sign(p.x) * (KICK_X - 0.05);
          if (Math.sign(p.vx) === Math.sign(p.x)) p.vx = -p.vx * TUNE.E_KICK;
          p.yaw += (rand() - 0.5) * 6;
        }
      }
      if (p.z > BACK_Z - 0.06) {
        p.z = BACK_Z - 0.06;
        if (p.vz > 0) p.vz = -p.vz * 0.25;
      }
      // off the deck: gutters, pit
      if (!p.out && p.y < 0.05 && (Math.abs(p.x) > LANE_HALF + 0.03 || p.z > PIT_Z + 0.03)) p.out = true;
    }

    // ---- collisions
    const bodies = pins;
    // ball vs pins
    if (!ball.gutter && !ball.pit) {
      for (const p of bodies) {
        if (!p.live || p.out || p.y > 0.3) continue;
        const [ax, az, bx, bz, pr] = pinShape(p);
        const [cx, cz, qx, qz, d2] = segSeg(ball.x, ball.z, ball.x, ball.z, ax, az, bx, bz);
        const rr = BALL_R + pr;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-6;
        let nx = (qx - cx) / d, nz = (qz - cz) / d;
        if (!Number.isFinite(nx)) { nx = 0; nz = 1; }
        const over = rr - d;
        const im = 1 / TUNE.BALL_M, ip = 1 / PIN_M;
        ball.x -= nx * over * (im / (im + ip));
        ball.z -= nz * over * (im / (im + ip));
        p.x += nx * over * (ip / (im + ip));
        p.z += nz * over * (ip / (im + ip));
        const vn = (p.vx - ball.vx) * nx + (p.vz - ball.vz) * nz;
        if (vn >= 0) continue;
        const j = (-(1 + TUNE.E_BALL_PIN) * vn) / (im + ip);
        ball.vx -= j * nx * im;
        ball.vz -= j * nz * im;
        hit(p, j * nx * ip, j * nz * ip, qx, qz, rand);
        touched = true;
      }
    }
    // pin vs pin
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.live) continue;
      for (let k = i + 1; k < bodies.length; k++) {
        const b = bodies[k];
        if (!b.live || a.out !== b.out || Math.abs(a.y - b.y) > 0.25) continue;
        if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.z - b.z) > 0.5) continue;
        const sa = pinShape(a), sb = pinShape(b);
        const [cx, cz, qx, qz, d2] = segSeg(sa[0], sa[1], sa[2], sa[3], sb[0], sb[1], sb[2], sb[3]);
        const rr = sa[4] + sb[4];
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-6;
        let nx = (qx - cx) / d, nz = (qz - cz) / d;
        if (!Number.isFinite(nx) || d < 1e-5) { nx = b.x - a.x; nz = b.z - a.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
        const over = rr - d;
        a.x -= nx * over * 0.5;
        a.z -= nz * over * 0.5;
        b.x += nx * over * 0.5;
        b.z += nz * over * 0.5;
        const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (vn >= 0) continue;
        // a little chaos (deterministic): real pins never hit dead centre
        const jit = (rand() - 0.5) * TUNE.JITTER;
        const jx = nx * Math.cos(jit) - nz * Math.sin(jit);
        const jz = nx * Math.sin(jit) + nz * Math.cos(jit);
        const j = (-(1 + TUNE.E_PIN_PIN) * vn) / (2 / PIN_M);
        hit(a, (-j * jx) / PIN_M, (-j * jz) / PIN_M, cx, cz, rand);
        hit(b, (j * jx) / PIN_M, (j * jz) / PIN_M, qx, qz, rand);
      }
    }

    t += dt;
    // ---- done?
    const ballDone = ball.pit ? ball.z > PIT_Z + 0.3 || ball.vz < 0.5 : false;
    const gutterDone = ball.gutter && ball.z > PIT_Z;
    const pinsQuiet = pins.every((p) => !p.live || (Math.hypot(p.vx, p.vz) < 0.04 && Math.hypot(p.wx, p.wz) < 0.08 && Math.abs(p.yaw) < 0.6 && p.vy === 0 && (p.lying || tiltOf(p) < 0.01 || p.out)));
    if ((ballDone || gutterDone) && pinsQuiet) quiet += dt;
    else quiet = 0;
    if (quiet > (touched ? 0.45 : 0.2)) break;
  }
  sample();

  // ---- result
  const outStanding: boolean[] = [];
  const outPos: number[] = [];
  let knocked = 0;
  pins.forEach((p, i) => {
    const up = p.live && !p.out && tiltOf(p) < DOWN_TILT && p.z < PIT_Z && Math.abs(p.x) < LANE_HALF;
    if (p.live && !up) knocked++;
    outStanding.push(up);
    outPos.push(up ? r3(p.x) : RACK[i][0], up ? r3(p.z) : RACK[i][1]);
    // an unsettled leaning pin that counts as up stands back up at the end of the replay
    if (up && tiltOf(p) > 0) {
      const arr = pinS[i];
      arr.splice(arr.length - 5, 5, r3(p.x), r3(PIN_COM), r3(p.z), 0, 0);
    }
  });
  // only send the part where a pin moves: drop the still start (keep one sample) and the still end
  const n = ballS.length / 3;
  const bodies = pinS.map((arr) => {
    const same = (a: number, b: number) => arr[a * 5] === arr[b * 5] && arr[a * 5 + 1] === arr[b * 5 + 1] && arr[a * 5 + 2] === arr[b * 5 + 2] && arr[a * 5 + 3] === arr[b * 5 + 3] && arr[a * 5 + 4] === arr[b * 5 + 4];
    let last = arr.length / 5 - 1;
    while (last > 0 && same(last, last - 1)) last--;
    let first = 0;
    while (first < last && same(first + 1, 0)) first++;
    return [first, ...arr.slice(first * 5, (last + 1) * 5)];
  });
  const replay: Replay = { dt: SAMPLE_DT, ball: ballS, bodies };
  return { standing: outStanding, pos: outPos, knocked, gutter: !!ball.gutter && !touched, replay, ms: Math.round((n - 1) * SAMPLE_DT * 1000) + 150 };
}

function hit(p: Body, dvx: number, dvz: number, cx: number, cz: number, rand: () => number) {
  p.vx += dvx;
  p.vz += dvz;
  const dv = Math.hypot(dvx, dvz);
  if (!p.lying) {
    p.wx += dvx * TUNE.K_TILT;
    p.wz += dvz * TUNE.K_TILT;
    if (dv > 2.0 && p.y <= 0.01 && p.vy <= 0) {
      p.vy = Math.min(2.0, (dv - 2.0) * TUNE.HOP + rand() * 0.3);
      p.y += 0.001;
    }
  }
  // off-centre hits spin the pin around
  const t = tiltOf(p);
  if (t > 0.5) {
    const ux = p.tx / t, uz = p.tz / t;
    const arm = (cx - p.x) * ux + (cz - p.z) * uz;
    p.yaw += arm * (ux * dvz - uz * dvx) * 60;
  } else p.yaw += (rand() - 0.5) * dv * 4;
}

/** Split: head pin down and the standing pins fall in 2+ separate groups. */
export function isSplit(standing: boolean[]): boolean {
  if (standing[0]) return false;
  const up = standing.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  if (up.length < 2) return false;
  const seen = new Set<number>([up[0]]);
  const stack = [up[0]];
  while (stack.length) {
    const c = stack.pop()!;
    for (const [a, b] of ADJ) {
      const o = a === c ? b : b === c ? a : -1;
      if (o >= 0 && standing[o] && !seen.has(o)) {
        seen.add(o);
        stack.push(o);
      }
    }
  }
  return seen.size < up.length;
}

const arDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
const freshRack = () => ({ standing: Array(10).fill(true) as boolean[], pos: RACK.flat() });

// ------------------------------------------------------------------ the rules
export const BOWLING: SportRules<BowlingLane> = {
  id: "bowling",
  name: "بولنق البط",
  sub: "كلكم ترمون بنفس الوقت",
  better: "high",
  rounds: () => FRAMES,
  roundSeconds: 35,

  startRound(round, prev) {
    const rolls = (prev?.rolls ?? []).map((f) => [...f]);
    while (rolls.length <= round) rolls.push([]);
    return { frame: round, rolls, ...freshRack() };
  },

  canShoot(l) {
    return frameOpen(l.rolls[l.frame] ?? [], l.frame >= FRAMES - 1);
  },

  forfeit(l) {
    const rolls = l.rolls.map((f) => [...f]);
    while (rolls.length <= l.frame) rolls.push([]);
    for (let i = 0; i < 4 && frameOpen(rolls[l.frame], l.frame >= FRAMES - 1); i++) rolls[l.frame].push(0);
    return { ...l, rolls };
  },

  shoot(l, shot) {
    const last = l.frame >= FRAMES - 1;
    const res = simulateRoll(l.standing, l.pos, shot);
    const rolls = l.rolls.map((f) => [...f]);
    while (rolls.length <= l.frame) rolls.push([]);
    const f = rolls[l.frame];
    // was the rack fresh before this roll?
    const rackFresh = l.standing.every(Boolean);
    f.push(res.knocked);
    const clear = res.standing.every((s) => !s);
    let label: string;
    if (clear && rackFresh) {
      // strike; count the streak for a bigger shout
      const flat = rolls.flat();
      let streak = 0;
      for (let i = flat.length - 1; i >= 0 && flat[i] === 10; i--) streak++;
      label = streak >= 3 ? "هاتريك!" : streak === 2 ? "دبل سترايك!" : "سترايك!";
    } else if (clear) label = "سبير!";
    else if (res.knocked === 0) label = res.gutter ? "قناة!" : "ولا وحدة!";
    else if (rackFresh && isSplit(res.standing)) label = "سبلت!";
    else label = res.knocked === 1 ? "طاحت وحدة" : `طاحت ${arDigits(res.knocked)}`;
    res.replay.label = label;
    // next state of the deck: in the last frame a cleared rack (or the 2nd ball) is set up fresh again
    const deck = clear || (!last && f.length === 2) ? freshRack() : { standing: res.standing, pos: res.pos };
    return { lane: { ...l, rolls, ...deck }, replay: res.replay, ms: res.ms };
  },

  card(l, rounds) {
    return scoreFrames(l.rolls, rounds);
  },

  botShot(l, _round, skill) {
    const sk = Math.max(0, Math.min(1, skill));
    const g = () => {
      // gaussian-ish noise
      let s = 0;
      for (let i = 0; i < 4; i++) s += Math.random();
      return (s - 2) / 0.577;
    };
    const fresh = l.standing.every(Boolean);
    let start: number;
    let spin: number;
    let tx: number;
    const power = Math.max(0.3, Math.min(1, 0.55 + Math.random() * 0.3 + g() * 0.05));
    if (fresh) {
      const style = Math.random();
      if (style < 0.6) {
        start = 0.25 + Math.random() * 0.4;
        spin = -(0.35 + Math.random() * 0.55);
        tx = 0.065;
      } else if (style < 0.85) {
        start = -0.2 + Math.random() * 0.6;
        spin = 0;
        tx = Math.random() < 0.7 ? 0.06 : -0.06;
      } else {
        start = -(0.25 + Math.random() * 0.4);
        spin = 0.35 + Math.random() * 0.55;
        tx = -0.065;
      }
    } else {
      // spare: at the front pin, leaning towards the rest of them
      const up = l.standing.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
      if (!up.length) return { aim: 0, power, spin: 0, start: 0 };
      const front = up.reduce((a, b) => (l.pos[b * 2 + 1] < l.pos[a * 2 + 1] ? b : a));
      const cx = up.reduce((a, i) => a + l.pos[i * 2], 0) / up.length;
      const fx = l.pos[front * 2];
      tx = Math.max(-LANE_HALF + 0.12, Math.min(LANE_HALF - 0.12, fx + (cx - fx) * 0.5));
      spin = (Math.random() - 0.5) * 0.3;
      start = Math.max(-0.8, Math.min(0.8, -tx * 1.2 + (Math.random() - 0.5) * 0.4));
    }
    const zT = HEAD_Z - 0.17;
    let lo = -0.12, hi = 0.12;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (ballXAt({ aim: mid, power, spin, start }, zT) < tx) lo = mid;
      else hi = mid;
    }
    const miss = 1 - sk;
    // now and then even a good bowler throws a bad one
    const wild = Math.random() < 0.04 + miss * 0.12 ? g() * 0.01 : 0;
    return {
      aim: (lo + hi) / 2 + g() * (0.0009 + miss * 0.008) + wild,
      power: Math.max(0.2, Math.min(1, power + g() * 0.04 * (0.5 + miss))),
      spin: Math.max(-1, Math.min(1, spin + g() * (0.03 + miss * 0.12))),
      start: Math.max(-1, Math.min(1, start + g() * 0.04)),
    };
  },
};
