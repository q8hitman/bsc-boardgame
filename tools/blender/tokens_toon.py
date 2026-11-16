"""Cartoon game pieces matching the island map style.

Run: blender -b --factory-startup --python tools/blender/tokens_toon.py -- <out_dir_abs> [size] [only]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toon as T  # noqa: E402
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0]
SIZE = int(argv[1]) if len(argv) > 1 else 256
ONLY = int(argv[2]) if len(argv) > 2 else -1
# "card": no base, bigger framing, writes card{i}.png (character art for the card game)
CARD = len(argv) > 3 and argv[3] == "card"

COLORS = ["#FFD93B", "#FF5A4A", "#2FD08C", "#9B7BFF", "#3AA8FF", "#FF7DBE", "#FF9A1F", "#F2EEE4",
          "#A7AEBB", "#8BD346", "#00C2B8", "#B05BD8", "#7FE3FF", "#3D3D55", "#A0522D", "#2E5FA8", "#B3122E"]
Z = 0.2  # top of the base


def base(hexcol):
    T.cyl((0, 0, 0.1), 0.78, 0.2, T.toon(hexcol), outline=0.05)
    T.torus((0, 0, 0.2), 0.62, 0.035, T.toon("#FFFFFF", shade=0.9), outline=0)


def eyes(x, y, z, r=0.085, sep=0.15, facing=0.0):
    white, black = T.toon("#FFFFFF", shade=0.85), T.flat(T.INK, "pupil")
    for s in (1, -1):
        yy = y + s * sep
        T.sphere((x, yy, z), (r * 0.7, r, r * 1.15), white, outline=0.025)
        T.sphere((x + r * 0.55, yy + facing, z - r * 0.1), (r * 0.35, r * 0.55, r * 0.7), black, outline=0)
        T.sphere((x + r * 0.75, yy + facing + 0.02, z + r * 0.3), (0.02, 0.025, 0.025), T.flat((1, 1, 1, 1), "glint"), outline=0)


def duck():
    y, o = T.toon("#FFD84A"), T.toon("#FF8A1F")
    T.sphere((0, 0, Z + 0.42), (0.6, 0.46, 0.4), y)
    T.sphere((0.32, 0, Z + 0.95), (0.33, 0.32, 0.33), y)
    T.sphere((0.66, 0, Z + 0.9), (0.2, 0.15, 0.07), o, outline=0.03)
    t = T.sphere((-0.55, 0, Z + 0.62), (0.2, 0.17, 0.11), y)
    t.rotation_euler = (0, math.radians(-40), 0)
    for s in (1, -1):
        T.sphere((-0.05, s * 0.4, Z + 0.48), (0.34, 0.1, 0.2), y, outline=0.03)
    eyes(0.52, 0, Z + 1.04, r=0.08, sep=0.13)
    T.sphere((0.5, 0.2, Z + 0.86), (0.05, 0.06, 0.035), T.toon("#FF7FA0"), outline=0)


def egg():
    T.sphere((0, 0, Z + 0.6), (0.44, 0.44, 0.6), T.toon("#FFF3D6"))
    spot = T.toon("#C98A4B")
    for (a, z, r) in ((0.3, 0.75, 0.08), (1.4, 0.45, 0.06), (2.6, 0.9, 0.07), (-0.6, 0.35, 0.05), (0.9, 1.0, 0.05)):
        T.sphere((0.42 * math.cos(a), 0.42 * math.sin(a), Z + z), (r, r, r), spot, outline=0)
    nest = T.toon("#B9793C")
    T.torus((0, 0, Z + 0.06), 0.42, 0.11, nest, outline=0.03)


def mushroom():
    T.cyl((0, 0, Z + 0.35), 0.24, 0.7, T.toon("#FFF1DA"))
    T.sphere((0, 0, Z + 0.78), (0.62, 0.62, 0.38), T.toon("#E8443A"))
    w = T.toon("#FFFFFF", shade=0.85)
    for a, r, h in ((0.2, 0.4, 0.98), (2.3, 0.42, 0.96), (4.3, 0.4, 0.98), (1.2, 0.05, 1.15)):
        T.sphere((r * math.cos(a), r * math.sin(a), Z + h), (0.12, 0.12, 0.06), w, outline=0.02)
    eyes(0.24, 0, Z + 0.4, r=0.06, sep=0.09)


def flask():
    glass = T.toon("#CDEFFF", shade=0.8)
    T.cone((0, 0, Z + 0.45), 0.58, 0.18, 0.9, glass)
    T.cyl((0, 0, Z + 1.05), 0.17, 0.4, glass)
    T.cone((0, 0, Z + 0.22), 0.6, 0.38, 0.38, T.toon("#4BE07A"), outline=0.02)
    T.torus((0, 0, Z + 1.25), 0.19, 0.05, T.toon("#9DD8F0"), outline=0.02)
    b = T.toon("#BFFFD0", shade=0.9)
    for (x, y, z, r) in ((0.15, -0.28, 0.32, 0.07), (-0.18, -0.24, 0.5, 0.05), (0.02, -0.12, 0.72, 0.05), (0.05, -0.1, 1.38, 0.06), (-0.05, -0.12, 1.55, 0.05)):
        T.sphere((x, y, Z + z), (r, r, r), b, outline=0.015)


def dna():
    red, blue = T.toon("#FF5A6E"), T.toon("#3E9BFF")
    rungs = [T.toon("#FFD24A"), T.toon("#5BE08A")]
    n = 9
    for i in range(n):
        t = i / (n - 1)
        z = Z + 0.15 + t * 1.1
        a = t * math.pi * 1.9
        p1 = (0.34 * math.cos(a), 0.34 * math.sin(a), z)
        p2 = (-0.34 * math.cos(a), -0.34 * math.sin(a), z)
        T.sphere(p1, (0.12, 0.12, 0.12), red, outline=0.025)
        T.sphere(p2, (0.12, 0.12, 0.12), blue, outline=0.025)
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, z)
        T.cyl(mid, 0.045, 0.62, rungs[i % 2], outline=0.015, verts=16, rot=(math.pi / 2, 0, a + math.pi / 2))


def snail():
    T.sphere((0.08, 0, Z + 0.14), (0.62, 0.22, 0.14), T.toon("#A6E36A"))
    T.sphere((0.56, 0, Z + 0.36), (0.16, 0.15, 0.24), T.toon("#A6E36A"))
    shell, swirl = T.toon("#E8913A"), T.toon("#B9601E")
    T.sphere((-0.1, 0, Z + 0.55), (0.42, 0.3, 0.42), shell)
    T.torus((-0.1, 0, Z + 0.55), 0.22, 0.05, swirl, outline=0, rot=(math.pi / 2, 0, 0))
    T.sphere((-0.1, 0, Z + 0.55), (0.1, 0.32, 0.1), swirl, outline=0)
    for s in (1, -1):
        T.cyl((0.62, s * 0.06, Z + 0.62), 0.025, 0.28, T.toon("#A6E36A"), outline=0.012, verts=12, rot=(s * -0.25, 0.25, 0))
    eyes(0.7, 0, Z + 0.78, r=0.06, sep=0.1)


def fish():
    T.cyl((0, 0, Z + 0.22), 0.06, 0.44, T.toon("#7FC6E8"), outline=0.02, verts=16)
    body, white = T.toon("#FF8A2A"), T.toon("#FFFFFF", shade=0.85)
    T.sphere((0, 0, Z + 0.78), (0.5, 0.2, 0.33), body)
    T.sphere((0.1, 0, Z + 0.78), (0.06, 0.205, 0.31), white, outline=0)
    T.sphere((-0.18, 0, Z + 0.78), (0.05, 0.2, 0.27), white, outline=0)
    tail = T.cone((-0.58, 0, Z + 0.78), 0.26, 0.0, 0.36, body, outline=0.03, rot=(0, math.radians(-90), 0))
    tail.scale = (1, 0.3, 1)
    fin = T.cone((0, 0, Z + 1.08), 0.2, 0.0, 0.24, T.toon("#FFC04A"), outline=0.02)
    fin.scale = (1, 0.25, 1)
    eyes(0.36, 0, Z + 0.84, r=0.06, sep=0.13)


def acorn():
    T.sphere((0, 0, Z + 0.55), (0.4, 0.4, 0.5), T.toon("#C9874A"))
    cap = T.toon("#7A4A22")
    T.sphere((0, 0, Z + 0.92), (0.46, 0.46, 0.25), cap)
    T.cyl((0.03, 0, Z + 1.2), 0.05, 0.22, cap, outline=0.02, verts=16, rot=(0, 0.3, 0))
    eyes(0.32, 0, Z + 0.6, r=0.07, sep=0.12)


# ---------------------------------------------------------------- reference pieces (movie / game archetypes)
def sunglasses(x, z, sep=0.14, r=0.1):
    k = T.flat(T.INK, "shades")
    for s in (1, -1):
        T.sphere((x, s * sep, z), (0.04, r, r * 0.75), k, outline=0)
    T.cyl((x, 0, z + 0.02), 0.018, sep * 1.2, k, outline=0, verts=8, rot=(math.pi / 2, 0, 0))


def text3d(body, loc, size, mat, rot=(math.pi / 2, 0, math.pi / 2), extrude=0.02, outline=0.012):
    """Flat 3D label (faces +X by default)."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.data.body = body
    o.data.size = size
    o.data.extrude = extrude
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    return T.finish(o, mat, outline, smooth=False)


