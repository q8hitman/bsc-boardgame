// The win record kept on each phone: counting a finished game once, wins/losses against each person, ties, bots.
// Run: npx tsx tools/profile-sim.ts
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
const { recordGame, rivalOf, gameStats, totalWins, profile } = await import("../src/client/profile");
import type { GameState, Player } from "../src/shared/types";

let fails = 0;
const ok = (c: unknown, w: string) => {
  if (!c) fails++;
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
};
const pl = (id: string, profileId?: string, isBot = false): Player => ({
  id, name: id, duck: 0, node: 0, crumbs: 0, stars: 0, items: [], isBot, isHost: false, connected: true, shielded: false,
  stats: { minigameWins: 0, stolenFrom: 0, risks: 0 }, profileId,
});
const sportGame = (seq: number, totals: Record<string, number>, better: "high" | "low" = "high"): GameState => {
  const vals = Object.values(totals);
  const best = better === "high" ? Math.max(...vals) : Math.min(...vals);
  return {
    code: "ABCD", phase: "end", phaseEndsAt: null, round: 5, maxRounds: 5, players: [pl("me", "aaaa0000me"), pl("ali", "bbbb0000a1a1"), pl("bot", undefined, true), pl("noor", "cccc0000d00d")],
    order: [], turnIdx: 0, starNode: -1, boardId: "bowling", seq, anim: { kind: "none" }, screen: false,
    winnerIds: Object.keys(totals).filter((k) => totals[k] === best),
    sport: { id: "bowling", round: 4, rounds: 5, lanes: {}, cards: {}, total: totals, busyUntil: {}, open: [], better },
  } as GameState;
};

ok(profile().id.length >= 12, "a profile id is created");
recordGame(sportGame(10, { me: 90, ali: 70, bot: 120, noor: 95 }), "me");
ok(gameStats("bowling").played === 1 && gameStats("bowling").won === 0, "played 1, not won (the bot won)");
ok(rivalOf("bbbb0000a1a1")?.w === 1 && rivalOf("bbbb0000a1a1")?.l === 0, "beat Ali");
ok(rivalOf("cccc0000d00d")?.l === 1 && rivalOf("cccc0000d00d")?.games.bowling.l === 1, "lost to Noor (also in this game's record)");
ok(!rivalOf(undefined), "bots have no record");
recordGame(sportGame(10, { me: 90, ali: 70, bot: 120, noor: 95 }), "me");
ok(gameStats("bowling").played === 1 && rivalOf("bbbb0000a1a1")?.w === 1, "the same game is never counted twice (reload on the end screen)");
recordGame(sportGame(22, { me: 130, ali: 130, bot: 60, noor: 100 }), "me");
ok(gameStats("bowling").won === 1 && totalWins() === 1, "a shared first place counts as a win");
ok(rivalOf("bbbb0000a1a1")?.w === 1 && rivalOf("bbbb0000a1a1")?.l === 0, "a tie with Ali counts for nobody");
ok(rivalOf("cccc0000d00d")?.w === 1 && rivalOf("cccc0000d00d")?.l === 1, "Noor: 1 – 1");
// a crafted profile id from another phone must not touch the record (it is used as an object key)
const evil = sportGame(40, { me: 50, ali: 10, bot: 5, noor: 1 });
evil.players[1].profileId = "__proto__";
evil.players[3].profileId = "constructor";
recordGame(evil, "me");
ok(({} as Record<string, unknown>).w === undefined && !rivalOf("__proto__") && !rivalOf("constructor"), "\"__proto__\" / \"constructor\" ids are ignored, nothing leaks onto Object.prototype");
console.log(fails ? `FAIL (${fails})` : "PASS");
process.exit(fails ? 1 : 0);
