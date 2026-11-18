// كورة البط gameplay scenarios. Run: npx tsx tools/football-scenarios.ts
// Each scenario builds a small situation in the real engine (src/shared/football/engine.ts), drives a person's
// controls the way the phone / keyboard / pad would (FbInput), steps the fixed 30 Hz simulation and checks the
// outcome. Keyboard / gamepad *device* handling (rebinding, dead zones, d-pad, reconnect) lives in the browser and
// is exercised there (see docs/football-audit.md); here input means the FbInput every device produces.
import { BALL_R, DT, FbEngine, HALF_L, HALF_W, TUNE } from "../src/shared/football/engine";
import { FbAction, FbEvent, PITCH, type FbInput, type FbPlayer, type FbTeam } from "../src/shared/football/types";

let fails = 0;
let count = 0;
const ok = (n: number, cond: unknown, what: string) => {
  count++;
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${String(n).padStart(2)}. ${what}`);
};

const roster = (): FbPlayer[] => {
  const r: FbPlayer[] = [];
  for (const t of [0, 1] as FbTeam[]) for (let i = 0; i < 5; i++) r.push({ slot: r.length, team: t, char: "ali", name: "x", gk: i === 0 });
  return r;
};
/** an empty pitch: everybody parked and frozen out of the way, a person on duck 1 (blue, attacking +x) */
function world(seed = 7) {
  const e = new FbEngine(roster(), { seed, halfSeconds: 600 });
  e.setStage("play");
  for (const d of e.ducks) {
    const x = d.gk ? (d.team === 0 ? -HALF_L + 0.6 : HALF_L - 0.6) : d.team === 0 ? -26 : 26;
    const y = d.gk ? 0 : -HALF_W + 2 + (d.slot % 5) * 1.2;
    Object.assign(d, { x, y, vx: 0, vy: 0, hx: d.team === 0 ? 1 : -1, hy: 0 });
  }
  e.addPerson("me", 0, 1);
  return e;
}
/** a computer duck that stays put (or keeps running to tx, ty) and makes no decisions */
function freeze(e: FbEngine, slot: number, x: number, y: number, run?: { tx: number; ty: number }) {
  const d = e.ducks[slot];
  Object.assign(d, { x, y, vx: 0, vy: 0, tx: run ? run.tx : x, ty: run ? run.ty : y, run: run ? 1 : 0, think: 1e9 });
}
function give(e: FbEngine, slot: number) {
  const d = e.ducks[slot];
  Object.assign(e.ball, { owner: slot, x: d.x + d.hx * TUNE.dribbleDist, y: d.y + d.hy * TUNE.dribbleDist, z: 0, vx: 0, vy: 0, vz: 0, last: slot, lastTeam: d.team, passTo: -1, held: false });
  d.hasT = 1;
}
const NONE: FbInput = { x: 0, y: 0, a: false, b: false };
function steps(e: FbEngine, n: number, inp?: FbInput, each?: () => boolean | void) {
  if (inp) e.input("me", inp);
  for (let i = 0; i < n; i++) {
    e.step();
    if (each && each()) return i;
  }
  return n;
}
/** a person's pass: stick (x, y), A tapped (short) or held (long), then let go */
function passInput(e: FbEngine, x: number, y: number, held = false) {
  const m = Math.hypot(x, y) || 1;
  e.input("me", { x: x / m, y: y / m, a: true, b: false });
  steps(e, held ? Math.ceil(TUNE.lobHold / DT) + 2 : 2);
  e.input("me", { x: x / m, y: y / m, a: false, b: false });
  e.step();
}
/** after a pass: who ends up with it (slot, or -1) within `secs`, and the highest point of the ball */
function outcome(e: FbEngine, secs = 3.5) {
  let maxZ = 0;
  e.input("me", NONE);
  for (let i = 0; i < secs / DT; i++) {
    e.step();
    maxZ = Math.max(maxZ, e.ball.z);
    if (e.ball.owner >= 0) return { owner: e.ball.owner, maxZ, t: i * DT };
  }
  return { owner: -1, maxZ, t: secs };
}

// ------------------------------------------------------------------------------------------------ passing
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 9, 0);
  give(e, 1);
  passInput(e, 1, 0);
  const o = outcome(e);
  ok(1, o.owner === 2, `short pass: 9 m to a team-mate straight ahead arrives (owner ${o.owner}, ${o.t.toFixed(2)} s)`);
}
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 7, 7);
  freeze(e, 3, 10, 0); // a nearer-to-straight-ahead mate must not steal a diagonal pass
  give(e, 1);
  passInput(e, 1, 1);
  const o = outcome(e);
  ok(2, o.owner === 2, `short diagonal pass goes to the mate on the diagonal, not the one straight ahead (owner ${o.owner})`);
}
{
  const e = world();
  freeze(e, 1, -14, 0);
  freeze(e, 2, 14, 2);
  give(e, 1);
  passInput(e, 1, 0.07, true);
  const o = outcome(e, 4);
  ok(3, o.owner === 2, `long pass (held): 28 m upfield arrives (owner ${o.owner}, ${o.t.toFixed(2)} s)`);
}
{
  const e = world();
  for (const d of e.ducks) freeze(e, d.slot, d.x, d.y);
  freeze(e, 1, -10, 0);
  freeze(e, 2, 12, 0);
  freeze(e, 7, 0, 0); // an opponent right in the lane
  give(e, 1);
  passInput(e, 1, 0, true);
  const o = outcome(e, 4);
  ok(4, o.owner === 2 && o.maxZ > 1.6, `lofted pass over a defender in the lane: up to ${o.maxZ.toFixed(1)} m, owner ${o.owner}`);
}
{
  const e = world();
  freeze(e, 1, 0, -17);
  freeze(e, 2, 3, 16);
  give(e, 1);
  e.ducks[1].hy = 1;
  e.ducks[1].hx = 0;
  passInput(e, 0.1, 1, true);
  const o = outcome(e, 4);
  ok(5, o.owner === 2, `cross-field switch, left touchline to right touchline (33 m): owner ${o.owner}`);
}
{
  const e = world();
  freeze(e, 1, 4, 17);
  freeze(e, 2, -2, -16);
  give(e, 1);
  passInput(e, -0.15, -1, true);
  const o = outcome(e, 4);
  ok(6, o.owner === 2, `cross-field switch, right to left: owner ${o.owner}`);
}
{
  const e = world();
  freeze(e, 1, -6, 0);
  freeze(e, 2, 2, 6, { tx: 30, ty: 6 }); // running forward
  give(e, 1);
  steps(e, 8); // he is up to speed
  const m = e.ducks[2];
  const mx = m.x;
  passInput(e, (m.x - e.ducks[1].x), (m.y - e.ducks[1].y), true);
  // where the ball reaches the runner's lane (y = 6): ahead of where he was when it was played
  const b = e.ball;
  const crossX = b.x + (b.vy > 0.1 ? ((6 - b.y) / b.vy) * b.vx : 99);
  const o = outcome(e, 4);
  ok(7, o.owner === 2 && crossX > mx + 2, `through ball into a runner's path: aimed ${(crossX - mx).toFixed(1)} m ahead of him, he gets it (owner ${o.owner})`);
}
{
  const e = world();
  freeze(e, 1, 5, 0);
  freeze(e, 2, -6, 1);
  give(e, 1);
  passInput(e, -1, 0);
  const o = outcome(e);
  ok(8, o.owner === 2, `backward pass arrives (owner ${o.owner})`);
}
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 7, 1.7, 0); // pressing from in front
  freeze(e, 2, 1, 9);
  give(e, 1);
  passInput(e, 0, 1);
  const o = outcome(e);
  ok(9, o.owner === 2, `pass under pressure, square away from the presser: owner ${o.owner}`);
}
{
  const e = world();
  freeze(e, 1, -4, 0);
  freeze(e, 2, 6, -6, { tx: 6, ty: 15 }); // running across
  give(e, 1);
  steps(e, 8);
  passInput(e, e.ducks[2].x - e.ducks[1].x, e.ducks[2].y - e.ducks[1].y);
  const o = outcome(e);
  ok(10, o.owner === 2, `pass to a team-mate on the move (led into his run): owner ${o.owner}`);
}
{
  // the stick decides, not "the best option": a far mate exactly along the stick beats a near one 35 degrees off
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 20, 1);
  freeze(e, 3, 5, 3.5);
  give(e, 1);
  ok(10.5, e.pickPass(e.ducks[1], 1, 0) === 2, "direction first: the far mate on the stick's line is picked over the nearer one off it");
}

