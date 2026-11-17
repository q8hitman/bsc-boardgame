// Phone screenshots of a one-device game, played automatically (dev server on :5173).
// usage: node tools/phone-shots.mjs <game> <w> <h> <outPrefix> <seconds> [bots]
import puppeteer from "puppeteer-core";
const [game, w, h, out, secs, bots = "3"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("response", (r) => r.status() >= 400 && errs.push(r.status() + " " + r.url()));
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await p.evaluate((g, n) => localStorage.setItem("duck-local", JSON.stringify({ game: g, humans: 1, names: ["سارة"], bots: n, rounds: 3 })), game, +bots);
await p.goto("http://localhost:5173/?local", { waitUntil: "networkidle0" });
await p.click("#go");
const t0 = Date.now();
let shot = 0;
const fits = async () => p.evaluate(() => {
  const bad = [];
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll("#ui > *:not(.hidden), #ui .panel, #ui .stage, .ph-side button, .tb-seat, .ph-btns")) {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).display === "none") continue;
    if (r.left < -2 || r.right > vw + 2 || r.top < -2 || r.bottom > vh + 2) bad.push(`${el.id || el.className} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});
const allBad = new Set();
while (Date.now() - t0 < +secs * 1000) {
  await new Promise((r) => setTimeout(r, 700));
  // play like a person: press whatever the pad offers
  await p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const z = q(".mg-zone");
    if (z) z.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    const btn = q("#ready, #roll, #spin, #bank, [data-to], #n, #leave, .cp-card.ok, #draw, #keep, [data-color], .target, #spShoot");
    btn?.click();
  });
  const el = Math.round((Date.now() - t0) / 1000);
  if (el >= shot * (+secs / 6)) {
    await p.screenshot({ path: `${out}-${String(shot).padStart(2, "0")}.png` });
    for (const x of await fits()) allBad.add(x);
    shot++;
  }
}
console.log("errors:", errs.slice(0, 5));
console.log("offscreen:", [...allBad].slice(0, 12));
await b.close();
