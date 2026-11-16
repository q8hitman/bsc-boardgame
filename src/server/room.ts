import { randomBytes } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  BOARDS, DUCKS, EVENTS, ITEMS, LANDMARKS, MAX_PLAYERS, MG_REWARDS, MINIGAMES, MINIGAME_ROTATION, SHOP_STOCK, START_CRUMBS, STAR_COST, WHEEL,
} from "../shared/data";
import { CardGame } from "./cards";
import { CARDS_ID, isCards, isRace, PARTY_DEFAULT_ROUNDS, RACE_DEFAULT_ROUNDS, RACE_MG_EVERY, RACE_STEPS } from "../shared/rules";
import type {
  Anim, Board, BoardNode, ClientToServer, GameState, ItemId, MinigameId, Player, ServerToClient,
} from "../shared/types";

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

const HOP_MS = 330;
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = <T>(arr: T[]) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const token = () => randomBytes(12).toString("hex");
const arDigits = (t: string) => t.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]).replace(/\./g, "٫");

const BOT_NAMES = ["بطوط", "كواك", "ريشة", "زعنفة", "بقبق", "فطوم", "شلبي", "دودي"];

export class Room {
  state: GameState;
  board: Board;
  screenToken = token();
  private tokens = new Map<string, string>(); // token -> playerId
  private sockets = new Map<string, string>(); // playerId -> socket id
  private timer: NodeJS.Timeout | null = null;
  private botTimers: NodeJS.Timeout[] = [];
  private moving: { pid: string; left: number; double: boolean } | null = null;
  private dice = 1;
  private extraRolls = 0;
  private forcedDice: number[] | null = null;
  private shopLanded = false;
  private mgCount = 0;
  private pushPots = new Map<string, { pot: number; done: boolean }>();
  private mgScores: Record<string, number> = {};
  lastActivity = Date.now();
  private cards: CardGame;

  constructor(private io: IO, public code: string) {
    this.board = BOARDS.island;
    this.state = {
      code,
      phase: "lobby",
      phaseEndsAt: null,
      round: 0,
      maxRounds: 10,
      players: [],
      order: [],
      turnIdx: 0,
      starNode: this.board.starSpots[0],
      boardId: this.board.id,
      seq: 0,
      anim: { kind: "none" },
    };
    const room = this;
    this.cards = new CardGame({
      get state() {
        return room.state;
      },
      emit: (a) => this.emit(a),
      schedule: (ms, fn) => this.schedule(ms, fn),
      botLater: (ms, fn) => this.botLater(ms, fn),
      clearBots: () => this.clearBots(),
      setPhase: (ph, ms) => this.setPhase(ph, ms ?? null),
      sendTo: (id, hand) => {
        const sid = this.sockets.get(id);
        if (sid) this.io.to(sid).emit("hand", hand);
      },
    });
  }
  get cardGame() {
    return this.cards;
  }

  // ---------------------------------------------------------------- plumbing
  private p(id: string) {
    return this.state.players.find((x) => x.id === id);
  }
  private get current(): Player | undefined {
    return this.p(this.state.order[this.state.turnIdx]);
  }
  private emit(anim?: Anim) {
    if (anim) {
      this.state.seq++;
      this.state.anim = anim;
    }
    this.lastActivity = Date.now();
    this.io.to(this.code).emit("state", { ...this.state, serverNow: Date.now() });
  }
  private schedule(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }
  private botLater(ms: number, fn: () => void) {
    this.botTimers.push(setTimeout(fn, ms));
  }
  private clearBots() {
    this.botTimers.forEach(clearTimeout);
    this.botTimers = [];
  }
  private setPhase(phase: GameState["phase"], timeoutMs: number | null = null) {
    this.state.phase = phase;
    this.state.phaseEndsAt = timeoutMs ? Date.now() + timeoutMs : null;
  }
  dispose() {
    this.cards?.stop();
    if (this.timer) clearTimeout(this.timer);
    this.clearBots();
  }

  // ---------------------------------------------------------------- joining
  attachScreen(sock: Sock) {
    sock.join(this.code);
    sock.emit("state", { ...this.state, serverNow: Date.now() });
  }

  join(sock: Sock, name: string | undefined, tok: string | undefined) {
    const existing = tok ? this.tokens.get(tok) : undefined;
    const org = this.state.organizer;
    if (existing && org && org.id === existing) {
      org.connected = true;
      this.sockets.set(org.id, sock.id);
      sock.join(this.code);
      sock.data.playerId = org.id;
      this.emit();
      return { ok: true as const, playerId: org.id, token: tok! };
    }
    if (existing && this.p(existing)) {
      const pl = this.p(existing)!;
      pl.connected = true;
      this.sockets.set(pl.id, sock.id);
      sock.join(this.code);
      sock.data.playerId = pl.id;
      this.emit();
      if (isCards(this.state)) setTimeout(() => this.cards.resend(pl.id), 50);
      return { ok: true as const, playerId: pl.id, token: tok! };
    }
    if (this.state.phase !== "lobby") return { ok: false as const, error: "اللعبة بدأت. انتظر الجولة الجاية" };
    if (this.state.players.length >= MAX_PLAYERS) return { ok: false as const, error: "الغرفة مليانة" };
    const used = new Set(this.state.players.map((x) => x.duck));
    const duck = DUCKS.findIndex((_, i) => !used.has(i));
    const humans = this.state.players.filter((x) => !x.isBot);
    const pl: Player = {
      id: token().slice(0, 8),
      name: (name || "").trim().slice(0, 14) || DUCKS[duck].name,
      duck,
      node: this.board.start,
      crumbs: START_CRUMBS,
      stars: 0,
      items: [],
      isBot: false,
      isHost: humans.length === 0 && !this.state.organizer,
      connected: true,
      shielded: false,
      stats: { minigameWins: 0, stolenFrom: 0, risks: 0 },
    };
    const t = token();
    this.tokens.set(t, pl.id);
    this.sockets.set(pl.id, sock.id);
    this.state.players.push(pl);
    sock.join(this.code);
    sock.data.playerId = pl.id;
    this.emit();
    return { ok: true as const, playerId: pl.id, token: t };
  }

