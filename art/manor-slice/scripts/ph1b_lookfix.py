"""Phase 1b look fix v2: Standard transform, gradient sky, validated patch sampling.

Strategy cam stays on its original downward rig (no sky in that frame by design);
sky is verified through a temporary dedicated camera. Grass/road patches are
picked from candidate pools filtered by in-frame projection checks.

Run inside Blender via tools/blender_client.py exec scripts/ph1b_lookfix.py
"""
import math
import os
import random

import bpy
import numpy as np
from bpy_extras import object_utils
from mathutils import Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
REN = os.path.join(ROOT, "renders")
TMP = os.path.join(REN, "_ph1b_iter.png")
TMP_SKY = os.path.join(REN, "ph1b_sky.png")
FINAL = os.path.join(REN, "ph1b_fix.png")

TGT_GRASS = (122, 143, 74)
TGT_ROAD = (181, 164, 136)
SKY_HORIZON = (0.78, 0.82, 0.86)
SKY_ZENITH = (0.45, 0.58, 0.75)

SUN_E0 = 3.05
SKY_STR = 0.65
EXP0 = 0.55
MUD_MUL0 = 0.40


def dec(u):
    return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return (
        dec(int(h[1:3], 16) / 255.0),
        dec(int(h[3:5], 16) / 255.0),
        dec(int(h[5:7], 16) / 255.0),
        1.0,
    )


def lin01(rgb):
    return (dec(rgb[0]), dec(rgb[1]), dec(rgb[2]), 1.0)


scene = bpy.context.scene
vs = scene.view_settings
vs.view_transform = "Standard"
try:
    vs.look = "None"
except Exception:
    pass
vs.exposure = EXP0
try:
    vs.gamma = 1.0
except Exception:
    pass
scene.render.film_transparent = False

sun = bpy.data.objects["fv_sun"]
sun.data.energy = SUN_E0
sun.data.color = (1.0, 0.88, 0.72)

bpy.data.objects["fv_cam_strategy_tgt"].location = (0.0, 10.0, 0.0)

gm = bpy.data.materials["fv_grass_base"]
gb = gm.node_tree.nodes.get("Principled BSDF")
if gb:
    gb.inputs["Base Color"].default_value = hexlin("#7A8F4A")
for n in gm.node_tree.nodes:
    if n.bl_idname == "ShaderNodeValToRGB":
        n.color_ramp.elements[0].position = 0.35
        n.color_ramp.elements[0].color = hexlin("#6E8544")
        n.color_ramp.elements[1].position = 0.65
        n.color_ramp.elements[1].color = hexlin("#8F9A55")

dm = bpy.data.materials["fv_dirt_road"]
db = dm.node_tree.nodes.get("Principled BSDF")
if db:
    db.inputs["Base Color"].default_value = hexlin("#B5A488")
    db.inputs["Roughness"].default_value = 0.85


def set_mud(mul):
    for n in dm.node_tree.nodes:
        if n.bl_idname == "ShaderNodeMath" and n.operation == "MULTIPLY":
            n.inputs[1].default_value = mul
        if n.bl_idname == "ShaderNodeValToRGB":
            n.color_ramp.elements[0].position = 0.38
            n.color_ramp.elements[1].position = 0.62


set_mud(MUD_MUL0)


