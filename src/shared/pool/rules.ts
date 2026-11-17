import { POCKETS, V_MAX, cueSpeed, settle, simulate, type SimResult } from "./physics";
import { TABLE, type PoolBall, type PoolShot, type PoolTable } from "./types";

/** بلياردو البط rules: the rack, where the white may go when it is in hand, what a shot does to the table
 *  (owner's rule: most balls potted wins) and the computer's shot. */

const { length: L, width: W, r: R, headX, footX } = TABLE;
const HL = L / 2;
const HW = W / 2;
const arn = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mm = (v: number) => Math.round(v * 1000) / 1000;

/** How long a player has for a shot before the turn passes. */
export const TURN_MS = 40_000;
/** Where the white sits by default when it is in hand. */
export const HAND_SPOT = { x: headX - 0.22, y: 0 };
/** the "kitchen" (behind the head string) the white can be placed in */
export const KITCHEN = { x0: -HL + R + 0.004, x1: headX, y0: -HW + R + 0.004, y1: HW - R - 0.004 };

/** The triangle: 1 at the front, 8 in the middle, a solid and a stripe in the back corners. */
const RACK_ORDER = [[1], [9, 2], [10, 8, 3], [11, 7, 14, 4], [5, 13, 15, 6, 12]];

export function rack(rnd = Math.random): PoolBall[] {
  const balls: PoolBall[] = [{ n: 0, x: HAND_SPOT.x, y: HAND_SPOT.y, in: false }];
  const gap = 2 * R + 0.0009;
  RACK_ORDER.forEach((row, k) => {
    row.forEach((n, j) => {
      // a hair of randomness so no two breaks are the same
      const jx = (rnd() - 0.5) * 0.0004;
      const jy = (rnd() - 0.5) * 0.0004;
      balls.push({ n, x: mm(footX + k * gap * Math.cos(Math.PI / 6) + jx), y: mm((j - k / 2) * gap + jy), in: false });
    });
  });
  settle(balls);
  return balls;
}

export function newTable(order: string[], rnd = Math.random): PoolTable {
  return { balls: rack(rnd), shooter: order[0] ?? "", order: [...order], inHand: true, potted: Object.fromEntries(order.map((id) => [id, []])), shots: 0 };
}

export const ballsLeft = (t: PoolTable) => t.balls.filter((b) => b.n !== 0 && !b.in).length;
export const nextPlayer = (t: PoolTable, pid: string) => {
  const i = t.order.indexOf(pid);
  return t.order[(i + 1) % Math.max(1, t.order.length)] ?? pid;
};

/** A spot is free for the white: on the cloth and not touching another ball. */
export function freeAt(balls: PoolBall[], x: number, y: number) {
  return balls.every((b) => b.in || b.n === 0 || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.0006) ** 2);
}
export const inKitchen = (x: number, y: number) => x >= KITCHEN.x0 - 1e-6 && x <= KITCHEN.x1 + 1e-6 && y >= KITCHEN.y0 - 1e-6 && y <= KITCHEN.y1 + 1e-6;

/** Clamp a placement into the kitchen and slide it off other balls. */
export function placeWhite(balls: PoolBall[], want?: { x: number; y: number } | null) {
  let x = Number.isFinite(want?.x) ? clamp(want!.x, KITCHEN.x0, KITCHEN.x1) : HAND_SPOT.x;
  let y = Number.isFinite(want?.y) ? clamp(want!.y, KITCHEN.y0, KITCHEN.y1) : HAND_SPOT.y;
  x = mm(x);
  y = mm(y);
  if (freeAt(balls, x, y)) return { x, y };
  // nearest free spot on a growing ring
  for (let rad = 0.01; rad < 1.2; rad += 0.01)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = mm(x + Math.cos(a) * rad);
      const py = mm(y + Math.sin(a) * rad);
      if (inKitchen(px, py) && freeAt(balls, px, py)) return { x: px, y: py };
    }
  return { x: HAND_SPOT.x, y: HAND_SPOT.y };
}

/** Make anything a phone sent into a safe shot (NaN, strings, missing fields, out of range). */
export function cleanShot(raw: unknown): PoolShot {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : d);
  let aim = num(o.aim) % (Math.PI * 2);
  if (aim < 0) aim += Math.PI * 2;
  const shot: PoolShot = { aim, power: clamp(num(o.power, 0.5), 0, 1), spin: clamp(num(o.spin), -1, 1), start: clamp(num(o.start), -1, 1) };
  const p = o.place as Record<string, unknown> | undefined;
  if (p && typeof p === "object") {
    const x = num(p.x, NaN);
    const y = num(p.y, NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) shot.place = { x, y };
  }
  return shot;
}

