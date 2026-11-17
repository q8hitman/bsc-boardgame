"""Tiny pixel-art engine: shapes are boolean masks on a small grid, layers get 3-tone shading from a top-left
light, a coloured line where a layer sits on top of another one, and a coloured outline around the silhouette.
Decals (eyes, logos) are hand-placed pixels drawn last."""
import colorsys

import numpy as np

W, H = 40, 44
# shapes are written in "logical" coordinates (the 32x40 body box); the canvas adds a margin for big hair
OX, OY = 5, 3
_yy, _xx = np.mgrid[0:H, 0:W]
_yy, _xx = _yy - OY, _xx - OX
_cx, _cy = _xx + 0.5, _yy + 0.5


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _hsv_shift(rgb, dv, ds=0.0, dh=0.0):
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + dh) % 1
    s = min(1, max(0, s + ds))
    v = min(1, max(0, v * dv))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (round(r * 255), round(g * 255), round(b * 255))


def tones(base, light=None, shade=None, line=None):
    """light / base / shade / line. Shadows lean cooler, lights warmer, the line is a deep version of the colour."""
    b = hexc(base)
    hue = colorsys.rgb_to_hsv(*(c / 255 for c in b))[0]
    # push shadows toward purple-blue, lights toward yellow (hue-shifted ramps read as hand-painted)
    cool = 0.025 if 0.12 < hue < 0.62 else -0.025
    return {
        "light": hexc(light) if light else _hsv_shift(b, 1.12, -0.10, -cool),
        "base": b,
        "shade": hexc(shade) if shade else _hsv_shift(b, 0.78, 0.10, cool),
        "line": hexc(line) if line else _hsv_shift(b, 0.42, 0.18, cool * 1.6),
    }


# ---- shapes -------------------------------------------------------------------------------------
def ell(x, y, rx, ry):
    return ((_cx - x) / rx) ** 2 + ((_cy - y) / ry) ** 2 <= 1


def circ(x, y, r):
    return ell(x, y, r, r)


def rect(x0, y0, x1, y1):
    return (_xx >= x0) & (_xx <= x1) & (_yy >= y0) & (_yy <= y1)


def poly(pts):
    """even-odd fill of a polygon, sampled at pixel centres"""
    inside = np.zeros((H, W), bool)
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cond = (y1 > _cy) != (y2 > _cy)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (x2 - x1) * (_cy - y1) / (y2 - y1 + 1e-9) + x1
        inside ^= cond & (_cx < xint)
    return inside


def above(y):
    return _yy <= y


def below(y):
    return _yy >= y


def left_of(x):
    return _xx <= x


def right_of(x):
    return _xx >= x


def shift(m, dx=0, dy=0):
    out = np.zeros_like(m)
    ys = slice(max(dy, 0), H + min(dy, 0))
    yd = slice(max(-dy, 0), H + min(-dy, 0))
    xs = slice(max(dx, 0), W + min(dx, 0))
    xd = slice(max(-dx, 0), W + min(-dx, 0))
    out[ys, xs] = m[yd, xd]
    return out


# ---- layers -------------------------------------------------------------------------------------
class Layer:
    def __init__(self, mask, t, group=None, flat=False, line=True, outline=True, rim=True, sphere=None):
        self.mask, self.t, self.group, self.flat, self.line, self.outline, self.rim = mask, t, group, flat, line, outline, rim
        self.sphere = sphere  # (cx, cy, rx, ry): round volume shading instead of edge-only


def _m(mask, x, y):
    return 0 <= x < W and 0 <= y < H and mask[y, x]


def render(layers, decals=()):
    """layers: bottom to top. decals: (x, y, rgb) drawn last. Returns an (H, W, 4) uint8 array."""
    lab = np.full((H, W), -1, int)
    for i, L in enumerate(layers):
        lab[L.mask] = i
    img = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            i = lab[y, x]
            if i < 0:
                continue
            L = layers[i]
            m = L.mask
            c = L.t["base"]
            if L.sphere and not L.flat:
                sx, sy, rx, ry = L.sphere
                nx_, ny_ = (x - OX + 0.5 - sx) / rx, (y - OY + 0.5 - sy) / ry
                lit = -0.55 * nx_ - 0.83 * ny_
                deep = _m(m, x, y + 1) and _m(m, x + 1, y) and _m(m, x + 1, y + 1)
                c = L.t["shade"] if (lit < -0.42 or not deep) else (L.t["light"] if lit > 0.62 else L.t["base"])
            elif not L.flat:
                # light from the top-left: bottom/right edges in shadow, the top-left rim catches the light
                deep = _m(m, x, y + 1) and _m(m, x, y + 2) and _m(m, x + 1, y) and _m(m, x + 1, y + 1)
                if not deep:
                    c = L.t["shade"]
                elif L.rim and (not _m(m, x, y - 1) or not _m(m, x - 1, y)) and _m(m, x + 1, y + 1):
                    c = L.t["light"]
            # selective inner line where this layer sits over a different one
            if L.line:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H:
                        j = lab[ny, nx]
                        if 0 <= j < i and (L.group is None or layers[j].group != L.group) and not layers[j].flat:
                            # two locks of the same hair part with a soft shadow, different things with a line
                            c = L.t["shade"] if layers[j].t is L.t else L.t["line"]
                            break
            img[y, x] = (*c, 255)
    # coloured outline around the whole silhouette
    out = img.copy()
    for y in range(H):
        for x in range(W):
            if lab[y, x] >= 0:
                continue
            best = -1
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and lab[ny, nx] > best and layers[lab[ny, nx]].outline:
                    best = lab[ny, nx]
            if best >= 0:
                out[y, x] = (*layers[best].t["line"], 255)
    for x, y, c in decals:
        x, y = x + OX, y + OY
        if 0 <= x < W and 0 <= y < H:
            out[y, x] = (*c, 255)
    return out


def stamp(rows, x0, y0, pal):
    """ascii decal -> list of (x, y, rgb); '.' is skipped"""
    res = []
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch != ".":
                res.append((x0 + dx, y0 + dy, pal[ch]))
    return res
