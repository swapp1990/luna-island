"""P8 example asset — Franconian village notice-board.

Self-contained (factory scene). Builds, lookdev-renders, exports GLB.
Idempotent. Does NOT touch village.blend.

Visual language: late-14th-c. vernacular, same kit as the well —
oak posts, fieldstone pads, small shingled drip roof, parchment scraps.
Nothing perfectly straight. Reads at strategy-cam (~14 m, 45°) AND
survives a ground inspection shot.

Sim footprint is 2×2 tiles (6×6 m); the structure itself is ~1.6 × 0.7 × 2.6 m
sitting in the centre of packed dirt.
"""
from __future__ import annotations

import json
import math
import os
import random

import bpy
from mathutils import Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
RD = os.path.join(ROOT, "renders")
EXPORT = os.path.join(ROOT, "export", "gltf")
BLEND_OUT = os.path.join(ROOT, "scenes", "fv_notice_board.blend")
NAME = "fv_notice_board"
rng = random.Random(42)

os.makedirs(RD, exist_ok=True)
os.makedirs(EXPORT, exist_ok=True)
os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hexstr: str) -> tuple[float, float, float, float]:
    h = hexstr.lstrip("#")
    rgb = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return (srgb_to_lin(rgb[0]), srgb_to_lin(rgb[1]), srgb_to_lin(rgb[2]), 1.0)


def mat(name: str, hexstr: str, rough: float = 0.9, spec: float = 0.12) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        bpy.data.materials.remove(existing)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hexstr)
    b.inputs["Roughness"].default_value = rough
    try:
        b.inputs["Specular IOR Level"].default_value = spec
    except KeyError:
        pass
    return m


# Style-bible palette (specs/manor-slice-assets.md). Flat principled so glTF
# carries the same albedo the Eevee lookdev shows — no procedural-shader trap.
MOAK = mat("fv_mat_oak", "#4A3826", 0.88)
MWEATH = mat("fv_mat_oak_weathered", "#5C5142", 0.92)
MSTONE = mat("fv_mat_stone_field", "#8C8578", 0.96)
# Roof albedos are pre-darkened: low-sun 50° slopes read ~2.3× brighter (manor-slice gotcha).
MSHINGLE = mat("fv_mat_shingle", "#5E5340", 0.92)
MPARCH = mat("fv_mat_parchment", "#E8E0CC", 0.78)
MPARCH2 = mat("fv_mat_parchment_aged", "#D9B878", 0.82)
MPARCH3 = mat("fv_mat_parchment_bleached", "#A99B7C", 0.8)
MIRON = mat("fv_mat_iron", "#2E2A26", 0.55, spec=0.35)
MDIRT = mat("fv_mat_dirt", "#B5A488", 0.97)
MGRASS = mat("fv_mat_grass", "#7A8F4A", 0.95)
MINK = mat("fv_mat_ink", "#3A342C", 0.85)


