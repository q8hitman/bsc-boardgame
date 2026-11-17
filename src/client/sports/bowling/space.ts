import { BACK_Z, GUTTER_W, HEAD_Z, LANE_HALF, PIT_Z } from "../../../shared/sports/bowling";

/** Physics metres -> view metres. The lane is drawn shorter than a real one (a real 18 m lane makes the pins tiny on
 *  a phone): the approach part is compressed by K, easing into 1:1 three metres before the head pin so the pin deck
 *  keeps its true shape. The view looks down -Z: view z = -zv(physics z), view x = physics x. */
export const K = 0.5;
const Z1 = HEAD_Z - 3;
const ZV_HEAD = K * HEAD_Z + (1 - K) * 1.5;
export function zv(z: number) {
  if (z <= Z1) return K * z;
  if (z <= HEAD_Z) {
    const d = z - Z1;
    return K * z + ((1 - K) * d * d) / (2 * (HEAD_Z - Z1));
  }
  return ZV_HEAD + (z - HEAD_Z);
}
export const HEAD_V = zv(HEAD_Z);
export const PIT_V = zv(PIT_Z);
export const BACK_V = zv(BACK_Z);
/** lane surface length in view metres (foul line to pit) */
export const LANE_LEN = PIT_V;
/** distance between two lanes' centres */
export const PITCH = 2 * (LANE_HALF + GUTTER_W) + 0.34;
export const CAP_W = PITCH - 2 * (LANE_HALF + GUTTER_W);
