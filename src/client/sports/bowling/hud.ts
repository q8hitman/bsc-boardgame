import { DUCKS } from "../../../shared/data";
import { FRAMES, frameMarks, type BowlingLane } from "../../../shared/sports/bowling";
import type { GameState } from "../../../shared/types";
import { ar, esc } from "../../net";

/** HTML overlays drawn over the 3D alley: scorecards, players, big "سترايك!" shouts. */

const duckSrc = (d: number) => `assets/tokens/token${d}.png`;

function mark(m: string) {
  if (m === "X") return `<b class="r x"><span>X</span></b>`;
  if (m === "/") return `<b class="r sp"></b>`;
  if (m === "-") return `<b class="r z">–</b>`;
  return `<b class="r">${ar(m)}</b>`;
}

/** One scorecard (5 frames + total). `cur` = frame being played (highlighted). */
export function scorecardHtml(lane: BowlingLane | undefined, cards: (number | null)[] | undefined, total: number, cur: number, compact = false) {
  let html = "";
  for (let i = 0; i < FRAMES; i++) {
    const last = i === FRAMES - 1;
    const f = lane?.rolls[i] ?? [];
    const marks = frameMarks(f, last);
    const boxes = last ? 3 : 2;
    let rolls = "";
    for (let k = 0; k < boxes; k++) {
      const m = marks[k];
      // a strike in frames 1-4 sits in the 2nd box like on a real sheet
      if (!last && marks[0] === "X") rolls += k === 0 ? `<b class="r e"></b>` : mark("X");
      else rolls += m ? mark(m) : `<b class="r e"></b>`;
    }
    const c = cards?.[i];
    const cls = ["fr", i === cur ? "cur" : "", last ? "last" : "", c != null ? "done" : ""].join(" ");
    html += `<div class="${cls}"><i class="n">${ar(i + 1)}</i><div class="rolls">${rolls}</div><div class="cum">${c != null ? ar(c) : f.length ? "…" : ""}</div></div>`;
  }
  html += `<div class="tot"><i>${compact ? "" : "المجموع"}</i><b>${ar(total)}</b></div>`;
  return html;
}

const POP_KIND: Record<string, string> = { "سترايك!": "strike", "دبل سترايك!": "strike", "هاتريك!": "strike", "سبير!": "spare", "قناة!": "gutter", "ولا وحدة!": "gutter", "سبلت!": "split" };
export const popKind = (label: string) => POP_KIND[label] ?? "count";

/** Personal (phone) overlay. */
export class PersonalHud {
  readonly el: HTMLDivElement;
  private card: HTMLDivElement;
  private others: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private popBox: HTMLDivElement;
  private lastCard = "";
  private lastOthers = "";

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "bw-hud personal";
    this.el.innerHTML = `
      <div class="bw-top"><div class="bw-card"></div><div class="bw-others"></div></div>
      <div class="bw-hint hidden"><div class="chev"><i></i><i></i><i></i></div><span></span></div>
      <div class="bw-pops"></div>`;
    root.appendChild(this.el);
    this.card = this.el.querySelector(".bw-card")!;
    this.others = this.el.querySelector(".bw-others")!;
    this.hintEl = this.el.querySelector(".bw-hint")!;
    this.popBox = this.el.querySelector(".bw-pops")!;
  }

  update(s: GameState, me: string) {
    const sp = s.sport;
    if (!sp) return;
    const lane = sp.lanes[me] as BowlingLane | undefined;
    const myP = s.players.find((p) => p.id === me);
    const cur = sp.round;
    const html = scorecardHtml(lane, sp.cards[me], sp.total[me] ?? 0, cur);
    const head = myP ? `<div class="who"><img src="${duckSrc(myP.duck)}" alt=""><span>${esc(myP.name)}</span></div>` : "";
    if (head + html !== this.lastCard) {
      this.card.innerHTML = head + `<div class="frames">${html}</div>`;
      this.lastCard = head + html;
    }
    const ranked = [...s.players].sort((a, b) => (sp.total[b.id] ?? 0) - (sp.total[a.id] ?? 0));
    const top = sp.total[ranked[0]?.id] ?? 0;
    const others = ranked
      .filter((p) => p.id !== me)
      .map((p) => {
        const t = sp.total[p.id] ?? 0;
        const lead = t === top && t > 0;
        return `<div class="chip${lead ? " lead" : ""}" style="--c:${DUCKS[p.duck]?.color ?? "#fff"}"><img src="${duckSrc(p.duck)}" alt=""><span>${esc(p.name)}</span><b>${ar(t)}</b></div>`;
      })
      .join("");
    if (others !== this.lastOthers) {
      this.others.classList.toggle("many", s.players.length > 5);
      this.others.innerHTML = others;
      this.lastOthers = others;
    }
  }

  hint(text: string | null) {
    this.hintEl.classList.toggle("hidden", !text);
    if (text) this.hintEl.querySelector("span")!.textContent = text;
  }

  pop(label: string, sub: string) {
    const kind = popKind(label);
    const d = document.createElement("div");
    d.className = `bw-pop k-${kind}`;
    d.innerHTML = `${kind === "strike" || kind === "spare" ? `<div class="rays"></div>` : ""}<div class="txt">${esc(label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`;
    this.popBox.appendChild(d);
    setTimeout(() => d.remove(), kind === "strike" ? 2300 : 1800);
  }

  destroy() {
    this.el.remove();
  }
}

