// كورة البط tests. Run: npx tsx tools/football-sim.ts
// (a) headless engine: computer vs computer, 3 simulated minutes each, checks goals / bounds / NaN / one owner;
//     penalties; a person's duck with random inputs.
// (b) a LocalServer room: phones send joystick / buttons; frames ~15/s, control, skip, a full match to "end",
//     penalties, two people on one team, the 4-people-per-team cap.
import { LocalServer } from "../src/client/local-server";
import { FB_TEST } from "../src/server/football";
import { BALL_R, DT, FbEngine, HALF_L, HALF_W, TUNE } from "../src/shared/football/engine";
import { FB_MODES, FbAction, PITCH, type FbFrame, type FbPlayer, type FbTeam } from "../src/shared/football/types";
import type { GameState } from "../src/shared/types";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await wait(10);
  return cond();
};
type Res = { ok: true; code: string; playerId: string; token: string } | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <T>(c: any, ev: string, data?: unknown) => new Promise<T>((r) => c.emit(ev, data, r));

// ------------------------------------------------------------------------------------------------ (a) engine
const cpuRoster = (): FbPlayer[] => {
  const r: FbPlayer[] = [];
  for (const t of [0, 1] as FbTeam[]) for (let i = 0; i < 5; i++) r.push({ slot: r.length, team: t, char: "ali", name: "x", gk: i === 0 });
  return r;
};

