/** A player's progress from their record: XP and level, badges, merging two records (a guest's into an account),
 *  and the game of the day. Pure: no storage, no network. */

export interface Stats {
  /** games played / won per game id */
  games: Record<string, { played: number; won: number }>;
  /** days with at least one counted game, "YYYY-MM-DD" (Kuwait time), sorted */
  days: string[];
}

export const XP_GAME = 10;
export const XP_WIN = 25;

export function totals(s: Stats): { played: number; wins: number } {
  let played = 0;
  let wins = 0;
  for (const g of Object.values(s.games)) {
    played += g.played;
    wins += g.won;
  }
  return { played, wins };
}

export const xpOf = (s: Stats) => {
  const t = totals(s);
  return t.played * XP_GAME + t.wins * XP_WIN;
};

/** a title every 5 levels */
const TITLES: [number, string][] = [
  [15, "أسطورة النادي"],
  [10, "كابتن الفريق"],
  [5, "نجم الملعب"],
  [1, "لاعب جديد"],
];

/** level n needs 50·n XP more than level n−1 (level 1 at 0 XP, level 2 at 50, level 3 at 150 ...) */
export function levelOf(xp: number): { level: number; into: number; need: number; title: string } {
  let level = 1;
  let start = 0;
  while (xp >= start + 50 * level) {
    start += 50 * level;
    level++;
  }
  const title = TITLES.find(([l]) => level >= l)![1];
  return { level, into: xp - start, need: 50 * level, title };
}

export const BADGES: { id: string; name: string; hint: string }[] = [
  { id: "first-win", name: "أول فوز", hint: "افز بأي لعبة" },
  { id: "ten-wins", name: "١٠ فوزات", hint: "افز ١٠ مرات" },
  { id: "all-games", name: "فاز بكل لعبة", hint: "افز مرة بكل لعبة" },
  { id: "football-10", name: "١٠ مباريات كرة", hint: "العب ١٠ مباريات كرة البط" },
  { id: "five-days", name: "٥ أيام لعب", hint: "العب بخمسة أيام مختلفة" },
];

export function badgesOf(s: Stats, allGameIds: string[]): string[] {
  const t = totals(s);
  const out: string[] = [];
  if (t.wins >= 1) out.push("first-win");
  if (t.wins >= 10) out.push("ten-wins");
  if (allGameIds.length && allGameIds.every((id) => (s.games[id]?.won ?? 0) >= 1)) out.push("all-games");
  if ((s.games.football?.played ?? 0) >= 10) out.push("football-10");
  if (new Set(s.days).size >= 5) out.push("five-days");
  return out;
}

export function mergeStats(a: Stats, b: Stats): Stats {
  const games: Stats["games"] = {};
  for (const src of [a.games, b.games])
    for (const [id, g] of Object.entries(src)) {
      const cur = Object.hasOwn(games, id) ? games[id] : { played: 0, won: 0 };
      games[id] = { played: cur.played + g.played, won: cur.won + g.won };
    }
  return { games, days: [...new Set([...a.days, ...b.days])].sort() };
}

/** today's date in Kuwait (UTC+3, no daylight saving), "YYYY-MM-DD" */
export const kuwaitDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/** the same game for everyone on a Kuwait calendar day; walks through every game before repeating */
export function gameOfDay(date: Date, ids: string[]): string {
  const n = ids.length;
  const day = Math.floor(Date.parse(kuwaitDay(date)) / 86400_000);
  // a step co-prime to n visits every game once per n days, in a shuffled order
  let step = 5;
  while (gcd(step, n) !== 1) step++;
  return ids[(((day * step) % n) + n) % n];
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
