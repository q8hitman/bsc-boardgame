// بلياردو البط headless test: whole games in a phone room (1 phone + 1–3 computer players), on a fast clock.
// Checks: the game ends, the potted balls add up to 15, a potted white gives the next player the white in hand,
// skip / time-up passes the turn, malformed shots never throw or break the table, and no ball ever ends up off the
// cloth or overlapping another. Run: npx tsx tools/pool-sim.ts
import type { GameState } from "../src/shared/types";

// every timer runs SPEED times faster (replays, turn clocks, bot thinking)
const SPEED = 40;
const realTimeout = globalThis.setTimeout;
(globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => realTimeout(fn, Math.max(0, (ms ?? 0) / SPEED), ...a)) as unknown;

const { LocalServer } = await import("../src/client/local-server");
const { botShot, applyShot, ballsForShot, nextPlayer, newTable, HAND_SPOT } = await import("../src/shared/pool/rules");
const { simulate } = await import("../src/shared/pool/physics");
const { TABLE } = await import("../src/shared/pool/types");
type PoolTable = import("../src/shared/pool/types").PoolTable;

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
let thrown = 0;
process.on("uncaughtException", (e) => {
  thrown++;
  console.log("FAIL uncaught:", e);
});
const wait = (ms: number) => new Promise((r) => realTimeout(r, ms));
type Res = { ok: true; code: string; playerId: string; token: string } | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <T>(c: any, ev: string, data?: unknown) => new Promise<T>((r) => c.emit(ev, data, r));

/** every ball on the cloth, none overlapping (returns what is wrong) */
function tableProblems(t: PoolTable | undefined) {
  if (!t) return ["no table"];
  const bad: string[] = [];
  const on = t.balls.filter((b) => !b.in);
  for (const b of on) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) bad.push(`ball ${b.n} NaN`);
    if (Math.abs(b.x) > TABLE.length / 2 || Math.abs(b.y) > TABLE.width / 2) bad.push(`ball ${b.n} off the cloth (${b.x}, ${b.y})`);
  }
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++) {
      const d = Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y);
      if (d < 2 * TABLE.r - 1e-6) bad.push(`balls ${on[i].n} and ${on[j].n} overlap (${(d * 1000).toFixed(1)} mm apart)`);
    }
  if (t.balls.length !== 16 || new Set(t.balls.map((b) => b.n)).size !== 16) bad.push("not 16 balls");
  if (t.balls.find((b) => b.n === 0)?.in) bad.push("white is off the table between shots");
  return bad;
}

async function makeRoom(bots: number) {
  const srv = new LocalServer();
  const phone = srv.connect();
  await wait(5);
  const made = await ask<Res>(phone, "room:create", { name: "سارة", profileId: "p-test" });
  if (!made.ok) throw new Error("create failed");
  const room = srv.rooms.get(made.code)!;
  phone.emit("host:setBoard", "pool");
  await wait(10);
  for (let i = 0; i < bots; i++) phone.emit("host:addBot");
  await wait(10);
  return { srv, phone, room, me: made.playerId };
}

// ------------------------------------------------------------------ rules: a potted white
{
  const t = newTable(["a", "b"]);
  t.inHand = false;
  // the white sits near the top-right corner, nothing in the way: straight in
  const cue = t.balls.find((b) => b.n === 0)!;
  cue.x = TABLE.length / 2 - 0.25;
  cue.y = TABLE.width / 2 - 0.25;
  const shot = { aim: Math.PI / 4, power: 0.45, spin: 0, start: 0 };
  const res = simulate(ballsForShot(t, shot), shot);
  const out = applyShot(t, "a", res);
  ok(res.fell.includes(0) && out.scratch, "rules: the white aimed into a corner falls");
  ok(out.table.inHand && out.table.shooter === "b", "rules: after the white falls the next player has it in hand");
  const w = out.table.balls.find((b) => b.n === 0)!;
  ok(!w.in && Math.abs(w.x - HAND_SPOT.x) < 0.2, "rules: the white waits at the hand spot");
  ok(tableProblems(out.table).length === 0, "rules: table fine after a scratch");
}

