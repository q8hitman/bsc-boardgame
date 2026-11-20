"""Turn an OpenStreetMap download of the Shadadiya campus (Overpass `out geom` JSON) into the kart map data.

Usage: python tools/kart/osm_campus.py <campus.json> <out.json> [preview.png]

Game space: metres x SCALE, x = east, z = SOUTH (so the map is not mirrored), origin at the College of Science
(north building). Writes:
  buildings: [{pts: [[x, z], ...], h, kind, name}]   (the College of Science split round its north-south galleria)
  roads:     [[[x, z], ...], width]                  (every mapped road and service lane, for drawing)
  paths:     [[[x, z], ...]]                         (footways, for walking ducks)
  loop:      [[x, z], ...]                           (the race line: round the College of Science)
  galleria:  [[x, z], ...]                           (the shortcut through the college)
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import sys

SCALE = 0.7
src, out = sys.argv[1], sys.argv[2]
preview = sys.argv[3] if len(sys.argv) > 3 else None
d = json.load(open(src, encoding="utf-8"))
els = d["elements"]
SCI_ID = 1049096657  # "SCIENCE COLLEGE"
sci = next(e for e in els if e["id"] == SCI_ID)
lat0 = sum(n["lat"] for n in sci["geometry"]) / len(sci["geometry"])
lon0 = sum(n["lon"] for n in sci["geometry"]) / len(sci["geometry"])
KX = math.cos(math.radians(lat0)) * 111320
KZ = 110540


def P(n):
    return ((n["lon"] - lon0) * KX * SCALE, -(n["lat"] - lat0) * KZ * SCALE)


def area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def hull(pts):
    pts = sorted(set(pts))
    lo, up = [], []
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def offset_round(poly, d, step=4.0):
    """points at distance d outside a convex polygon (rounded corners), evenly spaced"""
    n = len(poly)
    if area(poly) < 0:
        poly = poly[::-1]
    pts = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        e1 = (b[0] - a[0], b[1] - a[1])
        e2 = (c[0] - b[0], c[1] - b[1])
        n1 = math.atan2(-e1[0], e1[1])  # outward normal angle (ccw polygon in x,z with z down: check below)
        n2 = math.atan2(-e2[0], e2[1])
        if n2 < n1:
            n2 += 2 * math.pi
        k = max(1, int((n2 - n1) * d / step))
        for j in range(k + 1):
            t = n1 + (n2 - n1) * j / k
            pts.append((b[0] + math.cos(t) * d, b[1] + math.sin(t) * d))
    return pts


def clip(poly, keep):
    """Sutherland-Hodgman against a half-plane keep(p) -> signed value (>= 0 kept)"""
    out = []
    for i in range(len(poly)):
        a, b = poly[i - 1], poly[i]
        fa, fb = keep(a), keep(b)
        if fb >= 0:
            if fa < 0:
                t = fa / (fa - fb)
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            out.append(b)
        elif fa >= 0:
            t = fa / (fa - fb)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def kind_of(t):
    nm = (t.get("name:en") or t.get("name") or "").lower()
    if "science" in nm and "life" not in nm and "business" not in nm:
        return "science"
    if "life" in nm:
        return "life"
    if "engineering" in nm:
        return "engineering"
    if "business" in nm or "الإدارية" in t.get("name", ""):
        return "business"
    if "administration" in nm:
        return "admin"
    if t.get("building") in ("university", "college"):
        return "college"
    if t.get("building") == "house":
        return "house"
    return "other"


def height_of(t, kind):
    if "height" in t:
        try:
            return float(t["height"]) * SCALE
        except ValueError:
            pass
    if "building:levels" in t:
        return float(t["building:levels"]) * 4.2 * SCALE
    # the colleges: basement, ground and five floors (NBBJ's description of the College of Science)
    return {"science": 27, "engineering": 27, "life": 24, "business": 22, "college": 22, "admin": 30, "house": 7}.get(kind, 9) * SCALE


buildings = []
roads = []
paths = []
sci_poly = [P(n) for n in sci["geometry"]][:-1]
for e in els:
    t = e.get("tags", {})
    g = e.get("geometry")
    if not g:
        continue
    pts = [P(n) for n in g]
    if "building" in t and e["id"] != SCI_ID:
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3 or abs(area(pts)) < 6:
            continue
        k = kind_of(t)
        buildings.append({"pts": [[round(x, 1), round(z, 1)] for x, z in pts], "h": round(height_of(t, k), 1), "kind": k, "name": t.get("name", "")})
    elif "highway" in t:
        hw = t["highway"]
        if hw in ("footway", "steps", "path", "pedestrian"):
            paths.append([[round(x, 1), round(z, 1)] for x, z in pts])
        elif hw != "construction":
            w = {"secondary": 9, "tertiary": 7, "tertiary_link": 5, "secondary_link": 5, "unclassified": 6, "residential": 5}.get(hw, 3.5) * SCALE
            roads.append([[[round(x, 1), round(z, 1)] for x, z in pts], round(w, 1)])

# the race line: round the College of Science (its outline pushed out to the middle of the lanes round it)
H = hull(sci_poly)
loop = offset_round(H, 15 * SCALE + 6, step=5)
# the shortcut: straight through the middle of the college, north to south (the real north-south "Academic Galleria")
cx = sum(x for x, _ in sci_poly) / len(sci_poly)
zs = [z for _, z in H]
gal = [[round(cx, 1), round(min(zs) - 15 * SCALE - 6, 1)], [round(cx, 1), round((min(zs) + max(zs)) / 2, 1)], [round(cx, 1), round(max(zs) + 15 * SCALE + 6, 1)]]
# the college itself, cut in two round the galleria (a 14 m passage), joined by a bridge on top
GAP = 7.0
west = clip(sci_poly, lambda p: (cx - GAP) - p[0])
east = clip(sci_poly, lambda p: p[0] - (cx + GAP))
for part in (west, east):
    buildings.append({"pts": [[round(x, 1), round(z, 1)] for x, z in part], "h": round(27 * SCALE, 1), "kind": "science", "name": "كلية العلوم"})

# Two small changes so the race fits (said plainly in the game notes): the lane between the College of Science and
# the College of Life Sciences is widened (Life Sciences' west 16 m trimmed), and the passage between Engineering
# and Science widened by 4 m (Engineering's east edge trimmed).
for b in buildings:
    if b["kind"] == "life" and min(p[0] for p in b["pts"]) > 50 and min(p[1] for p in b["pts"]) < 0:
        b["pts"] = [[round(x, 1), round(z, 1)] for x, z in clip([tuple(p) for p in b["pts"]], lambda p: p[0] - 86)]
    if b["kind"] == "engineering" and max(p[0] for p in b["pts"]) > -95 and min(p[1] for p in b["pts"]) < -50:
        b["pts"] = [[round(x, 1), round(z, 1)] for x, z in clip([tuple(p) for p in b["pts"]], lambda p: -92 - p[0])]
buildings = [b for b in buildings if len(b["pts"]) >= 3]

# which buildings sit on the race line? (the race line wins: they are reported, the game pushes karts out)
def inside(p, poly):
    c = False
    for i in range(len(poly)):
        a, b = poly[i - 1], poly[i]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


clash = [b["name"] or b["kind"] for b in buildings if b["kind"] != "science" and any(inside(p, b["pts"]) for p in loop)]
res = {
    "scale": SCALE,
    "origin": [lat0, lon0],
    "credit": "Map data (c) OpenStreetMap contributors, ODbL",
    "buildings": buildings,
    "roads": roads,
    "paths": paths,
    "loop": [[round(x, 1), round(z, 1)] for x, z in loop],
    "galleria": gal,
}
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
L = sum(math.dist(loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop)))
print("buildings", len(buildings), "roads", len(roads), "paths", len(paths), "loop pts", len(loop), "loop length", round(L), "clash", clash)

if preview:
    from PIL import Image, ImageDraw
    S = 1.6
    W = 1400
    im = Image.new("RGB", (W, W), (235, 225, 200))
    dr = ImageDraw.Draw(im)
    px = lambda p: (W / 2 + p[0] * S, W / 2 + p[1] * S)
    for pts, w in roads:
        dr.line([px(p) for p in pts], fill=(120, 120, 130), width=max(1, int(w * S)))
    for b in buildings:
        dr.polygon([px(p) for p in b["pts"]], fill={"science": (90, 140, 200), "life": (190, 110, 60), "engineering": (150, 150, 190), "business": (200, 180, 140)}.get(b["kind"], (170, 170, 170)), outline=(30, 30, 30))
    dr.line([px(p) for p in loop + [loop[0]]], fill=(220, 30, 30), width=int(11 * S))
    dr.line([px(p) for p in gal], fill=(30, 200, 220), width=int(6 * S))
    im.save(preview)
