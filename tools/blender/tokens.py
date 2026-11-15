"""Render Monopoly-style metal game pieces with Blender (Cycles).

Run:  blender -b --factory-startup --python tools/blender/tokens.py -- <out_dir> [size] [samples] [only_index]
Each player slot gets its own figure on an enamel base in the player's color.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "tokens"
SIZE = int(argv[1]) if len(argv) > 1 else 512
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
ONLY = int(argv[3]) if len(argv) > 3 else -1
os.makedirs(OUT, exist_ok=True)

# player slot colors (match src/shared/data.ts DUCKS)
COLORS = ["#FFD93B", "#FF5A4A", "#2FD08C", "#9B7BFF", "#3AA8FF", "#FF7DBE", "#FF9A1F", "#F2EEE4"]
NAMES = ["duck", "egg", "mushroom", "flask", "dna", "snail", "fish", "acorn"]


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = -0.35
    # world: soft studio gradient so metal has something to reflect
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    grad = nt.nodes.new("ShaderNodeTexGradient")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.025, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.75, 0.72, 0.68, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.6
    del grad
    return sc


def area(name, loc, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    direction = Vector((0, 0, 0.9)) - Vector(loc)
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


def softbox(loc, scale, strength):
    """Big emissive card: invisible to camera, gives long glossy highlights on metal."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = scale
    direction = Vector((0, 0, 0.9)) - Vector(loc)
    o.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.new("softbox")
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    em = n.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    out = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(em.outputs[0], out.inputs[0])
    o.data.materials.append(m)
    o.visible_camera = False
    o.visible_shadow = False
    return o


def lights():
    area("key", (3.2, -3.0, 4.5), 650, 2.5, (1.0, 0.96, 0.9))
    area("rim", (-3.0, 3.0, 3.0), 500, 2.0, (0.85, 0.9, 1.0))
    area("fill", (-3.5, -2.5, 1.5), 160, 3.0)
    softbox((0, -4, 3.5), (5, 1.2, 1), 3.0)
    softbox((4, 2, 2.5), (1.0, 4, 1), 2.0)


def camera():
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 85
    cam = bpy.data.objects.new("cam", cam_d)
    bpy.context.collection.objects.link(cam)
    # 3/4 view from above, matches the tilted map
    el, az, dist = math.radians(36), math.radians(32), 8.2
    target = Vector((0, 0, 0.78))
    cam.location = target + Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


# ------------------------------------------------------------------ materials
def mat_metal(name="metal", color=(0.78, 0.76, 0.74, 1), rough=0.3):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = color
    p.inputs["Metallic"].default_value = 1.0
    p.inputs["Roughness"].default_value = rough
    return m


def mat_enamel(hexcol):
    m = bpy.data.materials.new("enamel")
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = hex_lin(hexcol)
    p.inputs["Roughness"].default_value = 0.18
    for key in ("Coat Weight", "Clearcoat"):
        if key in p.inputs:
            p.inputs[key].default_value = 1.0
            break
    return m


# ------------------------------------------------------------------ geometry helpers
def smooth(o, levels=2, bevel=0.0):
    bpy.context.view_layer.objects.active = o
    if bevel:
        b = o.modifiers.new("bev", "BEVEL")
        b.width = bevel
        b.segments = 4
    s = o.modifiers.new("sub", "SUBSURF")
    s.levels = levels
    s.render_levels = levels
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def sphere(loc, scale, mat, seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=loc)
    o = bpy.context.object
    o.scale = scale
    for poly in o.data.polygons:
        poly.use_smooth = True
    o.data.materials.append(mat)
    return o