// ------------------------------------------------------------------------------------------------ ball physics
{
  const e = world();
  for (const d of e.ducks) freeze(e, d.slot, d.x, d.y);
  Object.assign(e.ball, { owner: -1, x: -10, y: 5, z: 0, vx: 10, vy: 0, vz: 0, last: -1, lastTeam: -1 });
  let prev = 10;
  let mono = true;
  let stopAt = -1;
  steps(e, 30 * 8, NONE, () => {
    const sp = Math.hypot(e.ball.vx, e.ball.vy);
    if (sp > prev + 1e-6) mono = false;
    prev = sp;
    if (sp === 0 && stopAt < 0 && e.ball.owner < 0) stopAt = e.ball.x;
  });
  ok(11, mono && stopAt > 0 && stopAt - -10 < 35, `friction: a 10 m/s roll slows steadily and stops after ${(stopAt + 10).toFixed(1)} m`);
  ok(12, Math.abs(e.ball.y - 5) < 1e-6, "momentum: a rolling ball keeps its line (no drift)");
}
{
  const e = world();
  Object.assign(e.ball, { owner: -1, x: 0, y: HALF_W - 3, z: 0, vx: 2, vy: 12, vz: 0, last: -1, lastTeam: -1 });
  let hit = false;
  steps(e, 20, NONE, () => {
    if (e.ball.vy < 0) hit = true;
  });
  ok(13, hit && Math.abs(e.ball.y) <= HALF_W - BALL_R + 1e-9, `collision: off the side board it comes back (vy ${e.ball.vy.toFixed(1)}), never outside`);
}
{
  const e = world();
  Object.assign(e.ball, { owner: -1, x: -5, y: 0, z: 0.1, vx: 6, vy: 0, vz: 7, last: -1, lastTeam: -1 });
  let bounces = 0;
  let wasDown = false;
  steps(e, 30 * 5, NONE, () => {
    if (e.ball.z <= 0 && !wasDown) bounces++;
    wasDown = e.ball.z <= 0;
  });
  ok(14, bounces >= 2 && e.ball.z === 0, `bouncing: a dropping ball bounces (${bounces} landings) and settles on the grass`);
}
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 14, 0);
  freeze(e, 7, 7, 0.3); // right in the line, a slow pass
  give(e, 1);
  e.ducks[1].hx = 1;
  e.pass(e.ducks[1], 2, 0, 1, 0, undefined, undefined, 4);
  const o = outcome(e);
  ok(15, o.owner === 7, `interception: a defender standing in the lane of a slow pass cuts it out (owner ${o.owner})`);
}
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 10, 0);
  give(e, 1);
  passInput(e, 1, 0);
  let trapped = false;
  e.input("me", NONE);
  steps(e, 90, undefined, () => {
    if (e.action(e.ducks[2]) === FbAction.Trap) trapped = true;
  });
  ok(16, trapped && e.ball.owner === 2, "receiving: the receiver cushions it (Trap) and keeps it");
}
{
  const e = world();
  for (const d of e.ducks) d.think = 0;
  Object.assign(e.ball, { owner: -1, x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, last: -1, lastTeam: -1 });
  for (const d of e.ducks) if (!d.gk) Object.assign(d, { x: d.team ? 6 : -6, y: (d.slot % 5) * 2 - 4 });
  const t = steps(e, 60, NONE, () => e.ball.owner >= 0);
  ok(17, e.ball.owner >= 0, `loose-ball recovery: a loose ball is picked up (after ${(t * DT).toFixed(2)} s)`);
}
{
  const e = world();
  let out = false;
  for (const [vx, vy] of [[30, 25], [-28, -20], [25, -30]]) {
    Object.assign(e.ball, { owner: -1, x: 0, y: 0, z: 0.2, vx, vy, vz: 3, last: -1, lastTeam: -1, inNet: false });
    steps(e, 60, NONE, () => {
      if (Math.abs(e.ball.y) > HALF_W || Math.abs(e.ball.x) > HALF_L + PITCH.goalDepth + TUNE.netGive) out = true;
    });
  }
  ok(18, !out, "out of bounds: the ad boards keep every ball in play (arcade rules: no throw-ins)");
}

