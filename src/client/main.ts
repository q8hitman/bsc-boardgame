import "./style.css";
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
  if (params.has("join") || params.has("play")) {
    const { startController } = await import("./controller/controller");
    startController(app, (params.get("join") ?? "").toUpperCase());
    return;
  }
  if (params.has("cards")) {
    // every card face side by side (design check)
    const { cardHtml, cardBack } = await import("./cards-ui");
    const w = Number(params.get("cards")) || 150;
    const kinds = [
      { id: 0, kind: "num", color: "y", n: 7 }, { id: 1, kind: "num", color: "r", n: 3 }, { id: 2, kind: "num", color: "g", n: 9 }, { id: 3, kind: "num", color: "b", n: 0 },
      { id: 4, kind: "skip", color: "y" }, { id: 5, kind: "rev", color: "g" }, { id: 6, kind: "draw2", color: "r" },
      { id: 7, kind: "wild" }, { id: 8, kind: "wild4" }, { id: 9, kind: "swap" },
    ] as const;
    if (params.has("fan")) {
      // picker thumbnail: a fanned hand on the night-blue table
      const fan = [kinds[7], kinds[1], kinds[6], kinds[0], kinds[9]];
      app.innerHTML = `<div style="position:fixed;inset:0;background:radial-gradient(ellipse at 50% 60%,#3a2d86,#1a1446 60%,#0b0a24);overflow:hidden">
        <div style="position:absolute;left:50%;bottom:-70px;width:0;height:0">${fan.map((c, i) => `<div style="position:absolute;left:0;bottom:0;transform-origin:50% 140%;transform:translateX(-50%) rotate(${(i - 2) * 16}deg)">${cardHtml(c, w)}</div>`).join("")}</div>
        <div style="position:absolute;left:28px;top:16px;font:800 64px var(--font);color:#ffd23f;-webkit-text-stroke:5px #120d33;paint-order:stroke fill;transform:rotate(-6deg)">كواك!</div></div>`;
      return;
    }
    app.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:18px;padding:24px;background:#123a5c;min-height:100vh;align-content:flex-start">${kinds.map((c) => cardHtml(c, w)).join("")}${cardBack(w)}</div>`;
    document.body.style.overflow = "auto";
    return;
  }
  home();
}

function home() {
  app.innerHTML = `
    <div class="home">
      <div class="ducks">${[0, 8, 10, 11, 13, 14].map((i) => `<img src="assets/tokens/token${i}.png" alt="">`).join("")}</div>
      <h1>حفلة البط</h1>
      <p>لعبة بارتي لنادي العلوم البيولوجية</p>
      <button class="big-btn green" id="local">العب على هالجهاز</button>
      <p class="home-hint">بروحك أو مع ربعك على نفس الشاشة، والكمبيوتر يكمّل الباقين</p>
      <div id="online" class="home-online">
        <button class="big-btn" id="screen">شاشة العرض (البروجكتر)</button>
        <button class="big-btn alt" id="join">ادخل كلاعب من تلفونك</button>
      </div>
    </div>`;
  app.querySelector<HTMLButtonElement>("#local")!.onclick = () => {
    history.pushState(null, "", "?local");
    params.set("local", "");
    route();
  };
  app.querySelector<HTMLButtonElement>("#screen")!.onclick = () => {
    history.pushState(null, "", "?screen");
    params.set("screen", "");
    route();
  };
  app.querySelector<HTMLButtonElement>("#join")!.onclick = () => {
    history.pushState(null, "", "?join=");
    params.set("join", "");
    route();
  };
  // projector + phones needs the game server (npm run dev / npm start). A static copy (GitHub Pages) only
  // has the one-device mode, so say so instead of offering buttons that can't connect.
  fetch("/api/lan")
    .then((r) => {
      if (!r.ok) throw new Error();
    })
    .catch(() => {
      const box = app.querySelector("#online");
      if (box) box.innerHTML = `<p class="home-hint">اللعب بالبروجكتر والتلفونات يحتاج تشغّل سيرفر اللعبة على جهاز (الشرح في صفحة المشروع على GitHub)</p>`;
    });
}

route();
