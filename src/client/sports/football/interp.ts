import type { FbFrame } from "../../../shared/football/types";

/** The pose of everything at one moment, interpolated between two server snapshots. */
export interface Pose {
  t: number;
  ball: [number, number, number];
  owner: number;
  /** per slot: x, y, facing, action */
  p: number[];
  ref: [number, number];
  c: Record<string, number>;
}

/** Keeps the last few seconds of snapshots and plays them back ~DELAY ms behind the server clock (the view owns the
 *  playback clock, so it can run it slower for a slow-motion moment and catch up afterwards). */
export class FrameBuffer {
  private frames: FbFrame[] = [];
  /** events not fired yet: [server time, kind, slot] */
  private pending: [number, number, number][] = [];
  delay = 110;

  push(f: FbFrame) {
    const last = this.frames[this.frames.length - 1];
    if (last && f.t <= last.t) {
      // a restart (new match / clock jump): start over
      if (last.t - f.t > 2000) this.frames = [];
      else return;
    }
    this.frames.push(f);
    if (this.frames.length > 60) this.frames.shift();
    if (f.ev) for (const [k, s] of f.ev) this.pending.push([f.t, k, s]);
  }

  get latest(): FbFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** events whose time has come at render time `rt`: [kind, slot, server time] */
  due(rt: number): [number, number, number][] {
    if (!this.pending.length) return [];
    const out: [number, number, number][] = [];
    this.pending = this.pending.filter(([t, k, s]) => {
      // (a frame far in the future means the clock offset is off: don't hold its sounds back)
      if (t <= rt || t > rt + 1500) {
        out.push([k, s, t]);
        return false;
      }
      return true;
    });
    return out;
  }

  /** the ball's speed (m/s) just after server time `t` (the frames ahead of the playback are already here) */
  ballSpeedAfter(t: number): number {
    const fs = this.frames;
    let i = fs.findIndex((f) => f.t >= t);
    if (i < 0) i = fs.length - 1;
    const a = fs[Math.max(0, i)];
    const b = fs[Math.min(fs.length - 1, i + 1)];
    if (!a || !b || a === b) return 0;
    return Math.hypot(b.b[0] - a.b[0], b.b[1] - a.b[1], b.b[2] - a.b[2]) / ((b.t - a.t) / 1000 || 1);
  }

  /** a slot's position at the newest frame and its velocity there (m, m/s) */
  newest(slot: number): { x: number; y: number; vx: number; vy: number; act: number; t: number } | null {
    const fs = this.frames;
    const b = fs[fs.length - 1];
    if (!b || b.p.length < slot * 4 + 4) return null;
    const a = fs[fs.length - 2] ?? b;
    const dt = (b.t - a.t) / 1000 || 1;
    const i = slot * 4;
    return { x: b.p[i], y: b.p[i + 1], vx: (b.p[i] - (a.p[i] ?? b.p[i])) / dt, vy: (b.p[i + 1] - (a.p[i + 1] ?? b.p[i + 1])) / dt, act: b.p[i + 3], t: b.t };
  }

  /** the pose at render time `rt` (server ms) */
  sample(rt: number): Pose | null {
    const fs = this.frames;
    if (!fs.length) return null;
    const last = fs[fs.length - 1];
    // far behind / far ahead (clock offset not settled yet): just show the newest frame
    if (rt - last.t > 1500 || fs[0].t - rt > 1500) return pose(last, last, 0, last.t);
    if (rt <= fs[0].t) return pose(fs[0], fs[0], 0, rt);
    let i = fs.length - 1;
    while (i > 0 && fs[i - 1].t > rt) i--;
    if (rt >= last.t) {
      // ran past the newest snapshot: extrapolate a little from the last two, then hold
      if (fs.length < 2) return pose(last, last, 0, rt);
      const a = fs[fs.length - 2];
      const dt = last.t - a.t || 1;
      const u = 1 + Math.min(rt - last.t, 120) / dt;
      return pose(a, last, u, rt);
    }
    const a = fs[i - 1];
    const b = fs[i];
    return pose(a, b, (rt - a.t) / (b.t - a.t || 1), rt);
  }
}

function pose(a: FbFrame, b: FbFrame, u: number, t: number): Pose {
  const L = (x: number, y: number) => x + (y - x) * u;
  const p: number[] = new Array(b.p.length);
  for (let i = 0; i < b.p.length; i += 4) {
    const ax = a.p[i] ?? b.p[i];
    const ay = a.p[i + 1] ?? b.p[i + 1];
    // a jump of several metres is a teleport (kick-off reset), don't slide across the pitch
    const jump = Math.abs(b.p[i] - ax) + Math.abs(b.p[i + 1] - ay) > 6;
    p[i] = jump ? b.p[i] : L(ax, b.p[i]);
    p[i + 1] = jump ? b.p[i + 1] : L(ay, b.p[i + 1]);
    p[i + 2] = u < 0.5 ? a.p[i + 2] ?? b.p[i + 2] : b.p[i + 2];
    p[i + 3] = u < 0.5 ? a.p[i + 3] ?? b.p[i + 3] : b.p[i + 3];
  }
  const bj = Math.abs(b.b[0] - a.b[0]) + Math.abs(b.b[1] - a.b[1]) > 12;
  return {
    t,
    ball: bj ? [b.b[0], b.b[1], b.b[2]] : [L(a.b[0], b.b[0]), L(a.b[1], b.b[1]), Math.max(0, L(a.b[2], b.b[2]))],
    owner: u < 0.5 ? a.b[3] : b.b[3],
    p,
    ref: [L(a.r[0], b.r[0]), L(a.r[1], b.r[1])],
    c: b.c,
  };
}