// ------------------------------------------------------------------------------------------------ controls (FbInput)
{
  const e = world();
  freeze(e, 1, -10, 0);
  const x0 = e.ducks[1].x;
  steps(e, 30, { x: 1, y: 0, a: false, b: false });
  const run = e.ducks[1].x - x0;
  const e2 = world();
  freeze(e2, 1, -10, 0);
  steps(e2, 30, { x: Math.SQRT1_2, y: Math.SQRT1_2, a: false, b: false });
  const diag = Math.hypot(e2.ducks[1].x + 10, e2.ducks[1].y);
  ok(19, run > 4.5 && Math.abs(diag - run) < 0.3, `movement: 1 s of stick right = ${run.toFixed(1)} m, diagonal ${diag.toFixed(1)} m (8 directions, same speed)`);
}
{
  const e = world();
  freeze(e, 1, -10, 0);
  steps(e, 30, { x: 0.5, y: 0, a: false, b: false });
  const half = e.ducks[1].x + 10;
  ok(20, half > 2 && half < 3.6, `analog: half stick = ${half.toFixed(1)} m in 1 s (about half speed)`);
}
{
  // the same actions from any device: A = pass with the ball / slide without it, B = shoot / switch
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 9, 0);
  give(e, 1);
  passInput(e, 1, 0);
  const passed = e.ball.owner === -1;
  const e2 = world();
  freeze(e2, 1, 0, 0);
  freeze(e2, 6, 1.6, 0);
  give(e2, 6);
  e2.input("me", { x: 1, y: 0, a: true, b: false });
  e2.step();
  ok(21, passed && e2.ducks[1].slide > 0, "button actions: A passes with the ball and slides without it");
}
{
  const e = world();
  freeze(e, 1, -20, 0);
  freeze(e, 3, 2, 2);
  Object.assign(e.ball, { owner: -1, x: 4, y: 3, z: 0, vx: 0, vy: 0, vz: 0, last: 8, lastTeam: 1 });
  freeze(e, 8, 10, 10);
  e.step();
  const before = e.control().me;
  e.input("me", { x: 0, y: 0, a: false, b: true });
  e.step();
  e.input("me", NONE);
  e.step();
  const after = e.control().me;
  let flips = 0;
  let last = after;
  steps(e, 30, undefined, () => {
    if (e.control().me !== last) flips++;
    last = e.control().me;
  });
  ok(22, before !== 3 || after === 3, `switching: B jumps to the duck nearest the ball (${before} -> ${after}), no flicking after (${flips} changes)`);
}
{
  const e = world();
  freeze(e, 1, -15, 0);
  give(e, 1);
  let kept = true;
  steps(e, 60, { x: 0.8, y: 0.6, a: false, b: false }, () => {
    if (e.ball.owner !== 1) kept = false;
  });
  const d = e.ducks[1];
  const ahead = (e.ball.x - d.x) * d.hx + (e.ball.y - d.y) * d.hy;
  ok(23, kept && ahead > 0.2, `dribbling: 2 s with the ball, still his, the ball ${ahead.toFixed(2)} m in front`);
}
{
  const e = world();
  freeze(e, 1, -20, 0);
  steps(e, 45, { x: 1, y: 0, a: false, b: false, s: true });
  const sprint = e.ducks[1].x + 20;
  ok(24, sprint > 9 && e.ducks[1].stamina < 0.8, `sprinting: ${sprint.toFixed(1)} m in 1.5 s, stamina down to ${e.ducks[1].stamina.toFixed(2)}`);
}
{
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 6, 1.9, 0.3);
  e.ducks[6].trickCd = 99;
  give(e, 6);
  e.input("me", { x: 1, y: 0.1, a: true, b: false });
  e.step();
  e.input("me", { x: 1, y: 0, a: false, b: false });
  const t = steps(e, 20, undefined, () => e.ball.owner === 1);
  ok(25, e.ball.owner === 1, `tackling: a slide at the carrier wins the ball (${(t * DT).toFixed(2)} s)`);
}

