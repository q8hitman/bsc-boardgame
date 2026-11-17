import type { SportRules } from "./index";
import type { Replay, Shot } from "./types";
import { COURSES, courseOf, type Hole, type P } from "./golf-courses";

export { COURSES, courseOf } from "./golf-courses";
export type { Hole, Course, Theme, P } from "./golf-courses";

/** One player's ball (plain JSON, in SportState.lanes). */
export interface GolfBall {
  /** hole index (= round) */
  hole: number;
  /** strokes per hole (the current hole counts live; penalties included) */
  strokes: number[];
  x: number;
  z: number;
  holed: boolean;
  /** holed, or out of strokes: nothing more to do on this hole */
  done: boolean;
}

// ------------------------------------------------------------------ constants
export const BALL_R = 0.085;
export const CUP_R = 0.17;
export const MAX_STROKES = 6;
const DT = 1 / 120;
const SAMPLE_EVERY = 4; // 30 fps replay
const G = 7; // 5/7 g: a rolling ball on a slope
const V_MAX = 9;
const powerToSpeed = (p: number) => 0.4 + 7.2 * Math.max(0, Math.min(1, p));

// ------------------------------------------------------------------ geometry helpers
export function holeOf(course: string | undefined, round: number): Hole {
  const c = courseOf(course);
  return c.holes[Math.max(0, Math.min(c.holes.length - 1, round))];
}

