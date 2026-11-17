/** بلياردو البط: a normal pool table, the player who pots the most balls wins (the owner's rule, no solids /
 *  stripes, no calling the 8). Players take turns: pot a ball and you shoot again, miss and the next player
 *  shoots; pot the white and the next player gets the white in hand. The game ends when all 15 balls are down.
 *
 *  It rides the sports plumbing: phase "sport", GameState.sport with id "pool", the shot comes in over
 *  "sport:shot", the server answers with a `shot` anim + Replay, and every screen plays it back.
 *  - aim   = direction on the table in radians (0 = +x, π/2 = +y)
 *  - power = 0..1
 *  - spin  = side spin (english), -1 left .. 1 right
 *  - start = top / back spin, -1 (draw / screw back) .. 1 (follow)
 *  - place = where the shooter put the white when it was in hand
 *  SportState.lanes.table holds the PoolTable below; SportState.open = [the player whose turn it is]. */

/** Table in metres, origin at the centre, x along the length. */
export const TABLE = {
  length: 2.24,
  width: 1.12,
  /** ball radius */
  r: 0.028575,
  /** pocket "mouth" radius: corner and middle pockets */
  corner: 0.062,
  side: 0.066,
  /** head string: with the white in hand it goes behind it (x < headX) */
  headX: -0.56,
  /** where the triangle's front ball sits */
  footX: 0.56,
};

export interface PoolBall {
  /** 0 = the white, 1..15 */
  n: number;
  x: number;
  y: number;
  /** potted (off the table) */
  in: boolean;
}

export interface PoolTable {
  balls: PoolBall[];
  /** whose turn, and the turn order */
  shooter: string;
  order: string[];
  /** the shooter places the white behind the head string first (break, or after the white was potted) */
  inHand: boolean;
  /** player id -> numbers of the balls they potted */
  potted: Record<string, number[]>;
  /** shots taken so far */
  shots: number;
  /** what happened on the last shot, for the HUD: e.g. "دخلت ٣!", "البيضا طاحت" */
  last?: string;
}

/** A pool shot as the phone sends it: the normal Shot plus where the white goes when it is in hand. */
export interface PoolShot {
  aim: number;
  power: number;
  spin: number;
  start: number;
  place?: { x: number; y: number };
}
