import { PITCH } from "../../../shared/football/types";

/** World space of the pixel pitch. One art pixel = one world pixel; the 72-px duck is about 1.8 m tall.
 *  Pseudo 3/4 view: ground depth (pitch y) is squashed, height (z) is not, and tall things fan out a little
 *  towards the ends of the pitch so the goal frames read as boxes. */
export const PPM = 40;
/** screen px per metre across the pitch (y) */
export const PY = 21;
/** screen px per metre of height (z) */
export const PZ = 40;
/** how far tall things lean out towards the goals, per metre of height */
const LEAN = 0.28;

export const HALF_L = PITCH.length / 2;
export const HALF_W = PITCH.width / 2;

export const wx = (x: number, z = 0) => x * PPM + z * LEAN * PPM * Math.max(-1, Math.min(1, x / HALF_L));
export const wy = (y: number, z = 0) => y * PY - z * PZ;

/** the ad boards: just outside the playing area, 0.9 m tall */
export const BOARD_GAP = 0.3;
export const BOARD_H = 36;
/** far (top) board: its foot on the far line, its face rising above */
export const FAR_BOARD_FOOT = Math.round(wy(-HALF_W - BOARD_GAP));
/** near (bottom) board: its top edge on the near line, its face hanging below (the camera looks over it) */
export const NEAR_BOARD_TOP = Math.round(wy(HALF_W + BOARD_GAP));
/** end boards sit behind the goal nets */
export const END_X = HALF_L + PITCH.goalDepth + 0.6;

/** the whole world (camera bounds) */
export const STAND_H = 181;
export const WORLD = {
  left: -Math.round((END_X + 3.2) * PPM),
  right: Math.round((END_X + 3.2) * PPM),
  top: FAR_BOARD_FOOT - BOARD_H - 8 - STAND_H,
  bottom: NEAR_BOARD_TOP + BOARD_H + 112,
};

export const TEAM_COL = [0x2f7bff, 0xff3b3b] as const;
export const TEAM_CSS = ["#2f7bff", "#ff3b3b"] as const;
export const TEAM_NAME = ["الزرق", "الحمر"] as const;
