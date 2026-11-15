"""Trim Blender renders so the game can place them predictably.

tokens: one shared crop box for all 8 pieces (same anchor point for every piece).
icons:  each icon trimmed to a centered square.

Usage: python -I tools/crop_assets.py
"""
import glob
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def bbox(im):
    return im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()


tokens = sorted(glob.glob(str(ROOT / "public/assets/tokens/token*.png")))
if tokens:
    boxes = [bbox(Image.open(p)) for p in tokens]
    l = min(b[0] for b in boxes) - 4
    t = min(b[1] for b in boxes) - 4
    r = max(b[2] for b in boxes) + 4
    b = max(bx[3] for bx in boxes) + 4
    for p in tokens:
        Image.open(p).crop((l, t, r, b)).save(p, optimize=True)
    print("tokens", (r - l, b - t))

for p in glob.glob(str(ROOT / "public/assets/icons/*.png")):
    im = Image.open(p)
    l, t, r, b = bbox(im)
    s = max(r - l, b - t) + 8
    cx, cy = (l + r) // 2, (t + b) // 2
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.alpha_composite(im.crop((cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s)))
    out.save(p, optimize=True)
print("icons done")
