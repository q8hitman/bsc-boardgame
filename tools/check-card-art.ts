// Every card in the deck (and the back / draw pile) has its picture in public/assets/cards.
// Usage: npx tsx tools/check-card-art.ts
import { existsSync } from "node:fs";
import { buildDeck, cardArt } from "../src/shared/cards";

const need = new Set([...buildDeck().map(cardArt), "assets/cards/back.webp", "assets/cards/deck.webp"]);
const missing = [...need].filter((p) => !existsSync(`public/${p}`));
console.log(need.size, "pictures needed,", missing.length ? `MISSING: ${missing.join(", ")}` : "all there");
process.exit(missing.length ? 1 : 0);
