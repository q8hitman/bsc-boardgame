// Joins an existing room (shown on a big screen) as the host, picks the card game, adds bots and starts.
// The host itself plays like a person (a bit slower) so the screen can be watched / screenshotted.
// Usage: npx tsx tools/cards-drive.ts <CODE> [bots=3] [humans to wait for before starting=1] [serverUrl]
import { io } from "socket.io-client";
import { canPlay } from "../src/shared/cards";
import type { Card, GameState } from "../src/shared/types";

const CODE = process.argv[2];
const BOTS = Number(process.argv[3] ?? 3);
const HUMANS = Number(process.argv[4] ?? 1);
let started = false;
const URL = process.argv[5] ?? "http://localhost:3001";
const sock = io(URL, { transports: ["websocket"] });
let me = "";
let hand: Card[] = [];
let busy = -1;
sock.emit("player:join", { code: CODE, name: "عبدالله" }, (r: { ok: boolean; playerId: string; error?: string }) => {
  if (!r.ok) throw new Error(r.error);
  me = r.playerId;
  sock.emit("player:pickPiece", 10);
  sock.emit("host:setBoard", "cards");
  for (let i = 0; i < BOTS; i++) sock.emit("host:addBot");
});
sock.on("hand", (h: Card[]) => (hand = h));
sock.on("state", (s: GameState) => {
  if (!started && s.phase === "lobby" && s.boardId === "cards" && s.players.filter((p) => !p.isBot).length >= HUMANS) {
    started = true;
    setTimeout(() => sock.emit("host:start"), 1200);
  }
  if (s.phase === "end") {
    console.log("END");
    setTimeout(() => process.exit(0), 500);
  }
  const t = s.table;
  if (!t || s.phase !== "cards" || s.order[s.turnIdx] !== me || hand.length !== t.counts[me]) return;
  if (busy === s.seq) return;
  busy = s.seq;
  setTimeout(() => {
    if (t.drawn) return sock.emit("card:play", { id: t.drawn.cardId, color: "b" });
    const ok = hand.filter((c) => canPlay(c, t));
    if (!ok.length) return sock.emit("card:draw");
    if (hand.length === 2) sock.emit("card:kwak");
    sock.emit("card:play", { id: ok[0].id, color: "g" });
  }, 1600);
});
