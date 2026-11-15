import { io, type Socket } from "socket.io-client";
import type { ClientToServer, GameState, ServerToClient } from "../shared/types";

export type ClientSocket = Socket<ServerToClient, ClientToServer>;

export function connect(): ClientSocket {
  return io({ transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 500 });
}

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
  `<img class="ic ic-${name}${px >= 56 ? " anim" : ""}" src="/assets/icons/${name}.png" alt="" style="height:${px}px;width:${px}px">`;
export const tokenImg = (duck: number, px = 120) =>
  `<img class="ic tok${px >= 56 ? " anim" : ""}" src="/assets/tokens/token${duck}.png" alt="" style="height:${px}px">`;
