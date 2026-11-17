"""Turn a generated pixel-art character sheet (characters on flat magenta) into clean game sprites.

AI image models draw "pixel art" at a fake resolution: every art pixel is a soft ~8-16 px block. This finds the
characters, finds the real pixel grid, samples one colour per art pixel, cuts the palette down, keys out the
magenta, and writes true-resolution sprites (all on one canvas size, feet on the same baseline).

usage: python -I tools/pixel/clean_sheet.py sheet.png out_dir id1,id2,... [--cols 3] [--height 64]
"""
import argparse
import os

import numpy as np
from PIL import Image
import cv2


def key_magenta(rgb):
    """background = pixels very close to pure magenta anywhere, plus the softer magenta fringe that touches it.
    Pink bows and purple goggles are far enough from #FF00FF to survive."""
    c = rgb.astype(int)
    d = np.sqrt((c[..., 0] - 255) ** 2 + c[..., 1] ** 2 + (c[..., 2] - 255) ** 2)
    core = d < 70
    loose = (c[..., 0] > 150) & (c[..., 2] > 150) & (c[..., 1] < 0.62 * np.minimum(c[..., 0], c[..., 2])) & (d < 140)
    grown = cv2.dilate(core.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    bg = core | (loose & grown)
    return ~bg


def find_characters(fg, n):
    blob = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    k, lab, stats, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
    keep = np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1][:n] + 1
    boxes = []
    for i in keep:
        x, y, w, h = stats[i, :4]
        boxes.append((y, y + h, x, x + w))
    return boxes


def order_boxes(boxes, cols):
    boxes = sorted(boxes, key=lambda b: (b[0] + b[1]) / 2)
    rows = [boxes[i : i + cols] for i in range(0, len(boxes), cols)]
    return [b for row in rows for b in sorted(row, key=lambda b: b[2])]


def grid_scale(rgb, mask):
    """the art-pixel size: colour edges line up on a grid, so edge positions cluster at one phase mod s"""
    g = rgb.astype(float).mean(axis=2)
    ex = np.abs(np.diff(g, axis=1))
    ex[~(mask[:, 1:] & mask[:, :-1])] = 0
    col = ex.sum(axis=0)
    # the period of the edge profile = the art-pixel size (first strong autocorrelation peak, not a harmonic)
    c = col - col.mean()
    ac = np.correlate(c, c, mode="full")[len(c) - 1 :]
    ac /= ac[0] + 1e-9
    lags = np.arange(4, 40)
    peaks = [l for l in lags if ac[l] > ac[l - 1] and ac[l] >= ac[l + 1]]
    top = max(peaks, key=lambda l: ac[l])
    small = [l for l in peaks if l < top and ac[l] > 0.6 * ac[top]]
    l = small[0] if small else top
    # sub-pixel refine: the k-th harmonic sits at k*T, use the furthest clean one
    T = float(l)
    for k in (2, 3, 4, 5, 6):
        lo, hi = int(k * T - 3), int(k * T + 4)
        if hi >= len(ac):
            break
        seg = ac[lo:hi]
        T = (lo + int(np.argmax(seg))) / k
    # phase: where the edges sit modulo T
    idx = np.arange(len(col)) + 0.5
    ang = 2 * np.pi * idx / T
    phase = (np.angle((col * np.exp(1j * ang)).sum()) / (2 * np.pi) * T) % T
    best_s, best_p = T, phase
    return best_s, best_p


def sample_grid(rgb, mask, s, phase_x, phase_y):
    h, w = mask.shape
    ys = np.arange(phase_y + s / 2, h, s)
    xs = np.arange(phase_x + s / 2, w, s)
    out = np.zeros((len(ys), len(xs), 4), np.uint8)
    r = max(1, int(s * 0.3))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            y0, y1, x0, x1 = int(y) - r, int(y) + r + 1, int(x) - r, int(x) + r + 1
            m = mask[y0:y1, x0:x1]
            if m.mean() < 0.5:
                continue
            px = rgb[y0:y1, x0:x1][m]
            out[j, i, :3] = np.median(px, axis=0)
            out[j, i, 3] = 255
    return out


def quantize(img, colors):
    a = img[..., 3] > 0
    rgb = Image.fromarray(img[..., :3])
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out = np.array(q)
    return np.dstack([out, np.where(a, 255, 0).astype(np.uint8)])


def tidy(img):
    """drop lonely pixels and single-pixel specks left by the key"""
    a = img[..., 3] > 0
    n = cv2.filter2D(a.astype(np.float32), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT).round().astype(int) - a
    img[a & (n <= 1), 3] = 0
    return img


