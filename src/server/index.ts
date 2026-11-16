import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type { ClientToServer, ServerToClient } from "../shared/types";
import type { Room } from "./room";
import { type GameIO, type GameSocket, wireSocket } from "./wire";

// In dev Vite owns PORT and proxies to 3001. In production (`npm start`) the server serves everything on PORT.
const PROD = process.argv.includes("--prod");
const PORT = Number(PROD ? process.env.PORT ?? 3001 : process.env.DUCK_SERVER_PORT ?? 3001);
const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: "*" } });

const rooms = new Map<string, Room>();
const DEV = process.argv.includes("--dev");

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

io.on("connection", (sock) => wireSocket(io as unknown as GameIO, sock as unknown as GameSocket, rooms, DEV));

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
