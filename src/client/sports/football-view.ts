import Phaser from "phaser";
import { FbEvent, type FbFrame, type FbInput, type FbState } from "../../shared/football/types";
import type { GameState } from "../../shared/types";
import { FONT, preparePitch } from "./football/art";
import { FootballAudio } from "./football/audio";
import { FootballControls } from "./football/controls";
import "./football/football.css";
import { FootballHud } from "./football/hud";
import { FrameBuffer, type Pose } from "./football/interp";
import { FootballScene } from "./football/scene";
import type { SportView, SportViewOpts } from "./view";

/** كورة البط: the pixel-art pitch (Phaser), the HUD and the touch / keyboard controls.
 *  - "screen": the projector or a phone room's whole-game view: the pitch, wide.
 *  - "personal": a phone: closer camera that leans towards the duck you control (predicted locally).
 *  - controllerOnly: no pitch at all, just the pad (joystick, two buttons, score, your duck). */
export function createFootballView(root: HTMLElement, opts: SportViewOpts): SportView {
  const serverNow = opts.serverNow ?? (() => Date.now());
  const pad = !!opts.controllerOnly;
  const wrap = document.createElement("div");
  wrap.className = `fb-root${pad ? " pad" : ""}`;
  root.appendChild(wrap);
  const stage = document.createElement("div");
  stage.className = "fb-stage";
  if (!pad) wrap.appendChild(stage);

  const frames = new FrameBuffer();
  const hud = new FootballHud(wrap, { pad, screen: opts.mode === "screen" });
  const controls = new FootballControls(wrap, pad);
  const audio = new FootballAudio(opts.sound && !pad);
  let st: FbState | undefined;
  let phase = "";
  let lastGoalAt = 0;
  let goals = 0;
  let lastStage = "";
  let dead = false;
  let paused = false;
  let game: Phaser.Game | null = null;
  let scene: FootballScene | null = null;
  /** a goal waiting for the playback to reach it (effects happen when the ball actually crosses on screen) */
  let goalDue: { at: number; st: FbState } | null = null;

  // ---- the playback clock: normally DELAY behind the server; slowed for a screamer, then it catches up
  let playT = 0;
  let playAt = 0;
  let slowUntil = 0;
  let cachedPose: Pose | null = null;
  let cachedAt = -1;
  const tick = () => {
    const now = performance.now();
    const target = serverNow() - frames.delay;
    if (!playAt || target - playT > 2500 || playT > target) playT = target;
    else {
      const dt = now - playAt;
      if (now < slowUntil) playT += dt * 0.32;
      else playT = Math.min(target, playT + dt * (target - playT > 30 ? 1.6 : 1));
    }
    playAt = now;
  };
  const pose = () => {
    const t = performance.now();
    if (t - cachedAt > 2) {
      tick();
      cachedPose = frames.sample(playT);
      cachedAt = t;
    }
    return cachedPose;
  };
  const myId = () => opts.me();
  const mySlot = (): number => {
    const id = myId();
    if (!id) return -1;
    const c = frames.latest?.c?.[id] ?? st?.control?.[id];
    if (c !== undefined) return c;
    return st?.roster.find((p) => p.pid === id)?.slot ?? -1;
  };

  // ---- the pitch (not on the controller pad)
  const size = () => {
    // layout size (the projector display scales its whole stage with a CSS transform: the canvas must fill the
    // un-scaled box, and render at the on-screen density)
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const r = wrap.getBoundingClientRect();
    const k = w ? r.width / w : 1;
    // DPR capped at 2: the art is chunky anyway, and phones keep their battery
    const dpr = Math.max(0.5, Math.min(2, (window.devicePixelRatio || 1) * k));
    return { w: Math.max(2, w), h: Math.max(2, h), dpr };
  };
  const startGame = () => {
    if (dead || pad) return;
    const { w, h, dpr } = size();
    scene = new FootballScene({
      src: pose,
      me: myId,
      mode: opts.mode,
      input: () => controls.input(),
      charge: () => controls.chargeLevel(),
      aim: () => {
        const id = myId();
        const v = id ? frames.latest?.pt?.[id] : undefined;
        return v ?? -1;
      },
      stamina: () => stamina(),
      newest: (slot) => frames.newest(slot),
      serverNow,
      ready: () => {
        if (st) {
          scene?.setRoster(st.roster);
          scene?.setMatch(st.stage, st.lastGoal, st.result);
        }
        if (paused) game?.loop.sleep();
      },
    });
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: stage,
      width: Math.round(w * dpr),
      height: Math.round(h * dpr),
      backgroundColor: "#1c2240",
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      banner: false,
      audio: { noAudio: true },
      input: { mouse: false, touch: false, keyboard: false, gamepad: false },
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
      fps: { target: 60 },
      scene,
    });
    game.registry.set("dpr", dpr);
    if (location.pathname.endsWith("/football/dev.html") || location.search.includes("fbdebug")) (window as unknown as { __fbGame: Phaser.Game }).__fbGame = game;
  };
  const onResize = () => {
    if (!game) return;
    const { w, h, dpr } = size();
    game.registry.set("dpr", dpr);
    game.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
    game.scale.setZoom(1 / dpr);
    if (opts.mode === "personal") hud.showHint(h > w * 1.1);
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(wrap);
  if (!pad) {
    // the board text and the names use the Arabic font: wait for it (briefly) before drawing them
    const fontReady = Promise.race([
      Promise.all([document.fonts?.load(`800 20px ${FONT}`, "قووول نادي"), document.fonts?.load(`700 12px ${FONT}`, "عبدالله")]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => null);
    // draw the pitch while the font loads (the slowest part of building the scene; cached for later matches)
    setTimeout(() => {
      if (!dead) preparePitch();
    }, 0);
    void fontReady.then(startGame);
    const { w, h } = size();
    if (opts.mode === "personal") hud.showHint(h > w * 1.1);
  }

  // ---- per animation frame: clock, mini-map, events (sounds + effects), who has the ball, goals on time
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = serverNow();
    hud.tick(now);
    const p = pose();
    const slot = mySlot();
    if (!pad && st) hud.drawMini(p, st.roster, slot, performance.now());
    for (const [k, s, t] of frames.due(playT)) event(k, s, t);
    if (goalDue && (playT >= goalDue.at - 40 || pad || now - goalDue.at > 1500)) {
      const g = goalDue;
      goalDue = null;
      showGoal(g.st);
    }
    if (scene) audio.setExcite(scene.tension);
    // possession: the ball's owner against my team
    const f = frames.latest;
    if (st && f) {
      const own = f.b[3];
      const me = slot >= 0 ? st.roster[slot] : st.roster.find((q) => q.pid === myId());
      const ownerTeam = own >= 0 ? st.roster[own]?.team : undefined;
      const mine = ownerTeam === undefined || !me ? null : ownerTeam === me.team;
      controls.possession(mine, own >= 0 && own === slot);
      const id = myId();
      controls.aimKind(Math.floor(((id && f.pt?.[id]) || 0) / 100));
      if (pad) {
        hud.setMe(me ?? null, own >= 0 && own === slot ? "mine" : mine === true ? "team" : mine === false ? "them" : "loose");
        hud.setStamina(stamina());
      }
    } else if (pad) hud.setMe(null, "loose");
  };
  raf = requestAnimationFrame(loop);

  /** sleep the whole view (lobby, podium): no rendering, no audio */
  function setPaused(on: boolean) {
    if (on === paused) return;
    paused = on;
    audio.pause(on);
    if (on) {
      cancelAnimationFrame(raf);
      game?.loop.sleep();
    } else {
      game?.loop.wake();
      raf = requestAnimationFrame(loop);
    }
  }

  function event(kind: number, slot: number, t: number) {
    const speed = kind === FbEvent.Kick || kind === FbEvent.Net || kind === FbEvent.Screamer ? frames.ballSpeedAfter(t) : 0;
    scene?.fx(kind, slot, speed);
    switch (kind) {
      case FbEvent.Kick: {
        const power = Math.max(0, Math.min(1, (speed - 9) / 19));
        audio.kick(0.4 + power * 0.6);
        break;
      }
      case FbEvent.Screamer:
        audio.boom();
        break;
      case FbEvent.Pass:
        audio.pass();
        break;
      case FbEvent.Tackle:
        audio.tackle();
        break;
      case FbEvent.Post:
        audio.post();
        audio.ooh();
        break;
      case FbEvent.Save:
        audio.save();
        audio.ooh();
        break;
      case FbEvent.Whistle:
        audio.whistle(st?.stage === "over" ? 3 : st?.stage === "halftime" ? 2 : 1);
        break;
      case FbEvent.Net:
        audio.net(Math.min(1, Math.max(speed, st?.lastGoal?.speed ?? 0) / 26));
        break;
      case FbEvent.Board:
        audio.board();
        break;
    }
  }

  /** the goal reaches the screen: banner, roar, net, crowd; a screamer gets a slow-motion moment first */
  /** my sprint stamina 0..1 from the newest frame (undefined = the server doesn't send it) */
  function stamina(): number | undefined {
    const id = myId();
    const v = id ? frames.latest?.st?.[id] : undefined;
    return typeof v === "number" ? v : undefined;
  }

  function showGoal(s: FbState) {
    goals++;
    if (goals >= 2) controls.goalScored();
    const g = s.lastGoal;
    if (!g) return;
    const speed = g.speed ?? frames.ballSpeedAfter(g.at - 150);
    const screamer = g.kind === "screamer" || speed >= 22;
    // the banner waits a beat so the ball hitting the net is seen first
    const style = screamer ? "screamer" : speed < 9 && g.kind !== "pen" ? "slow" : "normal";
    setTimeout(() => !dead && hud.goal(s, style), pad ? 0 : screamer ? 1150 : 500);
    audio.roar(Math.min(1, speed / 26));
    if (screamer && !pad) slowUntil = performance.now() + 900;
    const bx = frames.latest?.b[0] ?? 0;
    scene?.goal(g.team, bx < 0 ? -1 : 1, screamer ? Math.max(speed, 22) : speed);
  }

  return {
    render(s: GameState) {
      phase = s.phase;
      setPaused(phase === "lobby" || phase === "end");
      st = s.football;
      hud.update(st, phase);
      if (!st) return;
      scene?.setRoster(st.roster);
      scene?.setMatch(st.stage, st.lastGoal, st.result);
      // one person against the computer can pause (the server checks the same)
      controls.setPausable(!pad && st.stage === "play" && phase === "sport" && st.roster.filter((p) => p.pid).length === 1);
      const g = st.lastGoal;
      if (g && g.at !== lastGoalAt) {
        const fresh = lastGoalAt !== 0 || serverNow() - g.at < 6000;
        lastGoalAt = g.at;
        if (fresh) goalDue = { at: g.at, st };
      }
      if (st.stage !== lastStage) {
        if (st.stage === "over" && lastStage) {
          scene?.celebrate(st.result ?? (st.score[0] === st.score[1] ? -1 : st.score[0] > st.score[1] ? 0 : 1));
          // the crowd goes home: the bed fades out after the cheering
          setTimeout(() => audio.crowdLevel(0), 6000);
        } else if (lastStage === "over") audio.crowdLevel(1);
        lastStage = st.stage;
      }
    },
    anim() {},
    setInput() {},
    fbFrame(f: FbFrame) {
      frames.push(f);
    },
    setControl(cb: ((input: FbInput) => void) | null) {
      controls.set(cb);
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.destroy();
      hud.destroy();
      audio.destroy();
      // give the WebGL context back at once: phones allow only a few, and match after match without a reload the
      // old ones (left to the garbage collector) made a later match start slowly or not draw at all
      const gl = (game?.renderer as unknown as { gl?: WebGLRenderingContext } | undefined)?.gl;
      game?.destroy(true);
      try {
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* already gone */
      }
      game = null;
      scene = null;
      wrap.remove();
    },
  };
}
