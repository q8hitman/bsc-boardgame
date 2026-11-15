"""Shared toon-rendering kit for Blender (EEVEE): cel shading + thick dark outlines,
matching the cartoon island map. Used by tokens_toon.py and icons.py."""
import math
import os

import bpy
from mathutils import Vector

INK = (0.07, 0.045, 0.03, 1)


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


def reset(size, eevee=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    sc.render.film_transparent = True
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 3.0
    sun_d.use_shadow = False  # outline hulls would shadow the whole piece
    sun = bpy.data.objects.new("sun", sun_d)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(40), math.radians(-25), math.radians(35))
    return sc


_mats = {}


def toon(hexcol, name=None, shade=0.72, hi=1.12):
    """Cel material: 3 flat bands (shadow / base / soft highlight)."""
    key = (hexcol, shade, hi)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name or "toon_" + hexcol)
    m.use_nodes = True
    nt = m.node_tree
    n = nt.nodes
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    diff = n.new("ShaderNodeBsdfDiffuse")
    s2r = n.new("ShaderNodeShaderToRGB")
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    e = ramp.color_ramp.elements
    e[0].position = 0.0
    e[0].color = (shade, shade, shade, 1)
    e[1].position = 0.28
    e[1].color = (1, 1, 1, 1)
    e3 = e.new(0.82)
    e3.color = (hi, hi, hi, 1)
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[7].default_value = hex_lin(hexcol)  # B color
    em = n.new("ShaderNodeEmission")
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs[6])  # A color
    nt.links.new(mix.outputs[2], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs[0])
    _mats[key] = m
    return m


def flat(rgba, name="flat"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    em = n.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba
    out = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(em.outputs[0], out.inputs[0])
    return m


_outline = None


def outline_mat():
    global _outline
    if _outline is None:
        _outline = flat(INK, "outline")
        _outline.use_backface_culling = True
    return _outline


def add_outline(o, thickness):
    """Inverted-hull outline."""
    o.data.materials.append(outline_mat())
    mod = o.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(o.data.materials) - 1


def finish(o, mat, outline=0.045, smooth=True):
    if mat:
        o.data.materials.append(mat)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if outline:
        add_outline(o, outline)
    return o


def sphere(loc, scale, mat, outline=0.045, seg=48, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, mat, outline)


def cyl(loc, r, depth, mat, outline=0.045, verts=64, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    bev = o.modifiers.new("bev", "BEVEL")
    bev.width = min(r, depth) * 0.25
    bev.segments = 3
    return finish(o, mat, outline)


def cone(loc, r1, r2, depth, mat, outline=0.045, rot=(0, 0, 0), verts=64):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.object, mat, outline)


def torus(loc, R, r, mat, outline=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=96, minor_segments=24)
    return finish(bpy.context.object, mat, outline)


def camera(target=(0, 0, 0.7), el=36, az=32, dist=8.2, lens=85, ortho=None):
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = lens
    if ortho:
        cam_d.type = "ORTHO"
        cam_d.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cam_d)
    bpy.context.collection.objects.link(cam)
    t = Vector(target)
    e, a = math.radians(el), math.radians(az)
    cam.location = t + Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def ground_shadow(r=0.8, ry=None, z=0.0, alpha=0.32, x=0.0):
    """Soft dark disc under an object so icons sit on the ground instead of floating."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1, depth=0.002, location=(x, 0, z))
    o = bpy.context.object
    o.scale = (r, ry if ry else r * 0.55, 1)
    m = bpy.data.materials.new("shadow")
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    tr = n.new("ShaderNodeBsdfTransparent")
    em = n.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.02, 0.03, 0.06, 1)
    mix = n.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    out = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(tr.outputs[0], mix.inputs[1])
    m.node_tree.links.new(em.outputs[0], mix.inputs[2])
    m.node_tree.links.new(mix.outputs[0], out.inputs[0])
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    o.data.materials.append(m)
    return o


def glass(rgba=(0.85, 0.95, 1.0, 1), alpha=0.22):
    """See-through tinted glass (helmets, bubbles)."""
    m = bpy.data.materials.new("glass")
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    tr = n.new("ShaderNodeBsdfTransparent")
    em = n.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba
    mix = n.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    out = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(tr.outputs[0], mix.inputs[1])
    m.node_tree.links.new(em.outputs[0], mix.inputs[2])
    m.node_tree.links.new(mix.outputs[0], out.inputs[0])
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    return m
