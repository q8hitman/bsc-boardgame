/** The account sheet (tap the chip): your duck, name, level, wins per game, badges, picking your duck from the club
 *  characters, and the sign-in area (filled by the cloud module once it has loaded). Works the same for a guest. */
import { CATALOG } from "../../shared/catalog";
import { CLUB } from "../../shared/football/club";
import { avatarHtml, me, refreshMe } from "../hub/hub";
import { ar, esc } from "../net";
import { saveProfile } from "../profile";
import { BADGES, badgesOf, levelOf, totals, xpOf } from "./progress";

export const NAME_MAX = 14;

/** how a change of name / duck is saved: this device's profile, plus the account when signed in (cloud.ts) */
let saver: (p: { name?: string; char?: string }) => void = (p) => void saveProfile(p);
export const setSaver = (fn: (p: { name?: string; char?: string }) => void) => {
  saver = fn;
};
/** fills the sign-in area of an open sheet (cloud.ts); without it a guest sees a short note */
let authArea: ((el: HTMLElement) => void) | null = null;
export const setAuthArea = (fn: (el: HTMLElement) => void) => {
  authArea = fn;
  const el = document.querySelector<HTMLElement>("#acctAuth");
  if (el) fn(el);
};

let sheet: HTMLDivElement | null = null;

export function openAccount() {
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.className = "asheet hidden";
    sheet.id = "asheet";
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => e.target === sheet && closeAccount());
    addEventListener("keydown", (e) => e.key === "Escape" && sheet && !sheet.classList.contains("hidden") && closeAccount());
  }
  render();
  sheet.classList.remove("hidden");
  sheet.querySelector<HTMLButtonElement>("#acctX")?.focus();
}

export function closeAccount() {
  sheet?.classList.add("hidden");
}

/** redraw an open sheet (after sign-in / sync) */
export function refreshAccount() {
  if (sheet && !sheet.classList.contains("hidden")) render();
}

function render() {
  const sh = sheet!;
  const m = me();
  const lv = levelOf(xpOf(m.stats));
  const earned = new Set(badgesOf(m.stats, CATALOG.map((g) => g.id)));
  const t = totals(m.stats);
  sh.innerHTML = `<div class="as-in" role="dialog" aria-modal="true" aria-label="حسابي">
    <button type="button" class="as-x" id="acctX" aria-label="سكّر">✕</button>
    <div class="as-head">
      ${avatarHtml(m.char, 96, "big")}
      <div class="as-who">
        <label class="as-name"><span class="sr">اسمك</span><input id="acctName" maxlength="${NAME_MAX}" value="${esc(m.name)}" placeholder="اكتب اسمك" autocomplete="nickname"></label>
        <span class="as-title">${esc(lv.title)} · مستوى ${ar(lv.level)}</span>
        <span class="bar wide"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></span>
        <span class="as-next">باقي ${ar(lv.need - lv.into)} نقطة للمستوى ${ar(lv.level + 1)}</span>
      </div>
    </div>
    <div class="as-stats"><div><b>${ar(t.wins)}</b><span>فوز</span></div><div><b>${ar(t.played)}</b><span>مباراة</span></div><div><b>${ar(earned.size)}</b><span>أوسمة</span></div></div>
    <div id="acctAuth" class="as-auth"><p>سجّل دخول عشان تنحفظ فوزاتك بكل جهاز.</p></div>
    <h3>فوزاتك بكل لعبة</h3>
    <ul class="as-games">${CATALOG.map((g) => {
      const s = m.stats.games[g.id] ?? { played: 0, won: 0 };
      return `<li><img src="assets/thumbs/${g.id}.jpg" alt="" loading="lazy"><span class="nm">${esc(g.name)}</span><b>${ar(s.won)}</b><small>من ${ar(s.played)}</small></li>`;
    }).join("")}</ul>
    <h3>الأوسمة</h3>
    <ul class="as-badges">${BADGES.map((b) => `<li class="${earned.has(b.id) ? "got" : ""}"><b>${esc(b.name)}</b><small>${esc(b.hint)}</small></li>`).join("")}</ul>
    <h3>اختار بطتك</h3>
    <div class="as-ducks">${CLUB.map(
      (c) => `<button type="button" class="duck${c.id === m.char ? " on" : ""}" data-char="${c.id}" aria-pressed="${c.id === m.char}">${avatarHtml(c.id, 56)}<span>${esc(c.name)}</span></button>`,
    ).join("")}</div>
  </div>`;
  if (authArea) authArea(sh.querySelector<HTMLElement>("#acctAuth")!);
  sh.querySelector<HTMLButtonElement>("#acctX")!.onclick = closeAccount;
  const input = sh.querySelector<HTMLInputElement>("#acctName")!;
  const saveName = () => {
    const n = input.value.trim().slice(0, NAME_MAX);
    input.value = n;
    if (n !== me().name) {
      saver({ name: n });
      refreshMe();
    }
  };
  input.onchange = saveName;
  input.onkeydown = (e) => e.key === "Enter" && input.blur();
  input.onblur = saveName;
  sh.querySelectorAll<HTMLButtonElement>(".duck").forEach(
    (b) =>
      (b.onclick = () => {
        saver({ char: b.dataset.char! });
        refreshMe();
        const y = sh.querySelector(".as-in")!.scrollTop;
        render();
        sh.querySelector(".as-in")!.scrollTop = y;
      }),
  );
}
