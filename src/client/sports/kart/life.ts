// SPIKE: what makes a track feel alive. A painted sky with drifting clouds, textured ground, street lamps with
// banners, waving Kuwait flags, a fountain, bushes and benches, crowds of club ducks cheering by the road, ducks
// walking about, birds overhead. Each piece adds itself to the scene; animated ones return an update(dt, cam).
import * as THREE from "three";
import { CLUB } from "../../../shared/football/club";

export type Tick = (dt: number, t: number, cam: THREE.Camera) => void;

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

let seed = 97;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** speckled noise over a base colour (sand, asphalt, paving), optionally with lines */
export function noiseTex(base: string, dots: string[], size = 256, repeat: [number, number] = [1, 1], extra?: (c: CanvasRenderingContext2D) => void) {
  return canvasTex(size, size, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, size, size);
    for (let k = 0; k < size * size * 0.12; k++) {
      c.fillStyle = dots[Math.floor(rnd() * dots.length)];
      c.globalAlpha = 0.25 + rnd() * 0.5;
      c.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    c.globalAlpha = 1;
    extra?.(c);
  }, repeat);
}

/** a sky dome: a vertical gradient, a sun disc, and soft clouds drifting across */
export function sky(scene: THREE.Scene, top: string, horizon: string, sunDir: THREE.Vector3): Tick {
  const tex = canvasTex(8, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top);
    g.addColorStop(0.55, horizon);
    g.addColorStop(1, horizon);
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 256);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -2;
  scene.add(dome);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTex(128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 8, 64, 64, 64);
      g.addColorStop(0, "rgba(255,252,235,1)");
      g.addColorStop(0.25, "rgba(255,240,190,0.9)");
      g.addColorStop(1, "rgba(255,230,160,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }),
    fog: false,
    depthWrite: false,
  }));
  sun.scale.set(130, 130, 1);
  scene.add(sun);
  const cloudTex = canvasTex(256, 128, (c) => {
    for (let k = 0; k < 14; k++) {
      const x = 40 + rnd() * 176;
      const y = 60 + rnd() * 30 - (Math.abs(x - 128) / 128) * 20;
      const r = 18 + rnd() * 26;
      const g = c.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  const clouds: THREE.Sprite[] = [];
  for (let k = 0; k < 16; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    const a = rnd() * Math.PI * 2;
    const r = 260 + rnd() * 260;
    s.position.set(Math.cos(a) * r, 120 + rnd() * 90, Math.sin(a) * r);
    const sc = 90 + rnd() * 80;
    s.scale.set(sc, sc / 2, 1);
    scene.add(s);
    clouds.push(s);
  }
  return (dt, _t, cam) => {
    dome.position.copy(cam.position);
    sun.position.copy(cam.position).addScaledVector(sunDir, 600);
    for (const c of clouds) {
      c.position.x += dt * 3;
      if (c.position.x > 520) c.position.x = -520;
    }
  };
}

/** street lamps along a list of spots, every other one with a hanging banner */
export function lamps(scene: THREE.Scene, spots: { x: number; z: number; face: number }[], banners: THREE.Texture[]) {
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0x5c6168 }), spots.length);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: 0x5c6168 }), spots.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), spots.length);
  const q = new THREE.Quaternion();
  spots.forEach((s, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.face);
    pole.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(s.x, 4, s.z), q, new THREE.Vector3(1, 1, 1)));
    const ax = Math.cos(s.face);
    const az = -Math.sin(s.face);
    arm.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(s.x + ax * 1, 7.9, s.z + az * 1), q, new THREE.Vector3(1, 1, 1)));
    head.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(s.x + ax * 2, 7.75, s.z + az * 2), q, new THREE.Vector3(1, 1, 1)));
    if (k % 2 === 0 && banners.length) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.2), new THREE.MeshLambertMaterial({ map: banners[(k / 2) % banners.length], side: THREE.DoubleSide }));
      b.position.set(s.x + ax * 0.75, 5.6, s.z + az * 0.75);
      b.rotation.y = s.face;
      scene.add(b);
    }
  });
  pole.castShadow = true;
  scene.add(pole, arm, head);
}

/** a vertical banner: a coloured strip with words written down it */
export function bannerTex(text: string, bg: string, fg: string) {
  return canvasTex(96, 256, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 96, 256);
    c.fillStyle = fg;
    c.fillRect(0, 0, 96, 10);
    c.fillRect(0, 246, 96, 10);
    c.save();
    c.translate(48, 128);
    c.rotate(-Math.PI / 2);
    c.font = "bold 34px 'Noto Kufi Arabic', Tahoma, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 0, 4);
    c.restore();
  });
}