def frog_gandalf():
    """Lord of the Rings: grey wizard - grey pointed hat, long white beard, robe, glowing staff."""
    g, robe, beard = T.toon("#5BD65B"), T.toon("#9AA1AE", shade=0.75), T.toon("#F4F4F0", shade=0.85)
    T.cone((0, 0, Z + 0.36), 0.46, 0.24, 0.62, robe, outline=0.04)
    T.torus((0, 0, Z + 0.52), 0.33, 0.035, T.toon("#5A4A3A"), outline=0.015)  # rope belt
    T.sphere((0.04, 0, Z + 0.86), (0.34, 0.36, 0.26), g)
    for s in (1, -1):
        T.sphere((0.2, s * 0.17, Z + 1.0), (0.13, 0.13, 0.12), g, outline=0.03)
    eyes(0.29, 0, Z + 1.01, r=0.07, sep=0.17)
    # beard: wide at the chin, pointing down over the robe
    T.cone((0.3, 0, Z + 0.58), 0.22, 0.03, 0.5, beard, outline=0.03, rot=(0, math.pi + 0.22, 0))
    T.sphere((0.33, 0, Z + 0.8), (0.07, 0.17, 0.05), beard, outline=0.02)  # moustache
    hat = T.toon("#8C93A0", shade=0.72)
    T.cyl((-0.1, 0, Z + 1.15), 0.4, 0.04, hat, outline=0.03, rot=(0, -0.12, 0))
    T.cone((-0.16, 0, Z + 1.42), 0.26, 0.015, 0.56, hat, outline=0.03, rot=(0, -0.4, 0))
    # staff with a glowing crystal, on the camera side
    T.cyl((0.22, -0.46, Z + 0.62), 0.032, 1.1, T.toon("#7A4E2A"), outline=0.015, verts=10)
    T.sphere((0.22, -0.46, Z + 1.2), (0.08, 0.08, 0.1), T.flat((0.85, 0.95, 1.0, 1), "glow"), outline=0.02)
    T.sphere((0.22, -0.38, Z + 0.68), (0.09, 0.08, 0.08), g, outline=0.02)  # hand


