import * as THREE from "three";
import { CUSHIONS, POCKETS, type Seg } from "../../../shared/pool/physics";
import { TABLE } from "../../../shared/pool/types";
import * as T from "./textures";

/** The 3D pool table: cloth, cushions, mitred mahogany rails with diamond sights, leather pocket cups, legs, the
 *  lamp, 16 balls, the cue and the aiming guides. World: x along the table, y up, z = the table's y. It only draws;
 *  pool-view.ts decides where everything is each frame. */

const { length: L, width: W, r: R, headX, footX } = TABLE;
const HL = L / 2;
const HW = W / 2;
/** cushion depth (nose → rail) and wooden rail width */
export const CW = 0.05;
export const RW = 0.125;
const CUSH_TOP = 0.041;
const RAIL_TOP = 0.046;
const RAIL_BOT = -0.03;
const APRON_BOT = -0.2;
export const FLOOR_Y = -0.79;
/** the visual pocket openings (cloth hole / rail hole radii) */
const HOLE = { corner: 0.064, side: 0.066 };
const CUP = { corner: 0.071, side: 0.073 };
/** half extents of the whole table (outside of the rails) */
export const OUT_X = HL + CW + RW;
export const OUT_Z = HW + CW + RW;

/** The cushion back line with a round notch at each pocket. `outward` = notch goes into the rail (rail hole),
 *  otherwise it bites into the cloth (cloth outline). Points traced counter-clockwise (x right, y = table y up). */
function outline(rc: number, rs: number, outward: boolean) {
  const X = HL + CW;
  const Y = HW + CW;
  const pts: THREE.Vector2[] = [];
  const arc = (cx: number, cy: number, r: number, fx: number, fy: number, tx: number, ty: number) => {
    let a0 = Math.atan2(fy - cy, fx - cx);
    let a1 = Math.atan2(ty - cy, tx - cx);
    if (outward) {
      while (a1 <= a0) a1 += Math.PI * 2;
    } else while (a1 >= a0) a1 -= Math.PI * 2;
    const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) / Math.PI) * 28));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  const P = POCKETS;
  const corner = (i: number) => {
    const c = P[i];
    const dh = Math.sqrt(Math.max(0, rc * rc - (Y - Math.abs(c.y)) ** 2));
    const dv = Math.sqrt(Math.max(0, rc * rc - (X - Math.abs(c.x)) ** 2));
    const sx = Math.sign(c.x);
    const sy = Math.sign(c.y);
    return { c, h: new THREE.Vector2(c.x - sx * dh, sy * Y), v: new THREE.Vector2(sx * X, c.y - sy * dv) };
  };
  const side = (i: number) => {
    const c = P[i];
    const d = Math.sqrt(Math.max(0, rs * rs - (Y - Math.abs(c.y)) ** 2));
    const sy = Math.sign(c.y);
    return { c, l: new THREE.Vector2(-d, sy * Y), r: new THREE.Vector2(d, sy * Y) };
  };
  const BL = corner(0), BS = side(1), BR = corner(2), TL = corner(3), TS = side(4), TR = corner(5);
  pts.push(BL.h.clone());
  arc(BS.c.x, BS.c.y, rs, BS.l.x, BS.l.y, BS.r.x, BS.r.y);
  arc(BR.c.x, BR.c.y, rc, BR.h.x, BR.h.y, BR.v.x, BR.v.y);
  arc(TR.c.x, TR.c.y, rc, TR.v.x, TR.v.y, TR.h.x, TR.h.y);
  arc(TS.c.x, TS.c.y, rs, TS.r.x, TS.r.y, TS.l.x, TS.l.y);
  arc(TL.c.x, TL.c.y, rc, TL.h.x, TL.h.y, TL.v.x, TL.v.y);
  arc(BL.c.x, BL.c.y, rc, BL.v.x, BL.v.y, BL.h.x, BL.h.y);
  pts.pop();
  return pts;
}

