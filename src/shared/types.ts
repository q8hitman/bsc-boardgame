export type TileType = "blue" | "red" | "event" | "box" | "duel" | "fork" | "lighthouse" | "shop" | "wheel" | "landmark";
export type LandmarkId = "fountain" | "farm" | "cave" | "zipline" | "boat" | "waterfall";

export interface BoardNode {
  id: number;
  x: number;
  y: number;
  next: number[];
  type: TileType;
  choices?: { to: number; label: string }[];
  /** map feature this tile belongs to (cave, zipline...) */
  landmark?: LandmarkId;
  /** where the landmark carries you */
  warpTo?: number;
  shopName?: string;
}

export interface Jump {
  from: number;
  to: number;
  kind: "snake" | "ladder";
  /** painted path in map-image pixels (snake body head -> tail, ladder bottom -> top) */
  path: [number, number][];
}

export interface Board {
  id: string;
  name: string;
  /** "party" (default): crumbs, stars, shops. "race": snakes & ladders, first to the last cell wins */
  mode?: "party" | "race";
  jumps?: Jump[];
  /** race boards: cell size in map-image pixels */
  cell?: [number, number];
  image: string;
  width: number;
  height: number;
  start: number;
  starSpots: number[];
  nodes: BoardNode[];
}

export type ItemId = "doubleDice" | "tripleDice" | "shield" | "steal" | "starGate";

export interface Player {
  id: string;
  name: string;
  duck: number; // index into DUCKS
  node: number;
  crumbs: number;
  stars: number;
  items: ItemId[];
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  shielded: boolean;
  stats: { minigameWins: number; stolenFrom: number; risks: number };
}

export type Phase =
  | "lobby"
  | "intro"
  | "turn" // waiting for current player to roll
  | "moving"
  | "choosePath"
  | "buyStar"
  | "pickTarget" // duel / steal target
  | "tile" // showing tile result
  | "shop" // current player is shopping
  | "wheel" // current player stops the wheel of fortune
  | "mgIntro"
  | "mgPlay"
  | "mgResults"
  | "final"
  | "end";

/** One-shot animation / announcement the display should play. Identified by seq. */
export type Anim =
  | { kind: "roll"; playerId: string; values: number[] }
  | { kind: "move"; playerId: string; path: number[]; rest?: number }
  | { kind: "tile"; playerId: string; tile: TileType; delta: number; text: string }
  | { kind: "event"; title: string; text: string; deltas: Record<string, number>; moves?: Record<string, number> }
  | { kind: "star"; playerId: string; bought: boolean; newStar: number }
  | { kind: "item"; playerId: string; item: ItemId; text: string; to?: number }
  | { kind: "wheel"; playerId: string; index: number; title: string; text: string; deltas: Record<string, number>; moves?: Record<string, number> }
  | { kind: "jump"; playerId: string; from: number; to: number; jump: "snake" | "ladder" }
  | { kind: "win"; playerId: string }
  | { kind: "landmark"; playerId: string; landmark: LandmarkId; title: string; text: string; delta: number; to?: number }
  | { kind: "banner"; title: string; text: string }
  | { kind: "none" };

export type MinigameId = "tenSeconds" | "dontWake" | "mash" | "pushLuck";

export interface MinigameState {
  id: MinigameId;
  participants: string[];
  /** server epoch ms when play phase starts (clients count down to it) */
  startAt: number;
  durationMs: number;
  /** reaction game: delay after start until signal */
  signalDelayMs?: number;
  submitted: Record<string, boolean>;
  /** live progress shown on the big screen (taps, bread pot...) */
  progress?: Record<string, number>;
  busted?: Record<string, boolean>;
  /** "ready?" check during the intro */
  ready?: Record<string, boolean>;
  results?: { playerId: string; score: number; display: string; reward: number; rank: number }[];
  duel?: boolean;
}

export interface GameState {
  code: string;
  phase: Phase;
  phaseEndsAt: number | null; // timer for current decision
  round: number;
  maxRounds: number;
  players: Player[];
  order: string[];
  turnIdx: number;
  starNode: number;
  boardId: string;
  seq: number;
  anim: Anim;
  /** current mover's remaining steps while moving */
  pendingChoice?: { playerId: string; options: { to: number; label: string }[] };
  pendingBuy?: { playerId: string; cost: number };
  pendingTarget?: { playerId: string; reason: "duel" | "steal" };
  pendingShop?: { playerId: string; name: string; stock: { item: ItemId; price: number }[] };
  pendingWheel?: { playerId: string };
  minigame?: MinigameState;
  winnerIds?: string[];
  bonuses?: { title: string; playerId: string }[];
  /** host who runs the game from their phone without playing (not in players) */
  organizer?: { id: string; name: string; connected: boolean };
  /** server clock at send time, for client clock offset */
  serverNow?: number;
}

// ---- socket messages ----
export interface ClientToServer {
  "screen:create": (cb: (res: { code: string; token: string }) => void) => void;
  "screen:resume": (data: { code: string; token: string }, cb: (ok: boolean) => void) => void;
  "player:join": (
    data: { code: string; name?: string; token?: string },
    cb: (res: { ok: true; playerId: string; token: string } | { ok: false; error: string }) => void,
  ) => void;
  "host:addBot": () => void;
  "host:removeBot": () => void;
  "host:setRounds": (n: number) => void;
  "host:start": () => void;
  "host:skip": () => void;
  "host:restart": () => void;
  "host:setPlaying": (playing: boolean) => void;
  "host:setBoard": (boardId: string) => void;
  "player:rename": (name: string) => void;
  "player:pickPiece": (piece: number) => void;
  "player:roll": () => void;
  "player:useItem": (item: ItemId) => void;
  "player:choose": (to: number) => void;
  "player:buy": (yes: boolean) => void;
  "player:target": (playerId: string) => void;
  "player:shopBuy": (item: ItemId | null) => void;
  "player:spin": () => void;
  "mg:submit": (data: { score: number }) => void;
  "mg:progress": (value: number) => void;
  "mg:ready": () => void;
  "dev:minigame": (id: MinigameId) => void;
  "dev:land": (node: number) => void;
  "dev:place": (node: number) => void;
  "dev:dice": (values: number[]) => void;
  "mg:push": (cb: (res: { busted: boolean; pot: number }) => void) => void;
}

export interface ServerToClient {
  state: (s: GameState) => void;
  you: (playerId: string) => void;
  kicked: (reason: string) => void;
}
