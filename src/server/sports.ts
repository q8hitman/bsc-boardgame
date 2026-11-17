import { SPORTS, type SportRules } from "../shared/sports";
import type { Shot, SportId, SportState } from "../shared/sports/types";
import type { Anim, GameState } from "../shared/types";

/** What a sports game needs from the Room (same shape as the card game's host). */
export interface SportHost {
  state: GameState;
  emit(anim?: Anim): void;
  schedule(ms: number, fn: () => void): void;
  botLater(ms: number, fn: () => void): void;
  clearBots(): void;
  setPhase(phase: GameState["phase"], timeoutMs?: number | null): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const BETWEEN_ROUNDS_MS = 2600;

/** Bowling / mini-golf: every player shoots at the same time on their own lane. The server runs the physics
 *  (the sport's `shoot`) and sends a replay; rounds end when everyone is done or the clock runs out. */
export class SportGame {
  private rules!: SportRules<unknown>;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private over = true;

  constructor(private h: SportHost) {}

  private get s() {
    return this.h.state;
  }
  private get sp() {
    return this.s.sport!;
  }

  start(id: SportId) {
    this.stop();
    this.over = false;
    this.rules = SPORTS[id] as SportRules<unknown>;
    const s = this.s;
    const courses = this.rules.courses;
    const course = courses ? (courses.find((c) => c.id === s.course) ?? courses[0]).id : undefined;
    s.order = s.players.map((x) => x.id);
    s.turnIdx = 0;
    s.round = 1;
    s.winnerIds = undefined;
    s.table = undefined;
    const rounds = this.rules.rounds(course);
    s.sport = { id, round: 0, rounds, course, lanes: {}, cards: {}, total: {}, busyUntil: {}, open: [], better: this.rules.better };
    for (const p of s.players) {
      this.sp.lanes[p.id] = this.rules.startRound(0, undefined, course);
      this.refreshCard(p.id);
    }
    this.h.setPhase("intro");
    this.h.emit({ kind: "banner", title: this.rules.name, text: this.introText() });
    this.h.schedule(3800, () => this.beginRound(0));
  }

  stop() {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.roundTimer = this.endTimer = null;
    this.botTimers.forEach(clearTimeout);
    this.botTimers.clear();
  }

  private introText() {
    const n = String(this.sp.rounds).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
    if (this.rules.id === "bowling") return `${n} فريمات. كلكم ترمون بنفس الوقت، وأعلى مجموع يفوز`;
    if (this.rules.id === "hoops") return `${n} جولات رمي. كلكم ترمون بنفس الوقت، وأعلى نقاط تفوز`;
    return `${n} حفر. كلكم تضربون بنفس الوقت، وأقل ضربات يفوز`;
  }

  private refreshCard(pid: string) {
    const c = this.rules.card(this.sp.lanes[pid], this.sp.rounds);
    this.sp.cards[pid] = c.cards;
    this.sp.total[pid] = c.total;
  }

  private beginRound(round: number) {
    if (this.over) return;
    const sp = this.sp;
    sp.round = round;
    this.s.round = round + 1;
    sp.busyUntil = {};
    if (round > 0) for (const p of this.s.players) sp.lanes[p.id] = this.rules.startRound(round, sp.lanes[p.id], sp.course);
    sp.open = this.s.players.filter((p) => this.rules.canShoot(sp.lanes[p.id])).map((p) => p.id);
    this.h.setPhase("sport", this.rules.roundSeconds * 1000);
    this.h.emit({ kind: "sportRound", round });
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = setTimeout(() => this.timeUp(), this.rules.roundSeconds * 1000);
    for (const p of this.s.players) if (p.isBot || !p.connected) this.botTurn(p.id, rand(1600, 3600));
  }

