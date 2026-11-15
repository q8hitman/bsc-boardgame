import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type { ClientToServer, ServerToClient } from "../shared/types";
import { Room } from "./room";

// In dev Vite owns PORT and proxies to 3001. In production (`npm start`) the server serves everything on PORT.
const PROD = process.argv.includes("--prod");
const PORT = Number(PROD ? process.env.PORT ?? 3001 : process.env.DUCK_SERVER_PORT ?? 3001);
const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: "*" } });

const rooms = new Map<string, Room>();
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
    if (!rooms.has(c)) return c;
  }
}

app.get("/api/lan", (_req, res) => {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
  }
  // prefer typical home / hotspot ranges
  ips.sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168.")));
  res.json({ ips });
});

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

io.on("connection", (sock) => {
  const room = () => (sock.data.code ? rooms.get(sock.data.code) : undefined);
  const asHost = (fn: (r: Room) => void) => () => {
    const r = room();
    if (r && sock.data.playerId && r.isHost(sock.data.playerId)) fn(r);
  };
  const me = () => sock.data.playerId as string | undefined;

  sock.on("screen:create", (cb) => {
    const code = newCode();
    const r = new Room(io, code);
    rooms.set(code, r);
    sock.data.code = code;
    r.attachScreen(sock);
    cb({ code, token: r.screenToken });
  });
  sock.on("screen:resume", ({ code, token }, cb) => {
    const r = rooms.get(code?.toUpperCase());
    if (!r || r.screenToken !== token) return cb(false);
    sock.data.code = r.code;
    r.attachScreen(sock);
    cb(true);
  });
  sock.on("player:join", ({ code, name, token }, cb) => {
    const r = rooms.get((code ?? "").toUpperCase().trim());
    if (!r) return cb({ ok: false, error: "ما لقينا غرفة بهالرمز" });
    sock.data.code = r.code;
    const res = r.join(sock, name, token);
    cb(res);
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
  sock.on("mg:submit", (d) => me() && room()?.submit(me()!, Number(d?.score)));
  if (process.argv.includes("--dev")) sock.on("dev:minigame", (id) => room()?.devMinigame(id));
  if (process.argv.includes("--dev")) sock.on("dev:land", (n) => room()?.devLand(Number(n)));
  if (process.argv.includes("--dev")) sock.on("dev:place", (n) => room()?.devPlace(Number(n)));
  if (process.argv.includes("--dev")) sock.on("dev:dice", (v) => room()?.devDice(v));
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
});

// drop idle rooms after 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.lastActivity > 2 * 60 * 60 * 1000) {
      r.dispose();
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

http.listen(PORT, "0.0.0.0", () => console.log(`duck-party server on :${PORT}`));
