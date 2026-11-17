// Bowling rules + physics tests (no server, no browser). Run: npx tsx tools/bowling-sim.ts
import { BOWLING, FRAMES, HEAD_Z, RACK, ballXAt, frameMarks, scoreFrames, simulateRoll, type BowlingLane } from "../src/shared/sports/bowling";
import type { Shot } from "../src/shared/sports/types";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const full = () => Array(10).fill(true) as boolean[];
const rack = () => RACK.flat();
/** aim that brings the ball to x = tx at the head pin */
const aimFor = (power: number, spin: number, start: number, tx: number) => {
  let lo = -0.12, hi = 0.12;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (ballXAt({ aim: m, power, spin, start }, HEAD_Z - 0.17) < tx) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

// ------------------------------------------------------------------ scoring
{
  const perfect = [[10], [10], [10], [10], [10, 10, 10]];
  ok(eq(scoreFrames(perfect).cards, [30, 60, 90, 120, 150]) && scoreFrames(perfect).total === 150, "perfect game = 150 (5 frames)");
  const spares = [[5, 5], [5, 5], [5, 5], [5, 5], [5, 5, 5]];
  ok(eq(scoreFrames(spares).cards, [15, 30, 45, 60, 75]), "all 5-spares = 75");
  const open = [[3, 4], [0, 0], [9, 0], [1, 2], [4, 4]];
  ok(eq(scoreFrames(open).cards, [7, 7, 16, 19, 27]) && scoreFrames(open).total === 27, "open frames add up (27)");
  const mixed = [[10], [7, 3], [9, 0], [10], [10, 10, 5]];
  ok(eq(scoreFrames(mixed).cards, [20, 39, 48, 78, 103]), "strike / spare / open / 5th-frame bonus = 103");
  const lastSpare = [[0, 0], [0, 0], [0, 0], [0, 0], [6, 4, 7]];
  ok(eq(scoreFrames(lastSpare).cards, [0, 0, 0, 0, 17]), "spare in the 5th frame gets its bonus ball (17)");
  const pending = [[10], [], [], [], []];
  const p = scoreFrames(pending);
  ok(eq(p.cards, [null, null, null, null, null]) && p.total === 10, "strike waits for its bonus (null), running total 10");
  const pending2 = [[10], [3], [], [], []];
  ok(eq(scoreFrames(pending2).cards, [null, null, null, null, null]) && scoreFrames(pending2).total === 16, "strike + one bonus roll: still null, running total counts the bonus");
  const pending3 = [[10], [3, 4], [], [], []];
  ok(eq(scoreFrames(pending3).cards, [17, 24, null, null, null]), "strike resolves after two rolls (17, 24)");
  const lastOpen = [[10], [10], [1, 1], [0, 0], [10, 3]];
  ok(scoreFrames(lastOpen).cards[4] === null, "5th frame strike + 1 bonus: not finished yet");
}
{
  ok(eq(frameMarks([10], false), ["X"]), "marks: X");
  ok(eq(frameMarks([7, 3], false), ["7", "/"]), "marks: 7 /");
  ok(eq(frameMarks([0, 0], false), ["-", "-"]), "marks: - -");
  ok(eq(frameMarks([10, 10, 10], true), ["X", "X", "X"]), "marks: last X X X");
  ok(eq(frameMarks([10, 3, 7], true), ["X", "3", "/"]), "marks: last X 3 /");
  ok(eq(frameMarks([7, 3, 10], true), ["7", "/", "X"]), "marks: last 7 / X");
  ok(eq(frameMarks([9, 0], true), ["9", "-"]), "marks: last 9 -");
}

// ------------------------------------------------------------------ canShoot / frame flow
{
  const L = (frame: number, f: number[]): BowlingLane => {
    const rolls: number[][] = Array.from({ length: FRAMES }, () => []);
    rolls[frame] = f;
    return { frame, rolls, standing: full(), pos: rack() };
  };
  ok(BOWLING.canShoot(L(0, [])) && BOWLING.canShoot(L(0, [4])), "frame 1: 2 rolls");
  ok(!BOWLING.canShoot(L(0, [10])) && !BOWLING.canShoot(L(0, [4, 3])), "frame 1: done after a strike or 2 rolls");
  ok(BOWLING.canShoot(L(4, [10, 2])) && BOWLING.canShoot(L(4, [6, 4])), "frame 5: bonus ball after strike / spare");
  ok(!BOWLING.canShoot(L(4, [6, 3])) && !BOWLING.canShoot(L(4, [10, 10, 10])), "frame 5: done after open frame / 3 balls");
  ok(BOWLING.rounds() === 5 && BOWLING.better === "high" && BOWLING.roundSeconds >= 30, "5 frames, high wins");
  const s1 = BOWLING.startRound(0, undefined);
  const s2 = BOWLING.startRound(1, { ...s1, rolls: [[3, 4]], standing: [false, ...Array(9).fill(true)] });
  ok(s2.frame === 1 && eq(s2.rolls[0], [3, 4]) && s2.standing.every(Boolean) && eq(s2.pos, rack()), "startRound keeps history, resets the rack");
}

// ------------------------------------------------------------------ physics
{
  // a straight pocket shot at good power usually strikes
  let strikes = 0;
  let n = 0;
  for (const power of [0.6, 0.68, 0.76, 0.84, 0.92]) {
    for (const tx of [0.055, 0.06, 0.065]) {
      const r = simulateRoll(full(), rack(), { aim: aimFor(power, 0, 0, tx), power, spin: 0, start: 0 });
      n++;
      if (r.knocked === 10) strikes++;
    }
  }
  ok(strikes / n >= 0.5, `straight pocket shot strikes usually (${strikes}/${n})`);
  // with a hook into the pocket too
  let hs = 0;
  let hn = 0;
  for (const power of [0.6, 0.7, 0.8, 0.9]) {
    for (const [spin, start] of [[-0.5, 0.4], [-0.8, 0.6], [0.6, -0.5]]) {
      const tx = spin < 0 ? 0.06 : -0.06;
      const r = simulateRoll(full(), rack(), { aim: aimFor(power, spin, start, tx), power, spin, start });
      hn++;
      if (r.knocked === 10) hs++;
    }
  }
  ok(hs / hn >= 0.4, `hook into the pocket strikes often (${hs}/${hn})`);
  // head-on is worse than the pocket
  let head = 0;
  for (const power of [0.6, 0.7, 0.8, 0.9]) head += simulateRoll(full(), rack(), { aim: aimFor(power, 0, 0, 0), power, spin: 0, start: 0 }).knocked === 10 ? 1 : 0;
  ok(head <= 1, `dead-centre hit rarely strikes (${head}/4)`);
  // extreme angle gutters
  for (const [aim, start] of [[0.15, 0], [-0.15, 0], [0.08, 0.9], [-0.08, -0.9]]) {
    const r = simulateRoll(full(), rack(), { aim, power: 0.8, spin: 0, start });
    ok(r.knocked === 0 && r.gutter, `extreme shot (aim ${aim}, start ${start}) goes in the gutter: ${r.knocked} pins`);
  }
  const g = BOWLING.shoot(BOWLING.startRound(0, undefined), { aim: 0.15, power: 0.8, spin: 0, start: 0 }, 0);
  ok(g.replay.label === "قناة!", `gutter label (${g.replay.label})`);
  // a big hook curves: full spin moves the ball ~half a metre
  const dx = ballXAt({ aim: 0, power: 0.7, spin: -1, start: 0 }, HEAD_Z);
  ok(dx < -0.4 && dx > -0.8, `full hook curves ${dx.toFixed(2)} m`);
  // a wide shot leaves pins
  let wide = 0;
  for (const power of [0.6, 0.75, 0.9]) wide += simulateRoll(full(), rack(), { aim: aimFor(power, 0, 0, 0.3), power, spin: 0, start: 0 }).knocked;
  ok(wide / 3 < 8.5, `a shot at the 6-10 side leaves pins (avg ${(wide / 3).toFixed(1)})`);

  // replays: sane size and length, deterministic, no NaN
  let maxBytes = 0;
  let minMs = 1e9;
  let maxMs = 0;
  let bad = 0;
  for (let i = 0; i < 60; i++) {
    const shot: Shot = { aim: (Math.random() - 0.5) * 0.03, power: Math.random(), spin: Math.random() * 2 - 1, start: Math.random() * 2 - 1 };
    const r = simulateRoll(full(), rack(), shot);
    const js = JSON.stringify(r.replay);
    maxBytes = Math.max(maxBytes, js.length);
    minMs = Math.min(minMs, r.ms);
    maxMs = Math.max(maxMs, r.ms);
    const n = r.replay.ball.length / 3;
    if (!r.replay.bodies || r.replay.bodies.length !== 10 || r.replay.bodies.some((b) => (b.length - 1) % 5 || b[0] + (b.length - 1) / 5 > n || b.length < 6)) bad++;
    if (js.includes("null") || [...r.replay.ball, ...r.replay.bodies!.flat()].some((v) => !Number.isFinite(v))) bad++;
    if (Math.abs((n - 1) * r.replay.dt * 1000 + 150 - r.ms) > 40) bad++;
  }
  ok(bad === 0, "replays are well formed (10 pins, 5 numbers per sample, no NaN, ms matches samples)");
  ok(maxBytes < 26000, `replay JSON small enough (max ${maxBytes} bytes)`);
  ok(minMs >= 2500 && maxMs <= 4700, `replay length ${minMs}–${maxMs} ms`);
  const shot: Shot = { aim: 0.004, power: 0.77, spin: -0.4, start: 0.3 };
  ok(JSON.stringify(simulateRoll(full(), rack(), shot)) === JSON.stringify(simulateRoll(full(), rack(), shot)), "deterministic: same shot, same replay");
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) simulateRoll(full(), rack(), { ...shot, aim: i * 0.0005 });
  const per = (performance.now() - t0) / 40;
  ok(per < 40, `fast enough for the server (${per.toFixed(1)} ms per roll)`);
}

