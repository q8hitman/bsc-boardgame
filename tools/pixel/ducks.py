"""The BSC club members as pixel-art football ducks (40x44 canvas, facing right; flip for left).
Each character = the shared duck body + their own hair / headwear / accessories / glove colour.
Run: python tools/pixel/ducks.py  -> public/assets/football/<id>-<kit>.png (one strip of pose frames each)"""
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from px import Layer, above, below, circ, ell, hexc, poly, rect, render, stamp, tones  # noqa: E402

FEATHER = tones("#FFEDB8", light="#FFF9E4", shade="#F0C784", line="#7C4A20")
BILL = tones("#FF9A1F", light="#FFC35A", shade="#D9680C", line="#7A3206")
BLONDE = tones("#F5C24A", light="#FFE38C", shade="#D28E2A", line="#6E3C0E")
BOOT = tones("#2B2B36", light="#4A4A5A", shade="#1C1C24", line="#0E0E14")
WHITE = tones("#F4F6FB", light="#FFFFFF", shade="#C6CDDC", line="#4A5266")

KITS = {
    "blue": {"shirt": tones("#2E6EE6", light="#5C94F5", shade="#1E4DB4", line="#0E2466"), "shorts": WHITE, "socks": tones("#2E6EE6", shade="#1E4DB4", line="#0E2466"), "trim": hexc("#FFFFFF")},
    "red": {"shirt": tones("#E23B3B", light="#F56C5E", shade="#B4242E", line="#5C0E18"), "shorts": WHITE, "socks": tones("#E23B3B", shade="#B4242E", line="#5C0E18"), "trim": hexc("#FFFFFF")},
    "ref": {"shirt": tones("#FFD23A", light="#FFE98A", shade="#E0A41C", line="#6A4206"), "shorts": tones("#26262E", shade="#17171D", line="#08080C"), "socks": tones("#26262E", line="#08080C"), "trim": hexc("#26262E")},
}

EYE = {"K": hexc("#2A1810"), "W": hexc("#FFFFFF"), "B": hexc("#1B1220")}

# ---- poses: leg offsets + body bob ---------------------------------------------------------------
POSES = {
    "idle": {"bob": 0, "back": (0, 0), "front": (0, 0), "arm": 0},
    "run1": {"bob": -1, "back": (-2, -1), "front": (2, 0), "arm": -1},
    "run2": {"bob": 0, "back": (0, 0), "front": (0, 0), "arm": 0},
    "run3": {"bob": -1, "back": (2, 0), "front": (-2, -1), "arm": 1},
    "kick": {"bob": 0, "back": (-1, 0), "front": (3, -2), "arm": -1},
}


def leg(x, dx, dy, kit):
    sock = rect(x + dx, 31 + dy, x + 2 + dx, 34 + dy)
    boot = rect(x + dx, 35 + dy, x + 3 + dx, 37 + dy) | rect(x + dx + 1, 35 + dy, x + dx + 4, 36 + dy)
    return [Layer(sock, kit["socks"], group="leg"), Layer(boot, BOOT, group="leg")]


def body(kit, pose, gloves):
    P = POSES[pose]
    b = P["bob"]
    L = [Layer(poly([(9, 23 + b), (4, 20 + b), (3.5, 23 + b), (5, 26 + b), (9, 27 + b)]), FEATHER)]  # tail
    L.append(Layer(ell(9.5, 24.6 + b - P["arm"], 2.2, 2.6), kit["shirt"]))  # back arm
    L.append(Layer(circ(8.6, 27.4 + b - P["arm"], 1.6), gloves))
    bx, by = P["back"]
    fx, fy = P["front"]
    L += leg(11, bx, by, kit)
    L += leg(16, fx, fy, kit)
    L.append(Layer(rect(10, 28 + b, 20, 31 + b) & ell(15, 28 + b, 6.6, 5.2), kit["shorts"]))
    L.append(Layer(ell(15, 24.8 + b, 6.4, 5.4), kit["shirt"], sphere=(14, 23.8 + b, 6.4, 5.4)))
    return L


