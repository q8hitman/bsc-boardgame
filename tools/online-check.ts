// Checks the online server end to end: connect, create a room, join it from a second phone.
// Usage: npx tsx tools/online-check.ts [url]
import { io } from "socket.io-client";
const url = process.argv[2] ?? "https://bsc-boardgame.onrender.com";
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const a = io(url, { transports: ["websocket", "polling"] });
a.on("connect", () => console.log(ms(), "connected", a.id));
a.on("connect_error", (e) => console.log(ms(), "connect_error", e.message));
a.timeout(30000).emit("room:create", { name: "فحص", profileId: "abcdef12", char: "fayzah" }, (err: unknown, res: any) => {
  console.log(ms(), "room:create", err ? "NO ANSWER " + String(err) : JSON.stringify(res));
  if (err || !res?.ok) process.exit(1);
  const b = io(url, { transports: ["websocket", "polling"] });
  b.timeout(30000).emit("player:join", { code: res.code, name: "ثاني", profileId: "abcdef13", char: "ali" }, (e2: unknown, r2: any) => {
    console.log(ms(), "player:join", e2 ? "NO ANSWER" : JSON.stringify(r2));
    process.exit(e2 || !r2?.ok ? 1 : 0);
  });
});
setTimeout(() => (console.log(ms(), "gave up"), process.exit(2)), 70000);
