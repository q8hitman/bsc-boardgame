import { BOARDS } from "./data";
import type { GameState, Player } from "./types";

/** Race boards (snakes & ladders): first to the last cell wins; no crumbs, stars or shops. */
/** The card game is picked like a board but has no map. */
export const CARDS_ID = "cards";
export const isCards = (s: { boardId: string }) => s.boardId === CARDS_ID;
/** Board games always seat exactly 4: the computer takes the empty seats. The card game seats 2 to MAX_PLAYERS, bots optional. */
export const BOARD_SEATS = 4;

export const isRace = (s: { boardId: string }) => BOARDS[s.boardId]?.mode === "race";
/** everything on the sports plumbing: bowling, golf, hoops, football, pool */
export const isSport = (s: { boardId: string }) => ["bowling", "golf", "hoops", "football", "pool"].includes(s.boardId);
export const isFootball = (s: { boardId: string }) => s.boardId === "football";
export const isPool = (s: { boardId: string }) => s.boardId === "pool";
/** a pool table seats 4 at most (people and computer players) */
export const POOL_SEATS = 4;
/** football at full time: "فاز الأزرق!" / "فاز الأحمر!" / "تعادل!" with the score; null for other games */
export function footballResult(s: { boardId: string; football?: { result?: 0 | 1 | -1; score: [number, number] } }) {
  const f = s.football;
  if (s.boardId !== "football" || !f || f.result === undefined) return null;
  const score = `${f.score[0]} – ${f.score[1]}`.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  return { title: f.result === -1 ? "تعادل!" : f.result === 0 ? "فاز الأزرق!" : "فاز الأحمر!", score, team: f.result };
}
/** the word after a sports total: goals, balls, points or strokes */
export const sportUnit = (s: { boardId: string; sport?: { better: "high" | "low" } }) =>
  s.boardId === "football" ? "هدف" : s.boardId === "pool" ? "كرة" : s.sport?.better === "high" ? "نقطة" : "ضربة";
/** a map game (island / snakes): exactly 4 seats, the computer fills them */
export const isBoardGame = (s: { boardId: string }) => !!BOARDS[s.boardId];

/** Bonus steps for minigame places in race mode (1st, 2nd, 3rd, 4th). */
export const RACE_STEPS = [5, 3, 2, 1];
/** Race mode plays a minigame every N rounds so the race keeps moving. */
export const RACE_MG_EVERY = 3;
export const RACE_DEFAULT_ROUNDS = 20;
export const PARTY_DEFAULT_ROUNDS = 10;

/** Who is winning right now: furthest cell in a race, stars then crumbs on party boards. */
export function ranked(s: GameState): Player[] {
  if (isSport(s) && s.sport) {
    const sp = s.sport;
    const sign = sp.better === "high" ? -1 : 1;
    // the winners first (football on penalties: same goals, one side won), then by total
    const w = (id: string) => (s.winnerIds?.includes(id) ? 0 : 1);
    return [...s.players].sort((a, b) => w(a.id) - w(b.id) || sign * ((sp.total[a.id] ?? 0) - (sp.total[b.id] ?? 0)));
  }
  if (isCards(s) && s.table) {
    const t = s.table;
    return [...s.players].sort((a, b) => (t.counts[a.id] ?? 0) - (t.counts[b.id] ?? 0) || (t.points?.[a.id] ?? 0) - (t.points?.[b.id] ?? 0));
  }
  return [...s.players].sort(isRace(s) ? (a, b) => b.node - a.node : (a, b) => b.stars - a.stars || b.crumbs - a.crumbs);
}