// ------------------------------------------------------------------ whole games
for (const bots of [1, 2, 3]) {
  const { srv, phone, room, me } = await makeRoom(bots);
  ok(room.state.players.length === bots + 1 && room.state.boardId === "pool", `${bots + 1} players: 1 person + ${bots} computer in the lobby`);
  let shots = 0;
  let phoneShots = 0;
  let scratches = 0;
  let scratchOk = 0;
  const problems = new Set<string>();
  const phases = new Set<string>();
  let lastSeq = -1;
  let prevTable: PoolTable | undefined;
  phone.on("state", (s: GameState) => {
    phases.add(s.phase);
    const t = s.sport?.lanes.table as PoolTable | undefined;
    if (s.anim.kind === "shot" && s.seq !== lastSeq) {
      lastSeq = s.seq;
      shots++;
      if (s.anim.playerId === me) phoneShots++;
      for (const p of tableProblems(t)) problems.add(p);
      const label = s.anim.replay.label ?? "";
      if (label.startsWith("البيضا طاحت")) {
        scratches++;
        if (t && prevTable && t.inHand && t.shooter === nextPlayer(prevTable, s.anim.playerId)) scratchOk++;
      }
      // the counts agree with the table
      if (t) for (const p of s.players) if ((t.potted[p.id]?.length ?? 0) !== s.sport!.total[p.id]) problems.add("total ≠ potted");
    }
    if (t && s.anim.kind !== "shot") prevTable = t;
    // the phone plays like a decent person whenever it is its turn
    if (s.phase === "sport" && t && s.sport!.open.includes(me) && t.shooter === me) {
      phone.emit("sport:shot", botShot(t, 0.7));
    }
  });
  phone.emit("host:start");
  const t0 = Date.now();
  while (room.state.phase !== "end" && Date.now() - t0 < 120000) await wait(50);
  const s = room.state;
  const t = s.sport?.lanes.table as PoolTable | undefined;
  ok(s.phase === "end", `${bots + 1} players: reached the end screen (${((Date.now() - t0) / 1000).toFixed(1)}s real, ${shots} shots, ${phoneShots} by the phone)`);
  ok(phases.has("intro") && phases.has("sport") && phases.has("final"), `${bots + 1} players: went intro → sport → final → end`);
  const total = s.players.reduce((a, p) => a + (s.sport?.total[p.id] ?? 0), 0);
  const all = Object.values(t?.potted ?? {}).flat().sort((a, b) => a - b);
  ok(total === 15 && all.join() === Array.from({ length: 15 }, (_, i) => i + 1).join(), `${bots + 1} players: potted counts add up to 15, each ball once (${s.players.map((p) => `${p.name} ${s.sport?.total[p.id]}`).join(", ")})`);
  const best = Math.max(...s.players.map((p) => s.sport?.total[p.id] ?? 0));
  ok((s.winnerIds?.length ?? 0) >= 1 && s.winnerIds!.every((id) => s.sport?.total[id] === best), `${bots + 1} players: winners have the most balls (${s.winnerIds?.length} winner${s.winnerIds?.length === 1 ? "" : "s"})`);
  ok(problems.size === 0, `${bots + 1} players: no ball off the cloth or overlapping after any shot${problems.size ? ": " + [...problems].slice(0, 4).join("; ") : ""}`);
  ok(scratchOk === scratches, `${bots + 1} players: every potted white gave the next player the white in hand (${scratchOk}/${scratches})`);
  for (const r of srv.rooms.values()) r.dispose();
}

// ------------------------------------------------------------------ skip / time-up passes the turn
{
  const { srv, phone, room, me } = await makeRoom(1);
  const bot = room.state.players.find((p) => p.isBot)!.id;
  phone.emit("host:start");
  const t0 = Date.now();
  while (!(room.state.phase === "sport" && room.state.sport?.open.includes(me)) && Date.now() - t0 < 20000) await wait(20);
  const before = room.state.sport!.lanes.table as PoolTable;
  ok(before.shooter === me && before.inHand, "skip: the first player (the phone) breaks with the white in hand");
  phone.emit("host:skip");
  await wait(30);
  const after = room.state.sport!.lanes.table as PoolTable;
  ok(after.shooter === bot && !room.state.sport!.open.includes(me), "skip: the host's skip passes the turn to the next player");
  ok(after.inHand, "skip: the white is still in hand for the next player (it was never placed)");
  // the turn clock: let it run out on the phone's next turn (40 s → 1 s on the fast clock)
  while (!(room.state.phase === "sport" && room.state.sport?.open.includes(me)) && Date.now() - t0 < 30000) await wait(20);
  const shotsBefore = (room.state.sport!.lanes.table as PoolTable).shots;
  const t1 = Date.now();
  while (room.state.sport?.open.includes(me) && Date.now() - t1 < 5000) await wait(20);
  const t2 = room.state.sport!.lanes.table as PoolTable;
  ok(t2.shooter === bot && t2.shots === shotsBefore, `time-up: the turn clock passes the turn without a shot (${((Date.now() - t1) / 1000).toFixed(1)}s real)`);
  for (const r of srv.rooms.values()) r.dispose();
}

