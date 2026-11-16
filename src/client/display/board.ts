import Phaser from "phaser";
import { DUCKS, LANDMARKS, TILE_INFO } from "../../shared/data";
import type { Board, Player } from "../../shared/types";
import { sfx } from "../sfx";

export const W = 1920;
const FONT = '"Baloo Bhaijaan 2", Arial';
export const H = 1080;
const HOP_MS = 330;
const PIECE = 0.29; // cartoon token renders are 251x286 (shared crop), base ~190px wide -> ~55px, about one space

/** Offsets so several pieces on one tile don't overlap (back row first so front pieces draw on top). */
const SLOTS = [
  [0, 0], [-26, -9], [26, -9], [0, 13], [-26, 13], [26, 13], [-48, 2], [48, 2],
];

class BoardScene extends Phaser.Scene {
  board!: Board;
  scale2 = 1;
  ducks = new Map<string, { c: Phaser.GameObjects.Container; sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; ring: Phaser.GameObjects.Ellipse; hover: Phaser.Tweens.Tween | null; node: number }>();
  busy = new Set<string>();
  star!: Phaser.GameObjects.Container;
  starNode = -1;
  ready!: () => void;

  constructor() {
    super("board");
  }

  init(data: { board: Board; ready: () => void }) {
    this.board = data.board;
    this.ready = data.ready;
    this.scale2 = W / data.board.width;
  }

  preload() {
    this.load.image("map", this.board.image);
    DUCKS.forEach((_, i) => this.load.image(`tok${i}`, `assets/tokens/token${i}.png`));
  }

  pos(node: number) {
    const n = this.board.nodes[node];
    return { x: n.x * this.scale2, y: n.y * this.scale2 };
  }

  get race() {
    return this.board.mode === "race";
  }