export function inPoly(x: number, z: number, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** closest point on segment a-b to p, as [qx, qz, t] */
function closest(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number, number] {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, az + dz * t, t];
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Ground height at (x, z). Slopes, dunes, the volcano rim, the DNA half-pipe, and a soft dip around the cup. */
export function heightAt(h: Hole, x: number, z: number): number {
  let y = 0;
  if (h.humps)
    for (const m of h.humps) {
      const dx = x - m.x, dz = z - m.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (m.ring) {
        let k = m.h;
        if (m.notch !== undefined) {
          let da = Math.atan2(dz, dx) - m.notch;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          k *= 1 - 0.85 * Math.exp(-(da * da) / (0.38 * 0.38));
        }
        const q = (d - m.ring) / m.r;
        y += k * Math.exp(-q * q);
      } else {
        const q = d / m.r;
        y += m.h * Math.exp(-q * q);
      }
    }
  if (h.ramps)
    for (const r of h.ramps) {
      const ax = r.b[0] - r.a[0], az = r.b[1] - r.a[1];
      const len = Math.sqrt(ax * ax + az * az);
      const ux = ax / len, uz = az / len;
      const along = ((x - r.a[0]) * ux + (z - r.a[1]) * uz) / len;
      const lat = Math.abs(-(x - r.a[0]) * uz + (z - r.a[1]) * ux);
      const side = 1 - smooth((lat - r.w) / 0.4);
      y += r.h * smooth(along) * side;
    }
  if (h.valleys)
    for (const v of h.valleys) {
      const cx = v.x0 + v.amp * Math.sin((2 * Math.PI * (z - v.z0)) / v.period);
      const dx = x - cx;
      y += Math.min(v.max, v.k * dx * dx * 1.0);
    }
  // every cup sits in a gentle funnel: near misses curl in
  const cx = x - h.cup[0], cz = z - h.cup[1];
  y -= 0.028 * Math.exp(-(cx * cx + cz * cz) / (0.42 * 0.42));
  return y;
}

/** Wall segments (outline minus open edges, plus obstacle polygons) as flat [ax, az, bx, bz, ...]. Cached. */
interface Cache { walls: number[]; dist?: { x0: number; z0: number; cell: number; nx: number; nz: number; d: Float64Array } }
const cache = new WeakMap<Hole, Cache>();
function cached(h: Hole): Cache {
  let c = cache.get(h);
  if (!c) {
    const walls: number[] = [];
    const n = h.outline.length;
    for (let i = 0; i < n; i++) {
      if (h.open?.includes(i)) continue;
      const a = h.outline[i], b = h.outline[(i + 1) % n];
      walls.push(a[0], a[1], b[0], b[1]);
    }
    for (const bl of h.blocks ?? [])
      for (let i = 0; i < bl.pts.length; i++) {
        const a = bl.pts[i], b = bl.pts[(i + 1) % bl.pts.length];
        walls.push(a[0], a[1], b[0], b[1]);
      }
    c = { walls };
    cache.set(h, c);
  }
  return c;
}
export const wallsOf = (h: Hole) => cached(h).walls;

export function onBridge(h: Hole, x: number, z: number): boolean {
  for (const b of h.bridges ?? []) {
    const [qx, qz, t] = closest(x, z, b.a[0], b.a[1], b.b[0], b.b[1]);
    if (t > 0 && t < 1 && Math.hypot(x - qx, z - qz) <= b.w) return true;
  }
  return false;
}

/** what the ball is rolling on */
export function surfaceAt(h: Hole, x: number, z: number): "green" | "sand" | "water" | "bridge" {
  if (onBridge(h, x, z)) return "bridge";
  if (!inPoly(x, z, h.outline)) return "water";
  for (const w of h.water ?? []) if (inPoly(x, z, w)) return "water";
  for (const s of h.sand ?? []) if (inPoly(x, z, s)) return "sand";
  return "green";
}

// ------------------------------------------------------------------ the simulation
export interface SimResult {
  x: number;
  z: number;
  holed: boolean;
  water: boolean;
  /** replay samples [x, y, z, ...] at 30 fps */
  ball: number[];
  /** escaped the walls (should never happen; tests check it) */
  escaped: boolean;
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

/** Rolls a ball from (x0, z0) with the given aim and power. Deterministic, fixed step. */
export function simulate(h: Hole, x0: number, z0: number, aim: number, power: number, record = true): SimResult {
  const walls = wallsOf(h);
  const posts = h.posts ?? [];
  const pipes = h.pipes ?? [];
  const tubes = h.tubes ?? [];
  const R = BALL_R;
  let x = x0, z = z0;
  const v0 = powerToSpeed(power);
  let vx = Math.cos(aim) * v0, vz = Math.sin(aim) * v0;
  const ball: number[] = [];
  const push = (px: number, py: number, pz: number) => {
    if (record) ball.push(mm(px), mm(py), mm(pz));
  };
  push(x, heightAt(h, x, z) + R, z);
  let holed = false, water = false, escaped = false;
  let step = 0;
  const maxSteps = Math.round(5.2 / DT);
  const eps = 0.01;
  let tubeLock = 0;
  let curSurf = surfaceAt(h, x, z);

  while (step < maxSteps) {
    step++;
    const t = step * DT;
    // forces: slope + rolling resistance (higher in sand, ramps up late so every shot ends within ~5 s)
    const h0 = heightAt(h, x, z);
    const hx = (heightAt(h, x + eps, z) - h0) / eps;
    const hz = (heightAt(h, x, z + eps) - h0) / eps;
    const ax = -G * hx, az = -G * hz;
    const surf = curSurf;
    const sp0 = Math.hypot(vx, vz);
    const sand = surf === "sand";
    let fr = sand ? 4.2 + 1.6 * sp0 : 0.9 + 0.28 * sp0;
    if (t > 3.6) fr += (t - 3.6) * 7;
    vx += ax * DT;
    vz += az * DT;
    const sp = Math.hypot(vx, vz);
    const slopeA = Math.hypot(ax, az);
    if (sp > 1e-9) {
      const ns = Math.max(0, sp - fr * DT);
      vx *= ns / sp;
      vz *= ns / sp;
    }
    // at rest? (a steep slope keeps it rolling)
    const still = Math.hypot(vx, vz) < 0.035 && (slopeA < (sand ? 5 : 1.5) || t > 4.8);
    if (still) {
      vx = vz = 0;
      break;
    }
    if (sp > V_MAX) {
      vx *= V_MAX / sp;
      vz *= V_MAX / sp;
    }
    x += vx * DT;
    z += vz * DT;

    // walls (thin segments; the ball moves < R per step so it never tunnels)
    for (let i = 0; i < walls.length; i += 4) {
      const wax = walls[i], waz = walls[i + 1], wdx = walls[i + 2] - wax, wdz = walls[i + 3] - waz;
      // quick reject: farther than R from the segment's bounding box
      if (x < Math.min(wax, wax + wdx) - R || x > Math.max(wax, wax + wdx) + R || z < Math.min(waz, waz + wdz) - R || z > Math.max(waz, waz + wdz) + R) continue;
      const l2 = wdx * wdx + wdz * wdz;
      let tt = l2 > 0 ? ((x - wax) * wdx + (z - waz) * wdz) / l2 : 0;
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const qx = wax + wdx * tt, qz = waz + wdz * tt;
      const dx = x - qx, dz = z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, nz = dz / d;
        x = qx + nx * R;
        z = qz + nz * R;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          const tx = vx - vn * nx, tz = vz - vn * nz;
          vx = tx * 0.96 - vn * 0.72 * nx;
          vz = tz * 0.96 - vn * 0.72 * nz;
        }
      }
    }
    for (const p of posts) {
      const dx = x - p.x, dz = z - p.z;
      const rr = R + p.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, nz = dz / d;
        x = p.x + nx * rr;
        z = p.z + nz * rr;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          const e = p.bounce ?? 0.62;
          const tx = vx - vn * nx, tz = vz - vn * nz;
          const out = p.bounce ? Math.max(-vn * e, 1.3) : -vn * e;
          vx = tx * 0.95 + out * nx;
          vz = tz * 0.95 + out * nz;
        }
      }
    }
    for (const p of pipes) {
      const [qx, qz] = closest(x, z, p.a[0], p.a[1], p.b[0], p.b[1]);
      const dx = x - qx, dz = z - qz;
      const rr = R + p.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, nz = dz / d;
        x = qx + nx * rr;
        z = qz + nz * rr;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          const tx = vx - vn * nx, tz = vz - vn * nz;
          vx = tx * 0.96 - vn * 0.7 * nx;
          vz = tz * 0.96 - vn * 0.7 * nz;
        }
      }
    }

    // transport tube: in at a, out at b
    if (tubeLock > 0) tubeLock--;
    else
      for (const tb of tubes) {
        if (Math.hypot(x - tb.a[0], z - tb.a[1]) < tb.r) {
          const s = Math.min(3.2, Math.max(1.6, Math.hypot(vx, vz) * 0.8));
          // drop into the mouth
          const ya = heightAt(h, tb.a[0], tb.a[1]);
          for (let k = 1; k <= 4; k++) push(tb.a[0], ya + R - k * 0.05, tb.a[1]);
          for (let k = 0; k < 9; k++) push(tb.a[0], ya - 0.3, tb.a[1]); // hidden in the pipe (~0.3 s)
          x = tb.b[0];
          z = tb.b[1];
          vx = Math.cos(tb.dir) * s;
          vz = Math.sin(tb.dir) * s;
          tubeLock = 40;
          break;
        }
      }

    // cup: slow enough = in; fast = lips out (the hole pulls and brakes it a little)
    const cdx = h.cup[0] - x, cdz = h.cup[1] - z;
    const cd = Math.hypot(cdx, cdz);
    if (cd < CUP_R) {
      const s = Math.hypot(vx, vz);
      const off = cd / CUP_R;
      if (s < 1.15 + 0.7 * (1 - off)) {
        holed = true;
        break;
      }
      vx += (cdx / cd) * 9 * DT;
      vz += (cdz / cd) * 9 * DT;
      const s2 = Math.hypot(vx, vz);
      const k = Math.max(0, s2 - 3 * DT) / s2;
      vx *= k;
      vz *= k;
    }

    // water / off the open edge
    curSurf = surfaceAt(h, x, z);
    if (curSurf === "water") {
      water = true;
      if (!inPoly(x, z, h.outline)) {
        // left the course: fine only through an open edge (sea); a gap in a wall would be a bug
        let viaOpen = false;
        for (const i of h.open ?? []) {
          const a = h.outline[i], b = h.outline[(i + 1) % h.outline.length];
          const [qx, qz] = closest(x, z, a[0], a[1], b[0], b[1]);
          if (Math.hypot(x - qx, z - qz) < 0.4) viaOpen = true;
        }
        if (!viaOpen && !onBridge(h, x, z)) escaped = true;
      }
      break;
    }
    if (record && step % SAMPLE_EVERY === 0) push(x, heightAt(h, x, z) + R, z);
  }

  if (holed) {
    // roll to the middle and drop in, with a tiny rattle
    const [cx, cz] = h.cup;
    const yc = heightAt(h, cx, cz);
    const sx = x, sz = z;
    for (let k = 1; k <= 7; k++) {
      const f = k / 7;
      const rat = k === 5 ? 0.012 : 0;
      push(sx + (cx - sx) * f, yc + R - 0.17 * f * f + rat, sz + (cz - sz) * f);
    }
    for (let k = 0; k < 8; k++) push(cx, yc + R - 0.17, cz);
    x = cx;
    z = cz;
  } else if (water) {
    // keep drifting a little while it sinks, then back to where the shot started
    let sx = x, sz = z;
    const y0 = heightAt(h, x, z);
    for (let k = 1; k <= 12; k++) {
      sx += vx * 0.012 * (1 - k / 13);
      sz += vz * 0.012 * (1 - k / 13);
      push(sx, y0 + R - Math.min(0.35, k * 0.03), sz);
    }
    for (let k = 0; k < 10; k++) push(sx, y0 - 0.3, sz);
    x = x0;
    z = z0;
    push(x0, heightAt(h, x0, z0) + R, z0);
  } else {
    push(x, heightAt(h, x, z) + R, z);
  }
  return { x: mm(x), z: mm(z), holed, water, ball, escaped };
}

