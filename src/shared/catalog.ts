import { CARD_GAME } from "./cards";
import { BOARDS } from "./data";
import { CARDS_ID } from "./rules";
import { SPORT_NAMES } from "./sports";

/** Every game in the hub, in menu order. `id` is what GameState.boardId holds while it's picked. */
export interface GameInfo {
  id: string;
  name: string;
  kind: "board" | "cards" | "sport";
  /** one line under the name */
  tag: string;
  /** "٢–٨" style player count and a rough length, shown on the game card */
  players: string;
  minutes: string;
  /** a word on the corner ribbon, e.g. "جديد" */
  badge?: string;
}

export const CATALOG: GameInfo[] = [
  { id: "football", name: SPORT_NAMES.football, kind: "sport", tag: "أعضاء النادي بالملعب · سريع أو كامل", players: "١–٨", minutes: "٣–١٠ د", badge: "جديد" },
  { id: "pool", name: SPORT_NAMES.pool, kind: "sport", tag: "اللي يدخّل كرات أكثر يفوز", players: "٢–٤", minutes: "٨ د", badge: "جديد" },
  { id: "bowling", name: SPORT_NAMES.bowling, kind: "sport", tag: "كلكم ترمون بنفس الوقت · سترايك!", players: "١–٨", minutes: "٣ د", badge: "جديد" },
  { id: "hoops", name: SPORT_NAMES.hoops, kind: "sport", tag: "اسحب لفوق وسجّل · سلسلة نار!", players: "١–٨", minutes: "٢ د", badge: "جديد" },
  { id: "golf", name: SPORT_NAMES.golf, kind: "sport", tag: "ميني قولف بملاعب مختلفة", players: "١–٨", minutes: "٥ د", badge: "جديد" },
  { id: CARDS_ID, name: CARD_GAME.name, kind: "cards", tag: "لعبة كروت سريعة · صيح كش!", players: "٢–٨", minutes: "٨ د" },
  ...Object.values(BOARDS).map<GameInfo>((b) => ({
    id: b.id,
    name: b.name,
    kind: "board",
    tag: b.mode === "race" ? "أول واحد يوصل التاج" : "اجمع الفتات واشتر النجوم + ميني قيمز",
    players: "٤ (الكمبيوتر يكمّل)",
    minutes: b.mode === "race" ? "١٥ د" : "٢٥ د",
  })),
];

export const gameInfo = (id: string) => CATALOG.find((g) => g.id === id);
export const gameName = (id: string) => gameInfo(id)?.name ?? id;
