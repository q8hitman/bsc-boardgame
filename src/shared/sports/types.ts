/** Sports games (bowling, mini-golf): everyone plays at the same time, the server runs the physics and sends a
 *  replay, phones and the projector only draw it (floating point differs between browsers, so nobody re-simulates). */

export type SportId = "bowling" | "golf" | "hoops";
export const SPORT_IDS: SportId[] = ["bowling", "golf", "hoops"];

/** One shot from a phone. Normalised so every screen size sends the same thing.
 *  - `aim`: radians. Bowling: 0 = straight down the lane, + = to the right. Golf: world direction (0 = +x, π/2 = +z).
 *  - `power`: 0..1.
 *  - `spin`: -1..1. Bowling: hook (curve to the left −, right +). Golf: unused (0).
 *  - `start`: -1..1. Bowling: where the ball leaves the foul line across the lane. Golf: unused (0). */
export interface Shot {
  aim: number;
  power: number;
  spin: number;
  start: number;
}

/** What the server sends after a shot so every screen can play it back. Positions in world units (metres), sampled
 *  every `dt` seconds. `ball` = [x, y, z, x, y, z, ...]; `bodies` = other moving things (bowling pins: per pin
 *  [x, y, z, tiltX, tiltZ, ...] per sample), sport-specific. */
export interface Replay {
  dt: number;
  ball: number[];
  bodies?: number[][];
  /** sport-specific outcome text for the views, e.g. "سترايك!" / "في الحفرة!" */
  label?: string;
}

/** Public state of a sports game, in GameState.sport. Per-player data (`lanes`) is sport-specific and documented
 *  by each sport (BowlingLane / GolfBall). */
export interface SportState {
  id: SportId;
  /** bowling: frame, golf: hole. 0-based. */
  round: number;
  rounds: number;
  /** golf: which course (map) is played */
  course?: string;
  /** per player: that player's own lane / ball, as the sport defines it */
  lanes: Record<string, unknown>;
  /** per player: score of each finished round (bowling: frame score so far, golf: strokes) */
  cards: Record<string, (number | null)[]>;
  /** per player: game total (bowling: pins, higher is better; golf: strokes, lower is better) */
  total: Record<string, number>;
  /** player id -> server time (ms) until which their last shot is still playing (no new shot before that) */
  busyUntil: Record<string, number>;
  /** players who can still shoot this round */
  open: string[];
  better: "high" | "low";
}
