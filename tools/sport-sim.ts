// Plays whole bowling and golf games headless: 1 phone (shooting on its own) + 2 computer players, in a phone room.
// Checks every round ends, scores add up and the game reaches the end screen. Run: npx tsx tools/sport-sim.ts [bowling|golf]
import { LocalServer } from "../src/client/local-server";
import { SPORTS } from "../src/shared/sports";
import type { GameState } from "../src/shared/types";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Res = { ok: true; code: string; playerId: string; token: string } | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <T>(c: any, ev: string, data?: unknown) => new Promise<T>((r) => c.emit(ev, data, r));

const only = process.argv[2];
for (const id of ["bowling", "golf", "hoops"] as const) {
  if (only && only !== id) continue;
  const srv = new LocalServer();
  const phone = srv.connect();
  await wait(5);
  const made = await ask<Res>(phone, "room:create", { name: "سارة", profileId: "p-test" });
  if (!made.ok) throw new Error("create failed");
  const room = srv.rooms.get(made.code)!;
  phone.emit("host:setBoard", id);
  await wait(10);
  phone.emit("host:addBot");
  phone.emit("host:addBot");
  await wait(10);
  ok(room.state.players.length === 3 && room.state.boardId === id, `${id}: 1 person + 2 bots in the lobby`);
  let shots = 0;
  let rounds = 0;
  const phases = new Set<string>();
  phone.on("state", (s: GameState) => {
    phases.add(s.phase);
    if (s.anim.kind === "sportRound") rounds++;
    const sp = s.sport;
    // the phone shoots like a person: whenever it may, a decent random shot
    if (s.phase === "sport" && sp && sp.open.includes(made.playerId) && (sp.busyUntil[made.playerId] ?? 0) <= Date.now()) {
      shots++;
      phone.emit("sport:shot", SPORTS[id].botShot(sp.lanes[made.playerId], sp.round, 0.7, sp.course));
    }
  });
  phone.emit("host:start");
  const t0 = Date.now();
  while (room.state.phase !== "end" && Date.now() - t0 < 240000) await wait(200);
  const s = room.state;
  ok(s.phase === "end", `${id}: reached the end screen (${Math.round((Date.now() - t0) / 1000)}s, ${rounds} rounds, ${shots} phone shots)`);
  ok(rounds === s.sport?.rounds, `${id}: played every round (${rounds}/${s.sport?.rounds})`);
  ok(s.players.every((p) => Number.isFinite(s.sport?.total[p.id])), `${id}: everyone has a total`);
  ok((s.winnerIds?.length ?? 0) >= 1, `${id}: has a winner`);
  console.log(`   totals: ${s.players.map((p) => `${p.name} ${s.sport?.total[p.id]}`).join(", ")}`);
  ok(phases.has("sport") && phases.has("final"), `${id}: went through sport → final → end`);
  for (const r of srv.rooms.values()) r.dispose();
}
// players who never shoot: the host skips each round; their remaining shots count as misses, quickly
for (const id of ["golf", "hoops", "bowling"] as const) {
  if (only && only !== id) continue;
  const srv = new LocalServer();
  const host = srv.connect();
  await wait(5);
  const made = await ask<Res>(host, "room:create", { name: "منظم" });
  if (!made.ok) throw new Error("create failed");
  const room = srv.rooms.get(made.code)!;
  host.emit("host:setBoard", id);
  for (let i = 0; i < 3; i++) {
    const c = srv.connect();
    await wait(5);
    await ask<Res>(c, "player:join", { code: made.code, name: `بطيء${i}` });
  }
  let slowest = 0;
  host.on("state", (s: GameState) => {
    if (s.phase === "sport" && s.anim.kind === "sportRound") {
      const t = Date.now();
      host.emit("host:skip");
      setTimeout(() => (slowest = Math.max(slowest, Date.now() - t)), 0);
    }
  });
  host.emit("host:start");
  const t0 = Date.now();
  while (room.state.phase !== "end" && Date.now() - t0 < 120000) await wait(100);
  const sp = room.state.sport!;
  ok(room.state.phase === "end", `${id}: skipping every round ends the game (${Math.round((Date.now() - t0) / 1000)}s)`);
  const exp = id === "golf" ? 7 * sp.rounds : 0;
  ok(room.state.players.every((p) => sp.total[p.id] === exp), `${id}: nobody who never shot gets a free score (totals ${room.state.players.map((p) => sp.total[p.id]).join("/")}, expected ${exp})`);
  for (const r of srv.rooms.values()) r.dispose();
}
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