def turtle_ninja():
    """Ninja Turtles: upright turtle, blue mask with tails, twin katana over the shoulders."""
    g, shell, belly = T.toon("#6FCF4A"), T.toon("#8A5A2B"), T.toon("#F2D06B")
    for s in (1, -1):
        T.sphere((0.02, s * 0.17, Z + 0.14), (0.14, 0.13, 0.16), g, outline=0.03)
    T.sphere((-0.1, 0, Z + 0.56), (0.3, 0.38, 0.38), shell)
    T.sphere((0.06, 0, Z + 0.54), (0.26, 0.31, 0.34), belly, outline=0.03)
    for z in (0.44, 0.58):
        T.torus((0.07, 0, Z + z), 0.27, 0.012, T.toon("#C9A54A"), outline=0, rot=(0, math.pi / 2 - 0.25, 0))
    T.torus((0.0, 0, Z + 0.36), 0.31, 0.04, T.toon("#6A4426"), outline=0.015)  # belt
    for s in (1, -1):
        a = T.sphere((0.06, s * 0.38, Z + 0.58), (0.1, 0.1, 0.22), g, outline=0.03)
        a.rotation_euler = (s * -0.35, 0, 0)
        # katana handles over the shoulders
        T.cyl((-0.2, s * 0.2, Z + 1.06), 0.035, 0.42, T.toon("#3A2A20"), outline=0.012, verts=10, rot=(s * -0.45, -0.25, 0))
        T.cyl((-0.15, s * 0.13, Z + 0.88), 0.07, 0.02, T.toon("#D9B44A"), outline=0.01, verts=16, rot=(s * -0.45, -0.25, 0))
    T.sphere((0.1, 0, Z + 0.98), (0.3, 0.27, 0.25), g)
    mask = T.toon("#2F7BFF")
    T.torus((0.1, 0, Z + 1.02), 0.27, 0.06, mask, outline=0.02, rot=(0, 0.12, 0))
    for s in (1, -1):
        t = T.sphere((-0.26, s * 0.07, Z + 0.95), (0.16, 0.045, 0.04), mask, outline=0.015)
        t.rotation_euler = (0, 0.5, s * 0.4)
    eyes(0.35, 0, Z + 1.03, r=0.06, sep=0.1)
    T.sphere((0.33, 0, Z + 0.89), (0.02, 0.09, 0.02), T.flat(T.INK, "mouth"), outline=0)