/** The balls as they are when the shot is struck (the white placed when it was in hand). */
export function ballsForShot(t: PoolTable, shot: PoolShot): PoolBall[] {
  const balls = t.balls.map((b) => ({ ...b }));
  let cue = balls.find((b) => b.n === 0);
  if (!cue) {
    cue = { n: 0, x: HAND_SPOT.x, y: HAND_SPOT.y, in: false };
    balls.unshift(cue);
  }
  if (t.inHand || cue.in) {
    const p = placeWhite(balls, t.inHand ? shot.place ?? { x: cue.x, y: cue.y } : null);
    cue.x = p.x;
    cue.y = p.y;
    cue.in = false;
  }
  return balls;
}

export interface ShotOutcome {
  table: PoolTable;
  potted: number[];
  scratch: boolean;
  /** the same player shoots again */
  again: boolean;
  label: string;
}

/** Apply a simulated shot to the table (owner's rules). Balls potted together with the white still count. */
export function applyShot(t: PoolTable, pid: string, res: SimResult): ShotOutcome {
  const potted = res.fell.filter((n) => n !== 0);
  const scratch = res.fell.includes(0);
  const table: PoolTable = {
    ...t,
    balls: res.balls.map((b) => ({ ...b })),
    potted: { ...t.potted, [pid]: [...(t.potted[pid] ?? []), ...potted] },
    shots: t.shots + 1,
  };
  const left = ballsLeft(table);
  const again = potted.length > 0 && !scratch && left > 0;
  let label: string;
  if (scratch) label = potted.length ? `البيضا طاحت! بس انحسبت لك ${arn(potted.length)}` : "البيضا طاحت!";
  else if (potted.length === 1) label = "دخلت!";
  else if (potted.length > 1) label = `دخلت ${arn(potted.length)}!`;
  else if (res.firstHit === null) label = "ما لمست ولا كرة";
  else label = "ما دخلت";
  table.last = label;
  table.inHand = scratch;
  if (!again) table.shooter = nextPlayer(t, pid);
  if (scratch) {
    // the white comes back to the next player's hand: shown at the hand spot until they place it
    const cue = table.balls.find((b) => b.n === 0)!;
    const p = placeWhite(table.balls, HAND_SPOT);
    cue.x = p.x;
    cue.y = p.y;
    cue.in = false;
  }
  return { table, potted, scratch, again, label };
}

/** The clock ran out (or the host skipped): the turn passes; the white stays where it is (still in hand if it was). */
export function passTurn(t: PoolTable, pid: string): PoolTable {
  return { ...t, shooter: nextPlayer(t, pid), last: "خلص الوقت" };
}

// ------------------------------------------------------------------ the computer

/** Where to send an object ball so it drops: just inside each pocket. */
const AIM_POINTS = POCKETS.map((p) => (p.corner ? { x: Math.sign(p.x) * (HL + 0.004), y: Math.sign(p.y) * (HW + 0.004), corner: true } : { x: 0, y: Math.sign(p.y) * (HW + 0.02), corner: false }));

/** distance from point p to segment a-b */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey || 1e-12;
  const t = clamp(((px - ax) * ex + (py - ay) * ey) / l2, 0, 1);
  return Math.hypot(px - ax - ex * t, py - ay - ey * t);
}
const clear = (balls: PoolBall[], ax: number, ay: number, bx: number, by: number, skip: number[], gap = 2 * R - 0.001) =>
  balls.every((b) => b.in || skip.includes(b.n) || segDist(b.x, b.y, ax, ay, bx, by) >= gap);

interface Plan {
  cx: number;
  cy: number;
  aim: number;
  power: number;
  score: number;
}

/** Every pot the white at (cx, cy) has a clear line to, scored (higher = easier). */
function pots(balls: PoolBall[], cx: number, cy: number): Plan[] {
  const out: Plan[] = [];
  for (const b of balls) {
    if (b.in || b.n === 0) continue;
    for (const P of AIM_POINTS) {
      let dx = P.x - b.x;
      let dy = P.y - b.y;
      const d2 = Math.hypot(dx, dy);
      if (d2 < 1e-6) continue;
      dx /= d2;
      dy /= d2;
      // the ball must come into the pocket's mouth at a sensible angle
      if (P.corner) {
        const ax = Math.sign(P.x) / Math.SQRT2;
        const ay = Math.sign(P.y) / Math.SQRT2;
        if (dx * ax + dy * ay < Math.cos((52 * Math.PI) / 180)) continue;
      } else if (dy * Math.sign(P.y) < Math.cos((50 * Math.PI) / 180)) continue;
      const gx = b.x - dx * 2 * R;
      const gy = b.y - dy * 2 * R;
      if (Math.abs(gx) > HL - R + 0.002 || Math.abs(gy) > HW - R + 0.002) continue;
      let ux = gx - cx;
      let uy = gy - cy;
      const d1 = Math.hypot(ux, uy);
      if (d1 < 0.01) continue;
      ux /= d1;
      uy /= d1;
      const cut = ux * dx + uy * dy;
      if (cut < 0.26) continue;
      if (!clear(balls, cx, cy, gx, gy, [0, b.n])) continue;
      if (!clear(balls, b.x, b.y, P.x, P.y, [0, b.n])) continue;
      // speeds: the object ball must reach the pocket with some pace left; the white loses some on the way
      const vOb = Math.sqrt(2 * 0.85 * d2) + 0.55;
      const vHit = vOb / Math.max(0.3, cut) / 0.965;
      const v0 = Math.sqrt(vHit * vHit + 2 * 0.9 * d1);
      const power = clamp((v0 - 0.25) / (V_MAX - 0.25), 0.1, 0.92);
      const score = (cut * cut * (P.corner ? 1 : 0.8)) / ((0.25 + d1) * (0.25 + d2));
      out.push({ cx, cy, aim: Math.atan2(uy, ux), power, score });
    }
  }
  return out;
}

