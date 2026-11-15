// Visual test: drives a real game in a headless browser (local Chrome/Edge) and saves screenshots
// of the big screen and two phones at every phase change.
// Usage: npx tsx tools/shots.ts <outDir> [rounds] [maxSeconds]   (needs `npm run dev` running)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const OUT = process.argv[2] ?? "shots";
const ROUNDS = Number(process.argv[3] ?? 1);
const MAX_S = Number(process.argv[4] ?? 200);
const BASE = process.env.BASE ?? "http://localhost:5173";
const EXE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ar"],
});
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const screen = await browser.newPage();
await screen.setViewport({ width: 1920, height: 1080 });
screen.on("pageerror", (e) => log("SCREEN ERROR", e.message));
screen.on("console", (m) => m.type() === "error" && log("screen console:", m.text()));
await screen.goto(`${BASE}/?screen`, { waitUntil: "networkidle2" });
await screen.waitForSelector("#lobby .code", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
const code = (await screen.$eval("#lobby .code", (e) => e.textContent ?? "")).trim();
log("room", code);

async function phone(name: string) {
  const ctx = await browser.createBrowserContext(); // separate localStorage per phone
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on("pageerror", (e) => log(`PHONE ${name} ERROR`, e.message));
  await p.goto(`${BASE}/?join=${code}`, { waitUntil: "networkidle2" });
  await p.waitForSelector("#n");
  await p.type("#n", name);
  await p.click("#go");
  try {
    await p.waitForSelector(".pad-top:not(.hidden)", { timeout: 10000 });
  } catch (e) {
    await p.screenshot({ path: join(OUT, `fail-${name}.png`) });
    log("join failed for", name, "page says:", await p.$eval("#main", (m) => (m as HTMLElement).innerText));
    throw e;
  }
  return p;
}
const p1 = await phone("سارة");
const p2 = await phone("محمد");
await new Promise((r) => setTimeout(r, 800));
await screen.screenshot({ path: join(OUT, "00-lobby-screen.png") });
await p1.screenshot({ path: join(OUT, "00-lobby-phone-host.png") });

// host setup
if (process.env.BOARD) {
  await p1.click(`[data-board="${process.env.BOARD}"]`);
  await new Promise((r) => setTimeout(r, 2500)); // screen rebuilds the board
}
await p1.click("#ab");
await new Promise((r) => setTimeout(r, 400));
for (let i = 0; i < 12 && ROUNDS < 10; i++) {
  const txt = await p1.$eval(".stepper span", (e) => e.textContent ?? "");
  if (txt.includes(String(ROUNDS).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]) + " ")) break;
  await p1.click("#rm");
  await new Promise((r) => setTimeout(r, 300));
}
await screen.screenshot({ path: join(OUT, "01-lobby-full.png") });
await p1.click("#start");

// auto-play phones: tap whatever decision is on screen (passed as a string so the bundler can't rewrite it)
const AUTOPLAY = `(() => {
  if (window.__ap) return;
  window.__ap = setInterval(() => {
    const q = (s) => document.querySelector(s);
    q("#roll")?.click(); q("#ready")?.click(); q("[data-to]")?.click(); q("#y")?.click(); q("[data-id]")?.click();
    if (q("#spin") && !window.__spun) { window.__spun = setTimeout(() => { q("#spin")?.click(); window.__spun = 0; }, 900); }
    if (q("#leave") && !window.__shop) { window.__shop = setTimeout(() => { (q(".ware:not([disabled])") ?? q("#leave"))?.click(); window.__shop = 0; }, 1200); }
    const z = q("#z");
    const t = z ? z.innerText : "";
    if (z && !z.classList.contains("bad")) {
      const mash = /ضغطة|اضغط اضغط/.test(t);
      const go = z.classList.contains("go") || /اضغط الحين/.test(t);
      const ten = /اضغط بأي مكان/.test(t) && (window.__tenAt ??= Date.now() + 8500 + Math.random() * 3000) < Date.now();
      if (mash) for (let i = 0; i < 3; i++) z.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      else if (go || ten) z.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    } else window.__tenAt = undefined;
    if (q("#push") && Math.random() < 0.35) q(Math.random() < 0.7 ? "#push" : "#bank")?.click();
  }, 120);
})()`;
async function autoplay(p: Page) {
  await p.evaluate(AUTOPLAY);
}

const MODE = process.env.MODE ?? "game";
if (MODE === "minigames") {
  const { io } = await import("socket.io-client");
  const dev = io(BASE, { transports: ["websocket"] });
  await new Promise<void>((r) => dev.emit("player:join", { code }, () => r()));
  await autoplay(p1);
  await autoplay(p2);
  const ids = (process.env.MG ?? "mash,tenSeconds,dontWake,pushLuck").split(",");
  await new Promise((r) => setTimeout(r, 6000));
  for (const id of ids) {
    // the server only accepts this during someone's turn: retry until the intro is on screen
    for (let tries = 0; tries < 60; tries++) {
      dev.emit("dev:minigame", id as never);
      await new Promise((r) => setTimeout(r, 500));
      if (await screen.evaluate(() => /جاهزين/.test(document.querySelector("#modal")?.textContent ?? ""))) break;
    }
    const shot = async (tag: string, phones = false) => {
      await screen.screenshot({ path: join(OUT, `mg-${id}-${tag}.png`) });
      if (phones) await p1.screenshot({ path: join(OUT, `mg-${id}-${tag}-phone.png`) });
      log("shot", id, tag);
    };
    await new Promise((r) => setTimeout(r, 300));
    await shot("1intro", true);
    await new Promise((r) => setTimeout(r, 4600));
    await shot("2count");
    await new Promise((r) => setTimeout(r, 3600));
    await shot("3play", true);
    await new Promise((r) => setTimeout(r, 4500));
    await shot("4play", true);
    const meta = { mash: 7000, tenSeconds: 16000, dontWake: 9000, pushLuck: 15000 }[id] ?? 10000;
    await new Promise((r) => setTimeout(r, Math.max(1500, meta - 7000)));
    await shot("5late");
    await new Promise((r) => setTimeout(r, 4000));
    await shot("6results", true);
    await new Promise((r) => setTimeout(r, 9000));
  }
  await browser.close();
  process.exit(0);
}

let lastPhase = "";
let n = 2;
const seenMg = new Set<string>();
while ((Date.now() - t0) / 1000 < MAX_S) {
  await autoplay(p1);
  await autoplay(p2);
  const phase = await screen.evaluate(() => {
    const m = document.querySelector("#modal:not(.hidden)")?.textContent?.slice(0, 40) ?? "";
    const b = document.querySelector("#banner:not(.hidden) h2")?.textContent ?? "";
    return `${b}|${m}`;
  });
  if (phase !== lastPhase) {
    lastPhase = phase;
    const tag = String(n++).padStart(2, "0");
    await new Promise((r) => setTimeout(r, 700));
    await screen.screenshot({ path: join(OUT, `${tag}-screen.png`) });
    const mgKey = phase.split("|")[1];
    if (mgKey && !seenMg.has(mgKey)) {
      seenMg.add(mgKey);
      await p1.screenshot({ path: join(OUT, `${tag}-phone.png`) });
    }
    log(tag, phase.replace(/\s+/g, " "));
  }
  if (await screen.evaluate(() => !!document.querySelector(".podium"))) {
    await new Promise((r) => setTimeout(r, 1500));
    await screen.screenshot({ path: join(OUT, `99-end-screen.png`) });
    await p1.screenshot({ path: join(OUT, `99-end-phone.png`) });
    log("END reached");
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}
await browser.close();