// ------------------------------------------------------------------ distance to the cup (for the computer players)
/** Walking distance to the cup over a 0.1 m grid (around walls and water), so bots can plan bank shots. Cached. */
function distField(h: Hole) {
  const c = cached(h);
  if (c.dist) return c.dist;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of h.outline) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  const cell = 0.1;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const cost = new Float32Array(nx * nz);
  const R = BALL_R * 0.9;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      const s = surfaceAt(h, x, z);
      let c2 = s === "water" ? 0 : s === "sand" ? 2.5 : 1;
      if (c2) {
        const w = c.walls;
        for (let k = 0; k < w.length && c2; k += 4) {
          const [qx, qz] = closest(x, z, w[k], w[k + 1], w[k + 2], w[k + 3]);
          if (Math.hypot(x - qx, z - qz) < R) c2 = 0;
        }
        for (const p of h.posts ?? []) if (Math.hypot(x - p.x, z - p.z) < p.r + R) c2 = 0;
        for (const p of h.pipes ?? []) {
          const [qx, qz] = closest(x, z, p.a[0], p.a[1], p.b[0], p.b[1]);
          if (Math.hypot(x - qx, z - qz) < p.r + R) c2 = 0;
        }
        for (const b of h.blocks ?? []) if (inPoly(x, z, b.pts)) c2 = 0;
        // uphill costs a little more
        c2 *= 1 + Math.max(0, heightAt(h, x, z)) * 1.5;
      }
      cost[j * nx + i] = c2;
    }
  const d = new Float64Array(nx * nz).fill(Infinity);
  const idx = (x: number, z: number) => Math.round((z - z0) / cell) * nx + Math.round((x - x0) / cell);
  // tiny binary heap Dijkstra
  const heap: number[] = [];
  const hd: number[] = [];
  const pushH = (n: number, v: number) => {
    heap.push(n); hd.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [hd[p], hd[i]] = [hd[i], hd[p]];
      i = p;
    }
  };
  const popH = (): [number, number] => {
    const top: [number, number] = [heap[0], hd[0]];
    const ln = heap.pop()!, lv = hd.pop()!;
    if (heap.length) {
      heap[0] = ln; hd[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hd[l] < hd[m]) m = l;
        if (r < heap.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [hd[m], hd[i]] = [hd[i], hd[m]];
        i = m;
      }
    }
    return top;
  };
  const start = idx(h.cup[0], h.cup[1]);
  d[start] = 0;
  pushH(start, 0);
  // tube exits: reaching the exit means the entry is just as good
  const links = new Map<number, number[]>();
  for (const t of h.tubes ?? []) {
    const ex = idx(t.b[0], t.b[1]), en = idx(t.a[0], t.a[1]);
    links.set(ex, [...(links.get(ex) ?? []), en]);
  }
  const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [n, dv] = popH();
    if (dv > d[n]) continue;
    const i = n % nx, j = (n / nx) | 0;
    for (const [di, dj, w] of N8) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const m = b * nx + a;
      const cm = cost[m];
      if (!cm) continue;
      const nd = dv + w * cell * (cm + (cost[n] || 1)) * 0.5;
      if (nd < d[m]) {
        d[m] = nd;
        pushH(m, nd);
      }
    }
    for (const m of links.get(n) ?? [])
      if (dv + 0.3 < d[m]) {
        d[m] = dv + 0.3;
        pushH(m, dv + 0.3);
      }
  }
  c.dist = { x0, z0, cell, nx, nz, d };
  return c.dist;
}

