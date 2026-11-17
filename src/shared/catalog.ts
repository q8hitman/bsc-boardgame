import { CARD_GAME } from "./cards";
import { BOARDS } from "./data";
import { CARDS_ID } from "./rules";
import { SPORTS } from "./sports";

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
  { id: "bowling", name: SPORTS.bowling.name, kind: "sport", tag: "كلكم ترمون بنفس الوقت · سترايك!", players: "١–٨", minutes: "٣ د", badge: "جديد" },
  { id: "hoops", name: SPORTS.hoops.name, kind: "sport", tag: "اسحب لفوق وسجّل · سلسلة نار!", players: "١–٨", minutes: "٢ د", badge: "جديد" },
  { id: "golf", name: SPORTS.golf.name, kind: "sport", tag: "ميني قولف بملاعب مختلفة", players: "١–٨", minutes: "٥ د", badge: "جديد" },
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
