// SPIKE: a race track with more than one way round. A track is a closed main road plus branch roads (shortcuts)
// that leave the main road and join it again further on. Any road can have gaps (nothing under them: jump them or
// fall), and boost pads. Race progress on a branch is mapped onto the main road, so laps and places just work.
import * as THREE from "three";

export type V3 = [number, number, number];
export interface PathDef {
  /** control points (x, y, z); a branch lists only its own middle points */
  pts: V3[];
  /** half width of the road (m) */
  width: number;
  /** a branch: the main-road points (x, z) it leaves from and joins at */
  from?: [number, number];
  to?: [number, number];
  /** stretches with nothing under them, as [start, end] fractions of this road */
  gaps?: [number, number][];
  /** how likely a computer kart takes this branch (0..1) */
  aiTake?: number;
  /** a slower surface (indoor tiles, sand track): you drive it at off-road speed plus a little */
  rough?: boolean;
}
export interface TrackDef {
  name: string;
  main: PathDef;
  branches: PathDef[];
  /** boost pads: [road index (0 = main, 1.. = branches), fraction along it] */
  boosts: [number, number][];
  /** what's beside the road: walls keep you on it; "slow" lets you cut across (slower, unless boosted) */
  edge: "wall" | "slow";
}

export class Path {
  P: THREE.Vector3[] = [];
  T: THREE.Vector3[] = [];
  S: number[] = [];
  /** race progress at each sample (main-road metres) */
  prog: number[] = [];
  gap: boolean[] = [];
  len = 0;
  constructor(
    public width: number,
    public closed: boolean,
    /** for a branch: the main-road sample it starts on and ends on */
    public enter = 0,
    public exit = 0,
    public aiTake = 0,
    public rough = false,
  ) {}
  get n() {
    return this.P.length;
  }
  wrap(i: number) {
    const n = this.n;
    return this.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  }
  normal(i: number) {
    const t = this.T[i];
    return new THREE.Vector3(-t.z, 0, t.x); // left of travel
  }
  heading(i: number) {
    return Math.atan2(this.T[i].x, this.T[i].z);
  }
}

function sample(pts: THREE.Vector3[], closed: boolean, step = 0.6): { P: THREE.Vector3[]; T: THREE.Vector3[] } {
  const c = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  const n = Math.max(8, Math.ceil(c.getLength() / step));
  const P: THREE.Vector3[] = [];
  const T: THREE.Vector3[] = [];
  const count = closed ? n : n + 1;
  for (let i = 0; i < count; i++) {
    const u = i / n;
    // (the curve can swing a little below its points: never below the ground)
    const q = c.getPointAt(Math.min(1, u));
    q.y = Math.max(0, q.y);
    P.push(q);
    T.push(c.getTangentAt(Math.min(1, u)).setY(0).normalize());
  }
  return { P, T };
}

export interface Ground {
  h: number;
  road: boolean;
  path: number;
  i: number;
  lat: number;
  /** on a slower surface */
  rough?: boolean;
  /** off every road, the nearest road's edge to slide back to (walls) */
  edgeX?: number;
  edgeZ?: number;
}

export class Track {
  paths: Path[] = [];
  LEN = 0;
  private grid = new Map<number, number[]>();
  private CELL = 8;
  constructor(public def: TrackDef) {
    const main = new Path(def.main.width, true);
    const s = sample(def.main.pts.map((p) => new THREE.Vector3(...p)), true);
    main.P = s.P;
    main.T = s.T;
    this.measure(main);
    main.prog = [...main.S];
    this.LEN = main.len;
    main.gap = this.gaps(main, def.main.gaps);
    this.paths.push(main);
    for (const b of def.branches) this.paths.push(this.branch(main, b));
    this.paths.forEach((p, pi) => p.P.forEach((q, i) => this.cell(q.x, q.z).push((pi << 16) | i)));
  }

  private measure(p: Path) {
    p.S = [];
    let L = 0;
    for (let i = 0; i < p.n; i++) {
      p.S.push(L);
      if (i < p.n - 1 || p.closed) L += p.P[i].distanceTo(p.P[(i + 1) % p.n]);
    }
    p.len = L;
  }

  private gaps(p: Path, g?: [number, number][]) {
    return p.S.map((s) => !!g?.some(([a, b]) => s >= a * p.len && s <= b * p.len));
  }