// ------------------------------------------------------------------ two quick skips pass one turn; skip in the intro
{
  const { srv, phone, room, me } = await makeRoom(2);
  const bots = room.state.players.filter((p) => p.isBot).map((p) => p.id);
  phone.emit("host:start");
  await wait(20);
  ok(room.state.phase === "intro", "intro: the game opens with the intro");
  room.pool.timeUp(); // the runner's skip during the intro (what room.skip would call)
  await wait(10);
  ok(room.state.phase === "sport" && (room.state.sport!.lanes.table as PoolTable).shooter === me, "intro: a skip in the intro starts the first turn right away");
  const shotsBefore = (room.state.sport!.lanes.table as PoolTable).shots;
  phone.emit("host:skip");
  phone.emit("host:skip");
  phone.emit("host:skip");
  await wait(5);
  // a shot from the next player in the hand-over gap is ignored too
  room.shoot(bots[0], { aim: 0, power: 1, spin: 0, start: 0 });
  await wait(25);
  const t = room.state.sport!.lanes.table as PoolTable;
  ok(t.shooter === bots[0], `skip: three quick skips pass only one turn (shooter is the next player, not ${t.shooter === bots[1] ? "the one after" : "someone else"})`);
  ok(t.shots === shotsBefore, "skip: a shot sent while the turn is being handed over is ignored");
  for (const r of srv.rooms.values()) r.dispose();
}

// ------------------------------------------------------------------ a potted white in a real room
{
  const { srv, phone, room, me } = await makeRoom(1);
  const bot = room.state.players.find((p) => p.isBot)!.id;
  phone.emit("host:start");
  const t0 = Date.now();
  while (!(room.state.phase === "sport" && room.state.sport?.open.includes(me)) && Date.now() - t0 < 20000) await wait(20);
  // set the white up near a corner pocket with nothing in the way, then shoot it straight in
  const t = room.state.sport!.lanes.table as PoolTable;
  const cue = t.balls.find((b) => b.n === 0)!;
  t.inHand = false;
  cue.x = TABLE.length / 2 - 0.25;
  cue.y = TABLE.width / 2 - 0.25;
  const seq = room.state.seq;
  phone.emit("sport:shot", { aim: Math.PI / 4, power: 0.45, spin: 0, start: 0 });
  while (room.state.seq === seq && Date.now() - t0 < 25000) await wait(10);
  const a = room.state.anim;
  const t2 = room.state.sport!.lanes.table as PoolTable;
  ok(a.kind === "shot" && (a.replay.label ?? "").startsWith("البيضا طاحت"), "room: the white went in (\"البيضا طاحت\")");
  ok(t2.inHand && t2.shooter === bot && room.state.sport!.open.includes(bot), "room: the next player has the white in hand");
  const w = t2.balls.find((b) => b.n === 0)!;
  ok(!w.in && w.x <= TABLE.headX, "room: the white waits behind the head string");
  for (const r of srv.rooms.values()) r.dispose();
}

// ------------------------------------------------------------------ malformed shots
{
  const { srv, phone, room, me } = await makeRoom(1);
  phone.emit("host:start");
  const junk: unknown[] = [
    null,
    "boom",
    42,
    { aim: NaN, power: NaN, spin: NaN, start: NaN },
    { aim: Infinity, power: "x", place: { x: NaN, y: 3 } },
    { aim: 1e308, power: 9, spin: -9, start: 9, place: { x: 999, y: -999 } },
    { place: "here" },
    { aim: "1.2", power: "0.5", place: { x: "-0.8", y: "0" } },
  ];
  let sent = 0;
  const t0 = Date.now();
  while (sent < junk.length && Date.now() - t0 < 60000) {
    const s = room.state;
    const t = s.sport?.lanes.table as PoolTable | undefined;
    if (s.phase === "sport" && t?.shooter === me && s.sport!.open.includes(me)) {
      phone.emit("sport:shot", junk[sent++]);
      await wait(15);
      const p = tableProblems(room.state.sport!.lanes.table as PoolTable);
      if (p.length) ok(false, `malformed shot #${sent} broke the table: ${p.join("; ")}`);
    } else await wait(15);
  }
  ok(sent === junk.length, `malformed: all ${junk.length} junk shots were sent on the phone's turns`);
  ok(thrown === 0, "malformed: nothing threw");
  ok(tableProblems(room.state.sport!.lanes.table as PoolTable).length === 0, "malformed: the table is still fine");
  // a shot from someone whose turn it is not is ignored
  const tb = room.state.sport!.lanes.table as PoolTable;
  const other = room.state.players.find((p) => p.id !== tb.shooter)!.id;
  const shotsNow = tb.shots;
  room.shoot(other, { aim: 0, power: 1, spin: 0, start: 0 });
  ok((room.state.sport!.lanes.table as PoolTable).shots === shotsNow, "a shot out of turn is ignored");
  for (const r of srv.rooms.values()) r.dispose();
}

ok(thrown === 0, "no uncaught errors anywhere");
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
