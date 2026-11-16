// Sound effects: real recordings (Kenney CC0 packs, built by tools/build_sfx.py into public/assets/sfx).
// Every sound has 1+ variations picked at random. Until a file is loaded, a small synthesized stand-in plays.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** name -> number of files (public/assets/sfx/<name><i>.mp3) */
const FILES: Record<string, number> = {
  dice: 4, hop: 5, land: 3, coin: 3, bad: 1, pop: 2, whoosh: 2, star: 1, fanfare: 1, tick: 1,
  climb: 1, slide: 1, event: 1, card: 3, deal: 1, caught: 1, magic: 1, click: 2,
};
const buffers = new Map<string, AudioBuffer[]>();
const lastPick = new Map<string, number>();

function loadAll() {
  if (!ctx) return;
  for (const [name, n] of Object.entries(FILES)) {
    Promise.all(
      Array.from({ length: n }, (_, i) =>
        fetch(`assets/sfx/${name}${i}.mp3`)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx!.decodeAudioData(b)),
      ),
    )
      .then((list) => buffers.set(name, list))
      .catch(() => {});
  }
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    loadAll();
  } catch {
    ctx = null;
  }
}

/** Play a recorded sound; false when it isn't loaded (caller falls back to the synth). */
function sample(name: string, vol = 1, rate = 1, delay = 0): boolean {
  const list = buffers.get(name);
  if (!ctx || !master || !list?.length) return false;
  // never the same variation twice in a row
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPick.get(name)) i = (i + 1) % list.length;
  lastPick.set(name, i);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = list[i];
  src.playbackRate.value = rate;
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
  return true;
}
const jitter = (a: number) => 1 + (Math.random() - 0.5) * a;

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

// synth stand-ins (quiet), used only until the files are loaded
const synth = {
  hop: () => tone(520 + Math.random() * 120, 0.09, "triangle", 0, 0.3, 820),
  land: () => tone(180, 0.12, "sine", 0, 0.4, 90),
  coin: () => {
    tone(988, 0.08, "square", 0, 0.12);
    tone(1319, 0.22, "square", 0.08, 0.12);
  },
  bad: () => tone(330, 0.3, "sawtooth", 0, 0.15, 160),
  dice: () => {
    for (let i = 0; i < 7; i++) noise(0.05, i * 0.09, 0.3);
  },
  pop: () => tone(660, 0.12, "triangle", 0, 0.3, 1320),
  star: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "triangle", i * 0.08, 0.25)),
};

export const sfx = {
  hop: () => sample("hop", 0.55, jitter(0.15)) || synth.hop(),
  land: () => sample("land", 0.8, jitter(0.1)) || synth.land(),
  coin: () => sample("coin", 0.9, jitter(0.1)) || synth.coin(),
  bad: () => sample("bad") || synth.bad(),
  dice: () => sample("dice", 1, jitter(0.08)) || synth.dice(),
  pop: () => sample("pop", 0.9, jitter(0.1)) || synth.pop(),
  whoosh: () => sample("whoosh", 0.8, 0.9) || noise(0.4, 0, 0.2),
  star: () => sample("star") || synth.star(),
  fanfare: () => sample("fanfare") || synth.star(),
  tick: () => sample("tick", 0.6, jitter(0.2)) || tone(1200, 0.04, "square", 0, 0.1),
  climb: () => sample("climb") || synth.star(),
  slide: () => sample("slide") || tone(1100, 1.2, "sawtooth", 0, 0.1, 140),
  event: () => sample("event") || synth.star(),
  card: () => sample("card", 1, jitter(0.12)) || noise(0.07, 0, 0.3),
  deal: () => sample("deal") || synth.dice(),
  // no recorded duck in the packs: a short two-note quack
  quack: () => {
    tone(520, 0.13, "sawtooth", 0, 0.22, 380);
    tone(560, 0.17, "sawtooth", 0.16, 0.22, 360);
  },
  caught: () => sample("caught") || synth.bad(),
  magic: () => sample("magic") || synth.star(),
  click: () => sample("click", 0.6) || tone(900, 0.03, "square", 0, 0.08),
};