/** Projector overlay: scoreboard + a name tag under every lane. */
export class ScreenHud {
  readonly el: HTMLDivElement;
  private board: HTMLDivElement;
  private tags: HTMLDivElement;
  private pops: HTMLDivElement;
  private last = "";
  private tagEls = new Map<string, HTMLDivElement>();

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "bw-hud screen";
    this.el.innerHTML = `<div class="bw-tags"></div><div class="bw-lpops"></div><div class="bw-board"></div>`;
    root.appendChild(this.el);
    this.board = this.el.querySelector(".bw-board")!;
    this.tags = this.el.querySelector(".bw-tags")!;
    this.pops = this.el.querySelector(".bw-lpops")!;
  }

  update(s: GameState) {
    const sp = s.sport;
    if (!sp) return;
    const ranked = [...s.players].sort((a, b) => (sp.total[b.id] ?? 0) - (sp.total[a.id] ?? 0));
    const rows = ranked
      .map((p, i) => {
        const lane = sp.lanes[p.id] as BowlingLane | undefined;
        const open = sp.open.includes(p.id) && s.phase === "sport";
        return `<div class="row${open ? " open" : ""}" style="--c:${DUCKS[p.duck]?.color ?? "#fff"}"><div class="rk">${ar(i + 1)}</div><img src="${duckSrc(p.duck)}" alt=""><div class="mid"><div class="nm">${esc(p.name)}</div><div class="frames mini">${scorecardHtml(lane, sp.cards[p.id], sp.total[p.id] ?? 0, sp.round, true)}</div></div></div>`;
      })
      .join("");
    const html = `<div class="head"><h2>بولنق البط</h2><span>الفريم ${ar(Math.min(sp.round + 1, sp.rounds))} من ${ar(sp.rounds)}</span></div><div class="rows">${rows}</div>`;
    if (html !== this.last) {
      this.board.innerHTML = html;
      this.last = html;
    }
    for (const p of s.players) {
      let t = this.tagEls.get(p.id);
      if (!t) {
        t = document.createElement("div");
        t.className = "bw-tag";
        this.tags.appendChild(t);
        this.tagEls.set(p.id, t);
      }
      const h = `<img src="${duckSrc(p.duck)}" alt=""><span>${esc(p.name)}</span><b>${ar(sp.total[p.id] ?? 0)}</b>`;
      if (t.dataset.h !== h) {
        t.innerHTML = h;
        t.dataset.h = h;
      }
      t.style.setProperty("--c", DUCKS[p.duck]?.color ?? "#fff");
      t.classList.toggle("open", sp.open.includes(p.id) && s.phase === "sport");
    }
  }

  /** Position the tag of player `id` (pixels in the HUD box). */
  placeTag(id: string, x: number, y: number, w: number) {
    const t = this.tagEls.get(id);
    if (!t) return;
    t.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
    t.style.maxWidth = `${Math.max(90, w)}px`;
  }

  pop(label: string, x: number, y: number, scale: number) {
    const kind = popKind(label);
    const d = document.createElement("div");
    d.className = `bw-lpop k-${kind}`;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.setProperty("--s", String(scale));
    d.innerHTML = `<div class="txt">${esc(label)}</div>`;
    this.pops.appendChild(d);
    setTimeout(() => d.remove(), 2000);
  }

  destroy() {
    this.el.remove();
  }
}
