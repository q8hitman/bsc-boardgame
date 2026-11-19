/** Duck Party's home page ("نهار البطولة"): your account chip and wins, the logo with ducks running across the grass,
 *  make / join a room, the game of the day, every game, the club leaderboard (or the friends you played with), and
 *  the links to play on this device or on a big screen. One column on a phone, two on a computer. */
import { CATALOG, gameInfo, type GameInfo } from "../../shared/catalog";
import { gameOfDay, levelOf, totals, xpOf, type Stats } from "../account/progress";
import { ar, esc, icon } from "../net";
import { gameStats, localStats, profile, rivals } from "../profile";
import { runnersHtml } from "./runners";

export type Go = (q: string, key: string, extra?: [string, string]) => () => void;

/** what the chip shows: this device's profile and record, or the signed-in account's (set by the account module) */
export interface Me {
  name: string;
  char: string;
  stats: Stats;
  signedIn: boolean;
}
let meSource: () => Me = () => {
  const p = profile();
  return { name: p.name, char: p.char, stats: localStats(), signedIn: false };
};
export const setMeSource = (fn: () => Me) => {
  meSource = fn;
  refreshMe();
};
export const me = () => meSource();

let root: HTMLElement | null = null;
let chipClick: () => void = () => {};
/** what tapping the account chip does (the account sheet) */
export const onChip = (fn: () => void) => {
  chipClick = fn;
};

/** a club character's face: the top of their idle frame (frame 0 of their blue strip), cropped round */
export function avatarHtml(char: string, size: number, cls = ""): string {
  const k = (size * 1.3) / 72;
  const x = Math.round((size - 64 * k) / 2);
  const y = Math.round(size * 0.04);
  return `<span class="av ${cls}" style="width:${size}px;height:${size}px;background-image:url(assets/football/${esc(char)}-blue.png);background-size:${Math.round(384 * k)}px ${Math.round(72 * k)}px;background-position:${x}px ${y}px"></span>`;
}

const nameOr = (n: string) => (n.trim() ? n.trim() : "ضيف");

export function home(app: HTMLElement, go: Go) {
  const today = gameInfo(gameOfDay(new Date(), CATALOG.map((g) => g.id)))!;
  app.innerHTML = `
    <div class="hub">
      <aside class="side">
        <header class="hub-me rise" style="--d:0">
          <button type="button" class="me-chip" id="acct" aria-label="حسابي"></button>
          <div class="me-wins" id="meWins" title="فوزاتك"></div>
        </header>
        <section class="hero">
          <h1 class="logo rise" style="--d:1" dir="ltr">Duck<br>Party</h1>
          <p class="tagline rise" style="--d:2">ألعاب النادي · كل واحد من تلفونه</p>
          ${runnersHtml()}
          <div class="hub-cta rise" style="--d:3">
            <button type="button" class="cta gold" id="create">سوّ غرفة</button>
            <button type="button" class="cta" id="join">ادخل بكود</button>
          </div>
        </section>
      </aside>
      <main class="games">
        <section class="today rise" style="--d:4">
          <div class="sec-h"><h2>لعبة اليوم</h2>${today.badge ? `<em class="ribbon">${esc(today.badge)}</em>` : ""}</div>
          ${todayCard(today)}
        </section>
        <section class="all rise" style="--d:5">
          <h2>كل الألعاب</h2>
          <div class="tiles">${CATALOG.filter((g) => g.id !== today.id).map(tile).join("")}</div>
        </section>
      </main>
      <section class="tail">
        <div class="board rise" style="--d:6" id="board"></div>
        <footer class="hub-foot">
          <button type="button" class="link-btn" id="local">العب على هالجهاز</button>
          <button type="button" class="link-btn" id="screen">شاشة كبيرة (بروجكتر)</button>
        </footer>
      </section>
    </div>
    <div class="gsheet hidden" id="gsheet"></div>`;
  root = app;
  refreshMe();
  renderBoard(null);
  app.querySelector<HTMLButtonElement>("#acct")!.onclick = () => chipClick();
  app.querySelector<HTMLButtonElement>("#create")!.onclick = go("?create", "create");
  app.querySelector<HTMLButtonElement>("#join")!.onclick = go("?join=", "join");
  app.querySelector<HTMLButtonElement>("#local")!.onclick = go("?local", "local");
  app.querySelector<HTMLButtonElement>("#screen")!.onclick = go("?screen", "screen");
  app.querySelectorAll<HTMLButtonElement>("[data-game]").forEach((b) => (b.onclick = () => openGame(app, b.dataset.game!, go)));
}

function chips(g: GameInfo) {
  const st = gameStats(g.id);
  return `<span class="chips"><span>${esc(g.players)} لاعبين</span><span>${esc(g.minutes)}</span>${
    st.played ? `<span class="won">فزت ${ar(st.won)} من ${ar(st.played)}</span>` : ""
  }</span>`;
}

