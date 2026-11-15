"""Cartoon UI icons in the same toon style as the pieces (replaces emoji).

Run: blender -b --factory-startup --python tools/blender/icons.py -- <out_dir_abs> [size] [only_name]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toon as T  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0]
SIZE = int(argv[1]) if len(argv) > 1 else 256
ONLY = argv[2] if len(argv) > 2 else ""


def extrude_poly(points, depth, mat, outline=0.05, z=0.0):
    """Flat 2D shape (x,y points) extruded along z, standing up facing the camera (-y)."""
    mesh = bpy.data.meshes.new("poly")
    n = len(points)
    verts = [(x, -depth / 2, y) for x, y in points] + [(x, depth / 2, y) for x, y in points]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new("poly", mesh)
    bpy.context.collection.objects.link(o)
    o.location.z = z
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bev = o.modifiers.new("bev", "BEVEL")
    bev.width = depth * 0.35
    bev.segments = 4
    bev.limit_method = "ANGLE"
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = False
    T.add_outline(o, outline)
    return o


def star():
    pts = []
    for i in range(10):
        r = 0.42 if i % 2 else 1.0
        a = math.pi / 2 + i * math.pi / 5
        pts.append((math.cos(a) * r, math.sin(a) * r))
    extrude_poly(pts, 0.38, T.toon("#FFD23F", shade=0.78), outline=0.06)
    T.sphere((-0.18, -0.24, 0.32), (0.13, 0.05, 0.09), T.flat((1, 1, 1, 1), "w"), outline=0)


def bread():
    crust = T.toon("#E89A3C")
    T.sphere((0, 0, 0), (0.95, 0.5, 0.5), crust, outline=0.06)
    cuts = T.toon("#FFD98A", shade=0.9)
    for x in (-0.45, 0.0, 0.45):
        c = T.sphere((x, -0.12, 0.42), (0.09, 0.3, 0.06), cuts, outline=0.02)
        c.rotation_euler = (0, math.radians(25), 0)


def shield():
    pts = [(-0.75, 0.85), (0.75, 0.85), (0.75, 0.1), (0.45, -0.5), (0.0, -0.95), (-0.45, -0.5), (-0.75, 0.1)]
    extrude_poly(pts, 0.3, T.toon("#3AA8FF", shade=0.78), outline=0.06)
    inner = [(x * 0.62, y * 0.62 + 0.05) for x, y in pts]
    extrude_poly(inner, 0.36, T.toon("#FFFFFF", shade=0.9), outline=0.0)
    pl = [(-0.12, 0.4), (0.12, 0.4), (0.12, 0.1), (0.38, 0.1), (0.38, -0.12), (0.12, -0.12), (0.12, -0.45), (-0.12, -0.45), (-0.12, -0.12), (-0.38, -0.12), (-0.38, 0.1), (-0.12, 0.1)]
    extrude_poly(pl, 0.42, T.toon("#FF5A4A", shade=0.8), outline=0.0)


def glove():
    g = T.toon("#B989FF", shade=0.75)
    T.sphere((0, 0, -0.15), (0.55, 0.32, 0.55), g, outline=0.06)
    for i, x in enumerate((-0.33, -0.11, 0.11, 0.33)):
        T.sphere((x, 0, 0.42 + (0.06 if i in (1, 2) else 0)), (0.13, 0.22, 0.3), g, outline=0.05)
    T.sphere((-0.6, 0, -0.05), (0.25, 0.2, 0.13), g, outline=0.05)
    T.cyl((0, 0, -0.78), 0.45, 0.25, T.toon("#FFFFFF", shade=0.85), outline=0.05)


def dice():
    bpy.ops.mesh.primitive_cube_add(size=1.3, location=(0, 0, 0), rotation=(math.radians(18), math.radians(-12), math.radians(30)))
    o = bpy.context.object
    b = o.modifiers.new("bev", "BEVEL")
    b.width = 0.18
    b.segments = 6
    o.data.materials.append(T.toon("#FFFFFF", shade=0.75))
    for p in o.data.polygons:
        p.use_smooth = True
    T.add_outline(o, 0.06)
    pip = T.flat((0.9, 0.2, 0.18, 1), "pip")
    # pips on the three visible faces, placed in the cube's local frame
    faces = {(0, -1, 0): [(0, 0)], (1, 0, 0): [(-0.3, -0.3), (0.3, 0.3)], (0, 0, 1): [(-0.3, -0.3), (0, 0), (0.3, 0.3)]}
    for nrm, spots in faces.items():
        n = Vector(nrm)
        for u, v in spots:
            if n.y:
                local = Vector((u, -0.66, v))
            elif n.x:
                local = Vector((0.66, u, v))
            else:
                local = Vector((u, v, 0.66))
            world = o.matrix_world @ local
            s = T.sphere(world, (0.11, 0.11, 0.11), pip, outline=0)
            s.scale = (1, 1, 0.35)
            s.rotation_euler = (o.matrix_world.to_3x3() @ n).to_track_quat("Z", "Y").to_euler()


def crown():
    pts = [(-0.9, -0.5), (0.9, -0.5), (0.95, 0.55), (0.45, 0.05), (0.0, 0.75), (-0.45, 0.05), (-0.95, 0.55)]
    extrude_poly(pts, 0.4, T.toon("#FFD23F", shade=0.78), outline=0.06)
    for x, c in ((-0.45, "#FF5A6E"), (0.0, "#3AA8FF"), (0.45, "#2FD08C")):
        T.sphere((x, -0.24, -0.2), (0.13, 0.08, 0.13), T.toon(c), outline=0.03)


def trophy():
    T.ground_shadow(0.7, 0.3, z=-0.78)
    gold = T.toon("#FFC43A", shade=0.75)
    T.cone((0, 0, 0.3), 0.32, 0.72, 0.85, gold, outline=0.06)
    for s in (1, -1):
        T.torus((s * 0.72, 0, 0.35), 0.24, 0.07, gold, outline=0.04, rot=(math.pi / 2, 0, 0))
    T.cyl((0, 0, -0.32), 0.1, 0.45, gold, outline=0.04)
    T.cyl((0, 0, -0.65), 0.5, 0.22, T.toon("#8A5A2B"), outline=0.05)
    T.sphere((-0.22, -0.4, 0.45), (0.08, 0.05, 0.2), T.flat((1, 1, 1, 1), "w"), outline=0)


def clock():
    T.cyl((0, 0, 0), 0.85, 0.3, T.toon("#FF5A6E", shade=0.75), outline=0.06, rot=(math.pi / 2, 0, 0))
    T.cyl((0, -0.12, 0), 0.68, 0.12, T.toon("#FFFFFF", shade=0.9), outline=0.0, rot=(math.pi / 2, 0, 0))
    ink = T.flat(T.INK, "ink")
    T.cyl((0, -0.2, 0.22), 0.05, 0.45, ink, outline=0, verts=12)
    h = T.cyl((0.16, -0.2, 0.0), 0.05, 0.34, ink, outline=0, verts=12, rot=(0, math.pi / 2, 0))
    del h
    for s in (1, -1):
        T.sphere((s * 0.5, 0, 0.85), (0.24, 0.2, 0.2), T.toon("#FFD23F"), outline=0.04)


def boat():
    """Rowing boat sitting IN the water (water puddle, ripples), oars dipping in."""
    T.cyl((0, 0, -0.62), 1.15, 0.06, T.toon("#4FC3F7", shade=0.85), outline=0.05)
    rip = T.toon("#E6F8FF", shade=0.95)
    T.torus((0, 0, -0.58), 1.0, 0.03, rip, outline=0)
    T.torus((0.35, 0.1, -0.58), 0.45, 0.025, rip, outline=0)
    hull = T.toon("#C9773A", shade=0.72)
    h = T.sphere((0, 0, -0.45), (0.95, 0.42, 0.42), hull, outline=0.06)
    del h
    T.cyl((0, 0, -0.18), 0.82, 0.02, T.toon("#8A4E22"), outline=0, rot=(0, 0, 0))  # inside of hull
    T.sphere((0.0, 0, -0.16), (0.75, 0.3, 0.05), T.toon("#7A4219"), outline=0)
    T.cyl((0.0, 0, -0.1), 0.06, 0.6, T.toon("#E8C77A"), outline=0.02, verts=12, rot=(math.pi / 2, 0, 0))  # bench
    oar = T.toon("#F2D48C")
    for s in (1, -1):
        T.cyl((0.1, s * 0.62, -0.32), 0.04, 1.0, oar, outline=0.02, verts=12, rot=(s * math.radians(62), 0, math.radians(-20)))
        b = T.sphere((0.25, s * 1.02, -0.56), (0.18, 0.08, 0.05), oar, outline=0.02)
        del b
    # a little flag so it reads as "our" race boat
    T.cyl((-0.55, 0, 0.15), 0.03, 0.75, T.toon("#7A4A22"), outline=0.015, verts=8)
    flag = [(0.0, 0.0), (0.42, -0.1), (0.0, -0.25)]
    extrude_poly(flag, 0.04, T.toon("#FF5A4A"), outline=0.03, z=0.0)
    for o in bpy.context.scene.objects:
        if o.name.startswith("poly") and o.location.z == 0.0 and o.data.vertices[0].co.x == 0.0:
            o.location = (-0.55, 0, 0.5)


def fox():
    """Unmistakable fox: long pointed snout, big ears with dark tips, white cheeks/chest,
    dark socks, and a huge bushy tail with a white tip. Standing on the ground."""
    T.ground_shadow(0.95, 0.4, z=-0.88)
    o, w, k = T.toon("#FF7A1A", shade=0.72), T.toon("#FFFFFF", shade=0.88), T.toon("#3A2418", shade=0.8)
    # tail first (behind)
    t = T.sphere((-0.68, 0.0, 0.02), (0.5, 0.28, 0.26), o)
    t.rotation_euler = (0, math.radians(-42), 0)
    T.sphere((-0.98, 0.0, 0.36), (0.2, 0.19, 0.19), w, outline=0.04)
    # legs with dark socks
    for x, y in ((0.32, 0.14), (0.32, -0.14), (-0.3, 0.14), (-0.3, -0.14)):
        T.cyl((x, y, -0.62), 0.07, 0.5, k, outline=0.03, verts=16)
    T.sphere((0, 0, -0.25), (0.6, 0.3, 0.3), o)  # body
    T.sphere((0.38, 0, -0.18), (0.22, 0.22, 0.26), w, outline=0.03)  # chest
    T.sphere((0.55, 0, 0.32), (0.3, 0.27, 0.27), o)  # head
    T.sphere((0.62, 0, 0.2), (0.24, 0.24, 0.16), w, outline=0.0)  # cheeks
    sn = T.cone((0.93, 0, 0.2), 0.15, 0.03, 0.42, o, outline=0.04, rot=(0, math.radians(90), 0))
    del sn
    T.sphere((1.15, 0, 0.21), (0.065, 0.065, 0.06), T.flat(T.INK, "nose"), outline=0)
    for s in (1, -1):
        T.cone((0.47, s * 0.16, 0.66), 0.13, 0.0, 0.36, o, outline=0.04, rot=(s * -0.18, -0.15, 0))
        T.cone((0.47, s * 0.16, 0.8), 0.06, 0.0, 0.14, k, outline=0, rot=(s * -0.18, -0.15, 0))
        T.sphere((0.74, s * 0.13, 0.4), (0.04, 0.035, 0.07), T.flat(T.INK, "eye"), outline=0)


def rooster():
    T.ground_shadow(0.7, 0.32, z=-0.92)
    body = T.toon("#FFFFFF", shade=0.8)
    for x in (0.1, -0.15):
        T.cyl((x, 0, -0.72), 0.05, 0.4, T.toon("#FFB020"), outline=0.025, verts=12)
    T.sphere((0, 0, -0.25), (0.58, 0.42, 0.48), body)
    T.sphere((0.35, 0, 0.38), (0.3, 0.28, 0.32), body)
    red = T.toon("#FF4040", shade=0.75)
    for i, x in enumerate((0.2, 0.35, 0.5)):
        T.sphere((x, 0, 0.72 + (0.06 if i == 1 else 0)), (0.11, 0.08, 0.14), red, outline=0.03)
    T.cone((0.72, 0, 0.36), 0.12, 0.0, 0.25, T.toon("#FFB020"), outline=0.03, rot=(0, math.pi / 2, 0))
    T.sphere((0.58, 0, 0.18), (0.07, 0.06, 0.12), red, outline=0.02)
    for i, c in enumerate(("#2FD08C", "#3AA8FF", "#9B7BFF")):
        t = T.sphere((-0.58, 0, 0.0 + i * 0.18), (0.3, 0.1, 0.1), T.toon(c), outline=0.03)
        t.rotation_euler = (0, math.radians(-40 - i * 15), 0)
    T.sphere((0.48, -0.25, 0.45), (0.05, 0.04, 0.07), T.flat(T.INK, "eye"), outline=0)


def gift():
    T.ground_shadow(0.95, 0.42, z=-0.7)
    T.cyl((0, 0, -0.2), 0.0001, 0.0001, T.toon("#FFFFFF"), outline=0)
    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, -0.2), rotation=(0, 0, math.radians(30)))
    o = bpy.context.object
    o.scale = (1, 1, 0.8)
    b = o.modifiers.new("bev", "BEVEL")
    b.width = 0.06
    o.data.materials.append(T.toon("#2FD08C", shade=0.72))
    T.add_outline(o, 0.06)
    rib = T.toon("#FFD23F", shade=0.8)
    for r in (0, 90):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.2), rotation=(0, 0, math.radians(30 + r)))
        o2 = bpy.context.object
        o2.scale = (1.24, 0.2, 0.98)
        o2.data.materials.append(rib)
    for s in (1, -1):
        bow = T.sphere((s * 0.22, 0, 0.42), (0.25, 0.12, 0.16), rib, outline=0.04)
        bow.rotation_euler = (0, s * 0.5, math.radians(30))


ICONS = dict(star=star, bread=bread, shield=shield, glove=glove, dice=dice, crown=crown, trophy=trophy,
             clock=clock, boat=boat, fox=fox, rooster=rooster, gift=gift)

for name, fn in ICONS.items():
    if ONLY and name != ONLY:
        continue
    T._mats.clear()
    T._outline = None
    T.reset(SIZE)
    fn()
    az = 32 if name in ("fox", "rooster", "boat", "dice", "gift", "trophy", "bread") else 0
    T.camera(target=(0, 0, -0.05), el=22, az=az, dist=10, lens=85, ortho=3.0)
    T.render(os.path.join(OUT, f"{name}.png"))
    print("rendered", name, flush=True)
