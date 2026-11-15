import { BOARDS } from "./data";
import type { GameState, Player } from "./types";

/** Race boards (snakes & ladders): first to the last cell wins; no crumbs, stars or shops. */
export const isRace = (s: { boardId: string }) => BOARDS[s.boardId]?.mode === "race";

/** Bonus steps for minigame places in race mode (1st, 2nd, 3rd, 4th). */
export const RACE_STEPS = [5, 3, 2, 1];
/** Race mode plays a minigame every N rounds so the race keeps moving. */
export const RACE_MG_EVERY = 3;
export const RACE_DEFAULT_ROUNDS = 20;
export const PARTY_DEFAULT_ROUNDS = 10;

/** Who is winning right now: furthest cell in a race, stars then crumbs on party boards. */
export function ranked(s: GameState): Player[] {
  return [...s.players].sort(isRace(s) ? (a, b) => b.node - a.node : (a, b) => b.stars - a.stars || b.crumbs - a.crumbs);
}
