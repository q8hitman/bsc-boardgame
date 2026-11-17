import type { Replay } from "../sports/types";
import { TABLE, type PoolBall, type PoolShot } from "./types";

/** Pool ball physics, 2D on the cloth (the server runs it; the screens only play the replay back).
 *
 *  Each ball has its velocity `v` and its "roll velocity" `u` (= ω × r on the cloth: what its spin would carry it
 *  at if it rolled without slipping). While v ≠ u the ball slides and cloth friction pulls them together (a solid
 *  sphere ends up rolling at (5v + 2u) / 7); then it rolls and slows down. That one idea gives stun, follow and
 *  draw for free: on a full hit the cue ball hands its speed to the object ball but keeps its spin, which then
 *  drags it forward (follow) or back (draw). Side spin (`z`) only bends the bounce off a cushion a little.
 *
 *  Cushions are line segments (the rails between the pockets plus the angled pocket jaws), so a ball can rattle
 *  in the jaws. A ball falls once its centre goes past the pocket's drop line.
 *
 *  Replay (sampled every 1/30 s, metres rounded to the mm):
 *  - `bodies[n]` for n = 0..15 (0 = the white): [x, y, x, y, ...] per sample. It stops when that ball stops
 *    (hold the last sample). A ball that never moved has one sample. A potted ball's last sample is its pocket.
 *  - `bodies[16]`: events, 5 numbers each: [frame, kind, a, b, strength]; kind 1 = two balls hit (a, b),
 *    2 = cushion (a), 3 = pocket (a = ball, b = pocket index), 4 = the cue hits the white (strength = power).
 *    strength = speed in m/s (power 0..1 for kind 4).
 *  - `ball` is unused (empty).
 */

const { length: L, width: W, r: R } = TABLE;
const HL = L / 2;
const HW = W / 2;
const G = 9.81;
/** sliding friction (cloth) */
const MU_S = 0.2;
/** rolling: constant + speed-proportional drag (keeps shots snappy) */
const ROLL_A = 0.2;
const ROLL_K = 0.3;
/** restitution */
const E_BALL = 0.93;
const E_CUSHION = 0.76;
/** tangential grip of a cushion */
const CUSHION_GRIP = 0.12;
/** how much side spin turns into sideways speed off a cushion */
const ENGLISH = 0.32;
const FPS = 30;
const MAX_T = 14;
/** the white's speed for a full-power shot (m/s) */
export const V_MAX = 6.4;
export const cueSpeed = (power: number) => 0.25 + Math.max(0, Math.min(1, power)) * (V_MAX - 0.25);

/** Pocket centres (where a falling ball disappears): 0..2 along y = -W/2 (x = -, 0, +), 3..5 along y = +W/2. */
const CORNER_OUT = 0.026;
const SIDE_OUT = 0.042;
export const POCKETS: { x: number; y: number; corner: boolean }[] = [
  { x: -HL - CORNER_OUT, y: -HW - CORNER_OUT, corner: true },
  { x: 0, y: -HW - SIDE_OUT, corner: false },
  { x: HL + CORNER_OUT, y: -HW - CORNER_OUT, corner: true },
  { x: -HL - CORNER_OUT, y: HW + CORNER_OUT, corner: true },
  { x: 0, y: HW + SIDE_OUT, corner: false },
  { x: HL + CORNER_OUT, y: HW + CORNER_OUT, corner: true },
];

/** Where a rail stops next to a pocket: corner mouth along each rail, half the side mouth. */
export const CORNER_CUT = (TABLE.corner * 2) / Math.SQRT2;
export const SIDE_CUT = TABLE.side;

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The cushion noses (rails) and the pocket jaws, as segments. Also used by the view to build the cushions. */
export const CUSHIONS: { rails: Seg[]; jaws: Seg[] } = (() => {
  const c = CORNER_CUT;
  const s = SIDE_CUT;
  const rails: Seg[] = [];
  const jaws: Seg[] = [];
  const J = 0.07; // jaw length
  for (const sy of [-1, 1]) {
    // long rails, split by the side pocket
    rails.push({ ax: -HL + c, ay: sy * HW, bx: -s, by: sy * HW });
    rails.push({ ax: s, ay: sy * HW, bx: HL - c, by: sy * HW });
    // side pocket jaws: narrow a little going in
    jaws.push({ ax: -s, ay: sy * HW, bx: -s + 0.016, by: sy * (HW + J * 0.8) });
    jaws.push({ ax: s, ay: sy * HW, bx: s - 0.016, by: sy * (HW + J * 0.8) });
  }
  for (const sx of [-1, 1]) rails.push({ ax: sx * HL, ay: -HW + c, bx: sx * HL, by: HW - c });
  // corner jaws: roughly along the pocket's diagonal, slightly closing
  const a = (Math.PI / 4) * 0.82;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      // on the long rail (y = sy*HW), going outwards
      jaws.push({ ax: sx * (HL - c), ay: sy * HW, bx: sx * (HL - c + J * Math.cos(a)), by: sy * (HW + J * Math.sin(a)) });
      // on the short rail (x = sx*HL)
      jaws.push({ ax: sx * HL, ay: sy * (HW - c), bx: sx * (HL + J * Math.sin(a)), by: sy * (HW - c + J * Math.cos(a)) });
    }
  return { rails, jaws };
})();
const SEGS = [...CUSHIONS.rails, ...CUSHIONS.jaws];

