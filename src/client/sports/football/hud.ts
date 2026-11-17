import { CLUB } from "../../../shared/football/club";
import { PITCH, type FbPlayer, type FbState, type FbTeam } from "../../../shared/football/types";
import { ar } from "../../net";
import type { Pose } from "./interp";
import { TEAM_CSS, TEAM_NAME } from "./geom";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return ar(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
};

/** The HTML layer over the pitch: scoreboard + clock, mini-map, banners and stage panels, the portrait hint.
 *  In the controller-only pad it is the whole top half: score, clock, your duck and who has the ball. */
export class FootballHud {
  readonly el: HTMLDivElement;
  private score: HTMLDivElement;
  private clockEl: HTMLElement;
  private halfEl: HTMLElement;
  private mini: HTMLCanvasElement | null = null;
  private mg: CanvasRenderingContext2D | null = null;
  private banner: HTMLDivElement;
  private panel: HTMLDivElement;
  private hint: HTMLDivElement;
  private me: HTMLDivElement | null = null;
  private st: FbState | null = null;
  private bannerTimer = 0;
  private lastClock = "";
  private panelKey = "";
  private hintShown = false;

  constructor(
    root: HTMLElement,
    private o: { pad: boolean; screen: boolean },
  ) {
    this.el = document.createElement("div");
    this.el.className = `fb-hud${o.pad ? " pad" : ""}${o.screen ? " screen" : ""}`;
    this.el.innerHTML = `
      <div class="fb-score" dir="ltr">
        <div class="tm t0"><i></i><b>${TEAM_NAME[0]}</b></div>
        <div class="sc"><span class="s0">٠</span><em>-</em><span class="s1">٠</span></div>
        <div class="tm t1"><b>${TEAM_NAME[1]}</b><i></i></div>
        <div class="clk"><small class="half"></small><span>٠٠:٠٠</span></div>
      </div>
      ${o.pad ? `<div class="fb-me"></div>` : `<canvas class="fb-mini" width="136" height="88"></canvas>`}
      <div class="fb-banner hidden"></div>
      <div class="fb-panel hidden"></div>
      <div class="fb-hint hidden"><span class="rot"></span>لف التليفون للعرض</div>`;
    root.appendChild(this.el);
    this.score = this.el.querySelector(".fb-score")!;
    this.clockEl = this.el.querySelector(".clk span")!;
    this.halfEl = this.el.querySelector(".clk .half")!;
    this.banner = this.el.querySelector(".fb-banner")!;
    this.panel = this.el.querySelector(".fb-panel")!;
    this.hint = this.el.querySelector(".fb-hint")!;
    this.mini = this.el.querySelector(".fb-mini");
    this.mg = this.mini?.getContext("2d") ?? null;
    this.me = this.el.querySelector(".fb-me");
  }

  update(st: FbState | undefined, phase: string) {
    this.st = st ?? null;
    if (!st) {
      this.setPanel(phase === "intro" ? "intro" : "", phase === "intro" ? `<h2>كورة البط</h2><p>استعدوا… المباراة بتبدي</p>` : "");
      return;
    }
    this.score.querySelector(".s0")!.textContent = ar(st.score[0]);
    this.score.querySelector(".s1")!.textContent = ar(st.score[1]);
    this.halfEl.textContent = st.halves === 2 ? (st.half === 1 ? "ش١" : "ش٢") : "";
    this.score.classList.toggle("live", st.running);
    // stage panels
    const sc = `<div class="big" dir="ltr"><span class="c0">${ar(st.score[0])}</span><em>-</em><span class="c1">${ar(st.score[1])}</span></div>`;
    if (st.stage === "kickoff") {
      const k = st.kickoff;
      this.setPanel(`ko${st.half}${st.score.join()}`, `<h3>ضربة البداية</h3><p>الكورة مع <b class="c${k}">${TEAM_NAME[k]}</b></p>`, "small");
    } else if (st.stage === "halftime") this.setPanel("ht", `<h2>بين الشوطين</h2>${sc}<p>الفرق بتبدّل الجهات</p>`);
    else if (st.stage === "over" || phase === "final") {
      const [a, b] = st.score;
      // the engine says who won (penalties included); without it, the score decides
      let res = st.result;
      if (res === undefined) {
        const pa = st.pens ? st.pens.kicks[0].filter(Boolean).length : 0;
        const pb = st.pens ? st.pens.kicks[1].filter(Boolean).length : 0;
        res = a !== b ? (a > b ? 0 : 1) : pa !== pb ? (pa > pb ? 0 : 1) : -1;
      }
      const w = res === -1 ? "تعادل!" : `فاز <b class="c${res}">${res === 0 ? "الأزرق" : "الأحمر"}</b>${st.pens && a === b ? " بالترجيح" : ""}!`;
      this.setPanel(`over${a}${b}${res}`, `<h2>صافرة النهاية</h2>${sc}<p class="win">${w}</p>${st.pens ? this.pensHtml(st) : ""}`);
    } else if (st.stage === "pens" && st.pens) {
      this.setPanel(`pens${st.pens.kicks[0].length}${st.pens.kicks[1].length}${st.pens.taker}`, `<h3>ضربات الترجيح</h3>${this.pensHtml(st)}<p>يسدد <b class="c${st.pens.taker}">${esc(st.roster[st.pens.shooterSlot]?.name ?? "")}</b></p>`, "pens");
    } else this.setPanel("", "");
  }