def mesh_obj(name: str, verts, faces, material, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def box(name, x0, x1, y0, y1, z0, z1, material, parent=None, jitter=0.0):
    raw = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    order = [0, 1, 3, 2, 4, 5, 7, 6]
    verts = [raw[i] for i in order]
    if jitter:
        verts = [
            (
                x + rng.uniform(-jitter, jitter),
                y + rng.uniform(-jitter, jitter),
                z + rng.uniform(-jitter * 0.4, jitter * 0.4),
            )
            for (x, y, z) in verts
        ]
    faces = [
        (0, 1, 3, 2),
        (4, 6, 7, 5),
        (0, 2, 6, 4),
        (1, 5, 7, 3),
        (0, 4, 5, 1),
        (2, 3, 7, 6),
    ]
    return mesh_obj(name, verts, faces, material, parent)


def reset_scene():
    # Don't read_homefile — that can abort a --python run. Strip the factory cube.
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for cam in list(bpy.data.cameras):
        bpy.data.cameras.remove(cam)
    for light in list(bpy.data.lights):
        bpy.data.lights.remove(light)
    scn = bpy.context.scene
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0
    return scn


scn = reset_scene()


# --- lookdev rig (bible: low warm sun ~25°, SW, pale desaturated sky, haze) ---
world = bpy.data.worlds.new("fv_world")
scn.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out_n = nt.nodes.new("ShaderNodeOutputWorld")
bg = nt.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = lin("#C8D0D4")  # pale desaturated blue-grey
bg.inputs["Strength"].default_value = 0.55
nt.links.new(bg.outputs["Background"], out_n.inputs["Surface"])

sun = bpy.data.lights.new("fv_sun", "SUN")
sun.energy = 4.2
sun.color = (1.0, 0.93, 0.80)
sun.angle = math.radians(2.4)
sun_ob = bpy.data.objects.new("fv_sun", sun)
scn.collection.objects.link(sun_ob)
# 25° elevation, azimuth ~SW (225°)
el = math.radians(25.0)
az = math.radians(225.0)
sun_ob.rotation_euler = (math.pi / 2 - el, 0.0, az + math.pi)
try:
    sun.use_shadow = True
except Exception:
    pass

hemi = bpy.data.lights.new("fv_hemi", "AREA")
hemi.energy = 18.0
hemi.color = (0.78, 0.82, 0.88)
hemi.size = 12.0
hemi_ob = bpy.data.objects.new("fv_hemi", hemi)
scn.collection.objects.link(hemi_ob)
hemi_ob.location = (0, 0, 8)
hemi_ob.rotation_euler = (0, 0, 0)

chosen = None
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scn.render.engine = eng
        chosen = eng
        break
    except TypeError:
        continue
print("ENGINE", chosen)
ee = getattr(scn, "eevee", None)
if ee is not None:
    for attr in ("use_shadows", "use_raytracing", "use_soft_shadows"):
        try:
            setattr(ee, attr, True)
        except Exception:
            pass
    try:
        ee.taa_render_samples = 32
    except Exception:
        pass

scn.render.resolution_x = 1280
scn.render.resolution_y = 720
scn.render.film_transparent = False
scn.render.image_settings.file_format = "PNG"
try:
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    try:
        scn.view_settings.view_transform = "Filmic"
    except TypeError:
        pass

# Packed-dirt pad so the board isn't floating in void (plaza language).
pad = box("ground_pad", -3.2, 3.2, -3.2, 3.2, -0.04, 0.02, MDIRT)
grass = box("ground_grass", -8.0, 8.0, -8.0, 8.0, -0.06, -0.02, MGRASS)


# --- the notice-board ---
root = bpy.data.objects.new(NAME, None)
scn.collection.objects.link(root)

# Fieldstone pads (irregular, slightly proud of dirt).
box("nb_pad_l", -0.72, -0.38, -0.20, 0.20, 0.00, 0.10, MSTONE, root, jitter=0.022)
box("nb_pad_r", 0.38, 0.72, -0.20, 0.20, 0.00, 0.10, MSTONE, root, jitter=0.022)

# Posts lean inward ~7 cm at the top so they aren't CAD-plumb.
# Front of the structure is -Y (cameras look from -Y).
def tapered_post(name, x_bot, lean):
    hw, hd = 0.065, 0.065
    z0, z1 = 0.08, 2.02
    xb = x_bot
    xt = x_bot + lean
    verts = [
        (xb - hw, -hd, z0), (xb + hw, -hd, z0), (xb + hw, hd, z0), (xb - hw, hd, z0),
        (xt - hw, -hd, z1), (xt + hw, -hd, z1), (xt + hw, hd, z1), (xt - hw, hd, z1),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_obj(name, verts, faces, MOAK, root)

tapered_post("nb_post_l", -0.58, 0.07)
tapered_post("nb_post_r", 0.58, -0.07)

# Header beam sits on the posts.
box("nb_beam", -0.66, 0.66, -0.08, 0.08, 1.94, 2.08, MOAK, root, jitter=0.006)

# Board is ON THE FRONT (-Y). Planks with visible 12 mm gaps.
YF = -0.09  # front face of planks
YB = -0.04  # back face of planks
planks = [(0.78, 1.04), (1.06, 1.32), (1.34, 1.60)]
for i, (z0, z1) in enumerate(planks):
    box(f"nb_plank_{i}", -0.50, 0.50, YF, YB, z0, z1, MWEATH, root, jitter=0.003)

# Oak frame around the planks, proud of them.
box("nb_frame_t", -0.54, 0.54, YF - 0.015, YB + 0.01, 1.60, 1.70, MOAK, root)
box("nb_frame_b", -0.54, 0.54, YF - 0.015, YB + 0.01, 0.68, 0.78, MOAK, root)
box("nb_frame_l", -0.56, -0.48, YF - 0.015, YB + 0.01, 0.68, 1.70, MOAK, root)
box("nb_frame_r", 0.48, 0.56, YF - 0.015, YB + 0.01, 0.68, 1.70, MOAK, root)

# Peg rail under the top frame — notices hang from these.
box("nb_peg_rail", -0.46, 0.46, YF - 0.02, YF + 0.01, 1.62, 1.68, MOAK, root)
for i, px in enumerate((-0.34, -0.12, 0.10, 0.32)):
    box(f"nb_peg_{i}", px - 0.015, px + 0.015, YF - 0.045, YF - 0.012, 1.60, 1.64, MIRON, root)

# Parchment ON THE FRONT, overlapping, cream vs brown so they read at 14 m.
# y more negative than YF.
notices = [
    # tag, x0,x1, z0,z1, y_front, mat, skew
    ("a", -0.44, -0.08, 1.18, 1.58, YF - 0.012, MPARCH, 0.02),
    ("b", -0.16, 0.22, 1.02, 1.38, YF - 0.018, MPARCH2, -0.025),
    ("c", 0.08, 0.44, 1.24, 1.58, YF - 0.010, MPARCH, 0.015),
    ("d", -0.38, 0.00, 0.84, 1.12, YF - 0.015, MPARCH3, -0.02),
]


def parchment(tag, x0, x1, z0, z1, yf, mm, skew):
    yb = yf + 0.006
    verts = [
        (x0, yf, z0),
        (x1 + skew, yf, z0 + abs(skew) * 0.4),
        (x1, yf, z1),
        (x0 + skew * 0.4, yf, z1 + skew * 0.3),
        (x0, yb, z0),
        (x1 + skew, yb, z0 + abs(skew) * 0.4),
        (x1, yb, z1),
        (x0 + skew * 0.4, yb, z1 + skew * 0.3),
    ]
    faces = [
        (0, 3, 2, 1),  # front (-Y)
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    mesh_obj(f"nb_notice_{tag}", verts, faces, mm, root)
    # Ink bars on the front face.
    midz = (z0 + z1) / 2
    ink_w = (x1 - x0) * 0.62
    cx = (x0 + x1) / 2
    n_lines = 3 if (z1 - z0) < 0.35 else 4
    for k in range(n_lines):
        t = (k + 1) / (n_lines + 1)
        zz = z0 + (z1 - z0) * t
        w = ink_w * (0.55 if k == n_lines - 1 else 1.0)
        box(
            f"nb_ink_{tag}{k}",
            cx - w / 2,
            cx + w / 2,
            yf - 0.004,
            yf - 0.001,
            zz - 0.010,
            zz + 0.010,
            MINK,
            root,
        )


for n in notices:
    parchment(*n)

# One scrap hanging off a peg, below the board — reads as "posted".
parchment("hang", -0.18, 0.04, 0.42, 0.66, YF - 0.03, MPARCH2, 0.03)
box("nb_string", -0.08, -0.07, YF - 0.04, YF - 0.02, 0.66, 0.78, MIRON, root)

# Nails on the FRONT of the frame.
for i, (x, z) in enumerate(((-0.50, 1.65), (0.50, 1.65), (-0.50, 0.73), (0.50, 0.73))):
    box(f"nb_nail_{i}", x - 0.012, x + 0.012, YF - 0.022, YF - 0.004, z - 0.012, z + 0.012, MIRON, root)

# Compact drip-cap roof — a lid, not a pavilion. Ridge ~2.35 m.
span, length, pitch = 1.46, 0.52, math.radians(38.0)
half = span / 2
ridge_z = half * math.tan(pitch)  # ~0.57
z_eave = 2.04
y0 = -0.28
th = 0.05


def gable_shell(name, z, sag, inset=0.0):
    h = half - inset
    rz = ridge_z - inset * 0.6
    L0, R0 = (-h, y0 + inset, z), (h, y0 + inset, z)
    L1, R1 = (-h, y0 + length - inset, z), (h, y0 + length - inset, z)
    C0 = (0.0, y0 + inset, z + rz - sag)
    C1 = (0.0, y0 + length - inset, z + rz - sag * 0.6)
    v = [L0, R0, L1, R1, C0, C1]
    faces = [(0, 4, 5, 2), (4, 1, 3, 5), (0, 2, 3, 1), (0, 1, 4), (2, 5, 3)]
    return mesh_obj(name, v, faces, MSHINGLE, root)


gable_shell("nb_roof", z_eave, 0.035)
gable_shell("nb_roof_in", z_eave - th, 0.02, inset=0.04)
box("nb_soffit", -0.58, 0.58, -0.18, 0.18, 2.00, 2.05, MWEATH, root)
box("nb_ridge", -0.035, 0.035, y0 - 0.02, y0 + length + 0.02, z_eave + ridge_z - 0.05, z_eave + ridge_z + 0.03, MSHINGLE, root)

# Leftover crate at the working edge (Manor Lords clutter language).
box("nb_crate", 0.72, 1.14, -0.16, 0.20, 0.02, 0.34, MWEATH, root, jitter=0.012)
box("nb_crate_lid", 0.70, 1.16, -0.18, 0.22, 0.32, 0.38, MOAK, root, jitter=0.006)


def count_tris(obj) -> int:
    t = 0
    stack = [obj]
    seen = set()
    while stack:
        o = stack.pop()
        if o.name in seen:
            continue
        seen.add(o.name)
        if o.type == "MESH":
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
        stack.extend(o.children)
    return t


bpy.context.view_layer.update()
tris = count_tris(root)

# World AABB of the structure (exclude ground).
corners = []
for o in root.children_recursive:
    if o.type != "MESH":
        continue
    for c in o.bound_box:
        corners.append(o.matrix_world @ Vector(c))
xs = [c.x for c in corners]
ys = [c.y for c in corners]
zs = [c.z for c in corners]
bbox = {
    "x": [round(min(xs), 3), round(max(xs), 3)],
    "y": [round(min(ys), 3), round(max(ys), 3)],
    "z": [round(min(zs), 3), round(max(zs), 3)],
    "w": round(max(xs) - min(xs), 3),
    "d": round(max(ys) - min(ys), 3),
    "h": round(max(zs) - min(zs), 3),
}
print("BBOX", json.dumps(bbox), "TRIS", tris)


def make_cam(name, loc, target, lens):
    cd = bpy.data.cameras.new(name + "_data")
    cd.lens = lens
    cam = bpy.data.objects.new(name, cd)
    scn.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam


ctr = Vector(((bbox["x"][0] + bbox["x"][1]) / 2, (bbox["y"][0] + bbox["y"][1]) / 2, bbox["h"] * 0.45))

# 3/4 inspection — pull back so posts, papers, and drip-cap all fit.
cam_hero = make_cam("cam_hero", Vector((-2.6, -4.4, 1.55)), Vector((0.05, 0.0, 1.15)), 45)
# Strategy cam: 45° pitch-ish, 40 mm, ~14 m — how /town will first see it.
cam_strat = make_cam("cam_strat", Vector((7.5, -10.5, 8.8)), Vector((0, 0, 0.7)), 40)
# Front elevation, framed to include the roof.
cam_front = make_cam("cam_front", Vector((0.0, -5.4, 1.45)), Vector((0.0, 0.0, 1.25)), 50)


def render(cam, path):
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER", path, os.path.getsize(path) if os.path.exists(path) else 0)


render(cam_hero, os.path.join(RD, "ph8_notice_hero.png"))
render(cam_strat, os.path.join(RD, "ph8_notice_strategy.png"))
render(cam_front, os.path.join(RD, "ph8_notice_front.png"))

# Export: duplicate at origin, skip lookdev (ground/sun/cams).
before = set(bpy.data.objects)
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for ch in root.children_recursive:
    ch.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.object.duplicate(linked=False)
new_objs = [o for o in bpy.data.objects if o not in before]
dup_root = next(o for o in new_objs if o.parent is None)
dup_root.location = (0.0, 0.0, 0.0)
bpy.ops.object.select_all(action="DESELECT")
dup_root.select_set(True)
for ch in dup_root.children_recursive:
    ch.select_set(True)
bpy.context.view_layer.objects.active = dup_root
glb = os.path.join(EXPORT, NAME + ".glb")
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_extras=False,
)
for o in new_objs:
    bpy.data.objects.remove(o, do_unlink=True)

# Keep a recoverable .blend of this isolated asset (kiln rule 7).
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

report = {
    "name": NAME,
    "tris": tris,
    "bbox_m": bbox,
    "glb_bytes": os.path.getsize(glb),
    "glb": glb,
    "blend": BLEND_OUT,
    "renders": [
        os.path.join(RD, "ph8_notice_hero.png"),
        os.path.join(RD, "ph8_notice_strategy.png"),
        os.path.join(RD, "ph8_notice_front.png"),
    ],
    "engine": chosen,
}
print("REPORT", json.dumps(report))
