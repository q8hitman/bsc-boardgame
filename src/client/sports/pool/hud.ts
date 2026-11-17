import { DUCKS } from "../../../shared/data";
import type { PoolTable } from "../../../shared/pool/types";
import type { GameState } from "../../../shared/types";
import { ar, esc } from "../../net";
import { ballColor } from "./textures";

/** HTML overlays over the 3D table: players and the balls they potted, whose turn, the power bar, the spin
 *  widget and the big "دخلت!" shouts. */

const duckSrc = (d: number) => `assets/tokens/token${d}.png`;

/** A little pool ball for the HUD. */
export function miniBall(n: number) {
  return `<i class="pl-mb ${n > 8 ? "st" : "so"}" style="--c:${ballColor(n)}"><b>${n}</b></i>`;
}

export interface HudData {
  s: GameState;
  table: PoolTable;
  /** potted lists to show (they move on as balls drop in a replay) */
  potted: Record<string, number[]>;
  /** whose turn is shown (empty while a shot plays) */
  turn: string;
  /** 0..1 of the turn clock left (null = no clock) */
  clock: number | null;
  /** `turn`'s shot is being played back */
  replaying: boolean;
}

const kind = (label: string) => (label.startsWith("البيضا") ? "scratch" : label.startsWith("دخلت") ? "pot" : label === "خلص الوقت" ? "time" : "miss");