/** walking distance from (x, z) to the cup (nearest reachable cell) */
export function cupDistance(h: Hole, x: number, z: number): number {
  const f = distField(h);
  const ci = Math.round((x - f.x0) / f.cell), cj = Math.round((z - f.z0) / f.cell);
  let best = Infinity;
  for (let r = 0; r <= 3 && best === Infinity; r++)
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) continue;
        const v = f.d[j * f.nx + i] + r * f.cell;
        if (v < best) best = v;
      }
  return best === Infinity ? 99 : best;
}

/** how good a resting spot is for the next shot (lower = better) */
function score(h: Hole, r: SimResult) {
  if (r.holed) return -1;
  if (r.water || r.escaped) return 60;
  const d = cupDistance(h, r.x, r.z);
  return d + (surfaceAt(h, r.x, r.z) === "sand" ? 0.8 : 0);
}

/** Searches shots (all directions x powers), then checks the best few against aiming mistakes. */
export function bestShot(h: Hole, x: number, z: number, wobble: number): { aim: number; power: number; score: number } {
  const cands: { aim: number; power: number; s: number }[] = [];
  const direct = Math.atan2(h.cup[1] - z, h.cup[0] - x);
  const dist = Math.hypot(h.cup[0] - x, h.cup[1] - z);
  const N = 44;
  const powers = [0.13, 0.22, 0.32, 0.43, 0.56, 0.7, 0.86, 1];
  for (let i = 0; i < N; i++) {
    const aim = direct + (i / N) * Math.PI * 2;
    for (const power of powers) cands.push({ aim, power, s: score(h, simulate(h, x, z, aim, power, false)) });
  }
  // fine search straight at the cup (short putts)
  if (dist < 4.5)
    for (let da = -0.06; da <= 0.061; da += 0.02)
      for (let p = 0.04; p <= Math.min(1, 0.15 + dist * 0.09); p += 0.03)
      cands.push({ aim: direct + da, power: p, s: score(h, simulate(h, x, z, direct + da, p, false)) });
  cands.sort((a, b) => a.s - b.s);
  // refine around the best few
  const top = cands.slice(0, 4);
  for (const c of top)
    for (const da of [-0.015, 0.015, -0.03, 0.03])
      for (const dp of [-0.03, 0, 0.03]) {
        const aim = c.aim + da, power = Math.max(0.03, Math.min(1, c.power + dp));
        cands.push({ aim, power, s: score(h, simulate(h, x, z, aim, power, false)) });
      }
  cands.sort((a, b) => a.s - b.s);
  // robust pick: average over small mistakes (a careful player avoids the narrow bridge)
  let best = cands[0], bestV = Infinity;
  for (const c of cands.slice(0, 6)) {
    let v = c.s;
    if (wobble > 0) {
      for (const [da, dp] of [[wobble, 0], [-wobble, 0], [0, wobble * 1.5], [0, -wobble * 1.5]])
        v += score(h, simulate(h, x, z, c.aim + da, Math.max(0.03, Math.min(1, c.power * (1 + dp))), false));
      v /= 5;
    }
    if (v < bestV) {
      bestV = v;
      best = c;
    }
  }
  return { aim: best.aim, power: best.power, score: bestV };
}

