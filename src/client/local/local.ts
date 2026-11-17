import "./local.css";
import { CARD_GAME } from "../../shared/cards";
import { BOARDS, MAX_PLAYERS } from "../../shared/data";
import { BOARD_SEATS, PARTY_DEFAULT_ROUNDS, RACE_DEFAULT_ROUNDS } from "../../shared/rules";
import { CATALOG } from "../../shared/catalog";
import { sportCourses } from "../../shared/sports";
import { startController } from "../controller/controller";
import { useLocalServer } from "../local-server";
import { ar, type ClientSocket, esc, setLocalConnect } from "../net";

/** One-device mode: the whole game on this PC or phone. The board takes the screen, every person playing here
 *  gets a panel (what would be their phone), and bots fill the other seats. No server, no network: it also runs
 *  as a plain web page (GitHub Pages). */
const GAMES = CATALOG.map((g) => ({ id: g.id, name: g.name, rounds: g.kind !== "board" ? 0 : BOARDS[g.id].mode === "race" ? RACE_DEFAULT_ROUNDS : PARTY_DEFAULT_ROUNDS }));
const KEYS: [string, string][] = [["a", "s"], ["l", "k"]];
const load = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null") ?? d;
  } catch {
    return d;
  }
};

/** one-device golf has no lobby to pick the map in: a different one each time */
function pickCourse(room: { state: { boardId: string }; setCourse(id: string): void }) {
  // football: the quick 3-minute match is the default with the computer
  if (room.state.boardId === "football") return room.setCourse("quick");
  const courses = sportCourses(room.state.boardId);
  if (courses?.length) room.setCourse(courses[Math.floor(Math.random() * courses.length)].id);
}