// ------------------------------------------------------------------ second ball keeps the standing pins
{
  let lane = BOWLING.startRound(0, undefined);
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    const r = BOWLING.shoot(lane, { aim: aimFor(0.7, 0, 0, 0.2 + i * 0.01), power: 0.7, spin: 0, start: 0 }, 0);
    if (r.lane.rolls[0][0] < 10) {
      found = true;
      const left = r.lane.standing.filter(Boolean).length;
      ok(left === 10 - r.lane.rolls[0][0] && BOWLING.canShoot(r.lane), `after ${r.lane.rolls[0][0]} pins, ${left} stay standing for the 2nd ball`);
      lane = r.lane;
      const r2 = BOWLING.shoot(lane, BOWLING.botShot(lane, 0, 0.8), 0);
      const k2 = r2.lane.rolls[0][1];
      ok(k2 >= 0 && k2 <= left && !BOWLING.canShoot(r2.lane), `2nd ball knocks ${k2} of ${left}, frame done`);
      ok(r2.lane.standing.every(Boolean), "frame done: rack reset");
      const fallen = r.lane.standing.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      ok(fallen.every((i) => r2.replay.bodies![i][2] < 0), "swept pins are hidden in the 2nd replay");
    }
  }
  ok(found, "found an open first ball");
}

