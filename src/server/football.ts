import { CLUB, isClubChar } from "../shared/football/club";
import { FbEngine, mulberry32 } from "../shared/football/engine";
import { FB_MODES, type FbInput, type FbPlayer, type FbState, type FbTeam } from "../shared/football/types";
import type { PoolShot } from "../shared/pool/types";
import type { Anim } from "../shared/types";
import type { GameRunner, RunnerHost } from "./runner";

/** Test-only knobs (tools/football-sim.ts): run the match `speed` times faster than real time (engine steps per
 *  tick and every pause scale together; frames still go out ~15 a second) and/or shorten the halves. Not a mode. */
export const FB_TEST = { speed: 1, halfSeconds: 0 };

const TICK_MS = 1000 / 30;
/** people + lobby bots per team: 5 ducks, one of them is always the computer keeper */
const MAX_PEOPLE = 4;
const INTRO_MS = 3500;
const HALFTIME_MS = 6000;
const PENS_INTRO_MS = 3000;
const AFTER_PEN_MS = 2000;
const FINAL_MS = 4200;
const TEAM = ["الأزرق", "الأحمر"];
/** a phone resends its controls every 200 ms while something is held: older than this = let go (stick 0, buttons up) */
const STALE_INPUT_MS = 600;
/** consecutive failing ticks before the match is ended (the first error is logged) */
const MAX_BAD_TICKS = 30;
const ar = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);

/** كورة البط match runner: a 30 Hz loop around the engine (src/shared/football/engine.ts), frames ~15 a second,
 *  FbState in GameState.football whenever the stage, score or clock changes. Flow: intro (teams banner) ->
 *  half 1 -> half time ("tile" phase, ends swap) -> half 2 -> [penalties when a two-half match is level] ->
 *  final -> end. GameState.sport is filled too (total = each player's team goals) for the pad, end screen and win record.
 *
 *  Roster rule: each team is its people and lobby bots (GameState.fbTeams) plus computer ducks up to 5, one of
 *  them the keeper. At most 4 room players per team (the keeper is always the computer): extras move to the other
 *  team (lobby bots first, then whoever joined last); if both teams are full (more than 8 players) the rest sit out. */
export class FootballGame implements GameRunner {
  private eng: FbEngine | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tick = 0;
  private last = 0;
  private acc = 0;
  private over = true;
  private goalSeq = 0;
  private engStage = "";
  private halfDone = false;
  private penWait = false;
  private teamOf = new Map<string, FbTeam>();
  /** per person: when the last fb:input arrived, and whether it is still holding something */
  private lastInput = new Map<string, { at: number; held: boolean }>();
  private badTicks = 0;
  private logged = false;
  private rng: () => number = Math.random;

  constructor(private h: RunnerHost) {}