  leave(playerId: string) {
    const org = this.state.organizer;
    if (org && org.id === playerId) {
      org.connected = false;
      this.sockets.delete(playerId);
      // a player keeps host powers as a backup until the organizer comes back
      const backup = this.state.players.find((x) => !x.isBot && x.connected);
      if (backup) backup.isHost = true;
      this.emit();
      return;
    }
    const pl = this.p(playerId);
    if (!pl) return;
    pl.connected = false;
    this.sockets.delete(playerId);
    if (this.state.phase === "lobby") {
      // free the seat in the lobby; a reconnect with the token re-adds nothing, so keep it simple
      this.state.players = this.state.players.filter((x) => x.id !== playerId);
    }
    if (pl.isHost) {
      pl.isHost = false;
      const next = this.state.players.find((x) => !x.isBot && x.connected);
      if (next) next.isHost = true;
    }
    this.emit();
    // if it was their decision, let the timeout / auto-play handle it quickly
    if (this.state.phase === "turn" && this.current?.id === playerId) this.schedule(2500, () => this.roll(playerId, true));
    // card game: give a dropped phone a few seconds to come back before playing the turn for them
    if (this.state.phase === "cards" && this.current?.id === playerId) this.botLater(6000, () => !pl.connected && this.current?.id === playerId && this.cards.skip());
  }

  isHost(playerId: string) {
    return !!this.p(playerId)?.isHost || this.state.organizer?.id === playerId;
  }