/** Kuwait flags on poles, waving */
export function flags(scene: THREE.Scene, spots: { x: number; z: number; face: number; h?: number }[]): Tick {
  const tex = canvasTex(192, 96, (c) => {
    c.fillStyle = "#007a3d";
    c.fillRect(0, 0, 192, 32);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 32, 192, 32);
    c.fillStyle = "#ce1126";
    c.fillRect(0, 64, 192, 32);
    c.fillStyle = "#000000";
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(48, 32);
    c.lineTo(48, 64);
    c.lineTo(0, 96);
    c.fill();
  });
  const cloths: THREE.Mesh[] = [];
  for (const s of spots) {
    const h = s.h ?? 10;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, h, 6), new THREE.MeshLambertMaterial({ color: 0xd7dade }));
    pole.position.set(s.x, h / 2, s.z);
    scene.add(pole);
    const geo = new THREE.PlaneGeometry(3.6, 1.8, 12, 1);
    geo.translate(1.8, 0, 0);
    const cloth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    cloth.position.set(s.x, h - 1, s.z);
    cloth.rotation.y = s.face;
    cloth.userData.base = Float32Array.from(geo.attributes.position.array as Float32Array);
    cloth.userData.phase = rnd() * 6;
    scene.add(cloth);
    cloths.push(cloth);
  }
  return (_dt, t) => {
    for (const c of cloths) {
      const pos = (c.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      const base = c.userData.base as Float32Array;
      for (let k = 0; k < pos.count; k++) {
        const x = base[k * 3];
        pos.setZ(k, Math.sin(x * 1.6 - t * 6 + c.userData.phase) * 0.18 * (x / 3.6));
      }
      pos.needsUpdate = true;
    }
  };
}

/** a round fountain: a basin and jets of water drops */
export function fountain(scene: THREE.Scene, x: number, z: number, r = 7): Tick {
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.4, 0.9, 32), new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }));
  basin.position.set(x, 0.45, z);
  const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 32), new THREE.MeshPhongMaterial({ color: 0x47b8e0, shininess: 100, specular: 0xffffff }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.8, z);
  scene.add(basin, water);
  const N = 220;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const reset = (k: number) => {
    const a = rnd() * Math.PI * 2;
    const jet = k % 5 === 0 ? 0 : r * 0.45;
    pos[k * 3] = x + Math.cos(a) * jet;
    pos[k * 3 + 1] = 1;
    pos[k * 3 + 2] = z + Math.sin(a) * jet;
    const up = k % 5 === 0 ? 9 + rnd() * 2 : 5 + rnd();
    vel[k * 3] = Math.cos(a) * (k % 5 === 0 ? 0.8 : 0.4) * rnd();
    vel[k * 3 + 1] = up;
    vel[k * 3 + 2] = Math.sin(a) * (k % 5 === 0 ? 0.8 : 0.4) * rnd();
  };
  for (let k = 0; k < N; k++) {
    reset(k);
    pos[k * 3 + 1] = 1 + rnd() * 5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const drops = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.35, transparent: true, opacity: 0.85 }));
  scene.add(drops);
  return (dt) => {
    for (let k = 0; k < N; k++) {
      vel[k * 3 + 1] -= 18 * dt;
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      if (pos[k * 3 + 1] < 0.8) reset(k);
    }
    g.attributes.position.needsUpdate = true;
  };
}

/** bushes (round clumps) and flower beds, instanced */
export function greenery(scene: THREE.Scene, bushes: THREE.Vector3[], flowers: THREE.Vector3[]) {
  const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshLambertMaterial({ color: 0x4f8f34, flatShading: true }), bushes.length);
  bushes.forEach((p, k) => {
    const s = 0.7 + rnd() * 0.8;
    bush.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(p.x, s * 0.7, p.z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)));
    bush.setColorAt(k, new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.5, 0.3 + rnd() * 0.1));
  });
  bush.castShadow = true;
  scene.add(bush);
  const petals = [0xff5d8f, 0xffd23f, 0xffffff, 0xc77dff, 0xff8a3d];
  const flower = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), flowers.length * 10);
  let n = 0;
  for (const p of flowers)
    for (let k = 0; k < 10; k++) {
      flower.setMatrixAt(n, new THREE.Matrix4().makeTranslation(p.x + (rnd() - 0.5) * 3, 0.3, p.z + (rnd() - 0.5) * 3));
      flower.setColorAt(n, new THREE.Color(petals[Math.floor(rnd() * petals.length)]));
      n++;
    }
  scene.add(flower);
}

/** benches: a seat and a back on two legs */
export function benches(scene: THREE.Scene, spots: { x: number; z: number; face: number }[]) {
  const seatG = new THREE.BoxGeometry(2.4, 0.12, 0.6);
  seatG.translate(0, 0.55, 0);
  const backG = new THREE.BoxGeometry(2.4, 0.5, 0.1);
  backG.translate(0, 0.95, -0.28);
  const wood = new THREE.MeshLambertMaterial({ color: 0xa8743f });
  const seat = new THREE.InstancedMesh(seatG, wood, spots.length);
  const back = new THREE.InstancedMesh(backG, wood, spots.length);
  spots.forEach((s, k) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.face), new THREE.Vector3(1, 1, 1));
    seat.setMatrixAt(k, m);
    back.setMatrixAt(k, m);
  });
  scene.add(seat, back);
}

// ---------------------------------------------------------------- ducks: crowds that cheer, walkers, birds
const FW = 64;
const FH = 72;
const PX = 0.031;
const texCache = new Map<string, THREE.Texture>();
function strip(url: string) {
  let t = texCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}
