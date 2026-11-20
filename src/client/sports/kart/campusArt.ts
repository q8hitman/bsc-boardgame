// SPIKE: the campus buildings as they look in photos (Kuwait University, Shadadiya), made bright and alive.
//  - College of Science: a long low block wrapped in a white perforated screen with a geometric pattern, a glowing
//    glass ground floor behind slim white columns, a thin white roof edge.
//  - College of Life Sciences: a golden diamond lattice skin whose front leans out as it rises, on white V columns.
//  - «اللؤلؤة»: a sphere in a white hexagon lattice with a warm glowing core, at the end of a long reflecting pool.
//  - The administration tower and blocks: white, with deep square niches / perforated screens.
// Facades are two layers (a screen with real holes over a lit inner wall), which gives them depth in sunlight.
import * as THREE from "three";
import { canvasTex } from "./life";

/** a white screen with holes (alpha), in a geometric pattern */
export function screenTex(kind: "stars" | "squares" | "hex" | "diamond", color: string, repeat: [number, number]) {
  const t = canvasTex(256, 256, (c) => {
    c.fillStyle = color;
    c.fillRect(0, 0, 256, 256);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    if (kind === "stars") {
      // eight-point stars and small circles (an Islamic geometric screen)
      for (let y = 0; y < 256; y += 64)
        for (let x = 0; x < 256; x += 64) {
          const cx = x + 32;
          const cy = y + 32;
          c.beginPath();
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const r = k % 2 ? 13 : 24;
            c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          c.fill();
          c.beginPath();
          c.arc(x, y, 6, 0, Math.PI * 2);
          c.fill();
        }
    } else if (kind === "squares") {
      for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) if ((x + y * 3) % 96 !== 0) c.fillRect(x + 6, y + 6, 20, 20);
    } else if (kind === "hex") {
      const r = 18;
      for (let row = 0; row < 12; row++)
        for (let col = 0; col < 10; col++) {
          const cx = col * r * 1.75 + (row % 2) * r * 0.87;
          const cy = row * r * 1.5;
          c.beginPath();
          for (let k = 0; k < 6; k++) c.lineTo(cx + Math.cos((k / 6) * Math.PI * 2 + Math.PI / 6) * (r - 4), cy + Math.sin((k / 6) * Math.PI * 2 + Math.PI / 6) * (r - 4));
          c.fill();
        }
    } else {
      // a diamond lattice: keep only the bars
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, 256, 256);
      c.strokeStyle = color;
      c.lineWidth = 9;
      for (let k = -256; k <= 512; k += 42) {
        c.beginPath();
        c.moveTo(k, 0);
        c.lineTo(k + 128, 256);
        c.stroke();
        c.beginPath();
        c.moveTo(k, 256);
        c.lineTo(k + 128, 0);
        c.stroke();
      }
      c.lineWidth = 4;
      for (let y = 0; y < 256; y += 64) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(256, y);
        c.stroke();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
}

/** an inner wall of lit windows (warm by the floor slabs, cool glass between) */
function innerTex(warm: string, glass: string, floors: number) {
  const t = canvasTex(128, 128, (c) => {
    c.fillStyle = glass;
    c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 32) {
      c.fillStyle = "#f2efe8";
      c.fillRect(0, y, 128, 5);
      const g = c.createLinearGradient(0, y + 5, 0, y + 32);
      g.addColorStop(0, warm);
      g.addColorStop(1, glass);
      c.fillStyle = g;
      c.fillRect(0, y + 5, 128, 14);
    }
    c.fillStyle = "rgba(255,255,255,0.35)";
    for (let x = 0; x < 128; x += 16) c.fillRect(x, 0, 2, 128);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, floors / 4);
  return t;
}

const screenMat = (tex: THREE.Texture) => new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });

/** College of Science: length along the local x axis, `rot` turns it */
export function scienceBlock(scene: THREE.Scene, o: { x: number; z: number; rot: number; len: number; depth: number; h: number }) {
  const g = new THREE.Group();
  const floors = Math.round(o.h / 4.2);
  // the lit inner building (set back), the glowing glass ground floor
  const inner = new THREE.Mesh(new THREE.BoxGeometry(o.len - 2, o.h - 1, o.depth - 2), new THREE.MeshLambertMaterial({ map: innerTex("#ffd99a", "#5d8aa0", floors), emissive: 0x2a1c08 }));
  inner.position.y = (o.h - 1) / 2;
  g.add(inner);
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(o.len - 3, 4.6, o.depth - 3.5), new THREE.MeshPhongMaterial({ color: 0xfff1c9, emissive: 0x6b5222, shininess: 80, specular: 0xffffff }));
  lobby.position.y = 2.3;
  g.add(lobby);
  // the white perforated screen wrapping the upper floors
  const tex = screenTex("stars", "#f7f5ef", [o.len / 4.5, (o.h - 5) / 4.5]);
  const sideTex = screenTex("stars", "#f7f5ef", [o.depth / 4.5, (o.h - 5) / 4.5]);
  const sh = o.h - 5;
  for (const sd of [1, -1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(o.len, sh), screenMat(tex));
    f.position.set(0, 5 + sh / 2, sd * (o.depth / 2));
    g.add(f);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(o.depth, sh), screenMat(sideTex));
    s.position.set(sd * (o.len / 2), 5 + sh / 2, 0);
    s.rotation.y = Math.PI / 2;
    g.add(s);
  }
  // roof edge and slim white columns along both long sides
  const roof = new THREE.Mesh(new THREE.BoxGeometry(o.len + 1.2, 0.8, o.depth + 1.2), new THREE.MeshLambertMaterial({ color: 0xfbfaf6 }));
  roof.position.y = o.h + 0.4;
  g.add(roof);
  const colGeo = new THREE.CylinderGeometry(0.28, 0.28, 5, 8);
  const colMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let x = -o.len / 2 + 2; x <= o.len / 2 - 2; x += 5)
    for (const sd of [1, -1]) {
      const c = new THREE.Mesh(colGeo, colMat);
      c.position.set(x, 2.5, sd * (o.depth / 2 - 0.3));
      g.add(c);
    }
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot;
  scene.add(g);
  return g;
}

/** College of Life Sciences: a golden lattice skin leaning out at the front, on white V columns */
export function lifeBlock(scene: THREE.Scene, o: { x: number; z: number; rot: number; len: number; depth: number; h: number; lean: number }) {
  const g = new THREE.Group();
  const floors = Math.round(o.h / 4.2);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(o.len - 2, o.h - 6, o.depth - 3), new THREE.MeshLambertMaterial({ map: innerTex("#ffcf8a", "#3f3a3a", floors), emissive: 0x1d1206 }));
  inner.position.set(0, 6 + (o.h - 6) / 2, -0.5);
  g.add(inner);
  // the shell: a box whose top front edge moves out by `lean`
  const shell = new THREE.BoxGeometry(o.len, o.h - 6, o.depth, 1, 1, 1);
  const pos = shell.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) if (pos.getY(k) > 0 && pos.getZ(k) > 0) pos.setZ(k, pos.getZ(k) + o.lean);
  shell.computeVertexNormals();
  const gold = screenTex("diamond", "#d99a45", [o.len / 7, (o.h - 6) / 7]);
  const skin = new THREE.Mesh(shell, new THREE.MeshPhongMaterial({ map: gold, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, shininess: 60, specular: 0x8a6030, emissive: 0x3a2205 }));
  skin.position.y = 6 + (o.h - 6) / 2;
  g.add(skin);
  // the open ground floor: a glass box set back, and white V columns under the front
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(o.len - 6, 6, o.depth - 8), new THREE.MeshPhongMaterial({ color: 0xffe7b8, emissive: 0x5a3c12, shininess: 80 }));
  lobby.position.set(0, 3, -2);
  g.add(lobby);
  const colMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let x = -o.len / 2 + 3; x <= o.len / 2 - 3; x += 7) {
    for (const lean of [0.28, -0.28]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 6.6, 8), colMat);
      c.position.set(x + lean * 3, 3, o.depth / 2 - 1);
      c.rotation.z = lean;
      g.add(c);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(o.len + 1, 0.8, o.depth + o.lean + 1), new THREE.MeshLambertMaterial({ color: 0xc98a3e }));
  roof.position.set(0, o.h + 0.4, o.lean / 2);
  g.add(roof);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot;
  scene.add(g);
  return g;
}

/** «اللؤلؤة»: a hexagon lattice sphere with a glowing core, and the long reflecting pool in front with jets */
export function pearl(scene: THREE.Scene, o: { x: number; z: number; r: number; poolDir: number; poolLen: number }) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.94, 36, 24), new THREE.MeshPhongMaterial({ color: 0xfff6e0, emissive: 0x7a6640, shininess: 30 }));
  const shellTex = screenTex("hex", "#ffffff", [8, 4]);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(o.r, 48, 30), new THREE.MeshPhongMaterial({ map: shellTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, shininess: 90, specular: 0xffffff }));
  for (const m of [core, shell]) {
    m.scale.set(1, 0.86, 1.08);
    m.position.y = o.r * 0.72;
    g.add(m);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.1, o.r * 1.14, 1.2, 48), new THREE.MeshLambertMaterial({ color: 0xece6d8 }));
  ring.position.y = 0.6;
  g.add(ring);
  g.position.set(o.x, 0, o.z);
  scene.add(g);
  // the reflecting pool: a long blue strip of water with a white stone rim
  const dir = o.poolDir;
  const cx = o.x + Math.sin(dir) * (o.r * 1.2 + o.poolLen / 2);
  const cz = o.z + Math.cos(dir) * (o.r * 1.2 + o.poolLen / 2);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, o.poolLen), new THREE.MeshLambertMaterial({ color: 0xf2eee4 }));
  rim.position.set(cx, 0.25, cz);
  rim.rotation.y = dir;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(7.6, o.poolLen - 1.2), new THREE.MeshPhongMaterial({ color: 0x3fb6e8, shininess: 140, specular: 0xffffff, emissive: 0x05304a }));
  water.rotation.order = "YXZ";
  water.rotation.set(-Math.PI / 2, dir, 0);
  water.position.set(cx, 0.52, cz);
  scene.add(rim, water);
  return { pool: { x: cx, z: cz, dir, len: o.poolLen } };
}