/** Which pocket a ball at (x, y) has fallen into, or -1. */
export function fallenInto(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const sx = x < 0 ? -1 : 1;
  const sy = y < 0 ? -1 : 1;
  const top = sy > 0 ? 3 : 0;
  // corners: past the line through the corner point, across the pocket's diagonal
  if (ax > HL - 0.3 && ay > HW - 0.3 && (ax - HL + (ay - HW)) / Math.SQRT2 > -0.012) return top + (sx < 0 ? 0 : 2);
  // sides: past the rail line
  if (ax < 0.15 && ay > HW + 0.01) return top + 1;
  // anywhere else past a rail can only be in a pocket's throat (safety net)
  if (ay > HW + 0.02 || ax > HL + 0.02) {
    let best = 0;
    let bd = Infinity;
    POCKETS.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  return -1;
}

export interface SimResult {
  replay: Replay;
  /** the balls afterwards (potted ones `in: true`, left where they were) */
  balls: PoolBall[];
  /** balls that fell, in order (0 = the white) */
  fell: number[];
  /** the first ball the white touched (null = it hit nothing) */
  firstHit: number | null;
  /** how long the replay lasts (ms) */
  ms: number;
}

interface Body {
  n: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ux: number;
  uy: number;
  z: number;
  on: boolean;
  moving: boolean;
  track: number[];
}

const mm = (v: number) => Math.round(v * 1000) / 1000;
const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

/** Play one shot. `balls` must contain the white (n 0) on the table; `shot` is assumed clean (see rules.cleanShot).
 *  `record` = false skips the replay (the computer uses it to try shots). */
export function simulate(balls: PoolBall[], shot: PoolShot, record = true): SimResult {
  const bodies: Body[] = balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, ux: 0, uy: 0, z: 0, on: !b.in, moving: false, track: [] }));
  const events: number[] = [];
  const fell: number[] = [];
  let firstHit: number | null = null;
  const cue = bodies.find((b) => b.n === 0 && b.on);
  const v0 = cueSpeed(shot.power);
  if (cue) {
    const dx = Math.cos(fin(shot.aim));
    const dy = Math.sin(fin(shot.aim));
    cue.vx = dx * v0;
    cue.vy = dy * v0;
    // follow / draw: cue tip up to half a radius above / below centre → ω = 5/2 · v · h / R
    const k = 1.25 * Math.max(-1, Math.min(1, fin(shot.start)));
    cue.ux = dx * v0 * k;
    cue.uy = dy * v0 * k;
    // side spin (right english = clockwise seen from above = negative z)
    cue.z = -Math.max(-1, Math.min(1, fin(shot.spin))) * v0 * 0.9;
    cue.moving = true;
    events.push(0, 4, 0, 0, mm(Math.max(0, Math.min(1, shot.power))));
  }
  const live = () => bodies.filter((b) => b.on);
  const sample = (frame: number) => {
    if (!record) return;
    for (const b of bodies) if (b.on) b.track.push(mm(b.x), mm(b.y));
    void frame;
  };
  sample(0);

  const frameDt = 1 / FPS;
  let frame = 0;
  let t = 0;
  while (t < MAX_T) {
    const on = live();
    let vmax = 0;
    for (const b of on) vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
    if (!on.some((b) => b.moving)) break;
    const steps = Math.max(3, Math.min(60, Math.ceil((vmax * frameDt) / (R * 0.22))));
    const h = frameDt / steps;
    for (let s = 0; s < steps; s++) {
      step(on, h, frame, events, (n) => {
        if (firstHit === null) firstHit = n;
      });
      // pockets
      for (const b of on) {
        if (!b.on) continue;
        const p = fallenInto(b.x, b.y);
        if (p >= 0) {
          b.on = false;
          b.moving = false;
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = b.vy = b.ux = b.uy = b.z = 0;
          fell.push(b.n);
          events.push(frame + 1, 3, b.n, p, mm(sp));
          if (record) b.track.push(mm(POCKETS[p].x), mm(POCKETS[p].y));
          b.x = POCKETS[p].x;
          b.y = POCKETS[p].y;
        }
      }
    }
    t += frameDt;
    frame++;
    sample(frame);
  }
  // anything still rolling at the time limit just stops where it is; a ball left hanging over a pocket drops
  for (const b of bodies) {
    b.vx = b.vy = b.ux = b.uy = b.z = 0;
    if (b.on && (Math.abs(b.x) > HL || Math.abs(b.y) > HW)) {
      let p = 0;
      POCKETS.forEach((q, i) => {
        if ((q.x - b.x) ** 2 + (q.y - b.y) ** 2 < (POCKETS[p].x - b.x) ** 2 + (POCKETS[p].y - b.y) ** 2) p = i;
      });
      b.on = false;
      fell.push(b.n);
      events.push(frame, 3, b.n, p, 0.2);
      if (record) b.track.push(mm(POCKETS[p].x), mm(POCKETS[p].y));
      b.x = POCKETS[p].x;
      b.y = POCKETS[p].y;
    }
  }
  const out: PoolBall[] = bodies.map((b) => ({ n: b.n, x: b.x, y: b.y, in: !b.on }));
  // no two balls may touch after rounding to the mm
  settle(out.filter((b) => !b.in));

  let replay: Replay = { dt: frameDt, ball: [] };
  let frames = 1;
  if (record) {
    const tracks: number[][] = [];
    const ordered = [...bodies].sort((a, b) => a.n - b.n);
    for (const b of ordered) {
      const tr = b.track;
      // the settled final position replaces the last sample (tiny nudges from `settle`)
      const fb = out.find((o) => o.n === b.n)!;
      if (!fb.in && tr.length >= 2) {
        tr[tr.length - 2] = fb.x;
        tr[tr.length - 1] = fb.y;
      }
      // trim the tail where it no longer moves
      let end = tr.length / 2;
      while (end > 1 && tr[(end - 1) * 2] === tr[(end - 2) * 2] && tr[(end - 1) * 2 + 1] === tr[(end - 2) * 2 + 1]) end--;
      const cut = tr.slice(0, end * 2);
      frames = Math.max(frames, end);
      tracks[b.n] = cut;
    }
    for (let n = 0; n < 16; n++) if (!tracks[n]) tracks[n] = [];
    tracks[16] = events;
    replay = { dt: frameDt, ball: [], bodies: tracks };
  } else frames = frame + 1;
  return { replay, balls: out, fell, firstHit, ms: Math.round(frames * frameDt * 1000) };
}

