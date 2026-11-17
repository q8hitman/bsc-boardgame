"""Extra football poses for every club duck, made from its existing strip (frame 0 = idle): the legs below the
shorts are cut out (same as animate.py) and moved / rotated, the body above the hem is sheared to lean.
An optional celebrate pose (both arms up) comes from a cleaned generated sheet.

usage: python -I tools/pixel/poses.py public/assets/football public/assets/football/extra id1,id2,... [celebrate_dir]
writes extra/<id>-blue.png and extra/<id>-red.png: one strip of 64x72 frames
  sprint1, sprint2, sprint3, sprint4, slide, trap, skill, celebrate
(celebrate_dir/<id>.png: a trimmed arms-up sprite in the blue kit; missing = the kick frame, lifted)"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from animate import kit, leg_zone, split_legs  # noqa: E402

W, H = 64, 72
FRAMES = ["sprint1", "sprint2", "sprint3", "sprint4", "slide", "trap", "skill", "celebrate"]


def trim(img):
    ys, xs = np.where(img[..., 3] > 0)
    return img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def shear_rows(img, mask, k, pivot_y):
    """lean: each row above pivot_y moves k px per row of height (k > 0 = forward / right)"""
    out = np.zeros_like(img)
    ys, xs = np.where(mask)
    nx = xs + np.round(k * (pivot_y - ys)).astype(int)
    ok = (nx >= 0) & (nx < img.shape[1])
    out[ys[ok], nx[ok]] = img[ys[ok], xs[ok]]
    return out


def rotate_piece(img, mask, angle, pivot):
    """rotate the masked piece (nearest neighbour, crisp) by `angle` degrees (counter-clockwise on screen) round pivot"""
    piece = np.zeros_like(img)
    piece[mask] = img[mask]
    M = cv2.getRotationMatrix2D((float(pivot[0]), float(pivot[1])), angle, 1.0)
    return cv2.warpAffine(piece, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_NEAREST, borderValue=(0, 0, 0, 0))


def over(dst, src, dx=0, dy=0):
    """paste src (same size as dst) shifted by dx, dy, opaque pixels only"""
    ys, xs = np.where(src[..., 3] > 0)
    ny, nx = ys + dy, xs + dx
    ok = (ny >= 0) & (ny < dst.shape[0]) & (nx >= 0) & (nx < dst.shape[1])
    dst[ny[ok], nx[ok]] = src[ys[ok], xs[ok]]


def poses(idle, cel=None):
    spr = trim(idle)
    h, w = spr.shape[:2]
    # work on a big canvas so rotated / leaned parts never clip, then crop back to 64x72 on the feet
    C = 140
    big = np.zeros((C, C, 4), np.uint8)
    ox, oy = (C - w) // 2, C - 20 - h
    big[oy : oy + h, ox : ox + w] = spr
    y0 = leg_zone(spr) + oy
    back, front = split_legs(big, y0)
    legs = back | front
    body = big.copy()
    body[legs] = 0
    bmask = body[..., 3] > 0
    floor = oy + h  # one below the soles
    def piece(m):
        p = np.zeros_like(big)
        p[m] = big[m]
        return p
    B, F = piece(back), piece(front)
    def hip(m):
        ys, xs = np.where(m)
        return (xs.mean(), ys.min())
    out = []

    def frame(parts):
        c = np.zeros_like(big)
        for img, dx, dy in parts:
            over(c, img, dx, dy)
        # crop to 64x72 with the feet on the bottom row - 1, centred on the original body
        cx = ox + w // 2
        y1 = floor + 1
        crop = c[y1 - H : y1, cx - W // 2 : cx + W // 2]
        return crop

    # sprint: forward lean, long strides, the body bobs higher
    lean = shear_rows(body, bmask, 0.1, y0)
    for (bx, by), (fx, fy), bob in [((-6, -1), (6, -2), -2), ((-2, 0), (2, -3), -1), ((6, -2), (-6, -1), -2), ((2, -3), (-2, 0), -1)]:
        parts = []
        for extra in sorted({0, bob}):
            parts += [(B, bx, by + extra), (F, fx, fy + extra)]
        parts.append((lean, -1, bob))
        out.append(frame(parts))

    # slide: leaning far back, the front leg shot out ahead
    # (the scene tips this frame back further and lowers it onto the grass)
    fh = hip(front)
    sl_body = shear_rows(body, bmask, -0.34, y0)
    out.append(frame([(B, -2, 0), (F, 4, -2), (F, 5, -3), (sl_body, -1, 0)]))

    # trap: front knee up to cushion the ball, a slight lean back
    tr_body = shear_rows(body, bmask, -0.05, y0)
    Ft = rotate_piece(big, front, 35, fh)
    out.append(frame([(B, 0, 0), (Ft, 3, -3), (tr_body, 0, -1)]))

    # skill (step-over): the front leg swings across the ball, the body sways the other way
    sk_body = shear_rows(body, bmask, -0.16, y0)
    Fs = rotate_piece(big, front, -28, fh)
    out.append(frame([(B, 3, 0), (Fs, -3, -3), (sk_body, -2, 0)]))

    # celebrate: the generated arms-up pose, feet on the floor line; else the kick frame jumping
    if cel is not None:
        cs = trim(cel)
        c = np.zeros((H, W, 4), np.uint8)
        ch, cw = cs.shape[:2]
        if ch > H - 1 or cw > W:
            k = min((H - 1) / ch, W / cw)
            cs = cv2.resize(cs, (max(1, int(cw * k)), max(1, int(ch * k))), interpolation=cv2.INTER_NEAREST)
            ch, cw = cs.shape[:2]
        c[H - 1 - ch : H - 1, (W - cw) // 2 : (W - cw) // 2 + cw] = cs
        out.append(c)
    else:
        out.append(frame([(B, -2, -2), (F, 4, -4), (body, 0, -1)]))
    return np.concatenate(out, axis=1)


def main():
    src, dst, ids = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    cel_dir = sys.argv[4] if len(sys.argv) > 4 else ""
    keep_gloves = {"abdullah", "ali"}
    os.makedirs(dst, exist_ok=True)
    for id in ids:
        cel = None
        cp = os.path.join(cel_dir, f"{id}.png") if cel_dir else ""
        if cp and os.path.exists(cp):
            cel = np.array(Image.open(cp).convert("RGBA"))
        for team in ("blue", "red"):
            strip = np.array(Image.open(os.path.join(src, f"{id}-{team}.png")).convert("RGBA"))
            c = cel
            if c is not None:
                # the same 4-tone team kit as the main strips
                c = kit(np.pad(c, ((0, max(0, H - c.shape[0])), (0, max(0, W - c.shape[1])), (0, 0))), team, id in keep_gloves)
            Image.fromarray(poses(strip[:, :W], c), "RGBA").save(os.path.join(dst, f"{id}-{team}.png"))
        print(id, "ok", "celebrate" if cel is not None else "")


if __name__ == "__main__":
    main()
