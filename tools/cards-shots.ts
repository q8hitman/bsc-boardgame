// Screenshots of the card game: all card faces, the big-screen table mid-game, and a phone on its turn.
// Usage: npx tsx tools/cards-shots.ts [outDir=shots-cards] [url]
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { io } from "socket.io-client";

const OUT = process.argv[2] ?? "shots-cards";
const URL = process.argv[3] ?? "http://localhost:5173";
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// 1) every card face
const faces = await browser.newPage();
await faces.setViewport({ width: 1180, height: 760, deviceScaleFactor: 1.5 });
await faces.goto(`${URL}/?cards=200`, { waitUntil: "networkidle0" });
await faces.evaluate(() => document.fonts.ready);
await wait(400);
await faces.screenshot({ path: `${OUT}/cards-faces.png` });

// 2) the big screen
const screen = await browser.newPage();
await screen.setViewport({ width: 1920, height: 1080 });
await screen.goto(`${URL}/?screen`, { waitUntil: "networkidle0" });
await wait(2500);
const code: string = await screen.evaluate(() => JSON.parse(sessionStorage.getItem("duck-screen")!).code);

// host joins over a socket, picks the card game and adds bots
const host = io("http://localhost:3001", { transports: ["websocket"] });
await new Promise<void>((res) => host.emit("player:join", { code, name: "أحمد" }, () => res()));
host.emit("player:pickPiece", 8);
host.emit("host:setBoard", "cards");
for (let i = 0; i < 4; i++) host.emit("host:addBot");

// 3) a phone player
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await phone.goto(`${URL}/?join=${code}`, { waitUntil: "networkidle0" });
await phone.evaluate(() => localStorage.setItem("duck-name", "رؤى"));
await phone.reload({ waitUntil: "networkidle0" });
await phone.evaluate(() => (document.querySelector("#go") as HTMLButtonElement).click());
await wait(1500);
host.emit("host:start");
await wait(6000);
await screen.screenshot({ path: `${OUT}/cards-table.png` });

// wait for the phone's turn (the host never plays, its turns time out: fine for screenshots)
for (let i = 0; i < 240; i++) {
  const mine = await phone.evaluate(() => (document.querySelector(".cp-stat h2")?.textContent ?? "").startsWith("دورك"));
  if (mine) break;
  await wait(500);
}
await wait(600);
await phone.screenshot({ path: `${OUT}/cards-phone.png` });
await screen.screenshot({ path: `${OUT}/cards-table-turn.png` });
// play the first playable card and catch the flight mid-air
const played = await phone.evaluate(() => {
  const b = document.querySelector(".cp-card.ok") as HTMLButtonElement | null;
  b?.click();
  return !!b;
});
if (played) {
  await wait(80);
  const color = await phone.$("[data-color]");
  if (color) {
    await phone.screenshot({ path: `${OUT}/cards-phone-color.png` });
    await color.click();
    await wait(300);
    const tgt = await phone.$("[data-target]");
    if (tgt) await tgt.click();
  }
  await wait(250);
  await screen.screenshot({ path: `${OUT}/cards-table-fly.png` });
}
await browser.close();
host.close();
console.log("ok", code);
process.exit(0);