// ------------------------------------------------------------------ 5th frame: strike gets a fresh rack
{
  const rolls: number[][] = [[0, 0], [0, 0], [0, 0], [0, 0], []];
  let lane: BowlingLane = { frame: 4, rolls, standing: full(), pos: rack() };
  let r = BOWLING.shoot(lane, { aim: aimFor(0.75, 0, 0, 0.06), power: 0.75, spin: 0, start: 0 }, 4);
  for (let i = 0; i < 40 && r.lane.rolls[4][0] !== 10; i++) r = BOWLING.shoot(lane, { aim: aimFor(0.6 + i * 0.008, 0, 0, 0.06), power: 0.6 + i * 0.008, spin: 0, start: 0 }, 4);
  ok(r.lane.rolls[4][0] === 10, "5th frame strike");
  ok(r.lane.standing.every(Boolean) && BOWLING.canShoot(r.lane), "strike in the 5th frame: fresh rack, keep rolling");
  lane = r.lane;
  r = BOWLING.shoot(lane, BOWLING.botShot(lane, 4, 0.8), 4);
  ok(BOWLING.canShoot(r.lane), "5th frame: 3rd ball after a strike");
  r = BOWLING.shoot(r.lane, BOWLING.botShot(r.lane, 4, 0.8), 4);
  ok(!BOWLING.canShoot(r.lane) && r.lane.rolls[4].length === 3, "5th frame ends after 3 balls");
}

// ------------------------------------------------------------------ whole games with bots
{
  const stats: Record<string, { strikes: number; balls: number; total: number; games: number }> = {};
  for (const skill of [0.3, 0.6, 0.9]) {
    const st = (stats[skill] = { strikes: 0, balls: 0, total: 0, games: 0 });
    for (let g = 0; g < 25; g++) {
      let lane: BowlingLane | undefined;
      for (let f = 0; f < FRAMES; f++) {
        lane = BOWLING.startRound(f, lane);
        let guard = 0;
        while (BOWLING.canShoot(lane) && guard++ < 5) {
          const fresh = lane.standing.every(Boolean);
          const r = BOWLING.shoot(lane, BOWLING.botShot(lane, f, skill), f);
          if (fresh) {
            st.balls++;
            if (r.lane.rolls[f][r.lane.rolls[f].length - 1] === 10) st.strikes++;
          }
          lane = r.lane;
        }
        if (guard > 4) ok(false, "frame never ends");
      }
      const c = BOWLING.card(lane!, FRAMES);
      if (c.cards.some((x) => x === null) || c.cards[FRAMES - 1] !== c.total || c.total > 150) ok(false, `bad card ${JSON.stringify(c)} ${JSON.stringify(lane!.rolls)}`);
      st.total += c.total;
      st.games++;
    }
  }
  for (const [k, s] of Object.entries(stats)) console.log(`   bot skill ${k}: ${((100 * s.strikes) / s.balls).toFixed(0)}% strikes, avg score ${(s.total / s.games).toFixed(1)}`);
  ok(stats["0.9"].total > stats["0.3"].total, "better bots score more");
  ok(stats["0.9"].strikes / stats["0.9"].balls < 0.75, "even good bots are not perfect");
  ok(stats["0.3"].strikes > 0, "weak bots strike sometimes");
}

console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
