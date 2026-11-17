import { canPlay, CARD_COLORS, CARD_KINDS, COLOR_IDS, isWild } from "../../shared/cards";
import type { Card, CardColor, GameState } from "../../shared/types";
import { cardBack, cardHtml, colorDot, preloadCards } from "../cards-ui";
import type { ClientSocket } from "../net";
import { ar, esc, tokenImg } from "../net";

const buzz = (ms: number | number[]) => navigator.vibrate?.(ms);
const ORDER: Record<string, number> = { y: 0, r: 1, g: 2, b: 3 };
const KORDER: Record<string, number> = { num: 0, skip: 1, rev: 2, draw2: 3, wild: 4, wild4: 5 };
const sortHand = (h: Card[]) =>
  [...h].sort((a, b) => (a.color ? ORDER[a.color] : 9) - (b.color ? ORDER[b.color] : 9) || KORDER[a.kind] - KORDER[b.kind] || (a.n ?? 0) - (b.n ?? 0));

/** Phone side of "كش!": your hand, the card on the table, and the buttons. */
/** `hideHand`: several people share one screen, so a hand is face down except on its owner's turn.
 *  `isPhone`: the table is drawn above this pad on the same phone, so the pad is only the hand and two buttons. */
export function createCardPad(sock: ClientSocket, main: HTMLElement, me: () => string, hideHand = false, isPhone = () => false) {
  let hand: Card[] = [];
  let st: GameState | null = null;
  let key = "";
  let preCalled = false;
  let preCalledAt = -1;
  let sheet: "" | "color" = "";
  let chosen: { id: number; color?: CardColor } | null = null;
  let lastTurnBuzz = -1;

  function setHand(h: Card[]) {
    hand = h;
    if (preCalledAt !== h.length) preCalled = preCalled && h.length === preCalledAt;
    key = "";
    if (st) render(st);
  }

  function render(s: GameState) {
    preloadCards();
    st = s;
    const t = s.table;
    if (!t) {
      main.innerHTML = `<h2>نوزع الكروت…</h2>`;
      return;
    }
    const mine = s.order[s.turnIdx] === me() && s.phase === "cards";
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);
    const top = t.discard[t.discard.length - 1];
    const k = JSON.stringify([s.phase, s.turnIdx, mine, hand.map((c) => c.id), top?.id, t.color, t.pendingDraw, t.drawn, t.kwak?.playerId, sheet, preCalled, t.counts]);
    if (k === key) return;
    key = k;
    if (!mine) sheet = "";
    if (mine && lastTurnBuzz !== s.seq) {
      lastTurnBuzz = s.seq;
      buzz([70, 50, 70]);
    }

    const playable = (c: Card) => mine && canPlay(c, t) && (!t.drawn || t.drawn.cardId === c.id);
    const sorted = sortHand(hand);
    const col = CARD_COLORS[t.color];

    // status line
    let status = "";
    if (s.phase === "intro") status = "نوزع الكروت…";
    else if (s.phase === "final" || s.phase === "end") status = "خلصت اللعبة!";
    else if (mine && t.drawn) status = "سحبت كرت ينلعب! تلعبه ولا تخليه؟";
    else if (mine && t.pendingDraw) status = `عليك +${ar(t.pendingDraw)}! ارمِ +${ar(2)} أو +${ar(4)} أو خذهم`;
    else if (mine) status = sorted.some(playable) ? "دورك! اختار كرت" : "دورك! ما عندك كرت ينلعب، اسحب";
    else if (cur) status = cur.id === me() ? "&nbsp;" : `دور ${esc(cur.name)}`; // own card still flying: say nothing

    // kwak button: shout it yourself, or catch someone who forgot
    let kwak = "";
    if (t.kwak && t.kwak.playerId === me()) kwak = `<button class="kw-btn me" id="kwak">كش!</button><p class="kw-hint">صيحها قبل لا يمسكونك!</p>`;
    else if (t.kwak) {
      const who = s.players.find((x) => x.id === t.kwak!.playerId);
      kwak = `<button class="kw-btn catch" id="kwak">مسكتك!</button><p class="kw-hint">${esc(who?.name ?? "")} نسى يقول كش!</p>`;
    } else if (mine && hand.length === 2 && !preCalled) kwak = `<button class="kw-btn small" id="kwak">كش!</button>`;
    else if (preCalled && hand.length <= 2) kwak = `<p class="kw-hint ok">صحت كش! ✓</p>`;

    // overlap the hand so it fits; scroll when it's very big
    const room = Math.min(main.clientWidth || innerWidth - 32, 520) - 6;
    const W = Math.min(124, Math.round(room / 3));
    const avail = room;
    const n = sorted.length;
    const step = n > 1 ? Math.max(Math.round(W * 0.33), Math.min(W + 6, (avail - W) / (n - 1))) : W;

    // phone room: the table is above, so here only the status, the fanned hand and the two buttons (as in the mockups)
    const phoneHtml = () => {
      const width = main.clientWidth || innerWidth;
      const land = innerWidth > innerHeight;
      // a computer / tablet screen (tall enough) gets bigger cards than a phone held sideways
      const big = land && innerHeight >= 700;
      const cw = Math.round(Math.max(62, Math.min(big ? 128 : land ? 76 : 94, width / (land ? 7.5 : 4))));
      const room2 = Math.min(width - (land ? 150 : 16) - cw * 0.35, big ? 960 : 640);
      const st2 = n > 1 ? Math.max(cw * 0.22, Math.min(cw * 0.66, (room2 - cw) / (n - 1))) : 0;
      const rowW = (n - 1) * st2 + cw;
      const tilt = Math.min(4.5, 26 / Math.max(1, n));
      const cards = sorted
        .map((c, i) => {
          const k = i - (n - 1) / 2;
          return `<button class="cp-card ${playable(c) ? "ok" : mine ? "no" : ""} ${t.drawn?.cardId === c.id ? "drawn" : ""}" data-id="${c.id}" style="left:${i * st2}px;--r:${(k * tilt).toFixed(1)}deg;--y:${(Math.abs(k) * tilt * 0.9).toFixed(1)}px">${cardHtml(c, cw)}</button>`;
        })
        .join("");
      let kb = `<button class="ph-k off" disabled>كش!</button>`;
      if (t.kwak && t.kwak.playerId === me()) kb = `<button class="ph-k me" id="kwak">كش!</button>`;
      else if (t.kwak) kb = `<button class="ph-k catch" id="kwak">مسكتك!</button>`;
      else if (mine && hand.length === 2 && !preCalled) kb = `<button class="ph-k" id="kwak">كش!</button>`;
      else if (preCalled && hand.length <= 2) kb = `<button class="ph-k done" disabled>كش ✓</button>`;
      const db = mine && t.drawn
        ? `<button class="ph-d alt" id="keep">خلّه وكمّل</button>`
        : mine
          ? `<button class="ph-d ${t.pendingDraw ? "red" : ""}" id="draw">${t.pendingDraw ? `خذ +${ar(t.pendingDraw)}` : "اسحب كرت"}</button>`
          : `<button class="ph-d off" disabled>اسحب كرت</button>`;
      const who = t.kwak && t.kwak.playerId !== me() ? s.players.find((x) => x.id === t.kwak!.playerId) : undefined;
      const line = who ? `${esc(who.name)} نسى يقول كش! امسكه` : t.kwak ? "صيح كش! قبل لا يمسكونك" : status;
      return `<div class="cp ph-cp">
        <h2 class="ph-st ${mine || t.kwak ? "mine" : ""}">${line}</h2>
        <div class="cp-hand ph-hand ${mine ? "turn" : ""}"><div class="cp-row" style="width:${rowW}px;--cw-h:${Math.round(cw * 1.3167)}px">${cards}</div></div>
        <div class="ph-btns">${db}${kb}</div>
      </div>${sheet === "color" ? colorSheet() : ""}`;
    };

    main.innerHTML = isPhone() ? phoneHtml() : `
      <div class="cp">
        <div class="cp-table">
          <div class="cp-top">${top ? cardHtml(top, 86) : ""}${top && !top.color ? `<div class="cp-pick" style="--g:${col.hex}"></div>` : ""}</div>
          <div class="cp-stat">
            <div class="cp-col">${colorDot(t.color, 26)} اللون ${col.name}</div>
            <h2 class="${mine ? "mine" : ""}">${status}</h2>
            ${cur && !mine && s.phase === "cards" ? `<div class="cp-cur">${tokenImg(cur.duck, 40)}<span>${ar(t.counts[cur.id] ?? 0)} كروت</span></div>` : ""}
          </div>
        </div>
        ${kwak}
        <div class="cp-actions">
          ${mine && t.drawn ? `<button class="big-btn alt" id="keep">خلّه وكمّل</button>` : ""}
          ${mine && !t.drawn ? `<button class="big-btn ${t.pendingDraw ? "red" : ""}" id="draw">${t.pendingDraw ? `خذ +${ar(t.pendingDraw)}` : "اسحب كرت"}</button>` : ""}
        </div>
        <div class="cp-others">${s.order
          .filter((id) => id !== me())
          .map((id) => {
            const o = s.players.find((x) => x.id === id);
            if (!o) return "";
            const c = t.counts[id] ?? 0;
            return `<div class="${id === cur?.id ? "cur" : ""} ${c === 1 ? "one" : ""}">${tokenImg(o.duck, 34)}<span>${esc(o.name)}</span><b>${ar(c)}</b></div>`;
          })
          .join("")}</div>
        <div class="cp-count">كروتك: ${ar(n)}</div>
        <div class="cp-hand ${mine ? "turn" : ""}" style="--step:${step}px">
          <div class="cp-row" style="width:${(n - 1) * step + W}px;--cw-h:${Math.round(W * 1.3167)}px">
            ${sorted.map((c, i) => `<button class="cp-card ${playable(c) ? "ok" : mine ? "no" : ""} ${t.drawn?.cardId === c.id ? "drawn" : ""}" data-id="${c.id}" style="right:${i * step}px">${hideHand && !mine ? cardBack(W) : cardHtml(c, W)}</button>`).join("")}
          </div>
        </div>
      </div>
      ${sheet === "color" ? colorSheet() : ""}`;

    main.querySelectorAll<HTMLButtonElement>(".cp-card.ok").forEach((b) =>
      b.addEventListener("click", () => {
        const c = hand.find((x) => x.id === Number(b.dataset.id));
        if (!c) return;
        buzz(25);
        if (isWild(c)) {
          chosen = { id: c.id };
          sheet = "color";
          key = "";
          render(s);
          return;
        }
        b.classList.add("going");
        sock.emit("card:play", { id: c.id });
      }),
    );
    main.querySelectorAll<HTMLButtonElement>(".cp-card.no").forEach((b) => b.addEventListener("click", () => {
      buzz([10, 30, 10]);
      b.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 220 });
    }));
    main.querySelector("#draw")?.addEventListener("click", () => {
      buzz(20);
      sock.emit("card:draw");
    });
    main.querySelector("#keep")?.addEventListener("click", () => sock.emit("card:keep"));
    main.querySelector("#kwak")?.addEventListener("click", () => {
      buzz([40, 30, 80]);
      if (!t.kwak) {
        preCalled = true;
        preCalledAt = hand.length;
      }
      sock.emit("card:kwak");
    });
    main.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!chosen) return;
        buzz(25);
        chosen.color = b.dataset.color as CardColor;
        sheet = "";
        sock.emit("card:play", { id: chosen.id, color: chosen.color });
        chosen = null;
      }),
    );
    main.querySelector("#sheetx")?.addEventListener("click", () => {
      sheet = "";
      chosen = null;
      key = "";
      render(s);
    });
  }

  function colorSheet() {
    const c = hand.find((x) => x.id === chosen?.id);
    return `<div class="cp-sheet"><div class="cp-sheet-in">
      <h2>${c ? esc(CARD_KINDS[c.kind].name) : ""}: اختار اللون</h2>
      <div class="cp-colors">${COLOR_IDS.map((id) => `<button data-color="${id}" style="--c:${CARD_COLORS[id].hex};--d:${CARD_COLORS[id].deep}">${colorDot(id, 54)}<b>${CARD_COLORS[id].name}</b><small>عندك ${ar(hand.filter((x) => x.color === id).length)}</small></button>`).join("")}</div>
      <button class="small-btn" id="sheetx">رجوع</button></div></div>`;
  }


  return { render, setHand, reset: () => ((key = ""), (hand = []), (preCalled = false)), refresh: () => ((key = ""), st && render(st)) };
}
