/** كورة البط computer players. Called by the engine a few times a second per duck (faster for better ducks): each
 *  call sets the duck's movement target (tx, ty, run) and may pass / shoot / slide through the engine.
 *  Shape: a 1-2-1 diamond (back, left, right, front) that slides with the ball, one presser, the nearest duck chases
 *  a loose ball, the others mark goal-side or run into space. `skill` (0..1) scales reactions, accuracy and nerve.
 *  Only types come from the engine (no runtime import, so there is no import cycle). */
import type { Duck, FbEngine } from "./engine";
import { PITCH, type FbTeam } from "./types";

const L = PITCH.length / 2;
const W = PITCH.width / 2;
const GW = PITCH.goalWidth / 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;

/** team frame (fx from own goal line -32 to the other +32), by role: back, left, right, front */
const ATT = [
  [-12, 0],
  [3, -11],
  [3, 11],
  [13, 0],
];
const DEF = [
  [-23, 0],
  [-13, -8],
  [-13, 8],
  [-3, 0],
];

function home(e: FbEngine, d: Duck, attack: boolean) {
  const b = e.ball;
  const s = e.dir(d.team);
  const bfx = b.x * s;
  const base = (attack ? ATT : DEF)[d.role];
  let fx = base[0] + bfx * (attack ? 0.5 : 0.55);
  fx = clamp(fx, attack ? -24 : -27, attack ? 26 : 16);
  // defenders stay goal-side of the ball (the front duck may hang a little higher)
  if (!attack) fx = Math.min(fx, bfx - (d.role === 3 ? -2 : d.role === 0 ? 5 : 1.5));
  fx = Math.max(fx, -L + 3);
  const fy = clamp(base[1] * (attack ? 1 : 0.9) + b.y * (attack ? 0.3 : 0.45), -W + 1.5, W - 1.5);
  return { x: fx * s, y: fy };
}

function nearestOpp(e: FbEngine, team: FbTeam, x: number, y: number, skipGk = false) {
  let best = 99;
  for (const o of e.ducks) {
    if (o.team === team || (skipGk && o.gk)) continue;
    const dd = hyp(o.x - x, o.y - y);
    if (dd < best) best = dd;
  }
  return best;
}

export function aiThink(e: FbEngine, d: Duck) {
  const b = e.ball;
  const c = e.ctx[d.team];
  d.run = 1;
  if (b.owner === d.slot) return carrier(e, d);
  if (b.owner < 0) {
    if (c.chaser === d.slot) {
      const r = e.reach(d);
      d.tx = r.x;
      d.ty = r.y;
      return;
    }
    return b.lastTeam === d.team ? support(e, d) : defend(e, d);
  }
  const o = e.ducks[b.owner];
  if (o.team === d.team) return support(e, d);
  if (c.presser === d.slot) return press(e, d, o);
  if (c.cover === d.slot) return cover(e, d, o);
  return defend(e, d);
}

