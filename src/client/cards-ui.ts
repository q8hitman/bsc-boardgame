import "./cards.css";
import { CARD_COLORS, cardArt } from "../shared/cards";
import type { Card, CardColor } from "../shared/types";

const img = (src: string) => `<img src="${src}" alt="" draggable="false">`;

/** One playing card (the painted card art). `w` = card width in px. */
export function cardHtml(c: Card, w: number, extra = "", attrs = "") {
  return `<div class="kc k-${c.kind} ${extra}" style="--cw:${w}px" ${attrs}>${img(cardArt(c))}</div>`;
}

/** Back of a card (other players' hands, cards in flight). */
export function cardBack(w: number, extra = "", attrs = "") {
  return `<div class="kc back ${extra}" style="--cw:${w}px" ${attrs}>${img("assets/cards/back.webp")}</div>`;
}

/** The draw pile's top card. */
export function cardDeck(w: number, extra = "", attrs = "") {
  return `<div class="kc deck ${extra}" style="--cw:${w}px" ${attrs}>${img("assets/cards/deck.webp")}</div>`;
}

/** Big colour chip, used for "colour now: ..." and the colour picker. */
export function colorDot(color: CardColor, px: number) {
  const c = CARD_COLORS[color];
  return `<span class="kc-dot" style="--c:${c.hex};--d:${c.deep};--l:${c.light};width:${px}px;height:${px}px"></span>`;
}

/** Warm the browser cache once a card game starts, so cards don't pop in empty when dealt. */
let warmed = false;
export function preloadCards() {
  if (warmed) return;
  warmed = true;
  const slots = ["back", "deck", "wild", "wild4", ...(["y", "r", "g", "b"] as const).flatMap((c) => [..."0123456789", "-draw2", "-rev", "-skip"].map((k) => c + k))];
  for (const s of slots) new Image().src = `assets/cards/${s}.webp`;
}
