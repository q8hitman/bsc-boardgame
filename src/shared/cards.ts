import type { Card, CardColor, CardKind, CardTable } from "./types";

/** "كواك!" — the club's shedding card game. Each colour is led by one club duck, each action card by a duck
 *  dressed as a film / series character. Art: /assets/cards/{slot}.png (slot = colour id, action kind, or "back");
 *  the prompts for the final art are in docs/card-art-prompts.md. */
export const CARD_GAME = { name: "كواك!", sub: "لعبة الكروت" };

export const CARD_COLORS: Record<CardColor, { name: string; hex: string; deep: string; light: string }> = {
  y: { name: "أصفر", hex: "#FFC21A", deep: "#C77700", light: "#FFE58A" },
  r: { name: "أحمر", hex: "#F0453A", deep: "#9C1420", light: "#FF9A86" },
  g: { name: "أخضر", hex: "#2DBE6C", deep: "#0E6B3A", light: "#93EDB3" },
  b: { name: "أزرق", hex: "#2F8CF0", deep: "#123F9C", light: "#93C8FF" },
};
export const COLOR_IDS = Object.keys(CARD_COLORS) as CardColor[];

/** Court cards: every special card has its own club duck and pose (art slots in docs/card-art-prompts.md). */
export const CARD_KINDS: Record<CardKind, { name: string; desc: string; label?: string; duck?: string }> = {
  num: { name: "رقم", desc: "" },
  skip: { name: "استراحة قهوة", desc: "اللي بعدك يطير دوره", label: "اوقف", duck: "بسام" },
  rev: { name: "تفاعل عكسي", desc: "يعكس اتجاه اللعب", label: "عكس", duck: "الجمل" },
  draw2: { name: "تكاثر", desc: "اللي بعدك يسحب ٢", label: "+٢", duck: "رؤى" },
  wild: { name: "قرار الدكتورة", desc: "تختار اللون اللي تبيه", label: "سحر", duck: "د. زهراء" },
  wild4: { name: "واجب إضافي", desc: "تختار اللون واللي بعدك يسحب ٤", label: "+٤", duck: "د. زهراء" },
  swap: { name: "تبديل العينات", desc: "تبدّل كروتك مع لاعب تختاره وتختار اللون", label: "تبادل", duck: "عبدالله" },
};
/** Which club duck leads each colour (number cards). */
export const COLOR_DUCK: Record<CardColor, string> = { y: "بسام", r: "كيراز", g: "أحمد", b: "عبدالله" };

/** Art slot for a card face. */
export const cardArt = (c: Card) => `assets/cards/${c.kind === "num" ? c.color : c.kind}.png`;

export const HAND_SIZE = 7;
export const KWAK_MS = 3200;

/** 110 cards: per colour 0 ×1, 1-9 ×2, skip / reverse / +2 ×2; then 4 wild, 4 wild +4, 2 pirate swaps. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const color of COLOR_IDS) {
    deck.push({ id: id++, kind: "num", color, n: 0 });
    for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) deck.push({ id: id++, kind: "num", color, n });
    for (const kind of ["skip", "rev", "draw2"] as const) for (let k = 0; k < 2; k++) deck.push({ id: id++, kind, color });
  }
  for (let k = 0; k < 4; k++) deck.push({ id: id++, kind: "wild" });
  for (let k = 0; k < 4; k++) deck.push({ id: id++, kind: "wild4" });
  for (let k = 0; k < 2; k++) deck.push({ id: id++, kind: "swap" });
  return deck;
}

export const isWild = (c: Card) => c.kind === "wild" || c.kind === "wild4" || c.kind === "swap";

/** Can `c` go on the pile right now? While a +2/+4 is pending only a stacking card is allowed. */
export function canPlay(c: Card, t: Pick<CardTable, "discard" | "color" | "pendingDraw">): boolean {
  const top = t.discard[t.discard.length - 1];
  if (t.pendingDraw > 0) return c.kind === "wild4" || (c.kind === "draw2" && top?.kind === "draw2");
  if (isWild(c)) return true;
  if (c.color === t.color) return true;
  if (!top) return false;
  if (c.kind === "num") return top.kind === "num" && top.n === c.n;
  return c.kind === top.kind;
}

/** Points left in a hand at the end (numbers = face value, actions 20, wild cards 50). */
export const cardPoints = (c: Card) => (c.kind === "num" ? c.n ?? 0 : isWild(c) ? 50 : 20);
