// Snakes & ladders motion check: forces dice so a piece lands on a ladder foot and a snake head,
// and captures the big screen mid-climb / mid-slide. Also captures the lobby with the board picker.
// Usage: npx tsx tools/race-shots.ts <outDir>   (needs `npm run dev`, server with --dev)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";

const OUT = process.argv[2] ?? "shots-race";
const BASE = process.env.BASE ?? "http://localhost:5173";
const EXE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ar"] });
const screen = await browser.newPage();
await screen.setViewport({ width: 1920, height: 1080 });
screen.on("pageerror", (e) => console.log("SCREEN ERROR", e.message));
await screen.goto(`${BASE}/?screen`, { waitUntil: "networkidle2" });
await screen.waitForSelector("#lobby .code", { timeout: 20000 });
await wait(1200);
const code = (await screen.$eval("#lobby .code", (e) => e.textContent ?? "")).trim();

const phone = await (await browser.createBrowserContext()).newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await phone.goto(`${BASE}/?join=${code}`, { waitUntil: "networkidle2" });
await phone.waitForSelector("#n");
await phone.type("#n", "سارة");
await phone.click("#go");
await phone.waitForSelector('[data-board="snakes"]');
await phone.click('[data-board="snakes"]');
await wait(3000);
await phone.click("#ab");
await wait(600);
await phone.evaluate(() => document.querySelector(".bpick")?.scrollIntoView({ block: "center" }));
await phone.screenshot({ path: join(OUT, "phone-picker.png") });
await screen.screenshot({ path: join(OUT, "lobby.png") });

// a socket in the same room drives the dev hooks (it is the screen's room code)
const dev = io(BASE, { transports: ["websocket"] });
await new Promise<void>((r) => dev.emit("player:join", { code, name: "dev" }, () => r()));
let st: GameState | null = null;
dev.on("state", (s: GameState) => (st = s));
await wait(500);
await phone.evaluate(() => (document.querySelector("#start") as HTMLButtonElement | null)?.click());
const meName = "سارة";
async function myTurn() {
  for (;;) {
    const s = st as GameState | null;
    if (s && s.phase === "turn" && s.players.find((p) => p.id === s.order[s.turnIdx])?.name === meName) return;
    if (s && s.phase === "turn" && s.players.find((p) => p.id === s.order[s.turnIdx])?.name === "dev") dev.emit("player:roll");
    if (s && s.phase === "mgIntro") dev.emit("mg:ready");
    await wait(150);
  }
}
// ladder: cell 12 is a ladder foot (12 -> 32); from cell 1 roll 5+6
await myTurn();
dev.emit("dev:dice", [5, 6]);
await wait(200);
await phone.waitForSelector("#roll");
await phone.evaluate(() => (document.querySelector("#roll") as HTMLButtonElement | null)?.click());
await wait(1900 + 11 * 330 + 500 + 700);
await screen.screenshot({ path: join(OUT, "ladder-climb.png") });
await wait(1200);
await screen.screenshot({ path: join(OUT, "ladder-top.png") });
// snake: from cell 32 roll 6+5 -> 43 (snake head 43 -> 17)
await myTurn();
dev.emit("dev:dice", [6, 5]);
await wait(200);
await phone.waitForSelector("#roll");
await phone.evaluate(() => (document.querySelector("#roll") as HTMLButtonElement | null)?.click());
await wait(1900 + 11 * 330 + 500 + 1300);
await screen.screenshot({ path: join(OUT, "snake-slide.png") });
await wait(1500);
await screen.screenshot({ path: join(OUT, "snake-bottom.png") });
await browser.close();
process.exit(0);
