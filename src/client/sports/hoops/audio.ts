// Basketball sounds synthesized with WebAudio: swish, rim clank, backboard, ball bounce, buzzer, release whoosh.

export class HoopsAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private unlock = () => this.ensure();

  constructor(private on: boolean) {
    if (on) {
      window.addEventListener("pointerdown", this.unlock, { passive: true });
      window.addEventListener("keydown", this.unlock);
    }
  }

  private ensure() {
    if (!this.on) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.7;
        const comp = this.ctx.createDynamicsCompressor();
        this.out.connect(comp).connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, n, n);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.on = false;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private noise(t: number, dur: number, gain: number, filter: BiquadFilterType, f0: number, f1: number, q = 1) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", freqEnd?: number, attack = 0.004) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** clean swish through the net */
  swish(vol = 1) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.32, 0.5 * vol, "bandpass", 1800, 5200, 0.8);
    this.noise(t + 0.04, 0.24, 0.25 * vol, "highpass", 4000, 7000, 0.7);
  }

  /** metal rim: inharmonic partials ringing out */
  rim(strength = 1) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    const v = Math.min(1, 0.35 + strength * 0.25);
    const base = 520 + Math.random() * 60;
    for (const [m, g, d] of [
      [1, 0.28, 0.5],
      [2.71, 0.16, 0.32],
      [4.13, 0.1, 0.22],
      [5.4, 0.06, 0.16],
    ])
      this.tone(t, base * m, d, g * v, "sine", undefined, 0.002);
    this.noise(t, 0.05, 0.4 * v, "highpass", 2500, 2500, 0.7);
    this.tone(t, 160, 0.12, 0.25 * v, "sine", 90);
  }

  /** ball off the backboard: a hollow thud */
  board(strength = 1) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    const v = Math.min(1, 0.4 + strength * 0.2);
    this.tone(t, 210, 0.16, 0.5 * v, "sine", 120);
    this.noise(t, 0.09, 0.35 * v, "lowpass", 1400, 500, 0.8);
  }

  /** ball bouncing on the hardwood */
  bounce(strength = 1) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    const v = Math.min(1, 0.2 + strength * 0.18);
    this.tone(t, 150, 0.14, 0.7 * v, "sine", 70, 0.002);
    this.noise(t, 0.05, 0.25 * v, "bandpass", 900, 600, 1.2);
  }

  /** the throw */
  release() {
    const c = this.ensure();
    if (!c) return;
    this.noise(c.currentTime, 0.28, 0.22, "bandpass", 500, 1600, 0.9);
  }

  /** end of the shot clock */
  buzzer() {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    for (const f of [196, 198.5, 392]) this.tone(t, f, 0.75, f > 300 ? 0.05 : 0.11, "sawtooth", undefined, 0.01);
  }

  /** fire ignites */
  ignite() {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.7, 0.45, "lowpass", 300, 3200, 0.6);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + 0.08 + i * 0.07, f, 0.3, 0.12, "triangle"));
  }

  /** points ding (pitch climbs with the streak) */
  score(points: number, streak: number) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    const up = Math.pow(2, Math.min(6, streak) / 12);
    this.tone(t, 880 * up, 0.12, 0.12, "triangle");
    this.tone(t + 0.08, (points >= 3 ? 1318 : 1175) * up, 0.25, 0.12, "triangle");
  }

  miss() {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 300, 0.25, 0.08, "triangle", 200);
  }

  tick() {
    const c = this.ensure();
    if (!c) return;
    this.tone(c.currentTime, 1500, 0.05, 0.06, "square");
  }

  destroy() {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