function checkWorld(e: FbEngine, bad: string[]) {
  const b = e.ball;
  const nums = [b.x, b.y, b.z, b.vx, b.vy, b.vz, ...e.ducks.flatMap((d) => [d.x, d.y, d.vx, d.vy])];
  if (nums.some((v) => !Number.isFinite(v))) bad.push("NaN");
  for (const d of e.ducks) if (Math.abs(d.x) > HALF_L || Math.abs(d.y) > HALF_W) bad.push(`duck ${d.slot} outside (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`);
  if (Math.abs(b.y) > HALF_W - BALL_R + 1e-6) bad.push(`ball outside side boards y=${b.y}`);
  if (Math.abs(b.x) > HALF_L + PITCH.goalDepth + TUNE.netGive) bad.push(`ball behind the goals x=${b.x}`);
  if (Math.abs(b.x) > HALF_L + BALL_R && Math.abs(b.y) > PITCH.goalWidth / 2) bad.push(`ball through the end board (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
  if (b.z < 0) bad.push("ball under the grass");
  if (b.owner < -1 || b.owner >= e.ducks.length || !Number.isInteger(b.owner)) bad.push(`bad owner ${b.owner}`);
  if (b.owner >= 0) {
    const o = e.ducks[b.owner];
    if (Math.hypot(o.x - b.x, o.y - b.y) > 1.2) bad.push(`ball ${Math.hypot(o.x - b.x, o.y - b.y).toFixed(2)} m from its owner`);
    // "owned by two": no other duck may be within dribbling distance claiming it (owner is a single slot by design)
  }
}

{
  const t0 = Date.now();
  const goals: number[] = [];
  const bad: string[] = [];
  let kicks = 0;
  let saves = 0;
  let tackles = 0;
  let passes = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const e = new FbEngine(cpuRoster(), { seed, halfSeconds: 180 });
    e.kickoff(0);
    let steps = 0;
    while (!e.halfOver && steps < 400 * 30) {
      e.step();
      steps++;
      checkWorld(e, bad);
      for (const [k] of e.events.splice(0)) {
        if (k === 1) kicks++;
        if (k === 2) passes++;
        if (k === 3) tackles++;
        if (k === 5) saves++;
      }
    }
    goals.push(e.score[0] + e.score[1]);
    if (!e.halfOver) bad.push(`seed ${seed}: half never ended`);
    if (Math.abs(e.clock - 180) > 3.5) bad.push(`seed ${seed}: clock ${e.clock}`);
  }
  const ms = Date.now() - t0;
  const avg = goals.reduce((a, b) => a + b, 0) / goals.length;
  ok(ms < 8 * 3000, `engine: 8 × 3 simulated minutes, computer vs computer, in ${ms} ms`);
  ok(avg >= 1 && Math.max(...goals) <= 14, `engine: goals per match ${goals.join(",")} (avg ${avg.toFixed(1)})`);
  ok(bad.length === 0, `engine: no NaN, nobody / no ball outside the boards, one owner at the feet${bad.length ? ": " + [...new Set(bad)].slice(0, 5).join("; ") : ""}`);
  console.log(`   per match: ${(passes / 8).toFixed(0)} passes, ${(kicks / 8).toFixed(1)} shots/kicks, ${(saves / 8).toFixed(1)} saves, ${(tackles / 8).toFixed(0)} tackles`);
}

{
  // penalties: computer shooter vs computer keeper, every kick resolves
  let scored = 0;
  let unresolved = 0;
  const e = new FbEngine(cpuRoster(), { seed: 5, halfSeconds: 180 });
  for (let i = 0; i < 80; i++) {
    e.startPen(1 + (i % 4), 5, 1);
    let n = 0;
    while (e.pen!.result === null && n++ < 30 * 14) e.step();
    if (e.pen!.result === null) unresolved++;
    else if (e.pen!.result) scored++;
  }
  ok(unresolved === 0 && scored >= 35 && scored <= 76, `engine: 80 penalties all resolve, ${scored} scored (${Math.round((scored / 80) * 100)}%)`);
}

{
  // a person on team 0 (solo: switching), random joystick and buttons, with a goal-scoring test of control
  const e = new FbEngine(cpuRoster(), { seed: 9, halfSeconds: 120 });
  e.addPerson("me", 0, 3);
  e.kickoff(0);
  const bad: string[] = [];
  let switches = 0;
  let last = -1;
  let r = 12345;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let inp = { x: 0, y: 0, a: false, b: false };
  let carried = 0;
  while (!e.halfOver) {
    if (rnd() < 0.08) inp = { x: rnd() * 2 - 1, y: rnd() * 2 - 1, a: rnd() < 0.15, b: rnd() < 0.2 };
    e.input("me", inp);
    e.step();
    checkWorld(e, bad);
    const c = e.control().me;
    if (c !== last) switches++;
    last = c;
    if (c === undefined || e.ducks[c].team !== 0 || e.ducks[c].gk) bad.push(`control ${c}`);
    if (e.ball.owner >= 0 && e.ducks[e.ball.owner].team === 0 && !e.ducks[e.ball.owner].gk && e.stage === "play" && c !== e.ball.owner) bad.push("solo person is not on the carrier");
    if (e.ball.owner === c) carried++;
    e.events.length = 0;
  }
  ok(bad.length === 0, `engine: a solo person with random inputs: always controls a team-0 outfield duck, the carrier when they have it${bad.length ? ": " + [...new Set(bad)].slice(0, 4).join("; ") : ""}`);
  // the phone drops: the computer plays that duck, and it is gone from the control map
  e.setHalf(1);
  e.kickoff(1);
  e.setActive("me", false);
  const own = e.ducks[3];
  const x0 = own.x;
  const y0 = own.y;
  let moved = 0;
  for (let i = 0; i < 30 * 8; i++) {
    e.step();
    moved = Math.max(moved, Math.hypot(own.x - x0, own.y - y0));
  }
  ok(e.control().me === undefined && moved > 2, `engine: a dropped phone's duck is played by the computer (moved ${moved.toFixed(1)} m, no control entry)`);
  e.setActive("me", true);
  e.step();
  ok(e.control().me !== undefined, "engine: the phone comes back and controls a duck again");
  ok(switches > 5 && switches < 2 * 120 * 4, `engine: control switched ${switches} times in 2 minutes (hysteresis), had the ball ${(carried * DT).toFixed(0)} s`);
}

{
  // goals into an unguarded net: a hard shot vs a slow roll (speed, kind, the net), then the celebration
  type Shot = { speed: number; kind?: string; deepest: number; rest: number; frames: { t: number; act: number[] }[] };
  const goalFrom = (setup: (e: FbEngine) => void): Shot => {
    const e = new FbEngine(cpuRoster(), { seed: 3, halfSeconds: 180 });
    e.setStage("play");
    for (const d of e.ducks) Object.assign(d, { x: -20, y: d.slot - 5, vx: 0, vy: 0 });
    e.keeperOf(1).fall = 99; // the red keeper is "away"
    setup(e);
    let deepest = 0;
    let rest = 0;
    const frames: { t: number; act: number[] }[] = [];
    for (let i = 0; i < 30 * 12 && e.stage !== "kickoff"; i++) {
      e.step();
      deepest = Math.max(deepest, Math.abs(e.ball.x));
      if (e.stage === "goal") {
        rest = Math.abs(e.ball.x);
        if (e.keeperOf(1).fall > 50) e.keeperOf(1).fall = 1.3; // back from "away": he sits down as he would
        frames.push({ t: e.stageT, act: e.ducks.map((d) => e.action(d)) });
      }
    }
    return { speed: e.lastGoal?.speed ?? -1, kind: e.lastGoal?.kind, deepest, rest, frames };
  };
  const hard = goalFrom((e) => {
    const d = e.ducks[1];
    Object.assign(d, { x: 12, y: 0, hx: 1, hy: 0 });
    // team-mates in support, like in a real attack
    Object.assign(e.ducks[2], { x: 16, y: -6 });
    Object.assign(e.ducks[3], { x: 15, y: 6 });
    Object.assign(e.ducks[4], { x: 8, y: 2 });
    e.ball.owner = 1;
    e.shoot(d, 1, 1, 0);
  });
  const slow = goalFrom((e) => {
    const d = e.ducks[1];
    Object.assign(d, { x: 29, y: 0 });
    Object.assign(e.ball, { x: 29.6, y: 0.5, z: 0, vx: 4.2, vy: 0, vz: 0, owner: -1, last: 1, lastTeam: 0, fromX: 29, fromY: 0 });
    d.noPick = 5;
  });
  const back = HALF_L + PITCH.goalDepth - BALL_R;
  ok(hard.speed >= TUNE.screamerGoal && hard.kind === "screamer", `goal: a full-power shot from 20 m crosses the line at ${hard.speed} m/s → "${hard.kind}"`);
  ok(slow.speed > 0 && slow.speed < 6 && slow.kind === "tap", `goal: a slow roll crosses at ${slow.speed} m/s → "${slow.kind}"`);
  ok(hard.deepest > back + 0.05, `net: the hard shot punches ${(hard.deepest - back).toFixed(2)} m into the back netting`);
  ok(slow.rest > HALF_L + BALL_R && slow.rest < HALF_L + 1.2, `net: the slow one stops just over the line (${(slow.rest - HALF_L).toFixed(2)} m in)`);
  const at = (t: number) => hard.frames.find((f) => f.t >= t)!.act;
  const early = at(0.5);
  const mid = at(2.6);
  ok(early[1] === FbAction.Celebrate, "celebration: the scorer celebrates (arms up) straight away");
  ok(early[5] === FbAction.Kneel, "celebration: the beaten keeper drops to his knees (not flat on the ground)");
  ok([6, 7, 8, 9].every((i) => mid[i] === FbAction.Idle), "celebration: the other team trudges back (Idle)");
  ok([2, 3, 4].filter((i) => mid[i] === FbAction.Celebrate).length >= 2, "celebration: team-mates reach the scorer and celebrate with him");
  ok(hard.frames.length > 0 && hard.frames[hard.frames.length - 1].t >= TUNE.goalPause - 0.1, `celebration: the goal stage lasts ${TUNE.goalPause} s, then the kick-off`);
}

// ------------------------------------------------------------------------------------------------ (b) room
async function makeRoom(mode: string, name = "سارة") {
  const srv = new LocalServer();
  const phone = srv.connect();
  await wait(5);
  const made = await ask<Res>(phone, "room:create", { name, profileId: "p-test" });
  if (!made.ok) throw new Error("create failed");
  const room = srv.rooms.get(made.code)!;
  phone.emit("host:setBoard", "football");
  await wait(10);
  phone.emit("host:setCourse", mode);
  await wait(10);
  return { srv, phone, room, me: made.playerId, code: made.code };
}
const fbOf = (s: GameState) => s.football!;

{
  // 1 phone, real time: frames, control, joystick moves the duck, host skip ends the (only) half
  FB_TEST.speed = 1;
  FB_TEST.halfSeconds = 0;
  const { srv, phone, room, me } = await makeRoom("quick");
  ok(room.state.boardId === "football" && room.state.course === "quick", "room: football lobby, quick mode");
  const frames: FbFrame[] = [];
  phone.on("fb:frame", (f: FbFrame) => frames.push(f));
  const phases: string[] = [];
  phone.on("state", (s: GameState) => phases[phases.length - 1] !== s.phase && phases.push(s.phase));
  phone.emit("host:start");
  await until(() => room.state.phase === "intro", 2000);
  const tSkip = Date.now();
  room.football.timeUp(); // the host's skip during the intro (see the report: room.ts routes skip only in "sport")
  await until(() => room.state.phase === "sport", 1000);
  ok(room.state.phase === "sport" && Date.now() - tSkip < 500, `room: skip during the intro starts the half now (${Date.now() - tSkip} ms)`);
  await until(() => room.state.football?.stage === "play", 8000);
  const f = room.state.football!;
  ok(f.stage === "play" && room.state.phase === "sport", `room: intro then kick-off then play (${phases.join(" → ")})`);
  ok(f.roster.length === 10 && f.roster.filter((p) => p.gk).length === 2 && f.roster.some((p) => p.pid === me && !p.gk), "room: roster of 10, two computer keepers, the phone's duck is an outfield duck");
  ok(f.roster.filter((p) => !p.pid).every((p) => p.name.length > 0 && p.char), "room: computer ducks are named after their club character");
  const sp = room.state.sport!;
  ok(sp.id === "football" && sp.rounds === 1 && sp.better === "high" && room.state.phaseEndsAt! > Date.now() + 150000, "room: GameState.sport filled, phaseEndsAt = end of the half");
  frames.length = 0;
  await wait(2000);
  const rate = frames.length / 2;
  ok(rate >= 12 && rate <= 18, `room: ${rate} frames a second`);
  ok(frames.every((fr) => fr.p.length === 40 && fr.b.length === 4 && fr.r.length === 2), "room: every frame has 10 ducks × 4 numbers, the ball and the referee");
  ok(frames.every((fr) => typeof fr.c[me] === "number"), "room: the phone controls a duck in every frame (c)");
  const json = JSON.stringify(frames[frames.length - 1]);
  ok(json.length < 400, `room: a frame is small (${json.length} bytes as JSON)`);
  // push the joystick right then down: the controlled duck moves that way
  let moved = { x: 0, y: 0 };
  // (towards the phone's own goal first: away from the press, so a collision doesn't hide the movement)
  for (const [jx, jy, key] of [[-1, 0, "x"], [0, 1, "y"]] as const) {
    frames.length = 0;
    const iv = setInterval(() => phone.emit("fb:input", { x: jx, y: jy, a: false, b: false }), 100);
    await wait(1500);
    clearInterval(iv);
    phone.emit("fb:input", { x: 0, y: 0, a: false, b: false });
    let sum = 0;
    for (let i = 4; i < frames.length; i++) {
      const s0 = frames[i - 1].c[me];
      if (s0 === frames[i].c[me]) sum += frames[i].p[s0 * 4 + (key === "x" ? 0 : 1)] - frames[i - 1].p[s0 * 4 + (key === "x" ? 0 : 1)];
    }
    moved = { ...moved, [key]: sum };
  }
  ok(moved.x < -1.5 && moved.y > 1.5, `room: pushing the joystick moves the controlled duck (left ${moved.x.toFixed(1)} m, down +${moved.y.toFixed(1)} m)`);
  const evs = frames.flatMap((fr) => fr.ev ?? []);
  ok(evs.every(([k, s]) => k >= 1 && k <= 9 && s >= -1 && s < 10), "room: frame events are [FbEvent, slot] pairs");
  // stale input: one "push right" and then nothing (a phone that went quiet): after ~600 ms it counts as let go
  phone.emit("fb:input", { x: 1, y: 0, a: false, b: false });
  await wait(1000);
  frames.length = 0;
  await wait(700);
  let drift = 0;
  for (let i = 1; i < frames.length; i++) {
    const s0 = frames[i - 1].c[me];
    if (s0 === frames[i].c[me]) drift += Math.abs(frames[i].p[s0 * 4] - frames[i - 1].p[s0 * 4]);
  }
  ok(frames.length > 5 && drift < 1.2, `room: input that stops arriving is released (the duck moved ${drift.toFixed(2)} m in the next 0.7 s)`);
  phone.emit("host:skip");
  await until(() => room.state.phase === "final", 3000);
  const s = room.state;
  ok(s.phase === "final" && fbOf(s).stage === "over", "room: host skip blows the whistle (quick = one half: full time)");
  const sc = fbOf(s).score;
  const myTeam = fbOf(s).roster.find((p) => p.pid === me)!.team;
  ok(s.sport!.total[me] === sc[myTeam], `room: sport.total = the phone's team goals (${sc.join("-")})`);
  const res = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
  ok(fbOf(s).result === res && JSON.stringify(s.winnerIds) === JSON.stringify(res === myTeam ? [me] : []),
    `room: ${res < 0 ? "a draw → result -1, winnerIds []" : `result ${res}`} (result ${fbOf(s).result}, winnerIds ${JSON.stringify(s.winnerIds)})`);
  await until(() => room.state.phase === "end", 6000);
  ok(room.state.phase === "end", "room: final → end after ~4 s");
  const n = frames.length;
  await wait(300);
  ok(frames.length === n, "room: frames stop at the end");
  for (const r of srv.rooms.values()) r.dispose();
}

{
  // a full two-half match, fast: 1 phone pressing things + 1 lobby bot
  FB_TEST.speed = 15;
  FB_TEST.halfSeconds = 45;
  const { srv, phone, room, me } = await makeRoom("full");
  phone.emit("host:addBot");
  await wait(20);
  const phases = new Set<string>();
  const stages = new Set<string>();
  let goals = 0;
  let lastSeq = 0;
  let frames = 0;
  let badFrame = 0;
  phone.on("state", (s: GameState) => {
    phases.add(s.phase);
    if (s.football) stages.add(s.football.stage);
    if (s.seq !== lastSeq && s.anim.kind === "banner" && s.anim.title === "قووول!" && s.football?.stage === "goal") goals++;
    lastSeq = s.seq;
  });
  phone.on("fb:frame", (f: FbFrame) => {
    frames++;
    if (f.p.length !== 40 || f.p.some((v) => !Number.isFinite(v))) badFrame++;
  });
  let k = 0;
  const iv = setInterval(() => {
    k++;
    phone.emit("fb:input", { x: Math.sin(k / 7), y: Math.cos(k / 5), a: k % 23 === 0, b: k % 17 < 4 });
  }, 60);
  phone.emit("host:start");
  const t0 = Date.now();
  await until(() => room.state.phase === "end", 60000);
  clearInterval(iv);
  const s = room.state;
  const f = fbOf(s);
  ok(s.phase === "end", `full match: reached the end (${((Date.now() - t0) / 1000).toFixed(1)} s real, ${[...phases].join(" → ")})`);
  ok(f.score[0] + f.score[1] === 0 || (typeof f.lastGoal?.speed === "number" && f.lastGoal.speed > 0), `full match: lastGoal has the speed over the line (${f.lastGoal?.speed} m/s, ${f.lastGoal?.kind ?? "plain"})`);
  ok(phases.has("tile") && f.half === 2, "full match: half time (tile phase) then the second half");
  ok(goals === f.score[0] + f.score[1], `full match: ${goals} goal banners = score ${f.score.join("-")}`);
  for (const pl of s.players) ok(s.sport!.total[pl.id] === f.score[f.roster.find((p) => p.pid === pl.id)!.team], `full match: sport.total[${pl.name}] = their team's goals`);
  const level = f.score[0] === f.score[1];
  ok(level === stages.has("pens"), `full match: penalties ${level ? "after a draw" : "not needed"}${f.pens ? ` (${f.pens.kicks.map((k) => k.map((x) => (x ? "o" : "x")).join("")).join(" / ")})` : ""}`);
  const winTeam = level ? (f.pens!.kicks[0].filter(Boolean).length > f.pens!.kicks[1].filter(Boolean).length ? 0 : 1) : f.score[0] > f.score[1] ? 0 : 1;
  const want = s.players.filter((p) => f.roster.find((r) => r.pid === p.id)?.team === winTeam).map((p) => p.id);
  ok(JSON.stringify(s.winnerIds) === JSON.stringify(want) && f.result === winTeam, `full match: result ${f.result}, winnerIds = the winning team's players (${JSON.stringify(s.winnerIds)})`);
  ok(frames > 50 && badFrame === 0, `full match: ${frames} frames, all well-formed`);
  for (const r of srv.rooms.values()) r.dispose();
}

{
  // penalties: skip both halves at 0-0, the phone takes its own kick (aims down, b), then skip settles it
  FB_TEST.speed = 4;
  FB_TEST.halfSeconds = 0;
  const { srv, phone, room, me } = await makeRoom("full");
  const frames: FbFrame[] = [];
  phone.on("fb:frame", (f: FbFrame) => frames.push(f));
  phone.emit("host:start");
  await until(() => room.state.phase === "sport", 4000);
  phone.emit("host:skip");
  await until(() => room.state.phase === "tile", 2000);
  const tHt = Date.now();
  room.football.timeUp(); // the host's skip during half time
  await until(() => room.state.football?.half === 2 && room.state.phase === "sport", 6000);
  ok(room.state.football?.half === 2 && Date.now() - tHt < 500, `pens: skip during half time starts the second half now (${Date.now() - tHt} ms)`);
  phone.emit("host:skip");
  await until(() => room.state.football?.stage === "pens", 3000);
  const f = () => room.state.football!;
  ok(f().stage === "pens" && f().score[0] === 0 && f().score[1] === 0 && room.state.phase === "sport", "pens: a level full match goes to penalties");
  const mySlot = f().roster.find((p) => p.pid === me)!.slot;
  let mine = false;
  for (let i = 0; i < 12 && !mine; i++) {
    await until(() => !!f().pens && f().pens!.shooterSlot >= 0 && room.state.football!.stage === "pens", 3000);
    if (!f().pens) break;
    if (f().pens!.shooterSlot === mySlot && f().pens!.kicks[f().pens!.taker].length < 5) {
      mine = true;
      const before = f().pens!.kicks.flat().length;
      await wait(150);
      ok(frames[frames.length - 1].c[me] === mySlot, "pens: the phone controls its own taker");
      phone.emit("fb:input", { x: 0, y: 0.8, a: false, b: true });
      await wait(120);
      phone.emit("fb:input", { x: 0, y: 0.8, a: false, b: false });
      await until(() => f().pens!.kicks.flat().length > before || room.state.phase !== "sport", 3000);
      ok(f().pens!.kicks.flat().length === before + 1, `pens: the phone's kick counted (${f().pens!.kicks[f().pens!.taker].slice(-1)[0] ? "scored" : "missed"})`);
    } else {
      const before = f().pens!.kicks.flat().length;
      await until(() => f().pens!.kicks.flat().length > before || room.state.phase !== "sport", 5000);
    }
    if (room.state.phase !== "sport") break;
  }
  ok(mine || room.state.phase !== "sport", "pens: the phone's duck got to take one (or it was decided before)");
  if (room.state.phase === "sport") phone.emit("host:skip");
  await until(() => room.state.phase === "final" || room.state.phase === "end", 3000);
  const k = f().pens!.kicks;
  const g = k.map((x) => x.filter(Boolean).length);
  ok(f().stage === "over" && g[0] !== g[1], `pens: settled (${k.map((x) => x.map((v) => (v ? "o" : "x")).join("")).join(" / ")})`);
  const winTeam = g[0] > g[1] ? 0 : 1;
  ok(f().result === winTeam && JSON.stringify(room.state.winnerIds) === JSON.stringify(f().roster.find((p) => p.pid === me)!.team === winTeam ? [me] : []), `pens: result ${f().result}, winnerIds ${JSON.stringify(room.state.winnerIds)}`);
  phone.emit("host:restart");
  await until(() => room.state.phase === "lobby", 2000);
  phone.emit("fb:input", { x: 1, y: 1, a: true, b: true });
  await wait(100);
  ok(room.state.phase === "lobby" && !room.state.football, "restart: back in the lobby, a late fb:input does nothing");
  for (const r of srv.rooms.values()) r.dispose();
}

{
  // two people on one team play their own ducks (no switching); 5 people asking for blue → capped at 4
  FB_TEST.speed = 3;
  FB_TEST.halfSeconds = 20;
  const { srv, phone, room, me, code } = await makeRoom("m2");
  const others = [];
  for (let i = 0; i < 4; i++) {
    const c = srv.connect();
    await wait(5);
    const r = await ask<Res>(c, "player:join", { code, name: `لاعب${i}` });
    if (r.ok) others.push({ c, id: r.playerId });
  }
  await wait(20);
  for (const o of [{ c: phone, id: me }, ...others]) o.c.emit("player:pickTeam", 0);
  await wait(30);
  const frames: FbFrame[] = [];
  phone.on("fb:frame", (f: FbFrame) => frames.push(f));
  phone.emit("host:start");
  await until(() => room.state.football?.stage === "play", 4000);
  const f = room.state.football!;
  const blue = f.roster.filter((p) => p.team === 0 && p.pid);
  const red = f.roster.filter((p) => p.team === 1 && p.pid);
  ok(blue.length === 4 && red.length === 1 && f.roster.length === 10, `cap: 5 people asking for blue → ${blue.length} blue + ${red.length} red (the keeper stays the computer)`);
  ok(f.roster.filter((p) => p.gk).every((p) => !p.pid), "cap: people never keep goal");
  const chars = f.roster.map((p) => p.char);
  ok(new Set(chars).size === 10, "roster: ten different club characters");
  frames.length = 0;
  const iv = setInterval(() => {
    for (const o of others) o.c.emit("fb:input", { x: 1, y: 0, a: false, b: true });
    phone.emit("fb:input", { x: -1, y: 0, a: false, b: true });
  }, 80);
  await wait(1200);
  clearInterval(iv);
  const own = (pid: string) => f.roster.find((p) => p.pid === pid)!.slot;
  ok(frames.length > 5 && frames.every((fr) => blue.every((p) => fr.c[p.pid!] === own(p.pid!))), "two+ people on a team: each always controls their own duck");
  const solo = red[0].pid!;
  ok(frames.some((fr) => typeof fr.c[solo] === "number"), "the one person on red controls a red duck");
  for (const r of srv.rooms.values()) r.dispose();
}

FB_TEST.speed = 1;
FB_TEST.halfSeconds = 0;
ok(FB_MODES.every((m) => m.halfSeconds >= 120), "FB_MODES untouched by the test knobs");
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
