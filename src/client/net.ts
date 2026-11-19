import { io, type Socket } from "socket.io-client";
import type { ClientToServer, GameState, ServerToClient } from "../shared/types";
import { serverUrl } from "./config";
import { CLUB } from "../shared/football/club";
import { BOARDS } from "../shared/data";

export type ClientSocket = Socket<ServerToClient, ClientToServer>;

/** One-device mode plugs an in-page server in here (see local-server.ts). */
let localConnect: (() => ClientSocket) | null = null;
export const setLocalConnect = (fn: () => ClientSocket) => (localConnect = fn);
export const isLocal = () => !!localConnect;

export function connect(): ClientSocket {
  if (localConnect) return localConnect();
  const opts = { transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 500 };
  const url = serverUrl();
  return url ? io(url, opts) : io(opts);
}

/** The link friends open to join a room: this same page with ?join=CODE (keeps /bsc-boardgame/ on GitHub Pages). */
export const joinUrl = (code: string) => `${location.origin}${location.pathname}?join=${code}`;

/** Tracks server clock offset so timed minigames start together on every device. */
export class Clock {
  offset = 0; // serverNow - localNow
  update(s: GameState) {
    if (s.serverNow) {
      const o = s.serverNow - Date.now();
      // keep the smallest latency sample: large jumps only when clocks really changed
      this.offset = Math.abs(o - this.offset) > 1500 ? o : this.offset * 0.7 + o * 0.3;
    }
  }
  toLocal(serverMs: number) {
    return serverMs - this.offset;
  }
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const ar = (n: number | string) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);

/** Cartoon icon rendered in Blender (public/assets/icons), used instead of emoji so it looks the same on every device. */
export const icon = (name: string, px = 28) =>
  `<img class="ic ic-${name}${px >= 56 ? " anim" : ""}" src="assets/icons/${name}.png" alt="" style="height:${px}px;width:${px}px">`;
/** The room's game and its people's ducks: pawns belong to board games; in any other game a player's picture is
 *  their duck (the club character from their account; a bot or an older client gets a club character by seat). */
let facesBoard = true;
let facesByDuck = new Map<number, string>();
export function setFaces(s: { boardId: string; players: { duck: number; char?: string }[] }) {
  facesBoard = !!BOARDS[s.boardId];
  facesByDuck = new Map(s.players.filter((p) => p.char).map((p) => [p.duck, p.char!]));
}
/** the picture for a seat (pawn index): its pawn in a board game, its player's duck otherwise */
export const pieceSrc = (duck: number) =>
  facesBoard ? `assets/tokens/token${duck}.png` : `assets/heads/${facesByDuck.get(duck) ?? CLUB[((duck % CLUB.length) + CLUB.length) % CLUB.length].id}.png`;
export const tokenImg = (duck: number, px = 120) =>
  `<img class="ic tok${px >= 56 ? " anim" : ""}" src="${pieceSrc(duck)}" alt="" style="height:${px}px">`;
