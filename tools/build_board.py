"""Build the island board graph from the map image.

Detects the sand path by color, snaps hand-placed route waypoints onto the
path centerline, resamples them into evenly spaced tiles and writes
src/shared/board-island.json plus a preview image.

Usage: python -I tools/build_board.py [preview_out.png]
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / "public" / "assets" / "island.png"
OUT = ROOT / "src" / "shared" / "board-island.json"
SPACING = 50  # px between tile centers, in map coordinates

img = cv2.imread(str(MAP))
H, W = img.shape[:2]
ref = np.array([118, 200, 253])  # path sand color, BGR
mask = (np.abs(img.astype(int) - ref).max(axis=2) < 16).astype(np.uint8) * 255
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)

# Junctions shared between segments (map pixel coordinates).
J = {
    "TL": (522, 316),   # left lobe meets pond ring, top-left
    "TR": (1105, 322),  # pond ring meets right lobe
    "BR": (1165, 538),  # right lobe rejoins ring
    "BL": (440, 548),   # left lobe rejoins ring, bridge lands here
    "F3": (1428, 432),  # right lobe outer: fork to tower and beach
}

# Directed segments: (id, from, to, waypoints, snap)
SEGMENTS = [
    ("top", "TL", "TR", [(560, 262), (595, 236), (650, 214), (760, 200), (840, 197), (885, 222),
                          (950, 252), (1030, 270), (1075, 296)], True),
    ("rOutA", "TR", "F3", [(1170, 312), (1250, 318), (1330, 338), (1395, 372)], True),
    ("rOutB", "F3", "BR", [(1380, 470), (1300, 500), (1225, 522)], True),
    ("rIn", "TR", "BR", [(1118, 380), (1125, 440), (1145, 500)], True),
    ("bot", "BR", "BL", [(1110, 572), (1050, 606), (970, 614), (880, 604), (780, 600),
                          (680, 614), (590, 628), (520, 602), (480, 566)], True),
    ("lIn", "BL", "TL", [(425, 490), (448, 428), (488, 384)], True),
    ("lOut", "BL", "TL", [(370, 512), (295, 492), (232, 455), (208, 405), (238, 358),
                           (305, 325), (400, 306), (470, 308)], True),
    ("beach", "F3", "BL", [(1470, 440), (1515, 468), (1572, 515), (1612, 570), (1608, 635),
                            (1572, 690), (1568, 745), (1500, 778), (1400, 792), (1300, 800),
                            (1200, 782), (1100, 772), (1000, 772), (900, 782), (800, 810),
                            (700, 840), (600, 860), (500, 852), (420, 822), (330, 784),
                            (245, 758), (182, 718), (172, 676), (205, 644), (265, 616),
                            (330, 590)], True),
]


def snap(p, r=30):
    x, y = int(p[0]), int(p[1])
    x0, x1 = max(0, x - r), min(W, x + r + 1)
    y0, y1 = max(0, y - r), min(H, y + r + 1)
    win = dist[y0:y1, x0:x1]
    if win.max() < 6:  # bridge / tower: no sand nearby, keep as drawn
        return (float(x), float(y))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    # prefer the ridge of the path, penalise moving far from the waypoint
    score = win - 0.35 * np.hypot(xx - x, yy - y)
    i = np.unravel_index(np.argmax(score), score.shape)
    return (float(xx[i]), float(yy[i]))


def densify(pts, step=6):
    out = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b) / step))
        for k in range(n):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    out.append(pts[-1])
    return out


def smooth(pts, k=5):
    if len(pts) < 2 * k + 1:
        return pts
    out = []
    for i in range(len(pts)):
        lo, hi = max(0, i - k), min(len(pts), i + k + 1)
        xs = [p[0] for p in pts[lo:hi]]
        ys = [p[1] for p in pts[lo:hi]]
        out.append((sum(xs) / len(xs), sum(ys) / len(ys)))
    out[0], out[-1] = pts[0], pts[-1]
    return out


def resample(pts, spacing):
    """Evenly spaced interior points (endpoints excluded; junctions are their own nodes)."""
    seg = [math.dist(a, b) for a, b in zip(pts, pts[1:])]
    total = sum(seg)
    n = max(1, round(total / spacing))
    step = total / n
    out, acc, i, target = [], 0.0, 0, step
    while i < len(seg) and len(out) < n - 1:
        if acc + seg[i] >= target:
            t = (target - acc) / seg[i]
            a, b = pts[i], pts[i + 1]
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            target += step
        else:
            acc += seg[i]
            i += 1
    return out


nodes = []
jid = {}
for name, p in J.items():
    q = snap(p)
    jid[name] = len(nodes)
    nodes.append({"id": len(nodes), "x": round(q[0]), "y": round(q[1]), "next": [],
                  "type": "fork" if name in ("TR", "BL", "F3") else "blue", "seg": name})

for name, a, b, wps, do_snap in SEGMENTS:
    raw = [nodes[jid[a]]["x"], nodes[jid[a]]["y"]]
    pts = [tuple(raw)] + wps + [(nodes[jid[b]]["x"], nodes[jid[b]]["y"])]
    dense = densify(pts)
    if do_snap:
        dense = [dense[0]] + [snap(p, 22) for p in dense[1:-1]] + [dense[-1]]
    dense = smooth(dense, 4)
    inner = resample(dense, SPACING)
    prev = jid[a]
    for (x, y) in inner:
        nid = len(nodes)
        nodes.append({"id": nid, "x": round(x), "y": round(y), "next": [], "type": "blue", "seg": name})
        nodes[prev]["next"].append(nid)
        prev = nid
    nodes[prev]["next"].append(jid[b])

# --- remove crowded tiles near junctions -------------------------------------
MIN_GAP = 36
junction_ids = set(jid.values())
removed = set()
for n in nodes:
    if n["id"] in junction_ids:
        continue
    crowded = any(m["id"] != n["id"] and m["id"] not in removed
                  and (m["id"] in junction_ids or m["id"] < n["id"])
                  and math.dist((n["x"], n["y"]), (m["x"], m["y"])) < MIN_GAP
                  for m in nodes)
    if crowded:
        removed.add(n["id"])
        for p in nodes:
            if n["id"] in p["next"]:
                p["next"] = [x for x in p["next"] if x != n["id"]] + n["next"]
nodes = [n for n in nodes if n["id"] not in removed]
remap = {n["id"]: i for i, n in enumerate(nodes)}
for n in nodes:
    n["id"] = remap[n["id"]]
    n["next"] = [remap[x] for x in n["next"]]
jid = {k: remap[v] for k, v in jid.items()}

# --- tile types -----------------------------------------------------------
# Deterministic pattern per segment so the board is varied but reproducible.
PATTERNS = {
    "top":   "bbebrbbxbbe",
    "rOutA": "bxbeb",
    "rOutB": "brbx",
    "rIn":   "rbr",
    "bot":   "bebbrbxbebbr",
    "lIn":   "brb",
    "lOut":  "bbxbebb",
    "beach": "bxbbebxbbrbbxbebbxbbrbbxbebbxb",
}
TYPE = {"b": "blue", "r": "red", "e": "event", "x": "box", "d": "duel"}
counter = {}
for n in nodes:
    s = n["seg"]
    if s in PATTERNS:
        i = counter.get(s, 0)
        n["type"] = TYPE[PATTERNS[s][i % len(PATTERNS[s])]]
        counter[s] = i + 1

# a few duels spread around
for s, k in (("top", 5), ("bot", 8), ("beach", 14)):
    seg_nodes = [n for n in nodes if n["seg"] == s]
    if k < len(seg_nodes):
        seg_nodes[k]["type"] = "duel"

# lighthouse: beach node closest to the lighthouse door
lh = min((n for n in nodes if n["seg"] == "beach"), key=lambda n: math.dist((n["x"], n["y"]), (1520, 700)))
lh["type"] = "lighthouse"

# star spots: spread over the board, never on a fork
cands = [n for n in nodes if n["type"] in ("blue",)]
star_targets = [(700, 205), (1300, 330), (1050, 608), (300, 330), (1300, 800), (500, 850), (1600, 600)]
stars = []
for t in star_targets:
    best = min(cands, key=lambda n: math.dist((n["x"], n["y"]), t))
    if best["id"] not in stars:
        stars.append(best["id"])

SEG_LABELS = {
    "rOutA": "طريق المزرعة", "rIn": "الطريق المختصر",
    "rOutB": "طريق الصخور", "beach": "طريق المنارة",
    "lIn": "طريق البركة", "lOut": "طريق الحديقة",
}
for n in nodes:
    if len(n["next"]) > 1:
        n["choices"] = [{"to": t, "label": SEG_LABELS.get(nodes[t]["seg"], "طريق")} for t in n["next"]]
for n in nodes:
    n.pop("seg", None)

board = {
    "id": "island",
    "name": "جزيرة البط",
    "image": "assets/island-hd.jpg",
    "width": W,
    "height": H,
    "start": jid["TL"],
    "starSpots": stars,
    "nodes": nodes,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(board, ensure_ascii=False, indent=1), encoding="utf-8")

# --- preview ---------------------------------------------------------------
if len(sys.argv) > 1:
    COL = {"blue": (230, 160, 60), "red": (70, 70, 230), "event": (200, 90, 150), "box": (40, 200, 250),
           "duel": (170, 120, 250), "fork": (255, 255, 255), "lighthouse": (60, 230, 120)}
    pv = img.copy()
    for n in nodes:
        for m in n["next"]:
            cv2.arrowedLine(pv, (n["x"], n["y"]), (nodes[m]["x"], nodes[m]["y"]), (40, 40, 40), 2, tipLength=0.25)
    for n in nodes:
        cv2.circle(pv, (n["x"], n["y"]), 15, COL[n["type"]], -1)
        cv2.circle(pv, (n["x"], n["y"]), 15, (20, 20, 20), 2)
        if n["id"] in stars:
            cv2.circle(pv, (n["x"], n["y"]), 20, (0, 215, 255), 3)
    cv2.imwrite(sys.argv[1], pv)

from collections import Counter
print(len(nodes), "nodes", dict(Counter(n["type"] for n in nodes)))
