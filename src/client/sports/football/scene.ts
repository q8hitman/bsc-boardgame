import Phaser from "phaser";
import { isClubChar } from "../../../shared/football/club";
import { TUNE } from "../../../shared/football/engine";
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
import { debugEnabled, FootballDebug } from "./debug";
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
  /** my sprint stamina 0..1 (undefined = not sent) */
  stamina: () => number | undefined;
  /** who my pass would reach right now (slot + 100 * kind, -1 = nobody), from the newest snapshot */
  aim: () => number;
  /** a slot at the newest snapshot (for correcting the prediction) */
  newest: (slot: number) => { x: number; y: number; vx: number; vy: number; act: number; t: number } | null;
  serverNow: () => number;
  /** something worth a one-time tip happened to my duck: shielding the ball, a defender about to tackle me */
  cue?: (k: "shield" | "warn") => void;
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
  /** the extra pose strip's texture key ("" = not loaded) */
  xkey: string;
  skidAt: number;
  /** smoothed pose (rotation, vertical offset, scale) so one action eases into the next instead of popping */
  rot: number;
  oy: number;
  sx: number;
  sy: number;
  /** smoothed change of speed (m/s²): leaning into a burst, back when braking */
  acc: number;
  /** the facing last frame, and when it flipped (a quick squash on the turn) */
  face: number;
  turnAt: number;
  /** the moves strip's texture key ("" = not loaded): windup, strike, pass, slide, get-up, header, falls, dive */
  mkey: string;
  /** what the last kick was (0 shot / clearance, 1 pass, 2 header) for its pose */
  kickKind: number;
  /** the action before this one (a slide or a fall is followed by getting up) */
  prevAct: number;
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