def trim(img):
    ys, xs = np.where(img[..., 3] > 0)
    return img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def run_period(img, m):
    """generated pixel art is not on a strict grid; fit the art-pixel size from the lengths of flat colour runs"""
    def runs(a, mm):
        out = []
        for y in range(0, a.shape[0], 3):
            d = (np.abs(np.diff(a[y], axis=0)).sum(1) > 45) & mm[y, 1:] & mm[y, :-1]
            pos = np.where(d)[0]
            if len(pos) < 2:
                continue
            c = [pos[0]]
            for p in pos[1:]:
                if p - c[-1] > 1:
                    c.append(p)
            out += list(np.diff(c))
        return out
    a = img.astype(int)
    r = np.array(runs(a, m) + runs(np.transpose(a, (1, 0, 2)), m.T))
    r = r[(r >= 3) & (r < 120)]
    Ts = np.arange(4, 14, 0.1)
    sc = [np.mean(np.cos(2 * np.pi * r / T)) for T in Ts]
    return float(Ts[int(np.argmax(sc))])


def palette_labels(rgb, mask, k):
    """k-means palette over the character pixels of the whole sheet"""
    px = rgb[mask].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    sample = px[np.random.default_rng(1).choice(len(px), min(len(px), 60000), replace=False)]
    _, _, centers = cv2.kmeans(sample, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    d = ((rgb.reshape(-1, 1, 3).astype(np.float32) - centers[None]) ** 2).sum(-1)
    return d.argmin(1).reshape(mask.shape), centers.astype(np.uint8)


def shirt_to_feet(rgb, mask, y0, y1, x0, x1):
    """height (sheet px) from the top of the shirt to the soles: the same for every duck, so it sets the scale"""
    crop = rgb[y0:y1, x0:x1].astype(np.float32) / 255
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    h, sat, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    shirt = ((h > 210) & (h < 250) & (sat > 0.5) & (v > 0.35)) | ((h > 40) & (h < 60) & (sat > 0.7) & (v > 0.8))
    shirt &= mask[y0:y1, x0:x1]
    n, lab, st, _ = cv2.connectedComponentsWithStats(shirt.astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    return (y1 - y0) - st[big, cv2.CC_STAT_TOP]


def mode_sample(lab, mask, centers, T, y0, x0, y1, x1):
    h = int(np.ceil((y1 - y0) / T))
    w = int(np.ceil((x1 - x0) / T))
    out = np.zeros((h, w, 4), np.uint8)
    for j in range(h):
        for i in range(w):
            ya, yb = int(y0 + j * T), int(y0 + (j + 1) * T)
            xa, xb = int(x0 + i * T), int(x0 + (i + 1) * T)
            m = mask[ya:yb, xa:xb]
            if m.mean() < 0.5:
                continue
            v = np.bincount(lab[ya:yb, xa:xb][m]).argmax()
            out[j, i, :3] = centers[v]
            out[j, i, 3] = 255
    return out


def ink_outline(img):
    """the silhouette edge is always dark ink, like hand-made sprites"""
    a = img[..., 3] > 0
    pad = np.pad(a, 1)
    edge = a & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    lum = img[..., :3].astype(int) @ np.array([3, 6, 1]) / 10
    ink = np.array([46, 24, 18], np.uint8)
    img[edge & (lum > 70), :3] = ink
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("ids")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--height", type=int, default=0, help="force this sprite height instead of the detected grid")
    ap.add_argument("--colors", type=int, default=40)
    ap.add_argument("--scale", type=float, default=0, help="art-pixel size in the sheet (default: measured)")
    ap.add_argument("--body", type=float, default=0, help="scale each duck so shirt-top-to-soles is this many pixels")
    a = ap.parse_args()
    ids = a.ids.split(",")
    im = np.array(Image.open(a.sheet).convert("RGB"))
    fg = key_magenta(im)
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    T = a.scale or run_period(im, fg)
    lab, centers = palette_labels(im, fg, a.colors)
    boxes = order_boxes(find_characters(fg, len(ids)), a.cols)
    os.makedirs(a.out, exist_ok=True)
    for id, (y0, y1, x0, x1) in zip(ids, boxes):
        if id == "-":
            continue
        t = T
        if a.body:
            hs = shirt_to_feet(im, fg, y0, y1, x0, x1)
            t = hs / a.body if hs else T
        spr = mode_sample(lab, fg, centers, t, y0, x0, y1, x1)
        spr = ink_outline(tidy(spr))
        spr = trim(spr)
        Image.fromarray(spr, "RGBA").save(os.path.join(a.out, f"{id}.png"))
        print(f"{id}: scale {t:.2f} -> {spr.shape[1]}x{spr.shape[0]}")


if __name__ == "__main__":
    main()