def octopus_sparrow():
    """Pirates of the Caribbean: tricorn hat over a red bandana, dreadlocks with beads, braided beard, cutlass."""
    p = T.toon("#B46BFF")
    for i in range(8):
        a = i * math.pi / 4
        T.sphere((0.4 * math.cos(a), 0.4 * math.sin(a), Z + 0.1), (0.2, 0.09, 0.08), p, outline=0.02, rot=(0, 0, a))
        T.sphere((0.6 * math.cos(a), 0.6 * math.sin(a), Z + 0.12), (0.07, 0.07, 0.07), p, outline=0.015)
    T.sphere((0, 0, Z + 0.6), (0.42, 0.42, 0.46), p)
    kohl = T.flat(T.INK, "kohl")
    for s in (1, -1):
        T.sphere((0.33, s * 0.13, Z + 0.69), (0.05, 0.1, 0.105), kohl, outline=0)
    eyes(0.36, 0, Z + 0.69, r=0.07, sep=0.13)
    hair = T.toon("#3A2A20")
    T.sphere((0.4, 0, Z + 0.53), (0.03, 0.15, 0.03), hair, outline=0.01)  # moustache
    for s in (1, -1):
        T.cone((0.38, s * 0.05, Z + 0.4), 0.035, 0.008, 0.18, hair, outline=0.01, rot=(0, math.pi, 0))
    # dreadlocks with beads, hanging under the hat at the sides/back
    beads = [T.toon("#FF3B3B"), T.toon("#FFD23F"), T.toon("#3AA8FF")]
    for k, a in enumerate((55, 80, 105, 255, 280, 305)):
        r = math.radians(a)
        x, y = 0.44 * math.cos(r), 0.44 * math.sin(r)
        T.cyl((x, y, Z + 0.7), 0.04, 0.42, hair, outline=0.012, verts=8)
        T.sphere((x, y, Z + 0.5), (0.05, 0.05, 0.05), beads[k % 3], outline=0.012)
    T.sphere((0, 0, Z + 0.95), (0.44, 0.44, 0.17), T.toon("#D8312C"))  # bandana
    T.sphere((-0.36, 0.0, Z + 0.88), (0.14, 0.05, 0.04), T.toon("#D8312C"), outline=0.015)  # bandana tails
    hat = T.toon("#4A3424", shade=0.8)
    T.sphere((0, 0, Z + 1.12), (0.28, 0.28, 0.2), hat, outline=0.03)
    for k in range(3):
        a = math.radians(60 + k * 120)
        T.sphere((0.3 * math.cos(a), 0.3 * math.sin(a), Z + 1.1), (0.06, 0.4, 0.17), hat, outline=0.025, rot=(0, 0.6, a))
    T.sphere((0.37, 0, Z + 1.12), (0.03, 0.07, 0.06), T.toon("#FFFFFF"), outline=0.01)  # skull badge
    T.torus((0, 0, Z + 1.03), 0.33, 0.02, T.toon("#D9B44A"), outline=0)  # gold trim
    # cutlass held in a front tentacle
    T.sphere((0.5, -0.48, Z + 0.7), (0.03, 0.05, 0.32), T.toon("#DDE3EA", shade=0.8), outline=0.015, rot=(0.25, 0, 0))
    T.torus((0.5, -0.43, Z + 0.43), 0.06, 0.018, T.toon("#FFD23F"), outline=0.01)
    T.sphere((0.48, -0.42, Z + 0.32), (0.07, 0.07, 0.12), p, outline=0.02)


def bee_buzz():
    """Toy Story: space-ranger bee - white suit, green chest panel, purple hood, glass helmet, red-tipped wings."""
    y, k = T.toon("#FFD23F"), T.toon("#2B2B3A", shade=0.85)
    white, green, purple = T.toon("#FFFFFF", shade=0.82), T.toon("#6BD13B"), T.toon("#7A4FD8")
    # striped bee abdomen behind
    T.sphere((-0.32, 0, Z + 0.36), (0.3, 0.26, 0.26), y)
    T.torus((-0.36, 0, Z + 0.36), 0.25, 0.045, k, outline=0, rot=(0, math.pi / 2, 0))
    T.torus((-0.5, 0, Z + 0.36), 0.18, 0.045, k, outline=0, rot=(0, math.pi / 2, 0))
    for s in (1, -1):
        T.sphere((0.08, s * 0.15, Z + 0.13), (0.15, 0.12, 0.13), white, outline=0.03)  # boots
        T.sphere((0.12, s * 0.15, Z + 0.06), (0.15, 0.12, 0.05), purple, outline=0.02)
    T.sphere((0.08, 0, Z + 0.52), (0.32, 0.34, 0.36), white)
    T.torus((0.08, 0, Z + 0.3), 0.3, 0.045, purple, outline=0.015)
    T.sphere((0.34, 0, Z + 0.6), (0.07, 0.2, 0.17), green, outline=0.02)
    for i, c in enumerate(("#FF3B3B", "#3AA8FF", "#FFD23F")):
        T.sphere((0.41, -0.1 + i * 0.1, Z + 0.6), (0.025, 0.035, 0.035), T.toon(c), outline=0)
    for s in (1, -1):
        T.sphere((0.1, s * 0.38, Z + 0.55), (0.1, 0.1, 0.2), white, outline=0.03)  # arms
        T.sphere((0.0, s * 0.62, Z + 0.78), (0.12, 0.32, 0.04), white, outline=0.025, rot=(s * -0.35, 0, 0))  # wings
        T.sphere((0.0, s * 0.9, Z + 0.88), (0.1, 0.09, 0.045), T.toon("#FF3B3B"), outline=0.02)
    T.sphere((0.17, -0.4, Z + 0.43), (0.08, 0.06, 0.06), T.toon("#FF3B3B"), outline=0.015)  # wrist laser
    T.sphere((0.06, 0, Z + 0.95), (0.27, 0.29, 0.27), purple)  # hood
    T.sphere((0.17, 0, Z + 0.96), (0.22, 0.22, 0.22), y, outline=0.03)  # bee face
    eyes(0.33, 0, Z + 1.0, r=0.06, sep=0.1)
    T.sphere((0.37, 0, Z + 0.88), (0.02, 0.08, 0.02), T.flat(T.INK, "mouth"), outline=0)
    T.sphere((0.1, 0, Z + 0.97), (0.38, 0.38, 0.37), T.glass(), outline=0.03)
    T.torus((0.08, 0, Z + 0.72), 0.3, 0.04, green, outline=0.015)  # helmet ring