/** with the ball: shoot in range, pass under pressure or to someone better placed, otherwise dribble at goal */
function carrier(e: FbEngine, d: Duck) {
  const s = e.dir(d.team);
  const gx = s * L;
  const distGoal = hyp(gx - d.x, d.y);
  const pressure = nearestOpp(e, d.team, d.x, d.y, true);
  // a person asked for it
  if (d.wantBy >= 0 && e.time < d.wantUntil) {
    if (d.hasT > 0.12 && e.laneRisk(d, e.ducks[d.wantBy].x, e.ducks[d.wantBy].y) > 0.8) {
      const to = d.wantBy;
      d.wantBy = -1;
      return e.pass(d, to, 0.02);
    }
  }
  if (d.hasT < 0.2) return dribble(e, d, distGoal);
  // wide near the goal line: cross it to a team-mate in the box (headers)
  if (Math.abs(d.y) > 8 && L - d.x * s < 12 && e.rng() < 0.45) {
    const target = e.ducks
      .filter((m) => m.team === d.team && !m.gk && m !== d && Math.abs(m.y) < 7 && L - m.x * s < 14)
      .sort((p, q) => Math.abs(p.y) - Math.abs(q.y))[0];
    if (target) return e.pass(d, target.slot, 0.04);
  }
  // shoot?
  const ay = Math.abs(d.y);
  const angleOk = ay < (distGoal < 12 ? 9 : 8);
  // is there a way through (outfield ducks only; the keeper is the keeper's problem)? Try the far corner, then
  // the near one, and aim where it is open.
  const laneTo = (aim: number) => {
    let lane = 99;
    for (const o of e.ducks) {
      if (o.team === d.team || o.gk) continue;
      const lx = gx - d.x;
      const ly = aim - d.y;
      const l2 = lx * lx + ly * ly || 1;
      const t = clamp(((o.x - d.x) * lx + (o.y - d.y) * ly) / l2, 0, 1);
      lane = Math.min(lane, hyp(d.x + lx * t - o.x, d.y + ly * t - o.y));
    }
    return lane;
  };
  const far = e.autoAim(d);
  const near = -far * 0.75;
  const lf = laneTo(far);
  const ln = laneTo(near);
  let aim = lf >= ln || e.rng() < 0.15 ? far : near;
  const lane = Math.max(lf, ln);
  if (lane === ln && lane === lf && e.rng() < 0.3) aim = near;
  const open = lane > 1.2 ? 1 : lane > 0.7 ? 0.55 : 0.25;
  let p = 0;
  if (distGoal < 10 && ay < 7) p = 0.85 * open;
  else if (distGoal < 18 && angleOk) p = (0.3 + 0.3 * d.skill) * open;
  else if (distGoal < 23 && angleOk && pressure < 2.2) p = 0.14 * d.skill * open;
  if (p > 0 && e.rng() < p) {
    // placed close in, struck from further out
    const power = clamp(0.12 + distGoal * 0.035 + e.rng() * 0.25, 0.2, 1);
    const bend = e.rng() < 0.3 * d.skill ? Math.sign(aim) * (0.3 + e.rng() * 0.5) : 0;
    return e.shoot(d, power, aim, 1, bend);
  }
  // pass?
  let best: Duck | null = null;
  let bs = -Infinity;
  for (const m of e.ducks) {
    if (m.team !== d.team || m === d) continue;
    if (m.fall > 0) continue;
    const dist = hyp(m.x - d.x, m.y - d.y);
    if (dist < 4) continue;
    const fwd = (m.x - d.x) * s;
    const open = Math.min(8, nearestOpp(e, d.team, m.x, m.y));
    const lr = e.laneRisk(d, m.x, m.y);
    const mGoal = hyp(gx - m.x, m.y);
    let sc = fwd * 0.07 + open * 0.18 + (lr < 1.3 ? -2 : lr < 2.5 ? -0.6 : 0);
    if (dist > 28) sc -= 0.8;
    if (mGoal < 14) sc += 0.5;
    if (e.isHuman(m)) sc += 0.5;
    if (m.gk) sc -= pressure < 2 && fwd < 0 ? 0.6 : 3;
    if (sc > bs) {
      bs = sc;
      best = m;
    }
  }
  const keep = Math.min(8, pressure) * 0.18 + (distGoal < 20 ? 0.35 : 0) + 0.2;
  const pressured = pressure < 2.4;
  if (best && ((pressured && bs > -0.4 && e.rng() < 0.35 + 0.4 * d.skill) || (d.hasT > 0.6 && bs > keep + 0.6 && e.rng() < 0.4))) {
    return e.pass(d, best.slot, 0.02 + (1 - d.skill) * 0.08);
  }
  dribble(e, d, distGoal);
}