def build_world():
    world = bpy.data.worlds.get("fv_world") or bpy.data.worlds.new("fv_world")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mrn = nt.nodes.new("ShaderNodeMapRange")
    mrn.inputs["From Min"].default_value = -1.0
    mrn.inputs["From Max"].default_value = 1.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    e0 = ramp.color_ramp.elements[0]
    e1 = ramp.color_ramp.elements[1]
    e0.position = 0.5
    e0.color = lin01(SKY_HORIZON)
    e1.position = 1.0
    e1.color = lin01(SKY_ZENITH)
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mrn.inputs["Value"])
    nt.links.new(mrn.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = SKY_STR
    nt.links.new(bg.outputs["Background"], out_n.inputs["Surface"])


def surf(x, y):
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_r = scene.ray_cast(dg, Vector((x, y, 10.0)), Vector((0, 0, -1)))
    return (loc.x, loc.y, loc.z) if hit else (x, y, 0.0)


def project(pt, w, h):
    uv = object_utils.world_to_camera_view(
        scene, bpy.data.objects["fv_cam_strategy"], Vector(pt)
    )
    return uv.x, uv.y


def render(cam_obj, path):
    prev = scene.camera
    scene.camera = cam_obj
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scene.camera = prev


def load_arr(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)


def patch(arr, cx, cy, r):
    m = arr[cy - r:cy + r, cx - r:cx + r, :3].mean(axis=(0, 1))
    return tuple(int(round(c * 255.0)) for c in m)


def pick_points(cands, want, min_px_dist, w, h, arr_shape, flat_min_z=None):
    dg = bpy.context.evaluated_depsgraph_get()
    kept = []
    for x, y in cands:
        hit, loc, nrm, *_r = scene.ray_cast(
            dg, Vector((x, y, 10.0)), Vector((0, 0, -1))
        )
        if not hit:
            continue
        if flat_min_z is not None and nrm.z < flat_min_z:
            continue
        ux, uy = project((loc.x, loc.y, loc.z), w, h)
        if not (0.07 < ux < 0.93 and 0.09 < uy < 0.91):
            continue
        px, py = int(ux * w), int(uy * h)
        if all((px - qx) ** 2 + (py - qy) ** 2 >= min_px_dist ** 2 for qx, qy in kept):
            kept.append((px, py))
        if len(kept) >= want:
            break
    return kept


def road_centerline(x):
    return 3.0 * math.sin(0.05 * x + 0.8)


build_world()
os.makedirs(REN, exist_ok=True)
w0, h0 = scene.render.resolution_x, scene.render.resolution_y

rng = random.Random(20261)
grass_cands = []
for _i in range(600):
    x = rng.uniform(-52.0, 52.0)
    y = rng.uniform(-46.0, 58.0)
    if abs(y - road_centerline(x)) < 7.0:
        continue
    grass_cands.append((x, y))
road_cands = [(x, road_centerline(x)) for x in (-36.0, -24.0, -12.0, 0.0, 12.0, 24.0, 36.0)]

render(bpy.data.objects["fv_cam_strategy"], TMP)
arr0 = load_arr(TMP)
H, W = arr0.shape[:2]
gpix = pick_points(grass_cands, 6, 70, W, H, arr0.shape, flat_min_z=0.985)
rpix = pick_points(road_cands, 3, 90, W, H, arr0.shape)
print("PICK grass_n=%d road_n=%d" % (len(gpix), len(rpix)))

sky_chk = None
if True:
    cd = bpy.data.cameras.new("fv_cam_sky_chk_data")
    sky_cam = bpy.data.objects.new("fv_cam_sky_chk", cd)
    bpy.data.collections["fv_Lookdev"].objects.link(sky_cam)
    sky_cam.location = (0.0, -30.0, 3.0)
    tgt = bpy.data.objects.new("fv_cam_sky_chk_tgt", None)
    bpy.data.collections["fv_Lookdev"].objects.link(tgt)
    tgt.location = (0.0, 30.0, 40.0)
    tr = sky_cam.constraints.new(type="TRACK_TO")
    tr.target = tgt
    tr.track_axis = "TRACK_NEGATIVE_Z"
    tr.up_axis = "UP_Y"
    sky_chk = (sky_cam, tgt)


def avg_patches(arr, pixs, r):
    ps = [patch(arr, px, py, r) for px, py in pixs]
    return tuple(int(round(sum(p[k] for p in ps) / len(ps))) for k in range(3))


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def within(c, t, tol):
    return all(abs(a - b) <= tol for a, b in zip(c, t))


def measure():
    arr = load_arr(TMP)
    g = avg_patches(arr, gpix, 16)
    rd = avg_patches(arr, rpix, 10)
    return g, rd


def measure_sky():
    render(sky_chk[0], TMP_SKY)
    arr = load_arr(TMP_SKY)
    hh, ww = arr.shape[:2]
    return patch(arr, 35, hh - 33, 20)


best = None
exp = EXP0
mul = MUD_MUL0
sky_trimmed = False
sk = None
for it in range(4):
    vs.exposure = round(exp, 3)
    set_mud(mul)
    render(bpy.data.objects["fv_cam_strategy"], TMP)
    g, rd = measure()
    sk = measure_sky()
    pg = within(g, TGT_GRASS, 12)
    pr = within(rd, TGT_ROAD, 15)
    ps = sk[2] > sk[0] and min(sk) > 140
    score = sum(abs(a - b) for a, b in zip(g, TGT_GRASS))
    score += sum(abs(a - b) for a, b in zip(rd, TGT_ROAD))
    score += 0 if ps else 300
    print(
        "LOOKFIX iter=%d exp=%+.2f mud=%.2f grass=%s road=%s sky=%s pass=%d%d%d"
        % (it, vs.exposure, mul, g, rd, sk, pg, pr, ps)
    )
    snap = (score, vs.exposure, mul, (g, rd, sk, (pg, pr, ps)))
    if best is None or score < best[0]:
        best = snap
    if pg and pr and ps:
        break
    err = math.log2(luma(TGT_GRASS) / max(luma(g), 1.0))
    exp += max(-0.3, min(0.3, err))
    dr = rd[0] - TGT_ROAD[0]
    if dr > 15:
        mul = min(0.75, mul + 0.15)
    elif dr < -15:
        mul = max(0.2, mul - 0.15)
    if not sky_trimmed and g[2] - TGT_GRASS[2] > 10:
        SKY_STR *= 0.88
        build_world()
        sky_trimmed = True
        print("LOOKFIX sky_str->%.2f" % SKY_STR)

score, f_exp, f_mul, (g, rd, sk, flags) = best
vs.exposure = f_exp
set_mud(f_mul)
os.replace(TMP, FINAL)
print(
    "LOOKFIX FINAL exp=%+.2f mud=%.2f grass=%s road=%s sky=%s pass=%d%d%d"
    % (f_exp, f_mul, g, rd, sk, *flags)
)
print("RENDER", FINAL, os.path.getsize(FINAL))
print("RENDER", TMP_SKY, os.path.getsize(TMP_SKY))

if sky_chk:
    for ob in sky_chk:
        bpy.data.objects.remove(ob, do_unlink=True)

out_blend = bpy.data.filepath
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("SAVED", out_blend)
print("DONE ph1b")
