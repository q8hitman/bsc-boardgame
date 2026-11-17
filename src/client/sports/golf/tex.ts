import * as THREE from "three";

/** Procedural textures (CanvasTexture), all cached per key and disposed with the view. */
export class Tex {
  private cache = new Map<string, THREE.Texture>();
  constructor(private aniso: number) {}

  private make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, repeat = true, srgb = true) {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    let s = 1234567;
    for (let i = 0; i < key.length; i++) s = (s * 31 + key.charCodeAt(i)) % 2147483647;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    draw(g, rnd);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    this.cache.set(key, t);
    return t;
  }

  /** mini-golf felt: soft mowing stripes + fibres */
  felt(a: string, b: string) {
    return this.make(`felt${a}${b}`, 512, 512, (g, rnd) => {
      g.fillStyle = a;
      g.fillRect(0, 0, 512, 512);
      // two stripes per tile, soft edges
      for (let i = 0; i < 2; i++) {
        const y = i * 256 + 128;
        const grd = g.createLinearGradient(0, y - 128, 0, y + 128);
        grd.addColorStop(0, a);
        grd.addColorStop(0.12, b);
        grd.addColorStop(0.88, b);
        grd.addColorStop(1, a);
        g.fillStyle = grd;
        g.fillRect(0, i * 256 + 0, 512, 128);
      }
      // fibres
      for (let i = 0; i < 9000; i++) {
        const x = rnd() * 512, y = rnd() * 512;
        const l = 1 + rnd() * 3;
        g.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.04 + rnd() * 0.06})` : `rgba(0,30,0,${0.05 + rnd() * 0.07})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * l, y + (rnd() - 0.5) * l);
        g.stroke();
      }
    });
  }

  sand(base: string, dark: string) {
    return this.make(`sand${base}`, 512, 512, (g, rnd) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 512);
      // wind ripples
      for (let y = 0; y < 512; y += 9) {
        g.strokeStyle = `rgba(120,70,20,${0.05 + rnd() * 0.05})`;
        g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= 512; x += 16) {
          const yy = y + Math.sin((x / 512) * Math.PI * 4 + y * 0.05) * 3;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      for (let i = 0; i < 14000; i++) {
        g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.25})` : dark;
        g.globalAlpha = rnd() < 0.5 ? 0.35 : 0.12;
        g.fillRect(rnd() * 512, rnd() * 512, 1.5, 1.5);
      }
      g.globalAlpha = 1;
    });
  }

  wood(base: string) {
    return this.make(`wood${base}`, 256, 256, (g, rnd) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++) {
        const y = rnd() * 256;
        g.strokeStyle = `rgba(60,30,10,${0.08 + rnd() * 0.14})`;
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(85, y + (rnd() - 0.5) * 8, 170, y + (rnd() - 0.5) * 8, 256, y);
        g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        g.fillStyle = "rgba(40,20,5,0.35)";
        g.fillRect(0, i * 64, 256, 2);
      }
    });
  }

  /** layered rock / earth side of the course base */
  strata(colors: string[]) {
    return this.make(`strata${colors.join()}`, 256, 256, (g, rnd) => {
      const n = colors.length;
      for (let i = 0; i < n; i++) {
        g.fillStyle = colors[i];
        g.fillRect(0, (i * 256) / n, 256, 256 / n + 1);
      }
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "0,0,0"},${rnd() * 0.12})`;
        const r = 1 + rnd() * 4;
        g.beginPath();
        g.ellipse(rnd() * 256, rnd() * 256, r * 1.8, r, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  /** white lab wall tiles */
  tiles(base: string, grout: string) {
    return this.make(`tiles${base}`, 256, 256, (g, rnd) => {
      g.fillStyle = grout;
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const v = 245 - rnd() * 14;
          g.fillStyle = base;
          g.globalAlpha = 1;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
          g.fillStyle = `rgb(${v},${v + 4},${v + 6})`;
          g.globalAlpha = 0.5;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
          const grd = g.createLinearGradient(x * 64, y * 64, x * 64 + 64, y * 64 + 64);
          grd.addColorStop(0, "rgba(255,255,255,0.5)");
          grd.addColorStop(1, "rgba(0,0,0,0.05)");
          g.fillStyle = grd;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
      g.globalAlpha = 1;
    });
  }

  /** Kuwaiti Sadu weave: bands of red / black / white diamonds and triangles */
  sadu() {
    return this.make("sadu", 256, 256, (g) => {
      const red = "#b3202a", blk = "#231815", wht = "#efe6d2", ochre = "#d08a2e";
      g.fillStyle = red;
      g.fillRect(0, 0, 256, 256);
      const band = (y: number, h: number, c1: string, c2: string, kind: number) => {
        g.fillStyle = c1;
        g.fillRect(0, y, 256, h);
        g.fillStyle = c2;
        const n = 8;
        for (let i = 0; i < n; i++) {
          const x = (i * 256) / n, w = 256 / n;
          g.beginPath();
          if (kind === 0) {
            g.moveTo(x, y + h / 2);
            g.lineTo(x + w / 2, y + 2);
            g.lineTo(x + w, y + h / 2);
            g.lineTo(x + w / 2, y + h - 2);
          } else {
            g.moveTo(x, y + h);
            g.lineTo(x + w / 2, y + 2);
            g.lineTo(x + w, y + h);
          }
          g.fill();
        }
      };
      band(0, 40, blk, wht, 0);
      g.fillStyle = wht;
      g.fillRect(0, 40, 256, 6);
      band(46, 34, red, blk, 1);
      g.fillStyle = ochre;
      g.fillRect(0, 80, 256, 8);
      band(88, 80, blk, red, 0);
      g.fillStyle = ochre;
      g.fillRect(0, 168, 256, 8);
      band(176, 34, red, wht, 1);
      g.fillStyle = wht;
      g.fillRect(0, 210, 256, 6);
      band(216, 40, blk, wht, 0);
    });
  }

  /** the golf ball: white with dimples, a band in the player's colour */
  ball(color: string) {
    return this.make(`ball${color}`, 256, 128, (g, rnd) => {
      g.fillStyle = "#fbfbf8";
      g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 520; i++) {
        const x = rnd() * 256, y = 6 + rnd() * 116;
        g.fillStyle = `rgba(150,150,170,${0.18 + rnd() * 0.12})`;
        g.beginPath();
        g.arc(x, y, 1.6 + rnd() * 1.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = color;
      g.fillRect(0, 54, 256, 20);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(0, 54, 256, 2);
      g.fillRect(0, 72, 256, 2);
      // two dots so the spin reads
      for (const x of [64, 192]) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, 22, 9, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(x, 106, 9, 0, Math.PI * 2);
        g.fill();
      }
    }, false);
  }

  /** golden flag with the hole number */
  flag(label: string) {
    return this.make(`flag${label}`, 256, 170, (g) => {
      const grd = g.createLinearGradient(0, 0, 256, 170);
      grd.addColorStop(0, "#ffe27a");
      grd.addColorStop(1, "#ffb81f");
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 170);
      g.strokeStyle = "#2b1b45";
      g.lineWidth = 14;
      g.strokeRect(7, 7, 242, 156);
      g.fillStyle = "#2b1b45";
      g.font = "800 112px 'Baloo Bhaijaan 2', system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, 128, 96);
    }, false);
  }

  /** soft round glow / blob */
  glow() {
    return this.make("glow", 128, 128, (g) => {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }, false);
  }

  /** sequin discs of the Kuwait Towers spheres */
  sequins() {
    return this.make("sequins", 256, 128, (g, rnd) => {
      g.fillStyle = "#1b4f7a";
      g.fillRect(0, 0, 256, 128);
      const cols = ["#2f8fc4", "#2a6fa0", "#3fb0a6", "#1f5a86", "#8fd0e6", "#246e8a"];
      for (let y = 4; y < 128; y += 8)
        for (let x = (y / 8) % 2 ? 4 : 0; x < 256; x += 8) {
          g.fillStyle = cols[Math.floor(rnd() * cols.length)];
          g.beginPath();
          g.arc(x, y, 3.4, 0, Math.PI * 2);
          g.fill();
        }
    });
  }

  /** agar in a petri dish, with bacteria colonies */
  agar(base: string) {
    return this.make(`agar${base}`, 128, 128, (g, rnd) => {
      const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      grd.addColorStop(0, base);
      grd.addColorStop(1, "#ffffff");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, r = rnd() * 50;
        g.fillStyle = ["#fff6c7", "#ffd1e8", "#e0ffd6", "#ffffff"][i % 4];
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5 + rnd() * 4.5, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }, false);
  }

  dispose() {
    this.cache.forEach((t) => t.dispose());
    this.cache.clear();
  }
}
