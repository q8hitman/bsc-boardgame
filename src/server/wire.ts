import type { ClientToServer, ServerToClient } from "../shared/types";
import { Room } from "./room";

/** The bits of socket.io the game uses. Real sockets (server) and in-browser sockets (one-device mode) both fit. */
export interface GameSocket {
  id: string;
  data: { code?: string; playerId?: string };
  join(room: string): void;
  emit<E extends keyof ServerToClient>(ev: E, ...args: Parameters<ServerToClient[E]>): void;
  on<E extends keyof ClientToServer>(ev: E, fn: ClientToServer[E]): void;
  on(ev: "disconnect", fn: () => void): void;
}
export interface GameIO {
  to(room: string): { emit<E extends keyof ServerToClient>(ev: E, ...args: Parameters<ServerToClient[E]>): void };
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newCode(rooms: Map<string, Room>) {
  for (;;) {
    const c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
    if (!rooms.has(c)) return c;
  }
}

/** Connect one socket to the rooms: every message a screen or phone can send. */
export function wireSocket(io: GameIO, sock: GameSocket, rooms: Map<string, Room>, dev: boolean) {
  const room = () => (sock.data.code ? rooms.get(sock.data.code) : undefined);
  const asHost = (fn: (r: Room) => void) => () => {
    const r = room();
    if (r && sock.data.playerId && r.isHost(sock.data.playerId)) fn(r);
  };
  const me = () => sock.data.playerId;
  // anything can arrive over the network: a missing callback or a non-string must never throw (it would stop the server)
  type Cb<T> = (res: T) => void;
  const ack = <T>(cb: unknown): Cb<T> => (typeof cb === "function" ? (cb as Cb<T>) : () => {});
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  /** a phone that makes or joins another room leaves the one it was in */
  const leaveCurrent = () => {
    const r = room();
    if (r && me()) r.leave(me()!);
    sock.data.playerId = undefined;
  };

  sock.on("screen:create", (cb) => {
    const code = newCode(rooms);
    const r = new Room(io, code);
    rooms.set(code, r);
    sock.data.code = code;
    r.attachScreen(sock);
    ack<{ code: string; token: string }>(cb)({ code, token: r.screenToken });
  });
  sock.on("room:create", (data, cb) => {
    leaveCurrent();
    const code = newCode(rooms);
    const r = new Room(io, code, { screen: false });
    rooms.set(code, r);
    sock.data.code = code;
    const res = r.join(sock, str(data?.name), undefined, str(data?.profileId));
    ack<Parameters<Parameters<ClientToServer["room:create"]>[1]>[0]>(cb)(res.ok ? { ...res, code } : res);
  });
  sock.on("screen:resume", (data, cb) => {
    const done = ack<boolean>(cb);
    const r = rooms.get((str(data?.code) ?? "").toUpperCase());
    if (!r || r.screenToken !== data?.token) return done(false);
    sock.data.code = r.code;
    r.attachScreen(sock);
    done(true);
  });
  sock.on("player:join", (data, cb) => {
    const done = ack<Parameters<Parameters<ClientToServer["player:join"]>[1]>[0]>(cb);
    const r = rooms.get((str(data?.code) ?? "").toUpperCase().trim());
    if (!r) return done({ ok: false, error: "ما لقينا غرفة بهالرمز" });
    if (sock.data.code && sock.data.code !== r.code) leaveCurrent();
    sock.data.code = r.code;
    done(r.join(sock, str(data?.name), str(data?.token), str(data?.profileId)));
  });

  sock.on("host:addBot", asHost((r) => r.addBot()));
  sock.on("host:removeBot", asHost((r) => r.removeBot()));
  sock.on("host:setRounds", (n) => asHost((r) => r.setRounds(n))());
  sock.on("host:start", asHost((r) => r.start()));
  sock.on("host:skip", asHost((r) => r.skip()));
  sock.on("host:restart", asHost((r) => r.restart()));
  sock.on("host:setPlaying", (v) => me() && room()?.setPlaying(me()!, !!v));
  sock.on("host:setBoard", (id) => asHost((r) => r.setBoard(String(id)))());

  sock.on("player:rename", (name) => me() && room()?.rename(me()!, String(name)));
  sock.on("player:pickPiece", (i) => me() && room()?.pickPiece(me()!, Number(i)));
  sock.on("player:roll", () => me() && room()?.roll(me()!));
  sock.on("player:useItem", (item) => me() && room()?.useItem(me()!, item));
  sock.on("player:choose", (to) => me() && room()?.choose(me()!, Number(to)));
  sock.on("player:buy", (yes) => me() && room()?.buy(me()!, !!yes));
  sock.on("player:target", (id) => me() && room()?.target(me()!, String(id)));
  sock.on("player:shopBuy", (item) => me() && room()?.shopBuy(me()!, item ?? null));
  sock.on("player:spin", () => me() && room()?.spin(me()!));
  sock.on("card:play", (d) => me() && room()?.cardGame.play(me()!, Number(d?.id), d?.color));
  sock.on("card:draw", () => me() && room()?.cardGame.draw(me()!));
  sock.on("card:keep", () => me() && room()?.cardGame.keep(me()!));
  sock.on("card:kwak", () => me() && room()?.cardGame.kwak(me()!));
  sock.on("sport:shot", (shot) => me() && room()?.sports.shoot(me()!, shot));
  sock.on("host:setCourse", (id) => asHost((r) => r.setCourse(String(id)))());
  sock.on("mg:submit", (d) => me() && room()?.submit(me()!, Number(d?.score)));
  if (dev) {
    sock.on("dev:minigame", (id) => room()?.devMinigame(id));
    sock.on("dev:land", (n) => room()?.devLand(Number(n)));
    sock.on("dev:place", (n) => room()?.devPlace(Number(n)));
    sock.on("dev:dice", (v) => room()?.devDice(v));
  }
  sock.on("mg:ready", () => me() && room()?.ready(me()!));
  sock.on("mg:progress", (v) => me() && room()?.progress(me()!, Number(v)));
  sock.on("mg:push", (cb) => {
    const r = room();
    if (!r || !me()) return cb({ busted: true, pot: 0 });
    cb(r.push(me()!));
  });

  sock.on("disconnect", () => {
    const r = room();
    if (r && me()) r.leave(me()!);
  });
}
