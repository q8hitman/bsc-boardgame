// Phone rooms: a phone creates a room with no big screen, friends join, and a host who drops out of the lobby
// (e.g. to share the link in WhatsApp) comes back as the same host. Run: npx tsx tools/room-sim.ts
import { LocalServer } from "../src/client/local-server";
import * as room from "../src/server/room";
import type { GameState } from "../src/shared/types";

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Res = { ok: true; code: string; playerId: string; token: string } | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <T>(c: any, ev: string, data?: unknown) => new Promise<T>((r) => (data === undefined ? c.emit(ev, r) : c.emit(ev, data, r)));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drop = (srv: LocalServer, id: string) => (srv as any).ends.find((e: { id: string }) => e.id === id).handlers.get("disconnect")();

(room as unknown as { setLobbyGrace(ms: number): void }).setLobbyGrace?.(400);

const srv = new LocalServer();
const a = srv.connect();
await wait(5);
const made = await ask<Res>(a, "room:create", { name: "سارة" });
ok(made.ok && /^[A-Z]{4}$/.test(made.code), "room:create gives a 4-letter code");
if (!made.ok) process.exit(1);
const r = srv.rooms.get(made.code)!;
const st = () => r.state as GameState;
const people = () => st().players.filter((p) => !p.isBot);
ok(st().screen === false, "phone room has no screen");
ok(st().players[0]?.isHost && st().players[0].id === made.playerId && st().players[0].name === "سارة", "creator is host");

const b = srv.connect();
await wait(5);
const joined = await ask<Res>(b, "player:join", { code: made.code, name: "علي" });
ok(joined.ok && !st().players.find((p) => p.id === (joined as { playerId: string }).playerId)?.isHost, "second phone joins, not host");

const scr = srv.connect();
await wait(5);
const screenRoom = await ask<{ code: string }>(scr, "screen:create");
ok(srv.rooms.get(screenRoom.code)?.state.screen === true, "projector room has a screen");

// host leaves the lobby for a moment and comes back with the saved token
drop(srv, a.id);
await wait(20);
ok(people().length === 2 && people()[0].connected === false, "dropped host keeps the seat");
const a2 = srv.connect();
await wait(5);
const back = await ask<Res>(a2, "player:join", { code: made.code, token: made.token });
ok(back.ok && back.playerId === made.playerId, "rejoin with token gets the same player");
ok(st().players.find((p) => p.id === made.playerId)?.isHost && people().length === 2, "still host, still 2 players");

// host leaves for good: after the grace time the seat is freed and the other player becomes host
drop(srv, a2.id);
await wait(700);
ok(people().length === 1 && people()[0].isHost && st().players.length === 4, "after the grace time the other player is host (bots refill the seat)");

// seats: board games are always 4 (the computer fills the empty seats), the card game is free
const s2 = srv.connect();
await wait(5);
const r2made = await ask<Res>(s2, "room:create", { name: "منى" });
if (!r2made.ok) process.exit(1);
const r2 = srv.rooms.get(r2made.code)!;
const humans = () => r2.state.players.filter((p) => !p.isBot).length;
const bots = () => r2.state.players.filter((p) => p.isBot).length;
ok(r2.state.players.length === 4 && bots() === 3, "board game, alone: 3 bots fill the seats");
const s3 = srv.connect();
await wait(5);
await ask<Res>(s3, "player:join", { code: r2made.code, name: "نورة" });
ok(r2.state.players.length === 4 && humans() === 2 && bots() === 2, "a friend joins: 2 people + 2 bots");
const more = [] as unknown[];
for (const n of ["أ", "ب"]) {
  const c = srv.connect();
  await wait(5);
  more.push(await ask<Res>(c, "player:join", { code: r2made.code, name: n }));
}
ok(r2.state.players.length === 4 && humans() === 4 && bots() === 0, "4 people: no bots");
const c5 = srv.connect();
await wait(5);
const fifth = await ask<Res>(c5, "player:join", { code: r2made.code, name: "ج" });
ok(!fifth.ok, "5th person can't join a board game");
s2.emit("host:addBot");
await wait(20);
ok(r2.state.players.length === 4, "host can't add a 5th seat to a board game");
s2.emit("host:setBoard", "cards");
await wait(20);
ok(r2.state.boardId === "cards" && r2.state.players.length === 4, "switch to the card game");
const c6 = srv.connect();
await wait(5);
ok((await ask<Res>(c6, "player:join", { code: r2made.code, name: "د" })).ok && humans() === 5, "card game takes a 5th person");
s2.emit("host:setBoard", "island");
await wait(20);
ok(r2.state.boardId === "cards", "can't go back to a board game with 5 people");

