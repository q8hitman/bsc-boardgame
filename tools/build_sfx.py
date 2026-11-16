"""Real sound effects for the game, picked from Kenney's CC0 audio packs (kenney.nl):
Casino Audio, Interface Sounds, Impact Sounds, Music Jingles.

Unzip the packs' .ogg files into one folder with sub-folders casino/ interface/ impact/ jingles/
(jingles named "<Set>_jingles__jingles_XXX.ogg"), then:

    python -I tools/build_sfx.py <that folder>

Writes public/assets/sfx/<name><n>.mp3 (mono, loudness-matched, trimmed). Needs ffmpeg on PATH.
src/client/sfx.ts plays them, several files per sound = picked at random so repeats don't sound robotic.
"""
import subprocess
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public/assets/sfx"

# name: ([files], max seconds or None, loudness target LUFS)
SOUNDS = {
    "dice": (["casino/dice-throw-1.ogg", "casino/dice-throw-2.ogg", "casino/dice-throw-3.ogg", "casino/die-throw-2.ogg"], None, -16),
    "hop": ([f"impact/footstep_grass_00{i}.ogg" for i in range(5)], 0.28, -22),
    "land": (["impact/impactSoft_medium_000.ogg", "impact/impactSoft_medium_001.ogg", "impact/impactSoft_medium_002.ogg"], None, -18),
    "coin": (["casino/chips-collide-1.ogg", "casino/chips-collide-2.ogg", "casino/chips-collide-3.ogg"], None, -16),
    "bad": (["jingles/Pizzicato_jingles__jingles_PIZZI14.ogg"], None, -16),
    "pop": (["interface/drop_002.ogg", "interface/drop_003.ogg"], None, -18),
    "whoosh": (["casino/card-slide-1.ogg", "casino/card-slide-2.ogg"], None, -18),
    "star": (["jingles/Sax_jingles__jingles_SAX02.ogg"], None, -15),
    "fanfare": (["jingles/Steel_jingles__jingles_STEEL02.ogg"], None, -14),
    "tick": (["interface/tick_004.ogg"], None, -22),
    "climb": (["jingles/8-Bit_jingles__jingles_NES12.ogg"], None, -17),
    "slide": (["jingles/8-Bit_jingles__jingles_NES11.ogg"], None, -17),
    "event": (["jingles/Hit_jingles__jingles_HIT11.ogg"], None, -16),
    "card": (["casino/card-place-1.ogg", "casino/card-place-2.ogg", "casino/card-place-4.ogg"], 0.5, -16),
    "deal": (["casino/card-fan-1.ogg"], None, -16),
    "caught": (["interface/error_006.ogg"], None, -16),
    "magic": (["interface/glass_004.ogg"], None, -16),
    "click": (["interface/select_001.ogg", "interface/select_002.ogg"], None, -20),
}

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.mp3"):
    old.unlink()
for name, (files, cut, lufs) in SOUNDS.items():
    for i, f in enumerate(files):
        af = [f"loudnorm=I={lufs}:TP=-1.5:LRA=11"]
        if cut:
            af.insert(0, f"atrim=0:{cut},afade=t=out:st={max(0, cut - 0.08)}:d=0.08")
        dst = OUT / f"{name}{i}.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(SRC / f), "-ac", "1", "-ar", "44100", "-af", ",".join(af),
                        "-b:a", "96k", str(dst)], check=True)
    print(name, len(files))