/** a white block with deep square niches (the administration buildings), or a tall tower of them */
export function whiteBlock(scene: THREE.Scene, o: { x: number; z: number; rot: number; w: number; d: number; h: number; kind: "niches" | "screen" }) {
  const g = new THREE.Group();
  const floors = Math.round(o.h / 4.2);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(o.w - 1.6, o.h, o.d - 1.6), new THREE.MeshLambertMaterial({ map: innerTex("#ffe2b0", "#6f8fa3", floors) }));
  inner.position.y = o.h / 2;
  g.add(inner);
  const tex = screenTex(o.kind === "niches" ? "squares" : "stars", "#fbfaf5", [o.w / 8, o.h / 8]);
  const texD = screenTex(o.kind === "niches" ? "squares" : "stars", "#fbfaf5", [o.d / 8, o.h / 8]);
  for (const sd of [1, -1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), screenMat(tex));
    f.position.set(0, o.h / 2, sd * (o.d / 2));
    g.add(f);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(o.d, o.h), screenMat(texD));
    s.position.set(sd * (o.w / 2), o.h / 2, 0);
    s.rotation.y = Math.PI / 2;
    g.add(s);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.6, 0.6, o.d + 0.6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  roof.position.y = o.h + 0.3;
  g.add(roof);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.rot;
  scene.add(g);
  return g;
}

/** confetti over a spot: bright paper bits falling and fluttering, looping */
export function confetti(scene: THREE.Scene, at: THREE.Vector3, spread: number) {
  const N = 420;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  const cols = [0xffd23f, 0xff3d6e, 0x2f8cff, 0x36c26b, 0xffffff, 0xff8a1e, 0xc77dff].map((c) => new THREE.Color(c));
  const reset = (k: number, top: boolean) => {
    pos[k * 3] = at.x + (Math.random() - 0.5) * spread;
    pos[k * 3 + 1] = top ? 18 + Math.random() * 6 : Math.random() * 24;
    pos[k * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
    vel[k] = 1.5 + Math.random() * 2;
  };
  for (let k = 0; k < N; k++) {
    reset(k, false);
    const c = cols[k % cols.length];
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, vertexColors: true })));
  return (dt: number, t: number) => {
    for (let k = 0; k < N; k++) {
      pos[k * 3 + 1] -= vel[k] * dt;
      pos[k * 3] += Math.sin(t * 3 + k) * dt * 0.8;
      if (pos[k * 3 + 1] < 0.1) reset(k, true);
    }
    g.attributes.position.needsUpdate = true;
  };
}

/** a blimp in club colours with «سباق البط» on its side, cruising round the campus */
export function blimp(scene: THREE.Scene, centre: THREE.Vector3) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(6, 28, 18), new THREE.MeshPhongMaterial({ color: 0xffd23f, shininess: 80, specular: 0xffffff }));
  body.scale.set(1, 1, 2.6);
  g.add(body);
  for (const [rx, rz] of [[0, 0], [Math.PI / 2, 0]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 4), new THREE.MeshLambertMaterial({ color: 0x2f8cff }));
    fin.position.z = -14;
    fin.rotation.z = rx;
    void rz;
    g.add(fin);
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  cabin.position.y = -6.4;
  g.add(cabin);
  const label = canvasTex(512, 128, (c) => {
    c.fillStyle = "#ffd23f";
    c.fillRect(0, 0, 512, 128);
    c.fillStyle = "#1b1440";
    c.font = "bold 72px 'Noto Kufi Arabic', Tahoma, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("سباق البط", 256, 70);
  });
  for (const sd of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), new THREE.MeshBasicMaterial({ map: label, side: THREE.DoubleSide }));
    m.position.set(sd * 6.05, 0, 0);
    m.rotation.y = sd > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(m);
  }
  scene.add(g);
  let a = 0;
  return (dt: number, t: number) => {
    a += dt * 0.05;
    g.position.set(centre.x + Math.cos(a) * 140, 58 + Math.sin(t * 0.5) * 2, centre.z + Math.sin(a) * 140);
    g.rotation.y = -a;
  };
}