def head_layers(b):
    head = ell(15.5, 12.4 + b, 9.4, 8.6)
    upper = ell(25.4, 15.0 + b, 4.4, 1.9)
    lower = ell(24.6, 17.2 + b, 3.4, 1.3)
    return [Layer(head, FEATHER, sphere=(14.5, 11.4 + b, 9.4, 8.6))], [Layer(upper, BILL, group="bill"), Layer(lower, BILL, group="bill")]


def kit_line(kit):
    return "#%02x%02x%02x" % kit["shirt"]["line"]


def front_arm(kit, pose, gloves):
    P = POSES[pose]
    b = P["bob"] + P["arm"]
    cuff = rect(18, 25 + b, 22, 25 + b) & ell(19.8, 23.6 + b, 2.6, 2.6)
    return [Layer(ell(19.8, 23.6 + b, 2.3, 2.2), kit["shirt"]), Layer(cuff, tones("#F4F6FB", line=kit_line(kit)), flat=True, line=False), Layer(circ(21.2, 26.6 + b, 1.7), gloves)]


def eyes(b):
    near = [".KKK.", "KWWWK", "KWWBK", "KWBBK", "KWBBK", ".KKK."]
    far = [".KK.", "KWWK", "KWBK", "KWBK", ".KK."]
    d = stamp(near, 19, 7 + b, EYE) + stamp(far, 15, 8 + b, EYE)
    d.append((20, 8 + b, EYE["W"]))
    d += [(x, 16 + b, BILL["shade"]) for x in range(22, 28)]  # mouth
    d.append((18, 15 + b, hexc("#FFB4A0")))  # blush
    d.append((25, 14 + b, BILL["shade"]))  # nostril
    return d


def collar(kit, b):
    t = kit["trim"]
    return [(13, 21 + b, t), (14, 22 + b, t), (15, 21 + b, t)]


# ---- hair & accessories -------------------------------------------------------------------------
def _clip_face(m, b):
    """hair never covers the eyes or the bill side of the face"""
    return m & ~ell(22.0, 12.2 + b, 4.4, 5.0) & ~rect(15, 7 + b, 24, 13 + b)


def locks(b, t, specs, face=True):
    """each (x, y, rx, ry) is its own lock; a coloured line separates it from the lock under it"""
    out = []
    for x, y, rx, ry in specs:
        m = ell(x, y + b, rx, ry)
        if face:
            m = _clip_face(m, b)
        out.append(Layer(m, t, sphere=(x - 0.5, y + b - 0.6, rx + 0.6, ry + 0.6)))
    return out


FRINGE = [(8.4, 7.6, 3.6, 3.6), (11.6, 5.0, 4.0, 3.4), (15.6, 3.8, 4.0, 3.0), (19.6, 4.6, 3.4, 2.5)]
FRINGE_SHORT = [(9.0, 6.2, 3.6, 3.0), (12.6, 4.2, 4.0, 3.0), (16.4, 3.6, 3.8, 2.8), (20.0, 4.6, 3.0, 2.2)]


def fringe(b, t=None, short=False):
    return locks(b, t or BLONDE, FRINGE_SHORT if short else FRINGE)


def spikes(b, t, pts):
    out = []
    for x, y, ang in pts:
        a = math.radians(ang)
        tipx, tipy = x + 3.6 * math.cos(a), y + b - 3.6 * math.sin(a)
        nx, ny = 1.6 * math.sin(a), 1.6 * math.cos(a)
        m = poly([(x - nx, y + b - ny + 1.2), (tipx, tipy), (x + nx, y + b + ny + 1.2)]) | circ(x, y + b + 1.2, 1.7)
        out.append(Layer(m, t))
    return out


def long_back(b, t=None, length=1.0):
    spec = [(10.5, 9.5, 6.2, 6.2), (7.0, 14.5, 4.6, 5.2), (5.6, 20.0, 4.0, 4.6), (6.0, 25.2, 3.6, 3.4), (10.0, 25.6, 3.4, 2.8)]
    if length < 1:
        spec = spec[:4]
        spec[3] = (6.2, 23.6, 3.2, 3.0)
    return locks(b, t or BLONDE, spec, face=False)