  private pensHtml(st: FbState) {
    const p = st.pens!;
    const row = (t: FbTeam) => {
      const ks = p.kicks[t];
      const n = Math.max(5, ks.length + (ks.length >= 5 ? 1 : 0), p.kicks[1 - t].length);
      let h = "";
      for (let i = 0; i < n; i++) h += `<i class="${i < ks.length ? (ks[i] ? "in" : "out") : ""}"></i>`;
      return `<div class="pr"><b class="c${t}">${TEAM_NAME[t]}</b><span dir="ltr">${h}</span></div>`;
    };
    return `<div class="pens">${row(0)}${row(1)}</div>`;
  }

  private setPanel(key: string, html: string, cls = "") {
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.className = `fb-panel ${cls}${key ? "" : " hidden"}`;
    this.panel.innerHTML = html;
  }

  /** "قووول!" with the scorer, dressed for the kind of goal: a screamer gets «صاروخ!», a trickle «بهدوء…» */
  goal(st: FbState, style: "screamer" | "slow" | "normal") {
    const g = st.lastGoal;
    if (!g) return;
    const p = g.slot >= 0 ? st.roster[g.slot] : null;
    const own = g.kind === "own" || g.slot < 0 || (p && p.team !== g.team);
    const to = g.team ? "للحمر" : "للزرق";
    const tag = own
      ? ""
      : style === "screamer"
        ? "صاروخ!"
        : g.kind === "header"
          ? "راسية!"
          : g.kind === "lob"
            ? "لوب فوق الحارس!"
            : g.kind === "pen"
              ? "من نقطة الجزاء"
              : style === "slow"
                ? "بهدوء… بس دخلت!"
                : "";
    const who = own ? `بالغلط في مرماهم… هدية <b>${to}</b>` : `<b>${esc(p?.name ?? "")}</b> سجّل ${to}`;
    this.banner.className = `fb-banner t${g.team} ${style}`;
    this.banner.innerHTML = `${tag ? `<div class="tag">${tag}</div>` : ""}<div class="gl">${style === "screamer" ? "قوووووول!" : "قووول!"}</div><div class="who">${who}</div>`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.add("hidden"), style === "screamer" ? 3000 : 2600);
  }

  /** the clock: every animation frame (cheap: only touches the DOM when the text changes) */
  tick(serverNow: number) {
    const st = this.st;
    if (!st) return;
    const t = st.clock + (st.running ? (serverNow - st.clockAt) / 1000 : 0);
    const s = mmss(Math.min(t, st.halfSeconds));
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clockEl.textContent = s;
      this.clockEl.parentElement!.classList.toggle("late", st.halfSeconds - t < 30 && st.running);
    }
  }

  showHint(on: boolean) {
    if (on && !this.hintShown) {
      this.hintShown = true;
      this.hint.classList.remove("hidden", "gone");
      setTimeout(() => this.hint.classList.add("gone"), 6000);
    }
    if (!on) {
      this.hintShown = false;
      this.hint.classList.add("hidden");
    }
  }

  /** the mini-map: the whole pitch, dots for every duck, the ball, your duck blinking */
  drawMini(pose: Pose | null, roster: FbPlayer[], mySlot: number, now: number) {
    const g = this.mg;
    if (!g || !this.mini) return;
    const W = this.mini.width;
    const H = this.mini.height;
    g.clearRect(0, 0, W, H);
    const m = 4;
    const sx = (W - m * 2) / PITCH.length;
    const sy = (H - m * 2) / PITCH.width;
    const X = (x: number) => Math.round(m + (x + PITCH.length / 2) * sx);
    const Y = (y: number) => Math.round(m + (y + PITCH.width / 2) * sy);
    g.fillStyle = "rgba(14,40,40,.78)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(60,140,60,.55)";
    g.fillRect(m, m, W - m * 2, H - m * 2);
    g.fillStyle = "rgba(255,255,255,.7)";
    const hl = (x0: number, y0: number, w: number, h: number) => g.fillRect(x0, y0, w, h);
    hl(m, m, W - m * 2, 1);
    hl(m, H - m - 1, W - m * 2, 1);
    hl(m, m, 1, H - m * 2);
    hl(W - m - 1, m, 1, H - m * 2);
    hl(Math.round(W / 2), m, 1, H - m * 2);
    const bw = PITCH.boxWidth / 2;
    for (const s of [-1, 1]) {
      const gx = s < 0 ? m : W - m - 1;
      const bx = X(s * (PITCH.length / 2 - PITCH.boxDepth));
      hl(Math.min(gx, bx), Y(-bw), Math.abs(bx - gx) + 1, 1);
      hl(Math.min(gx, bx), Y(bw), Math.abs(bx - gx) + 1, 1);
      hl(bx, Y(-bw), 1, Y(bw) - Y(-bw));
      g.fillStyle = "rgba(255,255,255,.95)";
      hl(s < 0 ? m - 2 : W - m, Y(-PITCH.goalWidth / 2), 2, Y(PITCH.goalWidth / 2) - Y(-PITCH.goalWidth / 2));
      g.fillStyle = "rgba(255,255,255,.7)";
    }
    // centre circle (pixel ring)
    const r = PITCH.centreRadius;
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      g.fillRect(X(Math.cos(t) * r), Y(Math.sin(t) * r), 1, 1);
    }
    if (!pose) return;
    for (const p of roster) {
      const i = p.slot * 4;
      if (pose.p.length < i + 2) continue;
      const x = X(pose.p[i]);
      const y = Y(pose.p[i + 1]);
      const mine = p.slot === mySlot;
      if (mine && Math.floor(now / 250) % 2) continue;
      g.fillStyle = "#0a0a14";
      g.fillRect(x - 2, y - 2, mine ? 5 : 4, mine ? 5 : 4);
      g.fillStyle = mine ? "#ffe14a" : TEAM_CSS[p.team];
      g.fillRect(x - 1, y - 1, mine ? 3 : 2, mine ? 3 : 2);
    }
    const bx = X(pose.ball[0]);
    const by = Y(pose.ball[1]);
    g.fillStyle = "#0a0a14";
    g.fillRect(bx - 2, by - 2, 4, 4);
    g.fillStyle = "#ffffff";
    g.fillRect(bx - 1, by - 1, 2, 2);
  }

  /** controller pad: your duck's portrait + name, and who has the ball */
  setMe(p: FbPlayer | null, ball: "mine" | "team" | "them" | "loose") {
    if (!this.me) return;
    const key = p ? `${p.char}-${p.team}-${p.name}-${ball}` : "none";
    if (this.me.dataset.k === key) return;
    this.me.dataset.k = key;
    if (!p) {
      this.me.innerHTML = `<p class="wait">بانتظار المباراة…</p>`;
      return;
    }
    const ch = CLUB.some((c) => c.id === p.char) ? p.char : "abdullah";
    const status = { mine: "الكورة معاك! سدد ولا مرّر", team: "الكورة مع فريقك", them: "الكورة مع الخصم · زحلق!", loose: "الكورة سايبة · روح لها" }[ball];
    this.me.className = `fb-me t${p.team} ${ball}`;
    this.me.innerHTML = `<div class="pf"><i style="background-image:url(assets/football/${ch}-${p.team === 1 ? "red" : "blue"}.png)"></i></div>
      <div class="nm"><b>${esc(p.name)}</b><span>${TEAM_NAME[p.team]}</span><em>${status}</em></div>`;
  }

  destroy() {
    clearTimeout(this.bannerTimer);
    this.el.remove();
  }
}
