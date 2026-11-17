// Headless test of the card game "كش!": a screen, 2 phone players (simple strategy over real sockets) and bots.
// Checks: hands stay private and consistent, every played card was legal, the game reaches the end.
// Usage: npx tsx tools/cards-sim.ts [bots] [serverUrl]
import { io } from "socket.io-client";
import { canPlay } from "../src/shared/cards";
import type { Card, GameState } from "../src/shared/types";

const BOTS = Number(process.argv[2] ?? 2);
const URL = process.argv[3] ?? "http://localhost:3001";
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const fail = (msg: string) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

const screen = io(URL, { transports: ["websocket"] });
const code: string = await new Promise((res) => screen.emit("screen:create", (r: { code: string }) => res(r.code)));
log("room", code);

let last: GameState | null = null;
const anims = new Map<string, number>();
let plays = 0;
screen.on("hand", () => fail("the big screen received a hand"));
screen.on("state", (s: GameState) => {
  if (s.seq !== last?.seq) {
    const a = s.anim;
    anims.set(a.kind, (anims.get(a.kind) ?? 0) + 1);
    if (a.kind === "card") {
      plays++;
      // legality is checked against the table before this card landed
      if (last?.table && !canPlay(a.card, last.table)) fail(`illegal card ${JSON.stringify(a.card)} on ${JSON.stringify(last.table.discard.at(-1))} colour ${last.table.color} pending ${last.table.pendingDraw}`);
      const extra = [a.skipped && "skip", a.reversed && "reverse"].filter(Boolean).join(" ");
      log(`  ${a.playerId.slice(0, 7)} plays ${a.card.kind}${a.card.n ?? ""}${a.card.color ?? ""} -> ${a.color} ${extra}`, JSON.stringify(s.table?.counts));
    }
    if (a.kind === "draw") log(`  ${a.playerId.slice(0, 7) || "deal"} draws ${a.n} (${a.why})`);
    if (a.kind === "kwak") log(`  KWAK ${a.playerId.slice(0, 7)}${a.by ? " caught by " + a.by.slice(0, 7) : " called"}`);
    if (a.kind === "win") log("  WIN", a.playerId, JSON.stringify(s.table?.points));
  }
  if (s.table) {
    const total = Object.values(s.table.counts).reduce((x, y) => x + y, 0);
    if (total > 110) fail("more cards in hands than in the deck");
  }
  if (s.phase !== last?.phase && s.phase === "end") {
    log("END", Object.fromEntries(anims));
    if (plays < 5) fail("too few plays");
    console.log("PASS");
    process.exit(0);
  }
  last = s;
});

function player(name: string, host: boolean) {
  const sock = io(URL, { transports: ["websocket"] });
  let me = "";
  let hand: Card[] = [];
  let busy = 0;
  sock.emit("player:join", { code, name }, (r: { ok: boolean; playerId: string; error?: string }) => {
    if (!r.ok) fail(r.error ?? "join");
    me = r.playerId;
  });
  sock.on("hand", (h: Card[]) => (hand = h));
  sock.on("state", (s: GameState) => {
    if (!s.table || !me) return;
    if (hand.length !== s.table.counts[me]) return; // wait for the matching hand
    if (s.table.kwak && s.table.kwak.playerId !== me && Math.random() < 0.3) sock.emit("card:kwak");
    if (s.table.kwak?.playerId === me && Math.random() < 0.7) setTimeout(() => sock.emit("card:kwak"), 400);
    if (s.phase !== "cards" || s.order[s.turnIdx] !== me) return;
    const key = s.seq * 1000 + hand.length;
    if (busy === key) return;
    busy = key;
    setTimeout(() => {
      const t = s.table!;
      if (t.drawn?.playerId === me) {
        const c = hand.find((x) => x.id === t.drawn!.cardId);
        return c ? sock.emit("card:play", { id: c.id, color: "r" }) : sock.emit("card:keep");
      }
      const ok = hand.filter((c) => canPlay(c, t));
      if (!ok.length) return sock.emit("card:draw");
      const c = ok[Math.floor(Math.random() * ok.length)];
      const other = s.players.find((x) => x.id !== me)!.id;
      sock.emit("card:play", { id: c.id, color: (["y", "r", "g", "b"] as const)[Math.floor(Math.random() * 4)], target: other });
    }, 250);
  });
  if (host)
    setTimeout(() => {
      sock.emit("host:setBoard", "cards");
      for (let i = 0; i < BOTS; i++) sock.emit("host:addBot");
      setTimeout(() => sock.emit("host:start"), 400);
    }, 600);
}

player("لاعب١", true);
player("لاعب٢", false);
setTimeout(() => fail("timeout"), 8 * 60 * 1000);
