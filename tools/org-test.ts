// Organizer mode test: the host switches to "organize only", adds bots, starts, skips once,
// reconnects mid-game, and the game reaches the end without the organizer ever being a player.
// Usage: npx tsx tools/org-test.ts [serverUrl]
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";

const URL = process.argv[2] ?? "http://localhost:3001";
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const fail = (m: string) => {
  console.error("FAIL:", m);
  process.exit(1);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const screen = io(URL, { transports: ["websocket"] });
const code: string = await new Promise((res) => screen.emit("screen:create", (r: { code: string }) => res(r.code)));
let st: GameState | null = null;
screen.on("state", (s: GameState) => (st = s));

type JoinRes = { ok: boolean; playerId: string; token: string; error?: string };
const join = (sock: ReturnType<typeof io>, token?: string) =>
  new Promise<JoinRes>((res) => sock.emit("player:join", { code, name: "المنظم", token }, (r: JoinRes) => res(r)));

let host = io(URL, { transports: ["websocket"] });
const r = await join(host);
if (!r.ok) fail("join " + r.error);
await wait(200);
if (!st!.players[0]?.isHost) fail("first joiner should be host");

host.emit("host:setPlaying", false);
await wait(200);
if (st!.players.length !== 0) fail("organizer should leave the player list");
if (st!.organizer?.id !== r.playerId) fail("organizer not set");
log("organizer only ✓");

host.emit("host:setPlaying", true);
await wait(200);
if (st!.players.length !== 1 || !st!.players[0].isHost) fail("switch back to playing failed");
host.emit("host:setPlaying", false);
await wait(200);
log("toggle back and forth ✓");

// a normal player joining later must not become host
const guest = io(URL, { transports: ["websocket"] });
const g = await join(guest);
await wait(200);
if (st!.players.find((p) => p.id === g.playerId)?.isHost) fail("guest became host while organizer exists");
guest.emit("host:addBot"); // guest is not host: ignored
await wait(200);
if (st!.players.length !== 1) fail("non-host could add a bot");
guest.disconnect();

host.emit("host:addBot");
host.emit("host:addBot");
host.emit("host:addBot");
host.emit("host:setRounds", 1);
await wait(300);
host.emit("host:start");
await wait(500);
if (st!.phase === "lobby") fail("start failed");
if (st!.order.includes(r.playerId)) fail("organizer is in the turn order");
log("started with", st!.players.length, "players, organizer not playing ✓");

await wait(6000);
host.emit("host:skip");
log("skip sent in phase", st!.phase);

// reconnect with the token: still organizer and still host
host.disconnect();
await wait(500);
host = io(URL, { transports: ["websocket"] });
const r2 = await join(host, r.token);
if (!r2.ok || r2.playerId !== r.playerId) fail("organizer reconnect failed");
await wait(300);
if (!st!.organizer?.connected) fail("organizer not marked connected");
log("reconnect ✓");

host.on("state", (s: GameState) => {
  if (s.phase === "mgIntro" || s.phase === "turn") host.emit("host:skip");
});
const deadline = Date.now() + 240000;
while (st!.phase !== "end" && Date.now() < deadline) await wait(500);
if (st!.phase !== "end") fail("game did not reach the end (phase " + st!.phase + ")");
if (st!.players.some((p) => p.id === r.playerId)) fail("organizer ended up as a player");
log("END reached ✓");
process.exit(0);
