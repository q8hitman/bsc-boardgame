"""Characters Gemini won't draw: take a finished character's new poses (same kit, same body) and put this character's
own head (and hair hanging behind, e.g. a braid) from their original idle frame on top. Pure pixel work on the
user's own art. Usage: python headswap.py <template char> <char> <collar row in char idle> [braid: x_max y_max]"""
import sys
import numpy as np
from PIL import Image

T, C = sys.argv[1], sys.argv[2]
collar_c = int(sys.argv[3])
braid = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else None
A = "../../bsc-boardgame/public/assets/football"

idle = np.array(Image.open(f"{A}/{C}-blue.png").convert("RGBA"))[:, :64]
op = idle[..., 3] > 0
H, W = op.shape
yy, xx = np.mgrid[:H, :W]
head_m = op & (yy < collar_c)
braid_m = op & (yy >= collar_c) & (xx <= braid[0]) & (yy <= braid[1]) if braid else np.zeros_like(op)
hx = np.where(head_m.any(0))[0]
head_cx = (hx.min() + hx.max()) / 2
print("head cols", hx.min(), hx.max(), "centre", head_cx)


def shirt_top(a):
    """topmost row with shirt blue (b well above r and g)"""
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    m = (a[..., 3] > 0) & (b > r + 60) & (b > g + 30) & (r < 100) & (b > 150)
    rows = np.where(m.sum(1) >= 2)[0]
    return rows.min()


# which template frames keep the braid (upright ones), and the template's head columns where arms are near the head
UPRIGHT = {0: True, 1: True, 2: False, 3: True, 4: False, 5: True}
for k in range(6):
    t = np.array(Image.open(f"cut/{T}_{k}.png").convert("RGBA"))
    th, tw = t.shape[:2]
    cy = shirt_top(t)
    # the template's head: everything above its collar in the columns of the biggest blob there
    above = (t[..., 3] > 0) & (np.mgrid[:th, :tw][0] < cy)
    cols = above.sum(0)
    # the head is the widest run of columns with pixels above the collar (raised arms are separate runs)
    runs, s = [], None
    for x in range(tw + 1):
        on = x < tw and cols[x] > 0
        if on and s is None:
            s = x
        if not on and s is not None:
            runs.append((s, x))
            s = None
    run = max(runs, key=lambda r: sum(cols[r[0]:r[1]]))
    x0, x1 = run
    tcx = (x0 + x1 - 1) / 2
    # raised arms joined to the head (celebration): only the head's own width round the middle is the head
    if x1 - x0 > 36:
        x0, x1 = int(round(tcx - 15)), int(round(tcx + 16))
    out = t.copy()
    out[:cy, x0:x1] = 0
    # the old beak hanging over the collar: paint it over with the shirt below it
    for x in range(x0, x1):
        for y in range(cy, min(th, cy + 6)):
            px = out[y, x]
            if px[3] and px[0] > 190 and 90 < px[1] < 180 and px[2] < 90:
                yb = y
                while yb < th and out[yb, x, 3] and out[yb, x, 0] > 190 and 90 < out[yb, x, 1] < 180 and out[yb, x, 2] < 90:
                    yb += 1
                out[y, x] = out[yb, x] if yb < th else 0
    # canvas big enough for the new head
    pad_top = max(0, collar_c - cy)
    pad_l = max(0, int(-(tcx - head_cx)) + 2)
    pad_r = max(0, W - tw + 4)
    can = np.zeros((th + pad_top, tw + pad_l + pad_r, 4), np.uint8)
    can[pad_top:, pad_l:pad_l + tw] = out
    dx = int(round(tcx + pad_l - head_cx))
    dy = cy + pad_top - collar_c
    # braid first, only where the body is not (it hangs behind)
    if braid and UPRIGHT[k]:
        ys, xs = np.where(braid_m)
        for y, x in zip(ys, xs):
            Y, X = y + dy, x + dx
            if 0 <= Y < can.shape[0] and 0 <= X < can.shape[1] and can[Y, X, 3] == 0:
                can[Y, X] = idle[y, x]
    ys, xs = np.where(head_m)
    for y, x in zip(ys, xs):
        Y, X = y + dy, x + dx
        if 0 <= Y < can.shape[0] and 0 <= X < can.shape[1]:
            can[Y, X] = idle[y, x]
    # raised arms (outside the head's columns, above the collar) stay in front of the new head
    for y in range(cy):
        for x in list(range(0, x0)) + list(range(x1, tw)):
            if t[y, x, 3]:
                can[y + pad_top, x + pad_l] = t[y, x]
    bb = np.where(can[..., 3] > 0)
    can = can[bb[0].min(): bb[0].max() + 1, bb[1].min(): bb[1].max() + 1]
    Image.fromarray(can).save(f"cut/{C}_{k}.png")
    print(k, "collar", cy, "head cols", x0, x1, "->", can.shape[1], can.shape[0])
# preview
fr = [Image.open(f"cut/{C}_{k}.png") for k in range(6)]
pw = sum(f.width + 8 for f in fr)
ph = max(f.height for f in fr)
pv = Image.new("RGBA", (pw, ph), (40, 120, 40, 255))
x = 0
for f in fr:
    pv.paste(f, (x, ph - f.height), f)
    x += f.width + 8
pv.resize((pv.width * 4, pv.height * 4), Image.NEAREST).save(f"cut/{C}_preview.png")
