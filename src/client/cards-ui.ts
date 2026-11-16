import "./cards.css";
import { CARD_COLORS, cardArt, CARD_KINDS } from "../shared/cards";
import type { Card, CardColor, CardKind } from "../shared/types";

const AR = (n: number | string) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);

/** White symbol with a dark outline (each path drawn twice: ink underneath, white on top). */
function sym(paths: string, filled = "") {
  return `<svg class="kc-svg" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#2b1b45" stroke-width="6">${paths}</g>${filled}<g stroke="#fff" stroke-width="3">${paths}</g></svg>`;
}
const ICONS: Partial<Record<CardKind, string>> = {
  skip: sym('<circle cx="12" cy="12" r="8.2"/><path d="M6.4 17.6 17.6 6.4"/>'),
  rev: sym('<path d="M5 10.5a7.5 7.5 0 0 1 13-3.8"/><path d="M18.6 2.6v4.3h-4.3"/><path d="M19 13.5a7.5 7.5 0 0 1-13 3.8"/><path d="M5.4 21.4v-4.3h4.3"/>'),
  swap: sym('<path d="M4 8h14.5"/><path d="M14.5 4l4 4-4 4"/><path d="M20 16H5.5"/><path d="M9.5 12l-4 4 4 4"/>'),
  wild: `<svg class="kc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2b1b45"/>
    <path d="M12 12V3.6A8.4 8.4 0 0 1 20.4 12Z" fill="${CARD_COLORS.r.hex}"/><path d="M12 12h8.4A8.4 8.4 0 0 1 12 20.4Z" fill="${CARD_COLORS.b.hex}"/>
    <path d="M12 12v8.4A8.4 8.4 0 0 1 3.6 12Z" fill="${CARD_COLORS.g.hex}"/><path d="M12 12H3.6A8.4 8.4 0 0 1 12 3.6Z" fill="${CARD_COLORS.y.hex}"/>
    <circle cx="12" cy="12" r="8.4" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
};

/** Short mark for the corners and the centre of the card. */
function mark(c: Card, big: boolean) {
  if (c.kind === "num") return `<span class="kc-t${c.n === 0 ? " zero" : ""}">${AR(c.n ?? 0)}</span>`;
  if (c.kind === "draw2") return `<span class="kc-t">+${AR(2)}</span>`;
  if (c.kind === "wild4") return `<span class="kc-t">+${AR(4)}</span>`;
  return big || c.kind !== "wild" ? ICONS[c.kind] ?? "" : ICONS.wild!;
}

/** One playing card. `w` = card width in px (everything inside scales with it). */
export function cardHtml(c: Card, w: number, extra = "", attrs = "") {
  const wild = !c.color;
  const col = c.color ? CARD_COLORS[c.color] : null;
  const vars = col ? `--c:${col.hex};--d:${col.deep};--l:${col.light};` : "";
  // special cards are "court cards": gold frame and a name ribbon, like the king and the joker
  const label = c.kind === "num" ? "" : `<div class="kc-crown"><span>${CARD_KINDS[c.kind].name}</span></div>`;
  return `<div class="kc ${wild ? "wild" : "col"} ${c.kind === "num" ? "" : "court"} k-${c.kind} ${extra}" style="--cw:${w}px;${vars}" ${attrs}>
    <div class="kc-in">
      <div class="kc-cell"><img src="${cardArt(c)}" alt="" draggable="false"></div>
      <div class="kc-ix tl">${mark(c, false)}</div><div class="kc-ix br">${mark(c, false)}</div>
      <div class="kc-big">${mark(c, true)}</div>${label}
    </div></div>`;
}

/** Back of a card (deck, other players' hands). */
export function cardBack(w: number, extra = "", attrs = "") {
  return `<div class="kc back ${extra}" style="--cw:${w}px" ${attrs}><div class="kc-in">
    <div class="kc-emb"><img src="/assets/cards/y.png" alt="" draggable="false"></div><div class="kc-logo">كواك!</div></div></div>`;
}

/** Big colour chip, used for "colour now: ..." and the colour picker. */
export function colorDot(color: CardColor, px: number) {
  const c = CARD_COLORS[color];
  return `<span class="kc-dot" style="--c:${c.hex};--d:${c.deep};--l:${c.light};width:${px}px;height:${px}px"></span>`;
}