def crab_krabs():
    """SpongeBob: money-loving red crab - tall body, eye stalks, light-blue shirt, money bag."""
    r = T.toon("#FF4A33")
    for s in (1, -1):
        T.cone((0.0, s * 0.16, Z + 0.1), 0.06, 0.0, 0.2, r, outline=0.015, rot=(0, math.pi, 0))
    T.sphere((0, 0, Z + 0.62), (0.4, 0.42, 0.44), r)
    T.sphere((0, 0, Z + 0.44), (0.42, 0.44, 0.27), T.toon("#8FD8FF"))  # shirt
    for s in (1, -1):
        T.sphere((0.33, s * 0.11, Z + 0.68), (0.04, 0.1, 0.07), T.toon("#8FD8FF"), outline=0.015, rot=(s * 0.6, 0, 0))  # collar
    T.torus((0, 0, Z + 0.28), 0.38, 0.03, T.toon("#6A4426"), outline=0.012)
    for s in (1, -1):
        T.cyl((0.16, s * 0.12, Z + 1.12), 0.035, 0.3, r, outline=0.015, verts=10)
        T.sphere((0.18, s * 0.12, Z + 1.3), (0.1, 0.1, 0.1), T.toon("#FFFFFF", shade=0.85), outline=0.025)
        T.sphere((0.26, s * 0.12, Z + 1.3), (0.035, 0.05, 0.05), T.flat(T.INK, "pupil"), outline=0)
        T.sphere((0.2, s * 0.12, Z + 1.42), (0.03, 0.08, 0.02), T.flat(T.INK, "brow"), outline=0, rot=(s * 0.3, 0, 0))
        # big claws raised at the sides
        T.cyl((0.05, s * 0.48, Z + 0.62), 0.05, 0.3, r, outline=0.015, verts=10, rot=(s * 0.9, 0, 0))
        T.sphere((0.12, s * 0.62, Z + 0.82), (0.17, 0.12, 0.17), r, outline=0.03)
        T.sphere((0.26, s * 0.62, Z + 0.95), (0.13, 0.06, 0.07), r, outline=0.02, rot=(0, -0.5, 0))
    T.sphere((0.4, 0, Z + 0.8), (0.03, 0.2, 0.035), T.flat(T.INK, "mouth"), outline=0)
    # money bag with a dollar sign in front
    bag = T.toon("#C9A46A")
    T.sphere((0.55, -0.32, Z + 0.22), (0.2, 0.2, 0.22), bag)
    T.cone((0.55, -0.32, Z + 0.47), 0.05, 0.1, 0.1, bag, outline=0.02)
    text3d("$", (0.74, -0.32, Z + 0.22), 0.26, T.toon("#2E9E4A"))


