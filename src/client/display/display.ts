import "./display.css";
import QRCode from "qrcode";
import { BOARDS, DUCKS, ITEMS, LANDMARKS, MAX_PLAYERS, MINIGAMES, STAR_COST, WHEEL } from "../../shared/data";
import { CARD_GAME } from "../../shared/cards";
import { isCards, isRace, ranked } from "../../shared/rules";
import type { GameState, Player } from "../../shared/types";
import { ar, Clock, connect, esc, icon, isLocal, tokenImg } from "../net";
import { initAudio, sfx } from "../sfx";
import { BoardView, H, W } from "./board";
import { CardTable } from "./table";

const duckImg = (p: Player | { duck: number }) => `assets/tokens/token${p.duck}.png`;

export async function startDisplay(root: HTMLElement) {
  document.body.classList.add("display");
  root.innerHTML = `
    <div id="stage">
      <div id="game"></div>
      <div id="table" class="hidden"></div>
      <div id="ui">
        <div id="cards"></div>
        <div id="round" class="hidden"></div>
        <div id="dice" class="hidden"></div>
        <div id="banner" class="hidden"></div>
        <div id="modal" class="hidden"></div>
        <div id="lobby" class="hidden"></div>
        <div id="connecting">جاري التحميل…</div>
      </div>
    </div>`;
  const stage = root.querySelector<HTMLDivElement>("#stage")!;
  const $ = (id: string) => root.querySelector<HTMLDivElement>("#" + id)!;
  // fits whatever box it lives in: the whole window, or a part of it in one-device mode
  const fit = () => {
    const w = root.clientWidth || innerWidth;
    const h = root.clientHeight || innerHeight;
    const k = Math.min(w / W, h / H);
    stage.style.transform = `translate(${(w - W * k) / 2}px, ${(h - H * k) / 2}px) scale(${k})`;
  };
  fit();
  addEventListener("resize", fit);
  new ResizeObserver(fit).observe(root);
  addEventListener("pointerdown", () => initAudio());

  await document.fonts.load("800 40px 'Baloo Bhaijaan 2'").catch(() => {});
  let view = new BoardView($("game"), BOARDS.island);
  await view.ready;
  let board = view.scene;
  let boardId = "island";
  let switching: Promise<void> | null = null;
  /** The host picked another board in the lobby: rebuild the Phaser scene for it. */
  async function useBoard(id: string) {
    view.game?.destroy(true);
    $("game").innerHTML = "";
    view = new BoardView($("game"), BOARDS[id] ?? BOARDS.island);
    await view.ready;
    board = view.scene;
    boardId = id;
  }

  const sock = connect();
  const clock = new Clock();
  const table = new CardTable($("table"), clock);
  let st: GameState | null = null;
  let seen = -1;
  let lanBase = "";
  if (!isLocal()) fetch("/api/lan").then((r) => r.json()).then((d: { ips: string[] }) => {
    const host = d.ips[0] ?? location.hostname;
    lanBase = `${location.protocol}//${host}${location.port ? ":" + location.port : ""}`;
    if (st) render(st, false);
  }).catch(() => (lanBase = location.origin));

  sock.on("connect", () => {
    const saved = isLocal() ? null : JSON.parse(sessionStorage.getItem("duck-screen") ?? "null");
    const create = () => sock.emit("screen:create", (res) => sessionStorage.setItem("duck-screen", JSON.stringify(res)));
    if (saved) sock.emit("screen:resume", saved, (ok) => !ok && create());
    else create();
  });
  sock.on("state", (s) => {
    clock.update(s);
    $("connecting").classList.add("hidden");
    // the card game has no map: keep whatever board scene is loaded behind it
    const want = BOARDS[s.boardId] ? s.boardId : boardId;
    if (want !== boardId || switching) {
      st = s;
      seen = s.seq;
      if (!switching && want !== boardId)
        switching = useBoard(want).then(() => {
          switching = null;
          if (st) render(st, false);
        });
      return;
    }
    const fresh = s.seq !== seen;
    const prev = st;
    st = s;
    if (fresh) {
      seen = s.seq;
      playAnim(s, prev);
    }
    render(s, fresh);
  });

  // ------------------------------------------------------------------ helpers
  let bannerTimer = 0;
  function banner(title: string, text = "", ms = 0, piece?: number) {
    const b = $("banner");
    b.classList.remove("hidden");
    b.classList.toggle("with-piece", piece !== undefined);
    b.innerHTML = `${piece !== undefined ? `<img class="bn-piece" src="assets/tokens/token${piece}.png" alt="">` : ""}<div class="bn-text"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}<div id="timer" class="hidden"><i></i></div></div>`;
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = window.setTimeout(() => b.classList.add("hidden"), ms);
  }
  let modalTimer = 0;
  function modal(html: string, ms = 0) {
    const m = $("modal");
    m.innerHTML = html;
    m.classList.remove("hidden");
    clearTimeout(modalTimer);
    if (ms) modalTimer = window.setTimeout(() => m.classList.add("hidden"), ms);
  }
  const hideModal = () => $("modal").classList.add("hidden");
  const pl = (id: string) => st?.players.find((p) => p.id === id);
  const chip = (p: Player, extra = "", cls = "") =>
    `<div class="chip ${cls}"><img src="${duckImg(p)}" alt="">${esc(p.name)}${extra}</div>`;

  // ------------------------------------------------------------------ map photos, shop, wheel of fortune
  /** A round "photo" of a spot on the map (the landmark itself), cut from the board image. */
  function photoStyle([cx, cy]: [number, number], size = 230, span = 300) {
    const k = size / span;
    const bw = BOARDS.island.width * k;
    return `width:${size}px;height:${size}px;background-image:url(${BOARDS.island.image});background-size:${bw}px auto;background-position:${-(cx * k - size / 2)}px ${-(cy * k - size / 2)}px`;
  }

  let wheelAngle = 0;
  let wheelIdle = 0;
  function wheelHtml() {
    const seg = 360 / WHEEL.length;
    const grad = WHEEL.map((w, i) => `${w.color} ${i * seg}deg ${(i + 1) * seg}deg`).join(",");
    return `<div class="panel wheelpanel"><div class="wheelwrap"><div class="pointer"></div>
      <div class="wheel" id="wheel" style="background:conic-gradient(${grad})">${WHEEL.map((w, i) => `<span style="transform:rotate(${i * seg + seg / 2}deg)"><b>${esc(w.label)}</b></span>`).join("")}</div>
      <div class="hub">${icon("star", 70)}</div></div><div id="wheelres"><h1>عجلة الحظ!</h1><p>وقّفها من تلفونك</p></div></div>`;
  }
  function showWheelIdle() {
    modal(wheelHtml());
    cancelAnimationFrame(wheelIdle);
    let last = performance.now();
    const w = document.getElementById("wheel")!;
    const tick = (t: number) => {
      wheelAngle += (t - last) * 0.12;
      last = t;
      w.style.transform = `rotate(${wheelAngle}deg)`;
      wheelIdle = requestAnimationFrame(tick);
    };
    wheelIdle = requestAnimationFrame(tick);
  }
  function spinWheelTo(index: number) {
    if (!document.getElementById("wheel")) showWheelIdle();
    cancelAnimationFrame(wheelIdle);
    const w = document.getElementById("wheel")!;
    const seg = 360 / WHEEL.length;
    const centre = index * seg + seg / 2;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    // land the slice's centre under the pointer at the top, after a few full turns
    const base = wheelAngle + 360 * 4;
    const target = base + ((((-centre + jitter - base) % 360) + 360) % 360);
    w.style.transition = "transform 4.1s cubic-bezier(.12,.62,.14,1)";
    w.style.transform = `rotate(${target}deg)`;
    wheelAngle = target;
    // ticking sound that slows down with the wheel
    let n = 0;
    const tickSound = () => {
      if (n > 26) return;
      sfx.tick();
      n++;
      setTimeout(tickSound, 40 + n * n * 0.9);
    };
    tickSound();
  }

  let specialKey = "";
  function renderSpecial(s: GameState) {
    const k = s.phase === "shop" && s.pendingShop ? `shop|${s.seq}|${s.pendingShop.playerId}` : s.phase === "wheel" ? `wheel|${s.pendingWheel?.playerId}` : "";
    if (k === specialKey) return;
    const prevKey = specialKey;
    specialKey = k;
    if (k.startsWith("wheel")) return showWheelIdle();
    if (k.startsWith("shop")) {
      const ps = s.pendingShop!;
      const p = pl(ps.playerId);
      modal(`<div class="panel shoppanel"><div class="photo small" style="${photoStyle(ps.name.includes("المزرعة") ? [1250, 300] : [375, 200], 150, 260)}"></div>
        <h1>${esc(ps.name)}</h1>${p ? `<p>${chip(p, ` · ${icon("bread", 24)}${ar(p.crumbs)}`)}</p>` : ""}
        <div class="stock">${ps.stock.map((x) => `<div class="ware ${p && p.crumbs < x.price ? "dim" : ""}">${icon(ITEMS[x.item].icon, 64)}<b>${esc(ITEMS[x.item].name)}</b><span>${icon("bread", 22)}${ar(x.price)}</span></div>`).join("")}</div></div>`);
      return;
    }
    if (prevKey.startsWith("shop") && s.anim.kind !== "item") hideModal();
  }

  // ------------------------------------------------------------------ dice
  /** Real 3D die (CSS): drops in, tumbles, then settles on the rolled face with a little overshoot. */
  const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  let diceTimers: number[] = [];
  function rollDice(values: number[]) {
    diceTimers.forEach(clearTimeout);
    diceTimers = [];
    const box = $("dice");
    box.classList.remove("hidden", "out");
    const face = (n: number) => `<div class="face f${n}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="on"' : ""}></i>`).join("")}</div>`;
    box.innerHTML = values
      .map((v, i) => `<div class="die3d" style="animation-delay:${i * 90}ms"><div class="tilt"><div class="cube spin" style="animation-duration:${520 + i * 70}ms"><i class="core"></i><i class="core c2"></i><i class="core c3"></i>${[1, 2, 3, 4, 5, 6].map(face).join("")}</div></div><b class="dv">${ar(v)}</b></div>`)
      .join("");
    sfx.dice();
    const cubes = [...box.querySelectorAll<HTMLElement>(".cube")];
    diceTimers.push(window.setTimeout(() => {
      cubes.forEach((c, i) => {
        const [fx, fy] = FACE_ROT[values[i]];
        c.classList.remove("spin");
        c.style.transform = `rotateX(${fx - 200}deg) rotateY(${fy + 250}deg)`;
        void c.offsetWidth;
        c.classList.add("settle");
        c.style.transform = `rotateX(${fx}deg) rotateY(${fy}deg)`;
      });
    }, 900));
    diceTimers.push(window.setTimeout(() => {
      sfx.pop();
      box.querySelectorAll(".die3d").forEach((d) => d.classList.add("landed"));
    }, 1550));
    diceTimers.push(window.setTimeout(() => box.classList.add("out"), 2300));
    diceTimers.push(window.setTimeout(() => box.classList.add("hidden"), 2650));
  }

  // ------------------------------------------------------------------ animations
  function playAnim(s: GameState, prev: GameState | null) {
    const a = s.anim;
    if (isCards(s) && a.kind === "draw" && a.why === "deal")
      banner("يلا نوزع الكروت!", "طابق اللون أو الرقم. أول واحد يخلص كروته يفوز، ولما يبقى لك كرت واحد صيح كواك!", 4300);
    if (isCards(s) && table.anim(s)) return;
    switch (a.kind) {
      case "roll": {
        hideModal();
        board.clearCounter(true);
        rollDice(a.values);
        board.follow(a.playerId, 1.3);
        const p = pl(a.playerId);
        if (p) banner(`${p.name} رمى ${ar(a.values.reduce((x, y) => x + y, 0))}`, isRace(s) ? (a.values[0] === a.values[1] ? "دبل!" : "") : a.values.length > 1 ? "نرد مضاعف!" : "", 0, p.duck);
        break;
      }
      case "move":
        board.playMove(a.playerId, a.path, a.rest ?? 0);
        break;
      case "tile": {
        const good = a.delta > 0;
        board.clearCounter();
        if (a.text) board.float(a.playerId, a.text, good ? "#7CF0A0" : a.delta < 0 ? "#FF7A7A" : "#ffffff");
        if (good) {
          sfx.coin();
          setTimeout(() => flyBread(a.playerId, a.delta), 250);
        } else if (a.delta < 0) {
          sfx.bad();
          board.shake();
        }
        const p = pl(a.playerId);
        if (p) banner(p.name, a.text, 0, p.duck);
        break;
      }
      case "event": {
        sfx.event();
        board.shake(0.01);
        const chips = Object.entries(a.deltas)
          .filter(([, d]) => d !== 0)
          .map(([id, d]) => {
            const p = pl(id);
            return p ? chip(p, ` <span class="${d > 0 ? "plus" : "minus"}">${d > 0 ? "+" : ""}${ar(d)}</span>`) : "";
          })
          .join("");
        modal(`<div class="panel event"><div class="icon">${icon("star", 120)}</div><h1>${esc(a.title)}</h1><p>${esc(a.text)}</p><div class="chips">${chips}</div></div>`, 3900);
        if (a.moves) setTimeout(() => board.teleport(a.moves!, s.players), 600);
        Object.entries(a.deltas).forEach(([id, d]) => d && board.float(id, `${d > 0 ? "+" : ""}${d}`, d > 0 ? "#7CF0A0" : "#FF7A7A"));
        break;
      }
      case "star": {
        const p = pl(a.playerId);
        sfx.star();
        board.starToDuck(a.playerId);
        if (p) modal(`<div class="panel"><div class="icon">${icon("star", 140)}</div><h1>${esc(p.name)} اشترى نجمة!</h1><p>صار عنده ${ar(p.stars)} نجوم</p></div>`, 2600);
        // show everyone where the star went, then come back to the buyer
        setTimeout(() => {
          board.setStar(a.newStar, true);
          board.lookAt(a.newStar);
          banner("النجمة انتقلت!", "شوفوا وين صارت", 0);
        }, 2700);
        setTimeout(() => board.follow(a.playerId, 1.25), 4700);
        break;
      }
      case "item": {
        sfx.pop();
        const it = ITEMS[a.item] ?? { icon: "shield" };
        board.celebrate(a.playerId);
        if (a.to !== undefined) board.warp(a.playerId, a.to, "tunnel", 900);
        modal(`<div class="panel"><div class="icon">${icon(it.icon, 130)}</div><h1>${esc(a.text)}</h1></div>`, 2300);
        break;
      }
      case "jump": {
        const p = pl(a.playerId);
        board.playJump(a.playerId, a.from, a.to, a.jump);
        const n = (x: number) => ar(x + 1);
        if (p)
          banner(
            a.jump === "ladder" ? `سلّم DNA! ${p.name} طلع` : `الحية! ${p.name} نزل`,
            a.jump === "ladder" ? `من ${n(a.from)} لين ${n(a.to)}` : `من ${n(a.from)} لين ${n(a.to)}`,
            0, p.duck,
          );
        if (a.jump === "snake") setTimeout(() => sfx.bad(), 2200);
        break;
      }
      case "win": {
        const p = pl(a.playerId);
        sfx.fanfare();
        board.celebrate(a.playerId);
        setTimeout(() => board.celebrate(a.playerId), 900);
        if (p) modal(`<div class="panel"><div class="icon">${icon("crown", 130)}</div><h1>${esc(p.name)} وصل التاج!</h1><p>أول واحد يوصل خانة ١٠٠</p><div class="icon">${tokenImg(p.duck, 160)}</div></div>`, 5200);
        break;
      }
      case "landmark": {
        const p = pl(a.playerId);
        sfx.event();
        modal(`<div class="panel landmark"><div class="photo" style="${photoStyle(LANDMARKS[a.landmark].at)}"></div><h1>${esc(a.title)}</h1><p>${p ? esc(p.name) + ": " : ""}${esc(a.text)}</p></div>`, 3600);
        if (a.delta) {
          board.float(a.playerId, `${a.delta > 0 ? "+" : ""}${a.delta}`, a.delta > 0 ? "#7CF0A0" : "#FF7A7A");
          if (a.delta > 0) setTimeout(() => flyBread(a.playerId, a.delta), 400);
        }
        if (a.to !== undefined) {
          const style = ({ cave: "tunnel", zipline: "zip", boat: "boat", waterfall: "slide" } as const)[a.landmark as "cave"] ?? "tunnel";
          board.warp(a.playerId, a.to, style, 1400);
        }
        if (p) banner(a.title, a.text, 0, p.duck);
        break;
      }
      case "wheel": {
        spinWheelTo(a.index);
        const p = pl(a.playerId);
        if (a.moves) for (const [id, node] of Object.entries(a.moves)) board.warp(id, node, "tunnel", 4600);
        setTimeout(() => {
          const good = Object.values(a.deltas).reduce((x, y) => x + y, 0) >= 0 && !/خسر|عطى/.test(a.text);
          (good ? sfx.star : sfx.bad)();
          const chips = Object.entries(a.deltas)
            .filter(([, d]) => d !== 0)
            .map(([id, d]) => {
              const q = pl(id);
              return q ? chip(q, ` <span class="${d > 0 ? "plus" : "minus"}">${d > 0 ? "+" : ""}${ar(d)}</span>`) : "";
            })
            .join("");
          const res = document.getElementById("wheelres");
          if (res) res.innerHTML = `<h1>${esc(a.title)}</h1><p>${esc(a.text)}</p><div class="chips">${chips}</div>`;
          Object.entries(a.deltas).forEach(([id, d]) => d && board.float(id, `${d > 0 ? "+" : ""}${d}`, d > 0 ? "#7CF0A0" : "#FF7A7A"));
          if (p) banner(a.title, a.text, 0, p.duck);
        }, 4300);
        setTimeout(hideModal, 7300);
        break;
      }
      case "banner":
        {
          const curP = ["turn", "choosePath", "buyStar", "pickTarget", "shop", "wheel"].includes(s.phase) ? pl(s.order[s.turnIdx]) : undefined;
          banner(a.title, a.text, 0, curP?.duck);
        }
        if (s.phase === "intro") {
          board.follow(null);
          modal(`<div class="panel"><div class="icon">${tokenImg(0, 140)}</div><h1>${esc(a.title)}</h1><p>${esc(a.text)}</p>${isRace(s) ? "" : `<p>النجمة بـ ${ar(STAR_COST)} فتات</p>`}</div>`, 4000);
        }
        if (s.phase === "turn") {
          hideModal();
          const cur = s.order[s.turnIdx];
          if (prev?.phase !== "turn" || prev.order[prev.turnIdx] !== cur) board.follow(cur, 1.25);
        }
        if (s.phase === "mgIntro") board.follow(null);
        if (s.phase === "final") board.follow(null);
        break;
    }
    void prev;
  }

  // ------------------------------------------------------------------ render
  let timerRaf = 0;
  let mgKey = "";
  function render(s: GameState, fresh: boolean) {
    // race boards keep the HUD in the side margins so the 10x10 grid is never covered
    $("stage").classList.toggle("race", isRace(s));
    const inGame = s.phase !== "lobby";
    const cards = isCards(s);
    $("game").classList.toggle("hidden", cards);
    $("table").classList.toggle("hidden", !cards);
    if (cards) table.render(s);
    // board pieces
    if (cards) board.sync([], undefined);
    else if (inGame) {
      board.sync(s.players, s.order[s.turnIdx]);
      board.setStar(s.starNode, false);
    } else board.sync([], undefined);

    // lobby
    const lobby = $("lobby");
    lobby.classList.toggle("hidden", inGame);
    if (!inGame) renderLobby(s);

    // cards + round
    $("cards").classList.toggle("hidden", !inGame || s.phase === "end" || cards);
    if (inGame && !cards) {
      renderCards(s);
      animateCrumbs(s);
    }
    const round = $("round");
    round.classList.toggle("hidden", !inGame || s.round < 1 || s.phase === "end" || s.phase === "final" || cards);
    round.classList.toggle("last", s.round === s.maxRounds);
    round.innerHTML = `الجولة <b>${ar(s.round)}</b> من ${ar(s.maxRounds)}`;

    // decision timer inside banner
    cancelAnimationFrame(timerRaf);
    const tm = document.getElementById("timer");
    if (tm && s.phaseEndsAt && ["turn", "choosePath", "buyStar", "pickTarget", "shop", "wheel"].includes(s.phase)) {
      tm.classList.remove("hidden");
      const end = clock.toLocal(s.phaseEndsAt);
      const total = end - Date.now();
      const bar = tm.querySelector("i") as HTMLElement;
      const tick = () => {
        const left = Math.max(0, end - Date.now());
        bar.style.transform = `scaleX(${left / Math.max(1, total)})`;
        if (left > 0) timerRaf = requestAnimationFrame(tick);
      };
      tick();
    }

    // phase overlays
    if (s.phase === "mgIntro" || s.phase === "mgPlay" || s.phase === "mgResults") renderMinigame(s, fresh);
    else if (mgKey) {
      mgKey = "";
      hideModal();
    }
    if (s.phase === "final" && !isRace(s) && !cards) renderFinal(s);
    renderSpecial(s);
    if (s.phase === "end") renderEnd(s);
    if (s.phase === "lobby") {
      $("banner").classList.add("hidden");
      hideModal();
    }
  }

  function renderLobby(s: GameState) {
    const url = lanBase ? `${lanBase}/?join=${s.code}` : "";
    const lobby = $("lobby");
    if (!lobby.dataset.code || lobby.dataset.code !== s.code + url + s.boardId) {
      lobby.dataset.code = s.code + url + s.boardId;
      lobby.innerHTML = isLocal()
        ? `<div class="join"><h1>حفلة البط</h1><div class="sub">على هالجهاز</div><div class="bname">${esc(BOARDS[s.boardId]?.name ?? `${CARD_GAME.name} ${CARD_GAME.sub}`)}</div></div>
           <div class="seats" id="seats"></div><div class="hint" id="hint"></div>`
        : `
        <div class="join">
          <h1>حفلة البط</h1>
          <div class="sub">صوّر الكود من تلفونك وادخل</div>
          <div class="bname">${esc(BOARDS[s.boardId]?.name ?? `${CARD_GAME.name} ${CARD_GAME.sub}`)}</div>
          <img class="qr" id="qr" alt="">
          <div class="code">${s.code}</div>
          <div class="url">${esc(url.replace(/^https?:\/\//, ""))}</div>
        </div>
        <div class="seats" id="seats"></div>
        <div class="hint" id="hint"></div>`;
      if (url) QRCode.toDataURL(url, { margin: 1, width: 380, color: { dark: "#2b1b45" } }).then((d) => ((lobby.querySelector("#qr") as HTMLImageElement).src = d));
    }
    const seats = lobby.querySelector("#seats")!;
    const ids = s.players.map((p) => p.id).join();
    if (seats.getAttribute("data-ids") !== ids) {
      if (s.players.length > Number(seats.getAttribute("data-n") ?? 0)) sfx.pop();
      seats.setAttribute("data-ids", ids);
      seats.setAttribute("data-n", String(s.players.length));
      seats.innerHTML =
        s.players.map((p) => `<div class="seat"><img src="${duckImg(p)}" alt=""><div class="nm">${esc(p.name)}</div>${p.name !== DUCKS[p.duck].name ? `<div class="pc">${esc(DUCKS[p.duck].name)}</div>` : ""}${DUCKS[p.duck].ref ? `<div class="rf">من ${esc(DUCKS[p.duck].ref!)}</div>` : ""}${p.isHost ? '<div class="host">المنظم</div>' : p.isBot ? '<div class="host" style="background:#ddd">كمبيوتر</div>' : ""}</div>`).join("") +
        Array.from({ length: Math.max(0, Math.min(4, MAX_PLAYERS) - s.players.length) }, () => `<div class="seat empty">بانتظار لاعب…</div>`).join("");
    } else {
      seats.querySelectorAll(".nm").forEach((el, i) => (el.textContent = s.players[i]?.name ?? ""));
    }
    lobby.querySelector("#hint")!.textContent =
      (s.players.length < 2 ? "تحتاجون لاعبين على الأقل" : `${isCards(s) ? "أول واحد يخلص كروته يفوز" : `${ar(s.maxRounds)} جولات`} · ${isLocal() ? "ابدأ من لوحتك" : "المنظم يبدأ اللعبة من تلفونه"}`) +
      (s.organizer ? ` · المنظم: ${s.organizer.name} (ما يلعب)` : "");
  }

  let cardSig = "";
  const shownCrumbs: Record<string, number> = {};
  /** Count a card's bread number up/down instead of jumping. */
  function animateCrumbs(s: GameState) {
    for (const p of s.players) {
      const from = shownCrumbs[p.id];
      shownCrumbs[p.id] = p.crumbs;
      if (from === undefined || from === p.crumbs) continue;
      const el = () => document.querySelector<HTMLElement>(`[data-crumbs="${p.id}"]`);
      const card = document.querySelector<HTMLElement>(`[data-pid="${p.id}"]`);
      card?.classList.remove(p.crumbs > from ? "gain" : "loss");
      void card?.offsetWidth;
      card?.classList.add(p.crumbs > from ? "gain" : "loss");
      const t0 = performance.now();
      const dur = 650;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = el();
        if (e) e.textContent = ar(Math.round(from + (p.crumbs - from) * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      // let flying bread land first when gaining
      setTimeout(() => requestAnimationFrame(step), p.crumbs > from ? 700 : 0);
    }
  }

  /** Bread pieces fly from the piece on the board into the player's card. */
  function flyBread(pid: string, amount: number) {
    const from = board.screenPos(pid);
    const card = document.querySelector<HTMLElement>(`[data-pid="${pid}"] [data-crumbs]`);
    if (!from || !card) return;
    const stageRect = stage.getBoundingClientRect();
    const k = stageRect.width / W;
    const r = card.getBoundingClientRect();
    const to = { x: (r.left - stageRect.left) / k + 10, y: (r.top - stageRect.top) / k + 10 };
    const n = Math.min(8, Math.max(2, Math.ceil(amount / 2)));
    for (let i = 0; i < n; i++) {
      const b = document.createElement("img");
      b.src = "assets/icons/bread.png";
      b.className = "fly";
      b.style.left = `${from.x + (Math.random() - 0.5) * 50}px`;
      b.style.top = `${from.y + (Math.random() - 0.5) * 30}px`;
      $("ui").appendChild(b);
      setTimeout(() => {
        b.style.transition = `left .6s cubic-bezier(.5,0,.3,1), top .6s cubic-bezier(.6,-0.4,.4,1), transform .6s`;
        b.style.left = `${to.x}px`;
        b.style.top = `${to.y}px`;
        b.style.transform = "scale(.5) rotate(200deg)";
      }, 40 + i * 70);
      setTimeout(() => {
        b.remove();
        if (i % 2 === 0) sfx.tick();
      }, 700 + i * 70);
    }
  }
  function renderCards(s: GameState) {
    const race = isRace(s);
    const leader = ranked(s)[0];
    const cur = s.order[s.turnIdx];
    const sig = JSON.stringify(s.players.map((p) => [p.id, p.crumbs, p.stars, p.items, p.connected, p.shielded, race ? p.node : 0])) + cur + leader?.id + s.phase;
    if (sig === cardSig) return;
    cardSig = sig;
    const ordered = s.order.map((id) => s.players.find((p) => p.id === id)!).filter(Boolean);
    $("cards").innerHTML = ordered
      .map((p) => {
        const c = DUCKS[p.duck];
        const items = p.items.map((i) => icon(ITEMS[i].icon, 24)).join("") + (p.shielded ? icon("shield", 24) : "");
        return `<div data-pid="${p.id}" class="card ${p.id === cur && ["turn", "moving", "choosePath", "buyStar", "pickTarget", "tile"].includes(s.phase) ? "turn" : ""} ${p.connected ? "" : "off"}">
          ${leader && p.id === leader.id && (race ? p.node > 0 : p.stars > 0 || p.crumbs > 10) ? `<div class="crown">${icon("crown", 40)}</div>` : ""}
          <div class="av" style="background:${c.color}"><img src="${duckImg(p)}" alt=""></div>
          <div><div class="nm">${esc(p.name)}</div>
            ${race
              ? `<div class="row"><span>خانة <b>${ar(p.node + 1)}</b></span></div><div class="prog"><i style="width:${p.node + 1}%"></i></div>`
              : `<div class="row"><span>${icon("star")}${ar(p.stars)}</span><span>${icon("bread")}<b data-crumbs="${p.id}">${ar(shownCrumbs[p.id] ?? p.crumbs)}</b></span></div>`}</div>
          ${items ? `<div class="items">${items}</div>` : ""}
        </div>`;
      })
      .join("");
  }

  let countIv = 0;
  let submitSeenAt: Record<string, number> = {};
  function renderMinigame(s: GameState, fresh: boolean) {
    const mg = s.minigame;
    if (!mg) return;
    const meta = MINIGAMES[mg.id];
    const parts = mg.participants.map((id) => pl(id)!).filter(Boolean);
    const key = `${s.phase}:${mg.startAt}:${JSON.stringify(mg.submitted)}:${JSON.stringify(mg.progress ?? {})}:${JSON.stringify(mg.busted ?? {})}`;
    if (key === mgKey && !fresh) return;
    const phaseChanged = !mgKey.startsWith(s.phase + ":" + mg.startAt + ":");
    mgKey = key;
    $("banner").classList.add("hidden");
    if (s.phase === "mgIntro") {
      const chips = parts.map((p) => chip(p, mg.ready?.[p.id] ? " ✓" : "", mg.ready?.[p.id] ? "done" : "")).join("");
      if (phaseChanged) {
        sfx.fanfare();
        modal(`<div class="panel"><div class="icon">${icon(meta.icon, 130)}</div><span class="tag">${mg.duel ? "مبارزة" : "ميني قيم"} · ${meta.kind}</span>
          <h1>${meta.title}</h1><p>${meta.howTo}</p><h3>جاهزين؟ اضغطوا "جاهز" من تلفوناتكم</h3><div class="chips" id="readychips">${chips}</div></div>`);
      } else {
        const el = document.getElementById("readychips");
        if (el) el.innerHTML = chips;
        sfx.pop();
      }
    } else if (s.phase === "mgPlay") {
      if (phaseChanged) buildStage(mg, parts);
      updateStage(mg, parts);
    } else if (s.phase === "mgResults") {
      clearInterval(countIv);
      const results = mg.results ?? [];
      const n = results.length;
      const rows = results
        .map((r, i) => {
          const p = pl(r.playerId)!;
          const medal = `<b class="badge b${Math.min(r.rank, 3)}">${ar(r.rank + 1)}</b>`;
          // reveal from last place up to the winner
          const delay = (n - 1 - i) * 0.7;
          return `<div class="res ${r.rank === 0 ? "first" : ""}" style="animation-delay:${delay}s"><span class="rk">${medal}</span><img src="${duckImg(p)}" alt=""><span>${esc(p.name)}</span><span class="val">${esc(r.display)}</span><span class="rw ${r.reward < 0 ? "neg" : ""}">${r.reward > 0 ? "+" : ""}${ar(r.reward)} ${isRace(s) ? "خطوات" : icon("bread")}</span></div>`;
        })
        .join("");
      modal(`<div class="panel"><h3>${meta.title}</h3><h1>النتايج</h1><div class="results">${rows}</div></div>`);
      for (let i = 0; i < n - 1; i++) setTimeout(() => sfx.tick(), i * 700);
      setTimeout(() => {
        sfx.fanfare();
        const win = results[0];
        if (win) board.celebrate(win.playerId);
      }, (n - 1) * 700 + 200);
    }
  }

  function buildStage(mg: NonNullable<GameState["minigame"]>, parts: Player[]) {
    const meta = MINIGAMES[mg.id];
    clearInterval(countIv);
    submitSeenAt = {};
    let body = "";
    if (mg.id === "mash") {
      body = `<div class="lanes">${parts.map((p) => `
        <div class="lane" data-id="${p.id}"><div class="ln-name">${tokenImg(p.duck, 54)}${esc(p.name)}</div>
          <div class="water"><div class="finish"></div><div class="boat" data-boat="${p.id}">${tokenImg(p.duck, 62)}${icon("boat", 92)}</div></div>
          <div class="ln-count" data-count="${p.id}">٠</div></div>`).join("")}</div>`;
    } else if (mg.id === "tenSeconds") {
      body = `<div class="bigclock" id="bigclock">٠.٠</div><div class="tiles">${parts.map((p) => tile(p)).join("")}</div>`;
    } else if (mg.id === "dontWake") {
      body = `<div class="sky" id="sky"><div class="zz">Zzz</div></div><div class="tiles sleep">${parts.map((p) => tile(p)).join("")}</div>`;
    } else {
      body = `<div class="piles">${parts.map((p) => `
        <div class="pile" data-pile="${p.id}"><div class="stack" data-stack="${p.id}"></div>
          <div class="pot" data-pot="${p.id}">${icon("bread", 40)}١</div>${tokenImg(p.duck, 90)}<div class="nm">${esc(p.name)}</div></div>`).join("")}</div>`;
    }
    modal(`<div class="stage st-${mg.id}">
      <div class="st-head">${icon(meta.icon, 70)}<h2>${meta.title}</h2><span class="tag">${meta.kind}</span></div>
      <div class="st-body">${body}</div>
      <div class="st-time"><i id="sttime"></i></div>
      <div class="st-count" id="stcount"></div>
    </div>`);
    const start = clock.toLocal(mg.startAt);
    const end = start + mg.durationMs;
    const sig = start + (mg.signalDelayMs ?? 0);
    let lastN = -1;
    let woke = false;
    const draw = () => {
      const now = Date.now();
      const cEl = document.getElementById("stcount");
      if (!cEl) return clearInterval(countIv);
      const left = start - now;
      if (left > 0) {
        const n = Math.ceil(left / 1000);
        if (n !== lastN) {
          lastN = n;
          cEl.innerHTML = `<div class="count">${ar(n)}</div>`;
          cEl.classList.remove("hidden");
          sfx.tick();
        }
      } else if (lastN !== 0) {
        lastN = 0;
        cEl.innerHTML = `<div class="count go">يلا!</div>`;
        sfx.pop();
        setTimeout(() => cEl.classList.add("hidden"), 700);
      }
      const t = document.getElementById("sttime");
      if (t) t.style.transform = `scaleX(${Math.max(0, Math.min(1, (end - now) / mg.durationMs))})`;
      if (mg.id === "tenSeconds") {
        const el = document.getElementById("bigclock");
        if (el) {
          const sec = Math.max(0, (now - start) / 1000);
          el.textContent = now < start ? "٠.٠" : sec < 3 ? ar(sec.toFixed(1)) : "؟؟";
          if (sec >= 3) el.classList.add("hidden-time");
        }
      }
      if (mg.id === "dontWake" && !woke && now >= sig && now > start) {
        woke = true;
        const sky = document.getElementById("sky");
        if (sky) sky.innerHTML = `<div class="rooster-pop">${icon("rooster", 190)}</div><h1>صاح الديك!</h1>`;
        sfx.star();
        board.shake(0.004);
      }
    };
    draw();
    countIv = window.setInterval(draw, 50);
  }

  function tile(p: Player) {
    return `<div class="tile" data-tile="${p.id}">${tokenImg(p.duck, 96)}<div class="nm">${esc(p.name)}</div><div class="state" data-state="${p.id}"></div></div>`;
  }

  function updateStage(mg: NonNullable<GameState["minigame"]>, parts: Player[]) {
    const prog = mg.progress ?? {};
    const sig = clock.toLocal(mg.startAt) + (mg.signalDelayMs ?? 0);
    for (const p of parts) {
      const done = !!mg.submitted[p.id];
      if (done && !submitSeenAt[p.id]) {
        submitSeenAt[p.id] = Date.now();
        sfx.pop();
      }
      if (mg.id === "mash") {
        const max = Math.max(40, ...parts.map((x) => prog[x.id] ?? 0)) + 4;
        const v = prog[p.id] ?? 0;
        const boat = document.querySelector<HTMLElement>(`[data-boat="${p.id}"]`);
        if (boat) boat.style.insetInlineStart = `calc(${(v / max) * 100}% * 0.86)`;
        const c = document.querySelector(`[data-count="${p.id}"]`);
        if (c) c.textContent = ar(v);
      } else if (mg.id === "tenSeconds" || mg.id === "dontWake") {
        const st = document.querySelector<HTMLElement>(`[data-state="${p.id}"]`);
        const tl = document.querySelector<HTMLElement>(`[data-tile="${p.id}"]`);
        if (!st || !tl || !done) continue;
        if (mg.id === "tenSeconds") {
          tl.classList.add("frozen");
          st.textContent = "وقّف!";
        } else if (submitSeenAt[p.id] < sig) {
          tl.classList.add("fail");
          st.textContent = "استعجل!";
        } else {
          tl.classList.add("ok");
          st.textContent = "صحى!";
        }
      } else {
        const pot = prog[p.id] ?? 1;
        const busted = !!mg.busted?.[p.id];
        const stack = document.querySelector<HTMLElement>(`[data-stack="${p.id}"]`);
        const potEl = document.querySelector<HTMLElement>(`[data-pot="${p.id}"]`);
        const pile = document.querySelector<HTMLElement>(`[data-pile="${p.id}"]`);
        if (!stack || !potEl || !pile) continue;
        if (busted) {
          if (!pile.classList.contains("busted")) {
            pile.classList.add("busted");
            stack.innerHTML = `<div class="fox-pop">${icon("fox", 110)}</div>`;
            potEl.innerHTML = "أكلها الثعلب!";
            sfx.bad();
          }
        } else {
          const n = Math.min(7, Math.round(Math.log2(Math.max(1, pot))) + 1);
          if (stack.childElementCount !== n) stack.innerHTML = Array.from({ length: n }, () => icon("bread", 64)).join("");
          potEl.innerHTML = `${icon("bread", 40)}${ar(pot)}`;
          if (done) pile.classList.add("banked");
        }
      }
    }
  }

  let finalShown = false;
  function renderFinal(s: GameState) {
    if (finalShown) return;
    finalShown = true;
    const bonuses = s.bonuses ?? [];
    modal(`<div class="panel"><div class="icon">${icon("gift", 130)}</div><h1>الجوايز المخفية</h1><div id="bon">${bonuses.length ? "" : "<p>ما في جوايز هالمرة</p>"}</div></div>`);
    bonuses.forEach((b, i) =>
      setTimeout(() => {
        const p = pl(b.playerId);
        const el = document.getElementById("bon");
        if (!p || !el) return;
        sfx.star();
        el.insertAdjacentHTML("beforeend", `<div class="bonus">${esc(b.title)}: <img src="${duckImg(p)}" alt=""> ${esc(p.name)} +${icon("star", 40)}</div>`);
      }, 1800 + i * 2400),
    );
  }

  let endShown = false;
  function renderEnd(s: GameState) {
    if (endShown) return;
    endShown = true;
    const rk = ranked(s);
    const order = [rk[1], rk[0], rk[2]].filter(Boolean);
    const heights: Record<number, number> = { 0: 260, 1: 190, 2: 140 };
    const colors = ["#ffd23f", "#c9d3e0", "#e3a26b"];
    sfx.fanfare();
    if (!isCards(s)) setTimeout(() => board.celebrate(rk[0].id), 400);
    modal(`<div class="panel"><div class="icon">${icon("trophy", 130)}</div><h1>${esc(rk[0].name)} فاز!</h1>
      <div class="podium">${order
        .map((p) => {
          const r = rk.indexOf(p);
          return `<div class="pod p${r + 1}"><img src="${duckImg(p)}" alt=""><div class="nm">${esc(p.name)}</div><div class="sc">${isCards(s) ? (s.table?.counts[p.id] ? `باقي ${ar(s.table.counts[p.id])} كروت` : "خلّص كروته!") : isRace(s) ? `خانة ${ar(p.node + 1)}` : `${icon("star")}${ar(p.stars)} · ${icon("bread")}${ar(p.crumbs)}`}</div><div class="blk" style="height:${heights[r]}px;background:${colors[r]}">${ar(r + 1)}</div></div>`;
        })
        .join("")}</div><p>${isLocal() ? "تقدر تبدأ لعبة جديدة من لوحتك" : "المنظم يقدر يبدأ لعبة جديدة من تلفونه"}</p></div>`);
  }

  // reset one-shot screens when a new game starts
  sock.on("state", (s) => {
    if (s.phase === "lobby" || s.phase === "intro") {
      finalShown = false;
      endShown = false;
    }
  });
}