  private get s() {
    return this.h.state;
  }
  private get f(): FbState {
    return this.s.football!;
  }
  private get speed() {
    return Math.max(1, Math.round(FB_TEST.speed));
  }
  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms / this.speed));
  }
  private emit(anim?: Anim) {
    if (this.eng && this.s.football) this.f.control = this.eng.control();
    this.h.emit(anim);
  }

  start() {
    this.stop();
    this.over = false;
    const s = this.s;
    const mode = FB_MODES.find((m) => m.id === s.course) ?? FB_MODES[0];
    const halfSeconds = FB_TEST.halfSeconds > 0 ? FB_TEST.halfSeconds : mode.halfSeconds;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    const roster = this.buildRoster();
    // a computer-only team playing against people is a notch easier ("normal" arcade difficulty); people against
    // people, or the computer against itself, stay even
    const humanTeam = [0, 1].map((t) => roster.some((p) => p.team === t && p.pid && !s.players.find((x) => x.id === p.pid)?.isBot));
    const easier = (t: number) => humanTeam[1 - t] && !humanTeam[t];
    const skills = roster.map((p) => (p.gk ? 0.55 : 0.5) + this.rng() * 0.2 - (easier(p.team) && !p.gk ? 0.1 : 0));
    const eng = new FbEngine(roster, { seed, halfSeconds, skill: (p) => skills[p.slot] });
    // development: the debug view (?fbdebug) reads the engine when the match runs in this browser (solo play)
    const g = globalThis as unknown as { location?: { search: string }; __fbEngine?: FbEngine };
    if (g.location && g.location.search.includes("fbdebug")) g.__fbEngine = eng;
    this.eng = eng;
    for (const p of roster) {
      const pl = p.pid ? s.players.find((x) => x.id === p.pid) : undefined;
      if (pl && !pl.isBot) {
        eng.addPerson(pl.id, p.team, p.slot);
        eng.setActive(pl.id, pl.connected);
      }
    }
    this.goalSeq = 0;
    this.lastInput.clear();
    this.badTicks = 0;
    this.logged = false;
    this.engStage = "";
    this.halfDone = false;
    this.penWait = false;
    this.tick = 0;
    s.football = {
      mode: mode.id, halves: mode.halves, halfSeconds, half: 1, clock: 0, clockAt: Date.now(), running: false,
      score: [0, 0], roster, stage: "kickoff", kickoff: 0, control: eng.control(),
    };
    s.sport = { id: "football", round: 0, rounds: mode.halves, lanes: {}, cards: {}, total: {}, busyUntil: {}, open: [], better: "high" };
    this.updateTotals();
    s.winnerIds = undefined;
    s.table = undefined;
    s.order = s.players.map((p) => p.id);
    s.turnIdx = 0;
    s.round = 1;
    eng.idle();
    this.h.setPhase("intro", INTRO_MS / this.speed);
    this.emit({ kind: "banner", title: "كورة البط", text: this.teamsText() });
    this.later(INTRO_MS, () => this.beginHalf(1));
    // a fine interval with an accumulator: timers on some systems only fire every ~15.6 ms, which would make a
    // plain 33 ms interval run at ~21-32 Hz; this keeps exactly 30 ticks (15 frames) a second on average
    this.last = performance.now();
    this.acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      if (this.paused) {
        this.last = now;
        return;
      }
      this.acc = Math.min(this.acc + now - this.last, 5 * TICK_MS);
      this.last = now;
      while (this.acc >= TICK_MS && this.loop) {
        this.acc -= TICK_MS;
        this.onTick();
      }
    }, 8);
  }

  /** only the one person in a match against the computer can pause it, and only in open play */
  private setPause(pid: string, on: boolean) {
    if (on === this.paused || !this.eng) return;
    const people = this.s.players.filter((x) => !x.isBot);
    if (on && (people.length !== 1 || people[0].id !== pid || this.eng.stage !== "play")) return;
    this.paused = on;
    if (!on) {
      // straight back into it: no catching up on the paused time
      this.last = performance.now();
      this.acc = 0;
    }
    // the clocks on every screen stop / start with it
    this.syncClock();
    this.emit();
  }

  /** stop the loop and every timer, and drop the match (late inputs after a restart do nothing) */
  stop() {
    this.paused = false;
    this.over = true;
    this.eng = null;
    this.stopTimers();
  }
  private stopTimers() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** host skip: during the intro / half time the next half starts now; in play the whistle ends the half now;
   *  in a shoot-out it is settled right away */
  timeUp() {
    if (this.over || !this.eng || !this.s.football) return;
    const st = this.f.stage;
    if (this.s.phase === "intro" || st === "halftime") {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      return this.beginHalf(this.s.phase === "intro" ? 1 : 2);
    }
    if (st === "pens") return this.settlePens();
    if (st === "kickoff" || st === "play" || st === "goal") {
      this.eng.endHalf();
      this.afterStep();
    }
  }

  /** a phone dropped: its duck is played by the computer (it comes back on its own when the phone reconnects) */
  playFor(pid: string) {
    this.eng?.setActive(pid, false);
  }
  shoot(_pid: string, _shot: PoolShot) {}
  /** solo play paused by the person (P / Esc / the pause button): no ticks, no clock */
  paused = false;
  input(pid: string, input: FbInput) {
    if (this.over || !this.eng) return;
    this.setPause(pid, !!input.p);
    if (this.paused) return;
    this.lastInput.set(pid, { at: Date.now(), held: input.a || input.b || !!input.s || !!input.k || input.x !== 0 || input.y !== 0 });
    this.eng.input(pid, input);
  }

  // ---------------------------------------------------------------- roster
  private buildRoster(): FbPlayer[] {
    const s = this.s;
    const teams: string[][] = [[], []];
    for (const pl of s.players) {
      const t = s.fbTeams?.[pl.id];
      teams[t === 0 || t === 1 ? t : teams[0].length <= teams[1].length ? 0 : 1].push(pl.id);
    }
    const isBot = (id: string) => !!s.players.find((p) => p.id === id)?.isBot;
    for (const t of [0, 1]) {
      while (teams[t].length > MAX_PEOPLE) {
        let idx = -1;
        for (let i = teams[t].length - 1; i >= 0; i--) if (isBot(teams[t][i])) {
          idx = i;
          break;
        }
        if (idx < 0) idx = teams[t].length - 1;
        const [id] = teams[t].splice(idx, 1);
        if (teams[1 - t].length < MAX_PEOPLE) teams[1 - t].push(id);
      }
    }
    this.teamOf.clear();
    const used = new Set<string>();
    const charOf = new Map<string, string>();
    for (const t of [0, 1]) for (const id of teams[t]) {
      this.teamOf.set(id, t as FbTeam);
      const c = s.fbChars?.[id];
      if (c && isClubChar(c) && !used.has(c)) {
        used.add(c);
        charOf.set(id, c);
      }
    }
    const free = CLUB.filter((c) => !used.has(c.id));
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    const nextFree = () => free.pop() ?? CLUB[Math.floor(this.rng() * CLUB.length)];
    for (const t of [0, 1]) for (const id of teams[t]) if (!charOf.has(id)) charOf.set(id, nextFree().id);
    const roster: FbPlayer[] = [];
    for (const t of [0, 1] as FbTeam[]) {
      const k = nextFree();
      roster.push({ slot: roster.length, team: t, char: k.id, name: k.name, gk: true });
      for (const id of teams[t]) {
        const pl = s.players.find((p) => p.id === id)!;
        roster.push({ slot: roster.length, team: t, char: charOf.get(id)!, name: pl.name, gk: false, pid: id });
      }
      for (let n = teams[t].length; n < 4; n++) {
        const c = nextFree();
        roster.push({ slot: roster.length, team: t, char: c.id, name: c.name, gk: false });
      }
    }
    return roster;
  }

  private teamsText() {
    const names = (t: FbTeam) => this.s.players.filter((p) => this.teamOf.get(p.id) === t).map((p) => p.name).join("، ") || "الكمبيوتر";
    return `${TEAM[0]}: ${names(0)} ضد ${TEAM[1]}: ${names(1)}`;
  }

  private updateTotals() {
    const sp = this.s.sport;
    if (!sp || !this.s.football) return;
    for (const p of this.s.players) {
      const t = this.teamOf.get(p.id);
      sp.total[p.id] = t === undefined ? 0 : this.f.score[t];
    }
  }

  // ---------------------------------------------------------------- loop
  private onTick() {
    const eng = this.eng;
    if (!eng) return;
    try {
      const now = Date.now();
      for (const p of eng.people.values()) {
        // people whose phone dropped (or came back): the computer plays a dropped phone's duck
        const pl = this.s.players.find((x) => x.id === p.pid);
        eng.setActive(p.pid, !!pl && pl.connected && !pl.isBot);
        // controls that stopped arriving count as let go
        const li = this.lastInput.get(p.pid);
        if (li?.held && now - li.at > STALE_INPUT_MS) {
          li.held = false;
          eng.input(p.pid, { x: 0, y: 0, a: false, b: false, s: false, k: false });
        }
      }
      for (let i = 0; i < this.speed; i++) {
        eng.step();
        this.afterStep();
        if (this.eng !== eng) return;
      }
      if (++this.tick % 2 === 0) this.h.frame(eng.frame(now));
      this.badTicks = 0;
    } catch (err) {
      // one bad tick must never take the server down: log the first, keep going, end the match if it keeps failing
      if (!this.logged) {
        this.logged = true;
        console.error("football: tick failed", err);
      }
      if (++this.badTicks >= MAX_BAD_TICKS && !this.over) {
        try {
          const [a, b] = this.f.score;
          this.finish(a === b ? -1 : a > b ? 0 : 1);
        } catch {
          this.stop();
        }
      }
    }
  }

  private syncClock() {
    const eng = this.eng!;
    const f = this.f;
    f.clock = Math.round(Math.min(eng.clock, f.halfSeconds) * 100) / 100;
    f.clockAt = Date.now();
    f.running = eng.stage === "play" && !this.over && !this.paused;
    // the pad's timer: when this half ends if the clock keeps running (no timer while it is stopped)
    if (this.s.phase === "sport") this.s.phaseEndsAt = f.running ? Date.now() + ((f.halfSeconds - f.clock) * 1000) / this.speed : null;
  }

  private afterStep() {
    const eng = this.eng;
    if (!eng || !this.s.football) return;
    const f = this.f;
    if (eng.goalSeq !== this.goalSeq) {
      this.goalSeq = eng.goalSeq;
      this.onGoal();
    }
    if (eng.stage !== this.engStage) {
      this.engStage = eng.stage;
      if ((eng.stage === "kickoff" || eng.stage === "play") && f.stage !== eng.stage) {
        f.stage = eng.stage;
        f.kickoff = eng.kickTeam;
        this.syncClock();
        this.emit();
      }
    }
    if (eng.halfOver && !this.halfDone && !this.over) {
      this.halfDone = true;
      this.endOfHalf();
    }
    if (this.penWait && eng.pen && eng.pen.result !== null) {
      this.penWait = false;
      this.penTaken(eng.pen.result);
    }
  }

  private beginHalf(half: 1 | 2) {
    if (this.over || !this.eng) return;
    const f = this.f;
    f.half = half;
    this.s.sport!.round = half - 1;
    this.s.round = half;
    this.halfDone = false;
    this.eng.setHalf(half);
    const kt: FbTeam = half === 1 ? 0 : 1;
    f.kickoff = kt;
    f.stage = "kickoff";
    this.eng.kickoff(kt);
    this.engStage = "kickoff";
    this.h.setPhase("sport");
    this.syncClock();
    this.emit();
  }

  private onGoal() {
    const eng = this.eng!;
    const f = this.f;
    const g = eng.lastGoal!;
    f.score = [eng.score[0], eng.score[1]];
    f.lastGoal = { team: g.team, slot: g.slot, at: Date.now() };
    f.stage = "goal";
    this.engStage = eng.stage;
    this.updateTotals();
    this.syncClock();
    f.lastGoal = { team: g.team, slot: g.slot, at: Date.now(), speed: g.speed, kind: g.kind };
    const who = g.slot >= 0 ? f.roster[g.slot].name : "هدف عكسي";
    this.emit({ kind: "banner", title: "قووول!", text: `${who} ${g.team === 0 ? "للأزرق" : "للأحمر"}` });
  }

  private endOfHalf() {
    const eng = this.eng!;
    const f = this.f;
    eng.idle(f.half < f.halves ? { half: 2, kick: 1 } : null);
    this.engStage = "idle";
    const [a, b] = f.score;
    if (f.half < f.halves) {
      f.stage = "halftime";
      this.syncClock();
      this.h.setPhase("tile", HALFTIME_MS / this.speed);
      this.emit({ kind: "banner", title: "نهاية الشوط الأول", text: `${TEAM[0]} ${ar(a)} - ${ar(b)} ${TEAM[1]}` });
      this.later(HALFTIME_MS, () => this.beginHalf(2));
    } else if (f.halves === 2 && a === b) this.startPens();
    else this.finish(a === b ? -1 : a > b ? 0 : 1);
  }

  // ---------------------------------------------------------------- penalties
  private startPens() {
    const f = this.f;
    f.stage = "pens";
    f.pens = { kicks: [[], []], taker: 0, shooterSlot: -1, keeperSlot: -1 };
    this.syncClock();
    this.emit({ kind: "banner", title: "ركلات الترجيح", text: `${ar(5)} لكل فريق، وبعدها اللي يضيّع يطلع` });
    this.later(PENS_INTRO_MS, () => this.nextPen());
  }

  private nextPen() {
    if (this.over || !this.eng) return;
    const f = this.f;
    const pens = f.pens!;
    const t: FbTeam = pens.kicks[0].length <= pens.kicks[1].length ? 0 : 1;
    const takers = f.roster.filter((p) => p.team === t && !p.gk);
    const shooter = takers[pens.kicks[t].length % takers.length].slot;
    const keeper = f.roster.find((p) => p.team !== t && p.gk)!.slot;
    pens.taker = t;
    pens.shooterSlot = shooter;
    pens.keeperSlot = keeper;
    f.kickoff = t;
    this.eng.startPen(shooter, keeper, 1);
    this.engStage = "pen";
    this.penWait = true;
    this.emit();
  }

  private penTaken(scored: boolean) {
    const f = this.f;
    const pens = f.pens!;
    pens.kicks[pens.taker].push(scored);
    if (scored) {
      const gi = this.eng?.goalInfo;
      f.lastGoal = { team: pens.taker, slot: pens.shooterSlot, at: Date.now(), speed: gi?.speed, kind: "pen" };
    }
    const w = penWinner(pens.kicks);
    this.emit({ kind: "banner", title: scored ? "قووول!" : "ضاعت!", text: f.roster[pens.shooterSlot].name });
    this.later(AFTER_PEN_MS, () => (w === null ? this.nextPen() : this.finish(w)));
  }

  /** host skip during the shoot-out: the remaining kicks are decided at once (72% each) until there is a winner */
  private settlePens() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.penWait = false;
    const pens = this.f.pens!;
    let w = penWinner(pens.kicks);
    for (let i = 0; w === null && i < 200; i++) {
      const t: FbTeam = pens.kicks[0].length <= pens.kicks[1].length ? 0 : 1;
      pens.kicks[t].push(this.rng() < 0.72);
      w = penWinner(pens.kicks);
    }
    this.finish(w ?? 0);
  }

  // ---------------------------------------------------------------- the end
  /** full time. A draw (a level one-half match): result -1 and nobody is a winner (winnerIds = []). A winning team
   *  with no room players (the computer): result = that team, winnerIds = []. */
  private finish(win: FbTeam | -1) {
    if (this.over) return;
    this.over = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const s = this.s;
    const f = this.f;
    f.stage = "over";
    f.result = win;
    this.eng?.finish(win);
    this.engStage = "idle";
    this.syncClock();
    this.updateTotals();
    s.winnerIds = win < 0 ? [] : s.players.filter((p) => this.teamOf.get(p.id) === win).map((p) => p.id);
    this.h.setPhase("final");
    this.emit({ kind: "win", playerId: s.winnerIds[0] ?? "" });
    this.timers.push(
      setTimeout(() => {
        this.stopTimers();
        this.h.setPhase("end");
        this.emit({ kind: "none" });
        this.eng = null;
      }, FINAL_MS / this.speed),
    );
  }
}

/** shoot-out winner so far: 5 kicks each (stops early when one side can't catch up), then sudden death */
export function penWinner(k: [boolean[], boolean[]]): FbTeam | null {
  const goals = k.map((x) => x.filter(Boolean).length);
  const n = k.map((x) => x.length);
  if (n[0] <= 5 && n[1] <= 5) {
    if (goals[0] + (5 - n[0]) < goals[1]) return 1;
    if (goals[1] + (5 - n[1]) < goals[0]) return 0;
  }
  if (n[0] >= 5 && n[0] === n[1] && goals[0] !== goals[1]) return goals[0] > goals[1] ? 0 : 1;
  return null;
}
