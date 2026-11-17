import type { FbInput } from "../shared/football/types";
import { simulate } from "../shared/pool/physics";
import { TURN_MS, applyShot, ballsForShot, ballsLeft, botShot, cleanShot, newTable, passTurn } from "../shared/pool/rules";
import type { PoolShot, PoolTable } from "../shared/pool/types";
import type { SportState } from "../shared/sports/types";
import type { GameRunner, RunnerHost } from "./runner";

/** بلياردو البط runner: one table, players take turns (owner's rule: whoever pots the most balls wins).
 *  - pot something → shoot again; pot nothing → next player; pot the white → next player, white in hand.
 *  - balls potted on the same shot as the white still count for the shooter.
 *  - every turn has a clock (TURN_MS); when it runs out (or the host skips) the turn passes.
 *  - the server runs the physics and sends the replay (`shot` anim); the next turn opens when it has played.
 *  GameState.sport: lanes.table = the PoolTable, total = balls potted, open = [whose turn] (empty while a shot
 *  plays), busyUntil[shooter] = when the replay ends. */

/** after a replay: a beat to read "دخلت!" before the next turn */
const AFTER_SHOT_MS = 1400;
/** a game that somehow never ends (balls stuck) is called after this many shots */
const MAX_SHOTS = 400;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class PoolGame implements GameRunner {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private over = true;
  /** between turns (a shot playing back, or the turn being handed over): no shots, no skips */
  private changing = false;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private skill = new Map<string, number>();

  constructor(private h: RunnerHost) {}

  private get s() {
    return this.h.state;
  }
  private get sp(): SportState {
    return this.s.sport!;
  }
  private get table(): PoolTable {
    return this.sp.lanes.table as PoolTable;
  }
  private set table(t: PoolTable) {
    this.sp.lanes.table = t;
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  start() {
    this.stop();
    this.over = false;
    this.changing = true;
    const s = this.s;
    s.order = s.players.map((p) => p.id);
    s.turnIdx = 0;
    s.round = 1;
    s.winnerIds = undefined;
    s.table = undefined;
    this.skill.clear();
    for (const p of s.players) this.skill.set(p.id, rand(0.5, 0.82));
    const table = newTable(s.order);
    s.sport = { id: "pool", round: 0, rounds: 1, lanes: { table }, cards: {}, total: {}, busyUntil: {}, open: [], better: "high" };
    this.refreshTotals();
    this.h.setPhase("intro");
    this.h.emit({ kind: "banner", title: "بلياردو البط", text: "اللي يدخّل كرات أكثر يفوز. دخّلت؟ تكمل. البيضا طاحت؟ الدور للي بعدك والبيضا بيده" });
    this.introTimer = this.later(4200, () => this.beginTurn());
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.turnTimer = this.botTimer = this.introTimer = null;
  }

  private refreshTotals() {
    const t = this.table;
    for (const p of this.s.players) this.sp.total[p.id] = t.potted[p.id]?.length ?? 0;
  }

  private player(pid: string) {
    return this.s.players.find((p) => p.id === pid);
  }

  /** Open the turn of `table.shooter`: start the clock, let the computer think if it is theirs. */
  private beginTurn() {
    if (this.over || !this.s.sport) return;
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.timers.delete(this.introTimer);
      this.introTimer = null;
    }
    const t = this.table;
    if (!this.player(t.shooter)) t.shooter = t.order.find((id) => this.player(id)) ?? t.shooter;
    this.changing = false;
    this.sp.open = [t.shooter];
    this.s.turnIdx = Math.max(0, this.s.order.indexOf(t.shooter));
    this.h.setPhase("sport", TURN_MS);
    this.h.emit();
    this.clearTurn();
    this.turnTimer = this.later(TURN_MS, () => this.timeUp());
    const p = this.player(t.shooter);
    if (p && (p.isBot || !p.connected)) this.botTurn(p.id, p.isBot ? rand(1400, 2800) : 2500);
  }

  private clearTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.turnTimer) this.timers.delete(this.turnTimer);
    if (this.botTimer) this.timers.delete(this.botTimer);
    this.turnTimer = this.botTimer = null;
  }

  private botTurn(pid: string, ms: number) {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.timers.delete(this.botTimer);
    }
    this.botTimer = this.later(ms, () => {
      this.botTimer = null;
      if (this.over || this.changing || this.s.phase !== "sport" || this.table.shooter !== pid) return;
      const p = this.player(pid);
      if (p && !p.isBot && p.connected) return; // the phone came back in time
      this.shoot(pid, botShot(this.table, this.skill.get(pid) ?? 0.65));
    });
  }

  /** The shooter's shot (from the phone, or the computer). Anything malformed is cleaned up, never thrown. */
  shoot(pid: string, raw: PoolShot) {
    if (this.over || this.changing || this.s.phase !== "sport" || !this.s.sport) return;
    const t = this.table;
    if (t.shooter !== pid || !this.sp.open.includes(pid)) return;
    const shot = cleanShot(raw);
    const balls = ballsForShot(t, shot);
    const res = simulate(balls, shot);
    const out = applyShot({ ...t, balls }, pid, res);
    if (out.table.shots >= MAX_SHOTS) for (const b of out.table.balls) if (b.n !== 0) b.in = true;
    this.clearTurn();
    this.changing = true;
    this.table = out.table;
    this.refreshTotals();
    // whose turn it is next is known already (their phone waits for the replay before it lets them aim)
    this.sp.open = [out.table.shooter];
    this.sp.busyUntil = { [pid]: Date.now() + res.ms };
    res.replay.label = out.label;
    this.h.setPhase("sport", null);
    this.h.emit({ kind: "shot", playerId: pid, replay: res.replay });
    this.later(res.ms + AFTER_SHOT_MS, () => {
      if (this.over) return;
      if (ballsLeft(this.table) === 0) this.finish();
      else this.beginTurn();
    });
  }

  /** The clock ran out or the host skipped: the turn passes. Ignored while a shot plays or a turn is being handed
   *  over (so two quick skips only pass one turn). During the intro it starts the first turn right away. */
  timeUp() {
    if (this.over || !this.s.sport) return;
    if (this.s.phase === "intro" && this.introTimer) return this.beginTurn();
    if (this.changing || this.s.phase !== "sport") return;
    const pid = this.table.shooter;
    this.clearTurn();
    this.changing = true;
    this.table = passTurn(this.table, pid);
    this.sp.open = [];
    const next = this.player(this.table.shooter);
    this.h.emit({ kind: "banner", title: "خلص الوقت!", text: next ? `الدور لـ ${next.name}` : "" });
    this.later(1200, () => this.beginTurn());
  }

  /** A phone dropped mid-game: if it is their turn the computer takes it (and every later one while gone). */
  playFor(pid: string) {
    if (this.over || this.changing || this.s.phase !== "sport" || this.table?.shooter !== pid) return;
    this.botTurn(pid, 3000);
  }

  private finish() {
    this.over = true;
    this.stop();
    const sp = this.sp;
    this.refreshTotals();
    sp.open = [];
    const best = Math.max(...this.s.players.map((p) => sp.total[p.id] ?? 0));
    this.s.winnerIds = this.s.players.filter((p) => (sp.total[p.id] ?? 0) === best).map((p) => p.id);
    this.h.setPhase("final");
    this.h.emit({ kind: "win", playerId: this.s.winnerIds[0] });
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.h.setPhase("end");
      this.h.emit({ kind: "none" });
    }, 4200);
    this.timers.add(t);
  }

  input(_pid: string, _input: FbInput) {}
}
