import type { GameState } from "../../../shared/types";
import { createFootballView } from "../football-view";
import { FakeMatch } from "./dev-fake";

/** DEV ONLY: mounts the football view on a fake match. Query: mode=screen|personal, ctrl=1 (show controls),
 *  only=1 (controller-only pad), sound=1, stage=pens|halftime|over, half=<seconds>, goal=<seconds> (force a shot). */
const q = new URLSearchParams(location.search);
const mode = (q.get("mode") ?? "screen") as "screen" | "personal";
const me = "me";
const match = new FakeMatch(
  [
    { pid: me, name: "سارة", team: 0, char: "fayzah" },
    { pid: "p2", name: "بدر", team: 1, char: "camel" },
  ],
  { halves: 2, halfSeconds: +(q.get("half") ?? 180), stage: q.get("stage") ?? undefined },
);
const box = document.getElementById("box")!;
const view = createFootballView(box, { mode, me: () => (mode === "screen" && !q.get("me") ? "" : me), sound: q.get("sound") === "1", serverNow: () => Date.now(), controllerOnly: q.get("only") === "1" });
const gs = () => ({ phase: "sport", boardId: "football", football: JSON.parse(JSON.stringify(match.st)) }) as unknown as GameState;
view.render(gs());
if (q.get("ctrl") === "1" || q.get("only") === "1")
  view.setControl?.((i) => {
    match.input(me, i);
    (window as unknown as { lastInput: unknown }).lastInput = i;
  });
let acc = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  while (acc > 1 / 60) {
    match.step(1 / 60);
    acc -= 1 / 60;
  }
  if (match.changed) {
    match.changed = false;
    view.render(gs());
  }
}, 16);
setInterval(() => view.fbFrame?.(match.frame()), 66);
(window as unknown as { fb: unknown }).fb = { match, view };