/** One small step: friction, move, cushions, ball–ball. */
function step(on: Body[], h: number, frame: number, events: number[], hitByCue: (n: number) => void) {
  for (const b of on) {
    if (!b.moving) continue;
    const sx = b.vx - b.ux;
    const sy = b.vy - b.uy;
    const slip = Math.hypot(sx, sy);
    if (slip > 1e-4) {
      // sliding: friction pulls v and u together (v loses μg, u gains 5/2 μg)
      const d = MU_S * G * h;
      if (slip <= 3.5 * d) {
        const rx = (5 * b.vx + 2 * b.ux) / 7;
        const ry = (5 * b.vy + 2 * b.uy) / 7;
        b.vx = b.ux = rx;
        b.vy = b.uy = ry;
      } else {
        const nx = sx / slip;
        const ny = sy / slip;
        b.vx -= nx * d;
        b.vy -= ny * d;
        b.ux += nx * d * 2.5;
        b.uy += ny * d * 2.5;
      }
    } else {
      const sp = Math.hypot(b.vx, b.vy);
      const dec = (ROLL_A + ROLL_K * sp) * h;
      if (sp <= dec) {
        b.vx = b.vy = b.ux = b.uy = 0;
      } else {
        const k = (sp - dec) / sp;
        b.vx *= k;
        b.vy *= k;
        b.ux = b.vx;
        b.uy = b.vy;
      }
    }
    // side spin dies off on the cloth
    b.z *= Math.exp(-2.2 * h);
    if (Math.abs(b.z) < 1e-3) b.z = 0;
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (b.vx === 0 && b.vy === 0 && b.ux === 0 && b.uy === 0) {
      b.moving = false;
      b.z = 0;
    }
  }
  // cushions (only near the edges)
  for (const b of on) {
    if (!b.moving) continue;
    if (Math.abs(b.x) < HL - R - 0.002 && Math.abs(b.y) < HW - R - 0.002) continue;
    for (const s of SEGS) {
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const l2 = ex * ex + ey * ey;
      let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + ex * t;
      const qy = s.ay + ey * t;
      let dx = b.x - qx;
      let dy = b.y - qy;
      const d = Math.hypot(dx, dy);
      if (d >= R || d < 1e-9) continue;
      dx /= d;
      dy /= d;
      const vn = b.vx * dx + b.vy * dy;
      // push out to touching
      b.x = qx + dx * R;
      b.y = qy + dy * R;
      if (vn >= 0) continue;
      // bounce: normal reversed with loss, a little grip on the tangent, side spin bends it
      const tx = -dy;
      const ty = dx;
      const vt = b.vx * tx + b.vy * ty;
      const vtNew = vt * (1 - CUSHION_GRIP) + b.z * ENGLISH * Math.min(1, -vn / 0.8);
      const vnNew = -vn * E_CUSHION;
      b.vx = dx * vnNew + tx * vtNew;
      b.vy = dy * vnNew + ty * vtNew;
      b.z *= 0.45;
      // the roll loses its push into the cushion
      const un = b.ux * dx + b.uy * dy;
      const ut = b.ux * tx + b.uy * ty;
      const unNew = un < 0 ? -un * 0.2 : un;
      b.ux = dx * unNew + tx * ut;
      b.uy = dy * unNew + ty * ut;
      if (-vn > 0.04) events.push(frame + 1, 2, b.n, 0, mm(-vn));
    }
  }
  // ball against ball
  for (let i = 0; i < on.length; i++) {
    const a = on[i];
    if (!a.on) continue;
    for (let j = i + 1; j < on.length; j++) {
      const b = on[j];
      if (!b.on || (!a.moving && !b.moving)) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      if (Math.abs(dx) > 2 * R || Math.abs(dy) > 2 * R) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-9) {
        dx = 1;
        dy = 0;
        d = 1;
      } else {
        dx /= d;
        dy /= d;
      }
      const vrel = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;
      // separate
      const push = (2 * R - (d2 < 1e-18 ? 0 : d)) / 2;
      a.x -= dx * push;
      a.y -= dy * push;
      b.x += dx * push;
      b.y += dy * push;
      if (vrel <= 0) continue;
      const jn = ((1 + E_BALL) / 2) * vrel;
      a.vx -= dx * jn;
      a.vy -= dy * jn;
      b.vx += dx * jn;
      b.vy += dy * jn;
      a.moving = b.moving = true;
      if (a.n === 0) hitByCue(b.n);
      else if (b.n === 0) hitByCue(a.n);
      if (vrel > 0.03) events.push(frame + 1, 1, a.n, b.n, mm(vrel));
    }
  }
}

