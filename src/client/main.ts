import "./style.css";
import "./hub.css";
import { ONLINE_URL, serverUrl } from "./config";
import { CATALOG, gameInfo, type GameInfo } from "../shared/catalog";
import { ar, esc, icon, tokenImg } from "./net";
import { gameStats, profile, rivals, saveProfile, totalWins } from "./profile";
import { initAudio } from "./sfx";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);

async function route() {
  if (params.has("local")) {
    initAudio();
    addEventListener("pointerdown", () => initAudio());
    const { startLocal } = await import("./local/local");
    startLocal(app);
    return;
  }
  if (params.has("screen")) {
    initAudio();
    const { startDisplay } = await import("./display/display");
    startDisplay(app);
    return;
  }
  if (params.has("join") || params.has("play") || params.has("create")) {
    const { startController } = await import("./controller/controller");
    startController(app, (params.get("join") ?? "").toUpperCase(), undefined, { create: params.has("create"), game: params.get("game") ?? undefined });
    return;
  }
  if (params.has("cards")) {
    // every card face side by side (design check)
    const { cardHtml, cardBack } = await import("./cards-ui");
    const w = Number(params.get("cards")) || 150;
    const kinds = [
      { id: 0, kind: "num", color: "y", n: 7 }, { id: 1, kind: "num", color: "r", n: 3 }, { id: 2, kind: "num", color: "g", n: 9 }, { id: 3, kind: "num", color: "b", n: 0 },
      { id: 4, kind: "skip", color: "y" }, { id: 5, kind: "rev", color: "g" }, { id: 6, kind: "draw2", color: "r" },
      { id: 7, kind: "wild" }, { id: 8, kind: "wild4" },
    ] as const;
    if (params.has("fan")) {
      // picker thumbnail: a fanned hand on the night-blue table
      const fan = [kinds[7], kinds[1], kinds[6], kinds[0], kinds[8]];
      app.innerHTML = `<div style="position:fixed;inset:0;background:radial-gradient(ellipse at 50% 60%,#3a2d86,#1a1446 60%,#0b0a24);overflow:hidden">
        <div style="position:absolute;left:50%;bottom:-70px;width:0;height:0">${fan.map((c, i) => `<div style="position:absolute;left:0;bottom:0;transform-origin:50% 140%;transform:translateX(-50%) rotate(${(i - 2) * 16}deg)">${cardHtml(c, w)}</div>`).join("")}</div>
        <div style="position:absolute;left:28px;top:16px;font:800 64px var(--font);color:#ffd23f;-webkit-text-stroke:5px #120d33;paint-order:stroke fill;transform:rotate(-6deg)">كش!</div></div>`;
      return;
    }
    app.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:18px;padding:24px;background:#123a5c;min-height:100vh;align-content:flex-start">${kinds.map((c) => cardHtml(c, w)).join("")}${cardBack(w)}</div>`;
    document.body.style.overflow = "auto";
    return;
  }
  home();
}