  create() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    this.add.image(0, 0, "map").setOrigin(0).setDisplaySize(W, H);
    this.makeTextures();
    this.ambient();
    if (this.race) this.drawNumbers();
    else this.drawTiles();
    this.star = this.makeStar();
    if (this.race) this.star.setVisible(false);
    this.ready();
  }

  /** Race boards: the squares are painted; add the cell numbers (green = ladder foot, red = snake head). */
  private drawNumbers() {
    const cw = (this.board.cell?.[0] ?? 94) * this.scale2;
    const ch = (this.board.cell?.[1] ?? 89) * this.scale2;
    const jumpAt = new Map((this.board.jumps ?? []).map((j) => [j.from, j.kind]));
    for (const n of this.board.nodes) {
      const { x, y } = this.pos(n.id);
      const k = jumpAt.get(n.id);
      const label = String(n.id + 1).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
      this.add.text(x - cw * 0.5 + 7, y - ch * 0.5 + 3, label, {
        fontFamily: FONT, fontSize: "21px", fontStyle: "800",
        color: k === "ladder" ? "#2f7a3a" : k === "snake" ? "#a4321f" : "#5c4020",
        stroke: "#f7ecd2", strokeThickness: 5,
      }).setOrigin(0, 0).setDepth(12).setAlpha(0.92);
    }
  }

  // ------------------------------------------------------------ textures
  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // star
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 26 : 60;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(new Phaser.Math.Vector2(64 + Math.cos(a) * r, 64 + Math.sin(a) * r));
    }
    g.fillStyle(0xffd23f).fillPoints(pts, true);
    g.lineStyle(7, 0x7a4a00).strokePoints(pts, true, true);
    g.fillStyle(0xffffff, 0.6).fillEllipse(52, 44, 18, 10);
    g.generateTexture("star", 128, 128);
    g.clear();
    // soft round particle
    for (let r = 16; r > 0; r--) {
      g.fillStyle(0xffffff, (1 - r / 16) * 0.25);
      g.fillCircle(16, 16, r);
    }
    g.generateTexture("soft", 32, 32);
    g.clear();
    g.fillStyle(0xffffff).fillCircle(4, 4, 4);
    g.generateTexture("dot", 8, 8);
    g.clear();
    // cloud shadow
    for (let r = 120; r > 0; r -= 4) {
      g.fillStyle(0x0b2540, 0.012);
      g.fillEllipse(260, 140, r * 4, r * 2);
    }
    g.generateTexture("cloud", 520, 280);
    g.destroy();
  }

  private ambient() {
    if (this.board.mode === "race") {
      // warm dust motes drifting over the old paper
      this.add.particles(0, 0, "soft", {
        x: { min: 0, max: W }, y: { min: 0, max: H }, lifespan: 7000,
        speedX: { min: -8, max: 8 }, speedY: { min: -10, max: -2 },
        scale: { start: 0.2, end: 0 }, alpha: { start: 0.55, end: 0 }, frequency: 420, tint: [0xfff1c8, 0xffe0a0],
        blendMode: "ADD",
      }).setDepth(901);
      return;
    }
    // drifting cloud shadows
    for (let i = 0; i < 3; i++) {
      const c = this.add.image(Phaser.Math.Between(-400, W), Phaser.Math.Between(120, H - 160), "cloud")
        .setScale(Phaser.Math.FloatBetween(1.2, 2)).setDepth(900).setAlpha(0.9);
      this.tweens.add({
        targets: c, x: W + 600, duration: Phaser.Math.Between(70000, 110000), repeat: -1,
        onRepeat: () => { c.x = -600; c.y = Phaser.Math.Between(120, H - 160); },
      });
    }
    // sparkles on water: sample bluish pixels from the map
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < 1500 && spots.length < 120; i++) {
      const x = Phaser.Math.Between(0, this.board.width - 1);
      const y = Phaser.Math.Between(0, this.board.height - 1);
      const c = this.textures.getPixel(x, y, "map");
      if (c && c.blue > 200 && c.red < 110 && c.green > 150) spots.push({ x: x * this.scale2, y: y * this.scale2 });
    }
    this.time.addEvent({
      delay: 140, loop: true, callback: () => {
        const s = Phaser.Utils.Array.GetRandom(spots);
        if (!s) return;
        const d = this.add.image(s.x, s.y, "dot").setScale(0.2).setAlpha(0).setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: d, alpha: 0.9, scale: 0.7, yoyo: true, duration: 600, onComplete: () => d.destroy() });
      },
    });
    // butterflies / pollen drifting over land
    this.add.particles(0, 0, "soft", {
      x: { min: 200, max: W - 200 }, y: { min: 150, max: H - 150 },
      lifespan: 6000, speedX: { min: -12, max: 12 }, speedY: { min: -18, max: -4 },
      scale: { start: 0.25, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 350, tint: [0xffffff, 0xfff3a0, 0xffd6f0],
      blendMode: "ADD",
    }).setDepth(901);
  }

  private drawTiles() {
    const g = this.add.graphics().setDepth(10);
    const rx = 23, ry = 15;
    for (const n of this.board.nodes) {
      const { x, y } = this.pos(n.id);
      const info = TILE_INFO[n.type];
      const top = Phaser.Display.Color.HexStringToColor(info.color).color;
      const side = Phaser.Display.Color.HexStringToColor(info.side).color;
      g.fillStyle(0x000000, 0.22).fillEllipse(x, y + 8, rx * 2 + 6, ry * 2 + 6);
      g.fillStyle(side).fillEllipse(x, y + 5, rx * 2, ry * 2);
      g.lineStyle(2.5, 0x2a1a0a).strokeEllipse(x, y + 5, rx * 2, ry * 2);
      g.fillStyle(top).fillEllipse(x, y, rx * 2, ry * 2);
      g.lineStyle(2.5, 0x2a1a0a).strokeEllipse(x, y, rx * 2, ry * 2);
      g.fillStyle(0xffffff, 0.45).fillEllipse(x - 6, y - 5, rx * 0.95, ry * 0.6);
      if (n.type === "wheel") {
        // mini wheel of fortune on the tile
        const cols = [0xff7a7a, 0xffd23f, 0x7cf0a0, 0x5ec8ff, 0xb596ff, 0xff9a3c];
        for (let i = 0; i < 6; i++) {
          g.fillStyle(cols[i]).slice(x, y, 13, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3, false).fillPath();
        }
        g.lineStyle(2.5, 0x2a1a0a).strokeCircle(x, y, 13);
        g.fillStyle(0xffffff).fillCircle(x, y, 3.5);
      }
      if (n.type === "shop" || n.type === "landmark") {
        // little sign above the tile with the place's name
        const label = n.type === "shop" ? n.shopName ?? "الدكان" : LANDMARKS[n.landmark!].name;
        const t = this.add.text(x, y - 34, label, {
          fontFamily: FONT, fontSize: "16px", fontStyle: "800", color: "#ffffff", stroke: "#2b1b45", strokeThickness: 5,
        }).setOrigin(0.5).setDepth(12);
        const w = t.width + 14;
        const sign = this.add.graphics().setDepth(11.5);
        sign.fillStyle(0x2b1b45, 1).fillRoundedRect(x - w / 2, y - 47, w, 26, 9);
        sign.fillStyle(Phaser.Display.Color.HexStringToColor(info.side).color, 1).fillRoundedRect(x - w / 2 + 2, y - 45, w - 4, 22, 8);
        sign.fillStyle(0x2b1b45, 1).fillTriangle(x - 6, y - 22, x + 6, y - 22, x, y - 14);
        this.add.text(x, y + 1, n.type === "shop" ? "$" : "✦", {
          fontFamily: FONT, fontSize: "20px", fontStyle: "800", color: "#ffffff", stroke: info.side, strokeThickness: 4,
        }).setOrigin(0.5).setDepth(11);
      } else if (n.type === "wheel") {
        // drawn above
      } else if (info.icon) {
        this.add.text(x, y + 1, info.icon, {
          fontFamily: FONT, fontSize: info.icon === "VS" ? "15px" : "20px", fontStyle: "800",
          color: "#ffffff", stroke: info.side, strokeThickness: 4,
        }).setOrigin(0.5).setDepth(11);
      } else {
        g.fillStyle(0xffffff, 0.95).fillCircle(x, y, 3.5);
      }
    }
  }

  private makeStar() {
    const glow = this.add.image(0, 0, "soft").setScale(5).setTint(0xfff3a0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
    const beam = this.add.rectangle(0, -120, 34, 240, 0xfff7c0, 0.18).setBlendMode(Phaser.BlendModes.ADD);
    const star = this.add.image(0, -34, "star").setScale(0.5);
    const c = this.add.container(-200, -200, [beam, glow, star]).setDepth(400);
    this.tweens.add({ targets: star, y: -46, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: star, angle: 360, duration: 6000, repeat: -1 });
    this.tweens.add({ targets: glow, scale: 6.5, alpha: 0.5, duration: 900, yoyo: true, repeat: -1 });
    return c;
  }

  setStar(node: number, animate: boolean) {
    if (node === this.starNode) return;
    if (node < 0 || !this.board.nodes[node]) {
      this.starNode = node;
      this.star.setVisible(false);
      return;
    }
    this.star.setVisible(true);
    this.starNode = node;
    const { x, y } = this.pos(node);
    if (!animate) {
      this.star.setPosition(x, y).setScale(1).setAlpha(1);
      return;
    }
    this.tweens.add({
      targets: this.star, scale: 0, alpha: 0, duration: 400, ease: "Back.easeIn",
      onComplete: () => {
        this.star.setPosition(x, y);
        this.tweens.add({ targets: this.star, scale: 1, alpha: 1, duration: 700, ease: "Back.easeOut" });
        this.burst(x, y - 30, [0xffd23f, 0xffffff], 30);
      },
    });
  }

  // ------------------------------------------------------------ ducks
  private slotFor(id: string, node: number, players: Player[]) {
    const same = players.filter((p) => p.node === node).map((p) => p.id);
    const i = Math.max(0, same.indexOf(id));
    const [ox, oy] = SLOTS[i % SLOTS.length];
    const { x, y } = this.pos(node);
    return { x: x + ox, y: y + oy };
  }

  sync(players: Player[], currentId?: string) {
    for (const p of players) {
      let d = this.ducks.get(p.id);
      if (!d) {
        const col = Phaser.Display.Color.HexStringToColor(DUCKS[p.duck].color).color;
        const shadow = this.add.ellipse(0, 3, 58, 20, 0x000000, 0.32);
        const ring = this.add.ellipse(0, 1, 70, 26).setStrokeStyle(4, col, 1).setVisible(false);
        const sprite = this.add.image(0, 0, `tok${p.duck}`).setOrigin(0.512, 0.86).setScale(PIECE);
        const c = this.add.container(0, 0, [ring, shadow, sprite]).setDepth(500);
        const { x, y } = this.slotFor(p.id, p.node, players);
        c.setPosition(x, y);
        d = { c, sprite, shadow, ring, hover: null, node: p.node };
        this.ducks.set(p.id, d);
      }
      if (this.busy.has(p.id)) continue;
      const target = this.slotFor(p.id, p.node, players);
      if (d.node !== p.node || Math.hypot(d.c.x - target.x, d.c.y - target.y) > 1) {
        this.tweens.add({ targets: d.c, x: target.x, y: target.y, duration: 380, ease: "Cubic.easeOut" });
        d.node = p.node;
      }
      const active = p.id === currentId;
      d.c.setDepth(500 + target.y / 10 + (active ? 50 : 0));
      this.setActive(d, active);
    }
    for (const id of [...this.ducks.keys()]) {
      if (!players.some((p) => p.id === id)) {
        this.ducks.get(id)!.c.destroy();
        this.ducks.delete(id);
      }
    }
  }

  /** The piece whose turn it is floats a little above the board with a pulsing ring in its color. */
  private setActive(d: NonNullable<ReturnType<BoardScene["ducks"]["get"]>>, active: boolean) {
    if (active === !!d.hover) return;
    d.hover?.remove();
    d.hover = null;
    d.ring.setVisible(active);
    this.tweens.killTweensOf(d.ring);
    if (active) {
      d.ring.setScale(0.9).setAlpha(1);
      this.tweens.add({ targets: d.ring, scale: 1.25, alpha: 0.2, duration: 900, repeat: -1, ease: "Sine.easeOut" });
      d.hover = this.tweens.add({ targets: d.sprite, y: -7, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: d.sprite, scale: PIECE * 1.12, duration: 300, ease: "Back.easeOut" });
    } else {
      this.tweens.add({ targets: d.sprite, y: 0, scale: PIECE, duration: 300, ease: "Sine.easeOut" });
    }
  }

  /** Steps-left bubble over the moving piece (like the countdown in console party games). */
  private counter: { owner: string; c: Phaser.GameObjects.Container; t: Phaser.GameObjects.Text } | null = null;
  private setCounter(id: string, n: number) {
    const d = this.ducks.get(id);
    if (!d) return;
    if (this.counter && this.counter.owner !== id) this.clearCounter(true);
    if (!this.counter) {
      const g = this.add.graphics();
      g.fillStyle(0x2b1b45, 1).fillCircle(0, 3, 24);
      g.fillStyle(0xffffff, 1).fillCircle(0, 0, 22);
      g.lineStyle(4, 0x2b1b45, 1).strokeCircle(0, 0, 22);
      const t = this.add.text(0, 1, "", {
        fontFamily: FONT, fontSize: "34px", fontStyle: "800", color: "#e8503a",
      }).setOrigin(0.5, 0.55);
      const c = this.add.container(56, -74, [g, t]).setScale(0); // beside the piece: above it can hide under the HUD near the top edge
      d.c.add(c);
      this.counter = { owner: id, c, t };
      this.tweens.add({ targets: c, scale: 1, duration: 260, ease: "Back.easeOut" });
    }
    this.counter.t.setText(String(n).replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[+x]));
    this.tweens.killTweensOf(this.counter.c);
    this.tweens.add({ targets: this.counter.c, scale: { from: 1.25, to: 1 }, duration: 200, ease: "Quad.easeOut" });
  }
  clearCounter(now = false) {
    const k = this.counter;
    if (!k) return;
    this.counter = null;
    if (now) return void k.c.destroy();
    this.tweens.add({ targets: k.c, scale: 0, alpha: 0, duration: 220, ease: "Back.easeIn", onComplete: () => k.c.destroy() });
  }

  /** Camera visits a spot (e.g. where the star moved), then the caller decides where to go next. */
  lookAt(node: number, zoom = 1.35) {
    const cam = this.cameras.main;
    const { x, y } = this.pos(node);
    cam.stopFollow();
    cam.pan(x, y, 900, "Sine.easeInOut");
    cam.zoomTo(zoom, 900, "Sine.easeInOut");
  }

  async playMove(id: string, path: number[], rest = 0) {
    const d = this.ducks.get(id);
    if (!d) return;
    this.busy.add(id);
    this.follow(id);
    d.hover?.pause();
    d.sprite.y = 0;
    let left = path.length + rest;
    this.setCounter(id, left);
    for (const node of path) {
      const { x, y } = this.pos(node);
      const dir = Math.sign(x - d.c.x) || 1;
      await new Promise<void>((res) => {
        const sx = d.c.x, sy = d.c.y;
        const o = { t: 0 };
        sfx.hop();
        this.tweens.add({
          targets: o, t: 1, duration: HOP_MS - 40, ease: "Sine.easeInOut",
          onUpdate: () => {
            const lift = Math.sin(o.t * Math.PI);
            d.c.x = sx + (x - sx) * o.t;
            d.c.y = sy + (y - sy) * o.t;
            d.sprite.y = -lift * 38;
            d.sprite.angle = dir * lift * 9;
            d.sprite.setScale(PIECE * (1.12 + lift * 0.1));
            d.shadow.setScale(1 - lift * 0.45).setAlpha(0.35 - lift * 0.15);
          },
          onComplete: () => {
            d.sprite.angle = 0;
            this.tweens.add({ targets: d.sprite, scaleY: PIECE * 1.02, duration: 50, yoyo: true, ease: "Quad.easeOut" });
            this.puff(x, y + 2);
            left--;
            if (left > 0) this.setCounter(id, left);
            else this.clearCounter();
            res();
          },
        });
      });
    }
    d.node = path[path.length - 1];
    d.c.setDepth(560);
    sfx.land();
    d.hover?.resume();
    this.busy.delete(id);
  }

  /** Snakes & ladders: climb the DNA ladder, or slide down along the painted snake body. */
  playJump(id: string, from: number, to: number, kind: "snake" | "ladder") {
    const d = this.ducks.get(id);
    const j = this.board.jumps?.find((x) => x.from === from && x.to === to);
    if (!d || !j) return;
    this.busy.add(id);
    this.follow(id, 1.35);
    d.hover?.pause();
    const pts = j.path.map(([x, y]) => new Phaser.Math.Vector2(x * this.scale2, y * this.scale2));
    pts[0] = new Phaser.Math.Vector2(d.c.x, d.c.y);
    const end = this.pos(to);
    pts[pts.length - 1] = new Phaser.Math.Vector2(end.x, end.y);
    const finish = () => {
      d.sprite.setAngle(0).setY(0);
      d.node = to;
      this.puff(end.x, end.y + 2);
      sfx.land();
      d.hover?.resume();
      this.busy.delete(id);
    };
    const o = { t: 0 };
    if (kind === "ladder") {
      sfx.climb();
      const a = pts[0], b = pts[pts.length - 1];
      this.tweens.add({
        targets: o, t: 1, duration: 1500, delay: 250, ease: "Sine.easeInOut",
        onUpdate: () => {
          d.c.setPosition(a.x + (b.x - a.x) * o.t, a.y + (b.y - a.y) * o.t);
          d.sprite.y = -Math.abs(Math.sin(o.t * Math.PI * 6)) * 14; // one bump per rung
          if (Math.random() < 0.25) this.burst(d.c.x, d.c.y - 20, [0x7cf0a0, 0xffd23f, 0xffffff], 2);
        },
        onComplete: () => {
          this.celebrate(id);
          finish();
        },
      });
    } else {
      sfx.slide();
      this.shake(0.006);
      const curve = new Phaser.Curves.Spline(pts);
      const len = curve.getLength();
      let px = d.c.x;
      this.tweens.add({
        targets: o, t: 1, duration: Math.min(2900, Math.max(1700, len * 4.2)), delay: 300, ease: "Sine.easeIn",
        onUpdate: () => {
          const p = curve.getPoint(o.t);
          const dx = p.x - px;
          px = p.x;
          d.c.setPosition(p.x, p.y);
          d.sprite.setAngle(Phaser.Math.Clamp(dx * 4, -24, 24));
          d.sprite.y = -4 - Math.sin(o.t * Math.PI) * 10;
        },
        onComplete: finish,
      });
    }
  }

  /** Carry a piece to another tile in a way that fits the place (tunnel, zipline, boat...). */
  warp(id: string, node: number, style: "tunnel" | "zip" | "boat" | "slide", delay = 0) {
    const d = this.ducks.get(id);
    if (!d) return;
    this.busy.add(id);
    const { x, y } = this.pos(node);
    const done = () => {
      d.node = node;
      d.sprite.setAngle(0);
      this.puff(x, y + 2);
      sfx.land();
      this.busy.delete(id);
    };
    this.time.delayedCall(delay, () => {
      const dist = Math.hypot(x - d.c.x, y - d.c.y);
      if (style === "tunnel") {
        sfx.whoosh();
        this.tweens.add({
          targets: d.sprite, scale: 0, angle: 200, duration: 380, ease: "Back.easeIn",
          onComplete: () => {
            d.c.setPosition(x, y);
            this.tweens.add({ targets: d.sprite, scale: PIECE * 1.12, angle: 0, duration: 520, delay: 450, ease: "Back.easeOut", onComplete: done });
          },
        });
      } else if (style === "zip") {
        sfx.whoosh();
        this.tweens.add({ targets: d.sprite, y: -70, duration: 260, ease: "Quad.easeOut" });
        this.tweens.add({
          targets: d.c, x, y, delay: 260, duration: Math.min(2000, Math.max(900, dist * 2.2)), ease: "Sine.easeIn",
          onUpdate: (tw) => d.sprite.setAngle(Math.sin(tw.progress * Math.PI * 6) * 10 * (1 - tw.progress)),
          onComplete: () => this.tweens.add({ targets: d.sprite, y: 0, duration: 220, ease: "Bounce.easeOut", onComplete: done }),
        });
      } else {
        // boat / slide: glide along, gently bobbing
        const dur = style === "boat" ? Math.min(2400, Math.max(1200, dist * 2.4)) : 900;
        this.tweens.add({ targets: d.sprite, y: -10, angle: style === "boat" ? 6 : -14, duration: 260, yoyo: true, repeat: Math.floor(dur / 520), ease: "Sine.easeInOut" });
        this.tweens.add({ targets: d.c, x, y, duration: dur, ease: style === "boat" ? "Sine.easeInOut" : "Quad.easeIn", onComplete: done });
      }
    });
  }

  teleport(moves: Record<string, number>, players: Player[]) {
    for (const [id, node] of Object.entries(moves)) {
      const d = this.ducks.get(id);
      if (!d) continue;
      this.busy.add(id);
      const t = this.slotFor(id, node, players);
      this.tweens.add({
        targets: d.c, y: d.c.y - 400, alpha: 0, angle: 360, duration: 700, ease: "Cubic.easeIn",
        onComplete: () => {
          d.c.setPosition(t.x, t.y - 400).setAngle(0);
          this.tweens.add({
            targets: d.c, y: t.y, alpha: 1, duration: 700, ease: "Bounce.easeOut",
            onComplete: () => {
              d.node = node;
              this.busy.delete(id);
            },
          });
        },
      });
    }
  }

  float(id: string, text: string, color: string) {
    const d = this.ducks.get(id);
    if (!d) return;
    const t = this.add.text(d.c.x, d.c.y - 80, text.replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[+x]), {
      fontFamily: FONT, fontSize: "44px", fontStyle: "800", color, stroke: "#2b1b45", strokeThickness: 8,
    }).setOrigin(0.5).setDepth(950).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 250, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, y: t.y - 70, alpha: 0, delay: 900, duration: 700, onComplete: () => t.destroy() });
  }

  celebrate(id: string) {
    const d = this.ducks.get(id);
    if (!d) return;
    this.burst(d.c.x, d.c.y - 40, [0xffd23f, 0xff6b6b, 0x5ec8ff, 0x7cf0a0, 0xb596ff], 60);
    this.tweens.add({ targets: d.sprite, y: -50, duration: 260, yoyo: true, repeat: 2, ease: "Quad.easeOut" });
  }

  starToDuck(id: string) {
    const d = this.ducks.get(id);
    if (!d) return;
    const s = this.add.image(this.star.x, this.star.y - 40, "star").setScale(0.5).setDepth(960);
    this.tweens.add({
      targets: s, x: d.c.x, y: d.c.y - 60, scale: 1.1, duration: 900, ease: "Cubic.easeInOut",
      onComplete: () => {
        this.tweens.add({ targets: s, scale: 0, alpha: 0, duration: 300, onComplete: () => s.destroy() });
        this.celebrate(id);
      },
    });
  }

  /** Where a piece is on screen (stage pixels), for HTML effects like flying bread. */
  screenPos(id: string) {
    const d = this.ducks.get(id);
    if (!d) return null;
    const cam = this.cameras.main;
    return { x: (d.c.x - cam.worldView.x) * cam.zoom, y: (d.c.y - 45 - cam.worldView.y) * cam.zoom };
  }

  shake(intensity = 0.006) {
    this.cameras.main.shake(350, intensity);
  }

  private puff(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const p = this.add.image(x, y, "soft").setTint(0xf3dcb0).setScale(0.6).setDepth(490).setAlpha(0.9);
      const a = Math.random() * Math.PI;
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * 30 * (i % 2 ? 1 : -1), y: y - Math.random() * 10, alpha: 0, scale: 1.2,
        duration: 420, onComplete: () => p.destroy(),
      });
    }
  }

  burst(x: number, y: number, colors: number[], n: number) {
    for (let i = 0; i < n; i++) {
      const p = this.add.rectangle(x, y, 10, 6, Phaser.Utils.Array.GetRandom(colors)).setDepth(980);
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 260;
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * sp, y: y + Math.sin(a) * sp + 120, angle: Math.random() * 720,
        alpha: 0, duration: 1100 + Math.random() * 500, ease: "Cubic.easeOut", onComplete: () => p.destroy(),
      });
    }
  }

  // ------------------------------------------------------------ camera
  follow(id: string | null, zoom = 1.45) {
    const cam = this.cameras.main;
    if (this.race) {
      // the whole grid always fits the screen: never zoom in (that would push cells under the side HUD)
      cam.stopFollow();
      cam.pan(W / 2, H / 2, 600, "Sine.easeInOut");
      cam.zoomTo(1, 600, "Sine.easeInOut");
      return;
    }
    if (!id) {
      cam.stopFollow();
      cam.pan(W / 2, H / 2, 900, "Sine.easeInOut");
      cam.zoomTo(1, 900, "Sine.easeInOut");
      return;
    }
    const d = this.ducks.get(id);
    if (!d) return;
    cam.startFollow(d.c, true, 0.08, 0.08, 0, 40);
    cam.zoomTo(zoom, 700, "Sine.easeInOut");
  }
}

export class BoardView {
  game: Phaser.Game;
  scene!: BoardScene;
  ready: Promise<void>;

  constructor(parent: HTMLElement, board: Board) {
    let resolve!: () => void;
    this.ready = new Promise((r) => (resolve = r));
    this.game = null as unknown as Phaser.Game;
    const fontReady = Promise.race([
      Promise.all([document.fonts.load(`800 34px ${FONT}`), document.fonts.load(`700 20px ${FONT}`)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    void fontReady.then(() => this.boot(parent, board, resolve));
  }

  private boot(parent: HTMLElement, board: Board, resolve: () => void) {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: W,
      height: H,
      backgroundColor: "#1e7fc4",
      scale: { mode: Phaser.Scale.NONE },
      render: { antialias: true, roundPixels: false },
      banner: false,
    });
    this.game.scene.add("board", BoardScene, true, {
      board,
      ready: () => {
        this.scene = this.game.scene.getScene("board") as BoardScene;
        resolve();
      },
    });
  }
}
