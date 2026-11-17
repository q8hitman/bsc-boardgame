// Headless checks of سلة البط (basketball) rules and physics. Run: npx tsx tools/hoops-sim.ts
import { HOOPS, HOOP_SHOTS, HOOP_SPOTS, RIM_Y, hoopX, hoopsIdeal, simulateHoops, type HoopsLane } from "../src/shared/sports/hoops";
import type { Shot } from "../src/shared/sports/types";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
const shot = (aim: number, power: number, start = 0): Shot => ({ aim, power, spin: 0, start });
const fresh = (round = 0, prev?: HoopsLane) => HOOPS.startRound(round, prev);

// ---- classification
{
  const id = hoopsIdeal(0);
  const sw = simulateHoops(0, id);
  ok(sw.made && sw.kind === 3 && sw.rimHits === 0 && sw.boardHits === 0, `perfect close shot is a clean swish (kind ${sw.kind})`);
  let rimIn: Shot | null = null;
  let rimOut: Shot | null = null;
  for (let d = -0.15; d <= 0.15 && (!rimIn || !rimOut); d += 0.005) {
    const r = simulateHoops(0, shot(0, id.power + d));
    if (r.kind === 2 && r.rimHits > 0 && !rimIn) rimIn = shot(0, id.power + d);
    if (r.kind === 1 && !rimOut) rimOut = shot(0, id.power + d);
  }
  ok(rimIn, "some power off the sweet spot goes in off the rim (kind 2)");
  ok(rimOut, "a bit more off rattles out (kind 1, rim touched)");
  const air = simulateHoops(0, shot(0, 0.05));
  ok(!air.made && air.kind === 0 && air.rimHits === 0, "a weak flick is an airball (kind 0, nothing touched)");
  const wide = simulateHoops(1, shot(0.6, HOOP_SPOTS[1].power));
  ok(!wide.made, "a wild aim misses");
  const lane = fresh();
  if (rimIn) {
    const r = HOOPS.shoot(lane, rimIn, 0);
    ok(r.lane.shots[0][0].pts === 2 && r.replay.label === "دخلت!", `rim-in scores 2 ("${r.replay.label}")`);
  }
  const s3 = HOOPS.shoot(lane, id, 0);
  ok(s3.lane.shots[0][0].pts === 3 && s3.replay.label === "سويش!", `swish scores 3 ("${s3.replay.label}")`);
  const s0 = HOOPS.shoot(lane, shot(0, 0.05), 0);
  ok(s0.lane.shots[0][0].pts === 0 && s0.replay.label === "طاح!", `miss scores 0 ("${s0.replay.label}")`);
  // a long shot banks off the glass sometimes
  let bank = 0;
  for (let d = 0.05; d < 0.3; d += 0.01) {
    const r = simulateHoops(1, shot(0, HOOP_SPOTS[1].power + d));
    if (r.boardHits > 0) bank++;
  }
  ok(bank > 0, `overpowered shots hit the backboard (${bank})`);
}

// ---- fire streak
{
  let l = fresh();
  const best = hoopsIdeal(0);
  const labels: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = HOOPS.shoot(l, best, 0);
    l = r.lane;
    labels.push(r.replay.label ?? "");
  }
  ok(labels[2] === "نار!" && l.fire, `3 makes in a row → نار! (${labels.join(" | ")})`);
  ok(l.shots[0].map((x) => x.pts).join(",") === "3,3,3,6", `makes on fire count double (${l.shots[0].map((x) => x.pts)})`);
  const miss = HOOPS.shoot(l, shot(0, 0.05), 0);
  l = miss.lane;
  ok(!l.fire && l.streak === 0, "a miss puts the fire out");
  ok(!HOOPS.canShoot(l) && l.shots[0].length === HOOP_SHOTS, "5 shots per round");
  const c = HOOPS.card(l, 3);
  ok(c.cards[0] === 15 && c.cards[1] === null && c.total === 15, `card: round total and game total (${JSON.stringify(c)})`);
  // fire carries into the next round
  let l2 = fresh();
  for (let i = 0; i < 3; i++) l2 = HOOPS.shoot(l2, best, 0).lane;
  l2 = HOOPS.startRound(1, l2);
  ok(l2.fire && HOOPS.canShoot(l2) && l2.round === 1, "fire carries into the next round");
  const nxt = HOOPS.shoot(l2, hoopsIdeal(1), 1);
  ok(nxt.lane.shots[1][0].pts === 6 && nxt.lane.shots[1][0].fire, "first make of round 2 on fire = 6");
  const c2 = HOOPS.card(nxt.lane, 3);
  ok(c2.cards[0] === 9 && c2.cards[1] === 6 && c2.total === 15, `per-round totals (${JSON.stringify(c2)})`);
  ok(JSON.stringify(JSON.parse(JSON.stringify(nxt.lane))) === JSON.stringify(nxt.lane), "lane is plain JSON");
}