def curls(b, t, big=1.0):
    """a cloud of curls around the back and the top of the head"""
    spec = []
    n = 11
    for k in range(n):
        a = math.radians(70 + k * (230 / (n - 1)))
        x = 14.5 + 11.0 * big * math.cos(a)
        y = 13.0 - 12.0 * big * math.sin(a)
        if y <= 27:
            spec.append((x, y, 3.3 * big, 3.3 * big))
    return locks(b, t, spec, face=True)


def ponytail(b, t, high=True):
    spec = [(6.6, 5.0, 3.0, 3.0), (3.6, 9.0, 2.8, 3.6), (2.6, 14.0, 2.4, 3.2), (3.2, 18.4, 1.9, 2.4)] if high else [(6.0, 13.5, 2.9, 3.4), (4.6, 18.5, 2.4, 3.2), (4.6, 23.0, 2.0, 2.4)]
    return locks(b, t, spec, face=False)


def braid(b, t, n=4):
    return locks(b, t, [(7.6 - 0.6 * (i % 2), 18.0 + 2.9 * i, 2.1, 1.9) for i in range(n)], face=False)


def bow(b, t, x, y, s=1.0, knot=None):
    """two loops (each its own layer, so a line splits them) and a round knot on top"""
    s *= 1.25
    y += b
    lft = poly([(x, y), (x - 3.4 * s, y - 2.4 * s), (x - 3.8 * s, y + 1.6 * s)]) | ell(x - 2.6 * s, y - 0.3 * s, 1.6 * s, 1.9 * s)
    rgt = poly([(x, y), (x + 3.4 * s, y - 2.4 * s), (x + 3.8 * s, y + 1.6 * s)]) | ell(x + 2.6 * s, y - 0.3 * s, 1.6 * s, 1.9 * s)
    tails = poly([(x - 0.4, y), (x - 2.2 * s, y + 3.2 * s), (x - 0.8 * s, y + 3.0 * s)]) | poly([(x + 0.4, y), (x + 2.2 * s, y + 3.2 * s), (x + 0.8 * s, y + 3.0 * s)])
    k = circ(x, y, 1.0 * s + 0.3)
    return [Layer(tails, t, group="bowt"), Layer(lft, t, group="bowl", sphere=(x - 3, y - 1.5, 3.4 * s, 2.6 * s)), Layer(rgt, t, group="bowr", sphere=(x + 2, y - 1.5, 3.4 * s, 2.6 * s)), Layer(k, knot or t, group="bowknot", sphere=(x - 0.5, y - 0.5, 1.4 * s, 1.4 * s))]


def goggles(b, strap, lens, y=5.6):
    ring = ell(15.5, 12.4 + b, 10.0, 9.0) & ~ell(15.5, 12.4 + b, 8.8, 7.9)
    band = (ring & below(y - 2 + b) & above(y + 2 + b)) | (rect(7, int(y + b), 23, int(y + b) + 1) & ell(15.5, 12.4 + b, 10.0, 9.0))
    l1, l2 = ell(16.8, y + 0.7 + b, 2.4, 2.0), ell(21.4, y + 1.2 + b, 2.2, 2.0)
    return [Layer(band, strap), Layer(l1, lens, group="lens1", sphere=(16, y + b, 2.4, 2.0)), Layer(l2, lens, group="lens2", sphere=(20.6, y + 0.5 + b, 2.2, 2.0))]


def cap_backwards(b, t, front_tuft=None, logo=True):
    """a snapback worn backwards: the dome hugs the head, the brim sticks out behind, a feather tuft pokes out of the strap hole"""
    dome = ell(14.2, 8.4 + b, 10.2, 7.2) & above(8.2 + b) & ell(15.5, 12.4 + b, 10.4, 9.6)
    band = rect(5, 7 + b, 24, 8 + b) & ell(15.5, 12.4 + b, 10.2, 9.4) & ~ell(22.6, 12.2 + b, 3.2, 4.0)
    brim = poly([(8.0, 6.0 + b), (1.4, 7.6 + b), (1.0, 9.6 + b), (7.6, 10.0 + b)])
    out = spikes(b, front_tuft, [(22.2, 6.2, 55), (23.8, 7.8, 20)]) if front_tuft else []
    return out + [Layer(brim, t, group="capbrim", sphere=(3, 7.5 + b, 5, 2.4)), Layer(dome, t, group="cap", sphere=(11.5, 5.0 + b, 10.2, 7.6)), Layer(band, t, group="capb")]


