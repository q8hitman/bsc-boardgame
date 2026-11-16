import { buildDeck, canPlay, cardPoints, COLOR_IDS, HAND_SIZE, isWild, KWAK_MS } from "../shared/cards";
import type { Anim, Card, CardColor, CardTable, GameState, Player } from "../shared/types";

/** What the card game needs from the Room (its timers, sockets and broadcast). */
export interface CardHost {
  state: GameState;
  emit(anim?: Anim): void;
  schedule(ms: number, fn: () => void): void;
  botLater(ms: number, fn: () => void): void;
  clearBots(): void;
  setPhase(phase: GameState["phase"], timeoutMs?: number | null): void;
  sendTo(playerId: string, cards: Card[]): void;
}

const TURN_MS = 25000;
const DRAWN_MS = 9000;
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = <T>(arr: T[]) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** "كواك!": shedding card game. Server keeps the deck and every hand; phones only ever see their own hand. */
export class CardGame {
  private deck: Card[] = [];
  private pile: Card[] = []; // full discard pile, top last
  private hands = new Map<string, Card[]>();
  private preCalled = new Set<string>(); // shouted "كواك!" before playing their second-to-last card
  private kwakTimer: ReturnType<typeof setTimeout> | null = null;
  private over = false;

  constructor(private h: CardHost) {}

  private get s() {
    return this.h.state;
  }
  private get t(): CardTable {
    return this.s.table!;
  }
  private p(id: string) {
    return this.s.players.find((x) => x.id === id);
  }
  private get current(): Player | undefined {
    return this.p(this.s.order[this.s.turnIdx]);
  }
  hand(id: string) {
    return this.hands.get(id) ?? [];
  }

  // ---------------------------------------------------------------- setup
  start() {
    this.stop();
    this.over = false;
    const s = this.s;
    this.deck = shuffle(buildDeck());
    this.pile = [];
    this.hands.clear();
    this.preCalled.clear();
    s.order = shuffle(s.players.map((x) => x.id));
    s.turnIdx = 0;
    s.round = 1;
    s.winnerIds = undefined;
    for (const pl of s.players) this.hands.set(pl.id, this.deck.splice(0, HAND_SIZE));
    // the first card on the table is always a plain number
    const first = this.deck.findIndex((c) => c.kind === "num");
    this.pile.push(...this.deck.splice(first, 1));
    s.table = { discard: [], color: this.pile[0].color!, dir: 1, pendingDraw: 0, counts: {}, deckCount: 0 };
    this.sync();
    this.h.setPhase("intro");
    this.h.emit({ kind: "draw", playerId: "", n: HAND_SIZE, why: "deal" });
    this.h.schedule(4600, () => this.beginTurn());
  }

  stop() {
    if (this.kwakTimer) clearTimeout(this.kwakTimer);
    this.kwakTimer = null;
    if (this.s.table) this.s.table.kwak = undefined;
  }

  /** Refresh the public table and push each hand to its phone. */
  private sync() {
    const t = this.t;
    t.discard = this.pile.slice(-6);
    t.deckCount = this.deck.length;
    t.counts = Object.fromEntries(this.s.players.map((x) => [x.id, this.hand(x.id).length]));
    for (const pl of this.s.players) if (!pl.isBot) this.h.sendTo(pl.id, this.hand(pl.id));
  }
  /** Resend one hand (reconnect). */
  resend(id: string) {
    if (this.hands.has(id)) this.h.sendTo(id, this.hand(id));
  }

  private take(n: number): Card[] {
    const out: Card[] = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        // reshuffle everything under the top card back into the deck
        const top = this.pile.pop()!;
        this.deck = shuffle(this.pile);
        this.pile = [top];
      }
      const c = this.deck.pop();
      if (!c) break;
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- turns
  private beginTurn() {
    if (this.over) return;
    const cur = this.current;
    if (!cur) return;
    this.t.drawn = undefined;
    this.h.setPhase("cards", TURN_MS);
    this.sync();
    this.h.emit();
    this.h.schedule(TURN_MS, () => this.timeout(cur.id));
    const auto = cur.isBot || !cur.connected;
    if (auto) this.h.botLater(rand(1300, 2100), () => this.botMove(cur.id));
    else if (this.t.pendingDraw > 0 && !this.hand(cur.id).some((c) => canPlay(c, this.t)))
      // nothing to stack with: take the cards without making the player tap
      this.h.schedule(1900, () => this.takePending(cur.id));
  }

  private advance(steps: number) {
    const n = this.s.order.length;
    this.s.turnIdx = (((this.s.turnIdx + this.t.dir * steps) % n) + n) % n;
  }
  private nextId(steps = 1) {
    const n = this.s.order.length;
    return this.s.order[(((this.s.turnIdx + this.t.dir * steps) % n) + n) % n];
  }