const gauss = (rnd: () => number) => {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

/** The computer's shot. `skill` 0..1 (0.55 – 0.9 in play): how precise the aim and pace are. */
export function botShot(t: PoolTable, skill: number, rnd = Math.random): PoolShot {
  const balls = t.balls.map((b) => ({ ...b }));
  const cue = balls.find((b) => b.n === 0) ?? { n: 0, x: HAND_SPOT.x, y: HAND_SPOT.y, in: false };
  const on = balls.filter((b) => !b.in && b.n !== 0);
  const sigma = 0.002 + (1 - clamp(skill, 0, 1)) * 0.028;
  const noisy = (s: PoolShot): PoolShot => ({
    ...s,
    aim: s.aim + gauss(rnd) * sigma,
    power: clamp(s.power * (1 + gauss(rnd) * (1 - skill) * 0.12), 0.05, 1),
  });

  // the break: from the hand spot area straight into the 1
  if (t.shots === 0 && on.length === 15 && t.inHand) {
    const apex = on.reduce((a, b) => (b.x < a.x ? b : a));
    const place = placeWhite(balls, { x: headX - 0.2, y: (rnd() - 0.5) * 0.25 });
    return noisy({ aim: Math.atan2(apex.y - place.y, apex.x - place.x), power: 0.9 + rnd() * 0.1, spin: 0, start: -0.15, place });
  }

  // where the white could be
  const spots: { x: number; y: number }[] = [];
  if (t.inHand) {
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 7; j++) {
        const x = KITCHEN.x0 + 0.02 + ((KITCHEN.x1 - KITCHEN.x0 - 0.04) * i) / 4;
        const y = KITCHEN.y0 + 0.02 + ((KITCHEN.y1 - KITCHEN.y0 - 0.04) * j) / 6;
        if (freeAt(balls, x, y)) spots.push({ x: mm(x), y: mm(y) });
      }
    if (!spots.length) spots.push(placeWhite(balls, HAND_SPOT));
  } else spots.push({ x: cue.x, y: cue.y });

  let plans: Plan[] = [];
  for (const s of spots) plans.push(...pots(balls, s.x, s.y));
  plans.sort((a, b) => b.score - a.score);
  // with the white in hand many spots give the same pot: keep the variety
  plans = plans.slice(0, 7);

  if (plans.length) {
    // try the best few for real (no aiming error): prefer one that pots and keeps the white on the table
    let best: { shot: PoolShot; v: number } | null = null;
    for (const p of plans) {
      for (const start of [0.25, -0.45, 0]) {
        const shot: PoolShot = { aim: p.aim, power: p.power, spin: 0, start, ...(t.inHand ? { place: { x: p.cx, y: p.cy } } : {}) };
        const res = simulate(ballsForShot(t, shot), shot, false);
        const potted = res.fell.filter((n) => n !== 0).length;
        const scratch = res.fell.includes(0);
        const v = potted * 2 - (scratch ? 3 : 0) + p.score * 0.05 + (res.firstHit === null ? -1 : 0);
        if (!best || v > best.v) best = { shot, v };
      }
    }
    if (best) return noisy(best.shot);
  }

  // nothing to pot: at least hit the closest ball we can see, firmly
  const from = spots[0];
  const seen = on
    .filter((b) => clear(balls, from.x, from.y, b.x, b.y, [0, b.n]))
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  const tgt = seen[0] ?? on[0];
  const aim = tgt ? Math.atan2(tgt.y - from.y, tgt.x - from.x) : rnd() * Math.PI * 2;
  return noisy({ aim, power: 0.45 + rnd() * 0.2, spin: 0, start: 0, ...(t.inHand ? { place: from } : {}) });
}

/** For the HUD / tests: the speed of a shot in m/s. */
export const shotSpeed = (s: PoolShot) => cueSpeed(s.power);
