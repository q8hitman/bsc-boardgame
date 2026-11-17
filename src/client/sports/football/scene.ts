import Phaser from "phaser";
import { isClubChar } from "../../../shared/football/club";
import { FbAction, FbEvent, PITCH, type FbInput, type FbPlayer, type FbStage, type FbTeam } from "../../../shared/football/types";
import {
  FANS_SRC,
  FAN_H,
  FAN_KINDS,
  FAN_W,
  FONT,
  LOGOS_SRC,
  PITCH_TEX,
  STAND_SRC,
  drawBall,
  drawBoards,
  drawBurst,
  drawEndBoard,
  drawFlag,
  drawCloud,
  drawMarker,
  drawNearStand,
  drawPitch,
  drawRing,
  drawShadow,
} from "./art";
import { BOARD_H, END_X, FAR_BOARD_FOOT, HALF_L, NEAR_BOARD_TOP, PPM, PY, PZ, STAND_H, TEAM_COL, WORLD, wx, wy } from "./geom";
import type { Pose } from "./interp";

/** The pitch, drawn with Phaser in pixel-art mode. It pulls the interpolated pose every frame from `src()`;
 *  the duck this phone controls is predicted locally from the stick so it answers at once. */

export interface SceneOpts {
  src: () => Pose | null;
  me: () => string;
  /** "screen" = projector (wide), "personal" = a phone (close) */
  mode: "screen" | "personal";
  ready: () => void;
  /** the stick and buttons right now (null = this screen does not play) */
  input: () => FbInput | null;
  /** shot charge 0..1 while B is held with the ball, -1 otherwise */
  charge: () => number;
  /** a slot at the newest snapshot (for correcting the prediction) */
  newest: (slot: number) => { x: number; y: number; vx: number; vy: number; act: number; t: number } | null;
  serverNow: () => number;
}

interface Duck {
  slot: number;
  team: FbTeam;
  key: string;
  human: boolean;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Image;
  cloud: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text | null;
  labelKey: string;
  lx: number;
  ly: number;
  speed: number;
  vy: number;
  phase: number;
  act: number;
  actAt: number;
  dustAt: number;
  sparkAt: number;
}

interface Fan {
  img: Phaser.GameObjects.Image;
  kind: number;
  y: number;
  ph: number;
  cheerUntil: number;
}

interface Net {
  back: Phaser.GameObjects.Graphics;
  front: Phaser.GameObjects.Graphics;
  side: 1 | -1;
  /** the back of the net pushed out by the ball sitting in it (m) */
  push: number;
  /** the strike: when, how hard (m of bulge), where (pitch y, height) */
  hitAt: number;
  amp: number;
  hitY: number;
  hitZ: number;
  /** a screamer rattles the frame */
  shakeAt: number;
  inside: boolean;
  struck: boolean;
  entrySpeed: number;
  drawn: boolean;
}

const D_PITCH = -200000;
const D_STAND = -190000;
const D_ENDBOARD = -150000;
const D_DECAL = -100000;
const D_NEAR = 50000;
const D_TOP = 100000;

/** must match the engine (src/shared/football/engine.ts): metres per second, metres per second squared */
const RUN_SPEED = 7.0;
const DRIBBLE_SPEED = 6.1;
const ACCEL = 30;

