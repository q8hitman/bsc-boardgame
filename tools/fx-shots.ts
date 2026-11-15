// Visual check for motion details: the organizer phone, the 3D dice mid-roll / landed, and the steps-left bubble.
// Usage: npx tsx tools/fx-shots.ts <outDir>   (needs `npm run dev` running)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? "shots-fx";
const BASE = process.env.BASE ?? "http://localhost:5173";
const EXE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ar"],
});
const screen = await browser.newPage();
await screen.setViewport({ width: 1920, height: 1080 });
screen.on("pageerror", (e) => console.log("SCREEN ERROR", e.message));
await screen.goto(`${BASE}/?screen`, { waitUntil: "networkidle2" });
await screen.waitForSelector("#lobby .code", { timeout: 20000 });
await wait(1500);
const code = (await screen.$eval("#lobby .code", (e) => e.textContent ?? "")).trim();

const ctx = await browser.createBrowserContext();
const org = await ctx.newPage();
await org.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
org.on("pageerror", (e) => console.log("PHONE ERROR", e.message));
await org.goto(`${BASE}/?join=${code}`, { waitUntil: "networkidle2" });
await org.waitForSelector("#n");
await org.type("#n", "دكتور");
await org.click("#go");
await org.waitForSelector("#org", { timeout: 10000 });
await org.click("#org");
await org.waitForSelector("#play", { timeout: 5000 });
for (let i = 0; i < 4; i++) {
  await org.click("#ab");
  await wait(250);
}
for (let i = 0; i < 9; i++) {
  await org.click("#rm");
  await wait(150);
}
await wait(500);
await org.screenshot({ path: join(OUT, "org-lobby.png") });
await screen.screenshot({ path: join(OUT, "screen-lobby.png") });
await org.click("#start");

// catch a roll: poll for the dice and grab frames while it tumbles and after it lands
let got = 0;
const deadline = Date.now() + 60000;
while (got < 2 && Date.now() < deadline) {
  const visible = await screen.$eval("#dice", (d) => !d.classList.contains("hidden")).catch(() => false);
  if (visible) {
    await wait(250);
    await screen.screenshot({ path: join(OUT, `dice-${got}-spin.png`) });
    await wait(700);
    await screen.screenshot({ path: join(OUT, `dice-${got}-landed.png`) });
    await wait(500);
    await screen.screenshot({ path: join(OUT, `move-${got}-counter.png`) });
    await org.screenshot({ path: join(OUT, `org-game-${got}.png`) });
    got++;
    await wait(1500);
  } else await wait(100);
}
console.log("captured", got);
await browser.close();
