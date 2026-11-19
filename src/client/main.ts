import "./style.css";
import "./hub.css";
import { ONLINE_URL, serverUrl } from "./config";
import { home as renderHome, type Go } from "./hub/hub";
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

/** The home page: src/client/hub/hub.ts. Moving to another view keeps the URL in step. */
function home() {
  const go: Go = (q, key, extra) => () => {
    history.pushState(null, "", q);
    params.set(key, "");
    if (extra) params.set(extra[0], extra[1]);
    route();
  };
  renderHome(app, go);
  // the free online server sleeps: start waking it while people read the page
  if (serverUrl()) fetch(ONLINE_URL + "/api/lan", { mode: "no-cors" }).catch(() => {});
}

route();
