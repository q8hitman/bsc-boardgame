// Mini-golf physics + rules tests. Run: npx tsx tools/golf-sim.ts
// Every hole of every course can be finished by a careful scripted player within the stroke limit, walls never let a
// ball escape under many random shots, water costs a stroke and puts the ball back, replays stay small.
import { COURSES, GOLF, MAX_STROKES, bestShot, inPoly, seedBots, simulate, surfaceAt, wallsOf, type GolfBall } from "../src/shared/sports/golf";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
let s = 7;
const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

for (const c of COURSES) {
  ok(GOLF.rounds(c.id) === 3, `${c.name}: 3 holes`);
  c.holes.forEach((h, hi) => {
    const tag = `${c.name} ${hi + 1} «${h.name}»`;
    // data sanity
    ok(surfaceAt(h, h.tee[0], h.tee[1]) === "green" && surfaceAt(h, h.cup[0], h.cup[1]) !== "water", `${tag}: tee and cup on the green`);

    // a careful player (best shot, no mistakes) finishes it
    let ball = GOLF.startRound(hi, undefined, c.id);
    const t0 = performance.now();
    let shots = 0;
    const path: string[] = [];
    while (GOLF.canShoot(ball) && shots < 10) {
      const b = bestShot(h, ball.x, ball.z, 0);
      ball = GOLF.shoot(ball, { aim: b.aim, power: b.power, spin: 0, start: 0 }, hi, c.id).lane;
      path.push(`(${ball.x.toFixed(1)},${ball.z.toFixed(1)})`);
      shots++;
    }
    const ms = (performance.now() - t0) / Math.max(1, shots);
    ok(ball.holed && ball.strokes[hi] <= MAX_STROKES, `${tag}: scripted player holes out in ${ball.strokes[hi]} (par ${h.par}) ${path.join(" → ")} · ${ms.toFixed(0)} ms/shot search`);

    // a hole-in-one route exists from the tee (info + fine search)
    let hio = false;
    for (let a = 0; a < 720 && !hio; a++)
      for (let p = 0.05; p <= 1 && !hio; p += 0.025) if (simulate(h, h.tee[0], h.tee[1], (a / 720) * Math.PI * 2, p, false).holed) hio = true;
    console.log(`     hole-in-one route from the tee: ${hio ? "yes" : "no"}`);

    // random shots from random spots: never escape, always end on the course, small replays
    let escaped = 0, outside = 0, maxLen = 0, waters = 0, holed = 0;
    let x = h.tee[0], z = h.tee[1];
    for (let i = 0; i < 1500; i++) {
      const r = simulate(h, x, z, rnd() * Math.PI * 2, rnd());
      if (r.escaped) escaped++;
      if (!inPoly(r.x, r.z, h.outline) && !r.water) outside++;
      if (r.water) waters++;
      if (r.holed) holed++;
      maxLen = Math.max(maxLen, r.ball.length / 3);
      if (r.ball.some((v) => !Number.isFinite(v))) outside++;
      // continue from where it stopped (or restart at the tee)
      if (r.holed || rnd() < 0.15) [x, z] = h.tee;
      else [x, z] = [r.x, r.z];
    }
    ok(escaped === 0 && outside === 0, `${tag}: 1500 random shots, none escaped the walls (water ${waters}, holed ${holed})`);
    ok(maxLen <= 190, `${tag}: longest replay ${maxLen} frames (${(maxLen / 30).toFixed(1)} s)`);
    void wallsOf;
  });
}

// determinism
{
  const h = COURSES[2].holes[0];
  const a = simulate(h, h.tee[0], h.tee[1], -1.4, 0.83);
  const b = simulate(h, h.tee[0], h.tee[1], -1.4, 0.83);
  ok(JSON.stringify(a) === JSON.stringify(b) && a.ball.length > 30, "same shot, same replay (deterministic)");
  ok(a.ball.every((v) => Math.round(v * 1000) / 1000 === v), "replay rounded to mm");
}