/** Make sure no two resting balls overlap and none is off the cloth; rounds to the mm. */
export function settle(list: { x: number; y: number }[]) {
  const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (const b of list) {
      const nx = mm(lim(b.x, HL - 0.001));
      const ny = mm(lim(b.y, HW - 0.001));
      if (nx !== b.x || ny !== b.y) moved = true;
      b.x = nx;
      b.y = ny;
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const need = 2 * R + 0.0002;
        if (d >= need) continue;
        if (d < 1e-9) {
          dx = 1;
          dy = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        const p = (need - d) / 2 + 0.0006;
        a.x -= dx * p;
        a.y -= dy * p;
        b.x += dx * p;
        b.y += dy * p;
        moved = true;
      }
    if (!moved) break;
  }
}

/** A ball centre is a legal resting place: on the cloth, not inside a cushion (with a pocket mouth allowance). */
export function onCloth(x: number, y: number) {
  return Math.abs(x) <= HL && Math.abs(y) <= HW && fallenInto(x, y) < 0;
}

/** Cast the aim: where the white (at x, y) going in direction `aim` first touches a ball or a cushion.
 *  Returns the white's centre at contact, the ball hit (or -1) and the cushion normal when it hits a rail. */
export function castAim(balls: PoolBall[], x: number, y: number, aim: number) {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  let best = 4;
  let hit = -1;
  for (const b of balls) {
    if (b.in || b.n === 0) continue;
    // ray vs circle of radius 2R around the ball
    const ox = x - b.x;
    const oy = y - b.y;
    const bq = ox * dx + oy * dy;
    const c = ox * ox + oy * oy - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 1e-6 && t < best) {
      best = t;
      hit = b.n;
    }
  }
  // cushions: the ray of the white's centre against segments pushed in by R (approximate with the nose lines)
  let nx = 0;
  let ny = 0;
  for (const s of SEGS) {
    // offset the segment towards the table by R
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const len = Math.hypot(ex, ey);
    let px = -ey / len;
    let py = ex / len;
    // the normal pointing to the table centre
    if (px * -(s.ax + s.bx) / 2 + py * -(s.ay + s.by) / 2 < 0) {
      px = -px;
      py = -py;
    }
    const ax = s.ax + px * R;
    const ay = s.ay + py * R;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - x) * ey - (ay - y) * ex) / den;
    const u = ((ax - x) * dy - (ay - y) * dx) / den;
    if (t > 1e-6 && t < best && u >= -0.02 && u <= 1.02) {
      best = t;
      hit = -1;
      nx = px;
      ny = py;
    }
  }
  return { x: x + dx * best, y: y + dy * best, ball: hit, t: best, nx, ny };
}
