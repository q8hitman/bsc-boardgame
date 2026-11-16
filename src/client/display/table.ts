import "./table.css";
import { CARD_COLORS, CARD_KINDS } from "../../shared/cards";
import type { Card, GameState } from "../../shared/types";
import { cardBack, cardHtml, colorDot } from "../cards-ui";
import { ar, esc } from "../net";
import { sfx } from "../sfx";

/** Big-screen card table for "كواك!": seats around a felt table, deck + discard pile in the middle, flying cards. */
const CX = 960;
const CY = 520;
const RX = 760;
const RY = 385;
const PILE = { x: CX + 115, y: CY - 10 };
const DECK = { x: CX - 135, y: CY - 10 };
const CW = 176; // table card width
const hash = (n: number) => ((n * 2654435761) % 1000) / 1000;

export class CardTable {
  private el: HTMLElement;
  private st: GameState | null = null;
  private seatPos = new Map<string, { x: number; y: number }>();
  private hidden = new Set<number>(); // cards still flying to the pile
  private pileKey = "";
  private seatsKey = "";
  private clock: { toLocal(ms: number): number };

  constructor(root: HTMLElement, clock: { toLocal(ms: number): number }) {
    this.el = root;
    this.clock = clock;
    root.innerHTML = `
      <div class="tb-felt"></div><div class="tb-ring"></div>
      <div class="tb-mark">كواك!</div>
      <svg class="tb-dir" id="tbDir" viewBox="0 0 600 600"><defs><marker id="ah" viewBox="0 0 10 10" markerWidth="34" markerHeight="34" markerUnits="userSpaceOnUse" refX="4" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,255,255,.5)"/></marker></defs>
        <g id="tbArrows">${[0, 1, 2, 3].map((i) => `<path d="M ${300 + 270 * Math.cos((i * 90 + 12) * Math.PI / 180)} ${300 + 270 * Math.sin((i * 90 + 12) * Math.PI / 180)} A 270 270 0 0 1 ${300 + 270 * Math.cos((i * 90 + 70) * Math.PI / 180)} ${300 + 270 * Math.sin((i * 90 + 70) * Math.PI / 180)}" marker-end="url(#ah)"/>`).join("")}</g></svg>
      <div class="tb-glow" id="tbGlow"></div>
      <div class="tb-deck" id="tbDeck"></div>
      <div class="tb-pile" id="tbPile"></div>
      <div class="tb-info" id="tbInfo"></div>
      <div id="tbPend"></div>
      <div class="tb-seats" id="tbSeats"></div>
      <div class="tb-fx" id="tbFx"></div>`;
  }

  private $(id: string) {
    return this.el.querySelector<HTMLElement>("#" + id)!;
  }
  private pl(id: string) {
    return this.st?.players.find((p) => p.id === id);
  }