CAP_LOGO = ["pt", "gb"]


def headband(b, t, y=5.8):
    ring = ell(15.5, 12.4 + b, 10.2, 9.2) & ~ell(15.5, 12.4 + b, 8.9, 8.0)
    m = (ring & below(y - 5 + b) & above(y + 1 + b)) | (rect(8, int(y + b), 22, int(y + b) + 1) & ell(15.5, 12.4 + b, 10.2, 9.2) & ~ell(15.5, 12.4 + b, 7.2, 6.4))
    return Layer(m, t)


def hijab(b, t):
    m = ell(14.4, 11.6 + b, 10.6, 10.2) | ell(14.0, 21.6 + b, 9.4, 4.2)
    face = ell(19.8, 13.6 + b, 6.8, 7.4)
    rim = ell(19.8, 13.6 + b, 7.6, 8.2) & ~face & m
    return Layer(m & ~face, t, sphere=(12.0, 9.0 + b, 12, 12)), Layer(rim, tones("#4A4258", light="#6A6080", line="#0C0A10"))


def scarf(b, t):
    m = rect(10, 19 + b, 21, 21 + b) & ell(15.5, 20 + b, 6.6, 2.6)
    m |= poly([(17, 20 + b), (20, 20 + b), (20.5, 26 + b), (17.5, 25.5 + b)])
    return Layer(m, t)


ICONS = {
    "star": ({"o": "#FF8A1F", "y": "#FFD24A", "k": "#7A3A08"}, ["..k..", ".kyk.", "kyyyk", ".kok.", "k...k"]),
    "moon": ({"p": "#B07BFF", "l": "#E2CCFF", "k": "#3A1C78"}, [".kk.", "kpl.", "kp..", "kpl.", ".kk."]),
    "butterfly": ({"p": "#A06BFF", "l": "#D9C2FF", "k": "#341A70"}, ["kk.kk", "kplpk", ".kpk.", "kplpk", "kk.kk"]),
    "dna": ({"b": "#4A9BFF", "w": "#FFFFFF", "k": "#123A7A"}, ["kb.", ".wk", "bk.", ".wb", "kb."]),
    "atom": ({"g": "#FFCF3A", "k": "#8A5A08"}, [".g.", "gkg", ".g."]),
    "flower": ({"w": "#FFFFFF", "y": "#FFD24A"}, [".w.", "wyw", ".w."]),
    "whistle": ({"s": "#D8DCE6", "k": "#4A5060"}, ["kss", "ksk"]),
}


def logo(x, y, b):
    """the four BSC hexagon colours as a tiny 2x2 badge"""
    pal = {"p": hexc("#B05BD8"), "t": hexc("#3FC1D0"), "g": hexc("#8BC34A"), "b": hexc("#F2A93B")}
    return stamp(CAP_LOGO, x, y + b, pal)


def icon(kind, x, y, b):
    pal, rows = ICONS[kind]
    return stamp(rows, x, y + b, {k: hexc(v) for k, v in pal.items()})


# ---- the club: (back layers, front layers, neck layers, decals) ----------------------------------
C = {}


def char(id, ar, en, gloves=None):
    def deco(fn):
        C[id] = {"ar": ar, "en": en, "fn": fn, "gloves": gloves}
        return fn

    return deco


DARK_BROWN = tones("#6A4430", light="#8E6046", shade="#4A2C1C", line="#1E120A")
BLACK_CAP = tones("#2C2C34", light="#50505E", shade="#1A1A20", line="#0A0A0E")
BLUE_GLOVE = tones("#3B8BFF", light="#7FB4FF", line="#0E3A88")


