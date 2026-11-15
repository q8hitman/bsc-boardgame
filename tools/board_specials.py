"""Place the special tiles (shops, wheel of fortune, map landmarks) on the island board.

Run after tools/build_board.py:  python -I tools/board_specials.py
Nodes are picked by position (nearest node to a point in map-image pixels), so this keeps working
if the path is regenerated. Landmark warps also point at the node nearest a position.
"""
import json
import math
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "src/shared/board-island.json"
b = json.loads(P.read_text(encoding="utf-8"))
nodes = b["nodes"]


def near(x, y):
    return min(nodes, key=lambda n: math.dist((n["x"], n["y"]), (x, y)))


# reset earlier runs
for n in nodes:
    if n["type"] in ("shop", "wheel", "landmark"):
        n["type"] = "blue"
    for k in ("landmark", "warpTo", "shopName"):
        n.pop(k, None)

SHOPS = [((427, 308), "دكان الشجرة"), ((1203, 335), "سوق المزرعة")]
WHEELS = [(222, 407), (1029, 253), (787, 841)]
# landmark, tile position, warp target position (None = stays)
LANDMARKS = [
    ("cave", (838, 200), (1147, 455)),       # tunnel under the hill to the dock side
    ("boat", (1130, 408), (444, 431)),       # row across the pond
    ("zipline", (1497, 459), (1088, 608)),   # from the tower down to the pole
    ("waterfall", (293, 604), None),         # slips back 3 tiles (set below)
    ("farm", (1347, 363), None),
    ("fountain", (797, 622), None),
]

used = set(b["starSpots"])
for (x, y), name in SHOPS:
    n = near(x, y)
    assert n["id"] not in used and n["type"] != "fork"
    n["type"], n["shopName"] = "shop", name
    used.add(n["id"])
for x, y in WHEELS:
    n = near(x, y)
    assert n["id"] not in used and n["type"] != "fork"
    n["type"] = "wheel"
    used.add(n["id"])

prev = {}
for n in nodes:
    for t in n["next"]:
        prev.setdefault(t, n["id"])
for lm, (x, y), to in LANDMARKS:
    n = near(x, y)
    assert n["id"] not in used and n["type"] != "fork", lm
    n["type"], n["landmark"] = "landmark", lm
    if to:
        n["warpTo"] = near(*to)["id"]
    if lm == "waterfall":
        k = n["id"]
        for _ in range(3):
            k = prev[k]
        n["warpTo"] = k
    used.add(n["id"])

P.write_text(json.dumps(b, ensure_ascii=False, indent=1), encoding="utf-8")
print({n["id"]: (n["type"], n.get("landmark") or n.get("shopName", ""), n.get("warpTo")) for n in nodes if n["type"] in ("shop", "wheel", "landmark")}.__repr__().encode("ascii", "backslashreplace").decode())