// water penalty: off the side of the narrow bridge
{
  const course = "island";
  let ball: GolfBall = GOLF.startRound(1, undefined, course);
  const res = GOLF.shoot(ball, { aim: -Math.PI / 2 + 0.16, power: 0.55, spin: 0, start: 0 }, 1, course);
  ok(res.lane.strokes[1] === 2 && res.lane.x === ball.x && res.lane.z === ball.z, `water costs +1 and returns the ball (strokes ${res.lane.strokes[1]}, label ${res.replay.label})`);
  ok(res.replay.label?.startsWith("ماي"), "water label");
  const last = res.replay.ball.slice(-3);
  ok(Math.abs(last[0] - ball.x) < 0.01 && Math.abs(last[2] - ball.z) < 0.01, "replay ends back at the shot spot");
  ok(res.ms > 500 && res.ms < 6000, `replay ms ${res.ms}`);
  // the volcano: overshoot into the sea through the open edge
  ball = GOLF.startRound(2, undefined, course);
  const sea = GOLF.shoot(ball, { aim: -Math.PI / 2, power: 1, spin: 0, start: 0 }, 2, course);
  ok(sea.replay.label?.startsWith("ماي") && sea.lane.strokes[2] === 2, `volcano overshoot lands in the sea (${sea.replay.label})`);
}

// rules: stroke limit, card, next hole
{
  const course = "desert";
  let ball = GOLF.startRound(0, undefined, course);
  ok(GOLF.canShoot(ball) && ball.strokes[0] === 0, "fresh hole: can shoot, 0 strokes");
  ok(GOLF.card(ball, 3).cards.every((v) => v === null), "card empty before the first shot");
  let n = 0;
  while (GOLF.canShoot(ball) && n < 20) {
    ball = GOLF.shoot(ball, { aim: Math.PI / 2, power: 0.05, spin: 0, start: 0 }, 0, course).lane;
    n++;
  }
  ok(!GOLF.canShoot(ball) && ball.done && !ball.holed && ball.strokes[0] === MAX_STROKES + 1, `stroke limit: stops after ${n} shots, hole counts ${ball.strokes[0]}`);
  const next = GOLF.startRound(1, ball, course);
  ok(next.hole === 1 && next.strokes[0] === MAX_STROKES + 1 && GOLF.canShoot(next) && next.x === COURSES[1].holes[1].tee[0], "next hole: on its tee, history kept");
  const card = GOLF.card(next, 3);
  ok(card.cards[0] === 7 && card.cards[1] === null && card.total === 7, `card ${JSON.stringify(card)}`);
  // hole in one label
  const lab = COURSES[2].holes[0];
  let found = "";
  for (let a = 0; a < 720 && !found; a++)
    for (let p = 0.05; p <= 1 && !found; p += 0.02) {
      const r = simulate(lab, lab.tee[0], lab.tee[1], (a / 720) * Math.PI * 2, p, false);
      if (r.holed) {
        const res = GOLF.shoot(GOLF.startRound(0, undefined, "lab"), { aim: (a / 720) * Math.PI * 2, power: p, spin: 0, start: 0 }, 0, "lab");
        found = res.replay.label ?? "-";
        ok(res.lane.holed && res.lane.done && !GOLF.canShoot(res.lane), "holed: done for this hole");
      }
    }
  ok(found === "هول إن ون!", `hole in one label (${found})`);
}

// bots: fun but beatable — average strokes per hole by skill
{
  seedBots(99);
  for (const skill of [0.3, 0.55, 0.9]) {
    let total = 0, holes = 0, worst = 0;
    const t0 = performance.now();
    let shotsN = 0;
    for (const c of COURSES)
      c.holes.forEach((_h, hi) => {
        let b = GOLF.startRound(hi, undefined, c.id);
        while (GOLF.canShoot(b)) {
          b = GOLF.shoot(b, GOLF.botShot(b, hi, skill, c.id), hi, c.id).lane;
          shotsN++;
        }
        total += b.strokes[hi];
        worst = Math.max(worst, b.strokes[hi]);
        holes++;
      });
    const ms = (performance.now() - t0) / shotsN;
    console.log(`     bot skill ${skill}: ${(total / holes).toFixed(2)} strokes/hole (worst ${worst}), ${ms.toFixed(0)} ms per bot shot`);
    ok(ms < 400, `bot skill ${skill} thinks fast enough (${ms.toFixed(0)} ms)`);
  }
}

console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
