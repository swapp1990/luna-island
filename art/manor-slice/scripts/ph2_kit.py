"""Phase 2 modular late-14th-c. Franconian timber-framing kit.

All geometry procedural (original), all materials nodal (no image textures),
seeded irregularity (sagging ridges, wandering rails, off-center details).
Builds -> arranges display row -> renders -> self-verifies patch colors.

Run inside Blender via tools/blender_client.py exec scripts/ph2_kit.py
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from bpy_extras import object_utils
from mathutils import Matrix, Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
REN = os.path.join(ROOT, "renders")
TMP = os.path.join(REN, "_ph2_kit.png")
FINAL = os.path.join(REN, "ph2_kit.png")

SEED = 20260824
rng = random.Random(SEED)

PURGE_OBJ = (
    "fv_kit_", "fv_roof_", "fv_wall_", "fv_door_", "fv_window_", "fv_cam_kit",
)


def dec(u):
    return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return (
        dec(int(h[1:3], 16) / 255.0),
        dec(int(h[3:5], 16) / 255.0),
        dec(int(h[5:7], 16) / 255.0),
        1.0,
    )


for ob in list(bpy.data.objects):
    if any(ob.name.startswith(p) for p in PURGE_OBJ):
        bpy.data.objects.remove(ob, do_unlink=True)
try:
    bpy.data.orphans_purge(do_recursive=True)
except Exception:
    pass

scene = bpy.context.scene
BCOLL = bpy.data.collections["fv_Buildings"]
LCOLL = bpy.data.collections["fv_Lookdev"]


def set_in(sock_list, name, val):
    try:
        sock_list[name].default_value = val
    except Exception:
        pass


class Mix:
    def __init__(self, m, blend="MIX", fac=0.0):
        nt = m.node_tree
        self.legacy = True
        try:
            self.n = nt.nodes.new("ShaderNodeMixRGB")
            self.n.blend_type = blend
        except Exception:
            self.legacy = False
            self.n = nt.nodes.new("ShaderNodeMix")
            self.n.data_type = "RGBA"
            try:
                self.n.blend_type = blend
            except Exception:
                pass
        self.fac_in().default_value = fac

    def fac_in(self):
        return self.n.inputs[0]

    def a_in(self):
        return self.n.inputs[1] if self.legacy else self.n.inputs[6]

    def b_in(self):
        return self.n.inputs[2] if self.legacy else self.n.inputs[7]

    @property
    def out(self):
        return self.n.outputs[0] if self.legacy else self.n.outputs[2]


def new_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def bsdf_of(m):
    return m.node_tree.nodes["Principled BSDF"]


def noise_ramp(m, scale, lo, hi, detail=3.0, dist=0.0):
    nt = m.node_tree
    nz = nt.nodes.new("ShaderNodeTexNoise")
    set_in(nz.inputs, "Scale", scale)
    set_in(nz.inputs, "Detail", detail)
    try:
        nz.inputs["Distortion"].default_value = dist
    except Exception:
        pass
    rp = nt.nodes.new("ShaderNodeValToRGB")
    rp.color_ramp.elements[0].position = 0.35
    rp.color_ramp.elements[0].color = hexlin(lo)
    rp.color_ramp.elements[1].position = 0.65
    rp.color_ramp.elements[1].color = hexlin(hi)
    nt.links.new(nz.outputs["Fac"], rp.inputs["Fac"])
    return rp


M_OAK = new_mat("fv_mat_oak")
b = bsdf_of(M_OAK)
b.inputs["Base Color"].default_value = hexlin("#4A3826")
set_in(b.inputs, "Roughness", 0.82)
rp = noise_ramp(M_OAK, 9.0, "#3E2E1E", "#57432E", dist=0.8)
nt = M_OAK.node_tree
mp = nt.nodes.new("ShaderNodeMapping")
set_in(mp.inputs, "Scale", (7.0, 7.0, 0.7))
tcn = nt.nodes.new("ShaderNodeTexCoord")
nt.links.new(tcn.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], rp.inputs["Fac"])
nt.links.new(rp.outputs["Color"], b.inputs["Base Color"])

M_OAKW = new_mat("fv_mat_oak_weathered")
b = bsdf_of(M_OAKW)
b.inputs["Base Color"].default_value = hexlin("#5C5142")
set_in(b.inputs, "Roughness", 0.88)
rp = noise_ramp(M_OAKW, 11.0, "#4A4034", "#6A6050", dist=0.6)
nt = M_OAKW.node_tree
mp = nt.nodes.new("ShaderNodeMapping")
set_in(mp.inputs, "Scale", (6.0, 6.0, 0.6))
tcn = nt.nodes.new("ShaderNodeTexCoord")
nt.links.new(tcn.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], rp.inputs["Fac"])
nt.links.new(rp.outputs["Color"], b.inputs["Base Color"])


def plaster_mat(name, hexv):
    m = new_mat(name)
    b = bsdf_of(m)
    b.inputs["Base Color"].default_value = hexlin(hexv)
    set_in(b.inputs, "Roughness", 0.93)
    rp = noise_ramp(m, 16.0, hexv, "#D8CFBA" if name.endswith("whitewash") else "#C9BFa6".upper())
    nt = m.node_tree
    nt.links.new(rp.outputs["Color"], b.inputs["Base Color"])
    bmp = nt.nodes.new("ShaderNodeBump")
    set_in(bmp.inputs, "Strength", 0.12)
    nz = nt.nodes.new("ShaderNodeTexNoise")
    set_in(nz.inputs, "Scale", 22.0)
    nt.links.new(nz.outputs["Fac"], bmp.inputs["Height"])
    nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])
    return m


M_PL_WH = plaster_mat("fv_mat_plaster_whitewash", "#EFE9DA")
M_PL_OC = plaster_mat("fv_mat_plaster_ochre", "#D9B878")
M_PL_WT = plaster_mat("fv_mat_plaster_weathered", "#B9B4A6")

M_STONE = new_mat("fv_mat_stone_field")
b = bsdf_of(M_STONE)
set_in(b.inputs, "Roughness", 0.95)
nt = M_STONE.node_tree
tcn = nt.nodes.new("ShaderNodeTexCoord")
vor = nt.nodes.new("ShaderNodeTexVoronoi")
vor.feature = "DISTANCE_TO_EDGE"
set_in(vor.inputs, "Scale", 4.2)
nt.links.new(tcn.outputs["Object"], vor.inputs["Vector"])
vcol = nt.nodes.new("ShaderNodeTexVoronoi")
vcol.feature = "F1"
set_in(vcol.inputs, "Scale", 4.2)
nt.links.new(tcn.outputs["Object"], vcol.inputs["Vector"])
mixv = Mix(M_STONE, "MULTIPLY", 0.25)
nt.links.new(vcol.outputs["Color"], mixv.a_in())
set_in(mixv.b_in(), "default_value", hexlin("#9A927F"))
thr = nt.nodes.new("ShaderNodeMath")
thr.operation = "LESS_THAN"
set_in(thr.inputs[1], "default_value", 0.045)
nt.links.new(vor.outputs["Distance"], thr.inputs[0])
mortar = Mix(M_STONE, "MIX", 0.0)
nt.links.new(thr.outputs["Value"], mortar.fac_in())
nt.links.new(mixv.out, mortar.a_in())
set_in(mortar.b_in(), "default_value", hexlin("#A39B8B"))
nt.links.new(mortar.out, b.inputs["Base Color"])
bmp = nt.nodes.new("ShaderNodeBump")
set_in(bmp.inputs, "Strength", 0.55)
inv = nt.nodes.new("ShaderNodeMath")
inv.operation = "SUBTRACT"
set_in(inv.inputs[0], "default_value", 1.0)
nt.links.new(vor.outputs["Distance"], inv.inputs[1])
nt.links.new(inv.outputs["Value"], bmp.inputs["Height"])
nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])

M_THATCH = new_mat("fv_mat_thatch")
b = bsdf_of(M_THATCH)
set_in(b.inputs, "Roughness", 0.97)
nt = M_THATCH.node_tree
clumps = noise_ramp(M_THATCH, 7.5, "#6E6248", "#94845F", dist=1.2)
grad = nt.nodes.new("ShaderNodeMapRange")
set_in(grad.inputs, "From Min", 0.0)
set_in(grad.inputs, "From Max", 3.6)
tcn = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tcn.outputs["Object"], sep.inputs["Vector"])
nt.links.new(sep.outputs["Z"], grad.inputs["Value"])
eramp = nt.nodes.new("ShaderNodeValToRGB")
eramp.color_ramp.elements[0].position = 0.0
eramp.color_ramp.elements[0].color = hexlin("#5E5340")
eramp.color_ramp.elements[1].position = 0.85
eramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
nt.links.new(grad.outputs["Result"], eramp.inputs["Fac"])
muln = Mix(M_THATCH, "MULTIPLY", 1.0)
nt.links.new(clumps.outputs["Color"], muln.a_in())
nt.links.new(eramp.outputs["Color"], muln.b_in())
nt.links.new(muln.out, b.inputs["Base Color"])
bmp = nt.nodes.new("ShaderNodeBump")
set_in(bmp.inputs, "Strength", 0.45)
nz = nt.nodes.new("ShaderNodeTexNoise")
set_in(nz.inputs, "Scale", 30.0)
set_in(nz.inputs, "Detail", 4.0)
nt.links.new(nz.outputs["Fac"], bmp.inputs["Height"])
nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])

M_SHINGLE = new_mat("fv_mat_shingle")
b = bsdf_of(M_SHINGLE)
set_in(b.inputs, "Roughness", 0.9)
nt = M_SHINGLE.node_tree
tcn = nt.nodes.new("ShaderNodeTexCoord")
brk = nt.nodes.new("ShaderNodeTexBrick")
set_in(brk.offset, "default_value", 0.5) if hasattr(brk, "offset") else None
set_in(brk.inputs, "Color1", hexlin("#7C8378"))
set_in(brk.inputs, "Color2", hexlin("#6E746A"))
set_in(brk.inputs, "Mortar", hexlin("#565B52"))
set_in(brk.inputs, "Scale", 1.0)
set_in(brk.inputs, "Brick Width", 0.32)
set_in(brk.inputs, "Row Height", 0.14)
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Rotation"].default_value[1] = math.radians(-90.0)
set_in(mp.inputs, "Scale", (1.0, 1.0, 1.0))
nt.links.new(tcn.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], brk.inputs["Vector"])
nz = nt.nodes.new("ShaderNodeTexNoise")
set_in(nz.inputs, "Scale", 18.0)
mixg = nt.nodes.new("ShaderNodeMixRGB")
mixg.blend_type = "OVERLAY"
set_in(mixg.inputs, "Fac", 0.3)
nt.links.new(brk.outputs["Color"], mixg.inputs[1])
nt.links.new(nz.outputs["Color"], mixg.inputs[2])
nt.links.new(mixg.outputs["Color"], b.inputs["Base Color"])
bmp = nt.nodes.new("ShaderNodeBump")
set_in(bmp.inputs, "Strength", 0.5)
nt.links.new(brk.outputs["Fac"], bmp.inputs["Height"])
nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])

M_TILE = new_mat("fv_mat_tile_clay")
b = bsdf_of(M_TILE)
set_in(b.inputs, "Roughness", 0.85)
nt = M_TILE.node_tree
tcn = nt.nodes.new("ShaderNodeTexCoord")
brk = nt.nodes.new("ShaderNodeTexBrick")
set_in(brk.inputs, "Color1", hexlin("#9C5F3C"))
set_in(brk.inputs, "Color2", hexlin("#8A4A38"))
set_in(brk.inputs, "Mortar", hexlin("#4A3A30"))
set_in(brk.inputs, "Scale", 1.0)
set_in(brk.inputs, "Brick Width", 0.28)
set_in(brk.inputs, "Row Height", 0.16)
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Rotation"].default_value[1] = math.radians(-90.0)
nt.links.new(tcn.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], brk.inputs["Vector"])
tint = noise_ramp(M_TILE, 3.0, "#8A4A38", "#A56A44")
mixt = Mix(M_TILE, "MIX", 0.45)
nt.links.new(brk.outputs["Color"], mixt.a_in())
nt.links.new(tint.outputs["Color"], mixt.b_in())
mos_nz = nt.nodes.new("ShaderNodeTexNoise")
set_in(mos_nz.inputs, "Scale", 1.1)
mos_thr = nt.nodes.new("ShaderNodeMath")
mos_thr.operation = "GREATER_THAN"
set_in(mos_thr.inputs[1], "default_value", 0.62)
nt.links.new(mos_nz.outputs["Fac"], mos_thr.inputs[0])
lap_nz = nt.nodes.new("ShaderNodeTexNoise")
set_in(lap_nz.inputs, "Scale", 9.0)
lap_thr = nt.nodes.new("ShaderNodeMath")
lap_thr.operation = "GREATER_THAN"
set_in(lap_thr.inputs[1], "default_value", 0.45)
nt.links.new(lap_nz.outputs["Fac"], lap_thr.inputs[0])
both = nt.nodes.new("ShaderNodeMath")
both.operation = "MULTIPLY"
nt.links.new(mos_thr.outputs["Value"], both.inputs[0])
nt.links.new(lap_thr.outputs["Value"], both.inputs[1])
mos_mix = Mix(M_TILE, "MIX", 0.0)
nt.links.new(both.outputs["Value"], mos_mix.fac_in())
nt.links.new(mixt.out, mos_mix.a_in())
set_in(mos_mix.b_in(), "default_value", hexlin("#6E705C"))
nt.links.new(mos_mix.out, b.inputs["Base Color"])
bmp = nt.nodes.new("ShaderNodeBump")
set_in(bmp.inputs, "Strength", 0.6)
nt.links.new(brk.outputs["Fac"], bmp.inputs["Height"])
nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])

M_IRON = new_mat("fv_mat_iron")
b = bsdf_of(M_IRON)
b.inputs["Base Color"].default_value = hexlin("#26262A")
set_in(b.inputs, "Roughness", 0.45)
set_in(b.inputs, "Metallic", 0.75)

M_VOID = new_mat("fv_mat_opening_void")
b = bsdf_of(M_VOID)
b.inputs["Base Color"].default_value = hexlin("#14100C")
set_in(b.inputs, "Roughness", 1.0)

MATS = {
    "oak": M_OAK, "oakw": M_OAKW, "pl_wh": M_PL_WH, "pl_oc": M_PL_OC,
    "pl_wt": M_PL_WT, "stone": M_STONE, "thatch": M_THATCH,
    "shingle": M_SHINGLE, "tile": M_TILE, "iron": M_IRON, "void": M_VOID,
}


def weld_recalc(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()


def finish(name, me, mats, smooth=False, coll=None):
    me.validate()
    ob = bpy.data.objects.new(name, me)
    (coll or BCOLL).objects.link(ob)
    for m in mats:
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def grid_box(dims, segs, off=(0.0, 0.0, 0.0)):
    sx, sy, sz = dims
    nx, ny, nz = segs
    ox, oy, oz = off
    verts = []
    faces = []

    def plane(nu, nv, f):
        base = len(verts)
        for j in range(nv + 1):
            for i in range(nu + 1):
                verts.append(f(i / nu, j / nv))
        for j in range(nv):
            for i in range(nu):
                a = base + j * (nu + 1) + i
                faces.append((a, a + 1, a + nu + 2, a + nu + 1))

    plane(ny, nz, lambda u, v: (ox - sx / 2, oy + u * sy - sy / 2, oz + v * sz - sz / 2))
    plane(ny, nz, lambda u, v: (ox + sx / 2, oy + u * sy - sy / 2, oz + v * sz - sz / 2))
    plane(nx, nz, lambda u, v: (ox + u * sx - sx / 2, oy - sy / 2, oz + v * sz - sz / 2))
    plane(nx, nz, lambda u, v: (ox + u * sx - sx / 2, oy + sy / 2, oz + v * sz - sz / 2))
    plane(nx, ny, lambda u, v: (ox + u * sx - sx / 2, oy + v * sy - sy / 2, oz - sz / 2))
    plane(nx, ny, lambda u, v: (ox + u * sx - sx / 2, oy + v * sy - sy / 2, oz + sz / 2))
    me = bpy.data.meshes.new("tmp")
    me.from_pydata(verts, [], faces)
    weld_recalc(me)
    return me


def warp(me, fn):
    for v in me.vertices:
        fn(v.co)
    me.update()
    return me


def beam(name, ln, sq, axis="X", segs=8, sag=0.012, wander=0.015, mat=M_OAK):
    if axis == "X":
        dims, sg = (ln, sq, sq), (segs, 1, 1)
    else:
        dims, sg = (sq, sq, ln), (1, 1, segs)
    ph = rng.uniform(0.0, math.pi)
    me = grid_box(dims, sg)

    def wf(c):
        t = (c.x + ln / 2) / ln if axis == "X" else (c.z + ln / 2) / ln
        c.y += wander * math.sin(math.pi * t + ph) + rng.uniform(-0.002, 0.002)
        c.z -= sag * math.sin(math.pi * t)
    warp(me, wf)
    return finish(name, me, [mat])


def post(name, h=2.5, sq=0.15, mat=M_OAK):
    me = grid_box((sq, sq, h), (1, 1, 6))

    def wf(c):
        j = rng.uniform(-0.004, 0.004)
        c.x += j
        c.y += rng.uniform(-0.004, 0.004)
        d = c.z + h / 2
        if d < 0.14:
            fct = 1.0 + 0.10 * (1.0 - d / 0.14)
            c.x *= fct
            c.y *= fct
    warp(me, wf)
    return finish(name, me, [mat])


def brace_straight(name, ln=2.3, mat=M_OAK):
    me = grid_box((ln, 0.12, 0.12), (6, 1, 1))
    ang = math.radians(42.0)
    ca, sa = math.cos(ang), math.sin(ang)

    def wf(c):
        c.y += rng.uniform(-0.003, 0.003)
        x, z = c.x, c.z
        c.x = x * ca - z * sa
        c.z = x * sa + z * ca
        c.z += 0.01 * math.sin(math.pi * (c.x + ln / 2) / ln)
    warp(me, wf)
    me.transform(Matrix.Translation((0.0, 0.0, 0.9)))
    return finish(name, me, [mat])


def brace_curved(name, ln=2.2, mat=M_OAK):
    cu = bpy.data.curves.new("fv_curve_brace", "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = 14
    cu.bevel_depth = 0.055
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(2)
    pts = ((-ln / 2, 0, 0), (0, 0, 0.30 + rng.uniform(-0.03, 0.03)), (ln / 2, 0, 0.02))
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    src = bpy.data.objects.new("fv_curve_brace_src", cu)
    BCOLL.objects.link(src)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg))
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.data.curves.remove(cu)
    me.transform(Matrix.Translation((0.0, 0.0, 0.35)))
    return finish(name, me, [mat])


def wall_infill(name, plaster):
    parts = []
    for px in (-1.425, 1.425):
        parts.append((grid_box(
            (0.15, 0.12, 2.5), (1, 1, 5), off=(px + rng.uniform(-0.01, 0.01), 0, 1.25)), 0))
    for pz, hs in ((0.075, 1), (1.25, 1), (2.425, 1)):
        parts.append((grid_box(
            (3.0, 0.12, 0.15), (8, 1, 1), off=(0, 0, pz)), 0))
    dgap = rng.uniform(-0.02, 0.02)
    parts.append((grid_box(
        (2.7, 0.07, 2.2), (4, 1, 4), off=(dgap, 0.045, 1.25 + rng.uniform(-0.02, 0.02))), 1))
    bm = bmesh.new()
    for me, idx in parts:
        st = len(bm.faces)
        bm.from_mesh(me)
        for f in bm.faces[st:]:
            f.material_index = idx
        bpy.data.meshes.remove(me)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    weld_recalc(out)
    return finish(name, out, [M_OAK, plaster], smooth=True)


def footing_stone(name, ln=3.0, h=0.38, dep=0.45):
    me = grid_box((ln, dep, h), (22, 3, 3))
    ph = [rng.uniform(0, 6.28) for _ in range(3)]

    def wf(c):
        n = (0.014 * math.sin(7.1 * c.x + ph[0])
             + 0.010 * math.sin(13.3 * c.x + ph[1])
             + 0.012 * math.sin(5.3 * c.x + ph[2]))
        c.z += n * (1.0 if c.z > 0 else -0.4)
        c.y += 0.008 * math.sin(9.7 * c.x + ph[1])
        if c.z < -h / 2 + 0.05:
            c.y *= 1.06
    warp(me, wf)
    return finish(name, me, [M_STONE])


def slab(name, eave_a, eave_b, ridge_a, ridge_b, thick, nu, nv,
         sag_fn, curl, wave, mat):
    ea = Vector(eave_a)
    eb = Vector(eave_b)
    ra = Vector(ridge_a)
    rb = Vector(ridge_b)
    verts_out = []
    verts_in = []
    for vi in range(nv + 1):
        tv = vi / nv
        for ui in range(nu + 1):
            tu = ui / nu
            p = (ea * (1 - tu) + eb * tu) * (1 - tv) + (ra * (1 - tu) + rb * tu) * tv
            p.z -= sag_fn(p.y) + rng.uniform(-wave, wave)
            if curl > 0 and tv < 0.12:
                k = (0.12 - tv) / 0.12
                p.z -= curl * k * k
                p.z += curl * 0.15 * k * math.sin(6.0 * tu * math.pi)
            po = p.copy()
            tk = thick * min(1.0, (tv / 0.12) ** 0.5) if curl > 0 else thick
            pi = Vector((p.x, p.y, p.z - tk * 1.25 - 0.0))
            verts_out.append(po)
            verts_in.append(pi)
    faces = []
    nvv = nu + 1

    def oid(vi, ui):
        return vi * nvv + ui

    for vi in range(nv):
        for ui in range(nu):
            faces.append((oid(vi, ui), oid(vi, ui + 1),
                          oid(vi + 1, ui + 1), oid(vi + 1, ui)))
    base_in = (nv + 1) * nvv
    for vi in range(nv):
        for ui in range(nu):
            a, b_, c, d = (oid(vi, ui), oid(vi, ui + 1),
                           oid(vi + 1, ui + 1), oid(vi + 1, ui))
            faces.append((base_in + a, base_in + d, base_in + c, base_in + b_))
    for vi in range(nv):
        for ui in (0, nu):
            a = oid(vi, ui)
            a2 = oid(vi + 1, ui)
            faces.append((a, base_in + a, base_in + a2, a2))
    verts = [tuple(v) for v in verts_out] + [tuple(v) for v in verts_in]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    weld_recalc(me)
    return finish(name, me, [mat], smooth=True)


def tube(name, pts, r, segs=8, mat=M_THATCH, squash=0.75):
    verts = []
    faces = []
    n = len(pts)
    for i, p in enumerate(pts):
        d = Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])
        if d.length < 1e-6:
            d = Vector((0, 0, 1))
        d.normalize()
        up = Vector((0, 1, 0)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        x = d.cross(up).normalized()
        y = x.cross(d).normalized()
        for s in range(segs):
            a = 2 * math.pi * s / segs
            rad = r * (squash if abs(y.z) > 0.5 else 1.0)
            off = x * (math.cos(a) * r) + y * (math.sin(a) * rad)
            verts.append(tuple(Vector(p) + off))
    for i in range(n - 1):
        for s in range(segs):
            a = i * segs + s
            b_ = i * segs + (s + 1) % segs
            c = a + segs
            d2 = b_ + segs
            faces.append((a, b_, d2, c))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    weld_recalc(me)
    return finish(name, me, [mat], smooth=True)


PITCH = math.radians(50.0)


def roof_gable_thatch(name, span=6.0, ln=8.0, ovh=0.4):
    H = (span / 2) * math.tan(PITCH)
    A = rng.uniform(0.02, 0.06)
    sag = lambda y: A * math.cos(math.pi * y / ln) ** 2
    ex = span / 2 + ovh
    ey = ln / 2 + ovh * 0.5
    s1 = slab(name + "_s", (-ex, -ey, 0.0), (ex, -ey, 0.0),
              (-0.03, -ey, H), (0.03, -ey, H), 0.17, 16, 30, sag, 0.09, 0.014, M_THATCH)
    s2 = slab(name + "_n", (ex, ey, 0.0), (-ex, ey, 0.0),
              (0.03, ey, H), (-0.03, ey, H), 0.17, 16, 30, sag, 0.09, 0.014, M_THATCH)
    roll = [(0.0, -ey + (ey * 2) * k / 14, H + 0.02 - sag(-ey + (ey * 2) * k / 14))
            for k in range(15)]
    t = tube(name + "_ridge", roll, 0.11, 8, M_THATCH)
    return join_objs([s1, s2, t], name, [M_THATCH])


def roof_hip_thatch(name, span=6.0, ln=9.0, ovh=0.4):
    H = (span / 2) * math.tan(PITCH)
    A = rng.uniform(0.02, 0.06)
    sag = lambda y: A * math.cos(math.pi * y / ln) ** 2
    ex = span / 2 + ovh
    ey = ln / 2 + ovh * 0.5
    rl = ln / 2 - span / 2
    parts = [
        slab(name + "_s", (-ex, -ey, 0), (ex, -ey, 0),
             (0.0, -rl, H), (0.0, -rl, H), 0.17, 14, 22, sag, 0.09, 0.014, M_THATCH),
        slab(name + "_n", (ex, ey, 0), (-ex, ey, 0),
             (0.0, rl, H), (0.0, rl, H), 0.17, 14, 22, sag, 0.09, 0.014, M_THATCH),
        slab(name + "_e", (ex, -ey, 0), (ex, ey, 0),
             (0.0, -rl, H), (0.0, rl, H), 0.17, 14, 22, sag, 0.09, 0.014, M_THATCH),
        slab(name + "_w", (-ex, ey, 0), (-ex, -ey, 0),
             (0.0, rl, H), (0.0, -rl, H), 0.17, 14, 22, sag, 0.09, 0.014, M_THATCH),
    ]
    ridge = [(0.0, -rl + 2 * rl * k / 8, H + 0.02) for k in range(9)]
    parts.append(tube(name + "_ridgeroll", ridge, 0.11, 8, M_THATCH))
    for sx, sy, ry in ((ex, -ey, -rl), (-ex, -ey, -rl), (ex, ey, rl), (-ex, ey, rl)):
        hp = []
        for k in range(8):
            t = k / 7
            hp.append((sx * (1 - t),
                       sy * (1 - t) + ry * t,
                       (H + 0.02) * t - sag(sy * (1 - t) + ry * t)))
        parts.append(tube("%s_hiproll_%d_%d" % (name, int(sx), int(sy)), hp, 0.09, 8, M_THATCH))
    return join_objs(parts, name, [M_THATCH])


def roof_gable_tile(name, span=6.0, ln=8.0, ovh=0.4):
    H = (span / 2) * math.tan(PITCH)
    A = rng.uniform(0.02, 0.06)
    sag = lambda y: A * math.cos(math.pi * y / ln) ** 2 * 0.6
    ex = span / 2 + ovh
    ey = ln / 2 + ovh * 0.5
    s1 = slab(name + "_s", (-ex, -ey, 0.0), (ex, -ey, 0.0),
              (-0.02, -ey, H), (0.02, -ey, H), 0.06, 10, 26, sag, 0.03, 0.007, M_TILE)
    s2 = slab(name + "_n", (ex, ey, 0.0), (-ex, ey, 0.0),
              (0.02, ey, H), (-0.02, ey, H), 0.06, 10, 26, sag, 0.03, 0.007, M_TILE)
    roll = [(0.0, -ey + 2 * ey * k / 12, H + 0.015) for k in range(13)]
    t = tube(name + "_ridge", roll, 0.10, 8, M_SHINGLE)
    return join_objs([s1, s2, t], name, [M_TILE, M_SHINGLE])


def join_objs(objs, name, mats):
    bm = bmesh.new()
    slot = {}
    nxt = 0
    for m in mats:
        slot[m.name] = nxt
        nxt += 1
    for ob in objs:
        st = len(bm.faces)
        bm.from_mesh(ob.data)
        map_idx = slot.get(ob.data.materials[0].name if ob.data.materials else "", 0)
        for f in bm.faces[st:]:
            f.material_index = map_idx
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    weld_recalc(out)
    for ob in objs:
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return finish(name, out, mats)


def door_plank(name):
    parts = []
    x = -0.40
    while x <= 0.41:
        w = 0.19
        parts.append((grid_box(
            (w, 0.045 + rng.uniform(-0.004, 0.004), 2.05), (1, 1, 5),
            off=(x + w / 2 + rng.uniform(-0.002, 0.002), 0, 1.025)), 0))
        x += w + 0.006
    for pz in (0.55, 1.55):
        parts.append((grid_box(
            (1.04, 0.03, 0.16), (6, 1, 1),
            off=(rng.uniform(-0.01, 0.01), 0.032, pz + rng.uniform(-0.02, 0.02))), 0))
    for pz in (0.50, 1.50):
        parts.append((grid_box(
            (0.46, 0.012, 0.07), (3, 1, 1),
            off=(-0.31 + rng.uniform(-0.01, 0.01), 0.024, pz)), 1))
    bm = bmesh.new()
    for me, idx in parts:
        st = len(bm.faces)
        bm.from_mesh(me)
        for f in bm.faces[st:]:
            f.material_index = idx
        bpy.data.meshes.remove(me)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    weld_recalc(out)
    return finish(name, out, [M_OAKW, M_IRON])


def window_unit(name, open_state):
    ow, oh = 0.95, 1.25
    owd, ohd = 0.60, 0.70
    zc = 0.72
    parts = []
    parts.append((grid_box((ow, 0.12, 0.10), (5, 1, 1),
                           off=(0, 0, zc - ohd / 2 - 0.05)), 0))
    parts.append((grid_box((ow + 0.06, 0.20, 0.05), (5, 1, 1),
                           off=(0, 0.03, zc - ohd / 2 - 0.12)), 0))
    parts.append((grid_box((ow, 0.12, 0.10), (5, 1, 1),
                           off=(0, 0, zc + ohd / 2 + 0.05)), 0))
    parts.append((grid_box((0.10, 0.12, ohd + 0.2), (1, 1, 4),
                           off=(-ow / 2 + 0.05, 0, zc)), 0))
    parts.append((grid_box((0.10, 0.12, ohd + 0.2), (1, 1, 4),
                           off=(ow / 2 - 0.05, 0, zc)), 0))
    parts.append((grid_box((owd - 0.04, 0.02, ohd - 0.04), (2, 1, 2),
                           off=(0, -0.03, zc)), 2))
    sw, sh = 0.64, 0.74
    shut = [("shutter", grid_box((sw, 0.03, sh), (3, 1, 4), off=(0, 0, 0)))]
    bm = None
    for pz in (sh * 0.28, sh * 0.72):
        shut.append(("ledge", grid_box((sw + 0.04, 0.02, 0.09), (3, 1, 1),
                                       off=(0, 0.024, pz - sh / 2))))
    shut_bm = bmesh.new()
    for tag, me in shut:
        idx = 0 if tag == "shutter" else 0
        st = len(shut_bm.faces)
        shut_bm.from_mesh(me)
        for f in shut_bm.faces[st:]:
            f.material_index = idx
        bpy.data.meshes.remove(me)
    if open_state:
        ang = math.radians(112.0)
        rot = Matrix.Rotation(ang, 4, "Z")
        piv = Matrix.Translation((-ow / 2 + 0.05, 0.09, zc))
        shut_bm.transform(piv @ rot @ piv.inverted())
        shut_bm.transform(Matrix.Translation((0, 0, 0)))
    else:
        shut_bm.transform(Matrix.Translation(
            (rng.uniform(-0.01, 0.01), 0.10, zc)))
    bm = bmesh.new()
    for me, idx in parts:
        st = len(bm.faces)
        bm.from_mesh(me)
        for f in bm.faces[st:]:
            f.material_index = idx
        bpy.data.meshes.remove(me)
    st = len(bm.faces)
    tmp_me = bpy.data.meshes.new("shut_tmp")
    shut_bm.to_mesh(tmp_me)
    bm.from_mesh(tmp_me)
    bpy.data.meshes.remove(tmp_me)
    for f in bm.faces[st:]:
        f.material_index = 1
    shut_bm.free()
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    weld_recalc(out)
    return finish(name, out, [M_OAK, M_OAKW, M_VOID])


def surf(x, y):
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_r = scene.ray_cast(dg, Vector((x, y, 10.0)), Vector((0, 0, -1)))
    return (loc.x, loc.y, loc.z) if hit else (x, y, 0.0)


kit = {}
kit["fv_kit_footing_stone"] = footing_stone("fv_kit_footing_stone")
kit["fv_kit_wall_infill_whitewash"] = wall_infill("fv_kit_wall_infill_whitewash", M_PL_WH)
kit["fv_kit_wall_infill_ochre"] = wall_infill("fv_kit_wall_infill_ochre", M_PL_OC)
kit["fv_kit_wall_infill_weathered"] = wall_infill("fv_kit_wall_infill_weathered", M_PL_WT)
kit["fv_kit_door_plank"] = door_plank("fv_kit_door_plank")
kit["fv_kit_window_shutter_open"] = window_unit("fv_kit_window_shutter_open", True)
kit["fv_kit_window_shutter_closed"] = window_unit("fv_kit_window_shutter_closed", False)
kit["fv_kit_post"] = post("fv_kit_post")
kit["fv_kit_rail"] = beam("fv_kit_rail", 3.0, 0.15, "X")
kit["fv_kit_brace_straight"] = brace_straight("fv_kit_brace_straight")
kit["fv_kit_brace_curved"] = brace_curved("fv_kit_brace_curved")
kit["fv_roof_thatch_gable"] = roof_gable_thatch("fv_roof_thatch_gable")
kit["fv_roof_thatch_hip"] = roof_hip_thatch("fv_roof_thatch_hip")
kit["fv_roof_tile_gable"] = roof_gable_tile("fv_roof_tile_gable")

layout = [
    ("fv_kit_footing_stone", 1.8),
    ("fv_kit_wall_infill_whitewash", 1.9),
    ("fv_kit_wall_infill_ochre", 1.9),
    ("fv_kit_wall_infill_weathered", 1.9),
    ("fv_kit_door_plank", 0.9),
    ("fv_kit_window_shutter_open", 0.9),
    ("fv_kit_window_shutter_closed", 0.9),
    ("fv_kit_post", 0.6),
    ("fv_kit_rail", 1.9),
    ("fv_kit_brace_straight", 1.3),
    ("fv_kit_brace_curved", 1.5),
    ("fv_roof_thatch_gable", 5.2),
    ("fv_roof_thatch_hip", 5.4),
    ("fv_roof_tile_gable", 5.2),
]
disp = bpy.data.objects.new("fv_kit_display", None)
BCOLL.objects.link(disp)
disp.location = (0.0, 34.0, 0.0)
xs = -sum(w for _, w in layout) / 2
placed = []
ys_cycle = (29.0, 34.0, 39.0)
for i, (nm, hw) in enumerate(layout):
    ob = kit[nm]
    cx = xs + hw
    ys = ys_cycle[i % 3] + rng.uniform(-1.2, 1.2)
    gz = surf(cx, ys)[2]
    zo = 0.12 if nm.startswith("fv_roof") else 0.0
    ob.location = (cx, ys, gz + zo)
    ob.rotation_euler = (0.0, 0.0, math.radians(rng.uniform(-4.0, 4.0)))
    ob.parent = disp
    ob.matrix_parent_inverse = disp.matrix_world.inverted()
    placed.append(ob)
    xs += 2 * hw + 0.7

total_tris = 0
inv_lines = []
for ob in placed:
    ob.data.calc_loop_triangles()
    t = len(ob.data.loop_triangles)
    total_tris += t
    inv_lines.append("KIT_OBJ %s tris=%d dims=(%.2f,%.2f,%.2f)" % (
        ob.name, t, ob.dimensions.x, ob.dimensions.y, ob.dimensions.z))
print("\n".join(inv_lines))
print("KIT_TOTAL tris=%d budget_ok=%s" % (total_tris, total_tris < 150000))

minx = min(o.location.x - o.dimensions.x / 2 for o in placed)
maxx = max(o.location.x + o.dimensions.x / 2 for o in placed)
maxy = max(o.location.y + o.dimensions.y / 2 for o in placed)
miny = min(o.location.y - o.dimensions.y / 2 for o in placed)
maxz = max(o.location.z + o.dimensions.z for o in placed)
cx = (minx + maxx) / 2
cy = (miny + maxy) / 2
need_w = (maxx - minx) * 1.12
lens = 40.0
half_h = math.atan(18.0 / lens)
dist = need_w / (2 * math.tan(half_h))
cam_data = bpy.data.cameras.new("fv_cam_kit_data")
cam_data.lens = lens
cam = bpy.data.objects.new("fv_cam_kit", cam_data)
BCOLL.objects.link(cam)
cam.location = (cx, miny - dist * 0.92, maxz + 7.0)
tgt = bpy.data.objects.new("fv_cam_kit_tgt", None)
BCOLL.objects.link(tgt)
tgt.location = (cx, cy, 1.8)
tr = cam.constraints.new(type="TRACK_TO")
tr.target = tgt
tr.track_axis = "TRACK_NEGATIVE_Z"
tr.up_axis = "UP_Y"

prev_cam = scene.camera
scene.camera = cam
scene.render.filepath = TMP
bpy.ops.render.render(write_still=True)


def load_arr(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)


def sample_patch(arr, ob, r=14, lift=0.4):
    w, h = scene.render.resolution_x, scene.render.resolution_y
    ctr = Vector((ob.location.x, ob.location.y, ob.location.z + lift))
    uv = object_utils.world_to_camera_view(scene, cam, ctr)
    if not (0.02 < uv.x < 0.98 and 0.02 < uv.y < 0.98):
        return None
    cx, cy = int(uv.x * w), int(uv.y * h)
    m = arr[cy - r:cy + r, cx - r:cx + r, :3].mean(axis=(0, 1))
    return tuple(int(round(c * 255)) for c in m)


arr = load_arr(TMP)
timber = sample_patch(arr, kit["fv_kit_door_plank"], lift=1.0, r=10)
plaster = sample_patch(arr, kit["fv_kit_wall_infill_whitewash"], lift=1.2, r=16)
roof = sample_patch(arr, kit["fv_roof_thatch_gable"], lift=1.6, r=14)
print("KIT_SAMPLE try1 timber=%s plaster=%s roof=%s" % (timber, plaster, roof))


def checks(tb, pl, rf):
    ct = bool(tb and tb[0] > tb[1] > tb[2] and 45 < tb[0] < 190 and tb[0] - tb[2] >= 15)
    cp = bool(pl and min(pl) > 160 and pl[0] >= pl[2] - 4)
    cr = bool(rf and rf[0] > rf[1] > rf[2] and 90 < rf[0] < 225 and rf[0] - rf[2] >= 20)
    return ct, cp, cr


ct, cp, cr = checks(timber, plaster, roof)
if not (ct and cp and cr):
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    refs = [c for c in (timber, plaster, roof) if c]
    if refs:
        avg_l = sum(lum(c) for c in refs) / len(refs)
        want_l = (lum((74, 56, 38)) + lum((232, 224, 204)) + lum((138, 122, 94))) / 3 * 1.25
        keep_exp = scene.view_settings.exposure
        scene.view_settings.exposure += max(-0.3, min(0.3, math.log2(max(want_l, 1) / max(avg_l, 1))))
        scene.render.filepath = TMP
        bpy.ops.render.render(write_still=True)
        arr = load_arr(TMP)
        timber = sample_patch(arr, kit["fv_kit_door_plank"], lift=1.0, r=10)
        plaster = sample_patch(arr, kit["fv_kit_wall_infill_whitewash"], lift=1.2, r=16)
        roof = sample_patch(arr, kit["fv_roof_thatch_gable"], lift=1.6, r=14)
        ct, cp, cr = checks(timber, plaster, roof)
        print("KIT_SAMPLE try2 exp=%+.2f timber=%s plaster=%s roof=%s" % (
            scene.view_settings.exposure, timber, plaster, roof))
        scene.view_settings.exposure = keep_exp
print("KIT_CHECKS timber=%d plaster=%d roof=%d" % (ct, cp, cr))

os.replace(TMP, FINAL)
print("RENDER", FINAL, os.path.getsize(FINAL))
for ob in (cam, tgt):
    bpy.data.objects.remove(ob, do_unlink=True)
scene.camera = prev_cam

out_blend = bpy.data.filepath
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("SAVED", out_blend)
print("DONE ph2")
