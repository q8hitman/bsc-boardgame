import "./style.css";
import { initAudio } from "./sfx";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);

async function route() {
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
  home();
}

function home() {
  app.innerHTML = `
    <div class="home">
      <div class="ducks">${[0, 8, 10, 11, 13, 14].map((i) => `<img src="/assets/tokens/token${i}.png" alt="">`).join("")}</div>
      <h1>حفلة البط</h1>
      <p>لعبة بارتي لنادي العلوم البيولوجية</p>
      <button class="big-btn" id="screen">شاشة العرض (البروجكتر)</button>
      <button class="big-btn alt" id="join">ادخل كلاعب من تلفونك</button>
    </div>`;
  app.querySelector<HTMLButtonElement>("#screen")!.onclick = () => {
    history.pushState(null, "", "/?screen");
    params.set("screen", "");
    route();
  };
  app.querySelector<HTMLButtonElement>("#join")!.onclick = () => {
    history.pushState(null, "", "/?join=");
    params.set("join", "");
    route();
  };
}

route();
