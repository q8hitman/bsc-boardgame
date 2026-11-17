"""Make the run / kick frames from one idle sprite: the legs below the shorts are cut out as two pieces and moved,
the body bobs. Also makes the red-team kit by re-colouring the blue kit.

usage: python -I tools/pixel/animate.py in_dir out_dir id1,id2,...
writes <id>-blue.png / <id>-red.png: one strip of frames  idle, run1, run2, run3, run4, kick  (all W x H)"""
import colorsys
import os
import sys

import cv2
import numpy as np
from PIL import Image

W, H = 64, 72  # common frame size; feet sit on the bottom row - 1
FRAMES = ["idle", "run1", "run2", "run3", "run4", "kick"]
# (back leg dx, dy), (front leg dx, dy), body bob
POSE = {
    "idle": ((0, 0), (0, 0), 0),
    "run1": ((-3, -1), (3, 0), -1),
    "run2": ((-1, 0), (1, -1), 0),
    "run3": ((3, 0), (-3, -1), -1),
    "run4": ((1, -1), (-1, 0), 0),
    "kick": ((-1, 0), (5, -3), 0),
}


def leg_zone(spr):
    """first row under the shorts: scanning up from the feet, the first row that is mostly light, unsaturated
    shorts fabric (white or cream) is the hem"""
    a = spr[..., 3] > 0
    rgb = spr[..., :3].astype(int)
    light = a & (rgb.min(axis=2) > 165) & (rgb.max(axis=2) - rgb.min(axis=2) < 60)
    h = spr.shape[0]
    for y in range(h - 1, h // 2, -1):
        if light[y].sum() >= 8:
            return y + 1
    return int(h * 0.8)


def split_legs(spr, y0):
    """the two legs = the two biggest pieces under the shorts that reach the floor. Hair ends, hands and
    braids that hang into that zone stay with the body."""
    h = spr.shape[0]
    a = (spr[..., 3] > 0).astype(np.uint8)
    a[:y0] = 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(a, connectivity=4)
    floor = [k for k in range(1, n) if st[k, cv2.CC_STAT_TOP] + st[k, cv2.CC_STAT_HEIGHT] >= h - 2]
    floor = sorted(floor, key=lambda k: st[k, cv2.CC_STAT_AREA], reverse=True)[:2]
    if len(floor) == 2:
        L, R = sorted(floor, key=lambda k: st[k, cv2.CC_STAT_LEFT])
        return lab == L, lab == R
    # the feet touch: split the floor piece down its middle
    piece = lab == floor[0] if floor else a.astype(bool)
    xs = np.where(piece.any(axis=0))[0]
    mid = (xs.min() + xs.max() + 1) // 2
    left, right = piece.copy(), piece.copy()
    left[:, mid:] = False
    right[:, :mid] = False
    return left, right


def paste(dst, src, mask, dx, dy):
    ys, xs = np.where(mask)
    ny, nx = ys + dy, xs + dx
    ok = (ny >= 0) & (ny < dst.shape[0]) & (nx >= 0) & (nx < dst.shape[1])
    dst[ny[ok], nx[ok]] = src[ys[ok], xs[ok]]


def frames(spr):
    h, w = spr.shape[:2]
    y0 = leg_zone(spr)
    back, front = split_legs(spr, y0)  # facing right: the left piece is the far leg
    body = spr.copy()
    body[back | front] = 0
    out = []
    ox, oy = (W - w) // 2, H - 1 - h
    for f in FRAMES:
        (bx, by), (fx, fy), bob = POSE[f]
        c = np.zeros((H, W, 4), np.uint8)
        tmp = np.zeros_like(c)
        # when the body bobs up, draw each leg twice so the thigh stretches instead of leaving a gap
        for extra in sorted({0, bob}):
            paste(tmp, spr, back, ox + bx, oy + by + extra)
            paste(tmp, spr, front, ox + fx, oy + fy + extra)
        bm = body[..., 3] > 0
        paste(tmp, body, bm, ox, oy + bob)
        c[:] = tmp
        out.append(c)
    return np.concatenate(out, axis=1)


KIT = {
    "blue": ["#12245E", "#1E3FA0", "#2D5FD8", "#5A8CF2"],
    "red": ["#5E0E1A", "#A01E2E", "#D8323A", "#F2675C"],
}


def _hex(h):
    return np.array([int(h[k : k + 2], 16) for k in (1, 3, 5)], np.uint8)


def kit(strip, team, keep_gloves=False):
    """every duck gets exactly the same team colours: kit pixels (blue, below the collar) are mapped onto one
    4-tone ramp by brightness. Gloves that belong to the character can be kept."""
    s = strip.copy()
    rgb = s[..., :3].astype(np.float32) / 255
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hh, ss, vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    blue = (hh > 200) & (hh < 256) & (ss > 0.40) & (s[..., 3] > 0)
    out = np.zeros_like(blue)
    for f in range(strip.shape[1] // W):
        sl = slice(f * W, (f + 1) * W)
        sub = blue[:, sl].astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
        if n <= 1:
            continue
        # the shirt = the biggest blue piece that starts below the head (a blue cap is part of the character)
        body = [k for k in range(1, n) if st[k, cv2.CC_STAT_TOP] > H * 0.4] or list(range(1, n))
        big = max(body, key=lambda k: st[k, cv2.CC_STAT_AREA])
        # kit = the shirt (biggest blue piece) + the socks (pieces low down); other blue bits are accessories
        m = lab == big
        for k in range(1, n):
            if st[k, cv2.CC_STAT_TOP] > H * 0.72:
                m |= lab == k
        out[:, sl] = m
    if keep_gloves:
        glove = ((vv > 0.88) & (hh < 219) & out).astype(np.uint8)
        out &= ~cv2.dilate(glove, np.ones((3, 3), np.uint8)).astype(bool)
    ramp = [_hex(c) for c in KIT[team]]
    tone = np.digitize(vv, [0.33, 0.58, 0.86])
    for t in range(4):
        s[out & (tone == t), :3] = ramp[t]
    return s


def main():
    src, dst, ids = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    keep_gloves = {"abdullah", "ali"}  # blue gloves are part of who they are, not the kit
    os.makedirs(dst, exist_ok=True)
    for id in ids:
        spr = np.array(Image.open(os.path.join(src, f"{id}.png")).convert("RGBA"))
        strip = frames(spr)
        if id == "zahraa":
            Image.fromarray(strip, "RGBA").save(os.path.join(dst, f"{id}-ref.png"))
            continue
        for team in ("blue", "red"):
            Image.fromarray(kit(strip, team, id in keep_gloves), "RGBA").save(os.path.join(dst, f"{id}-{team}.png"))
        print(id, "ok")


if __name__ == "__main__":
    main()
