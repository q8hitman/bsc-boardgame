"""Cut the figures out of a Gemini sprite sheet (magenta background), scale them to the game's pixel size and snap
their colours to the original sprite's palette. Usage: python cut.py sheet.jpg ref_sprite.png out_prefix [stand_h]"""
import sys
from collections import deque
import numpy as np
from PIL import Image

src, refp, out = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.array(Image.open(src).convert("RGB")).astype(int)
H, W, _ = im.shape
r, g, b = im[..., 0], im[..., 1], im[..., 2]
# the background colour: the median of the border pixels (magenta or green, whatever was asked for)
border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
bgc = np.median(border, axis=0)
if bgc[0] > 150 and bgc[2] > 150 and bgc[1] < 120:
    bg = ((r > 140) & (b > 140) & (g < 130) & (abs(r - b) < 90)) | ((r - g > 75) & (b - g > 75) & (abs(r - b) < 70))
else:
    bg = ((im - bgc) ** 2).sum(-1) < 95 ** 2
print("background", bgc)
fg = ~bg

# connected components on a coarse grid (fast), then merge small bits into the nearest big one
S = 4
h2, w2 = H // S, W // S
grid = fg[: h2 * S, : w2 * S].reshape(h2, S, w2, S).any(axis=(1, 3))
lab = np.zeros((h2, w2), int)
n = 0
for y in range(h2):
    for x in range(w2):
        if grid[y, x] and not lab[y, x]:
            n += 1
            q = deque([(y, x)])
            lab[y, x] = n
            while q:
                cy, cx = q.popleft()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h2 and 0 <= nx < w2 and grid[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            q.append((ny, nx))
sizes = np.bincount(lab.ravel())
comps = []
for i in range(1, n + 1):
    if sizes[i] < 40:
        continue
    ys, xs = np.where(lab == i)
    comps.append([xs.min() * S, xs.max() * S + S, ys.min() * S, ys.max() * S + S, i, sizes[i]])
comps.sort(key=lambda c: c[0])
print("figures:", len(comps), [(c[0], c[1], c[2], c[3]) for c in comps])
if len(comps) != 6:
    print("NOT 6 FIGURES: not used")
    sys.exit(2)

# the reference: palette and standing height
ref = Image.open(refp).convert("RGBA")
fr = np.array(ref.crop((0, 0, 64, 72)))
op = fr[..., 3] > 0
ys = np.where(op.any(1))[0]
ref_h = ys.max() - ys.min() + 1
pal = np.unique(fr[op][:, :3], axis=0).astype(int)
print("ref height", ref_h, "palette", len(pal))

# scale: the first figure is a standing-ish pose; its height maps to the reference height
stand = comps[0]
scale = ref_h / (stand[3] - stand[2]) * (float(sys.argv[4]) if len(sys.argv) > 4 else 1.0)
print("scale", scale)
frames = []
for k, (x0, x1, y0, y1, i, _) in enumerate(comps):
    mask = np.zeros((H, W), bool)
    m = (lab == i)
    mask[: h2 * S, : w2 * S] = np.repeat(np.repeat(m, S, 0), S, 1)
    mask &= fg
    crop = im[y0:y1, x0:x1]
    a = mask[y0:y1, x0:x1]
    w = max(1, round((x1 - x0) * scale))
    h = max(1, round((y1 - y0) * scale))
    rgb = Image.fromarray(crop.astype(np.uint8)).resize((w, h), Image.BOX)
    al = Image.fromarray((a * 255).astype(np.uint8)).resize((w, h), Image.BOX)
    rgb = np.array(rgb).astype(int)
    al = np.array(al) > 150
    # snap to the palette
    d = ((rgb[..., None, :] - pal[None, None, :, :]) ** 2).sum(-1)
    snapped = pal[d.argmin(-1)]
    # a clean dark outline like the original art: opaque pixels on the edge that took a magenta tint become ink
    dark = pal[(pal.sum(1)).argmin()]
    pad = np.pad(al, 1)
    edge = al & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    tint = ((snapped[..., 0] - snapped[..., 1] > 30) & (snapped[..., 2] - snapped[..., 1] > 30)) if bgc[1] < 120 else ((snapped[..., 1] - snapped[..., 0] > 40) & (snapped[..., 1] - snapped[..., 2] > 40))
    snapped[edge & tint] = dark
    outp = np.zeros((h, w, 4), np.uint8)
    outp[..., :3] = snapped
    outp[..., 3] = al * 255
    frames.append(Image.fromarray(outp))
    Image.fromarray(outp).save(f"{out}_{k}.png")
# preview
pw = sum(f.width + 8 for f in frames)
ph = max(f.height for f in frames)
pv = Image.new("RGBA", (pw, ph), (40, 120, 40, 255))
x = 0
for f in frames:
    pv.paste(f, (x, ph - f.height), f)
    x += f.width + 8
pv.resize((pv.width * 4, pv.height * 4), Image.NEAREST).save(f"{out}_preview.png")
print([f.size for f in frames])