export function startLocal(app: HTMLElement) {
  const cfg = load("duck-local", { game: "island", humans: 1, names: ["لاعب ١", "لاعب ٢"], bots: 3, rounds: PARTY_DEFAULT_ROUNDS });
  const save = () => {
    try {
      localStorage.setItem("duck-local", JSON.stringify(cfg));
    } catch {
      /* private mode: fine */
    }
  };

  function setup() {
    const game = GAMES.find((g) => g.id === cfg.game) ?? GAMES[0];
    // a board always has 4 seats (the computer takes the rest); the card game is free: 2 people alone, or bots too
    const cards = !BOARDS[game.id]; // card game and sports: free seats
    const maxBots = MAX_PLAYERS - cfg.humans;
    if (cards) {
      cfg.bots = Math.min(cfg.bots, maxBots);
      if (cfg.humans + cfg.bots < 2) cfg.bots = 2 - cfg.humans;
    } else cfg.bots = BOARD_SEATS - cfg.humans;
    app.innerHTML = `
      <div class="lp-setup">
        <a class="lp-back" href="./">→ رجوع</a>
        <h1>العب على هالجهاز</h1>
        <p class="lp-sub">كل شي على شاشة وحدة: البورد ولوحة كل لاعب، والكمبيوتر يكمّل الباقين</p>
        <h3>اختار اللعبة</h3>
        <div class="lp-games">${GAMES.map((g) => `<button class="${g.id === cfg.game ? "on" : ""}" data-game="${g.id}"><img src="assets/thumbs/${g.id}.jpg" alt=""><span>${esc(g.name)}</span></button>`).join("")}</div>
        <h3>كم واحد بيلعب على هالجهاز؟</h3>
        <div class="lp-seg">${[1, 2].map((n) => `<button class="${cfg.humans === n ? "on" : ""}" data-humans="${n}">${n === 1 ? "بروحي" : "اثنين"}</button>`).join("")}</div>
        <div class="lp-names">${Array.from({ length: cfg.humans }, (_, i) => `<label><span>${cfg.humans > 1 ? `اللاعب ${ar(i + 1)}` : "اسمك"}</span><input data-name="${i}" maxlength="14" value="${esc(cfg.names[i] ?? "")}"></label>`).join("")}</div>
        <h3>لاعبين كمبيوتر</h3>
        ${cards
          ? `<div class="lp-step"><button id="bm">−</button><b>${ar(cfg.bots)}</b><button id="bp">+</button></div>`
          : `<p class="lp-sub">البورد ${ar(BOARD_SEATS)} لاعبين دايماً، فالكمبيوتر ياخذ ${ar(cfg.bots)} ${cfg.bots === 1 ? "كرسي" : "كراسي"}</p>`}
        ${game.rounds ? `<h3>عدد الجولات</h3><div class="lp-step"><button id="rm">−</button><b>${ar(cfg.rounds)}</b><button id="rp">+</button></div>` : ""}
        ${cfg.humans > 1 ? `<p class="lp-keys">بالميني قيمز: اللاعب الأول يضغط <kbd>A</kbd> (وخيار ثاني <kbd>S</kbd>)، والثاني <kbd>L</kbd> (وخيار ثاني <kbd>K</kbd>). أو اضغطوا على لوحاتكم.</p>` : ""}
        <button class="big-btn green" id="go">يلا نلعب (${ar(cfg.humans + cfg.bots)} لاعبين)</button>
      </div>`;
    app.querySelectorAll<HTMLButtonElement>("[data-game]").forEach((b) => (b.onclick = () => {
      cfg.game = b.dataset.game!;
      cfg.rounds = GAMES.find((g) => g.id === cfg.game)!.rounds || cfg.rounds;
      save();
      setup();
    }));
    app.querySelectorAll<HTMLButtonElement>("[data-humans]").forEach((b) => (b.onclick = () => {
      cfg.humans = Number(b.dataset.humans);
      save();
      setup();
    }));
    app.querySelectorAll<HTMLInputElement>("[data-name]").forEach((i) => (i.oninput = () => {
      cfg.names[Number(i.dataset.name)] = i.value;
      save();
    }));
    app.querySelector("#bm")?.addEventListener("click", () => {
      cfg.bots = Math.max(cfg.humans > 1 ? 0 : 1, cfg.bots - 1);
      save();
      setup();
    });
    app.querySelector("#bp")?.addEventListener("click", () => {
      cfg.bots = Math.min(maxBots, cfg.bots + 1);
      save();
      setup();
    });
    app.querySelector("#rm")?.addEventListener("click", () => {
      cfg.rounds = Math.max(1, cfg.rounds - (cfg.rounds > 5 ? 5 : 1));
      save();
      setup();
    });
    app.querySelector("#rp")?.addEventListener("click", () => {
      cfg.rounds = Math.min(30, cfg.rounds + (cfg.rounds >= 5 ? 5 : 1));
      save();
      setup();
    });
    app.querySelector("#go")!.addEventListener("click", () => play());
  }

  async function play() {
    const server = useLocalServer();
    setLocalConnect(() => server.connect() as unknown as ClientSocket);
    document.body.classList.add("lp-on");
    // one person (phone or computer): one screen with the game and its controls, like a phone room. Two people
    // on one computer keep the shared screen with a panel each.
    if (cfg.humans === 1) return playPhone(server);
    app.innerHTML = `
      <div class="lp-game h${cfg.humans}">
        <div class="lp-board" id="lpBoard"></div>
        ${Array.from({ length: cfg.humans }, (_, i) => `<div class="lp-panel p${i}" id="lpP${i}"></div>`).join("")}
        <a class="lp-exit" href="?local" title="رجوع">✕</a>
      </div>`;
    const { startDisplay } = await import("../display/display");
    void startDisplay(app.querySelector<HTMLDivElement>("#lpBoard")!);
    const until = async (ok: () => boolean) => {
      while (!ok()) await new Promise((r) => setTimeout(r, 40));
    };
    await until(() => !!server.room);
    const room = server.room!;
    for (let i = 0; i < cfg.humans; i++) {
      const name = (cfg.names[i] ?? "").trim() || `لاعب ${ar(i + 1)}`;
      startController(app.querySelector<HTMLDivElement>(`#lpP${i}`)!, room.code, { name, keys: cfg.humans > 1 ? KEYS[i] : undefined });
      // join one after another so the first person here is the host
      await until(() => room.state.players.filter((x) => !x.isBot).length === i + 1);
    }
    room.setBoard(cfg.game);
    pickCourse(room);
    for (let i = 0; i < botsFor(cfg.humans); i++) room.addBot();
    if (cfg.rounds && BOARDS[cfg.game]) room.setRounds(cfg.rounds);
    room.start();
  }
  /** football fills both teams with the computer by itself; pool is best one-on-one */
  function botsFor(humans: number) {
    if (cfg.game === "football") return 0;
    if (cfg.game === "pool") return humans > 1 ? 0 : 1;
    return cfg.bots;
  }

  async function playPhone(server: ReturnType<typeof useLocalServer>) {
    app.innerHTML = `<div id="lpP0"></div><a class="lp-exit ph-exit" href="?local" title="رجوع">✕</a>`;
    // the room is made the usual way (a screen creates it); this phone then joins as the only person
    server.connect().emit("screen:create", () => {});
    while (!server.room) await new Promise((r) => setTimeout(r, 40));
    const room = server.room;
    const name = (cfg.names[0] ?? "").trim() || "لاعب ١";
    startController(app.querySelector<HTMLDivElement>("#lpP0")!, room.code, { name, phone: true });
    while (room.state.players.length < 1) await new Promise((r) => setTimeout(r, 40));
    room.setBoard(cfg.game);
    pickCourse(room);
    for (let i = 0; i < botsFor(1); i++) room.addBot();
    if (cfg.rounds && BOARDS[cfg.game]) room.setRounds(cfg.rounds);
    room.start();
  }

  setup();
}
