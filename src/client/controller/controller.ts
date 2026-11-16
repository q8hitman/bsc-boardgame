import "./controller.css";
import { BOARDS, DUCKS, ITEMS, MINIGAMES, WHEEL } from "../../shared/data";
import { CARD_GAME } from "../../shared/cards";
import { CARDS_ID, isCards, isRace, ranked } from "../../shared/rules";
import { createCardPad } from "./cardpad";
import type { GameState, Player } from "../../shared/types";
import { ar, Clock, connect, esc, icon, tokenImg } from "../net";

const duckImg = (p: { duck: number }) => `assets/tokens/token${p.duck}.png`;
// timers instead of animation frames: they keep running when a phone dims or the tab is in the background
const nextFrame = (fn: () => void) => window.setTimeout(fn, 40);
const cancelFrame = (id: number) => clearTimeout(id);
const buzz = (ms: number | number[]) => navigator.vibrate?.(ms);

/** One-device mode: this panel joins the in-page room by itself, and keys can stand in for taps. */
export interface LocalPad {
  name: string;
  /** [tap, second button] keyboard keys, e.g. ["a", "s"] (minigames when two people share one keyboard) */
  keys?: [string, string];
}

export function startController(root: HTMLElement, initialCode: string, local?: LocalPad) {
  if (!local) document.body.classList.add("pad");
  root.innerHTML = `<div class="pad-wrap"><div class="pad-top hidden" id="top"></div><div class="pad-main" id="main"></div></div><button class="skip hidden" id="skip">تخطي ⏭</button>`;
  const wrap = root.querySelector<HTMLDivElement>(".pad-wrap")!;
  const top = root.querySelector<HTMLDivElement>("#top")!;
  const main = root.querySelector<HTMLDivElement>("#main")!;
  const skipBtn = root.querySelector<HTMLButtonElement>("#skip")!;

  const sock = connect();
  const clock = new Clock();
  let code = initialCode;
  let me = "";
  const pad = createCardPad(sock, root.querySelector<HTMLDivElement>("#main")!, () => me, !!local?.keys);
  sock.on("hand", (h) => pad.setHand(h));
  let st: GameState | null = null;
  let key = "";
  let mgCleanup: (() => void) | null = null;

  const tokenKey = (c: string) => `duck-token-${c}`;
  const savedName = () => (local ? local.name : localStorage.getItem("duck-name") ?? "");

  function join(c: string, name: string, onErr?: (e: string) => void) {
    const tok = local ? undefined : localStorage.getItem(tokenKey(c)) ?? undefined;
    sock.emit("player:join", { code: c, name, token: tok }, (res) => {
      if (!res.ok) {
        if (tok) localStorage.removeItem(tokenKey(c));
        onErr?.(res.error);
        return;
      }
      code = c;
      me = res.playerId;
      if (!local) {
        localStorage.setItem(tokenKey(c), res.token);
        history.replaceState(null, "", `?join=${c}`);
      }
      key = "";
      if (latest && latest.code === c) {
        st = latest;
        render(latest);
      }
    });
  }

  sock.on("connect", () => {
    if (local) {
      if (!me) join(code, local.name);
      return;
    }
    if (code && localStorage.getItem(tokenKey(code))) join(code, savedName(), () => showJoin());
    else if (me) join(code, savedName());
    // otherwise the join form is already on screen: never reset it, the player may be typing
  });
  // show the form right away instead of waiting for the connection
  if (!local && !(code && localStorage.getItem(tokenKey(code)))) queueMicrotask(() => key !== "join" && !me && showJoin());
  else if (local) main.innerHTML = `<h2>لحظة…</h2>`;

  // keyboard stands in for the screen: tap = minigame zone / main button, second = the other choice
  if (local?.keys) {
    addEventListener("keydown", (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === local.keys![0]) {
        const z = main.querySelector<HTMLElement>(".mg-zone");
        if (z) z.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        else main.querySelector<HTMLButtonElement>("#ready, #roll, #push, #spin, #draw, .kw-btn")?.click();
      } else if (k === local.keys![1]) main.querySelector<HTMLButtonElement>("#bank, #keep, #n, #leave")?.click();
    });
  }
  sock.on("disconnect", () => {
    if (me) {
      key = "";
      main.innerHTML = `<h2>انقطع الاتصال… نرجعك</h2>`;
    }
  });
  let latest: GameState | null = null;
  sock.on("state", (s) => {
    clock.update(s);
    latest = s; // the server can send state just before the join is confirmed
    if (!me || s.code !== code) return;
    st = s;
    render(s);
  });

  skipBtn.onclick = () => sock.emit("host:skip");

  // ------------------------------------------------------------------ screens
  function showJoin(error = "") {
    key = "join";
    top.classList.add("hidden");
    main.innerHTML = `
      <img class="duck" src="assets/tokens/token0.png" alt="">
      <h1>حفلة البط</h1>
      <input class="code" id="c" maxlength="4" placeholder="رمز" value="${esc(code)}" autocomplete="off" />
      <input id="n" maxlength="14" placeholder="اسمك (اختياري)" value="${esc(savedName())}" />
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <button class="big-btn" id="go">ادخل</button>`;
    const go = () => {
      const c = (main.querySelector<HTMLInputElement>("#c")!.value || "").toUpperCase().trim();
      const n = main.querySelector<HTMLInputElement>("#n")!.value.trim();
      localStorage.setItem("duck-name", n);
      if (c.length !== 4) return showJoin("اكتب الرمز اللي على الشاشة (٤ حروف)");
      join(c, n, (e) => showJoin(e));
    };
    main.querySelector<HTMLButtonElement>("#go")!.onclick = go;
    main.querySelectorAll("input").forEach((i) => (i.onkeydown = (e) => e.key === "Enter" && go()));
  }

  const P = () => st!.players.find((p) => p.id === me)!;
  const isMyTurn = (s: GameState) => s.order[s.turnIdx] === me;

  function renderTop(s: GameState, p: Player) {
    top.classList.remove("hidden");
    top.innerHTML = `<img src="${duckImg(p)}" alt=""><div class="nm">${esc(p.name)}</div>
      ${s.phase === "lobby" ? "" : isCards(s) ? `<div class="st"><span>${ar(s.table?.counts[p.id] ?? 0)} كروت</span></div>` : isRace(s) ? `<div class="st"><span>خانة ${ar(p.node + 1)}</span></div>` : `<div class="st"><span>${icon("star", 24)}${ar(p.stars)}</span><span>${icon("bread", 24)}${ar(p.crumbs)}</span></div>`}`;
    wrap.style.setProperty("--duck-bg", DUCKS[p.duck].color);
  }

  function timerBar(s: GameState) {
    if (!s.phaseEndsAt) return "";
    return `<div class="bar"><i data-end="${s.phaseEndsAt}"></i></div>`;
  }
  let raf = 0;
  function runBars() {
    cancelFrame(raf);
    const bars = main.querySelectorAll<HTMLElement>(".bar i[data-end]");
    if (!bars.length) return;
    const t0 = Date.now();
    const tick = () => {
      bars.forEach((b) => {
        const end = clock.toLocal(Number(b.dataset.end));
        const total = Number(b.dataset.total ?? (b.dataset.total = String(Math.max(1, end - t0))));
        b.style.transform = `scaleX(${Math.max(0, end - Date.now()) / total})`;
      });
      raf = nextFrame(tick);
    };
    tick();
  }

  function render(s: GameState) {
    if (s.organizer?.id === me) return renderOrganizer(s);
    const p = P();
    if (!p) {
      localStorage.removeItem(tokenKey(code));
      me = "";
      return showJoin("انطلعت من الغرفة. ادخل مرة ثانية");
    }
    renderTop(s, p);
    skipBtn.classList.toggle("hidden", !p.isHost || s.phase === "lobby" || s.phase === "end");

    // card game: its own screen while the game runs
    if (isCards(s) && ["intro", "cards", "tile", "final"].includes(s.phase)) {
      mgCleanup?.();
      mgCleanup = null;
      key = "cards";
      return pad.render(s);
    }
    if (s.phase === "lobby") pad.reset();
    const mine = isMyTurn(s);
    const k = [s.phase, s.turnIdx, s.round, mine, p.items.join(), s.minigame?.startAt ?? 0, s.minigame?.ready?.[me] ? "r" : "", s.phase === "lobby" ? JSON.stringify([s.players.map((x) => x.name + x.isBot + x.duck), s.maxRounds, p.isHost, s.boardId]) : "", s.pendingChoice?.playerId, s.pendingBuy?.playerId, s.pendingTarget?.playerId].join("|");
    if (k === key) return;
    const prevPhase = key.split("|")[0];
    key = k;
    if (!(s.phase === "mgPlay" && prevPhase === "mgPlay")) {
      mgCleanup?.();
      mgCleanup = null;
    }
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);

    switch (s.phase) {
      case "lobby":
        return renderLobby(s, p);
      case "intro":
        main.innerHTML = `<img class="duck" src="${duckImg(p)}" alt=""><h1>يلا نبدأ!</h1><p>${local ? "طالع البورد" : "طالع الشاشة الكبيرة"}</p>`;
        return;
      case "turn":
        if (mine) {
          buzz([80, 60, 80]);
          main.innerHTML = `<h1>دورك!</h1>
            <button class="roll" id="roll"><span>${icon("dice", 92)}</span>ارمِ</button>
            ${p.items.length ? `<p>أغراضك</p><div class="row-btns">${p.items.map((it, i) => `<button class="item-btn" data-i="${i}" data-it="${it}"><b>${icon(ITEMS[it].icon, 44)}</b>${ITEMS[it].name}</button>`).join("")}</div>` : ""}
            ${timerBar(s)}`;
          main.querySelector<HTMLButtonElement>("#roll")!.onclick = () => {
            buzz(40);
            sock.emit("player:roll");
          };
          main.querySelectorAll<HTMLButtonElement>(".item-btn").forEach((b) => {
            b.onclick = () => {
              sock.emit("player:useItem", b.dataset.it as never);
              b.disabled = true;
              b.style.opacity = ".4";
            };
          });
          return runBars();
        }
        return waiting(s, cur ? `دور ${cur.name}` : "");
      case "choosePath":
        if (s.pendingChoice?.playerId === me) {
          buzz([60, 40, 60]);
          main.innerHTML = `<h1>مفترق طرق!</h1><p>أي طريق تبي؟</p>
            <div class="split">${s.pendingChoice.options.map((o) => `<button class="big-btn" data-to="${o.to}">${esc(o.label)}</button>`).join("")}</div>${timerBar(s)}`;
          main.querySelectorAll<HTMLButtonElement>("[data-to]").forEach((b) => (b.onclick = () => sock.emit("player:choose", Number(b.dataset.to))));
          return runBars();
        }
        return waiting(s, `${cur?.name ?? ""} يختار طريقه`);
      case "buyStar":
        if (s.pendingBuy?.playerId === me) {
          buzz([60, 40, 60]);
          main.innerHTML = `${icon("star", 120)}<h1>تشتري النجمة؟</h1><p>بـ ${ar(s.pendingBuy.cost)} فتات</p>
            <div class="split"><button class="big-btn green" id="y">إيه!</button><button class="big-btn alt" id="n">لا</button></div>${timerBar(s)}`;
          main.querySelector<HTMLButtonElement>("#y")!.onclick = () => sock.emit("player:buy", true);
          main.querySelector<HTMLButtonElement>("#n")!.onclick = () => sock.emit("player:buy", false);
          return runBars();
        }
        return waiting(s, `${cur?.name ?? ""} عند النجمة!`);
      case "pickTarget":
        if (s.pendingTarget?.playerId === me) {
          buzz([60, 40, 60]);
          const others = s.players.filter((x) => x.id !== me);
          main.innerHTML = `<h1>${s.pendingTarget.reason === "duel" ? "منو تبارز؟" : "منو تسرق؟"}</h1>
            <div class="targets">${others.map((o) => `<button class="target" data-id="${o.id}"><img src="${duckImg(o)}" alt="">${esc(o.name)}<br>${icon("bread", 20)}${ar(o.crumbs)}</button>`).join("")}</div>${timerBar(s)}`;
          main.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((b) => (b.onclick = () => sock.emit("player:target", b.dataset.id!)));
          return runBars();
        }
        return waiting(s, s.pendingTarget?.reason === "duel" ? "مبارزة!" : "سرقة!");
      case "shop":
        if (s.pendingShop?.playerId === me) {
          buzz([60, 40, 60]);
          const ps = s.pendingShop;
          main.innerHTML = `<h1>${esc(ps.name)}</h1><p>عندك ${icon("bread", 26)}${ar(p.crumbs)} فتات</p>
            <div class="shop">${ps.stock.map((x) => {
              const full = x.item === "shield" ? p.shielded : p.items.length >= 3;
              const no = p.crumbs < x.price || full;
              return `<button class="ware" data-item="${x.item}" ${no ? "disabled" : ""}>${icon(ITEMS[x.item].icon, 46)}<span><b>${ITEMS[x.item].name}</b><small>${full ? "عندك واحد / شنطتك مليانة" : ITEMS[x.item].desc}</small></span><em>${icon("bread", 20)}${ar(x.price)}</em></button>`;
            }).join("")}</div>
            <button class="big-btn alt" id="leave">لا شكراً</button>${timerBar(s)}`;
          main.querySelectorAll<HTMLButtonElement>("[data-item]").forEach((b) => (b.onclick = () => {
            buzz(40);
            sock.emit("player:shopBuy", b.dataset.item as never);
          }));
          main.querySelector<HTMLButtonElement>("#leave")!.onclick = () => sock.emit("player:shopBuy", null);
          return runBars();
        }
        return waiting(s, `${cur?.name ?? ""} في ${s.pendingShop?.name ?? "الدكان"}`);
      case "wheel":
        if (s.pendingWheel?.playerId === me) {
          buzz([80, 60, 80]);
          const seg = 360 / WHEEL.length;
          main.innerHTML = `<h1>عجلة الحظ!</h1>
            <div class="mini-wheel spin" style="background:conic-gradient(${WHEEL.map((w, i) => `${w.color} ${i * seg}deg ${(i + 1) * seg}deg`).join(",")})"></div>
            <button class="roll" id="spin">وقّف!</button>${timerBar(s)}`;
          main.querySelector<HTMLButtonElement>("#spin")!.onclick = () => {
            buzz(60);
            main.querySelector(".mini-wheel")?.classList.remove("spin");
            sock.emit("player:spin");
          };
          return runBars();
        }
        return waiting(s, "عجلة الحظ!");
      case "moving":
      case "tile":
        return waiting(s, mine ? "طالع قطعتك على الشاشة!" : cur ? `دور ${cur.name}` : "");
      case "mgIntro": {
        const mg = s.minigame!;
        const meta = MINIGAMES[mg.id];
        const inIt = mg.participants.includes(me);
        const isReady = !!mg.ready?.[me];
        main.innerHTML = `${icon(meta.icon, 110)}<h1>${meta.title}</h1><p>${inIt ? meta.howTo : "تتفرج هالمرة. شجّع!"}</p>
          ${inIt ? (isReady ? `<h2>✓ بانتظار الباقين…</h2>` : `<button class="big-btn green" id="ready">جاهز!</button>`) : ""}${timerBar(s)}`;
        main.querySelector<HTMLButtonElement>("#ready")?.addEventListener("click", () => {
          buzz(40);
          sock.emit("mg:ready");
        });
        if (inIt && !isReady) buzz(100);
        return runBars();
      }
      case "mgPlay":
        if (prevPhase === "mgPlay" && mgCleanup) return;
        return startMinigame(s);
      case "mgResults": {
        const r = s.minigame?.results?.find((x) => x.playerId === me);
        main.innerHTML = r
          ? `${r.rank === 0 ? icon("trophy", 120) : `<b class="badge b${Math.min(r.rank, 3)} big">${ar(r.rank + 1)}</b>`}<h1>${r.rank === 0 ? "فزت!" : `المركز ${ar(r.rank + 1)}`}</h1><p>${esc(r.display)}</p><h2>${r.reward >= 0 ? "+" : ""}${ar(r.reward)} ${isRace(s) ? "خطوات" : icon("bread", 34)}</h2>`
          : `<h1>النتايج على الشاشة</h1>`;
        if (r?.rank === 0) buzz([100, 50, 100, 50, 200]);
        return;
      }
      case "final":
        main.innerHTML = `${icon("gift", 120)}<h1>الجوايز المخفية!</h1><p>${local ? "طالع البورد" : "طالع الشاشة"}</p>`;
        return;
      case "end": {
        const rank = ranked(s).findIndex((x) => x.id === me);
        main.innerHTML = `${rank === 0 ? icon("trophy", 130) : tokenImg(p.duck, 150)}<h1>${rank === 0 ? "انت الفايز!" : `خلصت بالمركز ${ar(rank + 1)}`}</h1>
          <p>${isCards(s) ? (rank === 0 ? "خلّصت كروتك قبل الكل!" : `باقي عندك ${ar(s.table?.counts[me] ?? 0)} كروت`) : isRace(s) ? `وصلت خانة ${ar(p.node + 1)}` : `${icon("star", 26)}${ar(p.stars)} · ${icon("bread", 26)}${ar(p.crumbs)}`}</p>
          ${p.isHost ? `<button class="big-btn" id="again">لعبة جديدة</button>` : `<p>بانتظار المنظم…</p>`}`;
        main.querySelector<HTMLButtonElement>("#again")?.addEventListener("click", () => sock.emit("host:restart"));
        return;
      }
    }
  }

  function waiting(s: GameState, title: string) {
    const p = P();
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);
    const show = cur && cur.id !== me && ["turn", "moving", "tile", "choosePath", "buyStar", "pickTarget", "shop", "wheel"].includes(s.phase) ? cur : p;
    main.innerHTML = `<img class="duck${show !== p ? " other" : ""}" src="${duckImg(show)}" alt=""><h2>${esc(title)}</h2>
      ${p.items.length || p.shielded ? `<p>أغراضك: ${p.items.map((i) => icon(ITEMS[i].icon, 30)).join(" ")} ${p.shielded ? icon("shield", 30) : ""}</p>` : ""}
      <p style="opacity:.7">الجولة ${ar(s.round)} من ${ar(s.maxRounds)}</p>`;
  }

  function renderLobby(s: GameState, p: Player) {
    main.innerHTML = `
      <img class="duck" src="${duckImg(p)}" alt="">
      <h1>${esc(DUCKS[p.duck].name)}</h1>${DUCKS[p.duck].ref ? `<p class="ref">من ${esc(DUCKS[p.duck].ref!)}</p>` : ""}
      <input id="nm" maxlength="14" value="${esc(p.name)}" />
      <p>اختار قطعتك</p>
      <div class="picker">${DUCKS.map((d, i) => {
        const owner = s.players.find((x) => x.duck === i);
        const mine = owner?.id === me;
        return `<button class="pick ${mine ? "mine" : ""} ${owner && !mine ? "taken" : ""}" data-piece="${i}" ${owner && !mine ? "disabled" : ""} style="--c:${d.color}">
          <img src="assets/tokens/token${i}.png" alt="${esc(d.name)}"><span>${esc(owner && !mine ? owner.name : d.name)}</span></button>`;
      }).join("")}</div>
      ${p.isHost
        ? `<p>انت المنظم</p>
           <button class="small-btn" id="org">ما راح ألعب، بنظم بس</button>
           ${boardPicker(s)}
           ${isCards(s) ? "" : `<div class="stepper"><button id="rm">−</button><span>${ar(s.maxRounds)} جولات</span><button id="rp">+</button></div>`}
           <div class="host-tools"><button id="ab">+ لاعب كمبيوتر</button><button id="rb">− لاعب كمبيوتر</button></div>
           <button class="big-btn green" id="start" ${s.players.length < 2 ? "disabled style='opacity:.5'" : ""}>ابدأ اللعبة (${ar(s.players.length)} لاعبين)</button>`
        : `<p>بانتظار المنظم يبدأ… (${ar(s.players.length)} لاعبين)</p>`}`;
    const nm = main.querySelector<HTMLInputElement>("#nm")!;
    nm.onchange = () => {
      if (!local) localStorage.setItem("duck-name", nm.value.trim());
      sock.emit("player:rename", nm.value);
    };
    main.querySelectorAll<HTMLButtonElement>("[data-piece]").forEach((b) =>
      b.addEventListener("click", () => {
        buzz(20);
        sock.emit("player:pickPiece", Number(b.dataset.piece));
      }),
    );
    main.querySelector("#rm")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds - (s.maxRounds > 5 ? 5 : 1)));
    main.querySelector("#rp")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds + (s.maxRounds >= 5 ? 5 : 1)));
    main.querySelector("#ab")?.addEventListener("click", () => sock.emit("host:addBot"));
    main.querySelector("#rb")?.addEventListener("click", () => sock.emit("host:removeBot"));
    main.querySelector("#start")?.addEventListener("click", () => sock.emit("host:start"));
    main.querySelector("#org")?.addEventListener("click", () => sock.emit("host:setPlaying", false));
    bindBoardPicker();
  }

  /** Host chooses the board in the lobby. */
  function boardPicker(s: GameState) {
    const games = [...Object.values(BOARDS).map((b) => ({ id: b.id, name: b.name })), { id: CARDS_ID, name: `${CARD_GAME.name} (كروت)` }];
    return `<p>اختار اللعبة</p><div class="bpick">${games
      .map((b) => `<button class="${s.boardId === b.id ? "on" : ""}" data-board="${b.id}"><img src="assets/thumbs/${b.id}.jpg" alt=""><span>${esc(b.name)}</span></button>`)
      .join("")}</div>`;
  }
  function bindBoardPicker() {
    main.querySelectorAll<HTMLButtonElement>("[data-board]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("host:setBoard", b.dataset.board!);
    }));
  }

  // ------------------------------------------------------------------ organizer (runs the game, doesn't play)
  const PHASE_TXT: Record<string, string> = {
    intro: "البداية", turn: "دور", moving: "يمشي", tile: "على الخانة", choosePath: "يختار طريق", buyStar: "عند النجمة",
    pickTarget: "يختار خصم", cards: "دور", shop: "في الدكان", wheel: "يلف عجلة الحظ", mgIntro: "ميني قيم: الاستعداد", mgPlay: "ميني قيم شغالة", mgResults: "نتايج الميني قيم",
    final: "الجوايز المخفية", end: "خلصت اللعبة",
  };
  function renderOrganizer(s: GameState) {
    skipBtn.classList.add("hidden");
    top.classList.remove("hidden");
    top.innerHTML = `${icon("crown", 48)}<div class="nm">${esc(s.organizer!.name)}</div><div class="st"><span>المنظم</span></div>`;
    wrap.style.setProperty("--duck-bg", "#B9A6FF"); // contrasts with the yellow crown
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);
    const k = ["org", s.phase, s.turnIdx, s.round, s.maxRounds, s.boardId, s.players.map((x) => x.name + x.duck + x.stars + x.crumbs + x.isBot + x.node).join(), s.minigame?.id ?? "", JSON.stringify(s.table?.counts ?? {})].join("|");
    if (k === key) return;
    key = k;
    mgCleanup?.();
    mgCleanup = null;
    if (s.phase === "lobby") {
      main.innerHTML = `${icon("crown", 110)}<h1>انت المنظم</h1><p>ما تلعب. تتحكم باللعبة من هني</p>
        <button class="small-btn" id="play">أبي ألعب بعد</button>
        ${boardPicker(s)}
        <div class="org-list">${s.players.map((x) => `<span>${tokenImg(x.duck, 44)}${esc(x.name)}</span>`).join("") || "<p>بانتظار اللاعبين…</p>"}</div>
        ${isCards(s) ? "" : `<div class="stepper"><button id="rm">−</button><span>${ar(s.maxRounds)} جولات</span><button id="rp">+</button></div>`}
        <div class="host-tools"><button id="ab">+ لاعب كمبيوتر</button><button id="rb">− لاعب كمبيوتر</button></div>
        <button class="big-btn green" id="start" ${s.players.length < 2 ? "disabled style='opacity:.5'" : ""}>ابدأ اللعبة (${ar(s.players.length)} لاعبين)</button>`;
      main.querySelector("#play")!.addEventListener("click", () => sock.emit("host:setPlaying", true));
      main.querySelector("#rm")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds - (s.maxRounds > 5 ? 5 : 1)));
      main.querySelector("#rp")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds + (s.maxRounds >= 5 ? 5 : 1)));
      main.querySelector("#ab")!.addEventListener("click", () => sock.emit("host:addBot"));
      main.querySelector("#rb")!.addEventListener("click", () => sock.emit("host:removeBot"));
      main.querySelector("#start")!.addEventListener("click", () => sock.emit("host:start"));
      bindBoardPicker();
      return;
    }
    const rk = ranked(s);
    const status = s.phase === "end" ? PHASE_TXT.end
      : ["turn", "moving", "tile", "choosePath", "buyStar", "pickTarget", "shop", "wheel", "cards"].includes(s.phase) && cur ? `${PHASE_TXT[s.phase]} ${cur.name}`
      : PHASE_TXT[s.phase] ?? "";
    main.innerHTML = `<p style="opacity:.75">${isCards(s) ? `${CARD_GAME.name} ${CARD_GAME.sub}` : `الجولة ${ar(s.round)} من ${ar(s.maxRounds)}`}</p><h2>${esc(status)}</h2>
      <div class="org-rank">${rk.map((x, i) => `<div class="${x.id === cur?.id ? "cur" : ""}"><b>${ar(i + 1)}</b>${tokenImg(x.duck, 40)}<span>${esc(x.name)}</span>${isCards(s) ? `<span>${ar(s.table?.counts[x.id] ?? 0)} كروت</span><span></span>` : isRace(s) ? `<span>خانة ${ar(x.node + 1)}</span><span></span>` : `<span>${icon("star", 22)}${ar(x.stars)}</span><span>${icon("bread", 22)}${ar(x.crumbs)}</span>`}</div>`).join("")}</div>
      ${s.phase === "end"
        ? `<button class="big-btn" id="again">لعبة جديدة</button>`
        : `<button class="big-btn alt" id="oskip">تخطي ⏭</button><p style="opacity:.7;font-size:15px">إذا أحد علّق أو طوّل، التخطي يكمل عنه</p>`}`;
    main.querySelector("#oskip")?.addEventListener("click", () => sock.emit("host:skip"));
    main.querySelector("#again")?.addEventListener("click", () => sock.emit("host:restart"));
  }

  // ------------------------------------------------------------------ minigames
  function startMinigame(s: GameState) {
    const mg = s.minigame!;
    const meta = MINIGAMES[mg.id];
    if (!mg.participants.includes(me)) {
      main.innerHTML = `${icon(meta.icon, 110)}<h1>شجّع اللاعبين!</h1>`;
      return;
    }
    const start = clock.toLocal(mg.startAt);
    const end = start + mg.durationMs;
    let done = false;
    const timers: number[] = [];
    const submit = (score: number) => {
      if (done) return;
      done = true;
      sock.emit("mg:submit", { score });
    };
    main.innerHTML = `<h2>${meta.title}</h2><div class="mg-zone" id="z"><div class="count-big" id="cd"></div></div>`;
    const z = main.querySelector<HTMLDivElement>("#z")!;
    const cd = main.querySelector<HTMLDivElement>("#cd")!;
    let raf = 0;
    const countdown = () => {
      const left = start - Date.now();
      if (left > 0) {
        cd.textContent = ar(Math.ceil(left / 1000));
        raf = nextFrame(countdown);
      } else begin();
    };
    let early = false;
    // reaction game needs to catch taps during the countdown too
    const tap = (fn: (t: number) => void) => {
      const h = (e: Event) => {
        e.preventDefault();
        fn(performance.now() + (Date.now() - performance.now()));
      };
      z.addEventListener("pointerdown", h);
      return () => z.removeEventListener("pointerdown", h);
    };
    let offTap: () => void = () => {};

    function begin() {
      if (done) return;
      offTap();
      switch (mg.id) {
        case "tenSeconds": {
          z.innerHTML = `<div class="huge" id="t">٠.٠</div><small>اضغط بأي مكان لما توصل ١٠</small>`;
          const t = z.querySelector<HTMLDivElement>("#t")!;
          const loop = () => {
            const el = (Date.now() - start) / 1000;
            t.textContent = el < 3 ? el.toFixed(1) : "؟؟";
            if (!done && Date.now() < end) raf = nextFrame(loop);
          };
          loop();
          offTap = tap(() => {
            if (done) return;
            const ms = Date.now() - start;
            submit(ms);
            buzz(60);
            cancelFrame(raf);
            z.innerHTML = `<div class="huge">${(ms / 1000).toFixed(2)}</div><small>ثانية · ${local ? "طالع البورد" : "طالع الشاشة"}</small>`;
          });
          break;
        }
        case "dontWake": {
          const sig = start + (mg.signalDelayMs ?? 3000);
          z.className = "mg-zone sleep";
          z.innerHTML = `<div class="huge zz">Zzz</div>لا تضغط…`;
          timers.push(window.setTimeout(() => {
            if (done) return;
            z.className = "mg-zone go";
            z.innerHTML = `${icon("rooster", 130)}اضغط الحين!`;
            buzz(80);
          }, Math.max(0, sig - Date.now())));
          offTap = tap(() => {
            if (done) return;
            const now = Date.now();
            if (now < sig) {
              early = true;
              submit(-1);
              z.className = "mg-zone bad";
              z.innerHTML = `<div class="huge bang">!</div>استعجلت!`;
              buzz([200, 80, 200]);
            } else {
              submit(now - start);
              z.innerHTML = `${icon("star", 110)}${ar(now - sig)} ms`;
            }
          });
          break;
        }
        case "mash": {
          let n = 0;
          z.innerHTML = `<div class="huge" id="n">٠</div>اضغط اضغط اضغط!`;
          const nEl = z.querySelector<HTMLDivElement>("#n")!;
          let lastSent = 0;
          offTap = tap(() => {
            if (done) return;
            n++;
            nEl.textContent = ar(n);
            if (n % 5 === 0) buzz(15);
            if (Date.now() - lastSent > 200) {
              lastSent = Date.now();
              sock.emit("mg:progress", n);
            }
          });
          timers.push(window.setTimeout(() => {
            submit(n);
            z.innerHTML = `${icon("boat", 120)}${ar(n)} ضغطة`;
          }, Math.max(0, end - Date.now() - 300)));
          break;
        }
        case "pushLuck": {
          let pot = 1;
          let busy = false;
          main.innerHTML = `<h2>${meta.title}</h2><div class="mg-zone" id="z2"><div class="huge" id="pot">${icon("bread", 90)} ${ar(pot)}</div><small>كل ضغطة تضاعفها… والثعلب يراقب</small></div>
            <div class="split"><button class="big-btn red" id="push">ضاعف!</button><button class="big-btn green" id="bank">احفظ</button></div>`;
          const potEl = main.querySelector<HTMLDivElement>("#pot")!;
          const z2 = main.querySelector<HTMLDivElement>("#z2")!;
          const finish = (html: string, cls: string) => {
            z2.className = "mg-zone " + cls;
            z2.innerHTML = html;
            main.querySelector(".split")?.remove();
          };
          main.querySelector<HTMLButtonElement>("#push")!.onclick = () => {
            if (busy || done) return;
            busy = true;
            sock.emit("mg:push", (res) => {
              busy = false;
              if (res.busted) {
                done = true;
                buzz([200, 80, 200]);
                finish(`${icon("fox", 130)}أكلها الثعلب!`, "bad");
              } else {
                pot = res.pot;
                potEl.innerHTML = `${icon("bread", 90)} ${ar(pot)}`;
                buzz(30);
              }
            });
          };
          const bank = () => {
            if (done || busy) return;
            submit(pot);
            finish(`<div class="huge">${icon("bread", 90)} ${ar(pot)}</div>حفظتها!`, "go");
          };
          main.querySelector<HTMLButtonElement>("#bank")!.onclick = bank;
          timers.push(window.setTimeout(bank, Math.max(0, end - Date.now() - 400)));
          break;
        }
      }
    }
    if (mg.id === "dontWake") {
      // tapping during the countdown is too early as well
      offTap = tap(() => {
        if (done || Date.now() >= start) return;
        early = true;
        submit(-1);
        cancelFrame(raf);
        z.className = "mg-zone bad";
        z.innerHTML = `<div class="huge bang">!</div>استعجلت!`;
        buzz([200, 80, 200]);
      });
    }
    countdown();
    void early;
    mgCleanup = () => {
      cancelFrame(raf);
      timers.forEach(clearTimeout);
      offTap();
    };
  }
}
