import { pieceSrc } from "../../net";
// The rooftop court in Kuwait City by night, and one hoop "lane" per player.
import * as THREE from "three";
import { BALL_R, BOARD, HOOP_SPOTS, RIM_R, RIM_Y, hoopSpot } from "../../../shared/sports/hoops";
import {
  GOLD,
  MAT,
  ballTextures,
  boardTexture,
  glowTexture,
  laneMatTexture,
  logoTexture,
  netTexture,
  rng,
  shadowTexture,
  skylineTexture,
  sparkTexture,
  woodTexture,
} from "./art";

export const SPACING = 3.4;
const FONT = '800 40px "Baloo Bhaijaan 2"';

// ------------------------------------------------------------------ particles
const PVS = `attribute float size; attribute vec4 tint; varying vec4 vT; uniform float scale;
void main(){ vT = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const PFS = `uniform sampler2D map; varying vec4 vT;
void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vT.rgb * c.rgb, c.a * vT.a); }`;

/** A pool of additive sprites (sparkles, flames, confetti glints) in world space. */
export class Particles {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private rgb: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private next = 0;

  constructor(n: number, map: THREE.Texture, additive = true) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("tint", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 500 } },
      vertexShader: PVS,
      fragmentShader: PFS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size0: number, size1: number, color: THREE.Color, opts?: { drag?: number; grav?: number }) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.rgb.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.drag[i] = opts?.drag ?? 1.5;
    this.grav[i] = opts?.grav ?? 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const o = i * 3;
      this.vel[o] *= d;
      this.vel[o + 1] = this.vel[o + 1] * d - this.grav[i] * dt;
      this.vel[o + 2] *= d;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
      const c = i * 4;
      this.col[c] = this.rgb[o];
      this.col[c + 1] = this.rgb[o + 1];
      this.col[c + 2] = this.rgb[o + 2];
      this.col[c + 3] = Math.min(1, k * 1.6);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ shared assets
export interface Assets {
  ball: THREE.MeshStandardMaterial;
  ballGeo: THREE.SphereGeometry;
  net: THREE.Texture;
  glow: THREE.Texture;
  shadow: THREE.Texture;
  spark: THREE.Texture;
  ducks: Map<number, { img: HTMLImageElement; tex: THREE.Texture }>;
}

export function makeAssets(): Assets {
  const bt = ballTextures();
  return {
    ball: new THREE.MeshStandardMaterial({ map: bt.map, bumpMap: bt.bump, bumpScale: 1.2, roughness: 0.62, metalness: 0 }),
    ballGeo: new THREE.SphereGeometry(BALL_R, 36, 24),
    net: netTexture(),
    glow: glowTexture(),
    shadow: shadowTexture(),
    spark: sparkTexture(),
    ducks: new Map(),
  };
}

/** a duck token as both an <img> (for the canvas board art) and a texture (for the sprite) */
export function duckAsset(a: Assets, duck: number, onLoad: () => void) {
  let d = a.ducks.get(duck);
  if (!d) {
    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    d = { img, tex };
    a.ducks.set(duck, d);
    img.onload = () => {
      tex.needsUpdate = true;
      onLoad();
    };
    img.src = pieceSrc(duck);
  } else if (d.img.complete) queueMicrotask(onLoad);
  else d.img.addEventListener("load", onLoad, { once: true });
  return d;
}

/** Reflections for glossy wood/metal: a purple night dome, a warm city glow on the horizon and bright floodlights. */
function nightEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#0c0720");
  gr.addColorStop(0.42, "#3a2066");
  gr.addColorStop(0.5, "#c0607a");
  gr.addColorStop(0.56, "#2a1840");
  gr.addColorStop(1, "#1a0e10");
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide }));
  env.add(dome);
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.4, 4.2) });
  for (const [x, y, z] of [
    [-18, 22, -20],
    [18, 22, -20],
    [-14, 18, 26],
    [14, 18, 26],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 1), lamp);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const out = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  env.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  dome.material.dispose();
  lamp.dispose();
  t.dispose();
  return out;
}

// ------------------------------------------------------------------ the court
export interface World {
  scene: THREE.Scene;
  sparks: Particles;
  flames: Particles;
  /** resize the floor & walls for this many lanes */
  layout(n: number): void;
  update(dt: number, t: number): void;
}

export function makeWorld(renderer: THREE.WebGLRenderer, a: Assets, onRedraw: () => void): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d0824");
  scene.fog = new THREE.Fog("#1c0f3c", 30, 95);
  scene.environment = nightEnvironment(renderer);
  scene.environmentIntensity = 0.9;

  // lights
  scene.add(new THREE.HemisphereLight("#9a86ff", "#6a3a1c", 1.25));
  const key = new THREE.DirectionalLight("#fff0d8", 2.4);
  key.position.set(6, 14, 12);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#7ab6ff", 1.1);
  rim.position.set(-6, 9, -12);
  scene.add(rim);
  const warm = new THREE.DirectionalLight("#ff9a5c", 0.6);
  warm.position.set(10, 3, -4);
  scene.add(warm);

  // sky panorama
  const sky = skylineTexture();
  sky.tex.wrapS = THREE.RepeatWrapping;
  sky.tex.repeat.x = -1;
  const skyH = 64;
  const horizonY = 1.2;
  const skyMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(85, 85, skyH, 72, 1, true, Math.PI - (100 * Math.PI) / 180, (200 * Math.PI) / 180),
    new THREE.MeshBasicMaterial({ map: sky.tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  skyMesh.position.y = horizonY + skyH * (sky.horizon - 0.5);
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  // floor: glossy hardwood
  const wood = woodTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // surround: dark rooftop deck
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#1d1436", roughness: 0.85 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.01;
  scene.add(deck);
  // court border (ink band with a gold line)
  const borderMat = new THREE.MeshStandardMaterial({ color: "#2b1b45", roughness: 0.5 });
  const goldLine = new THREE.MeshStandardMaterial({ color: GOLD, emissive: "#6a4a00", roughness: 0.4 });
  const border = new THREE.Group();
  scene.add(border);
  // center-court logo
  let logoTex = logoTexture(null);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(0, 0.006, 9.6);
  scene.add(logo);
  const redrawLogo = () => {
    const d = a.ducks.get(0);
    const old = logoTex;
    logoTex = logoTexture(d?.img ?? null);
    (logo.material as THREE.MeshStandardMaterial).map = logoTex;
    old.dispose();
    onRedraw();
  };
  duckAsset(a, 0, redrawLogo);
  void document.fonts?.load(FONT).then(redrawLogo).catch(() => {});

  // parapet walls + string lights + floodlights
  const wallMat = new THREE.MeshStandardMaterial({ color: "#2a1d4d", roughness: 0.8 });
  const capMat = new THREE.MeshStandardMaterial({ color: "#4a3a7a", roughness: 0.6 });
  const walls = new THREE.Group();
  scene.add(walls);
  const bulbs = new Particles(260, a.glow);
  bulbs.mat.uniforms.scale.value = 600;
  scene.add(bulbs.points);
  const sparks = new Particles(700, a.spark);
  scene.add(sparks.points);
  const flames = new Particles(500, a.glow);
  scene.add(flames.points);
  const lampGlow = new THREE.SpriteMaterial({ map: a.glow, color: "#fff2c8", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const coneTex = (() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, "rgba(255,240,200,.55)");
    gr.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const coneMat = new THREE.MeshBasicMaterial({ map: coneTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.28, fog: false });
  const poleMat = new THREE.MeshStandardMaterial({ color: "#3a2c62", roughness: 0.5, metalness: 0.4 });
  const lights = new THREE.Group();
  scene.add(lights);

  const disposeGroup = (g: THREE.Group) => {
    g.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    g.clear();
  };

  let width = 0;
  function layout(n: number) {
    const w = Math.max(16, (n - 1) * SPACING + 9);
    if (w === width) return;
    width = w;
    const z0 = -5.2;
    const z1 = 13.5;
    const depth = z1 - z0;
    floor.scale.set(w, depth, 1);
    floor.position.set(0, 0, (z0 + z1) / 2);
    wood.repeat.set(w / 4, depth / 4);
    disposeGroup(border);
    const band = (x: number, z: number, bw: number, bd: number, mat: THREE.Material, y = 0.003) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      border.add(m);
    };
    band(0, z0 + 0.35, w, 0.7, borderMat);
    band(0, z1 - 0.35, w, 0.7, borderMat);
    band(-w / 2 + 0.35, (z0 + z1) / 2, 0.7, depth, borderMat);
    band(w / 2 - 0.35, (z0 + z1) / 2, 0.7, depth, borderMat);
    band(0, z0 + 0.72, w - 1.4, 0.06, goldLine, 0.004);
    band(0, z1 - 0.72, w - 1.4, 0.06, goldLine, 0.004);
    band(-w / 2 + 0.72, (z0 + z1) / 2, 0.06, depth - 1.4, goldLine, 0.004);
    band(w / 2 - 0.72, (z0 + z1) / 2, 0.06, depth - 1.4, goldLine, 0.004);
    // walls
    disposeGroup(walls);
    const wz = z0 - 1.2;
    const wallW = w + 8;
    const wall = (x: number, z: number, ww: number, wd: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, 1.1, wd), wallMat);
      m.position.set(x, 0.55, z);
      walls.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.12, 0.1, wd + 0.12), capMat);
      cap.position.set(x, 1.12, z);
      walls.add(cap);
    };
    wall(0, wz, wallW, 0.3);
    wall(-wallW / 2, wz + 9, 0.3, 18);
    wall(wallW / 2, wz + 9, 0.3, 18);
    // string lights along the back wall: posts + sagging strands of bulbs
    const r = rng(5);
    const posts: number[] = [];
    for (let x = -wallW / 2; x <= wallW / 2 + 0.01; x += wallW / Math.max(3, Math.round(wallW / 5))) posts.push(x);
    for (const x of posts) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.8, 8), poleMat);
      p.position.set(x, 1.1 + 1.4, wz);
      walls.add(p);
    }
    const cols = ["#ffd88a", "#ffb35c", "#fff1c9", "#ff8fb0", "#9fe8ff"].map((c) => new THREE.Color(c));
    let k = 0;
    const tmp = new THREE.Vector3();
    // re-seed the bulbs: a long life so they stay
    for (let i = 0; i + 1 < posts.length; i++) {
      const a0 = posts[i];
      const a1 = posts[i + 1];
      const nB = 12;
      for (let j = 0; j < nB; j++) {
        const f = (j + 0.5) / nB;
        const y = 3.9 - Math.sin(f * Math.PI) * 0.55;
        tmp.set(a0 + (a1 - a0) * f, y, wz);
        bulbs.emit(tmp, new THREE.Vector3(), 1e9, 0.32 + r() * 0.12, 0.32, cols[k++ % cols.length], { drag: 0 });
      }
    }
    bulbs.update(0);
    // floodlights at the back corners
    disposeGroup(lights);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 + 1.4);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 10), poleMat);
      pole.position.set(x, 4.5, wz + 0.6);
      lights.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), new THREE.MeshStandardMaterial({ color: "#2b1b45", emissive: "#fff3d0", emissiveIntensity: 0.9 }));
      head.position.set(x - sx * 0.3, 9.1, wz + 0.8);
      head.rotation.x = 0.5;
      head.rotation.y = -sx * 0.35;
      lights.add(head);
      const gl = new THREE.Sprite(lampGlow);
      gl.scale.set(6, 6, 1);
      gl.position.copy(head.position).add(new THREE.Vector3(0, 0, 0.4));
      lights.add(gl);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 10, 24, 1, true), coneMat);
      const target = new THREE.Vector3(sx * (w / 2 - 3.5), 0, 3.5);
      const top = head.position.clone();
      cone.position.copy(top).lerp(target, 0.5);
      cone.lookAt(target);
      cone.rotateX(-Math.PI / 2);
      cone.scale.y = top.distanceTo(target) / 10;
      lights.add(cone);
    }
  }

  return {
    scene,
    sparks,
    flames,
    layout,
    update(dt) {
      sparks.update(dt);
      flames.update(dt);
    },
  };
}

// ------------------------------------------------------------------ a lane (one player's hoop)
export interface Lane {
  pid: string;
  duck: number;
  color: string;
  group: THREE.Group;
  /** slides with the hoop (board, rim, net) */
  hoop: THREE.Group;
  rimGroup: THREE.Group;
  boardMesh: THREE.Mesh;
  boardGlow: THREE.Mesh;
  net: THREE.Mesh;
  netBase: Float32Array;
  ball: THREE.Mesh;
  shadow: THREE.Mesh;
  duckSprite: THREE.Sprite;
  spotRing: THREE.Mesh;
  /** animation state */
  netT: number;
  netKick: number;
  wobble: number;
  wobbleV: number;
  glowKick: number;
  dispose(): void;
}

const NET_H = 0.44;
const NET_SEG = 18;
const NET_ROWS = 6;

export function makeLane(a: Assets, pid: string, duck: number, color: string, onRedraw: () => void): Lane {
  const group = new THREE.Group();
  const own: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];
  const mk = <T extends THREE.Material>(m: T) => (own.push(m), m);
  const gk = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g);

  // floor paint
  const spots = HOOP_SPOTS.map((_, i) => {
    const s = hoopSpot(i).spot;
    return [s[0], s[2]] as [number, number];
  });
  let matTex = laneMatTexture(color, spots);
  texs.push(matTex);
  const matMat = mk(new THREE.MeshStandardMaterial({ map: matTex, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false }));
  const mat = new THREE.Mesh(gk(new THREE.PlaneGeometry(MAT.x1 - MAT.x0, MAT.z1 - MAT.z0)), matMat);
  mat.rotation.x = -Math.PI / 2;
  mat.position.set((MAT.x0 + MAT.x1) / 2, 0.005, (MAT.z0 + MAT.z1) / 2);
  mat.renderOrder = 1;
  group.add(mat);
  void document.fonts?.load(FONT).then(() => {
    const t = laneMatTexture(color, spots);
    matMat.map = t;
    matTex.dispose();
    matTex = t;
    texs.push(t);
    onRedraw();
  }).catch(() => {});

  // stand: base, pole, arm, rail
  const standMat = mk(new THREE.MeshStandardMaterial({ color: "#3b2a6b", roughness: 0.35, metalness: 0.55 }));
  const padMat = mk(new THREE.MeshStandardMaterial({ color: "#2b1b45", emissive: color, emissiveIntensity: 0.12, roughness: 0.5 }));
  const base = new THREE.Mesh(gk(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 24)), standMat);
  base.position.set(0, 0.04, -1.45);
  group.add(base);
  const pad = new THREE.Mesh(gk(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 16)), padMat);
  pad.position.set(0, 0.53, -1.45);
  group.add(pad);
  const pole = new THREE.Mesh(gk(new THREE.CylinderGeometry(0.08, 0.09, 3.6, 12)), standMat);
  pole.position.set(0, 1.8, -1.45);
  group.add(pole);
  const arm = new THREE.Mesh(gk(new THREE.BoxGeometry(0.12, 0.12, 0.9)), standMat);
  arm.position.set(0, 3.5, -1.0);
  group.add(arm);
  const rail = new THREE.Mesh(gk(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 10)), standMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 3.5, -0.56);
  group.add(rail);

  // hoop (slides along the rail in round 3)
  const hoop = new THREE.Group();
  group.add(hoop);
  const frameMat = mk(new THREE.MeshStandardMaterial({ color: "#2b1b45", roughness: 0.4, metalness: 0.3 }));
  let boardTex = boardTexture(null, color);
  texs.push(boardTex);
  const artMat = mk(new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.18, metalness: 0, envMapIntensity: 1.1 }));
  const bw = BOARD.half * 2;
  const bh = BOARD.top - BOARD.bottom;
  const bd = BOARD.front - BOARD.back;
  const boardMesh = new THREE.Mesh(gk(new THREE.BoxGeometry(bw, bh, bd)), [frameMat, frameMat, frameMat, frameMat, artMat, frameMat]);
  boardMesh.position.set(0, (BOARD.top + BOARD.bottom) / 2, (BOARD.front + BOARD.back) / 2);
  hoop.add(boardMesh);
  const slider = new THREE.Mesh(gk(new THREE.BoxGeometry(0.3, 0.22, 0.14)), standMat);
  slider.position.set(0, 3.5, -0.5);
  hoop.add(slider);
  // halo behind the board (pulses on hits)
  const glowMat = mk(new THREE.MeshBasicMaterial({ map: a.glow, color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const boardGlow = new THREE.Mesh(gk(new THREE.PlaneGeometry(4.2, 3.0)), glowMat);
  boardGlow.position.set(0, (BOARD.top + BOARD.bottom) / 2, BOARD.back - 0.05);
  hoop.add(boardGlow);
  const redrawBoard = () => {
    const d = a.ducks.get(duck);
    const t = boardTexture(d?.img ?? null, color);
    artMat.map = t;
    boardTex.dispose();
    boardTex = t;
    texs.push(t);
    onRedraw();
  };

  const rimGroup = new THREE.Group();
  rimGroup.position.set(0, RIM_Y, 0);
  hoop.add(rimGroup);
  const rimMat = mk(new THREE.MeshStandardMaterial({ color: "#ff5a12", emissive: "#6a1800", roughness: 0.28, metalness: 0.55 }));
  const rimMesh = new THREE.Mesh(gk(new THREE.TorusGeometry(RIM_R, 0.018, 12, 48)), rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimGroup.add(rimMesh);
  const bracket = new THREE.Mesh(gk(new THREE.BoxGeometry(0.16, 0.05, -BOARD.front - RIM_R)), rimMat);
  bracket.position.set(0, -0.02, (BOARD.front - RIM_R) / 2);
  rimGroup.add(bracket);
  // hooks around the rim
  const hookGeo = gk(new THREE.BoxGeometry(0.012, 0.03, 0.02));
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * Math.PI * 2;
    const h = new THREE.Mesh(hookGeo, rimMat);
    h.position.set(Math.cos(an) * RIM_R, -0.02, Math.sin(an) * RIM_R);
    rimGroup.add(h);
  }
  // net
  const netGeo = gk(new THREE.CylinderGeometry(RIM_R - 0.005, 0.14, NET_H, NET_SEG, NET_ROWS, true));
  netGeo.translate(0, -NET_H / 2 - 0.01, 0);
  const netTex = a.net.clone();
  netTex.repeat.set(NET_SEG / 2, NET_ROWS / 2);
  netTex.needsUpdate = true;
  texs.push(netTex);
  const netMat = mk(new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, emissive: "#3a2a5a", emissiveIntensity: 0.6 }));
  const net = new THREE.Mesh(netGeo, netMat);
  rimGroup.add(net);
  const netBase = Float32Array.from(netGeo.attributes.position.array as Float32Array);

  // ball + shadow
  const ball = new THREE.Mesh(a.ballGeo, a.ball);
  ball.visible = false;
  group.add(ball);
  const shadowMat = mk(new THREE.MeshBasicMaterial({ map: a.shadow, transparent: true, depthWrite: false, opacity: 0.8 }));
  const shadow = new THREE.Mesh(gk(new THREE.PlaneGeometry(1, 1)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;
  shadow.visible = false;
  group.add(shadow);
  // hoop shadow on the floor
  const hs = new THREE.Mesh(gk(new THREE.PlaneGeometry(2.6, 1.6)), mk(new THREE.MeshBasicMaterial({ map: a.shadow, transparent: true, depthWrite: false, opacity: 0.55 })));
  hs.rotation.x = -Math.PI / 2;
  hs.position.set(0, 0.008, -0.9);
  hs.renderOrder = 2;
  group.add(hs);

  // the player's duck standing on the spot
  const d = duckAsset(a, duck, redrawBoard);
  const duckSprite = new THREE.Sprite(mk(new THREE.SpriteMaterial({ map: d.tex, transparent: true })));
  duckSprite.center.set(0.5, 0);
  duckSprite.scale.set(1.15, 1.31, 1);
  group.add(duckSprite);
  // glowing ring on the spot
  const ringMat = mk(new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const spotRing = new THREE.Mesh(gk(new THREE.RingGeometry(0.42, 0.5, 40)), ringMat);
  spotRing.rotation.x = -Math.PI / 2;
  spotRing.renderOrder = 3;
  group.add(spotRing);

  return {
    pid,
    duck,
    color,
    group,
    hoop,
    rimGroup,
    boardMesh,
    boardGlow,
    net,
    netBase,
    ball,
    shadow,
    duckSprite,
    spotRing,
    netT: 9,
    netKick: 0,
    wobble: 0,
    wobbleV: 0,
    glowKick: 0,
    dispose() {
      group.removeFromParent();
      own.forEach((m) => m.dispose());
      geos.forEach((g) => g.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}

/** Net animation: `netT` = seconds since the ball went through (big stretch + ripple) or brushed it. */
export function animateNet(l: Lane, dt: number, ballLocal: THREE.Vector3 | null) {
  l.netT += dt;
  const pos = l.net.geometry.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const t = l.netT;
  const kick = l.netKick;
  const active = t < 2.5 || ballLocal;
  if (!active) return;
  const stretch = kick * 0.32 * Math.exp(-3.2 * t) * Math.cos(t * 13);
  for (let i = 0; i < arr.length; i += 3) {
    const bx = l.netBase[i];
    const by = l.netBase[i + 1];
    const bz = l.netBase[i + 2];
    const depth = -by / NET_H; // 0 at the rim … 1 at the bottom
    const rad = Math.hypot(bx, bz) || 1;
    let r = 1 + kick * 0.18 * Math.exp(-4 * t) * Math.sin(t * 22 - depth * 7) * depth;
    let y = by * (1 + stretch * depth);
    if (ballLocal) {
      // the ball pushes the net out where it is
      const dy = by - ballLocal.y;
      const near = Math.exp(-(dy * dy) / 0.012);
      const need = 0.135 / rad;
      if (need > 1) r = Math.max(r, 1 + (need - 1) * near);
      y -= near * 0.03;
    }
    const sway = kick * 0.02 * Math.exp(-3 * t) * Math.sin(t * 9 + bx * 10) * depth;
    arr[i] = bx * r + sway;
    arr[i + 1] = y;
    arr[i + 2] = bz * r;
  }
  pos.needsUpdate = true;
}
