/** Bowling sounds synthesized with WebAudio (no files): the rumble of a rolling ball and the crash of pins. */
export class BowlingAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private unlock = () => this.ensure();
  private rolls = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode; pan: StereoPannerNode }>();

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
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.7;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.out.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) {
          // brownish noise for the rumble, white enough for clacks once filtered
          const w = Math.random() * 2 - 1;
          b = (b + 0.04 * w) / 1.04;
          d[i] = w * 0.55 + b * 6;
        }
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Start the rolling rumble on a lane. `pan` -1..1, `vol` 0..1. */
  rollStart(lane: number, pan: number, vol: number) {
    const ctx = this.ensure();
    if (!ctx || !this.noise || !this.out) return;
    this.rollStop(lane, 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 220;
    filt.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.5 * vol, ctx.currentTime + 0.25);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filt).connect(gain).connect(p).connect(this.out);
    src.start(0, Math.random());
    this.rolls.set(lane, { src, gain, filt, pan: p });
  }

  /** Follow the ball: louder and brighter as it gets closer to the pins (`k` 0..1), muffled in the gutter. */
  rollUpdate(lane: number, k: number, gutter: boolean) {
    const r = this.rolls.get(lane);
    if (!r || !this.ctx) return;
    const t = this.ctx.currentTime;
    r.filt.frequency.setTargetAtTime(gutter ? 160 : 200 + k * 260, t, 0.08);
    r.gain.gain.setTargetAtTime((gutter ? 0.32 : 0.42) + k * 0.25, t, 0.1);
  }

  rollStop(lane: number, fade = 0.25) {
    const r = this.rolls.get(lane);
    if (!r || !this.ctx) return;
    this.rolls.delete(lane);
    const t = this.ctx.currentTime;
    r.gain.gain.cancelScheduledValues(t);
    r.gain.gain.setValueAtTime(r.gain.gain.value, t);
    r.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    r.src.stop(t + fade + 0.05);
  }

  /** Pins crashing: a heavy thump and a cascade of wooden clacks. `power` 0..1 = how many pins went. */
  crash(power: number, pan: number) {
    const ctx = this.ensure();
    if (!ctx || !this.noise || !this.out) return;
    const t0 = ctx.currentTime + 0.01;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.out);
    // thump
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(48, t0 + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.9 * (0.5 + power * 0.5), t0 + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    o.connect(og).connect(p);
    o.start(t0);
    o.stop(t0 + 0.32);
    // clacks
    const n = 4 + Math.round(power * 16);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.pow(Math.random(), 1.6) * (0.25 + power * 0.65);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900 + Math.random() * 2600;
      bp.Q.value = 4 + Math.random() * 6;
      const g = ctx.createGain();
      const v = (0.35 + Math.random() * 0.65) * (i < 3 ? 1 : 0.7);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * 1.6, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.07);
      src.connect(bp).connect(g).connect(p);
      src.start(t, Math.random() * 1.5, 0.15);
      // the hollow "tok" of a pin
      const k = ctx.createOscillator();
      k.type = "triangle";
      k.frequency.value = 520 + Math.random() * 700;
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.002);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      k.connect(kg).connect(p);
      k.start(t);
      k.stop(t + 0.08);
    }
  }

  dispose() {
    removeEventListener("pointerdown", this.unlock, true);
    removeEventListener("keydown", this.unlock, true);
    for (const k of [...this.rolls.keys()]) this.rollStop(k, 0.05);
    const c = this.ctx;
    this.ctx = null;
    if (c) setTimeout(() => void c.close().catch(() => {}), 200);
  }
}