function roundedRect(hx: number, hy: number, rad: number) {
  const s = new THREE.Shape();
  s.moveTo(-hx + rad, -hy);
  s.lineTo(hx - rad, -hy);
  s.quadraticCurveTo(hx, -hy, hx, -hy + rad);
  s.lineTo(hx, hy - rad);
  s.quadraticCurveTo(hx, hy, hx - rad, hy);
  s.lineTo(-hx + rad, hy);
  s.quadraticCurveTo(-hx, hy, -hx, hy - rad);
  s.lineTo(-hx, -hy + rad);
  s.quadraticCurveTo(-hx, -hy, -hx + rad, -hy);
  return s;
}

/** Extrude a flat shape (x, table y) downwards from `top` by `depth`, lying on the table. */
function slab(shape: THREE.Shape, top: number, depth: number, bevel = 0, segs = 3) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelOffset: -bevel,
    bevelSegments: segs,
    curveSegments: 24,
  });
  // shape y → world z; extrusion goes down
  g.rotateX(Math.PI / 2);
  g.translate(0, top - bevel, 0);
  return g;
}

export interface BallObj {
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  q: THREE.Quaternion;
}

export class PoolScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  readonly balls: BallObj[] = [];
  readonly cue = new THREE.Group();
  readonly guide: THREE.InstancedMesh;
  readonly ghost: THREE.Group;
  readonly kitchen: THREE.Group;
  readonly handRing: THREE.Mesh;
  readonly lamp = new THREE.Group();
  readonly table = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private env: THREE.Texture;
  private envBalls: THREE.Texture;
  private dots = 0;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(canvas: HTMLCanvasElement, readonly mode: "screen" | "personal") {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer = r;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // the view asks for a shadow update only when something on the table moved
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.localClippingEnabled = true;
    const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());

    this.scene.background = new THREE.Color(0x0b0705);
    this.scene.fog = new THREE.Fog(0x0b0705, 5, 13);
    const pm = new THREE.PMREMGenerator(r);
    const bake = (bulbs: boolean) => {
      const es = T.envScene(bulbs);
      const t = pm.fromScene(es, 0.03).texture;
      es.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      return t;
    };
    this.env = bake(false);
    this.envBalls = bake(true);
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.add(this.table);

    this.buildLights();
    this.buildTable(aniso);
    this.buildRoom(aniso);
    if (mode === "screen") this.buildLamp();

    // balls
    const ballGeo = new THREE.SphereGeometry(R, 48, 32);
    const blobGeo = new THREE.PlaneGeometry(R * 3.4, R * 3.4).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ map: T.blobTexture(), transparent: true, depthWrite: false, opacity: 0.75 });
    this.keep(ballGeo, blobGeo, blobMat, blobMat.map!);
    const rr = T.rnd(42);
    for (let n = 0; n < 16; n++) {
      const map = T.ballTexture(n);
      const mat = new THREE.MeshPhysicalMaterial({ map, envMap: this.envBalls, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.0, specularIntensity: 0.9 });
      this.keep(map, mat);
      const mesh = new THREE.Mesh(ballGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const shadow = new THREE.Mesh(blobGeo, blobMat);
      shadow.renderOrder = 1;
      // numbers mostly facing up, each ball turned its own way
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (rr() - 0.5) * 0.9, rr() * Math.PI * 2, (rr() - 0.5) * 0.9, "YXZ"));
      this.scene.add(mesh, shadow);
      this.balls.push({ mesh, shadow, q });
    }

    this.buildCue();
    // aim dots
    const dotGeo = new THREE.PlaneGeometry(0.016, 0.016).rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ map: T.glowTexture(), transparent: true, depthWrite: false, opacity: 0.95 });
    this.keep(dotGeo, dotMat, dotMat.map!);
    this.guide = new THREE.InstancedMesh(dotGeo, dotMat, 140);
    this.guide.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(140 * 3), 3);
    this.guide.frustumCulled = false;
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < 140; i++) this.guide.setMatrixAt(i, this.m4);
    this.dots = 140;
    this.guide.renderOrder = 4;
    this.scene.add(this.guide);
    // ghost ball: a glassy outline where the white will touch
    this.ghost = new THREE.Group();
    const gMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    const gRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const gBall = new THREE.Mesh(ballGeo, gMat);
    const gRing = new THREE.Mesh(new THREE.RingGeometry(R * 0.86, R * 1.0, 40).rotateX(-Math.PI / 2), gRingMat);
    gRing.position.y = -R + 0.0012;
    gBall.renderOrder = 5;
    gRing.renderOrder = 5;
    this.ghost.add(gBall, gRing);
    this.ghost.visible = false;
    this.keep(gMat, gRingMat, gRing.geometry);
    this.scene.add(this.ghost);
    // the kitchen (where the white goes when in hand)
    this.kitchen = new THREE.Group();
    const c = (TABLE.corner * 2) / Math.SQRT2;
    const kPts = [[-HL + c, -HW], [headX, -HW], [headX, HW], [-HL + c, HW], [-HL, HW - c], [-HL, -HW + c]].map(([x, y]) => new THREE.Vector2(x, -y));
    const kMat = new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0.07, depthWrite: false });
    const kArea = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(kPts)).rotateX(-Math.PI / 2), kMat);
    kArea.position.y = 0.0008;
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0.55, depthWrite: false });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.004, W).rotateX(-Math.PI / 2), lineMat);
    line.position.set(headX, 0.001, 0);
    this.kitchen.add(kArea, line);
    this.kitchen.visible = false;
    this.keep(kMat, lineMat, kArea.geometry, line.geometry);
    this.scene.add(this.kitchen);
    const ringMat = new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xffe28a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.handRing = new THREE.Mesh(new THREE.PlaneGeometry(R * 4.2, R * 4.2).rotateX(-Math.PI / 2), ringMat);
    this.handRing.renderOrder = 3;
    this.handRing.visible = false;
    this.keep(ringMat, ringMat.map!, this.handRing.geometry);
    this.scene.add(this.handRing);
    // compile every material now (the cue, guides and ghost appear later and would stall the first shot)
    const hidden = [this.cue, this.ghost, this.kitchen, this.handRing, this.guide];
    for (const o of hidden) o.visible = true;
    try {
      r.compile(this.scene, this.camera);
    } catch {
      /* not supported: compiled on first use */
    }
    for (const o of hidden) o.visible = false;
  }

  private keep(...d: { dispose(): void }[]) {
    this.disposables.push(...d);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffe7c4, 0x160c07, 0.42));
    // the three lamp bulbs: warm cones, soft shadows
    for (const x of [-0.72, 0, 0.72]) {
      // phones: one shadow map is plenty from above (every ball also has a soft contact shadow)
      const shadows = this.mode === "screen" || x === 0;
      const s = new THREE.SpotLight(0xffe6c0, 7, 4, 0.82, 0.9, 1.6);
      s.position.set(x, 1.25, 0);
      s.target.position.set(x * 0.9, 0, 0);
      s.castShadow = shadows;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.camera.near = 0.6;
      s.shadow.camera.far = 2.4;
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.002;
      s.shadow.radius = 3;
      this.scene.add(s, s.target);
    }
    // a soft key from the players' side so the rails read
    const key = new THREE.DirectionalLight(0xffd8b0, 0.35);
    key.position.set(-1.5, 2.5, 2.5);
    this.scene.add(key);
  }

  private buildTable(aniso: number) {
    const felt = T.feltTexture(aniso);
    felt.repeat.set(L / 0.45, W / 0.45);
    const bump = T.feltBump(aniso);
    bump.repeat.set(L / 0.25, W / 0.25);
    const overlay = T.bedOverlay(L + 2 * CW, W + 2 * CW, headX, footX);
    this.keep(felt, bump, overlay);
    const clothMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: felt, bumpMap: bump, bumpScale: 0.6, roughness: 0.94, metalness: 0,
      sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x3fbf86), envMapIntensity: 0.25,
    });
    // the light falloff / spots overlay, in the bed's own UV (multiplied on top)
    clothMat.onBeforeCompile = (sh) => {
      sh.uniforms.bedMap = { value: overlay };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vBedUv;").replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvBedUv = vec2((position.x + ${(HL + CW).toFixed(4)}) / ${(L + 2 * CW).toFixed(4)}, (position.z + ${(HW + CW).toFixed(4)}) / ${(W + 2 * CW).toFixed(4)});`,
      );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D bedMap;\nvarying vec2 vBedUv;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= texture2D(bedMap, vBedUv).rgb;");
    };
    this.keep(clothMat);
    // the bed: the cloth outline with the pocket holes bitten out
    // (y mirrored before laying it down so table y ends up on world +z with the faces up)
    const bedShape = new THREE.Shape(outline(HOLE.corner, HOLE.side, false).map((p) => new THREE.Vector2(p.x, -p.y)));
    const bedGeo = new THREE.ShapeGeometry(bedShape, 24);
    bedGeo.rotateX(-Math.PI / 2);
    const pos = bedGeo.attributes.position;
    const uv = bedGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + HL + CW) / 0.45, (pos.getZ(i) + HW + CW) / 0.45);
    const bed = new THREE.Mesh(bedGeo, clothMat);
    bed.receiveShadow = true;
    this.table.add(bed);
    this.keep(bedGeo);
    // the slate under the cloth (seen through the pocket holes' sides)
    const slateMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 });
    const slate = new THREE.Mesh(slab(new THREE.Shape(outline(HOLE.corner, HOLE.side, false)), -0.0005, 0.03), slateMat);
    this.table.add(slate);
    this.keep(slateMat, slate.geometry);

    // cushions: felt-covered rubber along every rail, ends cut along the pocket jaws
    const cushMat = new THREE.MeshPhysicalMaterial({ color: 0xe9f2ec, map: felt, bumpMap: bump, bumpScale: 0.5, roughness: 0.9, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x3fbf86), envMapIntensity: 0.2 });
    this.keep(cushMat);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    for (const s of CUSHIONS.rails) {
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const len = Math.hypot(ex, ey);
      let nx = -ey / len;
      let ny = ex / len;
      // outward = away from the table centre
      if (nx * (s.ax + s.bx) + ny * (s.ay + s.by) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const jaw = (x: number, y: number) => CUSHIONS.jaws.find((j: Seg) => near(j.ax, x) && near(j.ay, y));
      const back = (x: number, y: number) => {
        const j = jaw(x, y);
        let dx = nx;
        let dy = ny;
        if (j) {
          const jl = Math.hypot(j.bx - j.ax, j.by - j.ay);
          dx = (j.bx - j.ax) / jl;
          dy = (j.by - j.ay) / jl;
        }
        const t = CW / Math.max(0.2, dx * nx + dy * ny);
        return new THREE.Vector2(x + dx * t, y + dy * t);
      };
      const A = new THREE.Vector2(s.ax, s.ay);
      const B = new THREE.Vector2(s.bx, s.by);
      const pts = [A, B, back(s.bx, s.by), back(s.ax, s.ay)];
      // counter-clockwise
      const area = pts.reduce((acc, p, i) => acc + (p.x * pts[(i + 1) % 4].y - pts[(i + 1) % 4].x * p.y), 0);
      if (area < 0) pts.reverse();
      const g = slab(new THREE.Shape(pts), CUSH_TOP, CUSH_TOP + 0.002, 0.007, 4);
      const m = new THREE.Mesh(g, cushMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.table.add(m);
      this.keep(g);
    }

    // rails: mitred mahogany (grain along each rail), one geometry clipped into four pieces
    const outer = roundedRect(OUT_X, OUT_Z, 0.05);
    outer.holes.push(new THREE.Path(outline(CUP.corner, CUP.side, true)));
    const railGeo = slab(outer, RAIL_TOP, RAIL_TOP - RAIL_BOT, 0.011, 4);
    this.keep(railGeo);
    const woodA = T.woodTexture(aniso, 3);
    woodA.repeat.set(1 / 1.3, 1 / 0.36);
    const woodB = woodA.clone();
    woodB.needsUpdate = true;
    woodB.center.set(0.5, 0.5);
    woodB.rotation = Math.PI / 2;
    this.keep(woodA, woodB);
    const X0 = OUT_X;
    const Z0 = OUT_Z;
    const plane = (x: number, z: number) => new THREE.Plane(new THREE.Vector3(x, 0, z).normalize(), 0);
    const pieces: [THREE.Plane[], THREE.Texture][] = [
      [[plane(-Z0, X0), plane(Z0, X0)], woodA],
      [[plane(Z0, -X0), plane(-Z0, -X0)], woodA],
      [[plane(Z0, -X0), plane(Z0, X0)], woodB],
      [[plane(-Z0, -X0), plane(-Z0, X0)], woodB],
    ];
    const wood = { roughness: 0.5, specularIntensity: 0.45, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 0.8 };
    const sideMat = new THREE.MeshPhysicalMaterial({ map: woodA, ...wood });
    this.keep(sideMat);
    for (const [planes, map] of pieces) {
      const top = new THREE.MeshPhysicalMaterial({ map, ...wood, clippingPlanes: planes, clipShadows: true });
      const side = sideMat.clone();
      side.clippingPlanes = planes;
      side.clipShadows = true;
      this.keep(top, side);
      const m = new THREE.Mesh(railGeo, [top, side]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.table.add(m);
    }
    // diamond sights (mother of pearl)
    const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf4efe6, roughness: 0.25, iridescence: 0.8, iridescenceIOR: 1.6, clearcoat: 1, envMapIntensity: 1.2 });
    const dGeo = new THREE.CircleGeometry(0.0085, 4).rotateX(-Math.PI / 2);
    dGeo.scale(1, 1, 0.62);
    this.keep(pearl, dGeo);
    const mid = CW + 0.052;
    const diamond = (x: number, z: number, along: "x" | "z") => {
      const d = new THREE.Mesh(dGeo, pearl);
      d.position.set(x, RAIL_TOP + 0.0004, z);
      if (along === "z") d.rotation.y = Math.PI / 2;
      this.table.add(d);
    };
    for (const sz of [-1, 1]) for (const k of [-3, -2, -1, 1, 2, 3]) diamond((k * L) / 8, sz * (HW + mid), "x");
    for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) diamond(sx * (HL + mid), (k * W) / 4, "z");

    // pocket cups: leather liners going down, a dark net below and a leather lip over the rail
    const leather = T.leatherTexture();
    leather.repeat.set(3, 1);
    const cupMat = new THREE.MeshStandardMaterial({ map: leather, color: 0x6a6a6a, roughness: 0.7, metalness: 0, side: THREE.BackSide, envMapIntensity: 0.2 });
    const lipMat = new THREE.MeshPhysicalMaterial({ map: leather, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.5 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x030202 });
    this.keep(leather, cupMat, lipMat, holeMat);
    POCKETS.forEach((p) => {
      const rc = p.corner ? CUP.corner : CUP.side;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(rc, rc * 0.8, 0.16, 36, 1, true), cupMat);
      cup.position.set(p.x, RAIL_TOP - 0.08, p.y);
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(rc * 0.82, 32).rotateX(-Math.PI / 2), holeMat);
      bottom.position.set(p.x, RAIL_TOP - 0.155, p.y);
      // the lip: a leather band wrapping the rail edge around the outer half of the hole
      const outAng = Math.atan2(p.y, p.x);
      const span = p.corner ? Math.PI * 1.08 : Math.PI * 0.98;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(rc + 0.002, 0.0075, 10, 40, span), lipMat);
      lip.rotation.x = Math.PI / 2;
      lip.rotation.z = outAng - span / 2;
      lip.position.set(p.x, RAIL_TOP - 0.002, p.y);
      const capShape = new THREE.Shape();
      const r0 = rc + 0.004;
      const r1 = rc + (p.corner ? 0.034 : 0.028);
      const a0 = outAng - span / 2;
      const a1 = outAng + span / 2;
      capShape.absarc(0, 0, r1, a0, a1, false);
      capShape.absarc(0, 0, r0, a1, a0, true);
      const capGeo = slab(capShape, 0.005, 0.009, 0.0025, 3);
      const cap = new THREE.Mesh(capGeo, lipMat);
      cap.position.set(p.x, RAIL_TOP - 0.001, p.y);
      cap.castShadow = true;
      cap.receiveShadow = true;
      lip.castShadow = true;
      this.table.add(cup, bottom, lip, cap);
      this.keep(cup.geometry, bottom.geometry, lip.geometry, cap.geometry);
    });

    // apron (the table's body) and turned legs
    const apronTex = T.woodTexture(aniso, 9, true);
    apronTex.repeat.set(1 / 1.3, 1 / 0.36);
    const apronMat = new THREE.MeshPhysicalMaterial({ map: apronTex, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.7 });
    const apronShape = roundedRect(OUT_X - 0.02, OUT_Z - 0.02, 0.04);
    apronShape.holes.push(roundedRect(OUT_X - 0.045, OUT_Z - 0.045, 0.02));
    const apron = new THREE.Mesh(slab(apronShape, RAIL_BOT, RAIL_BOT - APRON_BOT, 0.008, 3), apronMat);
    apron.castShadow = true;
    apron.receiveShadow = true;
    this.table.add(apron);
    this.keep(apronTex, apronMat, apron.geometry);
    const legPts = [
      [0.0, 0], [0.07, 0], [0.07, 0.03], [0.055, 0.05], [0.05, 0.12], [0.062, 0.2], [0.07, 0.28], [0.062, 0.36], [0.045, 0.42], [0.042, 0.5], [0.055, 0.54], [0.06, 0.57], [0.0, 0.59],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const legGeo = new THREE.LatheGeometry(legPts, 28);
    this.keep(legGeo);
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 1]) {
        if (sx === 0 && this.mode === "personal") continue;
        const leg = new THREE.Mesh(legGeo, apronMat);
        leg.position.set(sx * (OUT_X - 0.16), FLOOR_Y, sz * (OUT_Z - 0.14));
        leg.castShadow = true;
        this.table.add(leg);
      }
  }

  private buildRoom(aniso: number) {
    const floorTex = T.floorTexture(aniso);
    floorTex.repeat.set(4, 4);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0, envMapIntensity: 0.4 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), floorMat);
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    const shTex = T.tableShadowTexture();
    const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.9 });
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(OUT_X * 2 + 1.0, OUT_Z * 2 + 0.9).rotateX(-Math.PI / 2), shMat);
    sh.position.y = FLOOR_Y + 0.002;
    this.scene.add(floor, sh);
    this.keep(floorTex, floorMat, floor.geometry, shTex, shMat, sh.geometry);
    // a rug under the table
    const rugMat = new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 1 });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(OUT_X * 2 + 1.6, OUT_Z * 2 + 1.5).rotateX(-Math.PI / 2), rugMat);
    rug.position.y = FLOOR_Y + 0.001;
    rug.receiveShadow = true;
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xb08a3c, roughness: 0.9 });
    const border = new THREE.Mesh(new THREE.PlaneGeometry(OUT_X * 2 + 1.7, OUT_Z * 2 + 1.6).rotateX(-Math.PI / 2), borderMat);
    border.position.y = FLOOR_Y + 0.0005;
    border.receiveShadow = true;
    this.scene.add(border, rug);
    this.keep(rugMat, rug.geometry, borderMat, border.geometry);
  }

  private buildLamp() {
    const brass = new THREE.MeshPhysicalMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.25, envMapIntensity: 1.2 });
    const enamel = new THREE.MeshPhysicalMaterial({ color: 0x1f5a36, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.FrontSide });
    const inner = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffe2b0, emissiveIntensity: 0.6, side: THREE.BackSide });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 4 });
    this.keep(brass, enamel, inner, bulbMat);
    const shadePts = [[0.0, 0.16], [0.03, 0.158], [0.045, 0.14], [0.06, 0.1], [0.11, 0.04], [0.16, 0.0], [0.165, -0.005]].reverse().map(([x, y]) => new THREE.Vector2(x, y));
    const shadeGeo = new THREE.LatheGeometry(shadePts, 40);
    const bulbGeo = new THREE.SphereGeometry(0.035, 20, 14);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.9, 16).rotateZ(Math.PI / 2), brass);
    bar.position.y = 1.5;
    this.lamp.add(bar);
    this.keep(shadeGeo, bulbGeo, bar.geometry);
    for (const x of [-0.72, 0, 0.72]) {
      const out = new THREE.Mesh(shadeGeo, enamel);
      const inn = new THREE.Mesh(shadeGeo, inner);
      out.position.set(x, 1.28, 0);
      inn.position.set(x, 1.28, 0);
      inn.scale.setScalar(0.985);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(x, 1.3, 0);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), brass);
      rod.position.set(x, 1.5 - 0.06, 0);
      this.keep(rod.geometry);
      this.lamp.add(out, inn, bulb, rod);
    }
    for (const x of [-0.6, 0.6]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 2.5, 6), brass);
      chain.position.set(x, 1.5 + 1.25, 0);
      this.lamp.add(chain);
      this.keep(chain.geometry);
    }
    this.scene.add(this.lamp);
  }

  private cueParts: THREE.Mesh[] = [];
  private buildCue() {
    // profile from the tip (y = 0) to the butt (y = 1.47), radius in metres
    const seg = (r0: number, r1: number, y0: number, y1: number, mat: THREE.Material, n = 2) => {
      const pts: THREE.Vector2[] = [];
      pts.push(new THREE.Vector2(0, y0));
      for (let i = 0; i <= n; i++) pts.push(new THREE.Vector2(r0 + ((r1 - r0) * i) / n, y0 + ((y1 - y0) * i) / n));
      pts.push(new THREE.Vector2(0, y1));
      const g = new THREE.LatheGeometry(pts, 28);
      g.rotateZ(Math.PI / 2);
      mat.transparent = true;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      this.cue.add(m);
      this.cueParts.push(m);
      this.keep(g);
    };
    const chalk = new THREE.MeshStandardMaterial({ color: 0x3a6fd0, roughness: 0.95 });
    const ferrule = new THREE.MeshPhysicalMaterial({ color: 0xf3efe4, roughness: 0.3, clearcoat: 0.6 });
    const mapleTex = T.woodTexture(4, 17);
    mapleTex.repeat.set(1, 0.3);
    const maple = new THREE.MeshPhysicalMaterial({ color: 0xffe9c4, map: mapleTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    const ebony = new THREE.MeshPhysicalMaterial({ color: 0x24140c, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
    const silver = new THREE.MeshPhysicalMaterial({ color: 0xdedede, metalness: 1, roughness: 0.2 });
    const wrap = new THREE.MeshStandardMaterial({ color: 0x15100d, roughness: 0.85 });
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xd6a744, metalness: 1, roughness: 0.25 });
    this.keep(chalk, ferrule, mapleTex, maple, ebony, silver, wrap, gold);
    seg(0.0062, 0.0064, 0, 0.008, chalk);
    seg(0.0064, 0.0066, 0.008, 0.03, ferrule);
    seg(0.0066, 0.0105, 0.03, 0.72, maple, 6);
    seg(0.0108, 0.0108, 0.72, 0.735, silver);
    seg(0.0108, 0.0122, 0.735, 0.98, ebony, 3);
    seg(0.0123, 0.0123, 0.98, 0.99, gold);
    seg(0.0124, 0.0128, 0.99, 1.24, wrap, 2);
    seg(0.0129, 0.0129, 1.24, 1.25, gold);
    seg(0.0129, 0.0145, 1.25, 1.455, ebony, 3);
    seg(0.0146, 0.0146, 1.455, 1.47, wrap);
    this.cue.visible = false;
    this.scene.add(this.cue);
  }

  /** Put the cue: its tip `gap` metres behind the white at (x, z) along `aim`, raised by `elev` radians, tip moved
   *  by side spin / follow on the ball's face. */
  setCue(visible: boolean, x = 0, z = 0, aim = 0, gap = 0, spin = 0, start = 0, opacity = 1) {
    this.cue.visible = visible && opacity > 0.01;
    if (!this.cue.visible) return;
    const dx = Math.cos(aim);
    const dz = Math.sin(aim);
    const off = R + 0.004 + gap;
    const elev = 0.09;
    const side = spin * R * 0.5;
    this.cue.position.set(x - dx * off - dz * side, R + start * R * 0.45 + Math.sin(elev) * 0.0, z - dz * off + dx * side);
    this.cue.rotation.set(0, -aim, -elev, "YZX");
    for (const m of this.cueParts) (m.material as THREE.Material).opacity = opacity;
  }

  /** Place ball n (table coordinates); `h` = height of its centre over the cloth (pocket drop), `s` = scale. */
  setBall(n: number, visible: boolean, x = 0, z = 0, h = R, s = 1) {
    const b = this.balls[n];
    b.mesh.visible = visible;
    b.shadow.visible = visible && h > R * 0.2;
    if (!visible) return;
    b.mesh.position.set(x, h, z);
    b.mesh.quaternion.copy(b.q);
    b.mesh.scale.setScalar(s);
    b.shadow.position.set(x, 0.0012, z);
    (b.shadow.material as THREE.MeshBasicMaterial).opacity = 0.75;
  }

  private ax = new THREE.Vector3();
  private qd = new THREE.Quaternion();
  /** Roll ball n by a move of (dx, dz) on the cloth. */
  roll(n: number, dx: number, dz: number) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    // axis = up × direction
    this.ax.set(dz / d, 0, -dx / d);
    this.qd.setFromAxisAngle(this.ax, d / R);
    const b = this.balls[n];
    b.q.premultiply(this.qd);
    b.q.normalize();
  }

  /** The aim guide: dotted segments [x0, z0, x1, z1, r, g, b, alpha] (table coordinates). */
  setGuide(lines: number[][]) {
    let k = 0;
    const g = this.guide;
    const max = g.count;
    for (const [x0, z0, x1, z1, r, gg, b, a, step = 0.03] of lines) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.floor(len / step));
      for (let i = 0; i <= n && k < max; i++) {
        const t = i / n;
        const fade = a * (lines.length > 0 ? 1 - t * 0.35 : 1);
        this.m4.makeTranslation(x0 + (x1 - x0) * t, 0.0016, z0 + (z1 - z0) * t);
        g.setMatrixAt(k, this.m4);
        this.col.setRGB(r * fade, gg * fade, b * fade);
        g.setColorAt(k, this.col);
        k++;
      }
    }
    for (let i = k; i < this.dots; i++) {
      this.m4.makeScale(0, 0, 0);
      g.setMatrixAt(i, this.m4);
    }
    this.dots = k;
    g.count = max;
    g.instanceMatrix.needsUpdate = true;
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
    g.visible = k > 0;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.env.dispose();
    this.envBalls.dispose();
    this.renderer.dispose();
  }
}