def penguin_bond():
    """James Bond: tuxedo penguin, black bow tie, raised pistol, confident brow."""
    k, w = T.toon("#2B2B3A", shade=0.85), T.toon("#FFFFFF", shade=0.88)
    for y in (0.12, -0.12):
        T.sphere((0.1, y, Z + 0.04), (0.16, 0.08, 0.04), T.toon("#FF9A2E"), outline=0.02)
    T.sphere((0, 0, Z + 0.55), (0.4, 0.38, 0.55), k)
    T.sphere((0.18, 0, Z + 0.5), (0.26, 0.28, 0.42), w, outline=0)
    # jacket lapels
    for s in (1, -1):
        T.sphere((0.32, s * 0.15, Z + 0.62), (0.05, 0.07, 0.22), k, outline=0.012, rot=(s * 0.35, 0, 0))
    T.sphere((0.36, 0.2, Z + 0.72), (0.04, 0.04, 0.04), T.toon("#FF3B3B"), outline=0.01)  # rose
    T.sphere((0.05, 0, Z + 1.05), (0.3, 0.3, 0.28), k)
    T.sphere((0.24, 0, Z + 1.02), (0.12, 0.2, 0.15), w, outline=0)  # face
    T.cone((0.38, 0, Z + 0.98), 0.07, 0.0, 0.16, T.toon("#FF9A2E"), outline=0.02, rot=(0, math.pi / 2, 0))
    eyes(0.3, 0, Z + 1.1, r=0.06, sep=0.1)
    T.sphere((0.33, 0.1, Z + 1.21), (0.02, 0.07, 0.018), T.flat(T.INK, "brow"), outline=0, rot=(-0.35, 0, 0))
    T.sphere((0.33, -0.1, Z + 1.19), (0.02, 0.07, 0.018), T.flat(T.INK, "brow"), outline=0)
    for s in (1, -1):
        T.sphere((0.37, s * 0.07, Z + 0.84), (0.04, 0.08, 0.06), k, outline=0.015)  # black bow tie
    T.sphere((0.38, 0, Z + 0.84), (0.035, 0.035, 0.035), k, outline=0.01)
    T.sphere((0, 0.4, Z + 0.55), (0.12, 0.06, 0.32), k, outline=0.025, rot=(0.25, 0, 0))
    # raised flipper holding a pistol up, on the camera side
    T.sphere((0.08, -0.42, Z + 0.8), (0.1, 0.06, 0.3), k, outline=0.025, rot=(0.35, 0, 0))
    gun = T.toon("#8A93A0", shade=0.65)
    before = set(bpy.data.objects)
    T.sphere((0.2, -0.5, Z + 1.3), (0.06, 0.05, 0.2), gun, outline=0.015, rot=(0, 0.35, 0))  # slide
    T.cyl((0.27, -0.5, Z + 1.47), 0.03, 0.12, gun, outline=0.012, verts=12, rot=(0, 0.35, 0))  # barrel / silencer
    T.sphere((0.06, -0.5, Z + 1.13), (0.05, 0.045, 0.12), gun, outline=0.015, rot=(0, -0.7, 0))  # grip
    T.torus((0.15, -0.5, Z + 1.11), 0.045, 0.012, gun, outline=0, rot=(math.pi / 2, 0, 0))  # trigger guard
    # turn the pistol so the camera sees its side profile (reads as a gun, not a stick)
    grip = bpy.data.objects.new("gun", None)
    grip.location = (0.14, -0.5, Z + 1.2)
    bpy.context.collection.objects.link(grip)
    bpy.context.view_layer.update()
    for o in set(bpy.data.objects) - before - {grip}:
        o.parent = grip
        o.matrix_parent_inverse = grip.matrix_world.inverted()
    grip.rotation_euler = (0, 0, math.radians(75))
    grip.scale = (1.25, 1.25, 1.25)


def owl_sherlock():
    """Sherlock Holmes: checked deerstalker cap, curved pipe, big magnifying glass."""
    b, c = T.toon("#A0683A"), T.toon("#F2D9B0", shade=0.88)
    T.sphere((0, 0, Z + 0.5), (0.42, 0.4, 0.5), b)
    T.sphere((0.2, 0, Z + 0.45), (0.25, 0.28, 0.35), c, outline=0)
    for s in (1, -1):
        T.sphere((0.34, s * 0.15, Z + 0.78), (0.06, 0.15, 0.15), T.toon("#FFFFFF", shade=0.9), outline=0.025)
        T.sphere((0.38, s * 0.15, Z + 0.78), (0.04, 0.08, 0.08), T.flat(T.INK, "pupil"), outline=0)
    T.cone((0.42, 0, Z + 0.65), 0.05, 0.0, 0.12, T.toon("#FFB020"), outline=0.015, rot=(0, math.pi / 2 + 0.4, 0))
    # deerstalker: crown + front/back peaks + tied ear flaps, checked with dark bands
    cap, band = T.toon("#C9A06A", shade=0.75), T.toon("#6A4A2A")
    T.sphere((0, 0, Z + 1.0), (0.34, 0.32, 0.2), cap, outline=0.03)
    for x, ry in ((0.34, 0.25), (-0.34, -0.25)):
        T.sphere((x, 0, Z + 0.96), (0.16, 0.2, 0.035), cap, outline=0.02, rot=(0, ry, 0))
    for s in (1, -1):
        T.sphere((0, s * 0.3, Z + 0.98), (0.12, 0.05, 0.1), cap, outline=0.015)  # ear flaps
    T.torus((0, 0, Z + 1.04), 0.32, 0.016, band, outline=0)
    T.torus((0, 0, Z + 1.0), 0.29, 0.016, band, outline=0, rot=(math.pi / 2, 0, 0))
    T.torus((0, 0, Z + 1.0), 0.29, 0.016, band, outline=0, rot=(math.pi / 2, 0, math.pi / 2))
    T.sphere((0, 0, Z + 1.2), (0.06, 0.1, 0.04), band, outline=0.012)  # bow on top
    # curved pipe from the beak
    wood = T.toon("#6A3A1E")
    T.cyl((0.46, 0.07, Z + 0.56), 0.02, 0.18, k := T.flat(T.INK, "stem"), outline=0, verts=8, rot=(0, 1.1, 0))
    T.cyl((0.56, 0.07, Z + 0.47), 0.06, 0.14, wood, outline=0.015, verts=16)
    T.cyl((0.56, 0.07, Z + 0.545), 0.045, 0.01, k, outline=0, verts=16)
    # big magnifier on the camera side
    T.torus((0.38, -0.46, Z + 0.62), 0.17, 0.035, T.toon("#FFD23F"), outline=0.015, rot=(0, math.pi / 2, 0.5))
    T.cyl((0.38, -0.46, Z + 0.62), 0.16, 0.01, T.glass(alpha=0.35), outline=0, rot=(0, math.pi / 2, 0.5))
    T.cyl((0.34, -0.5, Z + 0.32), 0.035, 0.3, T.toon("#5A3A22"), outline=0.012, verts=8)


