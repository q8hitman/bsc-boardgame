import type { Room } from "../server/room";
import { type GameIO, type GameSocket, wireSocket } from "../server/wire";

/** One-device mode: the game server runs inside this page. Screens and phones talk to it through in-memory
 *  sockets that behave like socket.io (async delivery, callbacks, copies of every message). */
type Fn = (...args: unknown[]) => void;
const later = (fn: () => void) => setTimeout(fn, 0);
// every message is copied, like it would be over the network (the display compares old and new state)
const copy = <T>(v: T): T => (typeof v === "object" && v !== null ? structuredClone(v) : v);
const wrapArgs = (args: unknown[]) => args.map((a) => (typeof a === "function" ? (...r: unknown[]) => later(() => (a as Fn)(...r.map(copy))) : copy(a)));

class ServerEnd implements GameSocket {
  data: GameSocket["data"] = {};
  rooms = new Set<string>();
  handlers = new Map<string, Fn>();
  constructor(public id: string, private toClient: (ev: string, args: unknown[]) => void) {}
  join(room: string) {
    this.rooms.add(room);
  }
  emit(ev: string, ...args: unknown[]) {
    this.toClient(ev, args);
  }
  on(ev: string, fn: Fn) {
    this.handlers.set(ev, fn);
  }
}

export class LocalClient {
  connected = true;
  private handlers = new Map<string, Fn[]>();
  constructor(public id: string, private server: ServerEnd) {
    later(() => this.fire("connect", []));
  }
  on(ev: string, fn: Fn) {
    (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(fn);
    return this;
  }
  emit(ev: string, ...args: unknown[]) {
    const h = this.server.handlers.get(ev);
    const a = wrapArgs(args);
    if (h) later(() => h(...a));
    return this;
  }
  /** delivered by the server */
  fire(ev: string, args: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) fn(...args);
  }
}

export class LocalServer {
  rooms = new Map<string, Room>();
  private ends: ServerEnd[] = [];
  private n = 0;
  private io: GameIO = {
    to: (target: string) => ({
      emit: (ev: string, ...args: unknown[]) => {
        for (const e of this.ends) if (e.id === target || e.rooms.has(target)) e.emit(ev, ...args);
      },
    }),
  } as GameIO;

  connect(): LocalClient {
    const id = "local-" + ++this.n;
    let client: LocalClient | null = null;
    const end = new ServerEnd(id, (ev, args) => {
      const a = wrapArgs(args);
      later(() => client?.fire(ev, a));
    });
    this.ends.push(end);
    client = new LocalClient(id, end);
    wireSocket(this.io, end, this.rooms, false);
    return client;
  }

  /** the first (only) room: created by the screen */
  get room(): Room | undefined {
    return this.rooms.values().next().value;
  }
}

/** Set while the page runs in one-device mode; `connect()` in net.ts then talks to this instead of the network. */
export let localServer: LocalServer | null = null;
export function useLocalServer() {
  localServer = new LocalServer();
  return localServer;
}
