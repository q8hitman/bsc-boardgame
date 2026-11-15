// Phone screens for the shop and the wheel of fortune (uses the dev-only "dev:land" hook).
// Usage: npx tsx tools/phone-specials.ts <outDir>   (needs `npm run dev`)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { io } from "socket.io-client";
import { BOARDS } from "../src/shared/data";

const OUT = process.argv[2] ?? "shots-phone";
const BASE = process.env.BASE ?? "http://localhost:5173";
const EXE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shop = BOARDS.island.nodes.find((n) => n.type === "shop")!.id;
const wheel = BOARDS.island.nodes.find((n) => n.type === "wheel")!.id;

const screen = io(BASE, { transports: ["websocket"] });
const code: string = await new Promise((r) => screen.emit("screen:create", (res: { code: string }) => r(res.code)));
const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ["--lang=ar"] });
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p.on("pageerror", (e) => console.log("PHONE ERROR", e.message));
await p.goto(`${BASE}/?join=${code}`, { waitUntil: "networkidle2" });
await p.waitForSelector("#n");
await p.type("#n", "سارة");
await p.click("#go");
await p.waitForSelector("#ab");
await p.click("#ab");
await wait(300);
await p.click("#start");

async function myTurn() {
  await p.waitForSelector("#roll", { timeout: 120000 });
  await wait(400);
}
await myTurn();
screen.emit("dev:land", shop);
await p.waitForSelector(".shop .ware", { timeout: 10000 });
await wait(400);
await p.screenshot({ path: join(OUT, "phone-shop.png") });
await p.click(".shop .ware:not([disabled])");
await wait(1500);
await myTurn();
screen.emit("dev:land", wheel);
await p.waitForSelector("#spin", { timeout: 10000 });
await wait(400);
await p.screenshot({ path: join(OUT, "phone-wheel.png") });
await p.click("#spin");
await wait(1200);
await myTurn();
await p.screenshot({ path: join(OUT, "phone-items.png") });
await browser.close();
process.exit(0);
