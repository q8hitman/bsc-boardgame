// Headless end-to-end test: a screen + 2 phone players + 2 bots play a full game over real sockets.
// Usage: npx tsx tools/sim.ts [rounds] [serverUrl]
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";

const ROUNDS = Number(process.argv[2] ?? 2);
const URL = process.argv[3] ?? "http://localhost:3001";
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const screen = io(URL, { transports: ["websocket"] });
const code: string = await new Promise((res) => screen.emit("screen:create", (r: { code: string }) => res(r.code)));
log("room", code);

let last: GameState | null = null;
const phases: string[] = [];
const anims = new Map<string, number>();
screen.on("state", (s: GameState) => {
  if (s.seq !== last?.seq) {
    anims.set(s.anim.kind, (anims.get(s.anim.kind) ?? 0) + 1);
    if (s.anim.kind === "roll") log("  roll", s.anim.values.join("+"));
    if (s.anim.kind === "move") log("  move", s.anim.path.length, "steps");
    if (s.anim.kind === "wheel") log("  wheel", s.anim.index, s.anim.title);
    if (s.anim.kind === "jump") log("  jump", s.anim.jump, s.anim.from + 1, "->", s.anim.to + 1);
    if (s.anim.kind === "win") log("  WIN", s.anim.playerId);
    if (s.anim.kind === "landmark") log("  landmark", s.anim.landmark, s.anim.to ?? "");
    if (s.anim.kind === "item") log("  item", s.anim.item, s.anim.to ?? "");
  }
  if (s.phase !== last?.phase) {
    phases.push(s.phase);
    const extra = s.phase === "mgIntro" ? s.minigame?.id : s.phase === "turn" ? `round ${s.round} turn ${s.turnIdx}` : "";
    log("phase", s.phase, extra ?? "");
  }
  if (s.phase === "mgResults" && last?.phase !== "mgResults")
    log("  results", s.minigame?.results?.map((r) => `${r.playerId.slice(0, 6)}:${r.display}:${r.reward}`).join(" | "));
  last = s;
});

function player(name: string) {
  const sock = io(URL, { transports: ["websocket"] });
  let me = "";
  let handledMg = 0;
  sock.emit("player:join", { code, name }, (r: { ok: boolean; playerId: string; error?: string }) => {
    if (!r.ok) throw new Error(r.error);
    me = r.playerId;
  });
  sock.on("state", (s: GameState) => {
    const mine = s.order[s.turnIdx] === me;
    const later = (ms: number, fn: () => void) => setTimeout(fn, ms);
    if (s.phase === "turn" && mine) later(300, () => sock.emit("player:roll"));
    if (s.phase === "choosePath" && s.pendingChoice?.playerId === me) later(300, () => sock.emit("player:choose", s.pendingChoice!.options.at(-1)!.to));
    if (s.phase === "buyStar" && s.pendingBuy?.playerId === me) later(300, () => sock.emit("player:buy", true));
    if (s.phase === "shop" && s.pendingShop?.playerId === me) {
      const p = s.players.find((x) => x.id === me)!;
      const buy = s.pendingShop.stock.find((x) => x.price <= p.crumbs && (x.item === "shield" ? !p.shielded : p.items.length < 3));
      later(300, () => sock.emit("player:shopBuy", buy?.item ?? null));
    }
    if (s.phase === "wheel" && s.pendingWheel?.playerId === me) later(300, () => sock.emit("player:spin"));
    if (s.phase === "turn" && mine && s.players.find((x) => x.id === me)!.items.length) {
      const it = s.players.find((x) => x.id === me)!.items[0];
      if (it !== "steal") later(100, () => sock.emit("player:useItem", it));
    }
    if (s.phase === "pickTarget" && s.pendingTarget?.playerId === me) later(300, () => sock.emit("player:target", s.players.find((p) => p.id !== me)!.id));
    const mg = s.minigame;
    if (s.phase === "mgIntro" && mg?.participants.includes(me) && !mg.ready?.[me]) later(400, () => sock.emit("mg:ready"));
    if (s.phase === "mgPlay" && mg && mg.participants.includes(me) && handledMg !== mg.startAt) {
      handledMg = mg.startAt;
      const startIn = mg.startAt - s.serverNow!;
      if (mg.id === "pushLuck") {
        later(startIn + 500, () => sock.emit("mg:push", (r: { busted: boolean; pot: number }) => !r.busted && sock.emit("mg:submit", { score: r.pot })));
      } else {
        const score = mg.id === "tenSeconds" ? 9000 + Math.random() * 2000 : mg.id === "dontWake" ? (mg.signalDelayMs ?? 0) + 300 : 30;
        later(startIn + 1000, () => sock.emit("mg:submit", { score }));
      }
    }
  });
  return sock;
}

const a = player("سارة");
player("محمد");
await new Promise((r) => setTimeout(r, 500));
a.emit("host:addBot");
a.emit("host:addBot");
if (process.env.BOARD) a.emit("host:setBoard", process.env.BOARD);
a.emit("host:setRounds", ROUNDS);
await new Promise((r) => setTimeout(r, 300));
a.emit("host:start");

const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  if (last?.phase === "end") break;
}
const s = last as GameState | null;
log("FINAL phase:", s?.phase);
log("players:", s?.players.map((p) => `${p.name}${p.isBot ? "(bot)" : ""} ⭐${p.stars} 🍞${p.crumbs} items=${p.items.join(",")}`).join(" | "));
log("bonuses:", JSON.stringify(s?.bonuses));
log("anim counts:", JSON.stringify(Object.fromEntries(anims)));
log("phase sequence length:", phases.length);
process.exit(s?.phase === "end" ? 0 : 1);
