import { CLUB } from "../../../shared/football/club";
import { FbAction, FbEvent, PITCH, type FbFrame, type FbInput, type FbPlayer, type FbState, type FbTeam } from "../../../shared/football/types";

/** DEV ONLY (dev.html): a toy match that produces plausible FbState + FbFrames so the view can be built and
 *  screenshotted without the real engine. Not imported by the game. */

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  act: number;
  actUntil: number;
  home: [number, number];
  cool: number;
}

const HL = PITCH.length / 2;
const HW = PITCH.width / 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class FakeMatch {
  st: FbState;
  private ps: P[] = [];
  private ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: -1 };
  private ref = { x: 0, y: -HW + 2 };
  private ev: [number, number][] = [];
  private t = 0;
  private stageUntil = 0;
  private dir: [number, number] = [1, -1];
  private inputs = new Map<string, FbInput & { bAt: number; prevA: boolean; prevB: boolean; at: number }>();
  control: Record<string, number> = {};
  changed = true;
  private ownerSince = 0;
  private decideAt = 0;

  constructor(
    private humans: { pid: string; name: string; team: FbTeam; char: string }[],
    opts: { halves?: 1 | 2; halfSeconds?: number; stage?: string } = {},
  ) {
    const roster: FbPlayer[] = [];
    const used = new Set(humans.map((h) => h.char));
    const pool = CLUB.filter((c) => !used.has(c.id));
    for (const team of [0, 1] as FbTeam[]) {
      const hs = humans.filter((h) => h.team === team);
      for (let i = 0; i < 5; i++) {
        const slot = team * 5 + i;
        const h = i > 0 ? hs[i - 1] : undefined;
        const c = h ? { id: h.char, name: h.name } : pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        roster.push({ slot, team, char: c.id, name: h?.name ?? c.name, gk: i === 0, pid: h?.pid });
      }
    }
    this.st = {
      mode: "quick",
      halves: opts.halves ?? 2,
      halfSeconds: opts.halfSeconds ?? 180,
      half: 1,
      clock: 0,
      clockAt: Date.now(),
      running: false,
      score: [0, 0],
      roster,
      stage: "kickoff",
      kickoff: 0,
      control: {},
    };
    this.ps = roster.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, face: 1, act: 0, actUntil: 0, home: [0, 0], cool: 0 }));
    this.resetKickoff(0);
    this.stageUntil = 2.5;
    if (opts.stage === "pens") {
      this.st.stage = "pens";
      this.st.pens = { kicks: [[true, false, true], [true, true]], taker: 1, shooterSlot: 7, keeperSlot: 0 };
      this.stageUntil = 1e9;
    }
    if (opts.stage === "halftime" || opts.stage === "over") {
      this.st.stage = opts.stage as "halftime" | "over";
      this.st.score = [2, 1];
      this.stageUntil = 1e9;
    }
  }

  private homes(team: FbTeam): [number, number][] {
    const s = this.dir[team];
    return [
      [-30.5 * s, 0],
      [-17 * s, -7],
      [-17 * s, 7],
      [-5 * s, -9],
      [-4 * s, 8],
    ];
  }

  private resetKickoff(team: FbTeam) {
    this.st.kickoff = team;
    for (const t of [0, 1] as FbTeam[]) {
      const hs = this.homes(t);
      for (let i = 0; i < 5; i++) {
        const p = this.ps[t * 5 + i];
        p.home = hs[i];
        p.x = hs[i][0];
        p.y = hs[i][1];
        p.vx = p.vy = 0;
        p.act = FbAction.Idle;
        p.face = this.dir[t];
      }
    }
    const k = this.ps[team * 5 + 4];
    k.x = -0.8 * this.dir[team];
    k.y = 0;
    Object.assign(this.ball, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: -1 });
  }

  input(pid: string, i: FbInput) {
    const prev = this.inputs.get(pid);
    this.inputs.set(pid, { ...i, at: this.t, bAt: i.b && !prev?.b ? this.t : prev?.bAt ?? 0, prevA: prev?.a ?? false, prevB: prev?.b ?? false });
  }

  private emit(k: number, s = -1) {
    this.ev.push([k, s]);
  }

  private kick(slot: number, tx: number, ty: number, speed: number, vz: number, kind: number) {
    const p = this.ps[slot];
    const b = this.ball;
    const d = Math.hypot(tx - b.x, ty - b.y) || 1;
    b.vx = ((tx - b.x) / d) * speed;
    b.vy = ((ty - b.y) / d) * speed;
    b.vz = vz;
    b.owner = -1;
    p.cool = 0.5;
    p.act = FbAction.Kick;
    p.actUntil = this.t + 0.25;
    this.emit(kind, slot);
    if (kind === FbEvent.Kick && speed >= 25) this.emit(FbEvent.Screamer, slot);
  }

  private nearest(team: FbTeam, x: number, y: number, field = true) {
    let best = -1;
    let bd = 1e9;
    for (let i = 0; i < 5; i++) {
      const s = team * 5 + i;
      if (field && i === 0) continue;
      const d = Math.hypot(this.ps[s].x - x, this.ps[s].y - y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  step(dt: number) {
    this.t += dt;
    const st = this.st;
    const b = this.ball;
    // stages
    if (st.stage !== "play") {
      this.stageUntil -= dt;
      if (this.stageUntil <= 0) {
        if (st.stage === "kickoff") {
          st.stage = "play";
          st.running = true;
          st.clockAt = Date.now();
          this.emit(FbEvent.Whistle);
          this.changed = true;
        } else if (st.stage === "goal") {
          st.stage = "kickoff";
          this.resetKickoff(st.lastGoal!.team === 0 ? 1 : 0);
          this.stageUntil = 2;
          this.changed = true;
        } else if (st.stage === "halftime") {
          st.half = 2;
          st.clock = 0;
          this.dir = [-1, 1];
          st.stage = "kickoff";
          this.resetKickoff(1);
          this.stageUntil = 2;
          this.changed = true;
        }
      }
    }
    if (st.running) {
      const clock = st.clock + (Date.now() - st.clockAt) / 1000;
      if (clock >= st.halfSeconds) {
        st.clock = st.halfSeconds;
        st.clockAt = Date.now();
        st.running = false;
        this.emit(FbEvent.Whistle);
        if (st.half === 1 && st.halves === 2) {
          st.stage = "halftime";
          this.stageUntil = 5;
        } else {
          st.stage = "over";
          st.result = st.score[0] === st.score[1] ? -1 : st.score[0] > st.score[1] ? 0 : 1;
          if (!st.lastGoal) st.lastGoal = { team: 0, slot: -1, at: 0 };
        }
        this.changed = true;
      }
    }
    const playing = st.stage === "play";
    // control: each human on their team's field duck nearest the ball (or kept while they hold the stick)
    for (const h of this.humans) {
      const cur = this.control[h.pid];
      const n = this.nearest(h.team, b.x, b.y);
      const inp = this.inputs.get(h.pid);
      const holding = inp && (inp.x || inp.y);
      if (cur === undefined || (!holding && cur !== n && b.owner !== cur && Math.random() < 0.05)) this.control[h.pid] = n;
      if (inp && inp.b && !inp.prevB && b.owner !== this.control[h.pid]) this.control[h.pid] = n;
    }
    st.control = this.control;
    const human = new Map<number, string>();
    // a person who has not touched the controls for a few seconds plays like the computer (dev page)
    for (const [pid, s] of Object.entries(this.control)) if (this.t - (this.inputs.get(pid)?.at ?? -99) < 4) human.set(s, pid);

    // players
    for (let s = 0; s < this.ps.length; s++) {
      const p = this.ps[s];
      const team = st.roster[s].team;
      const gk = st.roster[s].gk;
      const att = this.dir[team];
      p.cool = Math.max(0, p.cool - dt);
      if (p.actUntil > this.t && (p.act === FbAction.Fall || p.act === FbAction.Kneel || p.act === FbAction.Slide || p.act === FbAction.Dive || p.act === FbAction.Kick)) {
        if (p.act === FbAction.Slide || p.act === FbAction.Dive) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.94;
          p.vy *= 0.94;
        }
        continue;
      }
      let tx = p.x;
      let ty = p.y;
      let speed = 6.2;
      if (st.stage === "goal" || st.stage === "over") {
        // celebrations: the scorer sprints to the corner, team-mates huddle round, the others trudge away,
        // the beaten keeper stays down for a moment; at full time the winners jump about
        const g = st.lastGoal!;
        const won = st.stage === "over" ? st.result === team : g && g.team === team;
        const sc = g ? this.ps[g.slot >= 0 ? g.slot : 0] : p;
        let cx = tx;
        let cy = ty;
        let sp = 1.4;
        let act: number = FbAction.Run;
        if (st.stage === "over") {
          act = won ? FbAction.Celebrate : FbAction.Idle;
          sp = 0;
        } else if (won && g.slot === s) {
          cx = this.goalSide * (HL - 2.5);
          cy = (Math.sign(p.y) || 1) * (HW - 2.5);
          sp = 7.5;
          act = FbAction.Celebrate;
        } else if (won) {
          cx = sc.x - this.goalSide * 1.2;
          cy = sc.y + ((s % 3) - 1) * 1.1;
          sp = 6.5;
          act = Math.hypot(cx - p.x, cy - p.y) < 2.4 ? FbAction.Celebrate : FbAction.Run;
        } else if (gk && this.t - this.goalT < 1.6) {
          p.act = FbAction.Kneel;
          p.actUntil = this.goalT + 1.6;
          continue;
        } else {
          cx = p.home[0];
          cy = p.home[1];
        }
        const dx = cx - p.x;
        const dy = cy - p.y;
        const d = Math.hypot(dx, dy);
        const v = d > 0.3 ? Math.min(sp, d * 3) : 0;
        p.vx = d ? (dx / d) * v : 0;
        p.vy = d ? (dy / d) * v : 0;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (Math.abs(p.vx) > 0.3) p.face = Math.sign(p.vx);
        p.act = act === FbAction.Run && v < 0.3 ? FbAction.Idle : act;
        continue;
      }
      const pid = human.get(s);
      if (!playing) {
        tx = p.home[0];
        ty = p.home[1];
        speed = 3;
      } else if (pid) {
        const i = this.inputs.get(pid);
        if (i && (i.x || i.y)) {
          tx = p.x + i.x * 3;
          ty = p.y + i.y * 3;
        } else if (!i) {
          // nobody's touching the stick in the dev page: let it play like the computer
          tx = b.x;
          ty = b.y;
        }
        if (i) {
          if (i.a && !i.prevA) {
            if (b.owner === s) {
              const m = this.nearest(team, p.x + att * 8, p.y);
              if (m >= 0 && m !== s) this.kick(s, this.ps[m].x, this.ps[m].y, 14, 1.5, FbEvent.Pass);
            } else {
              p.act = FbAction.Slide;
              p.actUntil = this.t + 0.55;
              p.vx = (i.x || p.face) * 9;
              p.vy = i.y * 9;
            }
            i.prevA = true;
          }
          if (!i.a) i.prevA = false;
          if (!i.b && i.prevB && b.owner === s) {
            const pow = Math.min(1, (this.t - i.bAt) / 1);
            this.kick(s, att * HL, rnd(-3, 3), 14 + pow * 14, 2 + pow * 4, FbEvent.Kick);
          }
          i.prevB = i.b;
        }
      } else if (gk) {
        tx = -att * (HL - 1.2);
        ty = Math.max(-2.8, Math.min(2.8, b.y * 0.5));
        speed = 4.5;
        const incoming = Math.sign(b.vx) === -att && Math.abs(b.x + att * HL) < 9 && Math.hypot(b.vx, b.vy) > 10;
        if (incoming && b.owner < 0 && p.cool <= 0) {
          p.act = FbAction.Dive;
          p.actUntil = this.t + 0.7;
          p.vx = 0;
          p.vy = Math.sign(b.y - p.y || 1) * 7;
          p.cool = 1.4;
          if (Math.random() < 0.45) {
            b.vx = -b.vx * 0.5;
            b.vy = rnd(-6, 6);
            b.vz = 3;
            this.emit(FbEvent.Save, s);
          }
          continue;
        }
      } else {
        const chaser = this.nearest(team, b.x, b.y) === s;
        if (b.owner === s) {
          tx = p.x + att * 3;
          ty = p.y + Math.sin(this.t * 1.3 + s) * 1.5 - p.y * 0.05;
          speed = 5.6;
        } else if (chaser) {
          tx = b.x + b.vx * 0.2;
          ty = b.y + b.vy * 0.2;
        } else {
          tx = p.home[0] + b.x * 0.55;
          ty = p.home[1] + b.y * 0.3;
          speed = 4.5;
        }
      }
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const v = d > 0.25 ? Math.min(speed, d * 3) : 0;
      p.vx += ((d ? (dx / d) * v : 0) - p.vx) * Math.min(1, dt * 8);
      p.vy += ((d ? (dy / d) * v : 0) - p.vy) * Math.min(1, dt * 8);
      p.x = Math.max(-HL - 1, Math.min(HL + 1, p.x + p.vx * dt));
      p.y = Math.max(-HW + 0.3, Math.min(HW - 0.3, p.y + p.vy * dt));
      if (Math.abs(p.vx) > 0.3) p.face = Math.sign(p.vx);
      p.act = Math.hypot(p.vx, p.vy) > 0.6 ? FbAction.Run : FbAction.Idle;
    }

    // ball
    if (b.owner >= 0) {
      const p = this.ps[b.owner];
      b.x = p.x + p.face * 0.45;
      b.y = p.y + 0.12;
      b.z = 0;
      b.vx = p.vx;
      b.vy = p.vy;
      const team = st.roster[b.owner].team;
      const att = this.dir[team];
      // computer decisions
      if (!human.has(b.owner) && this.t > this.decideAt) {
        this.decideAt = this.t + rnd(0.6, 1.4);
        const toGoal = att * HL - b.x;
        if (Math.abs(toGoal) < 15 && Math.random() < 0.55) this.kick(b.owner, att * HL, rnd(-3.2, 3.2), rnd(18, 26), rnd(1, 4), FbEvent.Kick);
        else if (this.t - this.ownerSince > 1.2 && Math.random() < 0.5) {
          const mates = [1, 2, 3, 4].map((i) => team * 5 + i).filter((s) => s !== b.owner);
          const m = mates[Math.floor(Math.random() * mates.length)];
          this.kick(b.owner, this.ps[m].x + this.ps[m].vx * 0.4, this.ps[m].y, 13, 0.8, FbEvent.Pass);
        }
      }
      // tackles from the other side
      if (b.owner >= 0) {
        const opp = (1 - team) as FbTeam;
        const n = this.nearest(opp, b.x, b.y);
        const q = this.ps[n];
        if (n >= 0 && !human.has(n) && Math.hypot(q.x - b.x, q.y - b.y) < 1.4 && q.cool <= 0 && Math.random() < dt * 1.2) {
          q.act = FbAction.Slide;
          q.actUntil = this.t + 0.55;
          q.vx = Math.sign(b.x - q.x || 1) * 8;
          q.vy = (b.y - q.y) * 3;
          q.cool = 1.5;
          if (Math.random() < 0.6) {
            const o = this.ps[b.owner];
            o.act = FbAction.Fall;
            o.actUntil = this.t + 0.9;
            b.owner = -1;
            b.vx = q.vx * 0.8;
            b.vy = rnd(-4, 4);
            this.emit(FbEvent.Tackle, n);
          }
        }
      }
    } else {
      b.vz -= 9.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.z < 0) {
        b.z = 0;
        b.vz = Math.abs(b.vz) > 1.5 ? -b.vz * 0.45 : 0;
      }
      const fr = b.z > 0 ? 0.998 : Math.exp(-1.1 * dt);
      b.vx *= fr;
      b.vy *= fr;
      if (Math.abs(b.y) > HW - 0.15) {
        b.y = Math.sign(b.y) * (HW - 0.15);
        b.vy = -b.vy * 0.7;
        this.emit(FbEvent.Board);
      }
      const inMouth = Math.abs(b.y) < PITCH.goalWidth / 2 && b.z < PITCH.goalHeight;
      if (Math.abs(b.x) > HL && Math.abs(b.y) < PITCH.goalWidth / 2) {
        const deep = HL + PITCH.goalDepth - 0.3 + Math.min(0.9, this.goalSpeed / 30);
        if (Math.abs(b.x) > HL + PITCH.goalDepth - 0.4 && !this.netHit) {
          this.netHit = true;
          this.emit(FbEvent.Net);
        }
        if (Math.abs(b.x) > deep) {
          b.x = Math.sign(b.x) * deep;
          b.vx = -b.vx * 0.12;
          b.vy *= 0.3;
          b.vz = Math.min(b.vz, 0);
        }
        // the net soaks up the ball
        if (Math.abs(b.x) > HL + PITCH.goalDepth - 0.4) {
          b.vx *= Math.exp(-6 * dt);
          b.vy *= Math.exp(-6 * dt);
        }
        if (st.stage === "play") {
          const side = Math.sign(b.x);
          const team: FbTeam = this.dir[0] === side ? 0 : 1;
          st.score[team]++;
          const last = this.lastKicker;
          const spd = Math.hypot(b.vx, b.vy, b.vz);
          this.goalSpeed = spd;
          this.goalSide = side;
          this.goalT = this.t;
          this.netHit = false;
          const kind = last < 0 || st.roster[last].team !== team ? "own" : spd >= 22 ? "screamer" : b.z > 1.3 && spd < 16 ? "lob" : "tap";
          st.lastGoal = { team, slot: last >= 0 && st.roster[last].team === team ? last : -1, at: Date.now(), speed: +spd.toFixed(1), kind };
          st.stage = "goal";
          st.running = false;
          st.clock = st.clock + (Date.now() - st.clockAt) / 1000;
          st.clockAt = Date.now();
          this.stageUntil = 6;
          this.emit(FbEvent.Whistle);
          this.changed = true;
        }
      } else if (Math.abs(b.x) > HL - 0.15 && !inMouth) {
        if (Math.abs(b.y) < PITCH.goalWidth / 2 + 0.2 && Math.abs(b.y) > PITCH.goalWidth / 2 - 0.3 && b.z < PITCH.goalHeight) this.emit(FbEvent.Post);
        else this.emit(FbEvent.Board);
        b.x = Math.sign(b.x) * (HL - 0.15);
        b.vx = -b.vx * 0.6;
      }
      // pick up
      if (playing && b.z < 0.6) {
        let best = -1;
        let bd = 0.75;
        for (let s = 0; s < this.ps.length; s++) {
          const p = this.ps[s];
          if (p.cool > 0 || p.act === FbAction.Fall) continue;
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        if (best >= 0) {
          b.owner = best;
          this.lastKicker = best;
          this.ownerSince = this.t;
          this.decideAt = this.t + rnd(0.3, 1);
        }
      }
    }
    // referee trails the play
    const rx = b.x * 0.8;
    const ry = Math.max(-HW + 1, Math.min(HW - 1, b.y * 0.4 - 7));
    this.ref.x += (rx - this.ref.x) * Math.min(1, dt * 1.2);
    this.ref.y += (ry - this.ref.y) * Math.min(1, dt * 1.2);
  }
  private lastKicker = -1;
  private goalSpeed = 0;
  private goalSide = 1;
  private goalT = 0;
  private netHit = false;

  frame(): FbFrame {
    const p: number[] = [];
    for (const q of this.ps) p.push(+q.x.toFixed(2), +q.y.toFixed(2), q.face, q.act);
    const f: FbFrame = {
      t: Date.now(),
      b: [+this.ball.x.toFixed(2), +this.ball.y.toFixed(2), +this.ball.z.toFixed(2), this.ball.owner],
      p,
      r: [+this.ref.x.toFixed(2), +this.ref.y.toFixed(2)],
      c: { ...this.control },
    };
    if (this.ev.length) f.ev = this.ev.splice(0);
    return f;
  }
}
