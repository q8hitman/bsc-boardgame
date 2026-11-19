"""One headless body for every character: the 6 new poses of a template character (ahmad: plain head, nothing
hanging) with the head taken off and the neck cleaned, then each character's own art put on it:
  - the head (everything above the shirt's collar in their idle frame),
  - the collar itself (a few rows of their own shirt top, so the neck joins like their original drawing),
  - hair that hangs below the collar (connected to the head through hair colours), drawn behind the body,
  - glove colours on the hands, when their hands are not bare skin.
Usage: python headswap2.py <char> [<char> ...]"""
import sys
from collections import deque
import numpy as np
from PIL import Image

A = "../../bsc-boardgame/public/assets/football"
T = "ahmad"
# the template's fists in each pose (frame px boxes x0, y0, x1, y1), for glove colours
HANDS = {
    0: [(0, 31, 9, 42), (32, 31, 41, 42)],
    1: [(0, 29, 10, 39), (33, 31, 45, 39)],
    2: [(0, 38, 13, 48), (38, 23, 57, 31)],
    3: [(0, 28, 10, 38), (27, 29, 37, 37)],
    4: [(45, 25, 62, 35)],
    5: [(0, 6, 11, 19), (36, 6, 48, 18)],
}
# who wears gloves (checked by eye on their idle frames); everyone else keeps bare hands
GLOVED = {"haneen", "jenan", "maha", "ritaj"}
HEADX = {0: (6, 41), 1: (9, 45), 2: (0, 40), 3: (10, 47), 4: (21, 58), 5: (11, 37)}
UPRIGHT = {0: True, 1: True, 2: False, 3: True, 4: False, 5: True}


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def is_shirt(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    return (a[..., 3] > 0) & (b > r + 60) & (b > g + 30) & (r < 100) & (b > 150)


def shirt_top(a):
    # the first row of a block of 5 rows that all have shirt blue (a blue headband or bow is not that tall)
    cnt = is_shirt(a).sum(1)
    for r in range(len(cnt) - 5):
        if all(cnt[r + i] >= 4 for i in range(5)):
            return r
    return int(np.where(cnt >= 4)[0].min())


def lum(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def dark(c):
    return lum(c) < 70


tidle = load(f"{A}/{T}-blue.png")[:, :64]
t_collar = shirt_top(tidle)
t_cols = set(map(tuple, tidle[tidle[..., 3] > 0][:, :3].tolist()))

# the headless template bodies: head off (the widest run of columns above the collar), old beak painted over
bodies = []
for k in range(6):
    t = load(f"cut/{T}_{k}.png")
    th, tw = t.shape[:2]
    cy = shirt_top(t)
    above = (t[..., 3] > 0) & (np.arange(th)[:, None] < cy)
    cols = above.sum(0)
    runs, s = [], None
    for x in range(tw + 1):
        on = x < tw and cols[x] > 0
        if on and s is None:
            s = x
        if not on and s is not None:
            runs.append((s, x))
            s = None
    # the template's head columns, set by eye per pose (raised arms stay outside them)
    x0, x1 = HEADX[k]
    tcx = (x0 + x1 - 1) / 2
    body = t.copy()
    body[:cy, x0:x1] = 0
    # the old neck: in the first rows under the collar only the shirt (blue / white) stays
    for y in range(cy, min(th, cy + 3)):
        for x in range(x0, x1):
            c = body[y, x]
            if c[3] and not is_shirt(body[y:y + 1, x:x + 1])[0, 0] and not (c[0] > 200 and c[1] > 200 and c[2] > 200):
                # filled with the shirt just below when there is one (no hole under the chin), else cleared
                fill = None
                for yb in range(y + 1, min(th, y + 4)):
                    if is_shirt(body[yb:yb + 1, x:x + 1])[0, 0]:
                        fill = body[yb, x].copy()
                        break
                body[y, x] = fill if fill is not None else 0
    # anything left floating (a sliver of the old head) goes: keep the biggest connected piece
    opq = body[..., 3] > 0
    labels = np.zeros(opq.shape, int)
    sizes, n = {}, 0
    for sy, sx in zip(*np.where(opq)):
        if labels[sy, sx]:
            continue
        n += 1
        labels[sy, sx] = n
        dq = deque([(sy, sx)])
        cnt = 0
        while dq:
            y, x = dq.popleft()
            cnt += 1
            for ddy in (-1, 0, 1):
                for ddx in (-1, 0, 1):
                    ny, nx = y + ddy, x + ddx
                    if 0 <= ny < th and 0 <= nx < tw and opq[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = n
                        dq.append((ny, nx))
        sizes[n] = cnt
    # (a raised arm cut off from the body by the head's columns is a big piece too: keep pieces of 30+ pixels)
    keep = {i for i, c in sizes.items() if c >= 30}
    body[~np.isin(labels, list(keep))] = 0
    for x in range(x0, x1):
        for y in range(cy, min(th, cy + 6)):
            px = body[y, x]
            if px[3] and px[0] > 190 and 90 < px[1] < 180 and px[2] < 90:
                yb = y
                while yb < th and body[yb, x, 3] and body[yb, x, 0] > 190 and 90 < body[yb, x, 1] < 180 and body[yb, x, 2] < 90:
                    yb += 1
                body[y, x] = body[yb, x] if yb < th else 0
    # the shirt's centre just under the collar: where the new neck goes
    srow = np.where(is_shirt(body)[min(th - 1, cy + 3)])[0]
    scx = (srow.min() + srow.max()) / 2 if len(srow) else tcx
    Image.fromarray(body).save(f"cut/body_{k}.png")
    bodies.append(dict(t=t, body=body, cy=cy, x0=x0, x1=x1, scx=scx, tw=tw, th=th))

for C in sys.argv[1:]:
    idle = load(f"{A}/{C}-blue.png")[:, :64]
    op = idle[..., 3] > 0
    H, W = op.shape
    cc = shirt_top(idle)
    srow = np.where(is_shirt(idle)[cc + 3])[0]
    ccx = (srow.min() + srow.max()) / 2
    head = op & (np.arange(H)[:, None] < cc)
    # hair colours: the head's own colours that are neither dark outline nor face (taken from its top rows)
    top = np.where(head.any(1))[0].min()
    hair_cols = set(map(tuple, idle[top: top + 8][idle[top: top + 8, :, 3] > 0][:, :3].tolist()))
    hair_cols = {c for c in hair_cols if not dark(c)}
    # hanging hair: flood from the head's bottom row through hair colours (and their outline) below the collar
    hang = np.zeros_like(op)
    q = deque()
    for x in range(W):
        if head[cc - 1, x] and tuple(idle[cc - 1, x, :3].tolist()) in hair_cols:
            q.append((cc - 1, x))
    seen = set(q)
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (0, 1), (0, -1), (-1, 0)):
            ny, nx = y + dy, x + dx
            if not (cc <= ny < H and 0 <= nx < W) or (ny, nx) in seen or not op[ny, nx]:
                continue
            seen.add((ny, nx))
            if tuple(idle[ny, nx, :3].tolist()) in hair_cols and not is_shirt(idle[ny:ny + 1, nx:nx + 1])[0, 0]:
                hang[ny, nx] = True
                q.append((ny, nx))
    # their outline round the hanging hair
    pad = np.pad(hang, 1)
    near = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    for y, x in zip(*np.where(near & op & ~hang)):
        if y >= cc and dark(idle[y, x, :3]):
            hang[y, x] = True
    # glove colours: colours on the char's arms that the template's bare body does not have
    sides = np.zeros_like(op)
    sides[cc + 6: cc + 24] = True
    sides &= op & ~is_shirt(idle) & ~hang
    cand = [tuple(c) for c in idle[sides][:, :3].tolist()]
    # (not the yellow / orange family: skin, blonde hair, beak)
    yellowish = lambda c: c[0] >= c[1] >= c[2] and c[0] > 170
    glove = sorted({c for c in cand if c not in t_cols and lum(c) > 25 and not yellowish(c) and cand.count(c) >= 3}, key=lum)
    print(C, "collar", cc, "hanging hair px", int(hang.sum()), "glove colours", len(glove))

    for k, B in enumerate(bodies):
        body = B["body"].copy()
        th, tw = B["th"], B["tw"]
        # gloves: the template's skin-coloured pixels inside its fist boxes take the glove colours (by brightness)
        if C in GLOVED and len(glove) >= 2:
            for (hx0, hy0, hx1, hy1) in HANDS[k]:
                reg = body[hy0:hy1, hx0:hx1]
                m = reg[..., 3] > 0
                skin = sorted({tuple(c) for c in reg[m][:, :3].tolist() if not dark(c) and c[0] > 180 and c[1] > 140 and c[2] < 200}, key=lum)
                if not skin:
                    continue
                for i, c in enumerate(skin):
                    g = glove[min(len(glove) - 1, int(i * len(glove) / len(skin)))]
                    sel = m & np.all(reg[..., :3] == c, axis=-1)
                    reg[sel, :3] = g
        # canvas with room for the head
        pad_top = max(0, cc - B["cy"]) + 2
        dxf = B["scx"] - ccx
        pad_l = max(0, int(-dxf) + 2)
        pad_r = max(0, W - tw + 4)
        can = np.zeros((th + pad_top, tw + pad_l + pad_r, 4), np.uint8)
        can[pad_top:, pad_l:pad_l + tw] = body
        dx = int(round(dxf)) + pad_l
        dy = B["cy"] + pad_top - cc
        def put(mask, behind=False):
            for y, x in zip(*np.where(mask)):
                Y, X = y + dy, x + dx
                if 0 <= Y < can.shape[0] and 0 <= X < can.shape[1] and (not behind or can[Y, X, 3] == 0):
                    can[Y, X] = idle[y, x]
        if UPRIGHT[k]:
            put(hang, behind=True)
            # their own collar: the shirt's top rows round the neck (white collar, V, outline)
            col = np.zeros_like(op)
            span = np.where(is_shirt(idle)[cc + 2])[0]
            col[cc: cc + 3, max(0, span.min() + 2): span.max() - 1] = True
            put(col & op)
        put(head)
        # raised arms stay in front of the head (celebration)
        t = B["t"]
        for y in range(B["cy"]):
            for x in list(range(0, B["x0"])) + list(range(B["x1"], tw)):
                if t[y, x, 3]:
                    can[y + pad_top, x + pad_l] = body[y, x] if body[y, x, 3] else t[y, x]
        bb = np.where(can[..., 3] > 0)
        can = can[bb[0].min(): bb[0].max() + 1, bb[1].min(): bb[1].max() + 1]
        Image.fromarray(can).save(f"cut/{C}_{k}.png")
    fr = [Image.open(f"cut/{C}_{k}.png") for k in range(6)]
    pw = sum(f.width + 8 for f in fr)
    ph = max(f.height for f in fr)
    pv = Image.new("RGBA", (pw, ph), (40, 120, 40, 255))
    x = 0
    for f in fr:
        pv.paste(f, (x, ph - f.height), f)
        x += f.width + 8
    pv.resize((pv.width * 3, pv.height * 3), Image.NEAREST).save(f"cut/{C}_preview.png")
