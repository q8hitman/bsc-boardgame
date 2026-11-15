// Visual check for the special tiles: every turn the current player is dropped on the next special tile
// (shop, wheel, landmarks) with the dev-only "dev:land" hook, and the big screen is captured.
// Usage: npx tsx tools/specials-shots.ts <outDir>   (needs `npm run dev`, which starts the server with --dev)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";
import { BOARDS } from "../src/shared/data";

const OUT = process.argv[2] ?? "shots-specials";
const BASE = process.env.BASE ?? "http://localhost:5173";
const EXE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const nodes = BOARDS.island.nodes;
const targets = [
  ...nodes.filter((n) => n.type === "shop").slice(0, 1),
  ...nodes.filter((n) => n.type === "wheel").slice(0, 1),
  ...nodes.filter((n) => n.type === "landmark"),
].map((n) => ({ id: n.id, tag: n.type === "landmark" ? n.landmark! : n.type }));

const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ar"] });
const screen = await browser.newPage();
await screen.setViewport({ width: 1920, height: 1080 });
screen.on("pageerror", (e) => console.log("SCREEN ERROR", e.message));
await screen.goto(`${BASE}/?screen`, { waitUntil: "networkidle2" });
await screen.waitForSelector("#lobby .code", { timeout: 20000 });
await wait(1500);
const code = (await screen.$eval("#lobby .code", (e) => e.textContent ?? "")).trim();

// one socket player who is the host and plays along; the rest are bots
const me = io(BASE, { transports: ["websocket"] });
let myId = "";
let st: GameState | null = null;
await new Promise<void>((r) => me.emit("player:join", { code, name: "سارة" }, (res: { playerId: string }) => ((myId = res.playerId), r())));
me.on("state", (s: GameState) => {
  st = s;
  const mine = s.order[s.turnIdx] === myId;
  if (s.phase === "shop" && s.pendingShop?.playerId === myId) setTimeout(() => me.emit("player:shopBuy", "tripleDice"), 2500);
  if (s.phase === "wheel" && s.pendingWheel?.playerId === myId) setTimeout(() => me.emit("player:spin"), 2000);
  if (s.phase === "mgIntro" && s.minigame?.participants.includes(myId) && !s.minigame.ready?.[myId]) me.emit("mg:ready");
  void mine;
});
me.emit("host:addBot");
me.emit("host:addBot");
me.emit("host:setRounds", 10);
await wait(600);
await screen.screenshot({ path: join(OUT, "00-lobby.png") });
me.emit("host:start");

for (const t of targets) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !(st && (st as GameState).phase === "turn")) await wait(100);
  me.emit("dev:land", t.id);
  await wait(1700);
  await screen.screenshot({ path: join(OUT, `${t.tag}-a.png`) });
  await wait(t.tag === "wheel" ? 4200 : 1800);
  await screen.screenshot({ path: join(OUT, `${t.tag}-b.png`) });
  console.log("captured", t.tag, "node", t.id);
  await wait(2500);
}
await browser.close();
process.exit(0);