def cyl(loc, r, depth, mat, verts=64, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.data.materials.append(mat)
    return o


def cone(loc, r1, r2, depth, mat, rot=(0, 0, 0), verts=64):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    for poly in o.data.polygons:
        poly.use_smooth = True
    o.data.materials.append(mat)
    return o


def torus(loc, R, r, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=96, minor_segments=24)
    o = bpy.context.object
    for poly in o.data.polygons:
        poly.use_smooth = True
    o.data.materials.append(mat)
    return o


def base(hexcol, metal):
    enamel = mat_enamel(hexcol)
    b = cyl((0, 0, 0.13), 0.95, 0.26, enamel)
    smooth(b, 1, 0.05)
    torus((0, 0, 0.26), 0.9, 0.05, metal)
    torus((0, 0, 0.02), 0.96, 0.04, metal)
    return b


# ------------------------------------------------------------------ figures (stand on z=0.26)
Z = 0.26


def fig_duck(m):
    sphere((0, 0, Z + 0.5), (0.72, 0.52, 0.46), m)
    sphere((0.4, 0, Z + 1.08), (0.38, 0.36, 0.38), m)
    gold = mat_metal("gold", (1.0, 0.72, 0.3, 1), 0.22)
    beak = sphere((0.82, 0, Z + 1.02), (0.22, 0.13, 0.07), gold)
    t = sphere((-0.66, 0, Z + 0.74), (0.22, 0.2, 0.12), m)
    t.rotation_euler = (0, math.radians(-35), 0)
    sphere((-0.05, 0.36, Z + 0.55), (0.42, 0.12, 0.24), m)  # wing
    sphere((-0.05, -0.36, Z + 0.55), (0.42, 0.12, 0.24), m)
    for y in (0.16, -0.16):
        sphere((0.66, y, Z + 1.18), (0.07, 0.07, 0.07), mat_metal("eye", (0.05, 0.05, 0.06, 1), 0.1))


def fig_egg(m):
    sphere((0, 0, Z + 0.78), (0.52, 0.52, 0.72), m)
    torus((0, 0, Z + 0.06), 0.36, 0.07, m)


def fig_mushroom(m):
    stem = sphere((0, 0, Z + 0.45), (0.3, 0.3, 0.5), m)
    del stem
    sphere((0, 0, Z + 0.98), (0.66, 0.66, 0.4), m)
    gold = mat_metal("spot", (1.0, 0.72, 0.3, 1), 0.25)
    for a, r, h in ((0, 0.42, 1.22), (2.1, 0.42, 1.22), (4.2, 0.42, 1.22), (1.0, 0.0, 1.38)):
        sphere((r * math.cos(a), r * math.sin(a), Z + h), (0.13, 0.13, 0.08), gold)


def fig_flask(m):
    cone((0, 0, Z + 0.55), 0.78, 0.22, 1.1, m)
    cyl((0, 0, Z + 1.32), 0.22, 0.5, m)
    torus((0, 0, Z + 1.58), 0.24, 0.06, m)
    torus((0, 0, Z + 0.04), 0.74, 0.06, m)
    gold = mat_metal("gold", (1.0, 0.72, 0.3, 1), 0.22)
    torus((0, 0, Z + 0.45), 0.62, 0.04, gold)
    for (x, y, z, r) in ((0.2, -0.35, 0.6, 0.11), (-0.22, -0.3, 0.38, 0.08), (0.02, -0.2, 0.88, 0.07)):
        sphere((x, y, Z + z), (r, r, r), gold)


def fig_dna(m):
    gold = mat_metal("gold", (1.0, 0.78, 0.35, 1), 0.2)
    n = 11
    for i in range(n):
        t = i / (n - 1)
        z = Z + 0.15 + t * 1.3
        a = t * math.pi * 2.2
        p1 = Vector((0.38 * math.cos(a), 0.38 * math.sin(a), z))
        p2 = Vector((-0.38 * math.cos(a), -0.38 * math.sin(a), z))
        sphere(p1, (0.12, 0.12, 0.12), m)
        sphere(p2, (0.12, 0.12, 0.12), m)
        mid = (p1 + p2) / 2
        d = p2 - p1
        rung = cyl(mid, 0.04, d.length, gold)
        rung.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    cyl((0, 0, Z + 0.06), 0.25, 0.12, m)


def fig_snail(m):
    body = sphere((0.05, 0, Z + 0.17), (0.78, 0.26, 0.17), m)
    del body
    sphere((0.68, 0, Z + 0.42), (0.17, 0.16, 0.26), m)
    for y in (0.07, -0.07):
        cyl((0.74, y, Z + 0.72), 0.025, 0.32, m, verts=16, rot=(math.radians(-12 if y > 0 else 12), 0.2, 0))
        sphere((0.77, y * 1.6, Z + 0.88), (0.05, 0.05, 0.05), m)
    gold = mat_metal("gold", (1.0, 0.78, 0.35, 1), 0.2)
    # spiral shell: shrinking spheres along a spiral
    for i in range(26):
        t = i / 25
        a = t * math.pi * 3.2
        r = 0.5 * (1 - t * 0.85)
        sphere((-0.12 + 0.3 * (1 - t) * math.cos(a) * 0.6, 0, Z + 0.72 + 0.3 * (1 - t) * math.sin(a)), (r * 0.62, r * 0.55, r * 0.62), gold if i > 18 else m)


def fig_fish(m):
    cyl((0, 0, Z + 0.25), 0.08, 0.5, m)
    b = sphere((0, 0, Z + 0.9), (0.6, 0.2, 0.38), m)
    b.rotation_euler = (0, math.radians(-12), 0)
    t = cone((-0.68, 0, Z + 1.03), 0.32, 0.0, 0.42, m, rot=(0, math.radians(-90), 0))
    t.scale = (1, 0.35, 1)
    f = cone((0, 0, Z + 1.3), 0.25, 0.0, 0.3, m)
    f.scale = (1, 0.25, 1)
    for y in (0.17, -0.17):
        sphere((0.38, y, Z + 1.0), (0.06, 0.04, 0.06), mat_metal("eye", (0.05, 0.05, 0.06, 1), 0.1))


def fig_acorn(m):
    gold = mat_metal("gold", (1.0, 0.78, 0.35, 1), 0.25)
    sphere((0, 0, Z + 0.7), (0.46, 0.46, 0.6), m)
    sphere((0, 0, Z + 1.12), (0.52, 0.52, 0.3), gold)
    cyl((0.04, 0, Z + 1.45), 0.06, 0.25, gold, verts=16, rot=(0, 0.3, 0))
    for i in range(16):
        a = i * math.pi / 8
        sphere((0.45 * math.cos(a), 0.45 * math.sin(a), Z + 1.08), (0.07, 0.07, 0.05), gold)


FIGS = [fig_duck, fig_egg, fig_mushroom, fig_flask, fig_dna, fig_snail, fig_fish, fig_acorn]

for i, (fig, name, col) in enumerate(zip(FIGS, NAMES, COLORS)):
    if ONLY >= 0 and i != ONLY:
        continue
    reset()
    lights()
    camera()
    metal = mat_metal()
    base(col, metal)
    fig(metal)
    bpy.context.scene.render.filepath = os.path.join(OUT, f"token{i}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", i, name, flush=True)