/** The hub: you (your duck, name and wins), every game as a big card, and the friends you've played with. */
function home() {
  const me = profile();
  const wins = totalWins();
  const friends = rivals().slice(0, 6);
  const pond = [8, 10, me.duck, 11, 13].map((d, i) => `<img class="${i === 2 ? "mine" : ""}" style="--i:${i}" src="assets/tokens/token${d}.png" alt="">`).join("");
  app.innerHTML = `
    <div class="hub">
      <header class="hub-me">
        <button class="me-chip" id="meEdit" aria-label="غيّر اسمك">${tokenImg(me.duck, 40)}<span class="me-name">${esc(me.name) || "اكتب اسمك"}</span></button>
        <div class="me-wins" title="فوزاتك">${icon("trophy", 30)}<b>${ar(wins)}</b><small>${wins === 1 ? "فوز" : "فوز"}</small></div>
      </header>
      <section class="hub-hero">
        <h1>حفلة البط</h1>
        <p>ألعاب النادي. كل واحد من تليفونه</p>
        <div class="pond" aria-hidden="true">${pond}<i class="wave"></i></div>
        <div class="hub-cta">
          <button class="big-btn" id="create">سوّ غرفة</button>
          <button class="big-btn alt" id="join">ادخل بكود</button>
        </div>
      </section>
      <section class="hub-games">
        <h2>ألعابنا</h2>
        <div class="gcards">${CATALOG.map(gameCard).join("")}</div>
      </section>
      <section class="hub-rivals">
        <h2>ربعك</h2>
        ${friends.length
          ? `<div class="hr-list">${friends.map((r) => `<div class="hr">${tokenImg(r.duck, 38)}<span class="hr-nm">${esc(r.name)}</span><b class="hr-sc"><i>${ar(r.w)}</i> – <i>${ar(r.l)}</i></b></div>`).join("")}</div>`
          : `<p class="hr-empty">العب مع ربعك، وهني يطلع كم مرة فزت على كل واحد وكم مرة فاز عليك.</p>`}
      </section>
      <footer class="hub-foot">
        <button class="link-btn" id="local">العب على هالجهاز</button>
        <button class="link-btn" id="screen">شاشة كبيرة (بروجكتر)</button>
      </footer>
    </div>
    <div class="gsheet hidden" id="gsheet"></div>`;
  const go = (q: string, key: string, extra?: [string, string]) => () => {
    history.pushState(null, "", q);
    params.set(key, "");
    if (extra) params.set(extra[0], extra[1]);
    route();
  };
  app.querySelector<HTMLButtonElement>("#create")!.onclick = go("?create", "create");
  app.querySelector<HTMLButtonElement>("#join")!.onclick = go("?join=", "join");
  app.querySelector<HTMLButtonElement>("#local")!.onclick = go("?local", "local");
  app.querySelector<HTMLButtonElement>("#screen")!.onclick = go("?screen", "screen");
  app.querySelector<HTMLButtonElement>("#meEdit")!.onclick = editName;
  app.querySelectorAll<HTMLButtonElement>("[data-game]").forEach((b) => (b.onclick = () => openGame(b.dataset.game!)));
  // the free online server sleeps: start waking it while people read the page
  if (serverUrl()) fetch(ONLINE_URL + "/api/lan", { mode: "no-cors" }).catch(() => {});

  function gameCard(g: GameInfo) {
    const st = gameStats(g.id);
    return `<button class="gcard k-${g.kind}" data-game="${g.id}">
      <span class="gthumb"><img src="assets/thumbs/${g.id}.jpg" alt="" loading="lazy">${g.badge ? `<em class="gbadge">${esc(g.badge)}</em>` : ""}</span>
      <span class="gbody"><b>${esc(g.name)}</b><span class="gtag">${esc(g.tag)}</span>
        <span class="gmeta"><span>${esc(g.players)} لاعبين</span><span>${esc(g.minutes)}</span>${st.played ? `<span class="gwon">فزت ${ar(st.won)} من ${ar(st.played)}</span>` : ""}</span></span>
    </button>`;
  }

  /** A game card opens a sheet: play it with friends (a room) or alone against the computer (this device). */
  function openGame(id: string) {
    const g = gameInfo(id)!;
    const sh = app.querySelector<HTMLDivElement>("#gsheet")!;
    sh.innerHTML = `<div class="gs-in" role="dialog" aria-label="${esc(g.name)}">
      <img class="gs-thumb" src="assets/thumbs/${g.id}.jpg" alt="">
      <h2>${esc(g.name)}</h2><p>${esc(g.tag)}</p>
      <button class="big-btn" id="gsRoom">العب مع ربعك</button>
      <button class="big-btn alt" id="gsSolo">العب لحالك مع الكمبيوتر</button>
      <button class="link-btn dark" id="gsX">رجوع</button></div>`;
    sh.classList.remove("hidden");
    sh.onclick = (e) => e.target === sh && sh.classList.add("hidden");
    sh.querySelector<HTMLButtonElement>("#gsX")!.onclick = () => sh.classList.add("hidden");
    sh.querySelector<HTMLButtonElement>("#gsRoom")!.onclick = go(`?create&game=${id}`, "create", ["game", id]);
    sh.querySelector<HTMLButtonElement>("#gsSolo")!.onclick = () => {
      try {
        const cfg = JSON.parse(localStorage.getItem("duck-local") ?? "{}");
        localStorage.setItem("duck-local", JSON.stringify({ bots: 3, rounds: 10, ...cfg, humans: 1, names: [me.name || "لاعب ١"], game: id }));
      } catch {
        /* private mode: the setup page still opens */
      }
      go(`?local&game=${id}`, "local", ["game", id])();
    };
  }

  function editName() {
    const chip = app.querySelector<HTMLButtonElement>("#meEdit")!;
    const span = chip.querySelector<HTMLSpanElement>(".me-name");
    if (!span) return; // already editing (a click inside the field)
    const input = document.createElement("input");
    input.className = "me-input";
    input.maxLength = 14;
    input.value = profile().name;
    input.placeholder = "اسمك";
    span.replaceWith(input);
    input.focus();
    const done = () => {
      const n = input.value.trim();
      saveProfile({ name: n });
      const sp = document.createElement("span");
      sp.className = "me-name";
      sp.textContent = n || "اكتب اسمك";
      input.replaceWith(sp);
    };
    input.onblur = done;
    input.onkeydown = (e) => e.key === "Enter" && input.blur();
  }
}

route();
