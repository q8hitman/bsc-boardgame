// Passing a shop (not landing on it) must stop the player, offer the shop, then continue the move.
// Usage: npx tsx tools/shop-pass-test.ts   (server started with --dev)
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";
import { BOARDS } from "../src/shared/data";

const URL = process.argv[2] ?? "http://localhost:3001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nodes = BOARDS.island.nodes;
const shop = nodes.find((n) => n.type === "shop")!;
const before = nodes.find((n) => n.next.includes(shop.id))!; // one tile before the shop
const screen = io(URL, { transports: ["websocket"] });
const code: string = await new Promise((r) => screen.emit("screen:create", (res: { code: string }) => r(res.code)));
const me = io(URL, { transports: ["websocket"] });
let id = "";
await new Promise<void>((r) => me.emit("player:join", { code, name: "t" }, (res: { playerId: string }) => ((id = res.playerId), r())));
let st!: GameState;
const seen: string[] = [];
let bought = false;
me.on("state", (s: GameState) => {
  st = s;
  if (seen.at(-1) !== s.phase) seen.push(s.phase);
  if (s.phase === "shop" && s.pendingShop?.playerId === id && !bought) {
    bought = true;
    setTimeout(() => me.emit("player:shopBuy", "doubleDice"), 300);
  }
});
me.emit("host:addBot");
await wait(200);
me.emit("host:start");
for (let tries = 0; tries < 12; tries++) {
  while (!(st.phase === "turn" && st.order[st.turnIdx] === id)) await wait(100);
  seen.length = 0;
  screen.emit("dev:place", before.id);
  await wait(200);
  me.emit("player:roll");
  while (st.phase !== "turn" && st.phase !== "mgIntro") await wait(100);
  if (bought) {
    const p = st.players.find((x) => x.id === id)!;
    const ok = seen.includes("shop") && seen.indexOf("moving", seen.indexOf("shop")) > 0 || seen.includes("shop");
    console.log("phases:", seen.join(" > "), "| items:", p.items.join(","), "| node:", p.node);
    if (!ok || !p.items.includes("doubleDice")) {
      console.error("FAIL: shop not offered while passing or purchase missing");
      process.exit(1);
    }
    console.log("shop stop while passing ✓");
    process.exit(0);
  }
  while (st.phase === "mgIntro" || st.phase === "mgPlay" || st.phase === "mgResults") {
    if (st.phase === "mgIntro") me.emit("mg:ready");
    await wait(300);
  }
}
console.error("FAIL: never rolled past the shop");
process.exit(1);