function dribble(e: FbEngine, d: Duck, distGoal: number) {
  const s = e.dir(d.team);
  let vx = s;
  let vy = distGoal < 20 ? (-d.y / Math.max(4, distGoal)) * 0.9 : -d.y * 0.02;
  for (const o of e.ducks) {
    if (o.team === d.team) continue;
    const dx = o.x - d.x;
    const dy = o.y - d.y;
    const dist = hyp(dx, dy);
    if (dist > 6 || dx * s < -1.5) continue;
    const k = 2.4 / Math.max(0.8, dist * dist);
    vx -= dx * k;
    vy -= dy * k * 1.4;
    // straight ahead: step round him, towards the middle (or the side this duck prefers)
    if (Math.abs(dy) < 0.6 && dx * s > 0) vy += (Math.abs(d.y) > 2 ? -Math.sign(d.y) : d.slot % 2 ? 1 : -1) * k * 1.6;
  }
  if (Math.abs(d.y) > W - 3) vy -= Math.sign(d.y) * 0.8;
  // don't run into the end board: cut inside near the goal line
  if ((d.x * s) > L - 4 && Math.abs(d.y) > GW) vy -= Math.sign(d.y) * 1.2;
  // never dribble backwards
  if (vx * s < 0.15) vx = 0.15 * s;
  const m = hyp(vx, vy) || 1;
  d.tx = d.x + (vx / m) * 4;
  d.ty = d.y + (vy / m) * 4;
  d.run = 1;
}

/** team has the ball: take up the attacking shape, and every so often pick the most open spot near it */
function support(e: FbEngine, d: Duck) {
  const h = home(e, d, true);
  const b = e.ball;
  if (e.time >= d.spotT || hyp(d.spotX - h.x, d.spotY - h.y) > 7) {
    const carrier = b.owner >= 0 ? e.ducks[b.owner] : null;
    const s = e.dir(d.team);
    let best = { x: h.x, y: h.y };
    let bs = -Infinity;
    for (let i = -1; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const r = i < 0 ? 0 : 5;
      const x = clamp(h.x + Math.cos(a) * r, -L + 3, L - 3);
      const y = clamp(h.y + Math.sin(a) * r, -W + 1.5, W - 1.5);
      let sc = Math.min(8, nearestOpp(e, d.team, x, y)) * 0.3 - hyp(x - h.x, y - h.y) * 0.08 + x * s * 0.03;
      if (carrier && carrier !== d && e.laneRisk(carrier, x, y) < 1.5) sc -= 1;
      for (const m of e.ducks) if (m.team === d.team && m !== d && !m.gk && hyp(m.x - x, m.y - y) < 5) sc -= 0.8;
      if (sc > bs) {
        bs = sc;
        best = { x, y };
      }
    }
    d.spotX = best.x;
    d.spotY = best.y;
    d.spotT = e.time + 0.7 + e.rng() * 0.5;
  }
  d.tx = d.spotX;
  d.ty = d.spotY;
  d.run = hyp(d.tx - d.x, d.ty - d.y) > 4 ? 1 : 0.75;
}

/** the presser: goal-side of the carrier, and now and then a slide tackle */
function press(e: FbEngine, d: Duck, o: Duck) {
  const s = e.dir(d.team);
  const goalX = -s * L;
  const gx = goalX - o.x;
  const gy = -o.y;
  const gm = hyp(gx, gy) || 1;
  d.tx = o.x + o.vx * 0.25 + (gx / gm) * 0.7;
  d.ty = o.y + o.vy * 0.25 + (gy / gm) * 0.7;
  d.run = 1;
  const dist = hyp(o.x - d.x, o.y - d.y);
  if (dist < 2.0 && dist > 0.6 && d.slideCd <= 0) {
    const inBox = Math.abs(d.x - goalX) < PITCH.boxDepth;
    const pSlide = (0.015 + 0.035 * d.skill) * (inBox ? 0.4 : 1);
    if (e.rng() < pSlide) e.slideStart(d, e.ball.x - d.x, e.ball.y - d.y);
  }
}

/** second defender (a person presses, or the carrier is near our goal): between the ball and our goal */
function cover(e: FbEngine, d: Duck, o: Duck) {
  const s = e.dir(d.team);
  const gx = -s * L - o.x;
  const gy = -o.y;
  const gm = hyp(gx, gy) || 1;
  // close to goal: tight (in the way of the shot), further out: a few metres off
  const r = gm < 20 ? 2.2 : 5;
  d.tx = o.x + o.vx * 0.2 + (gx / gm) * r;
  d.ty = o.y + o.vy * 0.2 + (gy / gm) * r;
  d.run = 1;
}