function todayCard(g: GameInfo) {
  return `<button type="button" class="today-card" data-game="${g.id}">
    <span class="tc-art"><img src="assets/thumbs/${g.id}.jpg" alt="" loading="lazy"></span>
    <span class="tc-body"><b>${esc(g.name)}</b><span class="tag">${esc(g.tag)}</span>${chips(g)}<span class="play">العب</span></span>
  </button>`;
}

function tile(g: GameInfo) {
  return `<button type="button" class="tile" data-game="${g.id}">
    <span class="t-art"><img src="assets/thumbs/${g.id}.jpg" alt="" loading="lazy">${g.badge ? `<em class="ribbon">${esc(g.badge)}</em>` : ""}</span>
    <span class="t-body"><b>${esc(g.name)}</b><span class="tag">${esc(g.tag)}</span></span>
  </button>`;
}

/** the chip and the wins pill, from the current source (local record or account) */
export function refreshMe() {
  if (!root) return;
  const m = meSource();
  const lv = levelOf(xpOf(m.stats));
  const chip = root.querySelector<HTMLButtonElement>("#acct");
  if (chip)
    chip.innerHTML = `${avatarHtml(m.char, 44)}<span class="me-txt"><b class="me-name">${esc(nameOr(m.name))}</b>
      <span class="me-lv">مستوى ${ar(lv.level)}<i class="bar"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></i></span>
      ${m.signedIn ? "" : `<span class="me-sign">سجّل دخول</span>`}</span>`;
  const wins = root.querySelector<HTMLDivElement>("#meWins");
  if (wins) wins.innerHTML = `${icon("trophy", 26)}<b>${ar(totals(m.stats).wins)}</b>`;
}

/** the leaderboard: the club's top players (signed in), or null for this device's friends («ربعك») */
export function renderBoard(rows: { name: string; char: string; wins: number; me: boolean }[] | null) {
  const el = root?.querySelector<HTMLDivElement>("#board");
  if (!el) return;
  if (rows && rows.length) {
    el.innerHTML = `<h2>ترتيب النادي</h2><ol class="ranks">${rows
      .map(
        (r, i) =>
          `<li class="${r.me ? "me" : ""}"><b class="pos">${ar(i + 1)}</b>${avatarHtml(r.char, 40)}<span class="nm">${esc(nameOr(r.name))}${r.me ? " (انت)" : ""}</span><b class="sc">${ar(r.wins)}</b></li>`,
      )
      .join("")}</ol>`;
    return;
  }
  const friends = rivals().slice(0, 6);
  el.innerHTML = `<h2>ربعك</h2>${
    friends.length
      ? `<ol class="ranks">${friends
          .map((r) => `<li><span class="nm">${esc(r.name)}</span><b class="sc"><i class="w">${ar(r.w)}</i> – <i class="l">${ar(r.l)}</i></b></li>`)
          .join("")}</ol>`
      : `<p class="empty">العب مع ربعك، وهني يطلع كم مرة فزت على كل واحد وكم مرة فاز عليك.</p>`
  }`;
}

/** A game opens a sheet: play it with friends (a room) or alone against the computer (this device). */
function openGame(app: HTMLElement, id: string, go: Go) {
  const g = gameInfo(id)!;
  const sh = app.querySelector<HTMLDivElement>("#gsheet")!;
  sh.innerHTML = `<div class="gs-in" role="dialog" aria-modal="true" aria-label="${esc(g.name)}">
    <img class="gs-thumb" src="assets/thumbs/${g.id}.jpg" alt="">
    <h2>${esc(g.name)}</h2><p>${esc(g.tag)}</p>${chips(g)}
    <button type="button" class="cta gold" id="gsRoom">العب مع ربعك</button>
    <button type="button" class="cta" id="gsSolo">العب لحالك مع الكمبيوتر</button>
    <button type="button" class="link-btn dark" id="gsX">رجوع</button></div>`;
  sh.classList.remove("hidden");
  const close = () => {
    sh.classList.add("hidden");
    removeEventListener("keydown", esc_);
  };
  const esc_ = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", esc_);
  sh.onclick = (e) => e.target === sh && close();
  sh.querySelector<HTMLButtonElement>("#gsX")!.onclick = close;
  sh.querySelector<HTMLButtonElement>("#gsRoom")!.onclick = go(`?create&game=${id}`, "create", ["game", id]);
  sh.querySelector<HTMLButtonElement>("#gsSolo")!.onclick = () => {
    try {
      const cfg = JSON.parse(localStorage.getItem("duck-local") ?? "{}");
      localStorage.setItem("duck-local", JSON.stringify({ bots: 3, rounds: 10, ...cfg, humans: 1, names: [me().name || "لاعب ١"], game: id }));
    } catch {
      /* private mode: the setup page still opens */
    }
    go(`?local&game=${id}`, "local", ["game", id])();
  };
  sh.querySelector<HTMLButtonElement>("#gsRoom")!.focus();
}
