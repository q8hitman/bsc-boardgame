// Account progress: levels, badges, merging records, the game of the day, the catalog copy.
// Run: npx tsx tools/account-sim.ts
import { CATALOG } from "../src/shared/catalog";
import { SPORT_NAMES } from "../src/shared/sports";
import { BADGES, badgesOf, gameOfDay, levelOf, mergeStats, totals, xpOf, type Stats } from "../src/client/account/progress";

let fails = 0;
const ok = (c: unknown, w: string) => {
  if (!c) fails++;
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
};
const st = (games: Stats["games"], days: string[] = []): Stats => ({ games, days });

ok(xpOf(st({ football: { played: 3, won: 1 } })) === 55, "xp: 10 per game + 25 per win");
const l0 = levelOf(0);
ok(l0.level === 1 && l0.into === 0 && l0.need === 50, `level 1 at 0 xp needs 50 (${JSON.stringify(l0)})`);
ok(levelOf(49).level === 1, "49 xp is still level 1");
const l50 = levelOf(50);
ok(l50.level === 2 && l50.into === 0 && l50.need === 100, `50 xp = level 2, needs 100 (${JSON.stringify(l50)})`);
ok(levelOf(150).level === 3, "150 xp = level 3");
ok(levelOf(0).title === "لاعب جديد", "level 1 title");
// level 5 starts at 50+100+150+200 = 500
ok(levelOf(500).level === 5 && levelOf(500).title === "نجم الملعب", "level 5 title");
ok(levelOf(499).title === "لاعب جديد", "level 4 keeps the level-1 title");

const ids = ["football", "pool", "bowling"];
ok(!badgesOf(st({ football: { played: 1, won: 0 } }), ids).includes("first-win"), "no first-win without a win");
ok(badgesOf(st({ football: { played: 1, won: 1 } }), ids).includes("first-win"), "first-win after a win");
ok(!badgesOf(st({ football: { played: 12, won: 9 } }), ids).includes("ten-wins"), "no ten-wins at 9");
ok(badgesOf(st({ football: { played: 12, won: 6 }, pool: { played: 4, won: 4 } }), ids).includes("ten-wins"), "ten-wins across games");
ok(!badgesOf(st({ football: { played: 2, won: 1 }, pool: { played: 1, won: 1 } }), ids).includes("all-games"), "all-games needs every game");
ok(badgesOf(st({ football: { played: 2, won: 1 }, pool: { played: 1, won: 1 }, bowling: { played: 1, won: 1 } }), ids).includes("all-games"), "all-games with a win in each");
ok(badgesOf(st({ football: { played: 10, won: 0 } }), ids).includes("football-10"), "football-10 after 10 football games");
ok(!badgesOf(st({}, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]), ids).includes("five-days"), "no five-days at 4");
ok(badgesOf(st({}, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]), ids).includes("five-days"), "five-days");
ok(BADGES.length === 5 && BADGES.every((b) => b.id && b.name && b.hint), "five badges with names and hints");

const m = mergeStats(st({ football: { played: 3, won: 1 }, pool: { played: 1, won: 0 } }, ["2026-11-02", "2026-11-01"]), st({ football: { played: 2, won: 2 }, golf: { played: 1, won: 1 } }, ["2026-11-01", "2026-11-03"]));
ok(m.games.football.played === 5 && m.games.football.won === 3, "merge adds per game");
ok(m.games.pool.played === 1 && m.games.golf.won === 1, "merge keeps one-sided games");
ok(JSON.stringify(m.days) === JSON.stringify(["2026-11-01", "2026-11-02", "2026-11-03"]), `merge unions days sorted (${m.days})`);
const t = totals(m);
ok(t.played === 7 && t.wins === 4, "totals");

const g7 = ["a", "b", "c", "d", "e", "f", "g"];
ok(gameOfDay(new Date("2026-11-19T22:30:00Z"), g7) === gameOfDay(new Date("2026-11-20T08:00:00Z"), g7), "same Kuwait day, same game");
const days = Array.from({ length: 7 }, (_, i) => gameOfDay(new Date(Date.UTC(2026, 10, 19 + i, 10)), g7));
ok(new Set(days).size > 1, `the game changes over a week (${days})`);
ok(g7.includes(gameOfDay(new Date(), g7)), "always one of the ids");

// the catalog copy (spec table) and names
const TAGS: Record<string, string> = {
  football: "مباراة ٥ ضد ٥. مرّر وسدّد وافتك الكورة",
  pool: "دخّل كراتك قبل خصمك",
  bowling: "الكل يرمي سوا · منو يطيّح أكثر؟",
  hoops: "سجّل ورا بعض وتولّع",
  golf: "دخّلها بأقل ضربات",
};
for (const [id, tag] of Object.entries(TAGS)) ok(CATALOG.find((g) => g.id === id)?.tag === tag, `${id} description`);
ok(CATALOG.find((g) => g.kind === "cards")?.tag === "خلّص ورقك وصيح كش!", "cards description");
const boards = CATALOG.filter((g) => g.kind === "board");
ok(boards.some((g) => g.tag === "لوحة نجوم وألعاب صغيرة") && boards.some((g) => g.tag === "أول واحد يوصل التاج"), "board descriptions");
ok(CATALOG.every((g) => !g.badge || g.badge === "جديد"), "badges are only «جديد»");
ok(SPORT_NAMES.football === "كرة البط", `football is called كرة البط (${SPORT_NAMES.football})`);

console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