// tiny deterministic noise for bot mistakes (Math.random is fine too, but this keeps tests reproducible)
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const gauss = () => {
  const u = Math.max(1e-6, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export const seedBots = (s: number) => {
  seed = s;
};

const ARD = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);

// ------------------------------------------------------------------ the rules
export const GOLF: SportRules<GolfBall> = {
  id: "golf",
  name: "قولف البط",
  sub: "ميني قولف، الكل يضرب بنفس الوقت",
  better: "low",
  courses: COURSES.map((c) => ({ id: c.id, name: c.name })),
  rounds: (course) => courseOf(course).holes.length,
  roundSeconds: 45,
  startRound(round, prev, course) {
    const h = holeOf(course, round);
    const strokes = [...(prev?.strokes ?? [])];
    for (let i = 0; i < round; i++) strokes[i] = strokes[i] || MAX_STROKES + 1;
    strokes[round] = 0;
    return { hole: round, strokes, x: h.tee[0], z: h.tee[1], holed: false, done: false };
  },
  canShoot: (b) => !b.done && !b.holed && (b.strokes[b.hole] ?? 0) < MAX_STROKES,
  forfeit(b) {
    const strokes = [...b.strokes];
    strokes[b.hole] = MAX_STROKES + 1;
    return { ...b, strokes, done: true };
  },
  shoot(b, shot: Shot, round, course) {
    const h = holeOf(course, b.hole ?? round);
    const r = simulate(h, b.x, b.z, shot.aim, shot.power);
    const strokes = [...b.strokes];
    let n = (strokes[b.hole] ?? 0) + 1 + (r.water ? 1 : 0);
    let label: string | undefined;
    let done = r.holed;
    if (r.holed) {
      const d = n - h.par;
      label = n === 1 ? "هول إن ون!" : d <= -2 ? "إيقل!" : d === -1 ? "بيردي!" : "في الحفرة!";
    } else if (r.water) label = `ماي! +${ARD(1)}`;
    if (!r.holed && n >= MAX_STROKES) {
      // out of strokes: the hole counts one more than the limit
      n = MAX_STROKES + 1;
      done = true;
      label = r.water ? `ماي! خلصت الضربات` : "خلصت الضربات";
    }
    strokes[b.hole] = n;
    const replay: Replay = { dt: 1 / 30, ball: r.ball, label };
    const ms = Math.round((r.ball.length / 3) * (1000 / 30)) + 120;
    return { lane: { ...b, strokes, x: r.x, z: r.z, holed: r.holed, done }, replay, ms };
  },
  card(b, rounds) {
    const cards = Array.from({ length: rounds }, (_, i) => {
      const v = b.strokes[i];
      if (v === undefined || v === null) return null;
      if (i === b.hole && !v) return null;
      return v;
    });
    return { cards, total: cards.reduce<number>((a, c) => a + (c ?? 0), 0) };
  },
  botShot(b, round, skill, course) {
    const h = holeOf(course, b.hole ?? round);
    const err = Math.max(0, 1 - skill);
    const pick = bestShot(h, b.x, b.z, 0.025 + err * 0.08);
    return {
      aim: pick.aim + gauss() * (0.03 + err * 0.13),
      power: Math.max(0.03, Math.min(1, pick.power * (1 + gauss() * (0.06 + err * 0.22)))),
      spin: 0,
      start: 0,
    };
  },
};
