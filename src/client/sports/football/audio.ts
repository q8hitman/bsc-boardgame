/** Football sounds synthesized with WebAudio (no files): crowd bed, kicks, whistle, net, boards, the goal roar. */
export class FootballAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crowd: { gain: GainNode; filt: BiquadFilterNode; src: AudioBufferSourceNode; src2: AudioBufferSourceNode; g2: GainNode } | null = null;
  private excite = 0;
  /** 0..1: the crowd bed's level (0 after the final whistle) */
  private bed = 1;
  private paused = false;
  private unlock = () => this.ensure();
  private dead = false;

  constructor(private enabled: boolean) {
    if (enabled) {
      addEventListener("pointerdown", this.unlock, true);
      addEventListener("keydown", this.unlock, true);
      // autoplay may already be allowed (a room where this screen started the game)
      queueMicrotask(() => this.ensure());
    }
  }

  private ensure() {
    if (!this.enabled || this.dead) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.55;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 5;
        this.out.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 3;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.startCrowd();
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === "suspended" && !this.paused) void this.ctx.resume();
    return this.paused ? null : this.ctx;
  }

  /** the lobby / the podium: stop everything (no battery spent on a silent context) */
  pause(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** fade the crowd bed (1 = normal, 0 = gone: full time) */
  crowdLevel(v: number) {
    this.bed = v;
    this.setExcite(this.excite);
  }

  /** the crowd bed: two bands of noise with slow swells, louder when the play gets near a goal */
  private startCrowd() {
    const ctx = this.ctx!;
    const mk = (f: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.6 + Math.random() * 0.1;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = f;
      filt.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(this.out!);
      src.start();
      return { src, filt, gain };
    };
    const a = mk(520, 0.7);
    const b = mk(1400, 1.4);
    a.gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 2);
    b.gain.gain.linearRampToValueAtTime(0.025, ctx.currentTime + 2);
    this.crowd = { gain: a.gain, filt: a.filt, src: a.src, src2: b.src, g2: b.gain };
  }

  /** 0..1: how tense the play is (ball near a goal) */
  setExcite(v: number) {
    if (!this.ctx || !this.crowd) return;
    this.excite += (v - this.excite) * 0.05;
    const t = this.ctx.currentTime;
    this.crowd.gain.gain.setTargetAtTime((0.08 + this.excite * 0.07) * this.bed, t, this.bed ? 0.4 : 1.2);
    this.crowd.g2.gain.setTargetAtTime((0.02 + this.excite * 0.05) * this.bed, t, this.bed ? 0.4 : 1.2);
    this.crowd.filt.frequency.setTargetAtTime(480 + this.excite * 260, t, 0.5);
  }

  private burst(dur: number, type: BiquadFilterType, f: number, q: number, vol: number, at = 0, attack = 0.002) {
    const ctx = this.ensure();
    if (!ctx || !this.noise || !this.out) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt).connect(g).connect(this.out);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  private tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine", at = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(power = 0.6) {
    this.tone(170, 48, 0.12, 0.35 + power * 0.35);
    this.burst(0.05, "highpass", 1800, 0.7, 0.18 + power * 0.2);
  }
  pass() {
    this.tone(150, 60, 0.09, 0.28);
    this.burst(0.04, "highpass", 2200, 0.7, 0.12);
  }
  tackle() {
    this.burst(0.28, "lowpass", 900, 0.8, 0.3, 0, 0.02);
    this.tone(110, 50, 0.16, 0.3);
  }
  board() {
    this.tone(95, 55, 0.2, 0.42);
    this.burst(0.14, "bandpass", 380, 1.2, 0.38);
    this.tone(310, 240, 0.08, 0.12, "triangle");
  }
  post() {
    for (const [f, v] of [
      [523, 0.16],
      [1291, 0.1],
      [2137, 0.07],
      [3361, 0.04],
    ] as const)
      this.tone(f, f * 0.995, 0.9, v, "sine");
    this.burst(0.05, "highpass", 3000, 0.7, 0.15);
  }
  save() {
    this.burst(0.09, "lowpass", 1800, 0.8, 0.4);
    this.tone(130, 60, 0.12, 0.3);
  }
  /** the ball in the net: `power` 0..1 (a trickle swishes, a screamer whumps) */
  net(power = 0.5) {
    this.burst(0.4 + power * 0.5, "bandpass", 2400, 0.6, 0.12 + power * 0.18, 0, 0.01);
    this.burst(0.3 + power * 0.2, "bandpass", 900, 0.9, 0.1 + power * 0.16, 0.03, 0.02);
    if (power > 0.6) this.tone(120, 45, 0.3, 0.45 * power);
  }
  /** a big hit (screamer): a deep boom under the kick */
  boom() {
    this.tone(90, 30, 0.45, 0.5);
    this.burst(0.25, "lowpass", 600, 0.7, 0.35);
  }
  /** the referee: `n` blasts (1 = restart, 2 = half time, 3 = full time) */
  whistle(n = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.out) return;
    for (let i = 0; i < n; i++) {
      const long = i === n - 1 && n > 1;
      const t = ctx.currentTime + i * 0.45;
      const dur = long ? 0.85 : 0.32;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 34;
      const lg = ctx.createGain();
      lg.gain.value = 120;
      lfo.connect(lg);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.02);
      g.gain.setValueAtTime(0.11, t + dur - 0.06);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      for (const f of [2950, 3120]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f;
        lg.connect(o.frequency);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
      lp.connect(g).connect(this.out);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
  }
  /** the stadium on a goal: a big swell of crowd noise that fades over a few seconds (`power` 0..1) */
  roar(power = 0.7) {
    const ctx = this.ensure();
    if (!ctx || !this.noise || !this.out) return;
    const t = ctx.currentTime;
    const k = 0.6 + power * 0.5;
    for (const [f, q, v0] of [
      [650, 0.6, 0.42],
      [1500, 1.1, 0.2],
      [3000, 1.5, 0.07],
    ] as const) {
      const v = v0 * k;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.7;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = f;
      filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.35);
      g.gain.setValueAtTime(v, t + 2.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
      // a little wobble, like many voices
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3 + Math.random() * 2;
      const lg = ctx.createGain();
      lg.gain.value = v * 0.25;
      lfo.connect(lg).connect(g.gain);
      src.connect(filt).connect(g).connect(this.out);
      src.start(t);
      src.stop(t + 5.6);
      lfo.start(t);
      lfo.stop(t + 5.6);
    }
  }
  /** a near miss: a short "ooh" */
  ooh() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.burst(1.1, "bandpass", 480, 3, 0.2, 0, 0.18);
    this.burst(1.0, "bandpass", 820, 4, 0.08, 0.05, 0.2);
  }

  destroy() {
    this.dead = true;
    removeEventListener("pointerdown", this.unlock, true);
    removeEventListener("keydown", this.unlock, true);
    try {
      this.crowd?.src.stop();
      this.crowd?.src2.stop();
    } catch {
      /* already stopped */
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}