def minion_bacterium():
    """Despicable Me: yellow pill-shaped bacterium in blue overalls with a big goggle and a flagellum tail."""
    y, denim, k = T.toon("#FFD93B"), T.toon("#2E5FA8"), T.flat(T.INK, "ink")
    T.sphere((0, 0, Z + 0.6), (0.34, 0.34, 0.58), y)
    T.sphere((0, 0, Z + 0.28), (0.36, 0.36, 0.28), denim)
    T.sphere((0.27, 0, Z + 0.55), (0.1, 0.18, 0.16), denim, outline=0.02)  # bib
    T.sphere((0.36, 0, Z + 0.52), (0.02, 0.06, 0.05), T.toon("#1A3A70"), outline=0)  # pocket
    for s in (1, -1):
        T.cyl((0.2, s * 0.19, Z + 0.7), 0.025, 0.3, denim, outline=0.01, verts=8, rot=(s * -0.35, 0.3, 0))  # straps
        T.sphere((0.05, s * 0.36, Z + 0.48), (0.07, 0.07, 0.16), y, outline=0.02, rot=(s * -0.3, 0, 0))  # arms
        T.sphere((0.06, s * 0.4, Z + 0.33), (0.07, 0.07, 0.06), T.toon("#2B2B3A"), outline=0.015)  # gloves
        T.sphere((0.04, s * 0.15, Z + 0.03), (0.13, 0.1, 0.05), T.toon("#2B2B3A"), outline=0.015)  # shoes
    T.torus((0, 0, Z + 0.88), 0.34, 0.04, T.toon("#2B2B3A"), outline=0.01)  # goggle strap
    T.torus((0.33, 0, Z + 0.88), 0.14, 0.05, T.toon("#C8CDD5", shade=0.7), outline=0.015, rot=(0, math.pi / 2, 0))
    T.sphere((0.33, 0, Z + 0.88), (0.06, 0.13, 0.13), T.toon("#FFFFFF", shade=0.85), outline=0)
    T.sphere((0.38, 0, Z + 0.87), (0.03, 0.06, 0.06), T.toon("#6A4426"), outline=0)
    T.sphere((0.4, 0, Z + 0.86), (0.015, 0.03, 0.03), k, outline=0)
    T.sphere((0.33, 0, Z + 0.67), (0.02, 0.1, 0.025), k, outline=0)  # grin
    for a in (-0.25, 0.0, 0.25):
        T.cyl((0.02, a * 0.3, Z + 1.24), 0.008, 0.14, k, outline=0, verts=6, rot=(a, 0, 0))  # hair
    # wavy flagellum tail: the "bacterium" part
    for i in range(7):
        T.sphere((-0.36 - i * 0.07, 0.07 * math.sin(i * 1.3), Z + 0.32 - i * 0.025), (0.035, 0.035, 0.035), y, outline=0.01)