  /** A phone (or the computer) shoots. Ignored while that player's last shot is still playing. */
  shoot(pid: string, shot: Shot) {
    if (this.over || this.s.phase !== "sport" || !this.s.sport) return;
    const sp = this.sp;
    const lane = sp.lanes[pid];
    if (!lane || !this.rules.canShoot(lane)) return;
    if ((sp.busyUntil[pid] ?? 0) > Date.now()) return;
    const clean: Shot = {
      aim: Number.isFinite(shot?.aim) ? shot.aim : 0,
      power: Math.max(0, Math.min(1, Number(shot?.power) || 0)),
      spin: Math.max(-1, Math.min(1, Number(shot?.spin) || 0)),
      start: Math.max(-1, Math.min(1, Number(shot?.start) || 0)),
    };
    const res = this.rules.shoot(lane, clean, sp.round, sp.course);
    sp.lanes[pid] = res.lane;
    sp.busyUntil[pid] = Date.now() + res.ms;
    this.refreshCard(pid);
    sp.open = this.s.players.filter((p) => this.rules.canShoot(sp.lanes[p.id])).map((p) => p.id);
    this.h.emit({ kind: "shot", playerId: pid, replay: res.replay });
    const p = this.s.players.find((x) => x.id === pid);
    if (p && (p.isBot || !p.connected) && this.rules.canShoot(res.lane)) this.botTurn(pid, res.ms + rand(700, 1800));
    if (!sp.open.length) this.finishRoundSoon();
  }

  private botTurn(pid: string, ms: number) {
    clearTimeout(this.botTimers.get(pid));
    this.botTimers.set(pid, setTimeout(() => {
      this.botTimers.delete(pid);
      const lane = this.sp?.lanes[pid];
      if (this.over || !lane || this.s.phase !== "sport" || !this.rules.canShoot(lane)) return;
      this.shoot(pid, this.rules.botShot(lane, this.sp.round, 0.55 + Math.random() * 0.35, this.sp.course));
    }, ms));
  }

  /** A phone dropped mid-round: the computer finishes its round. */
  playFor(pid: string) {
    if (!this.over && this.s.phase === "sport") this.botTurn(pid, 3000);
  }

  /** Clock ran out (or the host skipped): whoever still has shots left misses them, and the round ends. */
  timeUp() {
    if (this.over || this.s.phase !== "sport" || !this.s.sport) return;
    const sp = this.sp;
    for (const pid of [...sp.open]) {
      clearTimeout(this.botTimers.get(pid));
      this.botTimers.delete(pid);
      sp.lanes[pid] = this.rules.forfeit(sp.lanes[pid]);
      this.refreshCard(pid);
    }
    sp.open = [];
    this.h.emit({ kind: "banner", title: "خلص الوقت!", text: "اللي ما رمى تنحسب عليه" });
    this.finishRoundSoon(0);
  }

  private finishRoundSoon(extra = 900) {
    if (this.endTimer) return;
    const sp = this.sp;
    const wait = Math.max(0, ...Object.values(sp.busyUntil).map((t) => t - Date.now())) + extra;
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = null;
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      if (this.over) return;
      if (sp.round + 1 < sp.rounds) {
        this.h.setPhase("tile");
        const name = { bowling: "فريم", golf: "الحفرة", hoops: "الجولة" }[this.rules.id];
        this.h.emit({ kind: "banner", title: `${name} ${String(sp.round + 2).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d])}`, text: this.leaderText() });
        this.endTimer = setTimeout(() => {
          this.endTimer = null;
          this.beginRound(sp.round + 1);
        }, BETWEEN_ROUNDS_MS);
      } else this.finish();
    }, wait);
  }

  private leaderText() {
    const sp = this.sp;
    const best = [...this.s.players].sort((a, b) => (sp.better === "high" ? -1 : 1) * ((sp.total[a.id] ?? 0) - (sp.total[b.id] ?? 0)))[0];
    return best ? `${best.name} متصدر` : "";
  }

  private finish() {
    this.over = true;
    this.stop();
    const sp = this.sp;
    const vals = this.s.players.map((p) => sp.total[p.id] ?? 0);
    const best = sp.better === "high" ? Math.max(...vals) : Math.min(...vals);
    this.s.winnerIds = this.s.players.filter((p) => (sp.total[p.id] ?? 0) === best).map((p) => p.id);
    this.h.setPhase("final");
    this.h.emit({ kind: "win", playerId: this.s.winnerIds[0] });
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.h.setPhase("end");
      this.h.emit({ kind: "none" });
    }, 4200);
  }
}