  /** The host chooses to play, or to only run the game from their phone. */
  setPlaying(playerId: string, playing: boolean) {
    if (this.state.phase !== "lobby") return;
    const s = this.state;
    if (!playing) {
      const pl = this.p(playerId);
      if (!pl || !pl.isHost) return;
      s.players = s.players.filter((x) => x.id !== playerId);
      s.organizer = { id: playerId, name: pl.name, connected: true };
    } else {
      if (s.organizer?.id !== playerId || s.players.length >= MAX_PLAYERS) return;
      const used = new Set(s.players.map((x) => x.duck));
      const duck = DUCKS.findIndex((_, i) => !used.has(i));
      for (const x of s.players) x.isHost = false;
      s.players.unshift({
        id: playerId, name: s.organizer.name, duck, node: this.board.start, crumbs: START_CRUMBS, stars: 0,
        items: [], isBot: false, isHost: true, connected: true, shielded: false,
        stats: { minigameWins: 0, stolenFrom: 0, risks: 0 },
      });
      s.organizer = undefined;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- lobby
  addBot() {
    if (this.state.phase !== "lobby" || this.state.players.length >= MAX_PLAYERS) return;
    const used = new Set(this.state.players.map((x) => x.duck));
    const free = DUCKS.map((_, i) => i).filter((i) => !used.has(i));
    const duck = pick(free);
    const usedNames = new Set(this.state.players.map((x) => x.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(n)) ?? "بوت";
    this.state.players.push({
      id: "bot-" + token().slice(0, 6), name, duck, node: this.board.start, crumbs: START_CRUMBS, stars: 0,
      items: [], isBot: true, isHost: false, connected: true, shielded: false,
      stats: { minigameWins: 0, stolenFrom: 0, risks: 0 },
    });
    this.emit();
  }
  removeBot() {
    if (this.state.phase !== "lobby") return;
    const bots = this.state.players.filter((x) => x.isBot);
    if (!bots.length) return;
    const last = bots[bots.length - 1];
    this.state.players = this.state.players.filter((x) => x.id !== last.id);
    this.emit();
  }
  pickPiece(playerId: string, piece: number) {
    const pl = this.p(playerId);
    if (!pl || this.state.phase !== "lobby" || !DUCKS[piece]) return;
    if (this.state.players.some((x) => x.id !== playerId && x.duck === piece)) return;
    // players who kept the default name follow their piece's name
    if (pl.name === DUCKS[pl.duck].name) pl.name = DUCKS[piece].name;
    pl.duck = piece;
    this.emit();
  }

  /** Host picks which board to play (lobby only). */
  setBoard(id: string) {
    if (id === CARDS_ID) {
      if (this.state.phase !== "lobby") return;
      this.state.boardId = id;
      this.state.starNode = -1;
      this.emit();
      return;
    }
    const b = BOARDS[id];
    if (!b || this.state.phase !== "lobby" || this.state.boardId === id) return;
    this.board = b;
    this.state.boardId = id;
    this.state.starNode = b.mode === "race" ? -1 : b.starSpots[0];
    this.state.maxRounds = b.mode === "race" ? RACE_DEFAULT_ROUNDS : PARTY_DEFAULT_ROUNDS;
    for (const pl of this.state.players) pl.node = b.start;
    this.emit();
  }
  private get race() {
    return isRace(this.state);
  }

  setRounds(n: number) {
    if (this.state.phase !== "lobby") return;
    this.state.maxRounds = Math.max(1, Math.min(30, Math.round(n)));
    this.emit();
  }
  rename(playerId: string, name: string) {
    const pl = this.p(playerId);
    if (!pl || this.state.phase !== "lobby") return;
    const clean = name.trim().slice(0, 14);
    if (clean) pl.name = clean;
    this.emit();
  }

  start() {
    if (this.state.phase !== "lobby" || this.state.players.length < 2) return;
    const s = this.state;
    for (const pl of s.players) {
      pl.node = this.board.start;
      pl.crumbs = START_CRUMBS;
      pl.stars = 0;
      pl.items = [];
      pl.shielded = false;
      pl.stats = { minigameWins: 0, stolenFrom: 0, risks: 0 };
    }
    s.bonuses = undefined;
    if (isCards(s)) return this.cards.start();
    s.table = undefined;
    s.order = shuffle(s.players.map((x) => x.id));
    s.round = 1;
    s.turnIdx = 0;
    s.starNode = this.race ? -1 : pick(this.board.starSpots);
    this.extraRolls = 0;
    s.winnerIds = undefined;
    s.bonuses = undefined;
    this.mgCount = 0;
    this.setPhase("intro");
    this.emit({
      kind: "banner", title: "يلا نبدأ!",
      text: this.race ? "أول واحد يوصل التاج يفوز. الدرج يطلعك والحية تنزلك" : "اجمعوا الفتات واشتروا النجوم. اللي عنده نجوم أكثر يفوز",
    });
    this.schedule(4200, () => this.beginTurn());
  }

  restart() {
    this.dispose();
    this.state.table = undefined;
    this.moving = null;
    this.state.phase = "lobby";
    this.state.phaseEndsAt = null;
    this.state.minigame = undefined;
    this.state.round = 0;
    for (const pl of this.state.players) pl.node = this.board.start;
    this.emit({ kind: "none" });
  }

  /** Host emergency button: auto-resolve whatever is being waited on. */
  skip() {
    const s = this.state;
    const cur = this.current;
    if (s.phase === "cards") this.cards.skip();
    else if (s.phase === "turn" && cur) this.roll(cur.id, true);
    else if (s.phase === "choosePath" && s.pendingChoice) this.choose(s.pendingChoice.playerId, s.pendingChoice.options[0].to, true);
    else if (s.phase === "buyStar" && s.pendingBuy) this.buy(s.pendingBuy.playerId, false, true);
    else if (s.phase === "pickTarget" && s.pendingTarget) {
      const other = s.players.find((x) => x.id !== s.pendingTarget!.playerId)!;
      this.target(s.pendingTarget.playerId, other.id, true);
    } else if (s.phase === "shop" && s.pendingShop) this.shopBuy(s.pendingShop.playerId, null, true);
    else if (s.phase === "wheel" && s.pendingWheel) this.spin(s.pendingWheel.playerId);
    else if (s.phase === "mgIntro") this.playMinigame();
    else if (s.phase === "mgPlay") this.finishMinigame();
  }

  // ---------------------------------------------------------------- turns
  private beginTurn(again = false) {
    const cur = this.current;
    if (!cur) return;
    this.dice = 1;
    this.setPhase("turn", 20000);
    const last = this.state.round === this.state.maxRounds;
    this.emit({
      kind: "banner",
      title: again ? `دبل! ${cur.name} يرمي مرة ثانية` : `دور ${cur.name}`,
      text: this.race
        ? last && this.state.turnIdx === 0 ? "آخر جولة! اللي أبعد واحد يفوز" : "ارمِ النردين من تلفونك"
        : last && this.state.turnIdx === 0 ? "آخر جولة! الفتات من الخانات دبل" : "ارمِ النرد من تلفونك",
    });
    if (cur.isBot || !cur.connected) {
      this.botLater(cur.isBot ? 1800 : 3000, () => {
        if (this.state.phase === "turn" && this.current?.id === cur.id) {
          if (cur.isBot) this.botItem(cur);
          if (this.state.phase === "turn") this.roll(cur.id, true);
        }
      });
    }
    this.schedule(20000, () => this.roll(cur.id, true));
  }

  useItem(playerId: string, item: ItemId) {
    const cur = this.current;
    if (this.state.phase !== "turn" || cur?.id !== playerId) return;
    const idx = cur.items.indexOf(item);
    if (idx < 0) return;
    if (item === "doubleDice" || item === "tripleDice") {
      if (this.dice > 1) return;
      cur.items.splice(idx, 1);
      this.dice = item === "tripleDice" ? 3 : 2;
      this.emit({ kind: "item", playerId, item, text: `${cur.name} استخدم ${ITEMS[item].name}!` });
    } else if (item === "starGate") {
      const gate = this.board.nodes.find((n) => n.next.includes(this.state.starNode) && n.type !== "fork") ?? this.board.nodes.find((n) => n.next.includes(this.state.starNode));
      if (!gate || gate.id === cur.node) return;
      cur.items.splice(idx, 1);
      cur.node = gate.id;
      this.emit({ kind: "item", playerId, item, text: `${cur.name} فتح بوابة النجمة!`, to: gate.id });
    } else if (item === "steal") {
      cur.items.splice(idx, 1);
      this.askTarget(playerId, "steal");
    }
  }

  roll(playerId: string, auto = false) {
    const cur = this.current;
    if (this.state.phase !== "turn" || cur?.id !== playerId) return;
    void auto;
    const values = this.forcedDice ?? Array.from({ length: this.race ? 2 : this.dice }, () => rand(1, 6));
    this.forcedDice = null;
    if (this.race) {
      this.setPhase("moving");
      this.emit({ kind: "roll", playerId, values });
      const doubles = values[0] === values[1] && this.extraRolls < 1;
      this.schedule(1900, () =>
        this.raceAdvance(cur, values[0] + values[1], () => {
          if (doubles) {
            this.extraRolls++;
            this.beginTurn(true);
          } else this.endTurn();
        }),
      );
      return;
    }
    this.setPhase("moving");
    this.emit({ kind: "roll", playerId, values });
    this.moving = { pid: playerId, left: values.reduce((a, b) => a + b, 0), double: this.dice > 1 };
    this.schedule(1900, () => this.continueMove());
  }

  private continueMove() {
    const mv = this.moving;
    if (!mv) return;
    const pl = this.p(mv.pid)!;
    const path: number[] = [];
    let stopReason: "done" | "fork" | "star" | "shop" = "done";
    while (mv.left > 0) {
      const node = this.board.nodes[pl.node];
      if (node.next.length > 1) {
        stopReason = "fork";
        break;
      }
      pl.node = node.next[0];
      path.push(pl.node);
      mv.left--;
      if (pl.node === this.state.starNode) {
        stopReason = "star";
        break;
      }
      // passing a shop: stop and offer it (landing on one is handled by land())
      if (mv.left > 0 && this.board.nodes[pl.node].type === "shop" && this.canShop(pl)) {
        stopReason = "shop";
        break;
      }
    }
    if (mv.left === 0 && stopReason !== "star") stopReason = "done";
    const after = () => {
      if (stopReason === "fork") this.askChoice(pl);
      else if (stopReason === "star") this.askBuy(pl);
      else if (stopReason === "shop") this.askShop(pl, false);
      else this.land(pl);
    };
    if (path.length) {
      this.setPhase("moving");
      this.emit({ kind: "move", playerId: pl.id, path, rest: mv.left });
      this.schedule(path.length * HOP_MS + 450, after);
    } else after();
  }

  private askChoice(pl: Player) {
    const node = this.board.nodes[pl.node];
    const options = node.choices ?? node.next.map((to) => ({ to, label: "طريق" }));
    this.state.pendingChoice = { playerId: pl.id, options };
    this.setPhase("choosePath", 12000);
    this.emit({ kind: "banner", title: "مفترق طرق!", text: `${pl.name} يختار طريقه` });
    if (pl.isBot || !pl.connected) this.botLater(1500, () => this.choose(pl.id, pick(options).to, true));
    this.schedule(12000, () => this.choose(pl.id, pick(options).to, true));
  }

  choose(playerId: string, to: number, auto = false) {
    const pc = this.state.pendingChoice;
    if (this.state.phase !== "choosePath" || !pc || pc.playerId !== playerId) return;
    if (!pc.options.some((o) => o.to === to)) return;
    void auto;
    const pl = this.p(playerId)!;
    this.state.pendingChoice = undefined;
    pl.node = to;
    this.moving!.left--;
    this.setPhase("moving");
    this.emit({ kind: "move", playerId, path: [to], rest: this.moving!.left });
    const passedStar = to === this.state.starNode;
    this.schedule(HOP_MS + 300, () => {
      if (passedStar) this.askBuy(pl);
      else if (this.moving!.left > 0) this.continueMove();
      else this.land(pl);
    });
  }

  private askBuy(pl: Player) {
    if (pl.crumbs < STAR_COST) {
      this.setPhase("tile");
      this.emit({ kind: "banner", title: "النجمة!", text: `تحتاج ${arDigits(String(STAR_COST))} فتات عشان تشتريها` });
      this.schedule(1800, () => this.resumeAfterStar(pl));
      return;
    }
    this.state.pendingBuy = { playerId: pl.id, cost: STAR_COST };
    this.setPhase("buyStar", 12000);
    this.emit({ kind: "banner", title: "النجمة!", text: `${pl.name}، تشتريها بـ ${arDigits(String(STAR_COST))} فتات؟` });
    if (pl.isBot || !pl.connected) this.botLater(1500, () => this.buy(pl.id, true, true));
    this.schedule(12000, () => this.buy(pl.id, true, true));
  }

  buy(playerId: string, yes: boolean, auto = false) {
    const pb = this.state.pendingBuy;
    if (this.state.phase !== "buyStar" || !pb || pb.playerId !== playerId) return;
    void auto;
    const pl = this.p(playerId)!;
    this.state.pendingBuy = undefined;
    if (yes && pl.crumbs >= pb.cost) {
      pl.crumbs -= pb.cost;
      pl.stars++;
      const spots = this.board.starSpots.filter((x) => x !== this.state.starNode);
      this.state.starNode = pick(spots);
      this.setPhase("tile");
      this.emit({ kind: "star", playerId, bought: true, newStar: this.state.starNode });
      this.schedule(5200, () => this.resumeAfterStar(pl));
    } else this.resumeAfterStar(pl);
  }

  private resumeAfterStar(pl: Player) {
    if (this.moving && this.moving.left > 0) this.continueMove();
    else this.land(pl);
  }

  private tileMult() {
    return this.state.round === this.state.maxRounds ? 2 : 1;
  }

  private addCrumbs(pl: Player, delta: number) {
    const before = pl.crumbs;
    pl.crumbs = Math.max(0, pl.crumbs + delta);
    return pl.crumbs - before;
  }

  private land(pl: Player) {
    this.moving = null;
    const node = this.board.nodes[pl.node];
    const m = this.tileMult();
    const finish = (ms = 2300) => this.schedule(ms, () => this.endTurn());
    this.setPhase("tile");
    switch (node.type) {
      case "blue": {
        const d = this.addCrumbs(pl, 3 * m);
        this.emit({ kind: "tile", playerId: pl.id, tile: "blue", delta: d, text: `+${arDigits(String(d))} فتات` });
        return finish(1700);
      }
      case "red": {
        if (pl.shielded) {
          pl.shielded = false;
          this.emit({ kind: "tile", playerId: pl.id, tile: "red", delta: 0, text: "الدرع حماك!" });
          return finish();
        }
        const d = this.addCrumbs(pl, -3 * m);
        this.emit({ kind: "tile", playerId: pl.id, tile: "red", delta: d, text: `${arDigits(String(d))} فتات` });
        return finish(1900);
      }
      case "lighthouse": {
        const d = this.addCrumbs(pl, 8 * m);
        this.emit({ kind: "tile", playerId: pl.id, tile: "lighthouse", delta: d, text: `المنارة تهديك ${arDigits(String(d))} فتات` });
        return finish();
      }
      case "shop":
        if (this.canShop(pl)) return this.askShop(pl, true);
        this.emit({ kind: "tile", playerId: pl.id, tile: "shop", delta: 0, text: "الدكان: ما عندك فتات تكفي" });
        return finish(1800);
      case "wheel":
        return this.askWheel(pl);
      case "landmark":
        return this.landmark(pl, node, finish);
      case "box":
        return this.openBox(pl, finish);
      case "event":
        return this.runEvent(pl, finish);
      case "duel":
        return this.askTarget(pl.id, "duel");
      default:
        this.emit({ kind: "tile", playerId: pl.id, tile: node.type, delta: 0, text: "" });
        return finish(900);
    }
  }

  private openBox(pl: Player, finish: (ms?: number) => void) {
    const roll = Math.random();
    if (roll < 0.25) {
      pl.shielded = true;
      this.emit({ kind: "item", playerId: pl.id, item: "shield", text: `${pl.name} لقى درع! يحميه من أول مصيبة` });
    } else if (pl.items.length < 3 && roll < 0.7) {
      const item: ItemId = Math.random() < 0.55 ? "doubleDice" : "steal";
      pl.items.push(item);
      this.emit({ kind: "item", playerId: pl.id, item, text: `${pl.name} لقى ${ITEMS[item].name}!` });
    } else {
      const d = this.addCrumbs(pl, 6 * this.tileMult());
      this.emit({ kind: "tile", playerId: pl.id, tile: "box", delta: d, text: `الصندوق فيه ${arDigits(String(d))} فتات` });
    }
    finish(2600);
  }

  // ---------------------------------------------------------------- items / shop / wheel / landmarks
  private canHold(pl: Player, item: ItemId) {
    return item === "shield" ? !pl.shielded : pl.items.length < 3;
  }
  private canShop(pl: Player) {
    return SHOP_STOCK.some((s) => pl.crumbs >= s.price && this.canHold(pl, s.item));
  }

  /** Bots: use the star gate when they can afford the star, dice items often, steal sometimes. */
  private botItem(pl: Player) {
    if (pl.items.includes("starGate") && pl.crumbs >= STAR_COST) return this.useItem(pl.id, "starGate");
    const dice = pl.items.find((i) => i === "tripleDice" || i === "doubleDice");
    if (dice && Math.random() < 0.6) return this.useItem(pl.id, dice);
    if (pl.items.includes("steal") && Math.random() < 0.4) return this.useItem(pl.id, "steal");
  }
  private botShopPick(pl: Player): ItemId | null {
    const can = (item: ItemId) => {
      const s = SHOP_STOCK.find((x) => x.item === item)!;
      return pl.crumbs >= s.price && this.canHold(pl, item);
    };
    if (can("starGate") && pl.crumbs >= 15 + STAR_COST) return "starGate";
    if (Math.random() < 0.3) return null;
    if (can("tripleDice") && pl.crumbs >= 18) return "tripleDice";
    if (can("shield") && Math.random() < 0.4) return "shield";
    if (can("doubleDice")) return "doubleDice";
    return null;
  }

  private askShop(pl: Player, landed: boolean) {
    const node = this.board.nodes[pl.node];
    this.shopLanded = landed;
    const name = node.shopName ?? "الدكان";
    this.state.pendingShop = { playerId: pl.id, name, stock: SHOP_STOCK };
    this.setPhase("shop", 15000);
    this.emit({ kind: "banner", title: name, text: `${pl.name} دخل الدكان` });
    if (pl.isBot || !pl.connected) this.botLater(rand(1600, 2400), () => this.shopBuy(pl.id, this.botShopPick(pl), true));
    this.schedule(15000, () => this.shopBuy(pl.id, null, true));
  }

  shopBuy(playerId: string, item: ItemId | null, auto = false) {
    const ps = this.state.pendingShop;
    if (this.state.phase !== "shop" || !ps || ps.playerId !== playerId) return;
    void auto;
    const pl = this.p(playerId)!;
    const offer = item ? ps.stock.find((s) => s.item === item) : undefined;
    if (item && (!offer || pl.crumbs < offer.price || !this.canHold(pl, item))) return; // invalid pick: keep shopping
    this.state.pendingShop = undefined;
    this.setPhase("tile");
    const after = () => (this.shopLanded ? this.endTurn() : this.resumeAfterStar(pl));
    if (!offer) {
      this.emit({ kind: "banner", title: ps.name, text: `${pl.name} طلع بدون ما يشتري` });
      return this.schedule(1100, after);
    }
    pl.crumbs -= offer.price;
    if (offer.item === "shield") pl.shielded = true;
    else pl.items.push(offer.item);
    this.emit({ kind: "item", playerId, item: offer.item, text: `${pl.name} اشترى ${ITEMS[offer.item].name}!` });
    this.schedule(2500, after);
  }

  private askWheel(pl: Player) {
    this.state.pendingWheel = { playerId: pl.id };
    this.setPhase("wheel", 10000);
    this.emit({ kind: "banner", title: "عجلة الحظ!", text: `${pl.name}، وقّف العجلة من تلفونك` });
    if (pl.isBot || !pl.connected) this.botLater(rand(1600, 2800), () => this.spin(pl.id));
    this.schedule(10000, () => this.spin(pl.id));
  }

  spin(playerId: string) {
    const pw = this.state.pendingWheel;
    if (this.state.phase !== "wheel" || !pw || pw.playerId !== playerId) return;
    this.state.pendingWheel = undefined;
    const pl = this.p(playerId)!;
    const total = WHEEL.reduce((a, w) => a + w.weight, 0);
    let r = Math.random() * total;
    let index = 0;
    while (r >= WHEEL[index].weight) r -= WHEEL[index++].weight;
    const seg = WHEEL[index];
    const deltas: Record<string, number> = {};
    let moves: Record<string, number> | undefined;
    let text = "";
    const others = this.state.players.filter((x) => x.id !== pl.id);
    const shielded = () => {
      if (!pl.shielded) return false;
      pl.shielded = false;
      text = "الدرع حماك من العجلة!";
      return true;
    };
    switch (seg.id) {
      case "plus":
        deltas[pl.id] = this.addCrumbs(pl, 12);
        text = `${pl.name} ربح ${arDigits(String(deltas[pl.id]))} فتات`;
        break;
      case "minus":
        if (shielded()) break;
        deltas[pl.id] = this.addCrumbs(pl, -10);
        text = `${pl.name} خسر ${arDigits(String(-deltas[pl.id]))} فتات`;
        break;
      case "star":
        pl.stars++;
        text = `${pl.name} ربح نجمة ببلاش!`;
        break;
      case "loseStar":
        if (shielded()) break;
        if (pl.stars > 0) {
          pl.stars--;
          text = `${pl.name} خسر نجمة!`;
        } else {
          deltas[pl.id] = this.addCrumbs(pl, -5);
          text = `ما عنده نجوم، فخسر ${arDigits(String(-deltas[pl.id]))} فتات`;
        }
        break;
      case "swap": {
        const st = this.standings();
        const other = st[0].id !== pl.id ? st[0] : st.at(-1)!;
        if (other.id === pl.id || other.node === pl.node) {
          deltas[pl.id] = this.addCrumbs(pl, 5);
          text = "ما في أحد تتبدل معاه، خذ ٥ فتات";
          break;
        }
        [pl.node, other.node] = [other.node, pl.node];
        moves = { [pl.id]: pl.node, [other.id]: other.node };
        text = `${pl.name} تبدّل مكانه مع ${other.name}`;
        break;
      }
      case "item": {
        if (pl.items.length >= 3) {
          deltas[pl.id] = this.addCrumbs(pl, 8);
          text = "أغراضك مليانة، خذ ٨ فتات بدالها";
          break;
        }
        const item = pick<ItemId>(["doubleDice", "tripleDice", "steal", "starGate"]);
        pl.items.push(item);
        text = `${pl.name} لقى ${ITEMS[item].name}!`;
        break;
      }
      case "tax":
        for (const o of others) {
          const d = -this.addCrumbs(o, -3);
          deltas[o.id] = -d;
          deltas[pl.id] = (deltas[pl.id] ?? 0) + this.addCrumbs(pl, d);
        }
        text = `الكل عطى ${pl.name} ٣ فتات`;
        break;
      case "gift":
        if (shielded()) break;
        for (const o of others) {
          const d = -this.addCrumbs(pl, -3);
          if (!d) break;
          deltas[pl.id] = (deltas[pl.id] ?? 0) - d;
          deltas[o.id] = this.addCrumbs(o, d);
        }
        text = `${pl.name} عطى الكل ٣ فتات`;
        break;
    }
    this.setPhase("tile");
    this.emit({ kind: "wheel", playerId, index, title: seg.label, text, deltas, moves });
    this.schedule(7600, () => this.endTurn());
  }

  /** Map features: each one does something that fits the place. */
  private landmark(pl: Player, node: BoardNode, finish: (ms?: number) => void) {
    const lm = node.landmark!;
    const name = LANDMARKS[lm].name;
    const m = this.tileMult();
    let text = "";
    let delta = 0;
    let to: number | undefined;
    switch (lm) {
      case "fountain": {
        if (pl.crumbs < 5) {
          text = "تبي تتمنى؟ لازم ترمي ٥ فتات وانت ما عندك";
          break;
        }
        delta = this.addCrumbs(pl, -5);
        const r = Math.random();
        if (r < 0.4 && pl.items.length < 3) {
          const item = pick<ItemId>(["tripleDice", "starGate", "steal"]);
          pl.items.push(item);
          text = `رمى ٥ فتات… وتحققت أمنيته! لقى ${ITEMS[item].name}`;
        } else if (r < 0.8) {
          delta += this.addCrumbs(pl, 14);
          text = "رمى ٥ فتات… والنافورة رجعت له ١٤!";
        } else text = "رمى ٥ فتات… والأمنية ما تحققت";
        break;
      }
      case "farm":
        delta = this.addCrumbs(pl, (4 + this.state.round) * m);
        text = `حصاد المزرعة! البقرة عطته ${arDigits(String(delta))} فتات`;
        break;
      case "cave":
        to = node.warpTo;
        text = "دخل الكهف السري وطلع من الجهة الثانية!";
        break;
      case "zipline":
        to = node.warpTo;
        text = "تعلّق بالحبل الطاير ونزل تحت!";
        break;
      case "boat":
        to = node.warpTo;
        text = "ركب القارب وعبر البركة!";
        break;
      case "waterfall":
        if (pl.shielded) {
          pl.shielded = false;
          text = "الشلال كان بيسحبه، بس الدرع حماه!";
          break;
        }
        to = node.warpTo;
        text = "الجسر زلق! الشلال سحبه ٣ خانات لورا";
        break;
    }
    if (to !== undefined) pl.node = to;
    this.emit({ kind: "landmark", playerId: pl.id, landmark: lm, title: name, text, delta, to });
    finish(to !== undefined ? 4600 : 3800);
  }

  private standings() {
    return [...this.state.players].sort((a, b) => b.stars - a.stars || b.crumbs - a.crumbs);
  }

  private runEvent(pl: Player, finish: (ms?: number) => void) {
    const ev = pick(EVENTS);
    const deltas: Record<string, number> = {};
    let moves: Record<string, number> | undefined;
    const ps = this.state.players;
    switch (ev.id) {
      case "snap":
        for (const x of ps) deltas[x.id] = this.addCrumbs(x, -Math.floor(x.crumbs / 2));
        break;
      case "storm": {
        const nodes = shuffle(ps.map((x) => x.node));
        moves = {};
        ps.forEach((x, i) => {
          x.node = nodes[i];
          moves![x.id] = nodes[i];
        });
        break;
      }
      case "generous": {
        const last = this.standings().at(-1)!;
        deltas[last.id] = this.addCrumbs(last, 10);
        break;
      }
      case "hunter": {
        const lead = this.standings()[0];
        deltas[lead.id] = this.addCrumbs(lead, -10);
        break;
      }
      case "rain":
        for (const x of ps) deltas[x.id] = this.addCrumbs(x, 5);
        break;
    }
    void pl;
    this.emit({ kind: "event", title: ev.title, text: ev.text, deltas, moves });
    finish(4200);
  }

  private askTarget(playerId: string, reason: "duel" | "steal") {
    const pl = this.p(playerId)!;
    const prevPhase = this.state.phase;
    this.state.pendingTarget = { playerId, reason };
    this.setPhase("pickTarget", 12000);
    this.emit({
      kind: "banner",
      title: reason === "duel" ? "مبارزة!" : "سرقة!",
      text: reason === "duel" ? `${pl.name} يختار منو يبارز` : `${pl.name} يختار منو يسرق`,
    });
    (this as any)._targetReturn = prevPhase;
    const others = this.state.players.filter((x) => x.id !== playerId);
    const auto = () => this.target(playerId, (reason === "steal" ? this.standings().find((x) => x.id !== playerId) : pick(others))!.id, true);
    if (pl.isBot || !pl.connected) this.botLater(1500, auto);
    this.schedule(12000, auto);
  }

  target(playerId: string, targetId: string, auto = false) {
    const pt = this.state.pendingTarget;
    if (this.state.phase !== "pickTarget" || !pt || pt.playerId !== playerId || targetId === playerId) return;
    const tgt = this.p(targetId);
    if (!tgt) return;
    void auto;
    this.state.pendingTarget = undefined;
    const pl = this.p(playerId)!;
    if (pt.reason === "steal") {
      const d = -this.addCrumbs(tgt, -5);
      pl.crumbs += d;
      tgt.stats.stolenFrom++;
      this.setPhase("tile");
      this.emit({ kind: "event", title: "سرقة!", text: `${pl.name} سرق ${arDigits(String(d))} فتات من ${tgt.name}`, deltas: { [pl.id]: d, [tgt.id]: -d } });
      // back to rolling
      this.schedule(3000, () => {
        this.setPhase("turn", 20000);
        this.emit();
        if (pl.isBot || !pl.connected) this.botLater(1200, () => this.roll(pl.id, true));
        this.schedule(20000, () => this.roll(pl.id, true));
      });
    } else {
      this.startMinigame([playerId, targetId], true);
    }
  }

  private endTurn() {
    this.extraRolls = 0;
    this.state.turnIdx++;
    if (this.state.turnIdx >= this.state.order.length && this.race && this.state.round % RACE_MG_EVERY !== 0) {
      this.nextRound();
    } else if (this.state.turnIdx >= this.state.order.length) {
      this.startMinigame(this.state.players.map((x) => x.id), false);
    } else this.beginTurn();
  }

  // ---------------------------------------------------------------- minigames
  /** Testing only (server started with --dev): jump straight into a minigame. */
  devMinigame(id: MinigameId) {
    if (this.state.phase !== "turn") return;
    this.dispose();
    this.moving = null;
    this.mgCount = MINIGAME_ROTATION.indexOf(id);
    this.startMinigame(this.state.players.map((x) => x.id), false);
  }

  /** Testing only (server started with --dev): the current player lands on a given tile. */
  devLand(node: number) {
    const cur = this.current;
    if (this.state.phase !== "turn" || !cur || !this.board.nodes[node]) return;
    this.clearBots();
    this.dispose();
    this.moving = null;
    cur.node = node;
    this.land(cur);
  }

  /** Testing only: the next roll shows these dice. */
  devDice(values: number[]) {
    if (Array.isArray(values) && values.length && values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)) this.forcedDice = values;
  }

  /** Testing only: move the current player to a tile without landing (they still roll). */
  devPlace(node: number) {
    const cur = this.current;
    if (this.state.phase !== "turn" || !cur || !this.board.nodes[node]) return;
    cur.node = node;
    this.emit();
  }

  private startMinigame(participants: string[], duel: boolean) {
    this.clearBots();
    const id: MinigameId = duel ? pick(["tenSeconds", "dontWake"] as const) : MINIGAME_ROTATION[this.mgCount++ % MINIGAME_ROTATION.length];
    const meta = MINIGAMES[id];
    this.pushPots.clear();
    this.mgScores = {};
    this.state.minigame = {
      id, participants, startAt: 0, durationMs: meta.durationMs, submitted: {}, duel,
      signalDelayMs: id === "dontWake" ? rand(2200, 5600) : undefined,
    };
    this.state.minigame.ready = {};
    this.setPhase("mgIntro", 12000);
    this.emit({ kind: "banner", title: duel ? "مبارزة!" : "ميني قيم!", text: meta.title });
    // bots and disconnected players are ready right away (after a short beat so it reads on screen)
    for (const pid of participants) {
      const p = this.p(pid)!;
      if (p.isBot || !p.connected) this.botLater(rand(900, 2200), () => this.ready(pid));
    }
    this.schedule(12000, () => this.playMinigame());
  }

  ready(playerId: string) {
    const mg = this.state.minigame;
    if (!mg || this.state.phase !== "mgIntro" || !mg.participants.includes(playerId) || mg.ready?.[playerId]) return;
    mg.ready ??= {};
    mg.ready[playerId] = true;
    this.emit();
    if (mg.participants.every((p) => mg.ready![p])) this.schedule(1300, () => this.playMinigame());
  }

  private playMinigame() {
    const mg = this.state.minigame!;
    if (this.state.phase !== "mgIntro") return;
    mg.startAt = Date.now() + 3000;
    this.setPhase("mgPlay");
    this.emit();
    mg.progress = {};
    mg.busted = {};
    for (const pid of mg.participants) {
      const pl = this.p(pid)!;
      if (!pl.isBot) continue;
      this.botPlay(pid, mg);
    }
    this.schedule(3000 + mg.durationMs + 600, () => this.finishMinigame());
  }

  /** Bots play visibly: they stream progress like a phone would, then submit. */
  private botPlay(pid: string, mg: NonNullable<GameState["minigame"]>) {
    const t0 = 3000;
    if (mg.id === "mash") {
      const speed = rand(30, 62) / 10; // taps per second
      let n = 0;
      for (let t = 400; t < mg.durationMs - 300; t += 400) {
        this.botLater(t0 + t, () => {
          n += Math.round(speed * 0.4 + Math.random() * 1.5);
          this.progress(pid, n);
        });
      }
      this.botLater(t0 + mg.durationMs - 250, () => this.submit(pid, n));
    } else if (mg.id === "pushLuck") {
      const target = rand(1, 5);
      for (let i = 1; i <= target; i++) {
        this.botLater(t0 + 900 * i + rand(0, 400), () => {
          if (mg.submitted[pid]) return;
          const r = this.push(pid);
          if (!r.busted && i === target) this.submit(pid, r.pot);
        });
      }
    } else {
      const at = t0 + rand(1500, mg.durationMs - 1500);
      this.botLater(mg.id === "dontWake" ? t0 + (mg.signalDelayMs ?? 0) + rand(250, 600) : at, () =>
        this.submit(pid, this.botScore(mg.id, mg.signalDelayMs ?? 0)));
    }
  }

  private lastProgressEmit = 0;
  progress(playerId: string, value: number) {
    const mg = this.state.minigame;
    if (!mg || this.state.phase !== "mgPlay" || !mg.participants.includes(playerId) || !Number.isFinite(value)) return;
    mg.progress ??= {};
    mg.progress[playerId] = Math.max(0, Math.min(10000, value));
    const now = Date.now();
    if (now - this.lastProgressEmit > 150) {
      this.lastProgressEmit = now;
      this.emit();
    }
  }

  private botScore(id: MinigameId, signal: number) {
    switch (id) {
      case "tenSeconds": return 10000 + rand(-1400, 1400);
      case "dontWake": return Math.random() < 0.1 ? -1 : signal + rand(260, 520);
      case "mash": return rand(22, 48);
      case "pushLuck": return Math.random() < 0.35 ? 0 : 2 ** rand(1, 4);
    }
  }

  submit(playerId: string, score: number) {
    const mg = this.state.minigame;
    if (!mg || this.state.phase !== "mgPlay" || !mg.participants.includes(playerId) || mg.submitted[playerId]) return;
    if (!Number.isFinite(score)) return;
    
    this.mgScores[playerId] = score;
    mg.submitted[playerId] = true;
    this.emit();
    if (mg.participants.every((p) => mg.submitted[p])) this.schedule(900, () => this.finishMinigame());
  }

  push(playerId: string): { busted: boolean; pot: number } {
    const mg = this.state.minigame;
    if (!mg || mg.id !== "pushLuck" || this.state.phase !== "mgPlay" || mg.submitted[playerId]) return { busted: true, pot: 0 };
    const st = this.pushPots.get(playerId) ?? { pot: 1, done: false };
    if (st.done) return { busted: true, pot: 0 };
    const risk = Math.min(0.12 + 0.07 * Math.log2(st.pot + 1), 0.6);
    if (Math.random() < risk) {
      st.pot = 0;
      st.done = true;
      this.pushPots.set(playerId, st);
      mg.busted ??= {};
      mg.busted[playerId] = true;
      mg.progress ??= {};
      mg.progress[playerId] = 0;
      this.p(playerId)!.stats.risks++;
      this.submit(playerId, 0);
      return { busted: true, pot: 0 };
    }
    st.pot *= 2;
    this.pushPots.set(playerId, st);
    mg.progress ??= {};
    mg.progress[playerId] = st.pot;
    this.emit();
    this.p(playerId)!.stats.risks++;
    return { busted: false, pot: st.pot };
  }

  private finishMinigame() {
    const mg = this.state.minigame;
    if (!mg || this.state.phase !== "mgPlay") return;
    this.clearBots();
    const scores = this.mgScores;
    // normalize: higher "value" = better
    const value = (pid: string): number => {
      const s = scores[pid];
      if (s === undefined) return -Infinity;
      switch (mg.id) {
        case "tenSeconds": return -Math.abs(s - 10000);
        case "dontWake": return s < 0 ? -1e9 : -(s - (mg.signalDelayMs ?? 0));
        case "mash":
        case "pushLuck": return s;
      }
    };
    const fmt = (pid: string): string => arDigits(fmtRaw(pid));
    const fmtRaw = (pid: string): string => {
      const s = scores[pid];
      if (s === undefined) return "ما لعب";
      switch (mg.id) {
        case "tenSeconds": return `${(s / 1000).toFixed(2)} ث`;
        case "dontWake": return s < 0 ? "استعجل!" : `${Math.round(s - (mg.signalDelayMs ?? 0))} ms`;
        case "mash": return `${s} ضغطة`;
        case "pushLuck": return s === 0 ? "أكله الثعلب" : `${s} فتات`;
      }
    };
    const sorted = [...mg.participants].sort((a, b) => value(b) - value(a));
    const results: NonNullable<typeof mg.results> = [];
    let rank = 0;
    sorted.forEach((pid, i) => {
      if (i > 0 && value(pid) < value(sorted[i - 1])) rank = i;
      results.push({ playerId: pid, score: scores[pid] ?? 0, display: fmt(pid), reward: 0, rank });
    });
    if (this.race && !mg.duel) {
      for (const r of results) {
        r.reward = value(r.playerId) === -Infinity ? 0 : RACE_STEPS[r.rank] ?? 0;
        if (r.rank === 0 && r.reward > 0) this.p(r.playerId)!.stats.minigameWins++;
      }
    } else if (mg.duel) {
      const [w, l] = results;
      if (w.rank === 0 && l.rank === 1) {
        const taken = -this.addCrumbs(this.p(l.playerId)!, -10);
        this.p(w.playerId)!.crumbs += taken;
        w.reward = taken;
        l.reward = -taken;
      }
    } else {
      for (const r of results) {
        const base = value(r.playerId) === -Infinity ? 0 : MG_REWARDS[r.rank] ?? 1;
        r.reward = this.addCrumbs(this.p(r.playerId)!, base);
        if (r.rank === 0 && base > 0) this.p(r.playerId)!.stats.minigameWins++;
      }
    }
    mg.results = results;
    this.setPhase("mgResults");
    this.emit();
    this.schedule(6500, () => {
      this.state.minigame = undefined;
      if (mg.duel) this.endTurn();
      else if (this.race) this.raceBonus(results.filter((r) => r.reward > 0).map((r) => ({ pid: r.playerId, steps: r.reward })));
      else this.nextRound();
    });
  }

  private nextRound() {
    if (this.state.round >= this.state.maxRounds) return this.race ? this.raceEnd() : this.final();
    this.state.round++;
    this.state.turnIdx = 0;
    this.beginTurn();
  }

  // ---------------------------------------------------------------- race (snakes & ladders)
  /** Walk `steps` cells (bouncing back off the last cell), then win / take a snake or ladder, then `done`. */
  private raceAdvance(pl: Player, steps: number, done: () => void) {
    const last = this.board.nodes.length - 1;
    const path: number[] = [];
    let pos = pl.node;
    let dir = 1;
    for (let i = 0; i < steps; i++) {
      if (pos === last) dir = -1;
      pos += dir;
      path.push(pos);
    }
    pl.node = pos;
    this.setPhase("moving");
    this.emit({ kind: "move", playerId: pl.id, path, rest: 0 });
    this.schedule(path.length * HOP_MS + 500, () => {
      if (pl.node === last) return this.raceWin(pl);
      const j = this.board.jumps?.find((x) => x.from === pl.node);
      if (!j) return done();
      pl.node = j.to;
      if (j.kind === "snake") pl.stats.stolenFrom++; // reused as "snakes taken" for the end screen
      this.setPhase("tile");
      this.emit({ kind: "jump", playerId: pl.id, from: j.from, to: j.to, jump: j.kind });
      this.schedule(j.kind === "snake" ? 3400 : 2800, done);
    });
  }

  /** After a race minigame the top places move forward, one after another. */
  private raceBonus(list: { pid: string; steps: number }[]): void {
    const next = list.shift();
    if (!next) return this.nextRound();
    const pl = this.p(next.pid);
    if (!pl) return this.raceBonus(list);
    this.setPhase("tile");
    this.emit({ kind: "banner", title: `مكافأة ${pl.name}`, text: `يتقدم ${arDigits(String(next.steps))} خطوات` });
    this.schedule(1300, () => this.raceAdvance(pl, next.steps, () => this.raceBonus(list)));
  }

  private raceWin(pl: Player) {
    this.clearBots();
    this.state.winnerIds = [pl.id];
    this.setPhase("final");
    this.emit({ kind: "win", playerId: pl.id });
    this.schedule(5600, () => {
      this.setPhase("end");
      this.emit({ kind: "none" });
    });
  }

  private raceEnd() {
    const far = Math.max(...this.state.players.map((p) => p.node));
    this.state.winnerIds = this.state.players.filter((p) => p.node === far).map((p) => p.id);
    this.setPhase("final");
    this.emit({ kind: "banner", title: "خلصت الجولات!", text: "اللي وصل أبعد خانة يفوز" });
    this.schedule(3500, () => {
      this.setPhase("end");
      this.emit({ kind: "none" });
    });
  }

  private final() {
    const ps = this.state.players;
    const bonuses: { title: string; playerId: string }[] = [];
    const best = (f: (p: Player) => number) => {
      const top = Math.max(...ps.map(f));
      const who = ps.filter((p) => f(p) === top);
      return top > 0 && who.length === 1 ? who[0] : undefined;
    };
    const mgKing = best((p) => p.stats.minigameWins);
    if (mgKing) bonuses.push({ title: "ملك الميني قيمز", playerId: mgKing.id });
    const victim = best((p) => p.stats.stolenFrom);
    if (victim) bonuses.push({ title: "أكثر واحد انسرق", playerId: victim.id });
    const gambler = best((p) => p.stats.risks);
    if (gambler) bonuses.push({ title: "أكبر مخاطر", playerId: gambler.id });
    for (const b of bonuses) this.p(b.playerId)!.stars++;
    this.state.bonuses = bonuses;
    this.setPhase("final");
    this.emit({ kind: "banner", title: "خلصت اللعبة!", text: "وقت الجوايز المخفية" });
    this.schedule(3500 + bonuses.length * 2600, () => {
      const st = this.standings();
      this.state.winnerIds = st.filter((p) => p.stars === st[0].stars && p.crumbs === st[0].crumbs).map((p) => p.id);
      this.setPhase("end");
      this.emit({ kind: "none" });
    });
  }
}
