"""Temporary card art: cut one pose of a club duck out of its character sheet (tools/src-art/club/*.png).

GrabCut inside a hand-picked box, keep the figure, soften the edge, save to public/assets/cards/{slot}.png.
Replace with the ChatGPT renders (docs/card-art-prompts.md) when they arrive: just drop PNGs with the same names
into tools/src-art/club/final/ and run with --final (trims and resizes them the same way).

Usage: python -I tools/cut_club_cards.py [--final] [--preview out.jpg]
"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools/src-art/club"
OUT = ROOT / "public/assets/cards"
H_OUT = 520  # px height of the saved art

# slot: (sheet, x0, y0, x1, y1) in sheet pixels (1536x1024)
POSES = {
    "y": ("basam", 40, 335, 385, 1015),
    "skip": ("basam", 1065, 365, 1530, 1015),
    "r": ("kiraz", 25, 325, 375, 1015),
    "g": ("ahmed", 25, 335, 405, 1005),
    "b": ("abdulla", 35, 345, 415, 1015),
    "swap": ("abdulla", 1065, 400, 1525, 1015),
    "rev": ("camel", 1105, 335, 1515, 1015),
    "draw2": ("ruaa", 1065, 380, 1535, 1015),
    "wild": ("zahraa", 545, 345, 835, 1015),
    "wild4": ("zahraa", 1085, 365, 1535, 1015),
}


def trim_save(rgba: np.ndarray, slot: str):
    a = rgba[:, :, 3]
    ys, xs = np.where(a > 8)
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    k = H_OUT / rgba.shape[0]
    rgba = cv2.resize(rgba, (max(1, round(rgba.shape[1] * k)), H_OUT), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(OUT / f"{slot}.png"), rgba)
    return rgba


def cut(slot, sheet, x0, y0, x1, y1):
    img = cv2.imread(str(SRC / f"{sheet}.png"))
    crop = img[y0:y1, x0:x1].copy()
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, (6, 6, w - 12, h - 12), bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # keep the main figure (and big pieces touching its box: props held away from the body)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n > 1:
        main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = np.zeros_like(fg)
        for i in range(1, n):
            if i == main or stats[i, cv2.CC_STAT_AREA] > 0.01 * stats[main, cv2.CC_STAT_AREA]:
                keep[lab == i] = 255
        fg = keep
    # fill holes, then a slightly soft edge
    inv = cv2.bitwise_not(fg)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv)
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h and area < 0.004 * w * h:
            fg[lab == i] = 255
    alpha = cv2.GaussianBlur(fg, (0, 0), 0.9)
    rgba = np.dstack([crop, alpha])
    return trim_save(rgba, slot)


def main():
    out = []
    if "--final" in sys.argv:
        for slot in list(POSES) + ["back"]:
            p = SRC / "final" / f"{slot}.png"
            if p.exists():
                out.append(trim_save(cv2.imread(str(p), cv2.IMREAD_UNCHANGED), slot))
                print("final", slot)
    else:
        for slot, args in POSES.items():
            out.append(cut(slot, *args))
            print("cut", slot)
    if "--preview" in sys.argv:
        tiles = []
        for r in out:
            bg = np.full((H_OUT, 420, 3), (235, 220, 250), np.uint8)
            w = min(r.shape[1], 420)
            r = r[:, :w]
            a = r[:, :, 3:4] / 255.0
            x = (420 - w) // 2
            bg[:, x:x + w] = (bg[:, x:x + w] * (1 - a) + r[:, :, :3] * a).astype(np.uint8)
            tiles.append(bg)
        while len(tiles) % 5:
            tiles.append(np.full_like(tiles[0], 255))
        rows = [np.hstack(tiles[i:i + 5]) for i in range(0, len(tiles), 5)]
        cv2.imwrite(sys.argv[sys.argv.index("--preview") + 1], np.vstack(rows))


main()