def duck_vader():
    """Star Wars: the dark lord in his iconic mask (chibi proportions so the mask reads at piece size):
    big flared helmet, brow ridge, gunmetal faceplate, slanted lenses, triangle grille, cheek vents,
    chest box, cape, red lightsaber."""
    helm = T.toon("#1E1E26", shade=0.55, hi=2.8)
    armor = T.toon("#33333F", shade=0.65, hi=1.8)
    metal = T.toon("#B8BEC8", shade=0.6, hi=1.3)
    for s in (1, -1):
        T.sphere((0.05, s * 0.13, Z + 0.09), (0.13, 0.1, 0.1), helm, outline=0.025)  # boots
    T.cone((-0.1, 0, Z + 0.34), 0.5, 0.25, 0.62, T.toon("#14141A", shade=0.8, hi=1.3), outline=0.035)  # cape
    T.sphere((0.05, 0, Z + 0.4), (0.24, 0.26, 0.26), armor)  # body
    T.torus((0.05, 0, Z + 0.24), 0.24, 0.035, helm, outline=0.01)  # belt
    T.sphere((0.28, 0, Z + 0.45), (0.05, 0.12, 0.08), T.toon("#5A5F6A", shade=0.7), outline=0.012)  # chest box
    for i, c in enumerate(("#FF3B3B", "#3AA8FF", "#5BD65B", "#FFD23F")):
        T.sphere((0.325, -0.06 + (i % 2) * 0.12, Z + 0.43 + (i // 2) * 0.045), (0.018, 0.022, 0.018),
                 T.flat(T.hex_lin(c), "btn%d" % i), outline=0)
    # helmet: wide bell-shaped skirt + big glossy dome
    T.cone((-0.03, 0, Z + 0.84), 0.54, 0.38, 0.3, helm, outline=0.032)
    T.sphere((-0.02, 0, Z + 1.06), (0.41, 0.41, 0.35), helm)
    T.sphere((0.1, -0.22, Z + 1.27), (0.06, 0.13, 0.06), T.flat((0.72, 0.76, 0.92, 1), "shine"), outline=0, rot=(0.8, 0, 0))
    T.sphere((0.34, 0, Z + 1.04), (0.07, 0.34, 0.05), helm, outline=0.02)  # brow ridge
    # gunmetal faceplate with the classic features
    T.sphere((0.31, 0, Z + 0.88), (0.18, 0.3, 0.21), T.toon("#5C6070", shade=0.6, hi=1.6), outline=0.028)
    lens = T.toon("#050508", shade=0.9, hi=3.0)
    for s in (1, -1):
        T.sphere((0.45, s * 0.125, Z + 0.96), (0.045, 0.14, 0.085), lens, outline=0.014, rot=(s * -0.5, 0, 0))
        T.sphere((0.49, s * 0.095, Z + 0.99), (0.008, 0.025, 0.014), T.flat((0.9, 0.9, 1, 1), "glint"), outline=0)
        T.sphere((0.38, s * 0.22, Z + 0.78), (0.035, 0.06, 0.06), metal, outline=0.01)  # cheek vents
    T.cone((0.43, 0, Z + 0.9), 0.035, 0.0, 0.12, T.toon("#5C6070"), outline=0.008)  # nose ridge
    T.cone((0.43, 0, Z + 0.76), 0.13, 0.02, 0.2, metal, outline=0.014, rot=(0, math.pi, 0))  # mouth grille
    for y in (-0.05, 0.0, 0.05):
        T.cyl((0.53, y, Z + 0.78), 0.007, 0.12, T.flat(T.INK, "slit"), outline=0, verts=6)
    # red lightsaber raised on the camera side
    T.sphere((0.14, -0.34, Z + 0.46), (0.08, 0.07, 0.08), armor, outline=0.02)  # glove
    T.cyl((0.15, -0.42, Z + 0.5), 0.035, 0.2, metal, outline=0.012, verts=12, rot=(0.35, 0.2, 0))
    T.cyl((0.24, -0.6, Z + 0.94), 0.05, 0.85, T.flat((1.0, 0.04, 0.04, 1), "saber"), outline=0.022, verts=16, rot=(0.35, 0.2, 0))
    T.cyl((0.24, -0.6, Z + 0.94), 0.022, 0.83, T.flat((1.0, 0.9, 0.85, 1), "core"), outline=0, verts=12, rot=(0.35, 0.2, 0))
    T.cyl((0.24, -0.6, Z + 0.94), 0.09, 0.9, T.glass((1.0, 0.1, 0.05, 1), alpha=0.3), outline=0, verts=16, rot=(0.35, 0.2, 0))

FACE_TURN = {"frog_gandalf": -40, "turtle_ninja": -45, "octopus_sparrow": -45, "bee_buzz": -45,
             "crab_krabs": -35, "penguin_bond": -45, "owl_sherlock": -45, "minion_bacterium": -40, "duck_vader": -58}

FIGS = [duck, egg, mushroom, flask, dna, snail, fish, acorn,
        frog_gandalf, turtle_ninja, octopus_sparrow, bee_buzz, crab_krabs, penguin_bond, owl_sherlock, minion_bacterium, duck_vader]

for i, fig in enumerate(FIGS):
    if ONLY >= 0 and i != ONLY:
        continue
    T._mats.clear()
    T._outline = None
    T.reset(SIZE)
    if not CARD:
        base(COLORS[i])
    before = set(bpy.data.objects)
    fig()
    # turn characters with a face toward the camera (3/4 view) so hats, glasses and eyes read
    turn = FACE_TURN.get(fig.__name__, 0)
    if turn:
        pivot = bpy.data.objects.new("pivot", None)
        bpy.context.collection.objects.link(pivot)
        for o in set(bpy.data.objects) - before:
            if o is not pivot and o.parent is None:
                o.parent = pivot
        pivot.rotation_euler = (0, 0, math.radians(turn))
    T.camera(target=(0, 0, 0.62), el=34 if not CARD else 22, az=30, dist=6.4, lens=85)
    T.render(os.path.join(OUT, f"{'card' if CARD else 'token'}{i}.png"))
    print("rendered", i, flush=True)