/** defending shape, marking the nearest attacker goal-side */
function defend(e: FbEngine, d: Duck) {
  const h = home(e, d, false);
  const s = e.dir(d.team);
  const goalX = -s * L;
  const b = e.ball;
  let mark: Duck | null = null;
  let md = 9;
  for (const o of e.ducks) {
    if (o.team === d.team || o.gk || o.slot === b.owner) continue;
    const dd = hyp(o.x - h.x, o.y - h.y);
    if (dd < md) {
      md = dd;
      mark = o;
    }
  }
  if (mark) {
    const gx = goalX - mark.x;
    const gy = -mark.y;
    const gm = hyp(gx, gy) || 1;
    const mx = mark.x + (gx / gm) * 1.6;
    const my = mark.y + (gy / gm) * 1.6;
    d.tx = mx * 0.7 + h.x * 0.3;
    d.ty = my * 0.7 + h.y * 0.3;
  } else {
    d.tx = h.x;
    d.ty = h.y;
  }
  d.run = hyp(d.tx - d.x, d.ty - d.y) > 3 ? 1 : 0.8;
}

/** keeper: on the arc between ball and goal, comes for loose balls in the box, gives it to a free team-mate */
export function keeperThink(e: FbEngine, k: Duck) {
  const b = e.ball;
  const s = e.dir(k.team);
  let goalX = -s * L;
  if (e.stage === "pen") {
    if (e.pen?.keeper === k.slot) goalX = e.pen.side * L;
    k.tx = goalX - Math.sign(goalX) * 0.5;
    k.ty = 0;
    k.run = 0.5;
    return;
  }
  k.run = 1;
  if (b.owner === k.slot) {
    k.tx = k.x;
    k.ty = k.y;
    const want = k.wantBy >= 0 && e.time < k.wantUntil;
    if (k.hasT < (want ? 0.4 : 0.9 + e.rng() * 0.5)) return;
    let best: Duck | null = null;
    let bs = -Infinity;
    for (const m of e.ducks) {
      if (m.team !== k.team || m === k) continue;
      const dist = hyp(m.x - k.x, m.y - k.y);
      const open = Math.min(8, nearestOpp(e, k.team, m.x, m.y));
      const lr = e.laneRisk(k, m.x, m.y);
      let sc = open * 0.3 + m.x * s * 0.03 - (lr < 1.5 ? 2 : 0) - (dist > 30 ? 1 : 0);
      if (want && m.slot === k.wantBy) sc += 3;
      if (sc > bs) {
        bs = sc;
        best = m;
      }
    }
    k.wantBy = -1;
    if (best && bs > 0.6 && hyp(best.x - k.x, best.y - k.y) <= 28) return e.pass(k, best.slot, 0.03);
    const fwd = e.ducks.filter((m) => m.team === k.team && !m.gk).sort((p, q) => q.x * s - p.x * s)[0];
    return e.boot(k, fwd ? fwd.x + s * 3 : s * 8, fwd ? fwd.y : 0);
  }
  const inBox = Math.abs(b.x - goalX) < PITCH.boxDepth && Math.abs(b.y) < PITCH.boxWidth / 2;
  if (b.owner < 0 && inBox && b.z < 2) {
    const mine = e.reach(k);
    let theirs = Infinity;
    for (const o of e.ducks) if (o.team !== k.team && !o.gk) theirs = Math.min(theirs, e.reach(o).t);
    if (mine.t <= theirs * 1.15 + 0.1) {
      k.tx = mine.x;
      k.ty = mine.y;
      return;
    }
  }
  const vx = b.x - goalX;
  const vy = b.y;
  const dist = hyp(vx, vy) || 1;
  let r = clamp(0.6 + dist * 0.05, 0.6, 2.2);
  const o = b.owner >= 0 ? e.ducks[b.owner] : null;
  if (o && o.team !== k.team && dist < 11 && Math.abs(b.y) < 8) r = clamp(dist * 0.35, 1, 4);
  k.tx = goalX + (vx / dist) * r;
  k.ty = clamp((vy / dist) * r, -GW + 0.3, GW - 0.3);
}
