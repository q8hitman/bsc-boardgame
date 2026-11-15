import type { ItemId, LandmarkId, MinigameId, TileType } from "./types";
import islandJson from "./board-island.json";
import snakesJson from "./board-snakes.json";
import type { Board } from "./types";

export const BOARDS: Record<string, Board> = { island: islandJson as Board, snakes: snakesJson as unknown as Board };

/** Player pieces: cartoon figures rendered in Blender (tools/blender/tokens_toon.py), one color per slot.
 *  `ref` = the film / series / game the piece is a homage to (shown in the lobby and the piece picker). */
export const DUCKS: { name: string; color: string; dark: string; ref?: string }[] = [
  { name: "البطة", color: "#FFD93B", dark: "#7A5A00" },
  { name: "البيضة", color: "#FF5A4A", dark: "#7A2010" },
  { name: "الفطر", color: "#2FD08C", dark: "#0F5A3C" },
  { name: "الدورق", color: "#9B7BFF", dark: "#3A2290" },
  { name: "DNA", color: "#3AA8FF", dark: "#0C4A7A" },
  { name: "الحلزون", color: "#FF7DBE", dark: "#7A1F4F" },
  { name: "السمكة", color: "#FF9A1F", dark: "#7A4100" },
  { name: "البلوطة", color: "#F2EEE4", dark: "#5A5650" },
  { name: "غاندالف الضفدع", color: "#A7AEBB", dark: "#4A505C", ref: "سيد الخواتم" },
  { name: "سلحفاة النينجا", color: "#8BD346", dark: "#3D6A12", ref: "سلاحف النينجا" },
  { name: "الكابتن سبارو", color: "#00C2B8", dark: "#005A55", ref: "قراصنة الكاريبي" },
  { name: "بز النحلة", color: "#B05BD8", dark: "#4E1A6A", ref: "حكاية لعبة" },
  { name: "مستر كراب", color: "#7FE3FF", dark: "#1C6A82", ref: "سبونج بوب" },
  { name: "البطريق 007", color: "#3D3D55", dark: "#15151F", ref: "جيمس بوند" },
  { name: "شيرلوك البومة", color: "#A0522D", dark: "#4A2210", ref: "شيرلوك هولمز" },
  { name: "بكتيريا مينيون", color: "#2E5FA8", dark: "#0F2A55", ref: "المينيونز" },
  { name: "دارث بطوط", color: "#B3122E", dark: "#4A0612", ref: "حرب النجوم" },
];
export const MAX_PLAYERS = 8;

export const STAR_COST = 20;
export const START_CRUMBS = 10;

export const TILE_INFO: Record<TileType, { label: string; color: string; side: string; icon: string }> = {
  blue: { label: "فتات", color: "#5EC8FF", side: "#2A86C4", icon: "" },
  red: { label: "مصيبة", color: "#FF6B6B", side: "#C23434", icon: "!" },
  event: { label: "حدث", color: "#B596FF", side: "#7046D6", icon: "?" },
  box: { label: "صندوق", color: "#FFCE3D", side: "#C8900A", icon: "+" },
  duel: { label: "مبارزة", color: "#FF8EC6", side: "#C9468A", icon: "VS" },
  fork: { label: "تفرع", color: "#FFFFFF", side: "#9A9A9A", icon: "⇆" },
  lighthouse: { label: "المنارة", color: "#7CF0A0", side: "#2FA35A", icon: "✦" },
  shop: { label: "دكان", color: "#FF9A3C", side: "#B8561A", icon: "" },
  wheel: { label: "عجلة الحظ", color: "#FF5FD2", side: "#A82F8E", icon: "؟" },
  landmark: { label: "مكان", color: "#3FD1C9", side: "#1E7F7A", icon: "" },
};

/** Map features with their own effect. `at` = centre of the photo crop in map-image pixels (1672x941). */
export const LANDMARKS: Record<LandmarkId, { name: string; at: [number, number] }> = {
  fountain: { name: "نافورة الأمنيات", at: [745, 420] },
  farm: { name: "مزرعة البقرة", at: [1260, 160] },
  cave: { name: "الكهف السري", at: [890, 130] },
  zipline: { name: "الحبل الطاير", at: [1340, 520] },
  boat: { name: "قارب البركة", at: [965, 440] },
  waterfall: { name: "الشلال", at: [215, 560] },
};

