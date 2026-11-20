// SPIKE: the race's sound, all synthesized with WebAudio (no files): your kart's engine (pitch follows the speed,
// louder on the gas), tyre squeal while drifting (higher with each spark colour), a whoosh and a rising tone for a
// turbo, countdown beeps, bumps, landings, a crowd in the background, a cheer and a fanfare at the line, and a
// little race tune (a bright major tune on the campus, a maqam-flavoured one in the souq). A mute button is in the HUD.
export class KartAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode } | null = null;
  private squeal: { g: GainNode; f: BiquadFilterNode } | null = null;
  private crowd: GainNode | null = null;
  muted = false;
  private step = 0;
  private nextBeat = 0;

  constructor(private flavour: "major" | "hijaz") {
    const unlock = () => this.ensure();
    addEventListener("pointerdown", unlock, true);
    addEventListener("keydown", unlock, true);
  }

  private ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.out = ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.7;
      this.out.connect(comp);
      this.music = ctx.createGain();
      this.music.gain.value = 0.16;
      this.music.connect(this.out);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // engine: two detuned oscillators through a low-pass
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.value = 0;
      const o1 = ctx.createOscillator();
      o1.type = "sawtooth";
      const o2 = ctx.createOscillator();
      o2.type = "square";
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o1.connect(f);
      o2.connect(g2).connect(f);
      f.connect(g).connect(this.out);
      o1.start();
      o2.start();
      this.eng = { o1, o2, g, f };
      // tyre squeal: band-passed noise, silent until a drift
      const sq = this.loopNoise();
      const sf = ctx.createBiquadFilter();
      sf.type = "bandpass";
      sf.frequency.value = 1700;
      sf.Q.value = 6;
      const sg = ctx.createGain();
      sg.gain.value = 0;
      sq.connect(sf).connect(sg).connect(this.out);
      this.squeal = { g: sg, f: sf };
      // the crowd: soft low noise
      const cn = this.loopNoise();
      const cf = ctx.createBiquadFilter();
      cf.type = "bandpass";
      cf.frequency.value = 700;
      cf.Q.value = 0.6;
      this.crowd = ctx.createGain();
      this.crowd.gain.value = 0.05;
      cn.connect(cf).connect(this.crowd).connect(this.out);
      this.nextBeat = ctx.currentTime + 0.2;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private loopNoise() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, vol: number, sweepTo?: number, q = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** every frame: the engine follows speed and gas, the squeal follows the drift (tier -1 = none) */
  update(speed: number, gas: boolean, tier: number, racing: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.eng || !this.squeal) return;
    const t = ctx.currentTime;
    const s = Math.abs(speed);
    const base = 48 + s * 4.2;
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(base * 0.502, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(380 + s * 30 + (gas ? 300 : 0), t, 0.08);
    this.eng.g.gain.setTargetAtTime(0.07 + (gas ? 0.08 : 0.02) + s * 0.002, t, 0.08);
    this.squeal.g.gain.setTargetAtTime(tier >= 0 && s > 8 ? 0.09 : 0, t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(1500 + Math.max(0, tier) * 350, t, 0.05);
    if (racing) this.tune();
  }

  /** the race tune: a bass on the beat and a short lead phrase, scheduled a little ahead */
  private tune() {
    const ctx = this.ctx!;
    const beat = 60 / 132 / 2;
    const scale = this.flavour === "hijaz" ? [0, 1, 4, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
    const root = this.flavour === "hijaz" ? 293.66 : 329.63;
    const lead = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 7, 6, 4, 5, 4];
    const bass = [0, 0, 4, 4, 3, 3, 4, 4];
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const k = this.step++;
      const d = this.nextBeat - ctx.currentTime;
      const note = (deg: number, oct = 1) => root * oct * 2 ** (scale[((deg % 8) + 8) % 8] / 12);
      if (k % 2 === 0) this.tone(note(bass[(k / 2) % 8], 0.25), beat * 1.6, "triangle", 0.5, d, undefined, this.music!);
      if (k % 16 < 12 || k % 32 >= 16) this.tone(note(lead[k % 16]), beat * 0.9, "square", 0.18, d, undefined, this.music!);
      if (k % 4 === 2) this.burstAt(d);
      this.nextBeat += beat;
    }
  }

  /** a hi-hat on the off beat */
  private burstAt(delay: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.music!);
    src.start(t);
    src.stop(t + 0.08);
  }

  countdown(n: number) {
    this.ensure();
    if (n > 0) this.tone(440, 0.22, "square", 0.25);
    else this.tone(880, 0.5, "square", 0.3);
  }
  boost(tier: number) {
    this.burst(0.6, 600, 0.35, 3000, 0.8);
    this.tone(300 + tier * 120, 0.4, "sawtooth", 0.12, 0, 900 + tier * 200);
  }
  hop() {
    this.tone(500, 0.12, "triangle", 0.18, 0, 800);
  }
  land() {
    this.tone(90, 0.18, "sine", 0.5, 0, 45);
  }
  bump() {
    this.tone(140, 0.12, "square", 0.25, 0, 70);
    this.burst(0.12, 900, 0.2);
  }
  scrape() {
    this.burst(0.15, 2500, 0.08, 1800, 3);
  }
  splash() {
    this.burst(0.8, 900, 0.4, 300, 0.7);
  }
  lap() {
    [523, 659, 784].forEach((f, k) => this.tone(f, 0.18, "square", 0.22, k * 0.1));
    this.cheer(1.2);
  }
  finish() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, k) => this.tone(f, 0.25, "square", 0.25, k * 0.14));
    this.cheer(3);
  }
  cheer(dur: number) {
    const ctx = this.ctx;
    if (!ctx || !this.crowd) return;
    const t = ctx.currentTime;
    this.crowd.gain.cancelScheduledValues(t);
    this.crowd.gain.setValueAtTime(0.3, t);
    this.crowd.gain.exponentialRampToValueAtTime(0.05, t + dur);
  }
}