/** the extra pose strip (assets/football/extra/<char>-<team>.png, see club.ts): sprint1..4, slide, trap, skill, celebrate */
const X_SPRINT = 0;
const X_SLIDE = 4;
const X_TRAP = 5;
const X_SKILL = 6;
const X_CELEB = 7;
/** the moves strip (assets/football/moves/<char>-<team>.png, 96x72 frames, made by tools/pixel/moves.py) */
const M_WINDUP = 0;
const M_STRIKE = 1;
const M_PASS = 2;
const M_SLIDEIN = 3;
const M_SLIDE = 4;
const M_GETUP = 5;
const M_HEADER = 6;
const M_STAGGER = 7;
const M_DOWN = 8;
const M_DIVE = 9;

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
  /** the development debug view (?fbdebug), null in normal play */
  private debug: FootballDebug | null = null;
  /** name labels by look (slot, kind, name, resolution), reused instead of re-made */
  private labelCache = new Map<string, Phaser.GameObjects.Text>();
  /** the ball drawn at my predicted feet: the current offset from the server's ball (eased in and out) */
  private ballOff: [number, number] = [0, 0];
  private speedG!: Phaser.GameObjects.Graphics;
  /** slide marks on the grass: [time, x, y, w] in world px */
  private skids: [number, number, number, number][] = [];
  private skidG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
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
  /** the extra strips carry a real arms-up celebrate pose (else that frame is a jump) */
  hasCeleb = true;
  private zoomChanged = false;
  /** the match: stage and who scored / won, for celebrating and drooping */
  private stage: FbStage = "kickoff";
  private goalTeam: FbTeam | -1 = -1;
  private scorer = -1;
  private result: FbTeam | -1 | undefined;
  /** the controlled duck, predicted here from the stick */
  private tired = false;
  private pred = {
    slot: -1, x: 0, y: 0, vx: 0, vy: 0, face: 1, phase: 0, sprint: false,
    /** heading (unit), the slide started here (time left, direction, cooldown), the last A, the action to show (-1 = by speed) */
    hx: 1, hy: 0, slide: 0, sdx: 1, sdy: 0, slideCd: 0, aPrev: false, act: -1,
    /** the last B, and a kick shown here at once (a shot on release, a pass on A) until the server catches up */
    bPrev: false, kick: 0,
  };

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
    if (debugEnabled()) {
      this.debug = new FootballDebug(this);
      this.events.once("destroy", () => this.debug?.destroy());
    }
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
    this.skidG = this.add.graphics().setDepth(D_DECAL - 5);
    this.fxG = this.add.graphics().setDepth(D_TOP - 3);
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
        this.load.spritesheet(`x${k}`, `assets/football/extra/${char}-${team === "1" ? "red" : "blue"}.png`, { frameWidth: 64, frameHeight: 72 });
        this.load.spritesheet(`m${k}`, `assets/football/moves/${char}-${team === "1" ? "red" : "blue"}.png`, { frameWidth: 96, frameHeight: 72 });
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
    }
    for (const t of this.labelCache.values()) t.destroy();
    this.labelCache.clear();
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
        xkey: this.textures.exists(`x${key}`) ? `x${key}` : "",
        skidAt: 0,
        rot: 0,
        oy: 0,
        sx: 1,
        sy: 1,
        acc: 0,
        turnAt: -1e9,
        face: 1,
        mkey: this.textures.exists(`m${key}`) ? `m${key}` : "",
        kickKind: 0,
        prevAct: 0,
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
    // labels are kept and reused: making a text (Arabic shaping + a texture upload) every time the control
    // switches to another duck hitched the frame on phones
    d.label?.setVisible(false);
    const cached = this.labelCache.get(key);
    if (cached) {
      d.label = cached.setVisible(true);
      d.labelKey = key;
      return;
    }
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
    this.labelCache.set(key, d.label);
    d.labelKey = key;
  }

  /* ------------------------------------------------------------------ effects */
  /** a frame event; `speed` = the ball's speed just after it (m/s), so kicks look as hard as they are */
  fx(kind: number, slot: number, speed = 0) {
    if (!this.built) return;
    const [bx, by, bz] = this.ballLast;
    const X = wx(bx, bz);
    const Y = wy(by, bz) - 5;
    // the kicker's pose: a header (the ball up at head height), a pass, or a strike
    if (kind === FbEvent.Kick || kind === FbEvent.Pass) {
      const d = this.ducks.find((q) => q.slot === slot);
      if (d) d.kickKind = bz > 0.8 ? 2 : kind === FbEvent.Pass ? 1 : 0;
    }
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
  /** move this phone's duck at once from the stick (engine speeds), easing towards the server's position. It keeps
   *  going through slides, falls and skill moves (following the server's own motion), so the duck never jumps back
   *  ~100 ms when one starts or snaps forward when it ends. A slide starts here the moment A is pressed. */
  private predict(slot: number, owner: number, dt: number) {
    const p = this.pred;
    const inp = this.o.input();
    const nw = slot >= 0 ? this.o.newest(slot) : null;
    if (!inp || !nw || this.stage !== "play") {
      p.slot = -1;
      p.slide = 0;
      p.act = -1;
      return null;
    }
    // where the server has the duck now (the newest frame, carried forward a little)
    const age = clamp((this.o.serverNow() - nw.t) / 1000 + 0.05, 0, 0.3);
    const ex = nw.x + nw.vx * age;
    const ey = nw.y + nw.vy * age;
    if (p.slot !== slot) Object.assign(p, { slot, x: ex, y: ey, vx: nw.vx, vy: nw.vy, slide: 0, act: -1 });
    let ix = inp.x;
    let iy = inp.y;
    const il = Math.hypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    if (il >= 0.3) {
      const m = Math.min(1, il);
      p.hx = ix / m;
      p.hy = iy / m;
    }
    const st = this.o.stamina();
    // the engine's rule: run dry and the sprint stops until the bar is back to tiredUntil
    if (st !== undefined && st < 0.02) this.tired = true;
    else if (st === undefined || st >= TUNE.tiredUntil) this.tired = false;
    const sprint = !!inp.s && il > 0.1 && !this.tired;
    p.sprint = sprint;
    // A without the ball against the other team: slide now, here (the server confirms it a moment later)
    const me = this.ducks.find((d) => d.slot === slot);
    const od = owner >= 0 ? this.ducks.find((d) => d.slot === owner) : undefined;
    const aDown = inp.a && !p.aPrev;
    const aUp = !inp.a && p.aPrev;
    p.aPrev = inp.a;
    const bUp = !inp.b && p.bPrev;
    p.bPrev = inp.b;
    p.kick = Math.max(0, p.kick - dt);
    // with the ball: the pass and the shot go when the button is let go: swing the leg straight away
    if (owner === slot && (aUp || bUp)) p.kick = 0.25;
    p.slideCd = Math.max(0, p.slideCd - dt);
    const free = nw.act === FbAction.Idle || nw.act === FbAction.Run || nw.act === FbAction.Sprint || nw.act === FbAction.Kick || nw.act === FbAction.Trap;
    if (aDown && free && p.slide <= 0 && p.slideCd <= 0 && owner !== slot && (!od || !me || od.team !== me.team)) {
      p.slide = TUNE.slideTime;
      p.slideCd = TUNE.slideCooldown + TUNE.slideTime;
      p.sdx = p.hx;
      p.sdy = p.hy;
    }
    // the server says something else is going on (a fall, a stumble): drop the local slide
    if (p.slide > 0 && !free && nw.act !== FbAction.Slide) p.slide = 0;
    let follow = 0;
    if (p.slide > 0) {
      p.slide -= dt;
      const u = clamp(p.slide / TUNE.slideTime, 0, 1);
      const k = Math.max(0.22, u * (1.15 - 0.15 * u));
      // the server may bend it onto the ball (aim assist): lean towards its direction once it reports the slide
      if (nw.act === FbAction.Slide) {
        const sv = Math.hypot(nw.vx, nw.vy);
        if (sv > 2) {
          p.sdx += (nw.vx / sv - p.sdx) * Math.min(1, dt * 10);
          p.sdy += (nw.vy / sv - p.sdy) * Math.min(1, dt * 10);
        }
      }
      p.vx = p.sdx * TUNE.slideSpeed * k;
      p.vy = p.sdy * TUNE.slideSpeed * k;
      follow = 5;
    } else if (!free) {
      // a fall, a skill move, a server-side slide: move as the server moves
      const k = Math.min(1, dt * 14);
      p.vx += (nw.vx - p.vx) * k;
      p.vy += (nw.vy - p.vy) * k;
      follow = 8;
    } else {
      const max = owner === slot ? (sprint ? TUNE.sprintBall : TUNE.jogBall) : sprint ? TUNE.sprintSpeed : TUNE.jogSpeed;
      // the server's defending assist (engine personDrive): running at the other team's carrier (within 7 m, the
      // stick within 60 degrees of him) it steers to the goal-side spot, not along the stick. Follow the server's
      // direction there, or the duck runs one way here and is pulled back the other way (a stutter)
      let ax = ix;
      let ay = iy;
      if (owner >= 0 && owner !== slot && od && me && od.team !== me.team && il >= 0.3 && !aDown) {
        const on = this.o.newest(owner);
        if (on) {
          const cx = on.x - p.x;
          const cy = on.y - p.y;
          const cd = Math.hypot(cx, cy);
          const sv = Math.hypot(nw.vx, nw.vy);
          if (cd < 7 && cd > 0.2 && (ix * cx + iy * cy) / (cd * Math.min(1, il)) > 0.5 && sv > 0.5) {
            const k = Math.min(1, il);
            ax = (nw.vx / sv) * k;
            ay = (nw.vy / sv) * k;
            follow = 5;
          }
        }
      }
      const tvx = ax * max;
      const tvy = ay * max;
      let dvx = tvx - p.vx;
      let dvy = tvy - p.vy;
      const dl = Math.hypot(dvx, dvy);
      let lim = (sprint ? TUNE.accelSprint : TUNE.accel) * dt;
      if (tvx * p.vx + tvy * p.vy < 0 || Math.hypot(tvx, tvy) < Math.hypot(p.vx, p.vy) - 0.5) lim *= TUNE.brakeFactor;
      if (dl > lim) {
        dvx *= lim / dl;
        dvy *= lim / dl;
      }
      p.vx += dvx;
      p.vy += dvy;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // ease towards the server; a big disagreement (a reset, a teleport) snaps
    const ex2 = ex - p.x;
    const ey2 = ey - p.y;
    if (Math.hypot(ex2, ey2) > 3) {
      p.x = ex;
      p.y = ey;
      p.vx = nw.vx;
      p.vy = nw.vy;
      p.slide = 0;
    } else {
      const k = Math.min(1, dt * (follow || (il < 0.1 ? 7 : 2.5)));
      p.x += ex2 * k;
      p.y += ey2 * k;
    }
    p.x = clamp(p.x, -HALF_L - 1, HALF_L + 1);
    p.y = clamp(p.y, -PITCH.width / 2 - 0.5, PITCH.width / 2 + 0.5);
    if (p.slide > 0) p.face = p.sdx >= 0 ? 1 : -1;
    else if (Math.abs(ix) > 0.15 && free) p.face = ix > 0 ? 1 : -1;
    else if (!free && Math.abs(nw.vx) > 0.5) p.face = nw.vx > 0 ? 1 : -1;
    p.act = p.slide > 0 ? FbAction.Slide : !free ? nw.act : p.kick > 0 ? FbAction.Kick : -1;
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
    this.fxG.clear();
    this.drawSkids(time);
    const pr = this.predict(mySlot, pose.owner, dt);
    const charge = mySlot >= 0 && pose.owner === mySlot ? this.o.charge() : -1;
    const over = this.stage === "over" && this.result !== undefined;
    const aimV = mySlot >= 0 && pose.owner === mySlot ? this.o.aim() : -1;
    const aimSlot = aimV >= 0 ? aimV % 100 : -1;
    const aimKind = aimV >= 0 ? Math.floor(aimV / 100) : 0;
    const myTeam = mySlot >= 0 ? this.teamOf(mySlot) : -1;

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
        if (pr.act >= 0) act = pr.act;
        else if (act === FbAction.Idle || act === FbAction.Run || act === FbAction.Sprint) {
          const v = Math.hypot(pr.vx, pr.vy);
          act = v > 0.6 ? (pr.sprint && v > 6 ? FbAction.Sprint : FbAction.Run) : FbAction.Idle;
        }
      }
      const dist = Math.hypot(x - d.lx, y - d.ly);
      const sp = dist / Math.max(dt, 0.001);
      const prevSpeed = d.speed;
      d.speed += (Math.min(sp, 14) - d.speed) * 0.25;
      d.acc += (clamp((d.speed - prevSpeed) / Math.max(dt, 0.001), -40, 40) - d.acc) * 0.12;
      if (face !== d.face) {
        d.face = face;
        d.turnAt = time;
      }
      d.vy += ((y - d.ly) / Math.max(dt, 0.001) - d.vy) * 0.3;
      d.lx = x;
      d.ly = y;
      if (act !== d.act) {
        d.prevAct = d.act;
        d.act = act;
        d.actAt = time;
      }
      // the side that just conceded (or lost) trudges, head down
      const sad = (this.goalTeam !== -1 && d.team !== this.goalTeam) || (over && this.result !== -1 && d.team !== this.result);
      // cadence follows the ground covered: a frame every 0.36 m jogging, longer strides flat out
      d.phase += dist / (sad ? 0.5 : act === FbAction.Sprint ? 0.55 : 0.36);
      let X = Math.round(wx(x));
      const Y = Math.round(wy(y));
      let frame = 0;
      let rot = 0;
      let oy = 0;
      let flip = face < 0;
      let sx = 1;
      let sy = 1;
      let kneel = false;
      /** a pose from the extra strip (-1 = the main strip's `frame`) */
      let xf = -1;
      /** a pose from the moves strip (-1 = none): see tools/pixel/moves.py */
      let mf = -1;
      const since = (time - d.actAt) / 1000;
      // just up from a slide or a fall: a crouch for a moment
      const rising = (d.prevAct === FbAction.Slide || d.prevAct === FbAction.Fall) && since < 0.14 && (act === FbAction.Idle || act === FbAction.Run || act === FbAction.Sprint);
      switch (act) {
        case FbAction.Kick: {
          if (d.kickKind === 2) {
            // a header: up off the ground, the body thrown at the ball
            mf = M_HEADER;
            oy = -Math.round(10 * Math.sin(Math.min(1, since / 0.3) * Math.PI));
          } else if (d.kickKind === 1) mf = since < 0.05 ? M_WINDUP : M_PASS;
          else {
            // the strike: the leg snaps through, a little hop off the standing foot
            mf = since < 0.04 ? M_WINDUP : M_STRIKE;
            oy = since > 0.04 && since < 0.14 ? -2 : 0;
          }
          break;
        }
        case FbAction.Slide: {
          // down on the hip with the leading leg out along the grass
          mf = since < 0.07 ? M_SLIDEIN : M_SLIDE;
          if (time - d.dustAt > 40) {
            d.dustAt = time;
            this.dust.explode(3, X + face * 18, Y);
          }
          if (time - d.skidAt > 30 && d.speed > 1.5) {
            d.skidAt = time;
            this.skids.push([time, X + face * 6, Y, 2 + Math.round(d.speed * 0.6)]);
            if (this.skids.length > 120) this.skids.shift();
          }
          break;
        }
        case FbAction.Sprint:
          frame = 1 + (Math.floor(d.phase) % 4);
          xf = X_SPRINT + (Math.floor(d.phase) % 4);
          // the sprint frames lean into it; a bounce on each stride
          oy = -Math.round(Math.abs(Math.sin((d.phase % 2) * Math.PI * 0.5)) * 2);
          // a puff of grass every other footfall
          if (Math.floor(d.phase) !== Math.floor(d.phase - dist / 0.55) && Math.floor(d.phase) % 2 === 0) this.dust.explode(2, X - face * 8, Y);
          break;
        case FbAction.Trap: {
          // the knee comes up to meet the ball, then settles
          frame = 0;
          xf = X_TRAP;
          oy = since < 0.08 ? -2 : since < 0.16 ? -1 : 0;
          break;
        }
        case FbAction.Skill: {
          // a quick feint: the body sways one way and flicks the other, a whoosh round the feet
          frame = 5;
          xf = X_SKILL;
          const t = Math.min(1, since / 0.35);
          X += Math.round(Math.sin(t * Math.PI * 2) * 4);
          if (Math.floor(time / 50) % 2 === 0 && t < 0.6) flip = !flip;
          if (t < 1) this.whoosh(X, Y, t, face);
          break;
        }
        case FbAction.Dive: {
          // stretched out flat, off the ground in an arc
          mf = since < 0.05 ? M_STAGGER : M_DIVE;
          oy = -Math.round(14 * Math.sin(Math.min(1, since * 1.6) * Math.PI));
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
            if (hop > 0.3 && this.hasCeleb) xf = X_CELEB;
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
        case FbAction.Lean: {
          // about to tackle: weight back, eyes on the ball (a "!" over him when it is coming at my team)
          mf = M_WINDUP;
          X -= Math.round(face * Math.min(1, since * 8) * 2);
          break;
        }
        case FbAction.Tackle: {
          // the boot stabs in at the ball
          mf = M_SLIDEIN;
          if (time - d.dustAt > 60) {
            d.dustAt = time;
            this.dust.explode(2, X + face * 14, Y);
          }
          break;
        }
        case FbAction.Stagger: {
          // missed / beaten: rocked back off balance, arms out
          mf = M_STAGGER;
          X -= Math.round(face * Math.min(1, since * 6) * 3);
          break;
        }
        case FbAction.Fall: {
          // taken out: rocked back, down on the grass, then up on one knee
          mf = since < 0.12 ? M_STAGGER : since < 0.38 ? M_DOWN : M_GETUP;
          if (since < 0.12) X -= Math.round(face * since * 20);
          break;
        }
        case FbAction.Kneel: {
          // on his knees: the lower legs are hidden under him, slumped forward, a slow sad sway
          frame = 0;
          kneel = true;
          const drop = Math.min(1, since * 5);
          oy = Math.round((KNEEL_CUT - 2) * drop);
          X += Math.round(Math.sin(time / 700 + d.slot) * 1);
          break;
        }
        default:
          if (d.speed > 0.7 || act === FbAction.Run) {
            frame = 1 + (Math.floor(d.phase) % 4);
            // a light bob on every stride; bursting off (or out of a turn) uses the leaning sprint strides
            oy = -Math.round(Math.abs(Math.sin((d.phase % 2) * Math.PI * 0.5)) * 1.6);
            if (d.acc > 12 && d.speed > 2.5 && !sad) xf = X_SPRINT + (Math.floor(d.phase) % 4);
          } else oy = Math.sin(time / 260 + d.slot * 1.7) > 0.6 ? 1 : 0;
          if (sad) oy += 1;
          if (rising) mf = M_GETUP;
      }
      // winding up a shot: lean back, sink a little, tremble at full power
      if (mine && charge >= 0 && (act === FbAction.Idle || act === FbAction.Run)) {
        // the leg drawn back while the shot charges; trembling at full power
        if (charge > 0.12) mf = M_WINDUP;
        if (charge >= 1) X += Math.round(Math.sin(time / 25));
      }
      // ease between poses (into a slide, back up after it, out of a kick) instead of popping; the big spins
      // (a celebration twirl, a skill move, a dive) are shown as they are
      if (act === FbAction.Celebrate || act === FbAction.Skill || act === FbAction.Dive || act === FbAction.Kneel || Math.abs(rot - d.rot) > 1.5) {
        d.rot = rot;
        d.oy = oy;
      } else {
        const k = 1 - Math.exp(-dt * (act === FbAction.Slide || act === FbAction.Kick ? 40 : 18));
        d.rot += (rot - d.rot) * k;
        d.oy += (oy - d.oy) * k;
      }
      const ks = 1 - Math.exp(-dt * 30);
      d.sx += (sx - d.sx) * ks;
      d.sy += (sy - d.sy) * ks;
      rot = d.rot;
      oy = Math.round(d.oy);
      sx = d.sx;
      sy = d.sy;
      if (mf >= 0 && d.mkey) {
        if (d.sprite.texture.key !== d.mkey) d.sprite.setTexture(d.mkey, mf);
        else d.sprite.setFrame(mf);
      } else if (xf >= 0 && d.xkey) {
        if (d.sprite.texture.key !== d.xkey) d.sprite.setTexture(d.xkey, xf);
        else d.sprite.setFrame(xf);
      } else {
        if (d.sprite.texture.key !== d.key) d.sprite.setTexture(d.key, frame);
        else d.sprite.setFrame(frame);
      }
      d.sprite.setFlipX(flip).setRotation(rot).setScale(sx, sy).setPosition(X, Y + oy).setDepth(Y);
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
      if (mine) this.staminaBar(X, Y, act === FbAction.Sprint);
      // sprinting: speed streaks behind my duck (so the sprint shows, not only the bar)
      if (mine && act === FbAction.Sprint) this.streaks(X, Y + Math.min(0, oy), face, time);
      // the ball at my feet with a computer defender close: a blue shield on his side when my back is to him (he
      // can't take it from there), a red arc when he is in front of me or at my side (he can)
      if (mine && pr && pose.owner === mySlot) this.shieldMark(X, Y, pr, pose, controlled, d.team, time);
      // the team-mate my pass would reach: a ring at his feet and a chevron over him (white = to feet, yellow =
      // through / long ball, orange = cross)
      if (aimSlot === d.slot) this.aimMark(X, Y + Math.min(0, oy), aimKind, time);
      // a defender about to tackle my team's carrier: a "!" over him (you can turn away)
      if (act === FbAction.Lean && !controlled.has(d.slot) && myTeam >= 0 && d.team !== myTeam && pose.owner >= 0 && this.teamOf(pose.owner) === myTeam) {
        this.warnMark(X, Y - 94 + Math.min(0, oy), since, time);
        this.o.cue?.("warn");
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
      // with this phone's duck the ball sits at its predicted feet; when it leaves them (a shot, a pass, a tackle)
      // or arrives, that offset eases out / in, so the ball never hops back to where the duck was ~100 ms ago
      let tox = 0;
      let toy = 0;
      if (pr && pose.owner === mySlot && pose.p.length > mySlot * 4 + 1) {
        tox = pr.x - pose.p[mySlot * 4];
        toy = pr.y - pose.p[mySlot * 4 + 1];
      }
      const kOff = 1 - Math.exp(-dt * (tox || toy ? 16 : 7));
      this.ballOff[0] += (tox - this.ballOff[0]) * kOff;
      this.ballOff[1] += (toy - this.ballOff[1]) * kOff;
      if (Math.hypot(this.ballOff[0], this.ballOff[1]) > 4) this.ballOff = [tox, toy];
      x += this.ballOff[0];
      y += this.ballOff[1];
      const od = pose.owner >= 0 ? this.ducks[pose.owner] : undefined;
      if (od && z < 0.2) {
        const face = od.sprite.flipX ? -1 : 1;
        if (od.act === FbAction.Run && od.speed > 1) {
          // a touch every two strides: knocked on a little, then the duck catches it up
          const u = (od.phase / 4) % 1;
          x += face * (u < 0.18 ? (u / 0.18) * 0.22 : 0.22 * (1 - (u - 0.18) / 0.82)) - face * 0.08;
        } else if (od.act === FbAction.Skill) {
          // rolled round the feet
          const t = Math.min(1, (this.time.now - od.actAt) / 350);
          const a = t * Math.PI * 2;
          x += face * (Math.cos(a) - 1) * 0.35;
          y += Math.sin(a) * 0.3;
        } else if (od.act === FbAction.Trap) {
          // dropping dead at the feet
          const t = Math.min(1, (this.time.now - od.actAt) / 180);
          z += (1 - t) * 0.25;
        }
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
    if (this.debug) this.debug.draw(this.o.input());
  }

  /** the sprint bar under my duck: shown while it is not full */
  private staminaBar(X: number, Y: number, sprinting: boolean) {
    const v = this.o.stamina();
    if (v === undefined || (v > 0.985 && !sprinting)) return;
    const w = 28;
    const g = this.fxG;
    const x0 = X - w / 2;
    const y0 = Y + 7;
    g.fillStyle(0x0b0d1c, 0.85).fillRect(x0 - 1, y0 - 1, w + 2, 5);
    g.fillStyle(0x2a2f4d, 1).fillRect(x0, y0, w, 3);
    const col = v < 0.08 ? (Math.floor(this.time.now / 120) % 2 ? 0xe8452c : 0x7a1d14) : v < 0.35 ? 0xff9a2a : 0x3ddc5a;
    g.fillStyle(col, 1).fillRect(x0, y0, Math.round(w * clamp(v, 0, 1)), 3);
    g.fillStyle(0xffffff, 0.35).fillRect(x0, y0, Math.round(w * clamp(v, 0, 1)), 1);
  }

  /** three speed streaks trailing my sprinting duck */
  private streaks(X: number, Y: number, face: number, time: number) {
    const g = this.fxG;
    for (let i = 0; i < 3; i++) {
      const ph = ((time / 90 + i * 0.37) % 1 + 1) % 1;
      const len = 6 + Math.round(8 * (1 - ph));
      const x0 = X - face * (16 + Math.round(ph * 14));
      const y0 = Y - 14 - i * 11;
      g.fillStyle(0xffffff, 0.75 * (1 - ph)).fillRect(face > 0 ? x0 - len : x0, y0, len, 2);
    }
  }
  /** shielding: the nearest computer defender within reach of the ball, and is my back to him? (the engine's rule:
   *  a computer duck never tackles a person's carrier from behind, front < -0.25 of the carrier's heading) */
  private shieldMark(X: number, Y: number, pr: { x: number; y: number; hx: number; hy: number }, pose: Pose, controlled: Map<number, string>, team: number, time: number) {
    let best = 9;
    let bx = 0;
    let by = 0;
    for (const o of this.ducks) {
      if (o.team === team || controlled.has(o.slot)) continue;
      const i = o.slot * 4;
      if (pose.p.length < i + 4) continue;
      const ox = pose.p[i] - pr.x;
      const oy = pose.p[i + 1] - pr.y;
      const dd = Math.hypot(ox, oy);
      if (dd < best) {
        best = dd;
        bx = ox;
        by = oy;
      }
    }
    if (best > 1.9) return;
    const safe = (bx * pr.hx + by * pr.hy) / (best || 1) < -0.25;
    const g = this.fxG;
    // an arc on the ellipse round the feet, centred on the defender's side
    const sX = wx(pr.x + bx) - wx(pr.x);
    const sY = wy(pr.y + by) - wy(pr.y);
    const a = Math.atan2(sY * 2.5, sX);
    const col = safe ? 0x4ad8ff : 0xff4a3a;
    const pulse = 0.65 + 0.35 * Math.sin(time / 120);
    for (let k = -5; k <= 5; k++) {
      const t = a + k * 0.2;
      const px = Math.round(X + Math.cos(t) * 26);
      const py = Math.round(Y - 2 + Math.sin(t) * 10);
      g.fillStyle(0x0b0d1c, 0.7).fillRect(px - 3, py - 2, 6, 5);
      g.fillStyle(col, pulse).fillRect(px - 2, py - 1, 4, 3);
    }
    if (!safe) return;
    // a little shield badge at body height on his side
    const cx = X + (sX >= 0 ? 24 : -24);
    const cy = Y - 34;
    const sh = (r: number) => [
      { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + 1 }, { x: cx, y: cy + r + 2 }, { x: cx - r, y: cy + 1 },
    ];
    g.fillStyle(0x0b0d1c, 0.9).fillPoints(sh(10), true);
    g.fillStyle(0x4ad8ff, 1).fillPoints(sh(8), true);
    g.fillStyle(0x1a8fc4, 1).fillPoints([{ x: cx, y: cy - 8 }, { x: cx + 8, y: cy - 8 }, { x: cx + 8, y: cy + 1 }, { x: cx, y: cy + 10 }], true);
    g.fillStyle(0xffffff, 0.9).fillRect(cx - 6, cy - 6, 4, 2).fillRect(cx - 6, cy - 6, 2, 6);
    this.o.cue?.("shield");
  }

  private teamOf(slot: number) {
    return this.ducks[slot]?.team ?? -1;
  }
  /** the receiver of my pass: a pulsing ring at his feet and a chevron over his head */
  private aimMark(X: number, Y: number, kind: number, time: number) {
    const g = this.fxG;
    const col = kind === 2 ? 0xff8a2a : kind === 1 ? 0xffd84a : 0xffffff;
    const p = 0.5 + 0.5 * Math.sin(time / 110);
    g.lineStyle(2, col, 0.55 + 0.4 * p).strokeEllipse(X, Y - 1, 30 + p * 4, 12 + p * 1.5);
    const cy = Y - 96 - Math.round(p * 3);
    g.fillStyle(0x0b0d1c, 0.8).fillTriangle(X - 8, cy - 1, X + 8, cy - 1, X, cy + 9);
    g.fillStyle(col, 1).fillTriangle(X - 6, cy, X + 6, cy, X, cy + 7);
  }
  /** a defender about to tackle: a red "!" bubble over him, popping in */
  private warnMark(X: number, Y: number, since: number, time: number) {
    const g = this.fxG;
    const k = Math.min(1, since * 10);
    const h = Math.round(14 * k);
    if (h < 3) return;
    const blink = Math.floor(time / 90) % 2 === 0;
    g.fillStyle(0x0b0d1c, 0.9).fillRoundedRect(X - 7, Y - h - 4, 14, h + 6, 3);
    g.fillStyle(blink ? 0xff3b2a : 0xffd84a, 1).fillRoundedRect(X - 5, Y - h - 2, 10, h + 2, 2);
    g.fillStyle(0xffffff, 1).fillRect(X - 1, Y - h + 1, 2, Math.max(1, h - 6)).fillRect(X - 1, Y - 3, 2, 2);
  }

  /** the skill move's whoosh: a white arc sweeping round the feet */
  private whoosh(X: number, Y: number, t: number, face: number) {
    const g = this.fxG;
    const a0 = -Math.PI / 2 + t * Math.PI * 2 * face;
    for (let i = 0; i < 6; i++) {
      const a = a0 - face * i * 0.22;
      const px = X + Math.cos(a) * 16;
      const py = Y - 6 + Math.sin(a) * 6;
      g.fillStyle(0xffffff, (0.85 - i * 0.14) * (1 - t * 0.6)).fillRect(Math.round(px) - 1, Math.round(py) - 1, i < 2 ? 3 : 2, 2);
    }
  }

  /** slide marks: darker, flattened grass that fades out over a few seconds */
  private drawSkids(time: number) {
    const g = this.skidG;
    g.clear();
    while (this.skids.length && time - this.skids[0][0] > 3000) this.skids.shift();
    for (const [t, x, y, w] of this.skids) {
      const a = 0.32 * (1 - (time - t) / 3000);
      g.fillStyle(0x2d5a1a, a).fillRect(x - w / 2, y - 1, w, 3);
      g.fillStyle(0x9fd07a, a * 0.6).fillRect(x - w / 2, y - 2, w, 1);
    }
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