  // ------------------------------------------------------------------ render
  render(s: GameState) {
    this.st = s;
    const t = s.table;
    const playing = !!t && s.phase !== "lobby";
    this.el.classList.toggle("idle", !playing);
    if (!t || !playing) {
      this.$("tbSeats").innerHTML = "";
      this.$("tbPile").innerHTML = "";
      this.$("tbDeck").innerHTML = "";
      this.$("tbInfo").innerHTML = "";
      this.$("tbPend").innerHTML = "";
      this.seatsKey = this.pileKey = "";
      return;
    }
    this.renderSeats(s);
    this.renderPile(s);
    // deck: a few stacked backs
    const deckN = Math.min(6, Math.ceil(t.deckCount / 12));
    const dk = `${deckN}`;
    if (this.$("tbDeck").dataset.k !== dk) {
      this.$("tbDeck").dataset.k = dk;
      this.$("tbDeck").innerHTML = Array.from({ length: Math.max(1, deckN) }, (_, i) => cardBack(CW, "", `style="--cw:${CW}px;transform:translate(${-i * 1.5}px,${-i * 3}px)"`)).join("");
    }
    // colour glow + direction ring
    const col = CARD_COLORS[t.color];
    this.$("tbGlow").style.setProperty("--g", col.hex);
    const dirEl = this.$("tbDir");
    dirEl.classList.toggle("ccw", t.dir === -1);
    this.$("tbArrows").setAttribute("transform", t.dir === -1 ? "translate(600 0) scale(-1 1)" : "");
    // centre info
    const cur = this.pl(s.order[s.turnIdx]);
    const info = this.$("tbInfo");
    const ik = [t.color, t.pendingDraw, cur?.id, s.phase, t.drawn?.playerId, s.phaseEndsAt].join("|");
    if (info.dataset.k !== ik) {
      info.dataset.k = ik;
      info.innerHTML = `
        ${cur && s.phase === "cards" ? `<div class="tb-turn">${t.drawn ? `${esc(cur.name)} سحب كرت ينلعب` : `دور ${esc(cur.name)}`}</div><div class="tb-timer"><i></i></div>` : `<div class="tb-turn">&nbsp;</div>`}
        <div class="tb-col">${colorDot(t.color, 34)}<span>اللون: <b style="color:${col.light}">${col.name}</b></span></div>`;
      this.$("tbPend").innerHTML = t.pendingDraw && (s.phase === "cards" || s.phase === "tile") ? `<div class="tb-pend">+${ar(t.pendingDraw)}<br>على ${esc(cur?.name ?? "")}</div>` : "";
      const bar = info.querySelector<HTMLElement>(".tb-timer i");
      if (bar && s.phaseEndsAt) {
        const end = this.clock.toLocal(s.phaseEndsAt);
        const left = Math.max(0, end - Date.now());
        bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: left, fill: "forwards" });
      }
    }
  }

  private seatXY(i: number, n: number) {
    // first seat at the bottom, then clockwise (screen y grows downwards)
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
  }

  private renderSeats(s: GameState) {
    const t = s.table!;
    const ids = s.order.length ? s.order : s.players.map((p) => p.id);
    const curId = s.order[s.turnIdx];
    const key = JSON.stringify([ids, curId, t.counts, t.kwak?.playerId, s.players.map((p) => p.name + p.duck + p.connected), s.phase, s.winnerIds]);
    if (key === this.seatsKey) return;
    this.seatsKey = key;
    const box = this.$("tbSeats");
    ids.forEach((id, i) => this.seatPos.set(id, this.seatXY(i, ids.length)));
    box.innerHTML = ids
      .map((id) => {
        const p = this.pl(id);
        if (!p) return "";
        const { x, y } = this.seatPos.get(id)!;
        const n = t.counts[id] ?? 0;
        const fan = Math.min(n, 9);
        const spread = Math.min(15, 70 / Math.max(1, fan));
        const backs = Array.from({ length: fan }, (_, k) => {
          const r = (k - (fan - 1) / 2) * spread;
          return `<div class="tb-mini" style="transform:rotate(${r}deg) translateY(${Math.abs(r) * 0.6}px)">${cardBack(58)}</div>`;
        }).join("");
        const cls = [id === curId && s.phase !== "final" && s.phase !== "end" ? "cur" : "", !p.connected ? "off" : "", n === 1 ? "one" : "", s.winnerIds?.includes(id) ? "won" : ""].join(" ");
        return `<div class="tb-seat ${cls}" data-id="${id}" style="left:${x}px;top:${y}px">
          <div class="tb-fan">${backs}</div>
          <div class="tb-av"><img src="assets/tokens/token${p.duck}.png" alt=""></div>
          <div class="tb-name">${esc(p.name)}</div>
          <div class="tb-n">${n === 1 ? "كرت واحد!" : `${ar(n)} كروت`}</div>
        </div>`;
      })
      .join("");
  }

  private renderPile(s: GameState) {
    const t = s.table!;
    const cards = t.discard.filter((c) => !this.hidden.has(c.id));
    const key = cards.map((c) => c.id).join() + "|" + t.color;
    if (key === this.pileKey) return;
    this.pileKey = key;
    const top = cards[cards.length - 1];
    this.$("tbPile").innerHTML = cards
      .map((c) => {
        const r = (hash(c.id) - 0.5) * 34;
        const dx = (hash(c.id + 7) - 0.5) * 26;
        const dy = (hash(c.id + 13) - 0.5) * 18;
        // a wild card on top shows the colour that was picked
        const pick = c === top && !c.color ? `<div class="tb-pick" style="--g:${CARD_COLORS[t.color].hex}"></div>` : "";
        return `<div class="tb-pc" style="transform:translate(${dx}px,${dy}px) rotate(${r}deg)">${cardHtml(c, CW)}${pick}</div>`;
      })
      .join("");
  }

  // ------------------------------------------------------------------ animations
  /** Returns true when the animation belongs to the card table. */
  anim(s: GameState): boolean {
    const a = s.anim;
    this.st = s;
    switch (a.kind) {
      case "card":
        this.playCard(a.playerId, a.card);
        if (a.skipped) setTimeout(() => this.stamp(a.skipped!, "skip"), 650);
        if (a.reversed) setTimeout(() => this.reverse(), 600);
        if (a.swapWith) setTimeout(() => this.swap(a.playerId, a.swapWith!), 700);
        if (!a.card.color) setTimeout(() => this.colorWave(a.color), 650);
        if (a.card.kind === "draw2" || a.card.kind === "wild4") setTimeout(() => this.callout(a.playerId, CARD_KINDS[a.card.kind].label!, "#ff5a6e"), 600);
        return true;
      case "draw":
        if (a.why === "deal") this.deal(s);
        else this.drawTo(a.playerId, a.n, a.why === "draw" ? 0 : 300);
        return true;
      case "kwak":
        if (a.by) {
          this.callout(a.by, "مسكتك!", "#ff5a6e");
          sfx.caught();
          setTimeout(() => this.drawTo(a.playerId, 2, 0), 500);
        } else {
          this.callout(a.playerId, "كواك!", "#ffd23f");
          sfx.quack();
        }
        return true;
      case "win":
        this.callout(a.playerId, "خلصت كروتي!", "#7CF0A0");
        sfx.star();
        return true;
    }
    return false;
  }

  private fx() {
    return this.$("tbFx");
  }

  private seat(id: string) {
    return this.seatPos.get(id) ?? { x: CX, y: CY + RY };
  }

  /** A card flies from a seat to the pile, turning face up on the way. */
  private playCard(pid: string, card: Card) {
    sfx.card();
    this.hidden.add(card.id);
    this.pileKey = "";
    if (this.st) this.renderPile(this.st);
    const from = this.seat(pid);
    const r = (hash(card.id) - 0.5) * 34;
    const dx = (hash(card.id + 7) - 0.5) * 26;
    const dy = (hash(card.id + 13) - 0.5) * 18;
    const f = document.createElement("div");
    f.className = "tb-fly";
    f.innerHTML = `<div class="tb-flip"><div class="face front">${cardHtml(card, CW)}</div><div class="face backf">${cardBack(CW)}</div></div>`;
    this.fx().appendChild(f);
    const flip = f.firstElementChild as HTMLElement;
    const dur = 620;
    f.animate(
      [
        { transform: `translate(${from.x}px,${from.y}px) translate(-50%,-50%) scale(.42) rotate(${r - 40}deg)` },
        { transform: `translate(${(from.x + PILE.x) / 2}px,${(from.y + PILE.y) / 2 - 90}px) translate(-50%,-50%) scale(1.18) rotate(${r - 12}deg)`, offset: 0.55 },
        { transform: `translate(${PILE.x + dx}px,${PILE.y + dy}px) translate(-50%,-50%) scale(1) rotate(${r}deg)` },
      ],
      { duration: dur, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" },
    );
    flip.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: dur * 0.75, easing: "ease-out", fill: "forwards" });
    setTimeout(() => {
      this.hidden.delete(card.id);
      this.pileKey = "";
      if (this.st) this.renderPile(this.st);
      f.remove();
      // little landing puff
      const puff = document.createElement("div");
      puff.className = "tb-puff";
      puff.style.left = PILE.x + "px";
      puff.style.top = PILE.y + "px";
      this.fx().appendChild(puff);
      setTimeout(() => puff.remove(), 600);
    }, dur);
  }

  /** `n` backs fly from the deck to a seat. */
  private drawTo(pid: string, n: number, delay: number) {
    const to = this.seat(pid);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        sfx.card();
        const f = document.createElement("div");
        f.className = "tb-fly";
        f.innerHTML = cardBack(CW);
        this.fx().appendChild(f);
        const a = f.animate(
          [
            { transform: `translate(${DECK.x}px,${DECK.y}px) translate(-50%,-50%) scale(1) rotate(0deg)` },
            { transform: `translate(${(DECK.x + to.x) / 2}px,${(DECK.y + to.y) / 2 - 60}px) translate(-50%,-50%) scale(.8) rotate(${90 + i * 8}deg)`, offset: 0.5 },
            { transform: `translate(${to.x}px,${to.y - 70}px) translate(-50%,-50%) scale(.3) rotate(${180 + i * 8}deg)`, opacity: 0.4 },
          ],
          { duration: 520, easing: "cubic-bezier(.4,.1,.3,1)", fill: "forwards" },
        );
        a.onfinish = () => f.remove();
      }, delay + i * 150);
    }
    if (n >= 2) setTimeout(() => this.callout(pid, `+${ar(n)}`, "#ff5a6e"), delay);
  }

  private deal(s: GameState) {
    sfx.deal();
    const ids = s.order;
    ids.forEach((id, k) => this.seatPos.set(id, this.seatXY(k, ids.length)));
    for (let round = 0; round < 7; round++) ids.forEach((id, k) => setTimeout(() => this.drawTo(id, 1, 0), (round * ids.length + k) * 70));
  }

  private stamp(pid: string, kind: "skip") {
    const p = this.seat(pid);
    const el = document.createElement("div");
    el.className = "tb-stamp";
    el.style.left = p.x + "px";
    el.style.top = p.y - 20 + "px";
    el.innerHTML = kind === "skip" ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#ff3b4e" stroke-width="3"/><path d="M5.8 18.2 18.2 5.8" stroke="#ff3b4e" stroke-width="3" stroke-linecap="round"/></svg><b>طار دوره</b>` : "";
    this.fx().appendChild(el);
    sfx.bad();
    this.$("tbSeats").querySelector<HTMLElement>(`[data-id="${pid}"]`)?.animate(
      [{ transform: "translate(-50%,-50%)" }, { transform: "translate(calc(-50% - 10px),-50%)" }, { transform: "translate(calc(-50% + 10px),-50%)" }, { transform: "translate(-50%,-50%)" }],
      { duration: 300, iterations: 2 },
    );
    setTimeout(() => el.remove(), 1500);
  }

  private reverse() {
    sfx.whoosh();
    const d = this.$("tbDir");
    d.classList.remove("flash");
    void d.getBoundingClientRect();
    d.classList.add("flash");
    this.callout(this.st?.order[this.st.turnIdx] ?? "", "عكس!", "#7FE3FF", { x: CX, y: CY - 210 });
  }

  private swap(a: string, b: string) {
    sfx.magic();
    const pa = this.seat(a);
    const pb = this.seat(b);
    for (let i = 0; i < 4; i++) {
      for (const [p, q] of [[pa, pb], [pb, pa]] as const) {
        setTimeout(() => {
          const f = document.createElement("div");
          f.className = "tb-fly";
          f.innerHTML = cardBack(90);
          this.fx().appendChild(f);
          const mx = (p.x + q.x) / 2 + (q.y - p.y) * 0.25;
          const my = (p.y + q.y) / 2 - (q.x - p.x) * 0.25;
          const an = f.animate(
            [
              { transform: `translate(${p.x}px,${p.y - 60}px) translate(-50%,-50%) rotate(0deg)` },
              { transform: `translate(${mx}px,${my}px) translate(-50%,-50%) rotate(180deg)` },
              { transform: `translate(${q.x}px,${q.y - 60}px) translate(-50%,-50%) rotate(360deg)` },
            ],
            { duration: 800, easing: "ease-in-out", fill: "forwards" },
          );
          an.onfinish = () => f.remove();
        }, i * 120);
      }
    }
    this.callout(a, "تبادل!", "#B596FF");
  }

  private colorWave(color: Card["color"]) {
    if (!color) return;
    sfx.magic();
    const w = document.createElement("div");
    w.className = "tb-wave";
    w.style.setProperty("--g", CARD_COLORS[color].hex);
    w.style.left = PILE.x + "px";
    w.style.top = PILE.y + "px";
    w.innerHTML = `<span>${CARD_COLORS[color].name}!</span>`;
    this.fx().appendChild(w);
    setTimeout(() => w.remove(), 1700);
  }

  /** Speech bubble above a seat (or at a fixed spot). */
  callout(pid: string, text: string, color: string, at?: { x: number; y: number }) {
    const p = at ?? this.seat(pid);
    const el = document.createElement("div");
    el.className = "tb-bubble";
    el.style.left = p.x + "px";
    el.style.top = (at ? p.y : Math.max(70, p.y - 150)) + "px";
    el.style.setProperty("--b", color);
    el.textContent = text;
    this.fx().appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }
}

