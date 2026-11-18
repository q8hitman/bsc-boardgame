"""Football move poses for every club duck, made from its main strip (frame 0 = idle) so every character keeps its
own look: the two legs are cut out below the shorts (animate.split_legs) and swung / rotated as pieces round the
hip, the body is leaned by shifting rows (never rotated by odd angles, which smears pixel art). Whole-body poses
(lying down, the keeper's dive) are exact 90 degree turns, so no pixel is lost.

usage: python -I tools/pixel/moves.py public/assets/football public/assets/football/moves [id1,id2,...]
writes moves/<id>-blue.png and moves/<id>-red.png: one strip of 96x72 frames (wider than the main 64x72 so a
leg out in front or a duck on the ground fits), feet on the bottom row - 1, the standing duck centred at x = 48:
  windup, strike, pass, slidein, slide, getup, header, stagger, down, dive"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from animate import leg_zone, split_legs  # noqa: E402

FW, FH = 96, 72
MOVES = ["windup", "strike", "pass", "slidein", "slide", "getup", "header", "stagger", "down", "dive"]


def trim(img):
    ys, xs = np.where(img[..., 3] > 0)
    return img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


NECK = 17  # rows from the hip line up to the bottom of the head (the torso height on these sprites)


def shear(img, k, pivot_y):
    """lean from the hips: the torso rows shift k px per row above pivot_y (k > 0 = forward, the duck faces right);
    the head (everything above the neck) moves as one rigid block, so faces and hair never get skewed"""
    out = np.zeros_like(img)
    ys, xs = np.where(img[..., 3] > 0)
    nx = xs + np.round(k * (pivot_y - np.maximum(ys, pivot_y - NECK))).astype(int)
    ok = (nx >= 0) & (nx < img.shape[1])
    out[ys[ok], nx[ok]] = img[ys[ok], xs[ok]]
    return out


def turn(img, angle, pivot):
    """rotate a whole piece image round pivot, counter-clockwise on screen, nearest neighbour (crisp). Leg pieces are
    small, so their few-degree steps stay clean; 90 degree turns are exact."""
    if angle % 90 == 0:
        k = (angle // 90) % 4
        if k == 0:
            return img.copy()
        # exact: rotate the whole canvas about its centre, then move the pivot back where it was
        r = np.rot90(img, k).copy()
        h, w = img.shape[:2]
        cx, cy = pivot
        # where the pivot went after np.rot90 (counter-clockwise k times)
        px, py = cx, cy
        for _ in range(k):
            px, py = py, (w - 1) - px
            w, h = h, w
        out = np.zeros_like(img)
        over(out, pad_to(r, img.shape), int(round(cx - px)), int(round(cy - py)))
        return out
    M = cv2.getRotationMatrix2D((float(pivot[0]), float(pivot[1])), angle, 1.0)
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_NEAREST, borderValue=(0, 0, 0, 0))


def pad_to(img, shape):
    out = np.zeros(shape, np.uint8)
    h = min(shape[0], img.shape[0])
    w = min(shape[1], img.shape[1])
    out[:h, :w] = img[:h, :w]
    return out


def over(dst, src, dx=0, dy=0):
    ys, xs = np.where(src[..., 3] > 0)
    ny, nx = ys + dy, xs + dx
    ok = (ny >= 0) & (ny < dst.shape[0]) & (nx >= 0) & (nx < dst.shape[1])
    dst[ny[ok], nx[ok]] = src[ys[ok], xs[ok]]


def bottom(img):
    ys = np.where(img[..., 3].any(axis=1))[0]
    return ys.max() if len(ys) else 0


def moves(idle):
    spr = trim(idle)
    h, w = spr.shape[:2]
    C = 160
    big = np.zeros((C, C, 4), np.uint8)
    ox, oy = (C - w) // 2, C - 30 - h
    big[oy : oy + h, ox : ox + w] = spr
    y0 = leg_zone(spr) + oy  # first row under the shorts = the hip line
    back_m, front_m = split_legs(big, y0)
    body = big.copy()
    body[back_m | front_m] = 0

    def piece(m):
        p = np.zeros_like(big)
        p[m] = big[m]
        return p

    B, F = piece(back_m), piece(front_m)

    def hip(m):
        ys, xs = np.where(m)
        return (float(xs.mean()), float(y0))

    hb, hf = hip(back_m), hip(front_m)
    floor = oy + h - 1  # the soles' row
    cx = ox + w // 2

    def frame(parts, ground=True):
        c = np.zeros_like(big)
        for img, dx, dy in parts:
            over(c, img, dx, dy)
        if ground:
            # nothing below the soles: sit the lowest pixel on the floor row
            c2 = np.zeros_like(c)
            over(c2, c, 0, floor - bottom(c))
            c = c2
        y1 = floor + 2
        return c[y1 - FH : y1, cx - FW // 2 : cx + FW // 2]

    out = {}
    # the kick: the striking (front) leg swings back with the body leaning back a touch, then through high with
    # the body following over the ball
    out["windup"] = frame([(B, 1, 0), (shear(body, -0.1, y0), 0, 0), (turn(F, -58, hf), -1, -2)])
    out["strike"] = frame([(B, -1, 0), (turn(F, 68, hf), 2, -2), (shear(body, -0.16, y0), -1, -1)])
    # a side-foot pass: a shorter swing, upright
    out["pass"] = frame([(B, 0, 0), (turn(F, 38, hf), 1, -1), (shear(body, -0.04, y0), 0, 0)])
    # the slide tackle: going down (front leg reaching out, the body dropping back), then on the hip with the
    # leading leg straight out along the grass and the other folded under, leaning back on the arm side
    # (legs and body move together: the legs hang off the hip, which drops with the body)
    out["slidein"] = frame([(turn(B, 28, hb), -2, 4), (turn(F, 60, hf), -1, 4), (shear(body, -0.28, y0), -2, 4)])
    out["slide"] = frame([(turn(B, 100, hb), -6, 13), (turn(F, 90, hf), -1, 12), (shear(body, -0.62, y0), -3, 13)])
    # up again: a crouch with the knees bent
    out["getup"] = frame([(turn(B, -18, hb), -1, 0), (turn(F, 22, hf), 1, 0), (shear(body, 0.12, y0), 1, 3)])
    # header: legs tucked up, the body thrown forward at the ball (the scene lifts the frame for the jump)
    out["header"] = frame([(turn(B, -28, hb), -1, -3), (turn(F, 24, hf), 1, -3), (shear(body, 0.34, y0), 2, -2)], ground=False)
    # knocked off his feet: rocked back, a leg kicked up, then flat on his back on the grass
    out["stagger"] = frame([(turn(B, -10, hb), -1, 0), (turn(F, 34, hf), 2, -2), (shear(body, -0.38, y0), -3, 1)])
    whole = frame([(B, 0, 0), (F, 0, 0), (body, 0, 0)], ground=False)
    wbig = np.zeros_like(big)
    over(wbig, pad_to(whole, big.shape), cx - FW // 2, floor + 2 - FH)
    mid = (cx, floor - h // 2)  # turn round the middle of the body so the lying duck stays centred
    out["down"] = frame([(turn(wbig, 90, mid), 0, 0)])
    # the keeper's dive: stretched out flat in the air, head first (the scene moves it up / down the goal)
    out["dive"] = frame([(turn(wbig, -90, mid), 0, 0)])
    return np.concatenate([out[m] for m in MOVES], axis=1)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    if len(sys.argv) > 3 and sys.argv[3]:
        ids = sys.argv[3].split(",")
    else:
        ids = sorted({f.rsplit("-", 1)[0] for f in os.listdir(src) if f.endswith("-blue.png")})
    os.makedirs(dst, exist_ok=True)
    for id in ids:
        for team in ("blue", "red"):
            strip = np.array(Image.open(os.path.join(src, f"{id}-{team}.png")).convert("RGBA"))
            Image.fromarray(moves(strip[:, :64]), "RGBA").save(os.path.join(dst, f"{id}-{team}.png"))
        print(id, "ok")


if __name__ == "__main__":
    main()
