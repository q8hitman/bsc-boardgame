// Renders the lobby picker thumbnail of the card game (public/assets/thumbs/cards.jpg).
// Usage: npx tsx tools/cards-thumb.ts [url]
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173";
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 270, deviceScaleFactor: 2 });
await page.goto(`${URL}/?cards=150&fan`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "public/assets/thumbs/cards.jpg", type: "jpeg", quality: 88 });
await browser.close();
console.log("ok");