  private isTurn(pid: string) {
    return this.s.phase === "cards" && this.current?.id === pid && !this.over;
  }

  play(pid: string, cardId: number, color?: CardColor, target?: string) {
    if (!this.isTurn(pid)) return;
    const t = this.t;
    const hand = this.hand(pid);
    const i = hand.findIndex((c) => c.id === cardId);
    if (i < 0) return;
    const card = hand[i];
    if (t.drawn && t.drawn.cardId !== cardId) return;
    if (!canPlay(card, t)) return;
    this.h.clearBots();
    hand.splice(i, 1);
    this.pile.push(card);
    t.drawn = undefined;
    t.color = isWild(card) ? (color && COLOR_IDS.includes(color) ? color : this.bestColor(hand)) : card.color!;

    const anim: Extract<Anim, { kind: "card" }> = { kind: "card", playerId: pid, card, color: t.color };
    let steps = 1;
    const many = this.s.order.length > 2;
    if (card.kind === "skip") {
      anim.skipped = this.nextId(1);
      steps = 2;
    } else if (card.kind === "rev") {
      if (many) {
        t.dir = t.dir === 1 ? -1 : 1;
        anim.reversed = true;
      } else {
        anim.skipped = this.nextId(1);
        steps = 2;
      }
    } else if (card.kind === "draw2") t.pendingDraw += 2;
    else if (card.kind === "wild4") t.pendingDraw += 4;
    else if (card.kind === "swap") {
      const others = this.s.players.filter((x) => x.id !== pid);
      const tgt = others.find((x) => x.id === target) ?? others.sort((a, b) => this.hand(a.id).length - this.hand(b.id).length)[0];
      if (tgt) {
        const mine = this.hand(pid);
        this.hands.set(pid, this.hand(tgt.id));
        this.hands.set(tgt.id, mine);
        anim.swapWith = tgt.id;
      }
    }

    const left = this.hand(pid).length;
    this.sync();
    this.h.setPhase("tile");
    this.h.emit(anim);

    if (left === 0) {
      this.preCalled.delete(pid);
      this.h.schedule(1500, () => this.win(pid));
      return;
    }
    if (left === 1 && !anim.swapWith) this.openKwak(pid);
    else this.preCalled.delete(pid);
    this.h.schedule(card.kind === "num" ? 1100 : 1700, () => {
      this.advance(steps);
      this.beginTurn();
    });
  }

  draw(pid: string) {
    if (!this.isTurn(pid) || this.t.drawn) return;
    if (this.t.pendingDraw > 0) return this.takePending(pid);
    this.h.clearBots();
    const [c] = this.take(1);
    this.preCalled.delete(pid);
    if (!c) return this.pass();
    this.hand(pid).push(c);
    this.sync();
    if (canPlay(c, this.t)) {
      // they may play the card they just drew, or keep it
      this.t.drawn = { playerId: pid, cardId: c.id };
      this.h.setPhase("cards", DRAWN_MS);
      this.h.emit({ kind: "draw", playerId: pid, n: 1, why: "draw" });
      this.h.schedule(DRAWN_MS, () => this.keep(pid));
      const pl = this.p(pid);
      if (pl && (pl.isBot || !pl.connected)) this.h.botLater(rand(900, 1500), () => this.botMove(pid));
      return;
    }
    this.h.setPhase("tile");
    this.h.emit({ kind: "draw", playerId: pid, n: 1, why: "draw" });
    this.h.schedule(1300, () => this.pass());
  }

  keep(pid: string) {
    if (!this.isTurn(pid) || !this.t.drawn) return;
    this.h.clearBots();
    this.t.drawn = undefined;
    this.pass();
  }

  private pass() {
    this.advance(1);
    this.beginTurn();
  }

  private takePending(pid: string) {
    if (!this.isTurn(pid) || this.t.pendingDraw <= 0) return;
    this.h.clearBots();
    const n = this.t.pendingDraw;
    this.t.pendingDraw = 0;
    this.hand(pid).push(...this.take(n));
    this.preCalled.delete(pid);
    this.sync();
    this.h.setPhase("tile");
    this.h.emit({ kind: "draw", playerId: pid, n, why: "stack" });
    this.h.schedule(1400 + n * 160, () => this.pass());
  }

  /** Turn timer ran out: take what is owed / draw one, and move on. */
  private timeout(pid: string) {
    if (!this.isTurn(pid)) return;
    if (this.t.drawn) return this.keep(pid);
    if (this.t.pendingDraw > 0) return this.takePending(pid);
    this.draw(pid);
    if (this.t.drawn) this.keep(pid);
  }

  /** Organizer's skip button: play the turn for them. */
  skip() {
    const cur = this.current;
    if (cur && this.s.phase === "cards") this.botMove(cur.id);
  }