// ---- the sweet spot is reachable from every spot (and forgiving)
for (let r = 0; r < HOOP_SPOTS.length; r++) {
  const starts = HOOP_SPOTS[r].moving ? [-1, -0.6, -0.2, 0, 0.3, 0.5, 0.8] : [0];
  let swishes = 0;
  for (const st of starts) if (simulateHoops(r, hoopsIdeal(r, st)).kind === 3) swishes++;
  ok(swishes === starts.length, `round ${r + 1}: perfect shot swishes (${swishes}/${starts.length})`);
  const id = hoopsIdeal(r, starts[0]);
  ok(id.power > 0.25 && id.power < 0.9, `round ${r + 1}: sweet spot ${id.power.toFixed(2)} inside the flick range`);
  let lo = 0;
  let hi = 0;
  while (simulateHoops(r, { ...id, power: id.power - lo - 0.005 }).made) lo += 0.005;
  while (simulateHoops(r, { ...id, power: id.power + hi + 0.005 }).made) hi += 0.005;
  ok(lo + hi >= 0.04, `round ${r + 1}: power window ${(id.power - lo).toFixed(3)}..${(id.power + hi).toFixed(3)} (forgiving, ≥0.04)`);
  ok(lo + hi <= 0.25, `round ${r + 1}: power still matters (window ≤0.25)`);
  let a = 0;
  while (simulateHoops(r, { ...id, aim: id.aim + a + 0.005 }).made) a += 0.005;
  ok(a >= 0.04 && a <= 0.2, `round ${r + 1}: aim window ±${((a * 180) / Math.PI).toFixed(1)}°`);
}
{
  // later spots need more power
  const p = HOOP_SPOTS.map((s) => s.power);
  ok(p[0] < p[1] && p[1] < p[2], `sweet spot depends on distance (${p.join(" < ")})`);
}

// ---- moving hoop: deterministic, in the replay
{
  const s = shot(0.04, HOOP_SPOTS[2].power + 0.01, 0.37);
  const a = HOOPS.shoot(fresh(2), s, 2);
  const b = HOOPS.shoot(fresh(2), s, 2);
  ok(JSON.stringify(a) === JSON.stringify(b), "same shot → identical replay and lane (deterministic)");
  const hoop = a.replay.bodies?.[0] ?? [];
  const n = a.replay.ball.length / 3;
  ok(hoop.length === n, `round 3 replay carries the hoop x per sample (${hoop.length}/${n})`);
  const err = Math.max(...hoop.map((x, i) => Math.abs(x - hoopX(2, 0.37, i * a.replay.dt))));
  ok(err < 0.002, `hoop x = function of the shot's own time (max diff ${err.toFixed(4)})`);
  const moved = Math.max(...hoop) - Math.min(...hoop);
  ok(moved > 0.2, `the hoop really slides during the shot (${moved.toFixed(2)} m)`);
  const c = HOOPS.shoot(fresh(2), { ...s, start: -0.5 }, 2);
  ok(JSON.stringify(c.replay.bodies?.[0]) !== JSON.stringify(hoop), "a different phase moves the hoop differently");
  // shooting straight at a moving hoop without leading it misses more than leading it
  let lead = 0;
  let straight = 0;
  for (let k = 0; k < 40; k++) {
    const st = -1 + k / 20;
    const id = hoopsIdeal(2, st);
    if (simulateHoops(2, id).made) lead++;
    if (simulateHoops(2, { ...id, aim: Math.atan2(hoopX(2, st, 0), 6.45) }).made) straight++;
  }
  ok(lead > straight, `leading the moving hoop pays off (${lead} vs ${straight} of 40)`);
  const still = HOOPS.shoot(fresh(0), hoopsIdeal(0), 0);
  ok((still.replay.bodies?.[0] ?? []).length === 0, "rounds 1–2: hoop stands still (no hoop track)");
  ok(hoopX(0, 0.5, 1) === 0 && hoopX(1, 0.5, 1) === 0, "hoopX is 0 in rounds 1–2");
}

// ---- replays: size, timing, rounding, events
{
  let worst = 0;
  let maxN = 0;
  let minMs = 1e9;
  let maxMs = 0;
  let mmOk = true;
  let resOk = true;
  for (let i = 0; i < 300; i++) {
    const r = i % 3;
    const sh = HOOPS.botShot(fresh(r), r, (i % 10) / 10);
    const res = HOOPS.shoot(fresh(r), sh, r);
    const rp = res.replay;
    worst = Math.max(worst, JSON.stringify(rp).length);
    maxN = Math.max(maxN, rp.ball.length / 3);
    minMs = Math.min(minMs, res.ms);
    maxMs = Math.max(maxMs, res.ms);
    if (rp.ball.some((x) => Math.round(x * 1000) / 1000 !== x)) mmOk = false;
    const ev = rp.bodies?.[1] ?? [];
    const last = ev.slice(-3);
    if (last[1] !== 5 || last[2] !== res.lane.shots[r][0].pts || last[0] !== rp.ball.length / 3 - 1) resOk = false;
    if (Math.abs(rp.dt - 1 / 30) > 1e-9) resOk = false;
  }
  ok(mmOk, "ball positions rounded to mm");
  ok(resOk, "replay ends with a result event, dt = 1/30");
  ok(minMs >= 1200 && maxMs <= 2550, `replay length ${minMs}..${maxMs} ms (snappy)`);
  ok(maxN <= 80, `≤ 80 samples per replay (${maxN})`);
  ok(worst < 2600, `replay JSON ≤ 2.6 KB (worst ${worst} bytes)`);
  const made = HOOPS.shoot(fresh(0), hoopsIdeal(0), 0).replay;
  const ev = made.bodies?.[1] ?? [];
  const net = ev.findIndex((_, i) => i % 3 === 1 && ev[i] === 4);
  ok(net >= 0 && made.ball[ev[net - 1] * 3 + 1] < RIM_Y, "a make has a through-the-net event at the right sample");
}

// ---- bots: human-like
{
  for (const [skill, lo, hi] of [[0.3, 0.2, 0.55], [0.7, 0.45, 0.85], [0.95, 0.6, 1]] as const) {
    let makes = 0;
    const N = 900;
    for (let i = 0; i < N; i++) {
      const r = i % 3;
      if (simulateHoops(r, HOOPS.botShot(fresh(r), r, skill)).made) makes++;
    }
    ok(makes / N >= lo && makes / N <= hi, `bot skill ${skill}: ${Math.round((makes / N) * 100)}% makes`);
  }
}

console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