// ------------------------------------------------------------------------------------------------ AI (computer vs computer)
{
  let spread = 0;
  let pair = 0;
  let n = 0;
  let runsAhead = 0;
  let runN = 0;
  let goalSide = 0;
  let gsN = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const e = new FbEngine(roster(), { seed, halfSeconds: 120 });
    e.kickoff(0);
    for (let i = 0; i < 30 * 120 && !e.halfOver; i++) {
      e.step();
      if (e.stage !== "play" || i % 15) continue;
      for (const t of [0, 1] as FbTeam[]) {
        const out = e.ducks.filter((d) => d.team === t && !d.gk);
        const xs = out.map((d) => d.x);
        spread += Math.max(...xs) - Math.min(...xs) + Math.max(...out.map((d) => d.y)) - Math.min(...out.map((d) => d.y));
        let ps = 0;
        let pc = 0;
        for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) {
          ps += Math.hypot(out[a].x - out[b].x, out[a].y - out[b].y);
          pc++;
        }
        pair += ps / pc;
        n++;
        const b = e.ball;
        const carrier = b.owner >= 0 ? e.ducks[b.owner] : null;
        if (carrier && carrier.team === t && !carrier.gk && carrier.x * e.dir(t) < HALF_L - 16 && carrier.hasT > 1) {
          // (a carrier in midfield who has had it a moment: room for somebody to be ahead of him)
          const s = e.dir(t);
          runN++;
          if (out.some((d) => d !== carrier && ((d.x - carrier.x) * s > 3 || (d.vx * s > 4 && (d.tx - d.x) * s > 5 && (d.x - carrier.x) * s > -6)))) runsAhead++;
        }
        if (carrier && carrier.team !== t) {
          const s = e.dir(t);
          gsN++;
          if (out.filter((d) => (d.x - b.x) * s < 0).length >= 2) goalSide++;
        }
      }
    }
  }
  ok(26, spread / n > 22 && pair / n > 8, `team-mate positioning: team spread ${(spread / n).toFixed(1)} m, mean distance between team-mates ${(pair / n).toFixed(1)} m (no clustering)`);
  ok(27, runsAhead / runN > 0.7, `attacking runs: a team-mate is ahead of the midfield carrier or running beyond him ${((100 * runsAhead) / runN).toFixed(0)}% of the time`);
  ok(28, goalSide / gsN > 0.7, `defending: at least two outfield ducks goal-side of the ball ${((100 * goalSide) / gsN).toFixed(0)}% of the time`);
}
{
  let sent = 0;
  let arrived = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const e = new FbEngine(roster(), { seed, halfSeconds: 180 });
    e.kickoff(0);
    let pend = -1;
    let team = 0;
    for (let i = 0; i < 30 * 180 && !e.halfOver; i++) {
      e.step();
      for (const [k, sl] of e.events) if (k === FbEvent.Pass && sl >= 0 && !e.ducks[sl].gk) {
        sent++;
        pend = 0;
        team = e.ducks[sl].team;
      }
      e.events.length = 0;
      if (pend >= 0 && e.ball.owner >= 0) {
        if (e.ducks[e.ball.owner].team === team) arrived++;
        pend = -1;
      }
    }
  }
  ok(29, arrived / sent > 0.65, `passing decisions: the computer completes ${((100 * arrived) / sent).toFixed(0)}% of its passes`);
}
{
  // a person passing straight at an opponent 4 m away is cut out (interceptions are fair, not random)
  const e = world();
  freeze(e, 1, 0, 0);
  freeze(e, 2, 12, 0);
  freeze(e, 7, 4, 0);
  give(e, 1);
  passInput(e, 1, 0);
  const o = outcome(e);
  ok(30, o.owner === 7, `opponent interception: a ground pass straight through a defender is cut out (owner ${o.owner})`);
}
{
  // the keeper: shots straight at him are saved, well placed corners beat him often enough (geometry, not dice)
  const res = { mid: { n: 0, saved: 0 }, corner: { n: 0, goals: 0 } };
  for (let seed = 1; seed <= 60; seed++) {
    const e = world(seed);
    freeze(e, 1, 16, (seed % 5) - 2);
    give(e, 1);
    e.ducks[5].think = 0;
    const corner = seed % 2 === 0;
    e.shoot(e.ducks[1], 0.55 + (seed % 4) * 0.12, corner ? (seed % 4 < 2 ? -2.9 : 2.9) : 0, 1, 0, true);
    const g0 = e.score[0];
    let saved = false;
    let goal = false;
    for (let i = 0; i < 60 && !saved && !goal; i++) {
      e.step();
      if (e.ball.owner === 5 || e.events.some(([k]) => k === FbEvent.Save)) saved = true;
      if (e.score[0] > g0) goal = true;
      e.events.length = 0;
    }
    if (corner) {
      if (saved || goal) {
        res.corner.n++;
        if (goal) res.corner.goals++;
      }
    } else {
      res.mid.n++;
      if (saved) res.mid.saved++;
    }
  }
  ok(31, res.mid.saved / res.mid.n >= 0.8 && res.corner.goals / res.corner.n >= 0.25, `goalkeeper: saves ${res.mid.saved}/${res.mid.n} shots at him, beaten by ${res.corner.goals}/${res.corner.n} corner shots on target`);
}