  // ---------------------------------------------------------------- كواك!
  private openKwak(pid: string) {
    if (this.preCalled.delete(pid)) {
      this.h.emit({ kind: "kwak", playerId: pid });
      return;
    }
    const until = Date.now() + KWAK_MS;
    this.t.kwak = { playerId: pid, until };
    if (this.kwakTimer) clearTimeout(this.kwakTimer);
    this.kwakTimer = setTimeout(() => {
      // nobody caught them: lucky escape
      if (this.t.kwak?.playerId === pid) {
        this.t.kwak = undefined;
        this.h.emit();
      }
    }, KWAK_MS);
    // bots shout for themselves most of the time, and try to catch others
    const owner = this.p(pid);
    if (owner?.isBot && Math.random() < 0.82) setTimeout(() => this.kwak(pid), rand(350, 1300));
    for (const b of this.s.players) if (b.isBot && b.id !== pid && Math.random() < 0.45) setTimeout(() => this.kwak(b.id), rand(1300, 2900));
  }

  /** The "كواك!" button: shout it for yourself, or catch someone who forgot. */
  kwak(pid: string) {
    if (this.over) return;
    const k = this.t.kwak;
    if (!k) {
      // shouting early, while holding two cards on your own turn, counts
      if (this.isTurn(pid) && this.hand(pid).length === 2 && !this.preCalled.has(pid)) {
        this.preCalled.add(pid);
        const pl = this.p(pid);
        if (pl && !pl.isBot) this.h.sendTo(pid, this.hand(pid));
      }
      return;
    }
    if (this.kwakTimer) clearTimeout(this.kwakTimer);
    this.kwakTimer = null;
    this.t.kwak = undefined;
    if (pid === k.playerId) {
      this.h.emit({ kind: "kwak", playerId: pid });
      return;
    }
    // caught! two cards for the forgetful one
    this.hand(k.playerId).push(...this.take(2));
    this.sync();
    this.h.emit({ kind: "kwak", playerId: k.playerId, by: pid });
  }
  hasPreCalled(pid: string) {
    return this.preCalled.has(pid);
  }

  // ---------------------------------------------------------------- end
  private win(pid: string) {
    this.over = true;
    this.stop();
    this.h.clearBots();
    const t = this.t;
    t.points = Object.fromEntries(this.s.players.map((x) => [x.id, this.hand(x.id).reduce((a, c) => a + cardPoints(c), 0)]));
    this.s.winnerIds = [pid];
    this.sync();
    this.h.setPhase("final");
    this.h.emit({ kind: "win", playerId: pid });
    this.h.schedule(5200, () => {
      this.h.setPhase("end");
      this.h.emit({ kind: "none" });
    });
  }

  // ---------------------------------------------------------------- bots (and auto-play)
  private bestColor(hand: Card[]): CardColor {
    const n: Record<string, number> = {};
    for (const c of hand) if (c.color) n[c.color] = (n[c.color] ?? 0) + 1 + (c.kind !== "num" ? 0.5 : 0);
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return (best?.[0] as CardColor) ?? COLOR_IDS[rand(0, 3)];
  }

  private botMove(pid: string) {
    if (!this.isTurn(pid)) return;
    const t = this.t;
    const hand = this.hand(pid);
    if (t.drawn) {
      const c = hand.find((x) => x.id === t.drawn!.cardId);
      if (c && canPlay(c, t)) return this.play(pid, c.id, this.bestColor(hand.filter((x) => x !== c)));
      return this.keep(pid);
    }
    const legal = hand.filter((c) => canPlay(c, t));
    if (!legal.length) return t.pendingDraw > 0 ? this.takePending(pid) : this.draw(pid);
    const next = this.nextId(1);
    const nextLeft = this.hand(next).length;
    const fewest = Math.min(...this.s.players.filter((x) => x.id !== pid).map((x) => this.hand(x.id).length));
    const score = (c: Card) => {
      let v = 0;
      if (c.kind === "num") v = 10 + (c.n ?? 0) * 0.3;
      if (c.kind === "skip" || c.kind === "draw2") v = nextLeft <= 3 ? 30 : 12;
      if (c.kind === "rev") v = 11;
      if (c.kind === "wild") v = 3;
      if (c.kind === "wild4") v = nextLeft <= 2 ? 28 : 1;
      if (c.kind === "swap") v = fewest + 2 < hand.length ? 40 : -5;
      if (c.color === t.color) v += 2;
      return v + Math.random();
    };
    const pickCard = legal.sort((a, b) => score(b) - score(a))[0];
    if (hand.length === 2 && Math.random() < 0.82) this.preCalled.add(pid);
    const rest = hand.filter((x) => x !== pickCard);
    this.play(pid, pickCard.id, this.bestColor(rest));
  }
}