@char("abdullah", "عبدالله", "Abdullah", gloves=BLUE_GLOVE)
def _(b):
    return [], cap_backwards(b, BLACK_CAP, front_tuft=FEATHER), [], logo(13, 3, b)


@char("motivator", "المحفّز", "Motivator")
def _(b):
    hair = spikes(b, BLONDE, [(9, 5, 120), (12.5, 3.6, 100), (16, 3.4, 80), (19.4, 4.4, 55)])
    return [], hair + goggles(b, tones("#3A3A48"), tones("#7FD3FF", light="#D8F4FF", line="#1A4A6A")), [], []


@char("ahmad", "أحمد", "Ahmad")
def _(b):
    return [], fringe(b, short=True) + locks(b, BLONDE, [(20.6, 3.6, 3.6, 2.0)]), [], []


@char("camel", "الجمل", "Camel")
def _(b):
    return [], fringe(b, short=True) + spikes(b, BLONDE, [(10, 3, 115), (14, 1.8, 95), (18, 2.2, 70)]), [], []


@char("abdulrahman", "عبدالرحمن", "Abdulrahman")
def _(b):
    return [], fringe(b, short=True), [scarf(b, tones("#2F9E5C", light="#5CC882", line="#0E3E22"))], []


@char("fayzah", "فايزة", "Fayzah")
def _(b):
    teal = tones("#2FC4C0", line="#0A4C4A")
    return ponytail(b, BLONDE), fringe(b) + bow(b, teal, 6.2, 3.0, 0.8) + goggles(b, tones("#3A3A48"), tones("#9ADFFF", line="#1A4A6A"), y=5.0), [], []


@char("rawan", "روان", "Rawan")
def _(b):
    return long_back(b), fringe(b) + bow(b, tones("#FF5FA8", light="#FF9ACB", line="#7A1046"), 9.0, 2.4, 1.05), [], []


@char("shouq", "شوق", "Shouq")
def _(b):
    return ponytail(b, BLONDE), fringe(b) + bow(b, tones("#2FC4C0", light="#7FE6E2", line="#0A4C4A"), 6.6, 3.4, 0.85), [], []


@char("loujain", "لجين", "Loujain")
def _(b):
    return long_back(b), fringe(b) + [headband(b, tones("#8E5BFF", light="#B796FF", line="#2E1478"))], [], []


@char("bassam", "بسام", "Bassam")
def _(b):
    hair = spikes(b, BLONDE, [(8.6, 5, 135), (11.6, 3, 110), (15, 2.4, 90), (18.4, 2.8, 70), (21, 4.4, 40)])
    return [], hair + goggles(b, tones("#2A2A34"), tones("#3F6BD8", light="#9FBAFF", line="#14246A"), y=5.2), [], []


@char("ali", "علي", "Ali", gloves=BLUE_GLOVE)
def _(b):
    olive = tones("#7C8A4A", light="#A2B06A", shade="#5C6834", line="#262E10")
    return [], cap_backwards(b, olive, front_tuft=FEATHER), [], []


@char("ruaa", "رؤى", "Ruaa")
def _(b):
    return long_back(b, length=0.8), fringe(b) + [headband(b, tones("#2E2A34", light="#55505E", line="#0C0A10"))], [], []


@char("hora", "حوراء", "Hora")
def _(b):
    return curls(b, BLONDE), fringe(b) + bow(b, tones("#9A4A2E", light="#C47658", line="#3E1408"), 7.6, 2.6, 0.9), [], []


@char("zainab", "زينب", "Zainab")
def _(b):
    phones = rect(10, 19 + b, 21, 20 + b) & ell(15.5, 19.6 + b, 6.6, 2.2)
    cup = circ(19.8, 20.2 + b, 1.7)
    return curls(b, BLONDE), fringe(b), [Layer(phones, tones("#3A3A48")), Layer(cup, tones("#FF8A1F", light="#FFB45A", line="#6A2E06"))], icon("star", 6, 3, b)


@char("amna", "آمنة", "Amna")
def _(b):
    return braid(b, BLONDE), fringe(b), bow(b, tones("#3B7BFF", light="#8AB4FF", line="#0E2A7A"), 7.0, 29.0, 0.6), []


