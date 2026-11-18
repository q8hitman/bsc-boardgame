import Phaser from "phaser";
import type { FbEngine } from "../../../shared/football/engine";
import { TUNE } from "../../../shared/football/engine";
import { wx, wy } from "./geom";

/** DEVELOPMENT ONLY: the gameplay debug view. On with `?fbdebug` in the address, F2 shows / hides it.
 *  It reads the engine directly, so it works when the match runs in this browser (solo / one-device play); online
 *  the engine is on the server and only a note is shown.
 *  Draws: the ball (owner, position, velocity, height, its predicted path coloured by height), every duck's movement
 *  vector and collision circle, the computer's target for each duck, the controlled duck, and the pass the stick
 *  would play right now (target, lane, the other candidates). */
export const debugEnabled = () => typeof location !== "undefined" && /[?&]fbdebug\b/.test(location.search);

export class FootballDebug {
  private g: Phaser.GameObjects.Graphics;
  private t: Phaser.GameObjects.Text;
  private on = true;
  /** frame time, smoothed, and the worst frame in the last second */
  private ft = 16.7;
  private worst = 0;
  private worstShown = 0;
  private worstAt = 0;
  private lastAt = 0;
  private key = (e: KeyboardEvent) => {
    if (e.code === "F2") {
      e.preventDefault();
      this.on = !this.on;
      if (!this.on) {
        this.g.clear();
        this.t.setVisible(false);
      }
    }
  };

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(2e6);
    this.t = scene.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "11px", color: "#e8ffe8", backgroundColor: "rgba(0,0,0,0.6)" }).setDepth(2e6 + 1).setScrollFactor(0);
    addEventListener("keydown", this.key);
  }

  destroy() {
    removeEventListener("keydown", this.key);
  }

  draw(stick: { x: number; y: number } | null) {
    const now = performance.now();
    if (this.lastAt) {
      const f = now - this.lastAt;
      this.ft += (f - this.ft) * 0.1;
      this.worst = Math.max(this.worst, f);
      if (now - this.worstAt > 1000) {
        this.worstShown = this.worst;
        this.worst = 0;
        this.worstAt = now;
      }
    }
    this.lastAt = now;
    if (!this.on) return;
    const g = this.g;
    g.clear();
    const e = (globalThis as unknown as { __fbEngine?: FbEngine }).__fbEngine;
    const cam = this.scene.cameras.main;
    this.t.setVisible(true).setPosition(8, 8).setScale(1 / cam.zoom);
    if (!e) {
      this.t.setText("fbdebug: the match engine runs on the server (online). Play solo to see it.");
      return;
    }
    const b = e.ball;
    const P = (x: number, y: number, z = 0): [number, number] => [wx(x, z), wy(y, z)];
    // predicted path of a loose ball: green on the grass, orange in the air (too high to take)
    for (const p of e.path) {
      const [X, Y] = P(p.x, p.y, p.z);
      g.fillStyle(p.z > 0.9 ? 0xffa030 : 0x40ff70, 0.8).fillRect(X - 1, Y - 1, 3, 3);
    }
    // ducks: collision circle, velocity, computer target
    const ctrl = e.control();
    const mine = Object.values(ctrl);
    for (const d of e.ducks) {
      const [X, Y] = P(d.x, d.y);
      const r = TUNE.duckR * 24;
      g.lineStyle(1, d.team === 0 ? 0x5aa0ff : 0xff5a5a, 0.9).strokeEllipse(X, Y, r * 2, r);
      g.lineStyle(2, 0xffffff, 0.9).lineBetween(X, Y, ...P(d.x + d.vx * 0.3, d.y + d.vy * 0.3));
      if (!mine.includes(d.slot)) {
        g.lineStyle(1, 0xffff66, 0.35).lineBetween(X, Y, ...P(d.tx, d.ty));
        const [TX, TY] = P(d.tx, d.ty);
        g.fillStyle(0xffff66, 0.5).fillRect(TX - 2, TY - 2, 4, 4);
      } else g.lineStyle(2, 0xffe14a, 1).strokeCircle(X, Y - 30, 30);
    }
    // the pass the stick would play now (with the ball at a controlled duck's feet)
    let passInfo = "";
    const ownerSlot = b.owner;
    if (ownerSlot >= 0 && mine.includes(ownerSlot) && stick) {
      const d = e.ducks[ownerSlot];
      const sx = Math.hypot(stick.x, stick.y) > 0.3 ? stick.x : d.hx;
      const sy = Math.hypot(stick.x, stick.y) > 0.3 ? stick.y : d.hy;
      const to = e.pickPass(d, sx, sy, 26);
      for (const m of e.ducks) {
        if (m.team !== d.team || m === d) continue;
        const dist = Math.hypot(m.x - d.x, m.y - d.y);
        const cos = ((m.x - d.x) * sx + (m.y - d.y) * sy) / (dist * (Math.hypot(sx, sy) || 1));
        if (cos < 0.34) continue;
        g.lineStyle(1, 0x66ccff, 0.5).lineBetween(...P(d.x, d.y), ...P(m.x, m.y));
      }
      if (to >= 0) {
        const m = e.ducks[to];
        const risk = e.laneRisk(d, m.x, m.y);
        g.lineStyle(3, risk < 1 ? 0xff4040 : 0x40ff70, 0.9).lineBetween(...P(d.x, d.y), ...P(m.x, m.y));
        passInfo = `pass -> ${to}  lane ${risk.toFixed(1)} m`;
      } else passInfo = "pass -> into space";
    }
    // ball: velocity and height
    const [BX, BY] = P(b.x, b.y, b.z);
    g.lineStyle(2, 0xff40ff, 1).lineBetween(BX, BY, ...P(b.x + b.vx * 0.25, b.y + b.vy * 0.25, b.z));
    g.lineStyle(1, 0xff40ff, 0.6).lineBetween(BX, BY, ...P(b.x, b.y, 0));
    const sp = Math.hypot(b.vx, b.vy);
    const ACT = ["idle", "run", "kick", "slide", "dive", "celebrate", "fall", "kneel", "sprint", "trap", "skill", "tackle", "stagger"];
    const acts = mine.map((s) => {
      const d = e.ducks[s];
      return `${s}:${ACT[e.action(d)] ?? e.action(d)}${d.tackle > 0 ? ` t${d.tackle.toFixed(2)}` : ""}`;
    });
    this.t.setText(
      [
        `fps ${(1000 / this.ft).toFixed(0)}  frame ${this.ft.toFixed(1)} ms  worst ${this.worstShown.toFixed(0)} ms`,
        `stage ${e.stage}  clock ${e.clock.toFixed(1)}  score ${e.score.join("-")}`,
        `controlled ${acts.join("  ")}`,
        `ball  owner ${b.owner}${b.held ? " (hands)" : ""}  passTo ${b.passTo}  last ${b.last}`,
        `      pos ${b.x.toFixed(1)},${b.y.toFixed(1)} z ${b.z.toFixed(2)}  v ${sp.toFixed(1)} m/s dir ${((Math.atan2(b.vy, b.vx) * 180) / Math.PI).toFixed(0)}°`,
        `ctrl  ${JSON.stringify(ctrl)}`,
        passInfo,
        "F2 hide",
      ].join("\n"),
    );
  }
}
