// Compares the dice value the server sends with what the big screen banner shows.
// Usage: npx tsx tools/check-rolls.ts   (needs `npm run dev`)
import puppeteer from "puppeteer-core";
import { io } from "socket.io-client";
import type { GameState } from "../src/shared/types";

const BASE = "http://localhost:5173";
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`${BASE}/?screen`, { waitUntil: "networkidle2" });
await page.waitForSelector("#lobby .code");
await new Promise((r) => setTimeout(r, 1000));
const code = (await page.$eval("#lobby .code", (e) => e.textContent ?? "")).trim();

const host = io(BASE, { transports: ["websocket"] });
await new Promise<void>((r) => host.emit("player:join", { code, name: "host" }, () => r()));
host.on("state", (s: GameState) => {
  if (s.phase === "turn" && s.order[s.turnIdx] === (host as unknown as { pid?: string }).pid) host.emit("player:roll");
  if (s.anim.kind === "roll" && (host as unknown as { seq?: number }).seq !== s.seq) {
    (host as unknown as { seq?: number }).seq = s.seq;
    console.log("server roll:", s.anim.values.join("+"));
  }
});
host.emit("host:addBot");
host.emit("host:addBot");
await new Promise((r) => setTimeout(r, 300));
host.emit("host:start");
const seen = new Set<string>();
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const b = await page.evaluate(() => document.querySelector("#banner:not(.hidden) h2")?.textContent ?? "");
  if (b.includes("رمى") && !seen.has(b + Math.floor((Date.now() - t0) / 4000))) {
    seen.add(b + Math.floor((Date.now() - t0) / 4000));
    console.log("screen banner:", b);
  }
  await new Promise((r) => setTimeout(r, 200));
}
await browser.close();
process.exit(0);