// card game: two friends alone, no bots
const t1 = srv.connect();
await wait(5);
const r3made = await ask<Res>(t1, "room:create", { name: "x" });
if (!r3made.ok) process.exit(1);
const r3 = srv.rooms.get(r3made.code)!;
t1.emit("host:setBoard", "cards");
await wait(20);
for (let i = 0; i < 4; i++) t1.emit("host:removeBot");
await wait(20);
ok(r3.state.players.length === 1, "card game: host can remove every bot");
const t2 = srv.connect();
await wait(5);
await ask<Res>(t2, "player:join", { code: r3made.code, name: "y" });
t1.emit("host:start");
await wait(50);
ok(r3.state.phase !== "lobby" && r3.state.players.length === 2, "card game starts with just two people");

// review findings: a second drop gets a fresh 400 ms grace (not what's left of the first one)
const g1 = srv.connect();
await wait(5);
const gm = await ask<Res>(g1, "room:create", { name: "ه" });
if (!gm.ok) process.exit(1);
const gr = srv.rooms.get(gm.code)!;
const gHuman = () => gr.state.players.find((p) => p.id === gm.playerId);
drop(srv, g1.id);
await wait(100);
const g2 = srv.connect();
await wait(5);
await ask<Res>(g2, "player:join", { code: gm.code, token: gm.token });
await wait(150);
drop(srv, g2.id); // first timer would fire ~150 ms from now
await wait(250);
ok(!!gHuman(), "second drop gets a full grace again");

// both people away at once: when the host's seat is freed, the other one (even away) becomes host
const h1 = srv.connect();
await wait(5);
const hm = await ask<Res>(h1, "room:create", { name: "و" });
if (!hm.ok) process.exit(1);
const hr = srv.rooms.get(hm.code)!;
const h2 = srv.connect();
await wait(5);
const hj = await ask<Res>(h2, "player:join", { code: hm.code, name: "ز" });
if (!hj.ok) process.exit(1);
drop(srv, h1.id);
await wait(200);
drop(srv, h2.id); // host's grace ends at ~400 ms, this one's at ~600 ms
await wait(300);
const h3 = srv.connect();
await wait(5);
await ask<Res>(h3, "player:join", { code: hm.code, token: hj.token });
ok(hr.state.players.find((p) => p.id === hj.playerId)?.isHost, "the one left becomes host even though they were away");

// a broken request must not take the server down
const bad = srv.connect();
await wait(5);
let crashed = false;
process.once("uncaughtException", () => (crashed = true));
bad.emit("room:create", { name: 1 });
bad.emit("player:join", { code: 5 });
bad.emit("screen:create");
await wait(30);
ok(!crashed, "malformed room:create / player:join / screen:create don't crash");

// profile ids: only hex ids are kept (other phones use them as keys)
const pz = srv.connect();
await wait(5);
const pzm = await ask<Res>(pz, "room:create", { name: "ح", profileId: "__proto__" });
const pzr = pzm.ok ? srv.rooms.get(pzm.code) : undefined;
ok(pzr && pzr.state.players[0].profileId === undefined, "a crafted profile id (__proto__) is dropped by the server");
const pz2 = srv.connect();
await wait(5);
await ask<Res>(pz2, "player:join", { code: pzm.ok ? pzm.code : "", name: "ط", profileId: "ab12cd34ef56" });
ok(pzr?.state.players.some((p) => p.profileId === "ab12cd34ef56"), "a normal hex profile id is kept");

for (const x of srv.rooms.values()) x.dispose();
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