{
  // a chip (shoot with sprint held) over a keeper caught off his line
  let goals = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const e = world(seed);
    freeze(e, 1, 12, 0);
    freeze(e, 5, HALF_L - 6, 0);
    e.ducks[5].think = 0; // he reacts (backpedals, jumps)
    give(e, 1);
    e.input("me", { x: 1, y: 0, a: false, b: true, s: true });
    steps(e, 6);
    e.input("me", { x: 1, y: 0, a: false, b: false, s: true });
    const g0 = e.score[0];
    steps(e, 60, undefined, () => e.score[0] > g0);
    if (e.score[0] > g0) goals++;
  }
  ok(31.5, goals >= 4, `chip shot: over a keeper 6 m off his line (he backpedals), ${goals}/10 go in`);
}

// ------------------------------------------------------------------------------------------------ match flow
{
  const e = new FbEngine(roster(), { seed: 2, halfSeconds: 60 });
  e.kickoff(0);
  let playAt = -1;
  for (let i = 0; i < 30 * 5; i++) {
    e.step();
    if (e.stage === "play") {
      playAt = i * DT;
      break;
    }
  }
  const o = e.ball.owner >= 0 ? e.ducks[e.ball.owner] : null;
  ok(32, playAt > 0 && playAt < 4 && o && o.team === 0, `kick-off: play starts after ${playAt.toFixed(1)} s with the kicking team on the ball`);

  Object.assign(e.ball, { owner: -1, x: HALF_L - 2, y: 0, z: 0.3, vx: 20, vy: 0, vz: 0, last: 2, lastTeam: 0, inNet: false });
  e.keeperOf(1).fall = 9;
  let goalAt = -1;
  for (let i = 0; i < 30; i++) {
    e.step();
    if (e.stage === "goal") {
      goalAt = i;
      break;
    }
  }
  ok(33, goalAt >= 0 && e.score[0] === 1 && e.lastGoal?.team === 0, `goal: detected, score ${e.score[0]}-${e.score[1]}, scorer team 0`);
  e.keeperOf(1).fall = 0;
  let back = false;
  for (let i = 0; i < 30 * 12; i++) {
    e.step();
    if (e.stage === "play") {
      back = true;
      break;
    }
  }
  const o2 = e.ball.owner >= 0 ? e.ducks[e.ball.owner] : null;
  ok(34, back && o2 && o2.team === 1 && Math.hypot(e.ball.x, e.ball.y) < 2, "restart: after the goal the other team kicks off from the centre");
  ok(35, e.score.join("-") === "1-0", `scoreboard: the score stays ${e.score.join("-")} through the restart`);
  const c0 = e.clock;
  for (let i = 0; i < 30; i++) e.step();
  const ran = e.clock - c0;
  for (let i = 0; i < 30 * 150 && !e.halfOver; i++) e.step();
  ok(36, Math.abs(ran - 1) < 0.05 && e.halfOver && Math.abs(e.clock - e.halfSeconds) < 3.1, `match timer: ${ran.toFixed(2)} s of clock per second of play; the half ends at ${e.clock.toFixed(1)} s (of ${e.halfSeconds})`);
}


