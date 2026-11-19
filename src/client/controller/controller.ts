import "./controller.css";
import { BOARDS, DUCKS, ITEMS, MINIGAMES, WHEEL } from "../../shared/data";
import { CARD_GAME } from "../../shared/cards";
import { BOARD_SEATS, footballResult, isBoardGame, isCards, isRace, isSport, ranked, sportUnit } from "../../shared/rules";
import { CATALOG, gameName } from "../../shared/catalog";
import { sportCourses } from "../../shared/sports";
import { CLUB } from "../../shared/football/club";
import type { FbInput } from "../../shared/football/types";
import type { PoolShot } from "../../shared/pool/types";
import type { Shot, SportId } from "../../shared/sports/types";
import { loadSportView, type SportView } from "../sports/view";
import { createCardPad } from "./cardpad";
import type { GameState, Player } from "../../shared/types";
import { ar, Clock, connect, esc, icon, joinUrl, tokenImg } from "../net";
import type { DisplayHandle } from "../display/display";
import { serverUrl } from "../config";
import { gameStats, profile, recordGame, rivalOf, saveProfile } from "../profile";

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
  /** one person on a phone: show the whole game above the pad, like a phone room */
  phone?: boolean;
}

/** `create`: show the "make a room" form; `game`: pick this game right after the room is made (from the hub). */
export function startController(root: HTMLElement, initialCode: string, local?: LocalPad, opts: { create?: boolean; game?: string } = {}) {
  if (!local) document.body.classList.add("pad");
  root.innerHTML = `<div class="ph-view hidden" id="phView"></div><div class="ph-side"><div class="pad-wrap"><div class="pad-top hidden" id="top"></div><div class="pad-main" id="main"></div></div></div><button class="skip hidden" id="skip">تخطي ⏭</button>
    <div class="wake hidden" id="wake"><img class="duck" src="assets/tokens/token0.png" alt=""><h2>قاعد نصحّي السيرفر…</h2><p>أول مرة بعد فترة تاخذ لين دقيقة</p></div>`;
  const wrap = root.querySelector<HTMLDivElement>(".pad-wrap")!;
  const top = root.querySelector<HTMLDivElement>("#top")!;
  const main = root.querySelector<HTMLDivElement>("#main")!;
  const skipBtn = root.querySelector<HTMLButtonElement>("#skip")!;

  const sock = connect();
  const clock = new Clock();
  let code = initialCode;
  let me = "";
  const pad = createCardPad(sock, root.querySelector<HTMLDivElement>("#main")!, () => me, !!local?.keys, () => root.classList.contains("ph"));
  sock.on("hand", (h) => pad.setHand(h));
  let st: GameState | null = null;
  let key = "";
  let mgCleanup: (() => void) | null = null;

  const tokenKey = (c: string) => `duck-token-${c}`;
  // the name comes from the account (or this device's profile), never typed inside a game
  const savedName = () => (local ? local.name : profile().name.trim());
  /** "playing as X" with a button to the account sheet (where the name and duck are changed) */
  const nameLine = () => {
    const n = savedName();
    return `<div class="as-line">${n ? `تلعب باسم <b>${esc(n)}</b>` : "ما كتبت اسمك"}<button type="button" class="small-btn" id="acctName">${n ? "غيّر" : "اكتب اسمك"}</button></div>`;
  };
  const bindNameLine = (redraw: () => void) => {
    main.querySelector<HTMLButtonElement>("#acctName")?.addEventListener("click", () =>
      void import("../account/sheet").then((m) => m.openAccount(redraw)),
    );
  };

  // the free online server sleeps: say so instead of looking broken while it wakes up
  const wake = root.querySelector<HTMLDivElement>("#wake")!;
  let wakeTimer = 0;
  let everConnected = false;
  const waitForServer = () => {
    if (local || (everConnected && !serverUrl())) return;
    clearTimeout(wakeTimer);
    wakeTimer = window.setTimeout(() => !sock.connected && wake.classList.remove("hidden"), 1200);
  };

  function joined(c: string, playerId: string, tok: string) {
    code = c;
    me = playerId;
    if (!local) {
      localStorage.setItem(tokenKey(c), tok);
      history.replaceState(null, "", `?join=${c}`);
    }
    key = "";
    if (latest && latest.code === c) {
      st = latest;
      syncShell(latest);
      render(latest);
    }
  }

  function join(c: string, name: string, onErr?: (e: string) => void) {
    const tok = local ? undefined : localStorage.getItem(tokenKey(c)) ?? undefined;
    sock.emit("player:join", { code: c, name, token: tok, profileId: local?.keys ? undefined : profile().id }, (res) => {
      if (!res.ok) {
        if (tok) localStorage.removeItem(tokenKey(c));
        onErr?.(res.error);
        return;
      }
      const fresh = !tok;
      joined(c, res.playerId, res.token);
      // a new seat: ask for this phone's favourite duck (the server keeps the given one if it's taken)
      if (fresh && !local) sock.emit("player:pickPiece", profile().duck);
    });
  }

  sock.on("connect", () => {
    everConnected = true;
    clearTimeout(wakeTimer);
    wake.classList.add("hidden");
    if (local) {
      if (!me) join(code, local.name);
      return;
    }
    if (code && localStorage.getItem(tokenKey(code))) join(code, savedName(), () => showJoin());
    else if (me) join(code, savedName());
    // otherwise the join form is already on screen: never reset it, the player may be typing
  });
  // show the form right away instead of waiting for the connection
  if (!local && opts.create && !code) queueMicrotask(() => showCreate());
  else if (!local && !(code && localStorage.getItem(tokenKey(code)))) queueMicrotask(() => key !== "join" && !me && showJoin());
  else if (local) main.innerHTML = `<h2>لحظة…</h2>`;
  waitForServer();

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
    waitForServer();
    if (me) {
      key = "";
      main.innerHTML = `<h2>انقطع الاتصال… نرجعك</h2>`;
    }
  });
  let latest: GameState | null = null;
  // football: positions of everything ~15 a second, straight to whichever view is drawing the pitch
  sock.on("fb:frame", (f) => {
    disp?.frame(f);
    sportView?.fbFrame?.(f);
  });
  const sendFb = (i: FbInput) => sock.emit("fb:input", i);
  sock.on("state", (s) => {
    clock.update(s);
    latest = s; // the server can send state just before the join is confirmed
    if (!me || s.code !== code) return;
    st = s;
    syncShell(s);
    render(s);
  });

  // ------------------------------------------------------------------ phone room: the whole game above the pad
  const view = root.querySelector<HTMLDivElement>("#phView")!;
  let disp: DisplayHandle | null = null;
  let dispLoading = false;
  let shellState: GameState | null = null;
  let phoneFailed = false;
  const phoneRoom = (s: GameState) => !phoneFailed && (local ? !!local.phone : s.screen === false);
  /** Nothing to look at but this phone: "طالع البورد" instead of "طالع الشاشة". */
  const seeBoard = () => !!local || (!!st && phoneRoom(st));
  function syncShell(s: GameState) {
    const on = phoneRoom(s);
    const show = on && s.phase !== "lobby";
    const was = root.classList.contains("ph");
    root.classList.toggle("ph", show);
    root.classList.toggle("cards", show && isCards(s));
    root.classList.toggle("sport", show && isSport(s) && s.phase !== "end");
    // sports: the game takes the whole screen (each view has its own HUD: turns, scores, how to shoot, controls)
    root.classList.toggle("fb", show && isSport(s) && s.phase !== "end" && s.phase !== "final");
    root.classList.toggle("land", innerWidth > innerHeight);
    document.body.classList.toggle("ph-on", show);
    view.classList.toggle("hidden", !show);
    if (was !== show) {
      // the pad's layout changes with the shell
      key = "";
      pad.refresh();
    }
    if (!on) return;
    shellState = s;
    if (disp) return disp.state(s);
    if (dispLoading) return;
    dispLoading = true;
    void import("../display/display")
      .then(({ startDisplay }) => startDisplay(view, { phone: true, me: () => me }))
      .then((h) => {
        disp = h;
        if (shellState) h.state(shellState);
      })
      .catch(() => {
        phoneFailed = true;
        dispLoading = false;
        if (st) {
          syncShell(st);
          render(st);
        }
      });
  }
  addEventListener("resize", () => {
    const land = innerWidth > innerHeight;
    if (land === root.classList.contains("land")) return;
    root.classList.toggle("land", land);
    // the phone hand is laid out in JS: redo it for the new shape (everything else is CSS)
    if (root.classList.contains("ph") && st && isCards(st)) pad.refresh();
  });

  skipBtn.onclick = () => sock.emit("host:skip");

  // ------------------------------------------------------------------ screens
  function showJoin(error = "") {
    key = "join";
    top.classList.add("hidden");
    main.innerHTML = `
      <img class="duck" src="assets/tokens/token0.png" alt="">
      <h1 dir="ltr">Duck Party</h1>
      <input class="code" id="c" maxlength="4" placeholder="رمز" value="${esc(code)}" autocomplete="off" />
      ${nameLine()}
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <button class="big-btn" id="go">ادخل</button>`;
    const go = () => {
      const c = (main.querySelector<HTMLInputElement>("#c")!.value || "").toUpperCase().trim();
      const n = savedName();
      if (c.length !== 4) return showJoin("اكتب الرمز اللي على الشاشة (٤ حروف)");
      join(c, n, (e) => showJoin(e));
    };
    main.querySelector<HTMLButtonElement>("#go")!.onclick = go;
    main.querySelectorAll("input").forEach((i) => (i.onkeydown = (e) => e.key === "Enter" && go()));
    bindNameLine(() => {
      // keep a code already typed
      const typed = main.querySelector<HTMLInputElement>("#c")?.value ?? "";
      showJoin();
      const ci = main.querySelector<HTMLInputElement>("#c");
      if (ci) ci.value = typed;
    });
  }

  function showCreate(error = "") {
    key = "create";
    top.classList.add("hidden");
    main.innerHTML = `
      <img class="duck" src="assets/tokens/token0.png" alt="">
      <h1>سوّ غرفة</h1>
      <p>ترسل الرابط لربعك ويدخلون من تليفوناتهم</p>
      ${nameLine()}
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <button class="big-btn green" id="go">سوّ الغرفة</button>
      <button class="small-btn" id="havecode">عندي كود</button>`;
    let busy = false;
    const go = () => {
      if (busy) return;
      busy = true;
      const n = savedName();
      main.querySelector<HTMLButtonElement>("#go")!.textContent = "لحظة…";
      sock.timeout(20000).emit("room:create", { name: n, profileId: profile().id }, (err, res) => {
        if (err || !res) return showCreate("السيرفر ما رد. جرّب مرة ثانية");
        if (!res.ok) return showCreate(res.error);
        joined(res.code, res.playerId, res.token);
        if (opts.game) sock.emit("host:setBoard", opts.game);
        sock.emit("player:pickPiece", profile().duck);
      });
    };
    main.querySelector<HTMLButtonElement>("#go")!.onclick = go;
    bindNameLine(() => showCreate());
    main.querySelector<HTMLButtonElement>("#havecode")!.onclick = () => {
      history.replaceState(null, "", "?join=");
      showJoin();
    };
  }

  /** Phone rooms have no big screen to show the code: share the link from here. */
  let showQr = false;
  function shareBlock(s: GameState) {
    if (s.screen || local) return "";
    return `<div class="share"><div class="sh-code">${esc(s.code)}</div>
      <div class="sh-row"><button class="big-btn green" id="share">شارك الرابط</button><button class="small-btn" id="qrb">QR</button></div>
      <img class="sh-qr ${showQr ? "" : "hidden"}" id="qr" alt=""></div>`;
  }
  function bindShare(s: GameState) {
    const url = joinUrl(s.code);
    const btn = main.querySelector<HTMLButtonElement>("#share");
    if (!btn) return;
    btn.onclick = async () => {
      buzz(20);
      try {
        if (navigator.share) return await navigator.share({ title: "Duck Party", text: "تعال العب معانا", url });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return; // closed the share sheet
      }
      await navigator.clipboard?.writeText(url).catch(() => {});
      btn.textContent = "انتسخ الرابط ✓";
      setTimeout(() => (btn.textContent = "شارك الرابط"), 1800);
    };
    const img = main.querySelector<HTMLImageElement>("#qr")!;
    const fill = () => import("qrcode").then((Q) => Q.default.toDataURL(url, { margin: 1, width: 360, color: { dark: "#2b1b45" } })).then((d) => (img.src = d));
    if (showQr) void fill();
    main.querySelector<HTMLButtonElement>("#qrb")!.onclick = () => {
      showQr = !showQr;
      img.classList.toggle("hidden", !showQr);
      if (showQr) void fill();
    };
  }

  const P = () => st!.players.find((p) => p.id === me)!;
  const isMyTurn = (s: GameState) => s.order[s.turnIdx] === me;

  function renderTop(s: GameState, p: Player) {
    top.classList.remove("hidden");
    top.innerHTML = `<img src="${duckImg(p)}" alt=""><div class="nm">${esc(p.name)}</div>
      ${s.phase === "lobby" ? "" : isSport(s) ? `<div class="st"><span>${ar(s.sport?.total[p.id] ?? 0)} ${sportUnit(s)}</span></div>` : isCards(s) ? `<div class="st"><span>${ar(s.table?.counts[p.id] ?? 0)} كروت</span></div>` : isRace(s) ? `<div class="st"><span>خانة ${ar(p.node + 1)}</span></div>` : `<div class="st"><span>${icon("star", 24)}${ar(p.stars)}</span><span>${icon("bread", 24)}${ar(p.crumbs)}</span></div>`}`;
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
    if (isSport(s) && ["intro", "sport", "tile", "final"].includes(s.phase)) {
      mgCleanup?.();
      mgCleanup = null;
      key = "sport";
      return renderSport(s, p);
    }
    stopSportPad();
    if (s.phase === "lobby") pad.reset();
    const mine = isMyTurn(s);
    const k = [s.phase, s.turnIdx, s.round, mine, p.items.join(), s.minigame?.startAt ?? 0, s.minigame?.ready?.[me] ? "r" : "", s.phase === "lobby" ? JSON.stringify([s.players.map((x) => x.name + x.isBot + x.duck + (x.profileId ?? "")), s.maxRounds, p.isHost, s.boardId, s.screen, s.course, s.fbLevel]) : "", s.pendingChoice?.playerId, s.pendingBuy?.playerId, s.pendingTarget?.playerId].join("|");
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
        main.innerHTML = `<img class="duck" src="${duckImg(p)}" alt=""><h1>يلا نبدأ!</h1><p>${seeBoard() ? "طالع البورد" : "طالع الشاشة الكبيرة"}</p>`;
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
        return waiting(s, mine ? (seeBoard() ? "طالع قطعتك!" : "طالع قطعتك على الشاشة!") : cur ? `دور ${cur.name}` : "");
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
        main.innerHTML = `${icon("gift", 120)}<h1>الجوايز المخفية!</h1><p>${seeBoard() ? "طالع البورد" : "طالع الشاشة"}</p>`;
        return;
      case "end": {
        if (!local?.keys) recordGame(s, me);
        const order = ranked(s);
        const rank = order.findIndex((x) => x.id === me);
        const won = s.winnerIds ? s.winnerIds.includes(me) : rank === 0;
        // the score against each person, already counting this game: the reason to play one more
        const rows = order
          .filter((x) => x.id !== me && !x.isBot && x.profileId)
          .map((x) => {
            const r = rivalOf(x.profileId);
            const mate = s.boardId === "football" && s.fbTeams?.[x.id] === s.fbTeams?.[me];
            const tie = !mate && ((isSport(s) && s.sport?.total[x.id] === s.sport?.total[me] && won === !!s.winnerIds?.includes(x.id)) || (won && !!s.winnerIds?.includes(x.id)));
            const beat = won ? !s.winnerIds?.includes(x.id) : order.indexOf(x) > rank;
            return r ? `<div class="rv">${tokenImg(x.duck, 34)}<span class="rv-nm">${esc(x.name)}</span><small>${mate ? "بفريقك" : tie ? "تعادلتوا" : beat ? "فزت عليه" : "فاز عليك"}</small><b class="rv-score"><i>${ar(r.w)}</i> – <i>${ar(r.l)}</i></b></div>` : "";
          })
          .join("");
        const detail = isSport(s)
          ? `${ar(s.sport?.total[me] ?? 0)} ${sportUnit(s)}`
          : isCards(s) ? (rank === 0 ? "خلّصت كروتك قبل الكل!" : `باقي عندك ${ar(s.table?.counts[me] ?? 0)} كروت`)
          : isRace(s) ? `وصلت خانة ${ar(p.node + 1)}` : `${icon("star", 26)}${ar(p.stars)} · ${icon("bread", 26)}${ar(p.crumbs)}`;
        const fr = footballResult(s);
        const headline = fr ? (fr.team === -1 ? `تعادل! ${fr.score}` : won ? `فزتوا! ${fr.score}` : `خسرتوا ${fr.score}`) : won ? "انت الفايز!" : `خلصت بالمركز ${ar(rank + 1)}`;
        main.innerHTML = `${won ? icon("trophy", 130) : tokenImg(p.duck, 150)}<h1>${headline}</h1>
          <p>${detail}</p>
          ${rows ? `<div class="rivals"><h3>السجل بعد هاللعبة</h3>${rows}</div>` : ""}
          ${p.isHost ? `<button class="big-btn" id="again">لعبة جديدة</button>` : `<p>بانتظار المنظم…</p>`}`;
        main.querySelector<HTMLButtonElement>("#again")?.addEventListener("click", () => sock.emit("host:restart"));
        return;
      }
    }
  }

  // ------------------------------------------------------------------ bowling / golf
  /** Projector rooms / one-device on a computer: the phone gets its own personal view to aim on. In a phone room the
   *  view above is already personal, so the pad is one status line and the drag happens on the view. */
  let sportView: SportView | null = null;
  let sportViewId = "";
  let sportLoading = false;
  let sportBox: HTMLDivElement | null = null;
  let sportSeq = -1; // last animation handed to the pad's own view (state repeats it until the next one)
  const shoot = (shot: Shot | PoolShot) => {
    buzz(30);
    sock.emit("sport:shot", shot);
  };
  function stopSportPad() {
    disp?.sportInput(null);
    disp?.fbControl(null);
    sportView?.destroy();
    sportView = null;
    sportViewId = "";
    sportBox = null;
  }
  function renderSport(s: GameState, p: Player) {
    const sp = s.sport;
    const canShoot = s.phase === "sport" && !!sp?.open.includes(me);
    const id = s.boardId as SportId;
    const rk = ranked(s).findIndex((x) => x.id === me) + 1;
    const total = sp?.total[me] ?? 0;
    const unit = sportUnit(s);
    const what = id === "golf" ? "اسحب ورا وفك" : "اسحب الكرة لفوق وفكها";
    const status =
      s.phase === "intro" ? "استعد…"
      : s.phase === "final" ? (s.winnerIds?.includes(me) ? "فزت!" : "خلصت اللعبة")
      : s.phase === "tile" ? ({ bowling: "الفريم الجاي…", golf: "الحفرة الجاية…", hoops: "الجولة الجاية…", football: "", pool: "" }[id] ?? "")
      : id === "football" ? "يلا! العب"
      : id === "pool" ? (canShoot ? "دورك! اسحب الكيو وفك" : `دور ${esc(s.players.find((x) => s.sport?.open.includes(x.id))?.name ?? "")}`)
      : canShoot ? `دورك! ${what}`
      : "خلصت هالجولة · انتظر الباقين";
    const line = `<div class="sp-line ${canShoot ? "go" : ""}"><b>${esc(status)}</b><span>${ar(total)} ${unit} · المركز ${ar(rk)}</span></div>`;
    const inShell = root.classList.contains("ph");
    const playing = s.phase === "sport" || s.phase === "intro";
    if (inShell) {
      if (sportView) stopSportPad();
      main.innerHTML = line;
      disp?.sportInput(canShoot ? shoot : null);
      disp?.fbControl(id === "football" && playing ? sendFb : null);
      return;
    }
    // own view in the pad
    if (!sportBox || !main.contains(sportBox)) {
      main.innerHTML = `${line}<div class="sp-box" id="spBox"></div>`;
      sportBox = main.querySelector<HTMLDivElement>("#spBox");
      sportView?.destroy();
      sportView = null;
      sportViewId = "";
    } else main.querySelector(".sp-line")!.outerHTML = line;
    if (sportView && sportViewId === id) {
      sportView.render(s);
      if ((s.anim.kind === "shot" || s.anim.kind === "sportRound") && s.seq !== sportSeq) {
        sportSeq = s.seq;
        sportView.anim(s);
      }
      sportView.setInput(canShoot ? shoot : null);
      sportView.setControl?.(id === "football" && playing ? sendFb : null);
      return;
    }
    if (sportLoading) return;
    sportLoading = true;
    void loadSportView(id).catch(() => {
      sportLoading = false;
      return null;
    }).then((make) => {
      sportLoading = false;
      if (!make || !sportBox) return;
      sportView = make(sportBox, { mode: "personal", me: () => me, sound: false, serverNow: () => Date.now() + clock.offset, controllerOnly: id === "football" });
      sportViewId = id;
      if (st && isSport(st)) {
        sportView.render(st);
        sportView.setInput(st.phase === "sport" && st.sport?.open.includes(me) ? shoot : null);
        sportView.setControl?.(id === "football" && (st.phase === "sport" || st.phase === "intro") ? sendFb : null);
      }
    });
    void p;
  }

  function waiting(s: GameState, title: string) {
    const p = P();
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);
    const show = cur && cur.id !== me && ["turn", "moving", "tile", "choosePath", "buyStar", "pickTarget", "shop", "wheel"].includes(s.phase) ? cur : p;
    main.innerHTML = `<div class="wait"><img class="duck${show !== p ? " other" : ""}" src="${duckImg(show)}" alt=""><div><h2>${esc(title)}</h2>
      ${p.items.length || p.shielded ? `<p>أغراضك: ${p.items.map((i) => icon(ITEMS[i].icon, 30)).join(" ")} ${p.shielded ? icon("shield", 30) : ""}</p>` : ""}
      <p style="opacity:.7">${isRace(s) ? `خانتك ${ar(p.node + 1)} · ` : ""}الجولة ${ar(s.round)} من ${ar(s.maxRounds)}</p></div></div>`;
  }

  /** Your wins and losses against each person in the room (from this phone's own record). */
  function rivalsBlock(s: GameState) {
    const others = s.players.filter((x) => x.id !== me && !x.isBot && x.profileId);
    if (!others.length) return "";
    const rows = others.map((o) => {
      const r = rivalOf(o.profileId);
      const g = r?.games[s.boardId];
      const score = r && r.w + r.l ? `<b class="rv-score"><i>${ar(r.w)}</i> – <i>${ar(r.l)}</i></b>` : `<b class="rv-new">أول مرة</b>`;
      const here = g && g.w + g.l ? `<small>بهاللعبة ${ar(g.w)} – ${ar(g.l)}</small>` : "";
      return `<div class="rv">${tokenImg(o.duck, 34)}<span class="rv-nm">${esc(o.name)}</span>${here}${score}</div>`;
    });
    return `<div class="rivals"><h3>انت ضد ربعك</h3>${rows.join("")}</div>`;
  }

  function renderLobby(s: GameState, p: Player) {
    main.innerHTML = `${shareBlock(s)}${rivalsBlock(s)}
      <img class="duck" src="${duckImg(p)}" alt="">
      <h1>${esc(DUCKS[p.duck].name)}</h1>${DUCKS[p.duck].ref ? `<p class="ref">من ${esc(DUCKS[p.duck].ref!)}</p>` : ""}
      <p class="lob-name">${esc(p.name)}</p>
      ${s.boardId === "football" ? footballLobby(s) : ""}
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
           ${isBoardGame(s) ? `<div class="stepper"><button id="rm">−</button><span>${ar(s.maxRounds)} جولات</span><button id="rp">+</button></div>` : coursePicker(s)}
           ${seatTools(s)}
           <button class="big-btn green" id="start" ${s.players.length < (s.boardId === "football" ? 1 : 2) ? "disabled style='opacity:.5'" : ""}>ابدأ اللعبة (${ar(s.players.length)} لاعبين)</button>`
        : `<p>بانتظار المنظم يبدأ… (${ar(s.players.length)} لاعبين)</p>`}`;
    main.querySelectorAll<HTMLButtonElement>("[data-piece]").forEach((b) =>
      b.addEventListener("click", () => {
        buzz(20);
        sock.emit("player:pickPiece", Number(b.dataset.piece));
        if (!local) saveProfile({ duck: Number(b.dataset.piece) });
      }),
    );
    main.querySelector("#rm")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds - (s.maxRounds > 5 ? 5 : 1)));
    main.querySelector("#rp")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds + (s.maxRounds >= 5 ? 5 : 1)));
    main.querySelector("#ab")?.addEventListener("click", () => sock.emit("host:addBot"));
    main.querySelector("#rb")?.addEventListener("click", () => sock.emit("host:removeBot"));
    main.querySelector("#start")?.addEventListener("click", () => sock.emit("host:start"));
    main.querySelectorAll<HTMLButtonElement>("[data-char]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("player:pickChar", b.dataset.char!);
    }));
    main.querySelectorAll<HTMLButtonElement>("[data-team]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("player:pickTeam", Number(b.dataset.team) === 1 ? 1 : 0);
    }));
    main.querySelector("#org")?.addEventListener("click", () => sock.emit("host:setPlaying", false));
    bindBoardPicker();
    bindShare(s);
  }

  /** Football: your team (blue / red) and which club duck you play. The computer fills both teams up to 5. */
  function footballLobby(s: GameState) {
    const mine = s.fbChars?.[me];
    const team = s.fbTeams?.[me] ?? 0;
    const names = (t: 0 | 1) => s.players.filter((x) => (s.fbTeams?.[x.id] ?? 0) === t).map((x) => esc(x.name)).join("، ") || "الكمبيوتر";
    const taken = new Map(Object.entries(s.fbChars ?? {}).map(([pid, c]) => [c, pid]));
    return `<p>فريقك</p><div class="fb-teams">
        <button class="t0 ${team === 0 ? "on" : ""}" data-team="0"><b>الأزرق</b><small>${names(0)}</small></button>
        <button class="t1 ${team === 1 ? "on" : ""}" data-team="1"><b>الأحمر</b><small>${names(1)}</small></button>
      </div>
      <p>شخصيتك بالملعب</p><div class="fb-chars">${CLUB.map((c) => {
        const owner = taken.get(c.id);
        const by = owner && owner !== me ? s.players.find((x) => x.id === owner)?.name : "";
        return `<button class="${mine === c.id ? "on" : ""}" data-char="${c.id}" ${by ? "disabled" : ""}><i style="background-image:url(assets/football/${c.id}-${team === 1 ? "red" : "blue"}.png)"></i><span>${esc(by || c.name)}</span></button>`;
      }).join("")}</div>`;
  }

  /** Bots: the card game lets the host choose (none at all is fine), a board always has 4 seats and fills them itself. */
  function seatTools(s: GameState) {
    const people = s.players.filter((x) => !x.isBot).length;
    const bots = s.players.length - people;
    if (isBoardGame(s))
      return `<p class="seat-note">البورد ${ar(BOARD_SEATS)} لاعبين دايماً. ${bots ? `الكمبيوتر ياخذ ${ar(bots)} ${bots === 1 ? "كرسي" : "كراسي"}` : "كلكم ناس، ما في كمبيوتر"}</p>`;
    return `<div class="host-tools"><button id="ab">+ لاعب كمبيوتر</button><button id="rb" ${bots ? "" : "disabled"}>− لاعب كمبيوتر</button></div>
      <p class="seat-note">${people >= 2 && !bots ? `${ar(people)} ناس، بدون كمبيوتر` : `${ar(people)} ناس + ${ar(bots)} كمبيوتر`}${s.players.length < 2 ? " · تحتاج لاعب ثاني (أو كمبيوتر)" : ""}</p>`;
  }

  /** Golf: the host picks the map. */
  function coursePicker(s: GameState) {
    const courses = isSport(s) ? sportCourses(s.boardId) : undefined;
    if (!courses || courses.length < 2) return "";
    const lv = s.fbLevel ?? 0;
    const level = s.boardId === "football" ? `<p>مستوى الكمبيوتر</p><div class="cpick">${["سهل", "عادي", "صعب"].map((t, i) => `<button class="${lv === i ? "on" : ""}" data-level="${i}">${t}</button>`).join("")}</div>` : "";
    return `<p>${s.boardId === "football" ? "مدة المباراة" : "اختار الملعب"}</p><div class="cpick">${courses.map((c) => `<button class="${s.course === c.id ? "on" : ""}" data-course="${c.id}">${esc(c.name)}</button>`).join("")}</div>${level}`;
  }

  /** Host chooses the board in the lobby. More than 4 people: only the card game fits. */
  function boardPicker(s: GameState) {
    const people = s.players.filter((x) => !x.isBot).length;
    const games = CATALOG;
    return `<p>اختار اللعبة</p><div class="bpick">${games
      .map((b) => {
        const full = (b.kind === "board" && people > BOARD_SEATS) || (b.id === "pool" && people > 4);
        const g = gameStats(b.id);
        return `<button class="${s.boardId === b.id ? "on" : ""}" data-board="${b.id}" ${full ? "disabled" : ""}><img src="assets/thumbs/${b.id}.jpg" alt=""><span>${esc(b.name)}${full ? " (٤ بس)" : ""}</span>${g.played ? `<small>فزت ${ar(g.won)} من ${ar(g.played)}</small>` : ""}</button>`;
      })
      .join("")}</div>`;
  }
  function bindBoardPicker() {
    main.querySelectorAll<HTMLButtonElement>("[data-course]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("host:setCourse", b.dataset.course!);
    }));
    main.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("host:setLevel", Number(b.dataset.level));
    }));
    main.querySelectorAll<HTMLButtonElement>("[data-board]").forEach((b) => (b.onclick = () => {
      buzz(20);
      sock.emit("host:setBoard", b.dataset.board!);
    }));
  }

  // ------------------------------------------------------------------ organizer (runs the game, doesn't play)
  const PHASE_TXT: Record<string, string> = {
    intro: "البداية", turn: "دور", moving: "يمشي", tile: "على الخانة", choosePath: "يختار طريق", buyStar: "عند النجمة",
    pickTarget: "يختار خصم", cards: "دور", sport: "الكل يلعب", shop: "في الدكان", wheel: "يلف عجلة الحظ", mgIntro: "ميني قيم: الاستعداد", mgPlay: "ميني قيم شغالة", mgResults: "نتايج الميني قيم",
    final: "الجوايز المخفية", end: "خلصت اللعبة",
  };
  function renderOrganizer(s: GameState) {
    skipBtn.classList.add("hidden");
    top.classList.remove("hidden");
    top.innerHTML = `${icon("crown", 48)}<div class="nm">${esc(s.organizer!.name)}</div><div class="st"><span>المنظم</span></div>`;
    wrap.style.setProperty("--duck-bg", "#B9A6FF"); // contrasts with the yellow crown
    const cur = s.players.find((x) => x.id === s.order[s.turnIdx]);
    const k = ["org", s.phase, s.turnIdx, s.round, s.maxRounds, s.boardId, s.course, s.fbLevel, s.players.map((x) => x.name + x.duck + x.stars + x.crumbs + x.isBot + x.node).join(), s.minigame?.id ?? "", JSON.stringify(s.table?.counts ?? {}), JSON.stringify(s.sport?.total ?? {})].join("|");
    if (k === key) return;
    key = k;
    mgCleanup?.();
    mgCleanup = null;
    if (s.phase === "lobby") {
      main.innerHTML = `${shareBlock(s)}${icon("crown", 110)}<h1>انت المنظم</h1><p>ما تلعب. تتحكم باللعبة من هني</p>
        <button class="small-btn" id="play">أبي ألعب بعد</button>
        ${boardPicker(s)}
        <div class="org-list">${s.players.map((x) => `<span>${tokenImg(x.duck, 44)}${esc(x.name)}</span>`).join("") || "<p>بانتظار اللاعبين…</p>"}</div>
        ${isBoardGame(s) ? `<div class="stepper"><button id="rm">−</button><span>${ar(s.maxRounds)} جولات</span><button id="rp">+</button></div>` : coursePicker(s)}
        ${seatTools(s)}
        <button class="big-btn green" id="start" ${s.players.length < 2 ? "disabled style='opacity:.5'" : ""}>ابدأ اللعبة (${ar(s.players.length)} لاعبين)</button>`;
      main.querySelector("#play")!.addEventListener("click", () => sock.emit("host:setPlaying", true));
      main.querySelector("#rm")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds - (s.maxRounds > 5 ? 5 : 1)));
      main.querySelector("#rp")?.addEventListener("click", () => sock.emit("host:setRounds", s.maxRounds + (s.maxRounds >= 5 ? 5 : 1)));
      main.querySelector("#ab")?.addEventListener("click", () => sock.emit("host:addBot"));
      main.querySelector("#rb")?.addEventListener("click", () => sock.emit("host:removeBot"));
      main.querySelector("#start")!.addEventListener("click", () => sock.emit("host:start"));
      bindBoardPicker();
      bindShare(s);
      return;
    }
    const rk = ranked(s);
    const status = isSport(s) && s.phase === "tile" ? "بين الجولات" : isSport(s) && s.phase === "final" ? "خلصت!" : s.phase === "end" ? PHASE_TXT.end
      : ["turn", "moving", "tile", "choosePath", "buyStar", "pickTarget", "shop", "wheel", "cards"].includes(s.phase) && cur ? `${PHASE_TXT[s.phase]} ${cur.name}`
      : PHASE_TXT[s.phase] ?? "";
    main.innerHTML = `<p style="opacity:.75">${isSport(s) ? `${esc(gameName(s.boardId))} · الجولة ${ar((s.sport?.round ?? 0) + 1)} من ${ar(s.sport?.rounds ?? 0)}` : isCards(s) ? `${CARD_GAME.name} ${CARD_GAME.sub}` : `الجولة ${ar(s.round)} من ${ar(s.maxRounds)}`}</p><h2>${esc(status)}</h2>
      <div class="org-rank">${rk.map((x, i) => `<div class="${x.id === cur?.id ? "cur" : ""}"><b>${ar(i + 1)}</b>${tokenImg(x.duck, 40)}<span>${esc(x.name)}</span>${isSport(s) ? `<span>${ar(s.sport?.total[x.id] ?? 0)} ${sportUnit(s)}</span><span></span>` : isCards(s) ? `<span>${ar(s.table?.counts[x.id] ?? 0)} كروت</span><span></span>` : isRace(s) ? `<span>خانة ${ar(x.node + 1)}</span><span></span>` : `<span>${icon("star", 22)}${ar(x.stars)}</span><span>${icon("bread", 22)}${ar(x.crumbs)}</span>`}</div>`).join("")}</div>
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
            z.innerHTML = `<div class="huge">${(ms / 1000).toFixed(2)}</div><small>ثانية · ${seeBoard() ? "طالع البورد" : "طالع الشاشة"}</small>`;
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