/** one sprite showing frame `f` of an n-frame strip (its own texture view so frames can differ per sprite) */
function duck(url: string, frames: number, f: number, scale = 1) {
  const t = strip(url).clone();
  t.repeat.set(1 / frames, 1);
  t.offset.set(f / frames, 0);
  t.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, alphaTest: 0.5 }));
  s.center.set(0.5, 0);
  s.scale.set(FW * PX * 1.3 * scale, FH * PX * 1.3 * scale, 1);
  return s;
}

/** crowds of club ducks by the road: jumping with arms up as the karts come by */
export function crowd(scene: THREE.Scene, spots: THREE.Vector3[]): Tick {
  const people = spots.map((p, k) => {
    const id = CLUB[k % CLUB.length].id;
    const team = k % 3 === 0 ? "red" : "blue";
    const s = duck(`assets/football/extra/${id}-${team}.png`, 8, 7);
    s.position.copy(p);
    s.userData.y = p.y;
    s.userData.phase = rnd() * 6;
    s.userData.speed = 7 + rnd() * 4;
    scene.add(s);
    return s;
  });
  return (_dt, t, cam) => {
    for (const s of people) {
      // only the ones near the camera bother jumping
      if (s.position.distanceToSquared(cam.position) > 120 * 120) continue;
      s.position.y = s.userData.y + Math.max(0, Math.sin(t * s.userData.speed + s.userData.phase)) * 0.6;
    }
  };
}

/** ducks walking back and forth along paths, with a run cycle, facing the way they go */
export function walkers(scene: THREE.Scene, routes: [THREE.Vector3, THREE.Vector3][]): Tick {
  const right = new THREE.Vector3();
  const list = routes.map(([a, b], k) => {
    const id = CLUB[(k * 7) % CLUB.length].id;
    const s = duck(`assets/football/${id}-blue.png`, 6, 1, 0.95);
    scene.add(s);
    return { s, a, b, u: rnd(), dir: rnd() < 0.5 ? 1 : -1, speed: 1.2 + rnd() * 0.8, len: a.distanceTo(b), frame: 0 };
  });
  return (dt, t, cam) => {
    right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    for (const w of list) {
      w.u += (w.dir * w.speed * dt) / w.len;
      if (w.u > 1 || w.u < 0) {
        w.dir *= -1;
        w.u = Math.max(0, Math.min(1, w.u));
      }
      w.s.position.lerpVectors(w.a, w.b, w.u);
      // face the way they walk as seen on screen (the art faces right)
      const going = (w.b.x - w.a.x) * w.dir * right.x + (w.b.z - w.a.z) * w.dir * right.z;
      const map = (w.s.material as THREE.SpriteMaterial).map!;
      const f = 1 + (Math.floor(t * 8 + w.len) % 4);
      map.repeat.x = going >= 0 ? 1 / 6 : -1 / 6;
      map.offset.x = going >= 0 ? f / 6 : (f + 1) / 6;
    }
  };
}

/** birds: little dark wings flapping in loose circles high over the track */
export function birds(scene: THREE.Scene, centre: THREE.Vector3, count = 10): Tick {
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -1.2, 0.3, -0.3, -0.2, 0, 0.3, 0, 0, 0, 1.2, 0.3, -0.3, 0.2, 0, 0.3], 3));
  wing.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a3a44, side: THREE.DoubleSide });
  const flock = Array.from({ length: count }, () => {
    const m = new THREE.Mesh(wing.clone(), mat);
    scene.add(m);
    return { m, r: 40 + rnd() * 90, a: rnd() * 6, h: 35 + rnd() * 30, sp: 0.15 + rnd() * 0.15, ph: rnd() * 6 };
  });
  return (dt, t) => {
    for (const b of flock) {
      b.a += b.sp * dt;
      b.m.position.set(centre.x + Math.cos(b.a) * b.r, b.h + Math.sin(t + b.ph) * 2, centre.z + Math.sin(b.a) * b.r);
      b.m.rotation.y = -b.a;
      const pos = (b.m.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      const flap = Math.sin(t * 9 + b.ph) * 0.6;
      pos.setY(1, flap);
      pos.setY(4, flap);
      pos.needsUpdate = true;
    }
  };
}

/** an arch of balloons over the start */
export function balloonArch(scene: THREE.Scene, at: THREE.Vector3, heading: number, halfWidth: number) {
  const cols = [0xffd23f, 0x2f8cff, 0xe8493d, 0x36c26b, 0xffffff];
  const g = new THREE.SphereGeometry(0.75, 10, 8);
  const n = 34;
  const inst = new THREE.InstancedMesh(g, new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 }), n);
  const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const a = Math.PI * u;
    const p = at.clone().addScaledVector(side, -Math.cos(a) * (halfWidth + 1.5));
    p.y = Math.sin(a) * 9 + 0.8;
    inst.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    inst.setColorAt(k, new THREE.Color(cols[k % cols.length]));
  }
  scene.add(inst);
}
