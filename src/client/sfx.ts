// Tiny synthesized sound effects (placeholders until real SFX files are added).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", delay = 0, vol = 1, slideTo?: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, delay = 0, vol = 0.4) {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(f).connect(g).connect(master);
  src.start(ctx.currentTime + delay);
}

export const sfx = {
  hop: () => tone(520 + Math.random() * 120, 0.09, "triangle", 0, 0.6, 820),
  land: () => tone(180, 0.12, "sine", 0, 0.7, 90),
  coin: () => {
    tone(988, 0.08, "square", 0, 0.25);
    tone(1319, 0.22, "square", 0.08, 0.25);
  },
  bad: () => {
    tone(330, 0.18, "sawtooth", 0, 0.3, 220);
    tone(220, 0.3, "sawtooth", 0.16, 0.3, 110);
  },
  dice: () => {
    for (let i = 0; i < 7; i++) noise(0.05, i * 0.09, 0.5);
  },
  pop: () => tone(660, 0.12, "triangle", 0, 0.6, 1320),
  whoosh: () => noise(0.4, 0, 0.35),
  star: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, "triangle", i * 0.08, 0.45)),
  fanfare: () => [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, "square", i * 0.12, 0.18)),
  tick: () => tone(1200, 0.04, "square", 0, 0.15),
  climb: () => [523, 587, 659, 698, 784, 880, 988, 1047].forEach((f, i) => tone(f, 0.1, "triangle", i * 0.17, 0.45)),
  slide: () => {
    tone(1100, 1.6, "sawtooth", 0, 0.16, 140);
    noise(1.2, 0.1, 0.12);
  },
  card: () => {
    noise(0.07, 0, 0.45);
    tone(900, 0.05, "triangle", 0.02, 0.25, 500);
  },
  deal: () => {
    for (let i = 0; i < 10; i++) noise(0.045, i * 0.07, 0.3);
  },
  quack: () => {
    tone(520, 0.13, "sawtooth", 0, 0.22, 380);
    tone(560, 0.17, "sawtooth", 0.16, 0.22, 360);
  },
  caught: () => [880, 660, 440].forEach((f, i) => tone(f, 0.14, "square", i * 0.1, 0.2)),
  magic: () => [660, 880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.18, "sine", i * 0.05, 0.3)),
  event: () => [300, 450, 300, 600].forEach((f, i) => tone(f, 0.15, "sawtooth", i * 0.1, 0.18)),
};