const duckKey = (char: string, team: FbTeam) => `d-${isClubChar(char) ? char : "abdullah"}-${team}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** a kneeling duck hides this many sprite rows (boots and socks) under itself */
const KNEEL_CUT = 15;

export class FootballScene extends Phaser.Scene {
  private o: SceneOpts;
  private ducks: Duck[] = [];
  private roster: FbPlayer[] = [];
  private ref!: Phaser.GameObjects.Sprite;
  private refShadow!: Phaser.GameObjects.Image;
  private refState = { x: 0, y: -21, speed: 0, phase: 0, face: 1 };
  private ball!: Phaser.GameObjects.Sprite;
  private ballShadow!: Phaser.GameObjects.Image;
  private ballTrail: Phaser.GameObjects.Image[] = [];
  /** recent screen positions of the ball: [time ms, x, y] */
  private ballHist: [number, number, number][] = [];
  private ballLast: [number, number, number] = [0, 0, 0];
  private ballRoll = 0;
  private ballVel: [number, number, number] = [0, 0, 0];
  private speedG!: Phaser.GameObjects.Graphics;
  private nets: Net[] = [];
  private standSlices: { img: Phaser.GameObjects.Image; k: number; y0: number; side: number }[] = [];
  private fans: Fan[] = [];
  private flags: Phaser.GameObjects.Image[] = [];
  private boards: { normal: Phaser.GameObjects.Container[]; goal: Phaser.GameObjects.Container[] } = { normal: [], goal: [] };
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private stars!: Phaser.GameObjects.Particles.ParticleEmitter;
  private camPos = { x: 0, y: 0, init: false };
  private cheerUntil = 0;
  private cheerSide = 0;
  private flashUntil = 0;
  private excite = 0;
  private built = false;
  private pendingRoster: FbPlayer[] | null = null;
  private loading = false;
  private zoomWanted = 1;
  private zoomMin = 0.1;
  /** after a goal the camera pulls back to show the stands going up */
  private wideUntil = 0;
  /** a screamer: the camera closes in on the goal for a moment */
  private focus: { x: number; y: number; until: number; mul: number } | null = null;
  private punchUntil = 0;
  private lastCtl = "";
  private zoomChanged = false;
  /** the match: stage and who scored / won, for celebrating and drooping */
  private stage: FbStage = "kickoff";
  private goalTeam: FbTeam | -1 = -1;
  private scorer = -1;
  private result: FbTeam | -1 | undefined;
  /** the controlled duck, predicted here from the stick */
  private pred = { slot: -1, x: 0, y: 0, vx: 0, vy: 0, face: 1, phase: 0 };

  constructor(o: SceneOpts) {
    super({ key: "football" });
    this.o = o;
  }

  preload() {
    this.load.image("fb-stand", STAND_SRC);
    this.load.image("fb-logos", LOGOS_SRC);
    this.load.spritesheet("fb-fans", FANS_SRC, { frameWidth: FAN_W, frameHeight: FAN_H });
    this.load.spritesheet("d-ref", "assets/football/zahraa-ref.png", { frameWidth: 64, frameHeight: 72 });
  }

  create() {
    const tx = this.textures;
    const ballTex = tx.addCanvas("fb-ball", drawBall())!;
    for (let i = 0; i < 13; i++) ballTex.add(i, 0, i * 10, 0, 10, 10);
    tx.addCanvas("fb-shadow", drawShadow(34, 10, 0.38));
    tx.addCanvas("fb-bshadow", drawShadow(10, 4, 0.45));
    tx.addCanvas("fb-ring0", drawRing(46, 16, TEAM_COL[0]));
    tx.addCanvas("fb-ring1", drawRing(46, 16, TEAM_COL[1]));
    tx.addCanvas("fb-ringme", drawRing(50, 18, 0xffe14a, true));
    tx.addCanvas("fb-mk0", drawMarker(0x5aa0ff));
    tx.addCanvas("fb-mk1", drawMarker(0xff6b6b));
    tx.addCanvas("fb-mkme", drawMarker(0xffe14a));
    const cl = tx.addCanvas("fb-cloud", drawCloud())!;
    cl.add(0, 0, 0, 0, 16, 14);
    cl.add(1, 0, 16, 0, 16, 14);
    tx.addCanvas("fb-burst", drawBurst());
    for (const t of [0, 1] as const) {
      const ft = tx.addCanvas(`fb-flag${t}`, drawFlag(TEAM_COL[t]))!;
      ft.add(0, 0, 0, 0, 18, 24);
      ft.add(1, 0, 18, 0, 18, 24);
    }
    const px = (k: string, w: number, h: number, col: string) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = col;
      g.fillRect(0, 0, w, h);
      tx.addCanvas(k, c);
    };
    px("fb-dust", 3, 3, "#e9e3c8");
    px("fb-px", 2, 2, "#ffffff");
    const logos = (tx.get("fb-logos").getSourceImage() as HTMLImageElement) ?? null;

    // ---- ground
    this.tiled("fb-pitch", drawPitch(), PITCH_TEX.x, PITCH_TEX.y).setDepth(D_PITCH);
    // concrete behind the far boards and around the ends
    const g = this.add.graphics().setDepth(D_PITCH - 1);
    g.fillStyle(0x2a2f45, 1).fillRect(WORLD.left, WORLD.top, WORLD.right - WORLD.left, WORLD.bottom - WORLD.top);
    g.fillStyle(0x363c58, 1).fillRect(WORLD.left, FAR_BOARD_FOOT - BOARD_H - 10, WORLD.right - WORLD.left, 10);

    // ---- far stand: the generated grandstand, cut in slices that can bounce when the crowd jumps
    const stand = tx.get("fb-stand");
    const sw = stand.getSourceImage().width;
    const roofH = 30;
    const railY = 158;
    stand.add("roof", 0, 0, 0, sw, roofH);
    stand.add("rail", 0, 0, railY, sw, STAND_H - railY);
    const SL = 16;
    const nSl = Math.floor(sw / SL);
    for (let j = 0; j < nSl; j++) stand.add(`s${j}`, 0, j * SL, roofH - 4, j === nSl - 1 ? sw - j * SL : SL, railY + 6 - (roofH - 4));
    const standBottom = FAR_BOARD_FOOT - BOARD_H - 6;
    const standTop = standBottom - STAND_H;
    let k = 0;
    for (let x0 = WORLD.left; x0 < WORLD.right; x0 += sw) {
      this.add.image(x0, standTop, "fb-stand", "roof").setOrigin(0, 0).setDepth(D_STAND + 2);
      this.add.image(x0, standTop + railY, "fb-stand", "rail").setOrigin(0, 0).setDepth(D_STAND + 2);
      for (let j = 0; j < nSl; j++) {
        const img = this.add.image(x0 + j * SL, standTop + roofH - 4, "fb-stand", `s${j}`).setOrigin(0, 0).setDepth(D_STAND);
        this.standSlices.push({ img, k: k++, y0: img.y, side: Math.sign(img.x + SL / 2) });
      }
    }

    // ---- boards
    const len = Math.round((END_X * 2 + 0.6) * PPM);
    const bx = -len / 2;
    const far = this.tiled("fb-boards-far", drawBoards(len, 0, logos), bx, FAR_BOARD_FOOT - BOARD_H - 4).setDepth(FAR_BOARD_FOOT - 0.5);
    const near = this.tiled("fb-boards-near", drawBoards(len, 5, logos), bx, NEAR_BOARD_TOP - 4).setDepth(D_NEAR);
    const farG = this.tiled("fb-boards-goal", drawBoards(len, 0, logos, true), bx, FAR_BOARD_FOOT - BOARD_H - 4).setDepth(FAR_BOARD_FOOT - 0.4).setVisible(false);
    const nearG = this.tiled("fb-boards-goal2", drawBoards(len, 1, logos, true), bx, NEAR_BOARD_TOP - 4).setDepth(D_NEAR + 0.1).setVisible(false);
    this.boards = { normal: [far, near], goal: [farG, nearG] };
    const eb = drawEndBoard();
    this.tiled("fb-endboard-r", eb, END_X * PPM, FAR_BOARD_FOOT - BOARD_H).setDepth(D_ENDBOARD);
    const ebl = document.createElement("canvas");
    ebl.width = eb.width;
    ebl.height = eb.height;
    const lg = ebl.getContext("2d")!;
    lg.scale(-1, 1);
    lg.drawImage(eb, -eb.width, 0);
    this.tiled("fb-endboard-l", ebl, -END_X * PPM - eb.width, FAR_BOARD_FOOT - BOARD_H).setDepth(D_ENDBOARD);

    // ---- near stand + fans in front of the camera
    const nsTop = NEAR_BOARD_TOP + BOARD_H;
    const nsH = WORLD.bottom - nsTop + 40;
    this.tiled("fb-nearstand", drawNearStand(WORLD.right - WORLD.left, nsH), WORLD.left, nsTop).setDepth(D_NEAR - 1);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let row = 0; row < 4; row++) {
      const baseY = nsTop + 34 + row * 28;
      for (let x = WORLD.left + 10 + (row % 2) * 16; x < WORLD.right; x += 30 + Math.floor(rnd() * 14)) {
        if (rnd() < 0.12) continue; // an empty seat
        const kind = Math.floor(rnd() * FAN_KINDS);
        const img = this.add.image(x, baseY, "fb-fans", kind * 2).setOrigin(0.5, 1).setDepth(D_NEAR + 1 + row);
        if (rnd() < 0.5) img.setFlipX(true);
        this.fans.push({ img, kind, y: baseY, ph: rnd() * 10, cheerUntil: 0 });
      }
    }

    // ---- goals
    for (const side of [-1, 1] as const) {
      const back = this.add.graphics().setDepth(wy(-PITCH.goalWidth / 2) - 1);
      const front = this.add.graphics().setDepth(wy(PITCH.goalWidth / 2) + 0.5);
      this.nets.push({ back, front, side, push: 0, hitAt: -1e9, amp: 0, hitY: 0, hitZ: 1, shakeAt: -1e9, inside: false, struck: false, entrySpeed: 0, drawn: false });
    }
    for (const n of this.nets) this.drawGoal(n, 0);

    // ---- ball, referee
    this.ballShadow = this.add.image(0, 0, "fb-bshadow").setDepth(D_DECAL + 2);
    this.speedG = this.add.graphics();
    for (let i = 0; i < 7; i++) this.ballTrail.push(this.add.image(0, 0, "fb-ball", 12).setAlpha(0).setDepth(0));
    this.ball = this.add.sprite(0, 0, "fb-ball", 0).setOrigin(0.5, 0.5);
    this.refShadow = this.add.image(0, 0, "fb-shadow").setDepth(D_DECAL);
    this.ref = this.add.sprite(0, wy(-21), "d-ref", 0).setOrigin(0.5, 70 / 72);

    this.dust = this.add.particles(0, 0, "fb-dust", {
      lifespan: { min: 260, max: 520 },
      speed: { min: 12, max: 50 },
      angle: { min: 180, max: 360 },
      alpha: { start: 0.85, end: 0 },
      scale: { start: 1, end: 0.4 },
      gravityY: 40,
      emitting: false,
    });
    this.dust.setDepth(D_TOP - 10);
    for (const t of [0, 1] as const) {
      const c = this.add.particles(0, 0, "fb-px", {
        lifespan: 2600,
        speedX: { min: -34, max: 34 },
        speedY: { min: -70, max: -10 },
        gravityY: 55,
        tint: t === 0 ? [0x2f7bff, 0x8cc0ff, 0xffffff, 0xffd23f] : [0xff3b3b, 0xffa8a8, 0xffffff, 0xffd23f],
        alpha: { start: 1, end: 0.2 },
        scale: { min: 1.5, max: 2.5 },
        rotate: { min: 0, max: 360 },
        emitting: false,
      });
      c.setDepth(D_TOP - 5);
      this.confetti.push(c);
    }
    this.stars = this.add.particles(0, 0, "fb-px", {
      lifespan: 600,
      speed: { min: 20, max: 60 },
      angle: { min: 200, max: 340 },
      tint: [0xffe14a, 0xffffff],
      alpha: { start: 1, end: 0 },
      scale: { start: 1.5, end: 0.5 },
      gravityY: 60,
      emitting: false,
    });
    this.stars.setDepth(D_TOP - 4);

    this.cameras.main.setBounds(WORLD.left, WORLD.top, WORLD.right - WORLD.left, WORLD.bottom - WORLD.top);
    this.cameras.main.setBackgroundColor("#1c2240");
    this.scale.on("resize", () => this.fitCamera());
    this.fitCamera();
    this.built = true;
    if (this.pendingRoster) this.setRoster(this.pendingRoster);
    this.o.ready();
  }

  /** a big canvas as tiles of at most 1024 px (some phones and GPUs drop larger textures) */
  private tiled(key: string, c: HTMLCanvasElement, x: number, y: number) {
    const T = 1024;
    const box = this.add.container(x, y);
    for (let ty = 0; ty < c.height; ty += T)
      for (let tx = 0; tx < c.width; tx += T) {
        const w = Math.min(T, c.width - tx);
        const h = Math.min(T, c.height - ty);
        const t = document.createElement("canvas");
        t.width = w;
        t.height = h;
        t.getContext("2d")!.drawImage(c, tx, ty, w, h, 0, 0, w, h);
        const k = `${key}-${tx}-${ty}`;
        if (this.textures.exists(k)) this.textures.remove(k);
        this.textures.addCanvas(k, t);
        box.add(this.add.image(tx, ty, k).setOrigin(0, 0));
      }
    return box;
  }

  /* ------------------------------------------------------------------ camera */
  private fitCamera() {
    const cam = this.cameras.main;
    const W = this.scale.width;
    const H = this.scale.height;
    cam.setSize(W, H);
    const portrait = H > W * 1.1;
    // how much pitch to show (world px across)
    let vis = this.o.mode === "screen" ? 26 * PPM : portrait ? 15 * PPM : 22 * PPM;
    if (this.o.mode === "screen" && H > W) vis = 18 * PPM;
    let z = W / vis;
    // never show past the stands
    z = Math.max(z, W / (WORLD.right - WORLD.left), H / (WORLD.bottom - WORLD.top));
    // whole art pixels where we can, half pixels otherwise (uneven pixels look like smears)
    if (z >= 1.75) z = Math.round(z);
    else if (z >= 1) z = Math.round(z * 2) / 2;
    z = Math.max(z, W / (WORLD.right - WORLD.left), H / (WORLD.bottom - WORLD.top));
    this.zoomWanted = z;
    this.zoomMin = Math.max(W / (WORLD.right - WORLD.left), H / (WORLD.bottom - WORLD.top));
    cam.setZoom(z);
    this.zoomChanged = true;
  }

  /** pull the camera back for a few seconds (goal, full time) */
  wide(ms: number) {
    this.wideUntil = Math.max(this.wideUntil, this.time.now + ms);
  }

  /** a fixed camera (world centre + zoom), for the dev page's screenshots and the hub thumbnail */
  camOverride: { x: number; y: number; z: number } | null = null;

  /* ------------------------------------------------------------------ roster + match */
  setRoster(roster: FbPlayer[]) {
    if (!this.built) {
      this.pendingRoster = roster;
      return;
    }
    const same =
      roster.length === this.roster.length && roster.every((p, i) => this.roster[i] && this.roster[i].char === p.char && this.roster[i].team === p.team && this.roster[i].name === p.name && this.roster[i].pid === p.pid);
    if (same && this.ducks.length === roster.length) return;
    this.roster = roster;
    const need = new Set(roster.map((p) => duckKey(p.char, p.team)));
    const missing = [...need].filter((k) => !this.textures.exists(k));
    if (missing.length) {
      for (const k of missing) {
        const [, char, team] = k.split("-");
        this.load.spritesheet(k, `assets/football/${char}-${team === "1" ? "red" : "blue"}.png`, { frameWidth: 64, frameHeight: 72 });
      }
      this.pendingRoster = roster;
      if (!this.loading) {
        this.loading = true;
        this.load.once("complete", () => {
          this.loading = false;
          const r = this.pendingRoster;
          this.pendingRoster = null;
          this.roster = [];
          if (r) this.setRoster(r);
        });
        this.load.start();
      }
      return;
    }
    for (const d of this.ducks) {
      d.sprite.destroy();
      d.shadow.destroy();
      d.ring.destroy();
      d.marker.destroy();
      d.cloud.destroy();
      d.label?.destroy();
    }
    this.ducks = roster.map((p) => {
      const key = this.textures.exists(duckKey(p.char, p.team)) ? duckKey(p.char, p.team) : "d-ref";
      const shadow = this.add.image(0, 0, "fb-shadow").setDepth(D_DECAL);
      const ring = this.add.image(0, 0, `fb-ring${p.team}`).setDepth(D_DECAL + 1).setVisible(false);
      const marker = this.add.image(0, 0, `fb-mk${p.team}`).setOrigin(0.5, 1).setDepth(D_TOP + 1).setVisible(false);
      const sprite = this.add.sprite(0, 0, key, 0).setOrigin(0.5, 70 / 72);
      const cloud = this.add.sprite(0, 0, "fb-cloud", 0).setOrigin(0.5, 1).setDepth(D_TOP).setScale(2).setVisible(false);
      const x = p.team === 0 ? -6 : 6;
      return {
        slot: p.slot,
        team: p.team,
        key,
        human: !!p.pid,
        sprite,
        shadow,
        ring,
        marker,
        cloud,
        label: null,
        labelKey: "",
        lx: x,
        ly: 0,
        speed: 0,
        vy: 0,
        phase: Math.random() * 4,
        act: 0,
        actAt: 0,
        dustAt: 0,
        sparkAt: 0,
      };
    });
    this.lastCtl = "";
  }

  /** the match state that colours the animations (who celebrates, who droops) */
  setMatch(stage: FbStage, goal: { team: FbTeam; slot: number } | undefined, result: FbTeam | -1 | undefined) {
    this.stage = stage;
    this.goalTeam = stage === "goal" && goal ? goal.team : -1;
    this.scorer = stage === "goal" && goal ? goal.slot : -1;
    this.result = result;
  }

  private labelFor(d: Duck, kind: "me" | "human" | "cpu") {
    const p = this.roster[d.slot];
    const res = Math.max(1, Math.ceil(this.cameras.main.zoom));
    const key = `lbl-${d.slot}-${kind}-${p.name}-${res}`;
    if (d.labelKey === key) return;
    d.label?.destroy();
    // Arabic names stay smooth text (hard-thresholded Arabic at this size is unreadable), rendered at the
    // camera's own pixel density so they are crisp, with a chunky dark outline to sit with the pixel art
    const fill = kind === "me" ? "#ffe14a" : kind === "human" ? (d.team === 0 ? "#9cc8ff" : "#ffa8a8") : "#ffffff";
    const px = (kind === "cpu" ? 11 : 13) * (this.o.mode === "screen" ? 1.15 : 1);
    d.label = this.add
      .text(0, 0, p.name, { fontFamily: FONT, fontSize: `${px}px`, fontStyle: kind === "cpu" ? "700" : "800", color: fill, stroke: "#141024", strokeThickness: 3.5 })
      .setResolution(res)
      .setOrigin(0.5, 1)
      .setDepth(D_TOP)
      .setAlpha(kind === "cpu" ? 0.8 : 1);
    d.labelKey = key;
  }

  /* ------------------------------------------------------------------ effects */
  /** a frame event; `speed` = the ball's speed just after it (m/s), so kicks look as hard as they are */
  fx(kind: number, slot: number, speed = 0) {
    if (!this.built) return;
    const [bx, by, bz] = this.ballLast;
    const X = wx(bx, bz);
    const Y = wy(by, bz) - 5;
    if (kind === FbEvent.Kick) {
      const power = clamp((speed - 9) / 19, 0, 1);
      this.dust.explode(5 + Math.round(power * 12), wx(bx), wy(by));
      this.impact(X, Y, 0.45 + power * 1.1, 6 + Math.round(power * 6), 10 + power * 22);
    }
    if (kind === FbEvent.Screamer) {
      // a big hit: a second, bigger burst, a shockwave, the camera kicks
      this.impact(X, Y, 2.2, 14, 46);
      const ring = this.add.image(X, Y, "fb-ringme").setDepth(D_TOP - 2).setScale(0.4).setTint(0xffb347);
      this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 320, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
      this.dust.explode(14, wx(bx), wy(by));
      this.cameras.main.shake(150, 0.006);
      this.punchUntil = this.time.now + 180;
      this.cheer(0.8, 0.4, bx < 0 ? -1 : 1);
    }
    if (kind === FbEvent.Pass) {
      this.dust.explode(3, wx(bx), wy(by));
      this.impact(X, Y, 0.3, 0, 0);
    }
    if (kind === FbEvent.Tackle) {
      const d = this.ducks[slot];
      this.dust.explode(12, d ? d.sprite.x : X, d ? d.sprite.y : Y);
    }
    if (kind === FbEvent.Board) this.dust.explode(5, X, Y);
    if (kind === FbEvent.Post) {
      this.cameras.main.shake(160, 0.004);
      this.impact(X, Y, 0.8, 8, 18);
      const n = this.nets.find((q) => q.side === (bx < 0 ? -1 : 1));
      if (n) n.shakeAt = this.time.now;
      this.cheer(1.2, 0.3, bx < 0 ? -1 : 1);
    }
    if (kind === FbEvent.Save) {
      this.impact(X, Y, 0.7, 6, 14);
      this.cheer(1.4, 0.35, bx < 0 ? -1 : 1);
    }
    if (kind === FbEvent.Net) this.netStrike(bx < 0 ? -1 : 1, by, bz, Math.max(speed, Math.hypot(...this.ballVel)));
  }

  /** a white star where the boot meets the ball, with rays */
  private impact(x: number, y: number, scale: number, rays: number, reach: number) {
    const s = this.add.image(x, y, "fb-burst").setDepth(D_TOP - 1).setScale(scale * 0.6);
    this.tweens.add({ targets: s, scale: scale, alpha: 0, duration: 200, ease: "Quad.easeOut", onComplete: () => s.destroy() });
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + Math.random() * 0.3;
      const r = this.add.image(x, y, "fb-px").setDepth(D_TOP - 1).setTint(i % 2 ? 0xffe14a : 0xffffff);
      this.tweens.add({ targets: r, x: x + Math.cos(a) * reach, y: y + Math.sin(a) * reach * 0.7, alpha: 0, duration: 260, onComplete: () => r.destroy() });
    }
  }

  /** the ball hits the net: a bulge as hard as the shot */
  private netStrike(side: -1 | 1, y: number, z: number, speed: number) {
    const n = this.nets.find((q) => q.side === side);
    if (!n) return;
    n.hitAt = this.time.now;
    n.amp = clamp(speed / 26, 0.12, 1.25);
    n.hitY = clamp(y, -PITCH.goalWidth / 2 + 0.3, PITCH.goalWidth / 2 - 0.3);
    n.hitZ = clamp(z, 0.25, 1.5);
    if (n.amp > 0.85) n.shakeAt = this.time.now;
  }

  /** a goal: the crowd on that side goes up, the boards flash, flags and confetti in the team's colour, the net
   *  shakes; a screamer (fast ball) closes the camera in on the goal for a moment first. */
  goal(team: FbTeam, side: -1 | 1, speed: number) {
    const now = this.time.now;
    const n = this.nets.find((q) => q.side === side);
    // no Net event yet (or none at all): strike the net from the goal itself
    if (n && now - n.hitAt > 600) this.netStrike(side, this.ballLast[1], Math.max(0.4, this.ballLast[2]), speed);
    const screamer = speed >= 22;
    if (screamer) {
      this.focus = { x: wx(side * (HALF_L + 0.8)), y: wy(0) - 40, until: now + 1300, mul: 1.35 };
      this.cameras.main.shake(320, 0.008);
    } else this.cameras.main.shake(200, 0.004);
    this.time.delayedCall(screamer ? 1300 : 500, () => {
      // nobody to follow (own goal): show the stands going up
      if (this.scorer < 0) this.wideUntil = this.time.now + 3800;
      this.flashUntil = this.time.now + 3600;
      this.cheer(5, 1, side);
      this.waveFlags(team, side);
      for (let i = 0; i < 9; i++)
        this.time.delayedCall(i * 160, () => {
          const v = this.cameras.main.worldView;
          this.confetti[team].explode(30, v.x + Math.random() * v.width, v.y + Math.random() * v.height * 0.35);
        });
    });
  }

  /** full time: the winners' crowd, flags and confetti */
  celebrate(team: FbTeam | -1) {
    this.wide(6500);
    this.cheer(6, team === -1 ? 0.5 : 0.9, 0);
    if (team === -1) return;
    this.flashUntil = this.time.now + 4000;
    this.waveFlags(team, 0);
    for (let i = 0; i < 12; i++)
      this.time.delayedCall(i * 200, () => {
        const v = this.cameras.main.worldView;
        this.confetti[team].explode(30, v.x + Math.random() * v.width, v.y + Math.random() * v.height * 0.35);
      });
  }

  /** team flags popping up in the crowd (on one side of the stadium, or everywhere with side 0) */
  private waveFlags(team: FbTeam, side: number) {
    for (const f of this.flags) f.destroy();
    this.flags = [];
    const nsTop = NEAR_BOARD_TOP + BOARD_H;
    const standTop = FAR_BOARD_FOOT - BOARD_H - 6 - STAND_H;
    for (let i = 0; i < 46; i++) {
      const farSide = i % 2 === 0;
      let x = WORLD.left + Math.random() * (WORLD.right - WORLD.left);
      if (side && Math.random() < 0.8) x = side * (Math.random() * WORLD.right);
      const y = farSide ? standTop + 50 + Math.random() * 100 : nsTop + 30 + Math.random() * 60;
      const f = this.add
        .image(x, y + 12, `fb-flag${team}`, 0)
        .setOrigin(0.2, 1)
        .setDepth(farSide ? D_STAND + 1 : D_NEAR + 6)
        .setAlpha(0);
      f.setData("ph", Math.random() * 6);
      this.flags.push(f);
      this.tweens.add({ targets: f, y, alpha: 1, duration: 180, delay: Math.random() * 400 });
      this.tweens.add({ targets: f, alpha: 0, duration: 400, delay: 4200 + Math.random() * 600, onComplete: () => f.destroy() });
    }
  }

  /** the crowd jumps for `secs`; `share` = how many of them; `side` = the end that goes wild (0 = all) */
  cheer(secs: number, share: number, side: number) {
    const t = this.time.now;
    this.cheerUntil = Math.max(this.cheerUntil, t + secs * 1000 * share);
    this.cheerSide = side;
    for (const f of this.fans) {
      const near = !side || Math.sign(f.img.x) === side;
      if (Math.random() < share * (near ? 1 : 0.35)) f.cheerUntil = Math.max(f.cheerUntil, t + secs * 1000 * (0.6 + Math.random() * 0.5));
    }
  }

  /* ------------------------------------------------------------------ goal frames + nets */
  private drawGoal(n: Net, t: number) {
    const s = n.side;
    const x0 = s * HALF_L;
    const x1 = s * (HALF_L + PITCH.goalDepth);
    const hw = PITCH.goalWidth / 2;
    const H = PITCH.goalHeight;
    const Hb = 1.6;
    const age = (t - n.hitAt) / 1000;
    // the strike: a damped wobble on top of the push of a ball lying in the net
    const strike = age >= 0 && age < 2.2 ? n.amp * Math.exp(-age * 2.8) * Math.cos(age * 15) : 0;
    const D = n.push + strike;
    const sy = 1.35 + n.amp * 0.9;
    const sz = 0.85 + n.amp * 0.5;
    /** how far a point of the net (pitch y, height z, u = 0 at the frame .. 1 at the back) is pushed out (m) */
    const disp = (y: number, z: number, u: number) => {
      if (!D) return 0;
      const g = Math.exp(-((y - n.hitY) ** 2) / (2 * sy * sy) - ((z - n.hitZ) ** 2) / (2 * sz * sz));
      return s * D * Math.pow(u, 1.5) * g;
    };
    const sAge = (t - n.shakeAt) / 1000;
    const jit = sAge >= 0 && sAge < 0.6 ? Math.round(Math.sin(sAge * 70) * 2.5 * Math.exp(-sAge * 5)) : 0;
    const P = (x: number, y: number, z: number, u = 1) => [wx(x + disp(y, z, u), z), wy(y, z)] as const;
    const F = (x: number, y: number, z: number) => [wx(x, z) + jit, wy(y, z)] as const;
    const roofZ = (x: number) => H + (Hb - H) * ((x - x0) / (x1 - x0));
    const netCol = 0xf4f8ff;
    for (const [gfx, which] of [
      [n.back, "back"],
      [n.front, "front"],
    ] as const) {
      gfx.clear();
      const shadeFill = (pts: (readonly [number, number])[], a: number) => {
        gfx.fillStyle(0x0a1a10, a);
        gfx.beginPath();
        gfx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) gfx.lineTo(p[0], p[1]);
        gfx.closePath();
        gfx.fillPath();
      };
      const path = (pts: (readonly [number, number])[], alpha: number) => {
        gfx.lineStyle(1, netCol, alpha);
        for (let i = 1; i < pts.length; i++) gfx.lineBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      };
      const steps = (a: number, b: number, n2: number, f: (v: number) => readonly [number, number]) => {
        const out: (readonly [number, number])[] = [];
        for (let i = 0; i <= n2; i++) out.push(f(a + ((b - a) * i) / n2));
        return out;
      };
      if (which === "back") {
        // back panel and roof, shaded, following the bulge
        const back = [...steps(-hw, hw, 7, (y) => P(x1, y, Hb)), ...steps(hw, -hw, 7, (y) => P(x1, y, 0))];
        shadeFill(back, 0.22);
        shadeFill([P(x0, -hw, H, 0), ...steps(-hw, hw, 7, (y) => P(x1, y, Hb)), P(x0, hw, H, 0)], 0.12);
        for (let y = -hw; y <= hw + 1e-6; y += 0.5) path(steps(0, Hb, 4, (z) => P(x1, y, z)), 0.5);
        for (let z = 0; z <= Hb + 1e-6; z += 0.4) path(steps(-hw, hw, 14, (y) => P(x1, y, z)), 0.42);
        for (let y = -hw; y <= hw + 1e-6; y += 0.5) path(steps(0, 1, 4, (u) => P(x0 + (x1 - x0) * u, y, roofZ(x0 + (x1 - x0) * u), u)), 0.45);
        for (let f = 0.25; f < 1; f += 0.25) {
          const x = x0 + (x1 - x0) * f;
          path(steps(-hw, hw, 14, (y) => P(x, y, roofZ(x), f)), 0.4);
        }
      }
      // side nets: far one with the back layer, near one in front
      const syd = which === "back" ? -hw : hw;
      shadeFill([P(x0, syd, 0, 0), P(x0, syd, H, 0), P(x1, syd, Hb), P(x1, syd, 0)], which === "back" ? 0.16 : 0.06);
      for (let f = 0; f <= 1.0001; f += 0.25) {
        const x = x0 + (x1 - x0) * f;
        path(steps(0, roofZ(x), 3, (z) => P(x, syd, z, f)), which === "back" ? 0.5 : 0.6);
      }
      for (let z = 0.4; z < H; z += 0.4) {
        const xe = z <= Hb ? x1 : x0 + (x1 - x0) * ((H - z) / (H - Hb));
        path(steps(0, 1, 3, (u) => P(x0 + (xe - x0) * u, syd, z, u * Math.abs((xe - x0) / (x1 - x0)))), which === "back" ? 0.42 : 0.55);
      }
      // the frame: white posts and crossbar with a grey shaded side, crisp; it rattles on a screamer
      const post = (y: number) => {
        const a = F(x0, y, 0);
        const b = F(x0, y, H);
        const n2 = Math.ceil(Math.abs(a[1] - b[1]));
        for (let i = 0; i <= n2; i++) {
          const u = i / n2;
          const X = Math.round(a[0] + (b[0] - a[0]) * u);
          const Y = Math.round(a[1] + (b[1] - a[1]) * u);
          gfx.fillStyle(0x1a1a24, 1).fillRect(X - 3, Y, 6, 1);
          gfx.fillStyle(0xffffff, 1).fillRect(X - 2, Y, 3, 1);
          gfx.fillStyle(0xb8c0cc, 1).fillRect(X + 1, Y, 1, 1);
        }
      };
      gfx.lineStyle(2, 0xc9d1dc, 0.9);
      if (which === "back") {
        path(steps(-hw, hw, 7, (y) => P(x1, y, 0)), 0.9);
        gfx.lineStyle(2, 0xc9d1dc, 0.9);
        const c = steps(-hw, hw, 7, (y) => P(x1, y, Hb));
        for (let i = 1; i < c.length; i++) gfx.lineBetween(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
        post(-hw);
        const t0 = F(x0, -hw, H);
        const t1 = F(x0, hw, H);
        const X = Math.round(t0[0]);
        gfx.fillStyle(0x1a1a24, 1).fillRect(X - 3, Math.round(t0[1]) - 2, 6, Math.round(t1[1] - t0[1]) + 4);
        gfx.fillStyle(0xffffff, 1).fillRect(X - 2, Math.round(t0[1]) - 1, 3, Math.round(t1[1] - t0[1]) + 2);
        gfx.fillStyle(0xb8c0cc, 1).fillRect(X + 1, Math.round(t0[1]) - 1, 1, Math.round(t1[1] - t0[1]) + 2);
      } else {
        post(hw);
      }
    }
  }

  /** follow the ball inside each goal: the back of the net wraps a ball that punches deep, and springs back */
  private updateNets(time: number, dt: number) {
    const [bx, by, bz] = this.ballLast;
    const speed = Math.hypot(...this.ballVel);
    for (const n of this.nets) {
      const inside = Math.sign(bx) === n.side && Math.abs(bx) > HALF_L - 0.05 && Math.abs(by) < PITCH.goalWidth / 2 + 0.3 && bz < PITCH.goalHeight + 0.2;
      if (inside && !n.inside) n.entrySpeed = speed;
      n.inside = inside;
      if (inside) {
        const pen = Math.abs(bx) - HALF_L;
        const into = pen - (PITCH.goalDepth - 0.3);
        if (into > 0) {
          n.push = Math.max(n.push * Math.exp(-dt * 3), into + 0.1);
          n.hitY = by;
          n.hitZ = clamp(bz, 0.25, 1.5);
          if (!n.struck) {
            n.struck = true;
            this.netStrike(n.side, by, bz, Math.max(n.entrySpeed, speed));
          }
        } else n.push *= Math.exp(-dt * 5);
      } else {
        n.push *= Math.exp(-dt * 5);
        if (n.push < 0.005) n.push = 0;
        if (Math.abs(bx) < HALF_L - 1) n.struck = false;
      }
      const age = time - n.hitAt;
      const active = n.push > 0 || (age >= 0 && age < 2300) || time - n.shakeAt < 650;
      if (active) {
        this.drawGoal(n, time);
        n.drawn = true;
      } else if (n.drawn) {
        this.drawGoal(n, -1e9);
        n.drawn = false;
      }
    }
  }

  /* ------------------------------------------------------------------ the controlled duck */
  /** move this phone's duck at once from the stick (engine speeds), easing back to the server's position */
  private predict(slot: number, owner: number, dt: number) {
    const p = this.pred;
    const inp = this.o.input();
    const nw = slot >= 0 ? this.o.newest(slot) : null;
    const free = nw && (nw.act === FbAction.Idle || nw.act === FbAction.Run || nw.act === FbAction.Kick);
    if (!inp || !nw || !free || this.stage !== "play") {
      p.slot = -1;
      return null;
    }
    // where the server has the duck now (the newest frame, carried forward a little)
    const age = clamp((this.o.serverNow() - nw.t) / 1000 + 0.05, 0, 0.3);
    const ex = nw.x + nw.vx * age;
    const ey = nw.y + nw.vy * age;
    if (p.slot !== slot) Object.assign(p, { slot, x: ex, y: ey, vx: nw.vx, vy: nw.vy });
    let ix = inp.x;
    let iy = inp.y;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    const max = owner === slot ? DRIBBLE_SPEED : RUN_SPEED;
    let dvx = ix * max - p.vx;
    let dvy = iy * max - p.vy;
    const dl = Math.hypot(dvx, dvy);
    const lim = ACCEL * dt;
    if (dl > lim) {
      dvx *= lim / dl;
      dvy *= lim / dl;
    }
    p.vx += dvx;
    p.vy += dvy;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // ease towards the server, snap when it disagrees a lot (a tackle, a reset)
    const ex2 = ex - p.x;
    const ey2 = ey - p.y;
    if (Math.hypot(ex2, ey2) > 2.5) {
      p.x = ex;
      p.y = ey;
      p.vx = nw.vx;
      p.vy = nw.vy;
    } else {
      const k = Math.min(1, dt * (il < 0.1 ? 7 : 2.5));
      p.x += ex2 * k;
      p.y += ey2 * k;
    }
    p.x = clamp(p.x, -HALF_L - 1, HALF_L + 1);
    p.y = clamp(p.y, -PITCH.width / 2 - 0.5, PITCH.width / 2 + 0.5);
    if (Math.abs(ix) > 0.15) p.face = ix > 0 ? 1 : -1;
    return p;
  }

  /* ------------------------------------------------------------------ per frame */
  update(time: number, deltaMs: number) {
    if (!this.built) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    const pose = this.o.src();
    this.updateCrowd(time);
    const flashing = time < this.flashUntil;
    const on = flashing && Math.floor(time / 260) % 2 === 0;
    this.boards.normal.forEach((b) => b.setVisible(!on));
    this.boards.goal.forEach((b) => b.setVisible(on));
    for (const f of this.flags) f.setFrame(Math.floor(time / 170 + (f.getData("ph") as number)) % 2);
    if (!pose) {
      this.updateNets(time, dt);
      return;
    }
    const me = this.o.me();
    const ctl = pose.c ?? {};
    const mySlot = me && ctl[me] !== undefined ? ctl[me] : -1;
    const ctlKey = JSON.stringify(ctl) + me;
    const controlled = new Map<number, string>();
    for (const [pid, s] of Object.entries(ctl)) controlled.set(s, pid);
    const pr = this.predict(mySlot, pose.owner, dt);
    const charge = mySlot >= 0 && pose.owner === mySlot ? this.o.charge() : -1;
    const over = this.stage === "over" && this.result !== undefined;

    for (const d of this.ducks) {
      const i = d.slot * 4;
      if (pose.p.length < i + 4) continue;
      let x = pose.p[i];
      let y = pose.p[i + 1];
      let face = pose.p[i + 2] < 0 ? -1 : 1;
      let act = pose.p[i + 3];
      const mine = d.slot === mySlot;
      if (mine && pr) {
        x = pr.x;
        y = pr.y;
        face = pr.face;
        if (act === FbAction.Idle || act === FbAction.Run) act = Math.hypot(pr.vx, pr.vy) > 0.6 ? FbAction.Run : FbAction.Idle;
      }
      const dist = Math.hypot(x - d.lx, y - d.ly);
      const sp = dist / Math.max(dt, 0.001);
      d.speed += (Math.min(sp, 14) - d.speed) * 0.25;
      d.vy += ((y - d.ly) / Math.max(dt, 0.001) - d.vy) * 0.3;
      d.lx = x;
      d.ly = y;
      if (act !== d.act) {
        d.act = act;
        d.actAt = time;
      }
      // the side that just conceded (or lost) trudges, head down
      const sad = (this.goalTeam !== -1 && d.team !== this.goalTeam) || (over && this.result !== -1 && d.team !== this.result);
      d.phase += dist / (sad ? 0.5 : 0.36);
      let X = Math.round(wx(x));
      const Y = Math.round(wy(y));
      let frame = 0;
      let rot = 0;
      let oy = 0;
      let flip = face < 0;
      let sx = 1;
      let sy = 1;
      let kneel = false;
      const since = (time - d.actAt) / 1000;
      switch (act) {
        case FbAction.Kick:
          frame = 5;
          oy = since < 0.12 ? -2 : 0;
          break;
        case FbAction.Slide:
          frame = 5;
          rot = (face > 0 ? -1 : 1) * 0.42;
          oy = 6;
          if (time - d.dustAt > 50) {
            d.dustAt = time;
            this.dust.explode(2, X - face * 6, Y);
          }
          break;
        case FbAction.Dive: {
          frame = 5;
          const up = d.vy < 0 ? -1 : 1;
          rot = up * face * -1.25 * Math.min(1, since * 6);
          oy = -Math.round(16 * Math.sin(Math.min(1, since * 1.5) * Math.PI));
          break;
        }
        case FbAction.Celebrate: {
          const star = d.slot === this.scorer;
          if (d.speed > 1.5) {
            // sprinting to the corner / the huddle: a bouncing run
            frame = 1 + (Math.floor(d.phase) % 4);
            oy = -Math.round(Math.abs(Math.sin(d.phase * Math.PI * 0.5)) * 4);
          } else {
            // jumping on the spot, legs kicking, turning round now and then
            const hop = Math.abs(Math.sin(time / 140 + d.slot * 0.7));
            oy = -Math.round(hop * (star ? 16 : 11));
            frame = hop > 0.3 ? 5 : 0;
            if (hop < 0.12) {
              sx = 1.08;
              sy = 0.92;
            }
            if (Math.floor(time / 700 + d.slot) % 2) flip = !flip;
            if (star && Math.floor(time / 2100) % 3 === 2) rot = ((time % 2100) / 700) * Math.PI * 2;
          }
          if (star && time - d.sparkAt > 160) {
            d.sparkAt = time;
            this.stars.explode(3, X, Y - 70 + oy);
          }
          break;
        }
        case FbAction.Fall: {
          // a tumble: tips over backwards about 60 degrees and gets straight back up (never lies flat)
          const t = Math.min(1, since / 0.6);
          rot = (face > 0 ? -1 : 1) * 1.05 * Math.sin(t * Math.PI);
          oy = Math.round(3 * Math.sin(t * Math.PI));
          sy = 1 - 0.08 * Math.sin(t * Math.PI);
          break;
        }
        case FbAction.Kneel: {
          // on his knees: the lower legs are hidden under him, slumped forward, a slow sad sway
          frame = 0;
          kneel = true;
          const drop = Math.min(1, since * 5);
          oy = Math.round((KNEEL_CUT - 2) * drop);
          rot = face * 0.14 * drop + Math.sin(time / 700 + d.slot) * 0.03;
          break;
        }
        default:
          if (d.speed > 0.7 || act === FbAction.Run) frame = 1 + (Math.floor(d.phase) % 4);
          else oy = Math.sin(time / 260 + d.slot * 1.7) > 0.6 ? 1 : 0;
          if (sad) {
            rot = face * 0.13;
            oy += 1;
          }
      }
      // winding up a shot: lean back, sink a little, tremble at full power
      if (mine && charge >= 0 && (act === FbAction.Idle || act === FbAction.Run)) {
        rot = -face * (0.08 + charge * 0.14);
        oy += 1 + Math.round(charge * 2);
        sy = 1 - charge * 0.05;
        if (charge >= 1) X += Math.round(Math.sin(time / 25));
      }
      d.sprite.setFrame(frame).setFlipX(flip).setRotation(rot).setScale(sx, sy).setPosition(X, Y + oy).setDepth(Y);
      if (kneel) d.sprite.setCrop(0, 0, 64, 72 - KNEEL_CUT);
      else if (d.sprite.isCropped) d.sprite.setCrop();
      // a beaten keeper gets a little rain cloud over the head
      if (kneel) d.cloud.setVisible(true).setFrame(Math.floor(time / 220) % 2).setPosition(X + face * 4, Y - 90 + oy + Math.round(Math.sin(time / 300) * 2)).setDepth(Y + 1);
      else if (d.cloud.visible) d.cloud.setVisible(false);
      d.shadow.setPosition(X, Y - 1).setScale(oy < -4 ? 0.8 : 1);
      // control ring, marker, label
      const pid = controlled.get(d.slot);
      if (pid !== undefined) {
        d.ring.setTexture(mine ? "fb-ringme" : `fb-ring${d.team}`).setVisible(true).setPosition(X, Y);
        if (mine && charge >= 0) d.ring.setAlpha(1).setScale(1 + charge * 0.35).setTint(charge >= 1 ? (Math.floor(time / 60) % 2 ? 0xffffff : 0xff8a2a) : 0xffb347);
        else d.ring.setAlpha(mine ? 0.75 + 0.25 * Math.sin(time / 140) : 0.95).setScale(1).clearTint();
        const bob = Math.round(Math.sin(time / (mine ? 160 : 220)) * 2);
        d.marker.setTexture(mine ? "fb-mkme" : `fb-mk${d.team}`).setVisible(true).setPosition(X, Y - 76 + bob + Math.min(0, oy)).setScale(mine ? 1.4 : 1);
      } else {
        d.ring.setVisible(false);
        d.marker.setVisible(false);
      }
      const kind = mine ? "me" : pid !== undefined || d.human ? "human" : "cpu";
      if (ctlKey !== this.lastCtl || !d.label || this.zoomChanged) this.labelFor(d, kind);
      d.label?.setPosition(X, Y - (pid !== undefined ? (mine ? 88 : 84) : 74) + (kneel ? oy : Math.min(0, oy)));
    }
    this.lastCtl = ctlKey;
    this.zoomChanged = false;

    // referee: runs where the frame puts her
    {
      const r = this.refState;
      const [x, y] = pose.ref;
      const dist = Math.hypot(x - r.x, y - r.y);
      r.speed += (dist / Math.max(dt, 0.001) - r.speed) * 0.25;
      r.phase += dist / 0.36;
      if (Math.abs(x - r.x) > 0.01) r.face = x > r.x ? 1 : -1;
      r.x = x;
      r.y = y;
      const X = Math.round(wx(x));
      const Y = Math.round(wy(y));
      this.ref.setPosition(X, Y).setDepth(Y).setFlipX(r.face < 0).setFrame(r.speed > 0.6 ? 1 + (Math.floor(r.phase) % 4) : 0);
      this.refShadow.setPosition(X, Y - 1);
    }

    // ball (at the predicted feet when this phone's duck has it)
    {
      let [x, y, z] = pose.ball;
      if (pr && pose.owner === mySlot && pose.p.length > mySlot * 4 + 1) {
        x += pr.x - pose.p[mySlot * 4];
        y += pr.y - pose.p[mySlot * 4 + 1];
      }
      const [px2, py2, pz2] = this.ballLast;
      const inv = 1 / Math.max(dt, 0.001);
      const jump = Math.hypot(x - px2, y - py2) > 5;
      if (!jump) {
        this.ballVel[0] += ((x - px2) * inv - this.ballVel[0]) * 0.35;
        this.ballVel[1] += ((y - py2) * inv - this.ballVel[1]) * 0.35;
        this.ballVel[2] += ((z - pz2) * inv - this.ballVel[2]) * 0.35;
      }
      this.ballLast = [x, y, z];
      const speed = Math.hypot(this.ballVel[0], this.ballVel[1]);
      if (!jump) this.ballRoll += (Math.hypot(x - px2, y - py2) / 0.07) * (this.ballVel[0] < 0 ? -1 : 1);
      // spinning too fast to see the patches: the blur frame
      const fr = speed > 14 ? 12 : ((Math.floor(this.ballRoll) % 12) + 12) % 12;
      const X = Math.round(wx(x, z));
      const Y = Math.round(wy(y, z));
      const depth = wy(y) + 0.3;
      this.ball.setPosition(X, Y - 5).setFrame(fr).setDepth(depth).setFlipX(this.ballVel[0] < 0);
      this.ballShadow.setPosition(Math.round(wx(x)), Math.round(wy(y))).setScale(Math.max(0.5, 1 - z * 0.15)).setAlpha(Math.max(0.25, 1 - z * 0.2));
      // the trail grows with the speed: ghost balls and speed lines on hard shots
      if (jump) this.ballHist.length = 0;
      this.ballHist.unshift([this.time.now, X, Y - 5]);
      while (this.ballHist.length > 2 && this.time.now - this.ballHist[this.ballHist.length - 1][0] > 220) this.ballHist.pop();
      // ghosts at fixed times behind the ball (the same spacing at any frame rate)
      const at = (ms: number): [number, number] | null => {
        const h = this.ballHist;
        const t = this.time.now - ms;
        for (let i = 1; i < h.length; i++)
          if (h[i][0] <= t) {
            const a = h[i - 1];
            const b = h[i];
            const u = (a[0] - t) / (a[0] - b[0] || 1);
            return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
          }
        return null;
      };
      const n = jump ? 0 : Math.round(clamp((speed - 11) / 2.5, 0, 7));
      this.ballTrail.forEach((t, i) => {
        const h = i < n ? at((i + 1) * 17) : null;
        if (h) t.setPosition(Math.round(h[0]), Math.round(h[1])).setAlpha((0.6 - i * 0.075) * (n / 7 + 0.3)).setDepth(depth - 0.01 - i * 0.001).setScale(1 - i * 0.07);
        else t.setAlpha(0);
      });
      this.speedG.clear();
      if (!jump && speed > 16) {
        const vx = this.ballVel[0] * PPM;
        const vy = this.ballVel[1] * PY - this.ballVel[2] * PZ;
        const vl = Math.hypot(vx, vy) || 1;
        const ux = vx / vl;
        const uy = vy / vl;
        const L = 24 + (speed - 16) * 4.2;
        const a = clamp((speed - 16) / 12, 0.25, 0.85);
        this.speedG.setDepth(depth - 0.02);
        for (const [off, k] of [
          [-4, 0.7],
          [0, 1],
          [4, 0.7],
        ] as const) {
          const sx0 = X - 5 * ux - uy * off;
          const sy0 = Y - 5 - 5 * uy + ux * off;
          if (!off) {
            this.speedG.lineStyle(6, 0xffffff, a * 0.35);
            this.speedG.lineBetween(sx0, sy0, sx0 - ux * L * 0.8, sy0 - uy * L * 0.8);
          }
          this.speedG.lineStyle(off ? 1 : 2, 0xffffff, a * k);
          this.speedG.lineBetween(sx0, sy0, sx0 - ux * L * k, sy0 - uy * L * k);
        }
      }
      // the crowd gets louder near a goal
      this.excite = Math.max(0, (Math.abs(x) - 18) / 14);
    }

    this.updateNets(time, dt);
    this.follow(pose, mySlot, dt, pr);
  }

  get tension() {
    return this.excite;
  }

  private follow(pose: Pose, mySlot: number, dt: number, pr: { x: number; y: number } | null) {
    const cam = this.cameras.main;
    if (this.camOverride) {
      cam.setZoom(this.camOverride.z);
      cam.centerOn(this.camOverride.x, this.camOverride.y);
      return;
    }
    const now = this.time.now;
    const focus = this.focus && now < this.focus.until ? this.focus : null;
    const party = !focus && this.stage === "goal" && this.scorer >= 0 && pose.p.length > this.scorer * 4 + 1;
    let want = Math.max(this.zoomMin, this.zoomWanted * (focus ? focus.mul : now < this.wideUntil ? 0.62 : party ? 1.15 : 1));
    if (now < this.punchUntil) want *= 1.05;
    if (cam.zoom !== want) {
      let z = cam.zoom + (want - cam.zoom) * (1 - Math.exp(-dt * (focus || now < this.punchUntil ? 7 : 2.2)));
      if (Math.abs(z - want) < 0.003) z = want;
      cam.setZoom(z);
    }
    const [bx, by] = pose.ball;
    let tx = bx + clamp(this.ballVel[0] * 0.4, -6, 6);
    let ty = by + clamp(this.ballVel[1] * 0.25, -4, 4);
    if (this.o.mode === "personal" && mySlot >= 0 && pose.p.length > mySlot * 4 + 1) {
      tx = tx * 0.75 + (pr ? pr.x : pose.p[mySlot * 4]) * 0.25;
      ty = ty * 0.75 + (pr ? pr.y : pose.p[mySlot * 4 + 1]) * 0.25;
    }
    let TX = wx(tx);
    let TY = wy(ty) - 20;
    if (focus) {
      TX = focus.x;
      TY = focus.y;
    } else if (party) {
      TX = wx(pose.p[this.scorer * 4]);
      TY = wy(pose.p[this.scorer * 4 + 1]) - 40;
    }
    if (!this.camPos.init) this.camPos = { x: TX, y: TY, init: true };
    const k = 1 - Math.exp(-dt * (focus ? 6 : 3.2));
    this.camPos.x += (TX - this.camPos.x) * k;
    this.camPos.y += (TY - this.camPos.y) * k;
    // clamp the centre ourselves so the camera eases into the corners instead of sticking
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    const cx = clamp(this.camPos.x, WORLD.left + vw / 2, WORLD.right - vw / 2);
    const cy = clamp(this.camPos.y, WORLD.top + vh / 2, WORLD.bottom - vh / 2);
    cam.centerOn(cx, cy);
  }

  private updateCrowd(time: number) {
    const loud = time < this.cheerUntil;
    for (const s of this.standSlices) {
      let o = 0;
      const amp = loud ? (!this.cheerSide || s.side === this.cheerSide ? 3 : 1) : this.excite > 0.5 ? 1 : 0;
      if (amp) o = Math.round(amp * Math.max(0, Math.sin(time / 110 + s.k * 0.9 + Math.sin(s.k * 1.7) * 2)));
      else if (Math.sin(time / 700 + s.k * 2.3) > 0.985) o = 1;
      s.img.y = s.y0 - o;
    }
    for (const f of this.fans) {
      const cheering = time < f.cheerUntil || (this.excite > 0.7 && Math.sin(time / 500 + f.ph * 3) > 0.7);
      const jump = cheering ? Math.round(Math.abs(Math.sin(time / 120 + f.ph)) * 6) : Math.sin(time / 600 + f.ph * 5) > 0.97 ? 1 : 0;
      f.img.setFrame(f.kind * 2 + (cheering ? 1 : 0));
      f.img.y = f.y - jump;
    }
  }
}