  private nearestOn(p: Path, x: number, z: number) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < p.n; i++) {
      const d = (p.P[i].x - x) ** 2 + (p.P[i].z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** a branch: from a main-road sample, through its own points, back onto the main road */
  private branch(main: Path, b: PathDef): Path {
    const a = this.nearestOn(main, ...b.from!);
    const e = this.nearestOn(main, ...b.to!);
    const lead = 8; // samples of shared road at each end so it blends in
    const a0 = main.wrap(a - lead);
    const e1 = main.wrap(e + lead);
    const pts = [main.P[a0], main.P[a], ...b.pts.map((p) => new THREE.Vector3(...p)), main.P[e], main.P[e1]];
    const p = new Path(b.width, false, a0, e1, b.aiTake ?? 0.4, !!b.rough);
    const s = sample(pts, false);
    p.P = s.P;
    p.T = s.T;
    // where the shortcut runs alongside or over the main road at about the same level, it takes the main road's
    // height (fading back to its own over 12 m): otherwise one road surface sticks up through the other and you
    // drive into it
    for (const q of p.P) {
      const j = this.nearestOn(main, q.x, q.z);
      const my = main.P[j].y;
      // (a ramp or a bridge well above the main road keeps its height: the pull fades out smoothly by 1.5 m up)
      const lift = Math.max(0, 1 - Math.abs(q.y - my) / 1.5);
      const d = Math.hypot(main.P[j].x - q.x, main.P[j].z - q.z) - (main.width + p.width);
      const w = Math.max(0, Math.min(1, 1 - d / 12)) * lift;
      q.y += (my - q.y) * w;
    }
    this.measure(p);
    // progress: straight from the main road's progress where it leaves to where it joins
    const s0 = main.S[a0];
    let s1 = main.S[e1];
    if (s1 < s0) s1 += main.len;
    p.prog = p.S.map((d) => (s0 + ((s1 - s0) * d) / p.len) % main.len);
    p.gap = this.gaps(p, b.gaps);
    return p;
  }

  private cell(x: number, z: number) {
    const k = (Math.floor(x / this.CELL) + 4096) * 8192 + (Math.floor(z / this.CELL) + 4096);
    let c = this.grid.get(k);
    if (!c) this.grid.set(k, (c = []));
    return c;
  }

  /** the nearest road sample to a point, preferring roads at about this height (bridges and tunnels) */
  nearest(x: number, z: number, y: number | null, prefer = -1): { path: number; i: number } {
    let best = { path: 0, i: 0 };
    let bd = Infinity;
    const cx = Math.floor(x / this.CELL);
    const cz = Math.floor(z / this.CELL);
    for (let r = 1; r <= 3 && bd === Infinity; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const c = this.grid.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
          if (!c) continue;
          for (const code of c) {
            const pi = code >> 16;
            const i = code & 0xffff;
            const q = this.paths[pi].P[i];
            let d = (q.x - x) ** 2 + (q.z - z) ** 2;
            if (y !== null) {
              const dy = Math.abs(q.y - y);
              if (dy > 2.5) d += (dy - 2.5) ** 2 * 6;
            }
            if (pi === prefer) d -= 0.5;
            if (d < bd) {
              bd = d;
              best = { path: pi, i };
            }
          }
        }
    if (bd === Infinity) {
      // far from everything: search the main road
      best = { path: 0, i: this.nearestOn(this.paths[0], x, z) };
    }
    return best;
  }

  /** the nearest sample on one road, searching around a hint (computer karts stay on their road) */
  nearestLocal(pi: number, x: number, z: number, hint: number, span = 40) {
    const p = this.paths[pi];
    let best = hint;
    let bd = Infinity;
    for (let k = -span; k <= span; k++) {
      const i = p.wrap(hint + k);
      const d = (p.P[i].x - x) ** 2 + (p.P[i].z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** is (x, z) on any road (other than one) at this sample's height? used to open walls where roads meet */
  onRoad(x: number, z: number, y: number, except: number) {
    const cx = Math.floor(x / this.CELL);
    const cz = Math.floor(z / this.CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.grid.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
        if (!c) continue;
        for (const code of c) {
          const pi = code >> 16;
          if (pi === except) continue;
          const p = this.paths[pi];
          const i = code & 0xffff;
          const q = p.P[i];
          if (Math.abs(q.y - y) > 2) continue;
          const n = p.normal(i);
          const lat = (x - q.x) * n.x + (z - q.z) * n.z;
          const lon = (x - q.x) * p.T[i].x + (z - q.z) * p.T[i].z;
          if (Math.abs(lat) < p.width + 0.3 && Math.abs(lon) < 0.6) return true;
        }
      }
    return false;
  }

  ground(x: number, z: number, y: number | null, at?: { path: number; i: number }): Ground {
    const { path, i } = at ?? this.nearest(x, z, y);
    const p = this.paths[path];
    const q = p.P[i];
    const n = p.normal(i);
    const lat = (x - q.x) * n.x + (z - q.z) * n.z;
    const road = Math.abs(lat) <= p.width;
    if (road) return { h: p.gap[i] ? -60 : q.y, road: !p.gap[i], path, i, lat, rough: p.rough };
    if (this.def.edge === "wall") {
      const e = Math.sign(lat) * (p.width - 0.6);
      return { h: p.gap[i] ? -60 : q.y, road: false, path, i, lat, edgeX: q.x + n.x * e, edgeZ: q.z + n.z * e };
    }
    // open ground: slopes down from the road to the field
    const off = Math.abs(lat) - p.width;
    const fall = Math.max(0, 1 - off / 16);
    return { h: q.y * fall * fall, road: false, path, i, lat };
  }
}
