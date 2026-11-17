/** Mini-golf sounds synthesized with WebAudio: putt, wall clack, bumper boing, cup rattle, splash, tube whoosh. */
export class GolfAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  constructor(private on: boolean) {}

  /** call from a user gesture too (pointerdown) so the context may start */
  wake() {
    if (!this.on) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.7;
        this.out.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, n, n);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.on = false;
    }
  }

  private ready() {
    if (!this.on) return null;
    this.wake();
    return this.ctx && this.ctx.state === "running" ? this.ctx : null;
  }

  private noise(t: number, dur: number, f0: number, f1: number, q: number, vol: number, type: BiquadFilterType = "bandpass") {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private tone(t: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType = "sine") {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  putt(power: number) {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const v = 0.25 + power * 0.5;
    this.noise(t, 0.05, 3200, 1800, 2.5, v * 0.8);
    this.tone(t, 0.07, 1250, 820, v * 0.35);
    this.tone(t, 0.12, 320, 180, v * 0.3);
  }
  wall(speed: number) {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const v = Math.min(0.6, 0.12 + speed * 0.1);
    this.noise(t, 0.06, 1500, 900, 3, v);
    this.tone(t, 0.08, 520, 300, v * 0.4, "triangle");
  }
  boing() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 0.22, 260, 820, 0.25, "sine");
    this.tone(t + 0.02, 0.18, 390, 1100, 0.1, "triangle");
  }
  cup() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    for (const [d, v] of [[0, 0.4], [0.07, 0.3], [0.13, 0.22], [0.18, 0.15]] as const) this.noise(t + d, 0.035, 3800, 2600, 4, v);
    this.tone(t + 0.16, 0.22, 190, 120, 0.4);
    this.tone(t + 0.3, 0.5, 880, 880, 0.08, "triangle");
    this.tone(t + 0.38, 0.6, 1320, 1320, 0.07, "triangle");
  }
  splash() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.55, 2600, 300, 0.8, 0.55, "lowpass");
    this.noise(t + 0.03, 0.3, 5000, 1500, 1, 0.2);
    for (let i = 0; i < 6; i++) {
      const f = 500 + Math.random() * 600;
      this.tone(t + 0.12 + i * 0.07 + Math.random() * 0.04, 0.06, f, f * 1.8, 0.06);
    }
  }
  whoosh() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.6, 400, 2400, 1.2, 0.3);
    this.tone(t, 0.5, 200, 700, 0.06, "sine");
  }
  destroy() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