@char("jenan", "جنان", "Jenan", gloves=tones("#7A4ADB", light="#A47CF0", line="#2A0E66"))
def _(b):
    gog = goggles(b, tones("#E4D8FF", line="#4A3A7A"), tones("#B796FF", light="#E8DCFF", line="#3A1C88"), y=4.6)
    return curls(b, DARK_BROWN, big=1.08), fringe(b, DARK_BROWN) + gog, [], icon("butterfly", 5, 4, b)


@char("maha", "مها", "Maha", gloves=tones("#2A3A6E", light="#4A5E9E", line="#0A1028"))
def _(b):
    navy = tones("#2A3A6E", light="#4A5E9E", line="#0A1028")
    gog = goggles(b, tones("#9AA4B8", line="#3A4256"), tones("#C8D2E6", light="#F0F4FF", line="#3A4256"), y=5.0)
    return ponytail(b, BLONDE), fringe(b) + bow(b, navy, 6.2, 2.8, 0.95) + gog, [], icon("flower", 5, 2, b)


@char("samiyeh", "سامية", "Samiyeh")
def _(b):
    return long_back(b), fringe(b) + bow(b, tones("#FF6FAE", light="#FFA8CF", line="#7A1046"), 9.4, 1.8, 1.25), [], icon("atom", 8, 0, b)


@char("ritaj", "رتاج", "Ritaj", gloves=tones("#8A2342", light="#B04A68", line="#2E0614"))
def _(b):
    return long_back(b, length=0.8), fringe(b) + bow(b, tones("#8A2342", light="#B04A68", line="#2E0614"), 9.0, 2.2, 1.15), [], []


@char("sheikha", "شيخة", "Sheikha")
def _(b):
    return curls(b, BLONDE), fringe(b), [], icon("moon", 6, 4, b)


@char("aya", "آية", "Aya")
def _(b):
    bun = locks(b, BLONDE, [(9.0, 1.6, 3.4, 3.0)], face=False)
    return [], bun + fringe(b) + bow(b, tones("#3CC46A", light="#7FE69C", line="#0E4A22"), 9.4, 4.6, 0.6), [], []


@char("maryam", "مريم", "Maryam")
def _(b):
    return braid(b, BLONDE), fringe(b), [], icon("dna", 6, 5, b)


@char("zahraa", "د. زهراء", "Dr. Zahraa")
def _(b):
    scarf_, rim = hijab(b, tones("#2E2A36", light="#4E4660", shade="#1E1A24", line="#0C0A10"))
    return [], [rim, scarf_], [], icon("whistle", 20, 21, b)


def build(id, kit_name="blue", pose="idle"):
    c = C[id]
    kit = KITS["ref" if id == "zahraa" else kit_name]
    gloves = c["gloves"] or FEATHER
    b = POSES[pose]["bob"]
    back, front, neck, extra = c["fn"](b)
    layers = list(back) + body(kit, pose, gloves) + list(neck)
    head, bill = head_layers(b)
    if id == "zahraa":
        layers += head + list(front) + bill  # the hijab wraps the head; the bill sits on the face opening
    else:
        layers += head + bill + list(front)
    layers += front_arm(kit, pose, gloves)
    return render(layers, collar(kit, b) + eyes(b) + list(extra))


ORDER = ["abdullah", "motivator", "ahmad", "camel", "abdulrahman", "fayzah", "rawan", "shouq", "loujain", "bassam", "ali",
         "ruaa", "hora", "zainab", "amna", "jenan", "maha", "samiyeh", "ritaj", "sheikha", "aya", "maryam", "zahraa"]

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "public/assets/football"
    os.makedirs(out, exist_ok=True)
    for id in ORDER:
        for k in (["ref"] if id == "zahraa" else ["blue", "red"]):
            strip = np.concatenate([build(id, k, p) for p in POSES], axis=1)
            Image.fromarray(strip, "RGBA").save(f"{out}/{id}-{k}.png")
    print("ok", len(ORDER))