export const SHOP_STOCK: { item: ItemId; price: number }[] = [
  { item: "doubleDice", price: 5 },
  { item: "tripleDice", price: 10 },
  { item: "shield", price: 4 },
  { item: "steal", price: 7 },
  { item: "starGate", price: 15 },
];

/** Wheel of fortune: 8 equal slices on screen; `weight` sets how often the server picks each. */
export const WHEEL = [
  { id: "plus", label: "+١٢ فتات", color: "#7CF0A0", weight: 16 },
  { id: "minus", label: "-١٠ فتات", color: "#FF7A7A", weight: 14 },
  { id: "star", label: "نجمة!", color: "#FFD23F", weight: 5 },
  { id: "loseStar", label: "تخسر نجمة", color: "#B596FF", weight: 8 },
  { id: "swap", label: "تبدّل مع الأول", color: "#5EC8FF", weight: 13 },
  { id: "item", label: "غرض ببلاش", color: "#FF9A3C", weight: 16 },
  { id: "tax", label: "الكل يعطيك ٣", color: "#7FE3FF", weight: 14 },
  { id: "gift", label: "تعطي الكل ٣", color: "#FF8EC6", weight: 14 },
] as const;

export const ITEMS: Record<ItemId, { name: string; desc: string; icon: string }> = {
  doubleDice: { name: "نرد مضاعف", desc: "ترمي نردين بدال واحد", icon: "dice" },
  shield: { name: "درع", desc: "يحميك من أول مصيبة", icon: "shield" },
  steal: { name: "سرقة", desc: "تسرق ٥ فتات من لاعب تختاره", icon: "glove" },
  tripleDice: { name: "نرد ثلاثي", desc: "ترمي ٣ نردات", icon: "dice" },
  starGate: { name: "بوابة النجمة", desc: "تنقلك لين جنب النجمة", icon: "star" },
};

export const MINIGAMES: Record<
  MinigameId,
  { title: string; howTo: string; kind: string; durationMs: number; icon: string }
> = {
  tenSeconds: {
    title: "١٠ ثواني",
    howTo: "العداد بيختفي. اضغط لما تحس إن مر ١٠ ثواني بالضبط",
    kind: "تقدير",
    durationMs: 16000,
    icon: "clock",
  },
  dontWake: {
    title: "لا تقوم!",
    howTo: "لا تضغط لين يصيح الديك. اللي يستعجل يطير",
    kind: "سرعة",
    durationMs: 9000,
    icon: "rooster",
  },
  mash: {
    title: "سباق التجديف",
    howTo: "اضغط بأسرع ما تقدر عشان قاربك يسبق",
    kind: "سرعة يد",
    durationMs: 7000,
    icon: "boat",
  },
  pushLuck: {
    title: "اوقف ولا كمّل",
    howTo: "كل ضغطة تضاعف فتاتك، بس الثعلب ممكن ياكلها كلها. وقّف بالوقت الصح",
    kind: "مخاطرة",
    durationMs: 15000,
    icon: "fox",
  },
};
export const MINIGAME_ROTATION: MinigameId[] = ["tenSeconds", "dontWake", "pushLuck", "mash"];
export const MG_REWARDS = [10, 6, 4, 2];

export const EVENTS = [
  { id: "snap", title: "Thanos Snap", text: "الكل يخسر نص فتاته" },
  { id: "storm", title: "عاصفة!", text: "العاصفة لخبطت أماكن الكل" },
  { id: "generous", title: "هدية البحر", text: "آخر واحد بالترتيب ياخذ ١٠ فتات" },
  { id: "hunter", title: "الصياد", text: "الصياد ياخذ ١٠ فتات من اللي بالصدارة" },
  { id: "rain", title: "مطر خبز", text: "الكل ياخذ ٥ فتات" },
] as const;