// ---- round 4: the "moving passes the ball to the opponent" report, pass pickup, standing tackles
{
  // 37: a person dribbling (turns, reverses, sprints) with no opponent within tackle range never loses the ball
  let losses = 0;
  let secs = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const e = world(seed);
    for (const d of e.ducks) if (d.slot !== 1) freeze(e, d.slot, d.x, d.y);
    const me = e.ducks[1];
    Object.assign(me, { x: 0, y: 0 });
    give(e, 1);
    let rs = seed * 77;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    let ang = 0;
    for (let i = 0; i < 30 * 15; i++) {
      if (i % 10 === 0) ang += rnd() < 0.3 ? Math.PI : (rnd() - 0.5) * 3;
      if (Math.hypot(me.x, me.y) > 9) ang = Math.atan2(-me.y, -me.x);
      e.input("me", { x: Math.cos(ang), y: Math.sin(ang), a: false, b: false, s: rnd() < 0.5 });
      e.step();
      secs += DT;
      if (e.ball.owner !== 1) {
        losses++;
        give(e, 1);
      }
    }
  }
  ok(37, losses === 0, `moving never gives the ball away: ${losses} losses in ${secs.toFixed(0)} s of turning / reversing / sprinting with nobody near`);
}
{
  // 38: a defender pressing at the passer's side (not in the line) does not get the ball as it leaves the boot
  let stolen = 0;
  for (let k = 0; k < 8; k++) {
    const e = world(30 + k);
    for (const d of e.ducks) if (d.slot !== 1) freeze(e, d.slot, d.x, d.y);
    Object.assign(e.ducks[1], { x: 0, y: 0, hx: 1, hy: 0 });
    // a team-mate ahead, a defender tight at the side / behind the ball
    freeze(e, 2, 12, (k % 3) - 1);
    const side = k % 2 ? 1 : -1;
    freeze(e, 6, TUNE.dribbleDist - 0.15 * (k % 4), side * (0.3 + 0.03 * k));
    give(e, 1);
    passInput(e, 1, 0);
    for (let i = 0; i < 4; i++) e.step();
    if (e.ball.owner === 6) stolen++;
  }
  ok(38, stolen === 0, `a pass with a defender at your side leaves the boot: ${stolen}/8 taken by him on the kick`);
}
{
  // 39 + 40: a computer defender's tackle is always seen (lean in first); a missed one leaves him off balance
  let lostUnseen = 0;
  let losses = 0;
  let missesStagger = 0;
  let misses = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const e = world(50 + seed);
    for (const d of e.ducks) if (d.slot !== 1 && d.slot !== 6) freeze(e, d.slot, d.x, d.y);
    Object.assign(e.ducks[1], { x: 0, y: 0, hx: 1, hy: 0 });
    const def = e.ducks[6];
    Object.assign(def, { x: 3, y: (seed % 3) * 0.4 - 0.4, think: 0, skill: 0.8 });
    give(e, 1);
    let leanT = 0;
    let wasTackling = false;
    for (let i = 0; i < 30 * 4; i++) {
      // the carrier jinks away now and then (a person seeing the lean-in)
      const jink = seed % 2 === 0 && def.tackle > TUNE.tackleHit;
      e.input("me", { x: jink ? -0.3 : 1, y: jink ? 1 : 0, a: false, b: false });
      e.step();
      const act = e.action(def);
      if (act === FbAction.Tackle) leanT += DT;
      if (wasTackling && def.tackle <= 0 && e.ball.owner === 1) {
        misses++;
        if (e.action(def) === FbAction.Stagger) missesStagger++;
      }
      wasTackling = def.tackle > 0;
      if (e.ball.owner !== 1) {
        losses++;
        if (leanT < TUNE.tackleWind - 0.01) lostUnseen++;
        break;
      }
    }
  }
  ok(39, losses > 0 && lostUnseen === 0, `tackles are seen coming: ${losses} balls won, ${lostUnseen} without the defender leaning in first`);
  ok(40, misses === 0 || missesStagger === misses, `a missed tackle leaves the defender off balance: ${missesStagger}/${misses}`);
}

console.log(fails ? `FAIL (${fails} of ${count})` : `PASS (${count})`);
process.exit(fails ? 1 : 0);
