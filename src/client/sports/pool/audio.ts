/** Pool sounds synthesized with WebAudio (no files): the click of phenolic balls, cushion thumps, the leather
 *  "tock" of the cue, balls dropping into the pockets and the hush of balls rolling on the cloth. */
export class PoolAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rollGain: GainNode | null = null;
  private rollFilt: BiquadFilterNode | null = null;
  private rollSrc: AudioBufferSourceNode | null = null;
  private unlock = () => this.ensure();

  constructor(private enabled: boolean) {
    if (enabled) {
      addEventListener("pointerdown", this.unlock, true);
      addEventListener("keydown", this.unlock, true);
    }
  }

  private ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0.75;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 5;
        comp.attack.value = 0.002;
        this.out.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // the rolling hush runs all the time at zero volume
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 380;
        f.Q.value = 0.5;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.out);
        src.start();
        this.rollSrc = src;
        this.rollFilt = f;
        this.rollGain = g;
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private panner(pan: number) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.out!);
    return p;
  }

  /** a decaying sine partial */
  private ping(dest: AudioNode, t: number, f: number, v: number, dur: number, type: OscillatorType = "sine", f1?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** a filtered noise burst */
  private burst(dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, v: number, dur: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  /** two balls meet: a bright, glassy click. `speed` m/s. */
  click(speed: number, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const v = Math.min(1, Math.pow(speed / 3, 0.75)) * 0.9 + 0.04;
    const t = ctx.currentTime + 0.003;
    const p = this.panner(pan);
    const k = 0.94 + Math.random() * 0.12;
    this.ping(p, t, 2950 * k, v * 0.55, 0.045);
    this.ping(p, t, 4620 * k, v * 0.32, 0.03);
    this.ping(p, t, 6880 * k, v * 0.18, 0.02);
    this.ping(p, t, 1250 * k, v * 0.16, 0.025, "triangle");
    this.burst(p, t, "highpass", 2400, 0.7, v * 0.5, 0.008);
  }

  /** a ball thumps a cushion */
  cushion(speed: number, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const v = Math.min(1, speed / 2.5) * 0.75 + 0.05;
    const t = ctx.currentTime + 0.003;
    const p = this.panner(pan);
    this.ping(p, t, 150, v * 0.9, 0.11, "sine", 70);
    this.burst(p, t, "lowpass", 700, 0.8, v * 0.6, 0.05);
    this.ping(p, t, 420, v * 0.12, 0.04, "triangle");
  }

  /** the cue's leather tip on the white */
  cue(power: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const v = 0.25 + power * 0.7;
    const t = ctx.currentTime + 0.003;
    const p = this.panner(0);
    this.ping(p, t, 1420, v * 0.45, 0.028);
    this.ping(p, t, 640, v * 0.3, 0.05, "triangle");
    this.ping(p, t, 260, v * 0.45, 0.07, "sine", 160);
    this.burst(p, t, "bandpass", 2300, 1.2, v * 0.55, 0.014);
  }

  /** a ball drops into a pocket: a hollow knock, then it rattles down the return */
  pocket(speed: number, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const v = Math.min(1, speed / 2) * 0.5 + 0.45;
    const t = ctx.currentTime + 0.003;
    const p = this.panner(pan);
    // hitting the leather / back of the pocket
    this.ping(p, t, 240, v * 0.8, 0.14, "sine", 120);
    this.burst(p, t, "bandpass", 520, 1.5, v * 0.55, 0.08);
    // falling and knocking around inside
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.11 + i * (0.075 + Math.random() * 0.05);
      const vv = v * (0.5 - i * 0.1);
      this.ping(p, tt, 880 + Math.random() * 500, vv * 0.35, 0.03, "triangle");
      this.ping(p, tt, 210 + Math.random() * 60, vv * 0.5, 0.06);
      this.burst(p, tt, "lowpass", 1400, 0.7, vv * 0.3, 0.025);
    }
  }

  /** how much is rolling right now (sum of ball speeds, m/s): the cloth hush follows it */
  rolling(sum: number) {
    if (!this.ctx || !this.rollGain || !this.rollFilt) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, sum / 4);
    this.rollGain.gain.setTargetAtTime(k * 0.22, t, 0.06);
    this.rollFilt.frequency.setTargetAtTime(260 + k * 380, t, 0.08);
  }

  dispose() {
    removeEventListener("pointerdown", this.unlock, true);
    removeEventListener("keydown", this.unlock, true);
    try {
      this.rollSrc?.stop();
    } catch {
      /* already stopped */
    }
    const c = this.ctx;
    this.ctx = null;
    if (c) setTimeout(() => void c.close().catch(() => {}), 200);
  }
}
