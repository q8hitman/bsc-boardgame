import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BALL_R, GUTTER_W, KICK_X, LANE_HALF, PIN_COM } from "../../../shared/sports/bowling";
import { BACK_V, CAP_W, HEAD_V, LANE_LEN, PIT_V, PITCH } from "./space";
import * as T from "./textures";

/** The 3D bowling alley: N lanes side by side, pins (instanced), one ball per lane, lights and decoration.
 *  It only draws; bowling-view.ts decides where everything is each frame. */

export interface LaneSpec {
  /** player id ("" for a decoration lane) */
  key: string;
  name: string;
  duck: number | null;
  color: string;
  num: string;
}

const APPROACH = 4.2;
const MASK_Z = -(HEAD_V - 0.25);
const MASK_H = 0.56;
const SUB_Y = -0.62;

/** Real pin profile (radius, height) in metres, smoothed; stripes on the neck. */
function pinGeometry() {
  const prof: [number, number][] = [
    [0.0, 0.0], [0.0258, 0.0], [0.031, 0.004], [0.038, 0.016], [0.046, 0.036], [0.0535, 0.064], [0.0587, 0.092],
    [0.0605, 0.114], [0.0598, 0.134], [0.0568, 0.158], [0.0515, 0.182], [0.0445, 0.204], [0.0372, 0.224],
    [0.0305, 0.243], [0.0258, 0.26], [0.0236, 0.274], [0.024, 0.288], [0.0268, 0.304], [0.0302, 0.322],
    [0.0318, 0.338], [0.031, 0.352], [0.0278, 0.364], [0.0222, 0.373], [0.014, 0.379], [0.006, 0.3808], [0.0, 0.381],
  ];
  // dense resample along the height (Catmull-Rom through the profile) + hard stripe edges
  const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(90);
  const stripes = [0.252, 0.262, 0.27, 0.28];
  const at = (y: number) => {
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
    return best.x;
  };
  const all: THREE.Vector2[] = [];
  for (const p of pts) all.push(new THREE.Vector2(Math.max(0, p.x), p.y));
  for (const s of stripes) {
    all.push(new THREE.Vector2(at(s), s - 0.0004));
    all.push(new THREE.Vector2(at(s), s + 0.0004));
  }
  all.sort((a, b) => a.y - b.y);
  all[0].x = 0;
  all[all.length - 1].x = 0;
  const geo = new THREE.LatheGeometry(all, 28);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color("#fbf8f2");
  const red = new THREE.Color("#d8102c");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const inStripe = (y > stripes[0] && y < stripes[1]) || (y > stripes[2] && y < stripes[3]);
    const c = inStripe ? red : white;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.translate(0, -PIN_COM, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Mirror a geometry upside down (for the fake lane reflection) keeping faces front-facing. */
function mirrored(geo: THREE.BufferGeometry) {
  const g = geo.clone();
  g.scale(1, -1, 1);
  const idx = g.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Mirror a geometry left-right (faces stay front-facing). */
function flipX(geo: THREE.BufferGeometry) {
  geo.scale(-1, 1, 1);
  const idx = geo.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A half pipe along -Z (gutter). */
function gutterGeometry(len: number) {
  const r = GUTTER_W / 2;
  const g = new THREE.CylinderGeometry(r, r, len, 18, 1, true, Math.PI / 2, Math.PI);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.55, 1);
  return g;
}

export class Alley {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  lanes: LaneSpec[] = [];
  private built = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private pins!: THREE.InstancedMesh;
  private pinsMirror!: THREE.InstancedMesh;
  private pinShadows!: THREE.InstancedMesh;
  balls: { mesh: THREE.Mesh; mirror: THREE.Mesh; shadow: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; q: THREE.Quaternion }[] = [];
  readonly ring: THREE.Mesh;
  readonly guide: THREE.InstancedMesh;
  readonly flash: THREE.Mesh;
  private confetti: THREE.InstancedMesh;
  private parts: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number }[] = [];
  private aniso: number;
  sign: THREE.Mesh | null = null;
  static readonly REST_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private shared: { pinGeo: THREE.BufferGeometry; pinGeoM: THREE.BufferGeometry; pinMat: THREE.Material; shadowGeo: THREE.BufferGeometry; shadowMat: THREE.MeshBasicMaterial; ballGeo: THREE.BufferGeometry; laneTex: THREE.Texture; approachTex: THREE.Texture };
  private m4 = new THREE.Matrix4();
  private m4b = new THREE.Matrix4();
  private S = new THREE.Matrix4().makeScale(1, -1, 1);
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private env: THREE.Texture;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.background = T.backgroundTexture();
    this.scene.fog = new THREE.Fog(0x1a0b30, 16, 46);

    // environment for reflections: a dark room with warm ceiling strips and neon panels
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x120822);
    const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, k = 1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
      m.position.set(x, y, z);
      envScene.add(m);
    };
    for (let i = -2; i <= 2; i++) box(0.5, 0.1, 18, 0xfff1d8, i * 2.2, 5, 0, 3.2);
    box(30, 3, 0.2, 0xff4fa3, 0, 2, -12, 1.4);
    box(0.2, 3, 30, 0x3ee8ff, -10, 2, 0, 1.0);
    box(0.2, 3, 30, 0x9b7bff, 10, 2, 0, 1.0);
    box(30, 0.2, 30, 0x2a1240, 0, -2, 0, 1);
    this.env = pm.fromScene(envScene, 0.035).texture;
    pm.dispose();
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.scene.environment = this.env;

    // lights
    this.scene.add(new THREE.HemisphereLight(0xd9c8ff, 0x3a2030, 1.15));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(1.5, 7, 4);
    this.scene.add(key);
    const deck = new THREE.DirectionalLight(0xffffff, 1.4);
    deck.position.set(-1, 4, 2);
    deck.target.position.set(0, 0, -HEAD_V);
    this.scene.add(deck, deck.target);

    const pinGeo = pinGeometry();
    const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const laneTex = T.laneTexture(this.aniso);
    laneTex.flipY = false;
    this.shared = {
      pinGeo,
      pinGeoM: mirrored(pinGeo),
      pinMat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.9 }),
      shadowGeo,
      shadowMat: new THREE.MeshBasicMaterial({ map: T.blobTexture(), transparent: true, depthWrite: false, opacity: 0.75 }),
      ballGeo: new THREE.SphereGeometry(BALL_R, 48, 32),
      laneTex,
      approachTex: T.approachTexture(this.aniso, APPROACH),
    };

    // things that do not depend on the lanes
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xffd23f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.scene.add(this.ring);
    const dotGeo = new THREE.CircleGeometry(0.022, 14).rotateX(-Math.PI / 2);
    this.guide = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 48);
    this.guide.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(48 * 3), 3);
    this.guide.renderOrder = 3;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.scene.add(this.guide);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xfff0b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.flash.renderOrder = 4;
    this.scene.add(this.flash);
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.022), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 160);
    this.confetti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
    this.confetti.frustumCulled = false;
    this.confetti.count = 0;
    this.scene.add(this.confetti);
    this.scene.add(this.built);
  }

  laneX(i: number) {
    return (i - (this.lanes.length - 1) / 2) * PITCH;
  }

  /** (Re)build the alley for these lanes. */
  build(lanes: LaneSpec[], screen = false) {
    // the projector looks down from high up: the masking units hang higher so they never hide the pins
    const MASK_Y0 = screen ? 1.55 : 0.98;
    this.clearBuilt();
    this.lanes = lanes;
    const n = lanes.length;
    const add = <O extends THREE.Object3D>(o: O) => {
      this.built.add(o);
      return o;
    };
    const keep = <D extends { dispose(): void }>(d: D) => {
      this.disposables.push(d);
      return d;
    };
    const W = n * PITCH;
    const sh = this.shared;

    // lane surfaces (glossy, slightly see-through: the mirrored pins under them read as reflections)
    const laneGeos: THREE.BufferGeometry[] = [];
    const appGeos: THREE.BufferGeometry[] = [];
    const gutGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];
    const ledGeos: THREE.BufferGeometry[] = [];
    const kickGeos: THREE.BufferGeometry[] = [];
    const deckLen = BACK_V - (HEAD_V - 1.1);
    for (let i = 0; i < n; i++) {
      const x = this.laneX(i);
      laneGeos.push(new THREE.PlaneGeometry(2 * LANE_HALF, LANE_LEN).rotateX(-Math.PI / 2).translate(x, 0, -LANE_LEN / 2));
      appGeos.push(new THREE.PlaneGeometry(2 * KICK_X, APPROACH).rotateX(-Math.PI / 2).translate(x, 0, APPROACH / 2));
      for (const s of [-1, 1]) {
        gutGeos.push(gutterGeometry(PIT_V).translate(x + s * (LANE_HALF + GUTTER_W / 2), 0.004, -PIT_V / 2));
        // the right wall is a mirror image so its chevrons also point at the pins
        const kb = new THREE.BoxGeometry(0.05, 0.5, deckLen);
        kickGeos.push((s > 0 ? flipX(kb) : kb).translate(x + s * (KICK_X + 0.025), 0.25, -(HEAD_V - 1.1) - deckLen / 2));
      }
      // LED strips in the player's colour along both gutters
      const col = new THREE.Color(lanes[i].key ? lanes[i].color : "#7a5cff");
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.014, 0.014, PIT_V).translate(x + s * (KICK_X + 0.012), 0.058, -PIT_V / 2);
        const c = new Float32Array(g.attributes.position.count * 3);
        for (let k = 0; k < c.length; k += 3) c.set([col.r * 1.6, col.g * 1.6, col.b * 1.6], k);
        g.setAttribute("color", new THREE.BufferAttribute(c, 3));
        ledGeos.push(g);
        // and along the top of the kickback walls by the pins
        const k = new THREE.BoxGeometry(0.02, 0.02, deckLen).translate(x + s * (KICK_X + 0.012), 0.51, -(HEAD_V - 1.1) - deckLen / 2);
        const kc = new Float32Array(k.attributes.position.count * 3);
        for (let q = 0; q < kc.length; q += 3) kc.set([col.r * 1.6, col.g * 1.6, col.b * 1.6], q);
        k.setAttribute("color", new THREE.BufferAttribute(kc, 3));
        ledGeos.push(k);
      }
    }
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + i * PITCH;
      capGeos.push(new THREE.BoxGeometry(CAP_W, 0.05, PIT_V + APPROACH * 0.5).translate(x, 0.025, -(PIT_V - APPROACH * 0.5) / 2));
    }
    const merge = (list: THREE.BufferGeometry[]) => {
      const g = keep(mergeGeometries(list)!);
      list.forEach((x) => x.dispose());
      return g;
    };
    const laneMat = keep(new THREE.MeshStandardMaterial({ map: sh.laneTex, roughness: 0.16, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 0.55 }));
    const lane = add(new THREE.Mesh(merge(laneGeos), laneMat));
    lane.renderOrder = 1;
    add(new THREE.Mesh(merge(appGeos), keep(new THREE.MeshStandardMaterial({ map: sh.approachTex, roughness: 0.3, envMapIntensity: 0.4 }))));
    add(new THREE.Mesh(merge(gutGeos), keep(new THREE.MeshStandardMaterial({ color: 0x2d2140, roughness: 0.32, metalness: 0.65, side: THREE.DoubleSide, envMapIntensity: 1.1 }))));
    add(new THREE.Mesh(merge(capGeos), keep(new THREE.MeshStandardMaterial({ color: 0x2a1840, roughness: 0.25, metalness: 0.2, envMapIntensity: 0.9 }))));
    add(new THREE.Mesh(merge(ledGeos), keep(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))));
    add(new THREE.Mesh(merge(kickGeos), keep(new THREE.MeshStandardMaterial({ map: keep(T.kickbackTexture()), roughness: 0.3, metalness: 0.1, envMapIntensity: 1.0 }))));

    // pit, curtain, the dark box above the deck, the floor under everything
    const dark = keep(new THREE.MeshBasicMaterial({ color: 0x07030c }));
    add(new THREE.Mesh(keep(new THREE.BoxGeometry(W, 0.02, BACK_V - PIT_V)), dark)).position.set(0, -0.34, -(PIT_V + BACK_V) / 2);
    const curtainTex = keep(T.curtainTexture());
    curtainTex.repeat.set(n * 2, 1);
    add(new THREE.Mesh(keep(new THREE.PlaneGeometry(W, 2.4)), keep(new THREE.MeshBasicMaterial({ map: curtainTex })))).position.set(0, 0.85, -BACK_V);
    if (!screen) add(new THREE.Mesh(keep(new THREE.BoxGeometry(W, 0.04, BACK_V - (HEAD_V - 0.25))), dark)).position.set(0, MASK_Y0, -(BACK_V + HEAD_V - 0.25) / 2);
    add(new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 30, 40).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: 0x0c0616 })))).position.set(0, SUB_Y, -10);
    // carpet in front of the approach
    add(new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 6, 8).rotateX(-Math.PI / 2)), keep(new THREE.MeshStandardMaterial({ color: 0x1c0d33, roughness: 0.95 })))).position.set(0, -0.002, APPROACH + 4);

    // masking units with each player's duck + name (and their reflections in the lane)
    lanes.forEach((l, i) => {
      const mt = keep(T.maskingTexture({ num: l.num, name: l.key ? l.name : "Duck Party", color: l.key ? l.color : "#9b7bff", duck: l.duck }));
      const mat = keep(new THREE.MeshBasicMaterial({ map: mt, toneMapped: false }));
      const geo = keep(new THREE.PlaneGeometry(PITCH, MASK_H));
      const m = add(new THREE.Mesh(geo, mat));
      m.position.set(this.laneX(i), MASK_Y0 + MASK_H / 2, MASK_Z);
      const mm = add(new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ map: mt, toneMapped: false, color: 0x9a8aa8 }))));
      mm.position.set(this.laneX(i), -(MASK_Y0 + MASK_H / 2), MASK_Z);
      mm.scale.y = -1;
    });
    // wall above the masking units, side walls, ceiling light strips, the big neon sign
    const wt = keep(T.wallTexture());
    wt.repeat.set(Math.max(1, W / 4), 1);
    add(new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 8, 3.4)), keep(new THREE.MeshBasicMaterial({ map: wt })))).position.set(0, MASK_Y0 + MASK_H + 1.7, MASK_Z - 0.02);
    const sideT = keep(T.wallTexture());
    sideT.repeat.set(5, 1);
    for (const s of [-1, 1]) {
      const wall = add(new THREE.Mesh(keep(new THREE.PlaneGeometry(BACK_V + APPROACH + 8, 4.5)), keep(new THREE.MeshBasicMaterial({ map: sideT, color: 0xbbaadd }))));
      wall.rotation.y = s * -Math.PI / 2;
      wall.position.set(s * (W / 2 + CAP_W / 2 + 0.02), 1.6, -(BACK_V - APPROACH - 8) / 2);
      // neon tubes along the walls
      const tube = add(new THREE.Mesh(keep(new THREE.BoxGeometry(0.03, 0.03, BACK_V + APPROACH)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(s < 0 ? 0xff4fa3 : 0x3ee8ff).multiplyScalar(1.5), toneMapped: false }))));
      tube.position.set(s * (W / 2 + CAP_W / 2 - 0.01), 1.05, -(BACK_V - APPROACH) / 2);
      const tube2 = add(new THREE.Mesh(tube.geometry, tube.material));
      tube2.position.set(s * (W / 2 + CAP_W / 2 - 0.01), 2.2, -(BACK_V - APPROACH) / 2);
    }
    const sign = (this.sign = add(new THREE.Mesh(keep(new THREE.PlaneGeometry(3.2, 0.8)), keep(new THREE.MeshBasicMaterial({ map: keep(T.signTexture("بولنق البط")), transparent: true, depthWrite: false, toneMapped: false })))));
    sign.position.set(0, MASK_Y0 + MASK_H + 0.62, MASK_Z + 0.01);

    // pins (all lanes in one instanced mesh), their reflections and contact shadows
    const count = n * 10;
    this.pins = add(new THREE.InstancedMesh(sh.pinGeo, sh.pinMat, count));
    this.pinsMirror = add(new THREE.InstancedMesh(sh.pinGeoM, sh.pinMat, count));
    this.pinShadows = add(new THREE.InstancedMesh(sh.shadowGeo, sh.shadowMat, count));
    this.pinShadows.renderOrder = 2;
    for (const m of [this.pins, this.pinsMirror, this.pinShadows]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    // balls
    this.balls = lanes.map((l, i) => {
      const mat = keep(new THREE.MeshPhysicalMaterial({ map: keep(T.ballTexture(l.color, i * 13 + 3)), roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 }));
      const mesh = add(new THREE.Mesh(sh.ballGeo, mat));
      const mirror = add(new THREE.Mesh(sh.ballGeo, mat));
      mirror.scale.y = -1;
      const shadow = add(new THREE.Mesh(sh.shadowGeo, sh.shadowMat));
      shadow.renderOrder = 2;
      mesh.visible = mirror.visible = shadow.visible = false;
      return { mesh, mirror, shadow, mat, q: Alley.REST_Q.clone() };
    });
  }

  /** Place pin `k` of lane `lane`. (x, y, z) physics metres of its centre of mass; (tx, tz) tilt vector. */
  setPin(lane: number, k: number, x: number, y: number, zView: number, tx: number, tz: number, scale: number, visible: boolean) {
    const idx = lane * 10 + k;
    if (!visible || scale <= 0.001) {
      this.m4.makeScale(0, 0, 0);
      this.pins.setMatrixAt(idx, this.m4);
      this.pinsMirror.setMatrixAt(idx, this.m4);
      this.pinShadows.setMatrixAt(idx, this.m4);
      return;
    }
    const th = Math.hypot(tx, tz);
    if (th > 1e-4) this.q.setFromAxisAngle(this.v.set(-tz / th, 0, -tx / th), th);
    else this.q.identity();
    const X = this.laneX(lane) + x;
    this.m4.compose(this.v.set(X, y, zView), this.q, this.s.setScalar(scale));
    this.pins.setMatrixAt(idx, this.m4);
    // reflection only over the lane surface
    const onLane = Math.abs(x) < LANE_HALF && zView > -PIT_V && y > 0;
    if (onLane) {
      this.m4b.copy(this.S).multiply(this.m4).multiply(this.S);
      this.pinsMirror.setMatrixAt(idx, this.m4b);
    } else this.pinsMirror.setMatrixAt(idx, this.m4.makeScale(0, 0, 0));
    // shadow: under the body, stretched along the fall direction, fading with height
    if (y > -0.01 && zView > -PIT_V) {
      const s = Math.sin(Math.min(th, Math.PI / 2));
      const fx = th > 1e-4 ? tx / th : 0;
      const fz = th > 1e-4 ? -tz / th : 0;
      const lift = Math.max(0, y - (PIN_COM * Math.cos(th) + 0.026 * s));
      const k2 = Math.max(0, 1 - lift * 3) * scale;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), Math.atan2(fx, fz));
      this.m4.compose(this.v.set(X + fx * s * 0.06, 0.003, zView + fz * s * 0.06), this.q, this.s.set(0.2 * k2, 1, (0.2 + s * 0.32) * k2));
      this.pinShadows.setMatrixAt(idx, this.m4);
    } else this.pinShadows.setMatrixAt(idx, this.m4.makeScale(0, 0, 0));
  }

  pinsDone() {
    this.pins.instanceMatrix.needsUpdate = true;
    this.pinsMirror.instanceMatrix.needsUpdate = true;
    this.pinShadows.instanceMatrix.needsUpdate = true;
  }

  /** Place lane `lane`'s ball (physics x, y; view z) and roll it by the distance moved. */
  setBall(lane: number, visible: boolean, x?: number, y?: number, zView?: number, roll = true, scale = 1) {
    const b = this.balls[lane];
    if (!b) return;
    b.mesh.visible = b.mirror.visible = b.shadow.visible = visible;
    if (!visible || x == null || y == null || zView == null) return;
    const X = this.laneX(lane) + x;
    const p = b.mesh.position;
    if (!roll) b.q.copy(Alley.REST_Q);
    else {
      const dx = X - p.x;
      const dz = zView - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 1) {
        this.q.setFromAxisAngle(this.v.set(dz / d, 0, -dx / d), d / BALL_R);
        b.q.premultiply(this.q);
      }
    }
    p.set(X, y, zView);
    b.mesh.quaternion.copy(b.q);
    b.mesh.scale.setScalar(scale);
    const over = Math.abs(x) < LANE_HALF && zView > -PIT_V && zView < 0.02 && y > 0.05;
    b.mirror.visible = over;
    b.mirror.position.set(X, -y, zView);
    b.mirror.quaternion.set(-b.q.x, b.q.y, -b.q.z, b.q.w);
    b.mirror.scale.set(scale, -scale, scale);
    const lift = Math.max(0, y - BALL_R);
    b.shadow.visible = y > 0 && zView > -PIT_V;
    b.shadow.position.set(X, Math.abs(x) < LANE_HALF ? 0.003 : -0.05, zView + 0.02);
    const k = Math.max(0.2, 1 - lift * 4) * scale;
    b.shadow.scale.set(0.34 * k, 1, 0.4 * k);
  }

  /** Strike confetti from the pin deck of a lane. */
  burst(lane: number, n = 90, colors = ["#ffd23f", "#ff4fa3", "#3ee8ff", "#8bd346", "#ffffff", "#9b7bff"]) {
    const X = this.laneX(lane);
    for (let i = 0; i < n && this.parts.length < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.2;
      this.parts.push({
        p: new THREE.Vector3(X + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.3, -HEAD_V - 0.3 + (Math.random() - 0.5) * 0.4),
        v: new THREE.Vector3(Math.cos(a) * sp * 0.6, 2.4 + Math.random() * 2.2, Math.sin(a) * sp * 0.4 + 0.8),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
        life: 2.2 + Math.random() * 0.8,
      });
      const c = new THREE.Color(colors[i % colors.length]);
      this.confetti.setColorAt(this.parts.length - 1, c);
    }
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  stepParticles(dt: number) {
    if (!this.parts.length) {
      this.confetti.count = 0;
      return;
    }
    const keepColors: THREE.Color[] = [];
    const c = new THREE.Color();
    this.parts.forEach((_, i) => {
      this.confetti.getColorAt(i, c);
      keepColors.push(c.clone());
    });
    const alive: typeof this.parts = [];
    const cols: THREE.Color[] = [];
    this.parts.forEach((p, i) => {
      p.life -= dt;
      if (p.life <= 0) return;
      p.v.y -= 6 * dt;
      p.v.multiplyScalar(1 - 1.4 * dt);
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < 0.01) {
        p.p.y = 0.01;
        p.v.set(0, 0, 0);
        p.w.multiplyScalar(0.9);
      }
      p.r.x += p.w.x * dt;
      p.r.y += p.w.y * dt;
      p.r.z += p.w.z * dt;
      alive.push(p);
      cols.push(keepColors[i]);
    });
    this.parts = alive;
    alive.forEach((p, i) => {
      this.q.setFromEuler(p.r);
      this.m4.compose(p.p, this.q, this.s.setScalar(Math.min(1, p.life * 2)));
      this.confetti.setMatrixAt(i, this.m4);
      this.confetti.setColorAt(i, cols[i]);
    });
    this.confetti.count = alive.length;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private clearBuilt() {
    this.built.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.balls = [];
  }

  dispose() {
    this.clearBuilt();
    const sh = this.shared;
    [sh.pinGeo, sh.pinGeoM, sh.pinMat, sh.shadowGeo, sh.shadowMat, sh.shadowMat.map!, sh.ballGeo, sh.laneTex, sh.approachTex, this.env].forEach((d) => d.dispose());
    for (const m of [this.ring, this.flash]) {
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.guide.geometry.dispose();
    (this.guide.material as THREE.Material).dispose();
    this.guide.dispose();
    this.confetti.geometry.dispose();
    (this.confetti.material as THREE.Material).dispose();
    this.confetti.dispose();
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
