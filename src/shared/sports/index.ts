import { BOWLING } from "./bowling";
import { GOLF } from "./golf";
import { HOOPS } from "./hoops";
import { FB_MODES } from "../football/types";
import type { LaneSportId, Replay, Shot, SportId } from "./types";

export * from "./types";

/** What a sport implements. The generic SportGame (src/server/sports.ts) runs rounds, timers and bots with it.
 *  `L` = one player's lane / ball state (sent to every screen in SportState.lanes). Everything must be plain JSON. */
export interface SportRules<L> {
  id: LaneSportId;
  /** shown in menus */
  name: string;
  sub: string;
  better: "high" | "low";
  /** golf: the maps the host can pick from (first = default) */
  courses?: { id: string; name: string }[];
  /** rounds in a game (bowling frames, golf holes); `course` = golf map id */
  rounds(course?: string): number;
  /** seconds a round lasts before the computer finishes it for whoever is slow */
  roundSeconds: number;
  /** a player's lane at the start of round `round` (`prev` = their lane after the previous round, if any) */
  startRound(round: number, prev: L | undefined, course?: string): L;
  /** can this player still shoot in this round? */
  canShoot(lane: L): boolean;
  /** run the physics: the new lane, a replay for the screens, and how long the replay takes (ms) */
  shoot(lane: L, shot: Shot, round: number, course?: string): { lane: L; replay: Replay; ms: number };
  /** the score card entry for each finished round so far (null = not played yet), and the game total */
  card(lane: L, rounds: number): { cards: (number | null)[]; total: number };
  /** the round clock ran out: close this lane right away, the remaining shots count as misses (cheap, no physics) */
  forfeit(lane: L): L;
  /** a decent computer shot (skill 0..1) */
  botShot(lane: L, round: number, skill: number, course?: string): Shot;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SPORTS: Record<LaneSportId, SportRules<any>> = { bowling: BOWLING, golf: GOLF, hoops: HOOPS };
export const isLaneSport = (id: string): id is LaneSportId => Object.hasOwn(SPORTS, id);
export const isSportId = (id: string): id is SportId => isLaneSport(id) || id === "football" || id === "pool";
/** what the host picks in the lobby: golf maps, football match lengths (GameState.course holds the id) */
export function sportCourses(id: string): { id: string; name: string }[] | undefined {
  if (id === "football") return FB_MODES;
  return isLaneSport(id) ? SPORTS[id].courses : undefined;
}
/** the name shown in menus for every game on the sports plumbing */
export const SPORT_NAMES: Record<SportId, string> = {
  bowling: BOWLING.name,
  golf: GOLF.name,
  hoops: HOOPS.name,
  football: "كورة البط",
  pool: "بلياردو البط",
};