/** Phone overlay. */
export class PersonalHud {
  readonly el: HTMLDivElement;
  private top: HTMLDivElement;
  private turnEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private pops: HTMLDivElement;
  private floats: HTMLDivElement;
  readonly power: HTMLButtonElement;
  readonly powerFill: HTMLDivElement;
  readonly spin: HTMLDivElement;
  readonly spinDot: HTMLDivElement;
  private last = "";
  private lastTurn = "";

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "pl-hud personal";
    this.el.innerHTML = `
      <div class="pl-top"></div>
      <div class="pl-turn hidden"></div>
      <div class="pl-hint hidden"></div>
      <div class="pl-floats"></div>
      <div class="pl-pops"></div>
      <div class="pl-ctrl hidden">
        <div class="pl-spin" title="الضربة"><div class="ball"></div><div class="dot"></div><span>ضربة</span></div>
        <button class="pl-power" id="spShoot" type="button" aria-label="القوة: اسحب لتحت وفك">
          <div class="track"><div class="fill"></div><div class="ticks"></div></div>
          <div class="grip"><i></i><i></i><i></i></div>
          <span>اسحب ↓</span>
        </button>
      </div>`;
    root.appendChild(this.el);
    this.top = this.el.querySelector(".pl-top")!;
    this.turnEl = this.el.querySelector(".pl-turn")!;
    this.hintEl = this.el.querySelector(".pl-hint")!;
    this.pops = this.el.querySelector(".pl-pops")!;
    this.floats = this.el.querySelector(".pl-floats")!;
    this.power = this.el.querySelector(".pl-power")!;
    this.powerFill = this.el.querySelector(".pl-power .fill")!;
    this.spin = this.el.querySelector(".pl-spin")!;
    this.spinDot = this.el.querySelector(".pl-spin .dot")!;
  }

  update(d: HudData, me: string) {
    const { s } = d;
    const order = d.table.order.filter((id) => s.players.some((p) => p.id === id));
    const html = order
      .map((id) => {
        const p = s.players.find((x) => x.id === id)!;
        const pot = d.potted[id] ?? [];
        const cur = id === d.turn;
        return `<div class="pl-chip${cur ? " cur" : ""}${id === me ? " me" : ""}" style="--c:${DUCKS[p.duck]?.color ?? "#fff"}">
          <div class="hd"><img src="${duckSrc(p.duck)}" alt=""><span class="nm">${id === me ? "أنت" : esc(p.name)}</span><b class="ct">${ar(pot.length)}</b></div>
          <div class="balls">${pot.map(miniBall).join("")}</div>${cur && !d.replaying ? `<div class="clock"><i></i></div>` : ""}</div>`;
      })
      .join("");
    if (html !== this.last) {
      this.top.innerHTML = html;
      this.top.classList.toggle("many", order.length > 2);
      this.last = html;
    }
    const bar = this.top.querySelector<HTMLElement>(".clock i");
    if (bar) bar.style.transform = `scaleX(${d.clock ?? 1})`;
    // whose turn
    let turn = "";
    if (s.phase === "sport" && d.turn && !d.replaying) {
      const p = s.players.find((x) => x.id === d.turn);
      if (d.turn === me) turn = `<b>دورك!</b>${d.table.inHand ? "<span>البيضا بيدك</span>" : ""}`;
      else if (p) turn = `<img src="${duckSrc(p.duck)}" alt=""><b>دور ${esc(p.name)}</b>`;
    }
    if (turn !== this.lastTurn) {
      this.turnEl.innerHTML = turn;
      this.turnEl.classList.toggle("hidden", !turn);
      this.turnEl.classList.toggle("mine", d.turn === me);
      this.lastTurn = turn;
    }
  }

  controls(on: boolean) {
    this.el.querySelector(".pl-ctrl")!.classList.toggle("hidden", !on);
  }

  setPower(p: number) {
    this.powerFill.style.transform = `scaleY(${p})`;
    this.power.style.setProperty("--p", String(p));
  }

  setSpin(x: number, y: number) {
    this.spinDot.style.transform = `translate(${x * 125}%, ${-y * 125}%)`;
    this.spin.classList.toggle("set", Math.hypot(x, y) > 0.05);
  }

  hint(text: string | null) {
    this.hintEl.classList.toggle("hidden", !text);
    if (text && this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  pop(label: string) {
    popInto(this.pops, label, "pl-pop");
  }

  float(text: string, x: number, y: number, color: string) {
    floatInto(this.floats, text, x, y, color);
  }

  destroy() {
    this.el.remove();
  }
}

function popInto(box: HTMLElement, label: string, cls: string) {
  if (!label) return;
  const k = kind(label);
  const d = document.createElement("div");
  d.className = `${cls} k-${k}`;
  // "البيضا طاحت! بس انحسبت لك ٢" → the shout and a smaller line under it
  const [main, sub] = label.includes("! ") ? [label.slice(0, label.indexOf("! ") + 1), label.slice(label.indexOf("! ") + 2)] : [label, ""];
  d.innerHTML = `${k === "pot" ? `<div class="rays"></div>` : ""}<div class="txt">${esc(main)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`;
  box.querySelectorAll(`.${cls}`).forEach((x) => x.remove());
  box.appendChild(d);
  setTimeout(() => d.remove(), k === "pot" ? 2000 : 1700);
}

function floatInto(box: HTMLElement, text: string, x: number, y: number, color: string) {
  const d = document.createElement("div");
  d.className = "pl-float";
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  d.style.setProperty("--c", color);
  d.textContent = text;
  box.appendChild(d);
  setTimeout(() => d.remove(), 1300);
}

/** Projector overlay: the scoreboard (turn order, balls potted) and the shouts. */
export class ScreenHud {
  readonly el: HTMLDivElement;
  private board: HTMLDivElement;
  private pops: HTMLDivElement;
  private floats: HTMLDivElement;
  private last = "";

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "pl-hud screen";
    this.el.innerHTML = `<div class="pl-floats"></div><div class="pl-spops"></div><div class="pl-board"></div>`;
    root.appendChild(this.el);
    this.board = this.el.querySelector(".pl-board")!;
    this.pops = this.el.querySelector(".pl-spops")!;
    this.floats = this.el.querySelector(".pl-floats")!;
  }

  update(d: HudData) {
    const { s } = d;
    const order = d.table.order.filter((id) => s.players.some((p) => p.id === id));
    const counts = order.map((id) => d.potted[id]?.length ?? 0);
    const best = Math.max(0, ...counts);
    const left = 15 - counts.reduce((a, b) => a + b, 0);
    const rows = order
      .map((id, i) => {
        const p = s.players.find((x) => x.id === id)!;
        const pot = d.potted[id] ?? [];
        const cur = id === d.turn && s.phase === "sport";
        const lead = pot.length === best && best > 0;
        return `<div class="row${cur ? " cur" : ""}${lead ? " lead" : ""}" style="--c:${DUCKS[p.duck]?.color ?? "#fff"}">
          <img src="${duckSrc(p.duck)}" alt="">
          <div class="mid"><div class="nm">${esc(p.name)}${cur ? `<em>${d.replaying ? "يضرب" : "دوره"}</em>` : ""}</div><div class="balls">${pot.map(miniBall).join("") || `<span class="none">ما دخّل شي</span>`}</div></div>
          <b class="ct">${ar(pot.length)}</b>${cur && !d.replaying ? `<div class="clock"><i></i></div>` : ""}</div>`;
        void i;
      })
      .join("");
    const html = `<div class="head"><h2>بلياردو البط</h2><span>${left === 0 ? "خلصت الكرات" : left === 1 ? "باقي كرة وحدة" : left === 2 ? "باقي كرتين" : `باقي ${ar(left)} ${left >= 3 && left <= 10 ? "كرات" : "كرة"}`}</span></div><div class="rule">اللي يدخّل أكثر يفوز</div><div class="rows">${rows}</div>`;
    if (html !== this.last) {
      this.board.innerHTML = html;
      this.last = html;
    }
    const bar = this.board.querySelector<HTMLElement>(".clock i");
    if (bar) bar.style.transform = `scaleX(${d.clock ?? 1})`;
  }

  pop(label: string) {
    popInto(this.pops, label, "pl-spop");
  }

  float(text: string, x: number, y: number, color: string) {
    floatInto(this.floats, text, x, y, color);
  }

  destroy() {
    this.el.remove();
  }
}
