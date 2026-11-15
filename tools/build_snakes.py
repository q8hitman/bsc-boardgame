"""Build the snakes & ladders board from the painted art (tools/src-art/snakes-original.webp).

- Grid lines were measured from the image (strong edge peaks), 10x10, numbered boustrophedon:
  cell 1 bottom-left (compass), cell 100 top-left (crown).
- Snakes and DNA ladders were read off the art; each snake has a hand-traced body path (head -> tail)
  so a piece can slide along the painted body instead of a straight line.
- Also writes the 2x upscaled art the game loads, and a debug overlay.

Usage: python -I tools/build_snakes.py [--debug out.png]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools/src-art/snakes-original.webp"
OUT_JSON = ROOT / "src/shared/board-snakes.json"
OUT_IMG = ROOT / "public/assets/snakes-hd.jpg"

X = [364, 462, 557, 649, 743, 836, 932, 1023, 1115, 1210, 1309]  # vertical grid lines
Y = [23, 115, 204, 293, 380, 470, 559, 648, 735, 820, 911]       # horizontal grid lines


def cell_xy(n):
    """Centre of cell n (1..100) in image pixels."""
    r = (n - 1) // 10              # row from the bottom
    k = (n - 1) % 10
    c = k if r % 2 == 0 else 9 - k  # boustrophedon
    row_top = 9 - r
    return (X[c] + X[c + 1]) / 2, (Y[row_top] + Y[row_top + 1]) / 2


LADDERS = [(12, 32), (19, 39), (33, 53), (45, 65), (62, 82), (71, 91), (75, 95)]
# snake head cell -> tail cell, with the painted body traced head -> tail
SNAKES = [
    (98, 64, [(620, 76), (668, 72), (700, 96), (684, 130), (650, 158), (646, 190), (676, 212), (726, 232), (724, 268), (698, 298), (700, 334)]),
    (87, 54, [(1004, 160), (1050, 140), (1092, 160), (1090, 205), (1048, 236), (1004, 270), (998, 306), (1012, 338), (994, 372), (984, 408)]),
    (69, 50, [(1166, 286), (1198, 318), (1226, 352), (1238, 392), (1226, 428), (1232, 462), (1254, 490), (1262, 516)]),
    (61, 40, [(430, 346), (404, 372), (410, 402), (452, 422), (484, 452), (470, 490), (440, 516), (426, 552), (420, 578), (414, 602)]),
    (43, 17, [(632, 546), (592, 548), (578, 578), (600, 612), (622, 642), (644, 672), (666, 702), (680, 734), (674, 764), (684, 800)]),
    (46, 26, [(900, 514), (934, 514), (932, 544), (900, 566), (856, 578), (836, 604), (854, 632), (878, 652), (870, 680), (856, 704)]),
    (27, 7, [(984, 680), (962, 702), (986, 736), (1030, 756), (1048, 786), (1030, 816), (1006, 846), (1004, 880)]),
]

nodes = []
for n in range(1, 101):
    x, y = cell_xy(n)
    nodes.append({"id": n - 1, "x": round(x), "y": round(y), "next": [n] if n < 100 else [], "type": "blue"})

jumps = []
for a, b in LADDERS:
    ax, ay = cell_xy(a)
    bx, by = cell_xy(b)
    jumps.append({"from": a - 1, "to": b - 1, "kind": "ladder", "path": [[round(ax), round(ay)], [round(bx), round(by)]]})
for a, b, body in SNAKES:
    # start at the head cell centre, follow the body, end at the tail cell centre
    ax, ay = cell_xy(a)
    bx, by = cell_xy(b)
    path = [[round(ax), round(ay)]] + [[x, y] for x, y in body] + [[round(bx), round(by)]]
    jumps.append({"from": a - 1, "to": b - 1, "kind": "snake", "path": path})

froms = [j["from"] for j in jumps]
assert len(set(froms)) == len(froms), "two jumps start on the same cell"
assert not ({j["to"] for j in jumps} & set(froms)), "a jump lands on another jump's start"

board = {
    "id": "snakes",
    "name": "الحية والدرج",
    "mode": "race",
    "image": "assets/snakes-hd.jpg",
    "width": 1672,
    "height": 941,
    "start": 0,
    "starSpots": [],
    "nodes": nodes,
    "jumps": jumps,
    "cell": [round((X[-1] - X[0]) / 10), round((Y[-1] - Y[0]) / 10)],
}
OUT_JSON.write_text(json.dumps(board, ensure_ascii=False, indent=1), encoding="utf-8")

# 2x Lanczos upscale + gentle unsharp, same treatment as the island art
img = cv2.imread(str(SRC))
big = cv2.resize(img, (img.shape[1] * 2, img.shape[0] * 2), interpolation=cv2.INTER_LANCZOS4)
blur = cv2.GaussianBlur(big, (0, 0), 2.0)
sharp = cv2.addWeighted(big, 1.45, blur, -0.45, 0)
cv2.imwrite(str(OUT_IMG), sharp, [cv2.IMWRITE_JPEG_QUALITY, 90])

if "--debug" in sys.argv:
    dbg = img.copy()
    for j in jumps:
        pts = np.array(j["path"], np.int32)
        cv2.polylines(dbg, [pts], False, (0, 0, 255) if j["kind"] == "snake" else (255, 0, 0), 3)
        cv2.circle(dbg, tuple(pts[0]), 7, (0, 200, 0), -1)
        cv2.circle(dbg, tuple(pts[-1]), 7, (0, 0, 0), -1)
    for nd in nodes:
        cv2.putText(dbg, str(nd["id"] + 1), (nd["x"] - 10, nd["y"] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (120, 0, 120), 1)
    cv2.imwrite(sys.argv[sys.argv.index("--debug") + 1], dbg)
print("ok", len(nodes), "cells", len(jumps), "jumps")
