import { ranked } from "../shared/rules";
import type { GameState } from "../shared/types";

/** This device's player: no accounts, the profile and the win record live in localStorage. Every phone sends its
 *  profile id when it joins a room, so each phone can keep its own record against the people it plays with. */
export interface Profile {
  id: string;
  name: string;
  duck: number;
}

/** Wins / losses against one person (another device), overall and per game. */
export interface Rival {
  name: string;
  duck: number;
  last: number;
  w: number;
  l: number;
  games: Record<string, { w: number; l: number }>;
}

interface Store {
  v: 1;
  /** games played / won per game id (also against the computer) */
  games: Record<string, { played: number; won: number }>;
  rivals: Record<string, Rival>;
  /** games already counted (room code + end seq), so a reload doesn't count twice */
  seen: string[];
}

const P_KEY = "duck-profile";
const R_KEY = "duck-record";
const read = <T>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null");
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: the record just isn't kept */
  }
};

export function profile(): Profile {
  const p = read<Profile>(P_KEY);
  if (p?.id) {
    // the join form keeps writing the name here
    const n = localStorage.getItem("duck-name");
    return n !== null && n !== p.name ? { ...p, name: n } : p;
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, "0")).join("");
  const fresh = { id, name: localStorage.getItem("duck-name") ?? "", duck: 0 };
  write(P_KEY, fresh);
  return fresh;
}

export function saveProfile(p: Partial<Profile>) {
  const next = { ...profile(), ...p };
  write(P_KEY, next);
  if (p.name !== undefined) localStorage.setItem("duck-name", p.name);
  return next;
}

function store(): Store {
  const s = read<Store>(R_KEY);
  return s?.v === 1 ? s : { v: 1, games: {}, rivals: {}, seen: [] };
}

/** Count a finished game once: games played / won, and a win or loss against every other person in it. */
export function recordGame(s: GameState, me: string) {
  if (s.phase !== "end") return;
  const key = `${s.code}:${s.seq}`;
  const st = store();
  if (st.seen.includes(key)) return;
  const order = ranked(s);
  const mine = order.findIndex((p) => p.id === me);
  if (mine < 0) return;
  const won = s.winnerIds ? s.winnerIds.includes(me) : mine === 0;
  if (!Object.hasOwn(st.games, s.boardId)) st.games[s.boardId] = { played: 0, won: 0 };
  const g = st.games[s.boardId];
  g.played++;
  if (won) g.won++;
  const myScore = score(s, me);
  order.forEach((p, i) => {
    if (p.id === me || p.isBot || !validId(p.profileId)) return;
    // a tie (same score, or both winners) counts for nobody
    // (football decided on penalties: same goals, but one side won, so it is not a tie)
    if (myScore !== null && myScore === score(s, p.id) && won === !!s.winnerIds?.includes(p.id)) return;
    if (won && s.winnerIds?.includes(p.id)) return;
    if (!Object.hasOwn(st.rivals, p.profileId)) st.rivals[p.profileId] = { name: p.name, duck: p.duck, last: 0, w: 0, l: 0, games: {} };
    const r = st.rivals[p.profileId];
    r.name = p.name;
    r.duck = p.duck;
    r.last = Date.now();
    if (!Object.hasOwn(r.games, s.boardId)) r.games[s.boardId] = { w: 0, l: 0 };
    const rg = r.games[s.boardId];
    if (mine < i) {
      r.w++;
      rg.w++;
    } else {
      r.l++;
      rg.l++;
    }
  });
  st.seen = [...st.seen.slice(-60), key];
  write(R_KEY, st);
}

/** a comparable final score where the game has one (sports totals), for tie detection */
function score(s: GameState, id: string): number | null {
  return s.sport ? (s.sport.total[id] ?? null) : null;
}

const validId = (id: string | undefined): id is string => !!id && /^[0-9a-f]{8,40}$/.test(id);
export const rivalOf = (profileId: string | undefined) => (validId(profileId) && Object.hasOwn(store().rivals, profileId) ? store().rivals[profileId] : undefined);
export const rivals = () => Object.entries(store().rivals).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.w + b.l - (a.w + a.l) || b.last - a.last);
export const gameStats = (gameId: string) => (Object.hasOwn(store().games, gameId) ? store().games[gameId] : { played: 0, won: 0 });
export const totalWins = () => Object.values(store().games).reduce((a, g) => a + g.won, 0);
export const totalPlayed = () => Object.values(store().games).reduce((a, g) => a + g.played, 0);
