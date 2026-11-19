"""Put the cut Gemini frames into a character's moves / extra strips (blue), aligned to the old frames (same bottom,
same centre), and make the red kit by mapping blue-kit colours to red-kit colours (learnt from the two base strips).
Usage: python place.py <char> <prefix> <assets dir>"""
import sys
import numpy as np
from PIL import Image

char, pre, A = sys.argv[1], sys.argv[2], sys.argv[3]
# frame index of the cut sheet -> (strip, frame, frame width)
PLAN = {0: [("extra", 5, 64)], 1: [("moves", 3, 96)], 2: [("moves", 4, 96), ("extra", 4, 64)], 3: [("moves", 1, 96)], 4: [("moves", 9, 96)], 5: [("extra", 7, 64)]}


def bbox(a):
    ys, xs = np.where(a[..., 3] > 0)
    return xs.min(), xs.max(), ys.min(), ys.max()


# blue -> red colour map from the base strips (same art, other kit)
bb = np.array(Image.open(f"{A}/{char}-blue.png").convert("RGBA"))
rb = np.array(Image.open(f"{A}/{char}-red.png").convert("RGBA"))
cmap = {}
votes = {}
for c1, c2 in zip(bb.reshape(-1, 4), rb.reshape(-1, 4)):
    if c1[3] == 0:
        continue
    k = tuple(c1[:3])
    votes.setdefault(k, {}).setdefault(tuple(c2[:3]), 0)
    votes[k][tuple(c2[:3])] += 1
for k, v in votes.items():
    cmap[k] = max(v, key=v.get)
print("colour map", len(cmap), "changed", sum(1 for k, v in cmap.items() if k != v))

for team in ("blue", "red"):
    strips = {s: np.array(Image.open(f"{A}/{s}/{char}-{team}.png").convert("RGBA")) for s in ("moves", "extra")}
    for k, targets in PLAN.items():
        f = np.array(Image.open(f"{pre}_{k}.png").convert("RGBA"))
        if team == "red":
            f = f.copy()
            for y in range(f.shape[0]):
                for x in range(f.shape[1]):
                    if f[y, x, 3]:
                        f[y, x, :3] = cmap.get(tuple(f[y, x, :3]), tuple(f[y, x, :3]))
        fx0, fx1, fy0, fy1 = bbox(f)
        f = f[fy0 : fy1 + 1, fx0 : fx1 + 1]
        h, w = f.shape[:2]
        for s, idx, fw in targets:
            st = strips[s]
            old = st[:, idx * fw : (idx + 1) * fw].copy()
            ox0, ox1, oy0, oy1 = bbox(old)
            cx = (ox0 + ox1) / 2
            x = int(round(cx - w / 2))
            y = oy1 + 1 - h
            x = max(0, min(fw - w, x))
            y = max(0, min(72 - h, y))
            new = np.zeros_like(old)
            new[y : y + h, x : x + w] = f
            st[:, idx * fw : (idx + 1) * fw] = new
    for s, st in strips.items():
        Image.fromarray(st).save(f"{A}/{s}/{char}-{team}.png")
print("ok")
