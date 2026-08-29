"""Phase 1 ground: terrain tile + dirt road ribbon + two preview renders.

Run inside Blender via tools/blender_client.py exec scripts/ph1_ground.py
"""
import math
import os
import bpy

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
REN = os.path.join(ROOT, "renders")
BLEND_FALLBACK = os.path.join(ROOT, "scenes", "village.blend")
OBJ_NAMES = ("fv_terrain_tile", "fv_road_main", "fv_cam_top")
DATA_PREFIXES = OBJ_NAMES + ("fv_grass_base", "fv_dirt_road", "fv_disp_clouds")


def srgb_lin(hexstr):
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (
        f(int(hexstr[1:3], 16) / 255.0),
        f(int(hexstr[3:5], 16) / 255.0),
        f(int(hexstr[5:7], 16) / 255.0),
        1.0,
    )


# ---------------- idempotent pre-clean (own artifacts only) ----------------
for nm in OBJ_NAMES:
    ob = bpy.data.objects.get(nm)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.textures, bpy.data.cameras):
    for db in list(coll):
        if any(db.name.startswith(p) for p in DATA_PREFIXES):
            try:
                coll.remove(db)
            except Exception:
                pass
try:
    bpy.data.orphans_purge(do_recursive=True)
except Exception:
    pass

scene = bpy.context.scene
terr_coll = bpy.data.collections["fv_Terrain"]


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


class MixWrap:
    """Uniform access over legacy MixRGB and modern Mix(RGBA) nodes."""

    def __init__(self, node):
        self.n = node
        self.legacy = node.bl_idname == "ShaderNodeMixRGB"

    @property
    def fac(self):
        return self.n.inputs["Fac"] if self.legacy else self.n.inputs[0]

    @property
    def a(self):
        return self.n.inputs["Color1"] if self.legacy else self.n.inputs[6]

    @property
    def b(self):
        return self.n.inputs["Color2"] if self.legacy else self.n.inputs[7]

    @property
    def outp(self):
        return self.n.outputs["Color"] if self.legacy else self.n.outputs[2]


# ---------------- terrain ----------------
N_SEG = 200          # segments per side
SIZE = 140.0
dx = SIZE / N_SEG
verts = []
for j in range(N_SEG + 1):
    for i in range(N_SEG + 1):
        verts.append((i * dx - SIZE / 2.0, j * dx - SIZE / 2.0, 0.0))
faces = []
for j in range(N_SEG):
    for i in range(N_SEG):
        a = j * (N_SEG + 1) + i
        faces.append((a, a + 1, a + N_SEG + 2, a + N_SEG + 1))
tme = bpy.data.meshes.new("fv_terrain_tile")
tme.from_pydata(verts, [], faces)
tme.update()
terr = bpy.data.objects.new("fv_terrain_tile", tme)
terr_coll.objects.link(terr)

tex = bpy.data.textures.new("fv_disp_clouds", type="CLOUDS")
try:
    tex.noise_scale = 18.0
except Exception:
    tex.noise_size = 18.0
try:
    tex.noise_depth = 4
except Exception:
    pass
mod = terr.modifiers.new("fv_displace", "DISPLACE")
mod.texture = tex
mod.strength = 0.8     # peak amplitude ~ +-0.4 m about mid_level
mod.mid_level = 0.5
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev_me = bpy.data.meshes.new_from_object(terr.evaluated_get(dg))
old_me = terr.data
terr.modifiers.clear()
terr.data = ev_me
if old_me.users == 0:
    bpy.data.meshes.remove(old_me)

# flatten central strip: |y|<12 fully flat (fades 12->20), road span |x|<=55 (fades 55->63)
for v in terr.data.vertices:
    x, y, z = v.co
    f_y = 1.0 - smoothstep((abs(y) - 12.0) / 8.0)
    f_x = 1.0 - smoothstep((abs(x) - 55.0) / 8.0)
    v.co.z = z * (1.0 - f_y * f_x)
terr.data.update()

for p in terr.data.polygons:
    p.use_smooth = True

gm = bpy.data.materials.new("fv_grass_base")
gm.use_nodes = True
gnt = gm.node_tree
gb = gnt.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = srgb_lin("#7A8F4A")
gb.inputs["Roughness"].default_value = 0.9
nz = gnt.nodes.new("ShaderNodeTexNoise")
nz.inputs["Scale"].default_value = 0.04
ramp = gnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = srgb_lin("#6E8544")
ramp.color_ramp.elements[1].position = 0.65
ramp.color_ramp.elements[1].color = srgb_lin("#9AA05A")
gnt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
gnt.links.new(ramp.outputs["Color"], gb.inputs["Base Color"])
terr.data.materials.append(gm)


# ---------------- road ribbon ----------------
M_SEG = 20
HW = 2.25           # half width -> 4.5 m
RZ = 0.03           # sits above flattened terrain (~0 m there)
pts = []
for k in range(M_SEG + 1):
    x = -55.0 + 110.0 * k / M_SEG
    pts.append((x, 3.0 * math.sin(0.05 * x + 0.8)))

cum = [0.0]
for k in range(M_SEG):
    cum.append(cum[-1] + math.dist(pts[k], pts[k + 1]))
total = cum[-1]

rv = []
for k, (x, y) in enumerate(pts):
    if k == 0:
        tx, ty = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
    elif k == M_SEG:
        tx, ty = pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]
    else:
        tx, ty = pts[k + 1][0] - pts[k - 1][0], pts[k + 1][1] - pts[k - 1][1]
    tl = math.hypot(tx, ty)
    nx, ny = -ty / tl, tx / tl
    rv.append((x + nx * HW, y + ny * HW, RZ))   # left  = even index
    rv.append((x - nx * HW, y - ny * HW, RZ))   # right = odd index
rfaces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(M_SEG)]

rme = bpy.data.meshes.new("fv_road_main")
rme.from_pydata(rv, [], rfaces)
rme.update()
uvl = rme.uv_layers.new(name="UVMap")
for poly in rme.polygons:
    u0, u1 = cum[poly.index] / total, cum[poly.index + 1] / total
    corner_uv = ((u0, 0.0), (u0, 1.0), (u1, 1.0), (u1, 0.0))
    for li, cuv in zip(poly.loop_indices, corner_uv):
        uvl.data[li].uv = cuv
for p in rme.polygons:
    p.use_smooth = True
road = bpy.data.objects.new("fv_road_main", rme)
terr_coll.objects.link(road)

dm = bpy.data.materials.new("fv_dirt_road")
dm.use_nodes = True
dnt = dm.node_tree
db = dnt.nodes["Principled BSDF"]
db.inputs["Roughness"].default_value = 0.95
BASE = srgb_lin("#B5A488")

try:
    dm.blend_method = "BLEND"
except Exception as exc:
    print("blend_method unavailable:", exc)
if hasattr(dm, "surface_render_method"):
    dm.surface_render_method = "BLENDED"

# alpha feather across width: |v-0.5| <= 1/6 -> alpha 1, fades to 0 at edges
uvm = dnt.nodes.new("ShaderNodeUVMap")
uvm.uv_map = "UVMap"
sep = dnt.nodes.new("ShaderNodeSeparateXYZ")
sub = dnt.nodes.new("ShaderNodeMath")
sub.operation = "SUBTRACT"
sub.inputs[1].default_value = 0.5
ab = dnt.nodes.new("ShaderNodeMath")
ab.operation = "ABSOLUTE"
mr = dnt.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = 1.0 / 6.0
mr.inputs["From Max"].default_value = 0.5
mr.inputs["To Min"].default_value = 1.0
mr.inputs["To Max"].default_value = 0.0
try:
    mr.clamp = True
except Exception:
    pass
dnt.links.new(uvm.outputs["UV"], sep.inputs["Vector"])
dnt.links.new(sep.outputs["Y"], sub.inputs[0])
dnt.links.new(sub.outputs["Value"], ab.inputs[0])
dnt.links.new(ab.outputs["Value"], mr.inputs["Value"])
dnt.links.new(mr.outputs["Result"], db.inputs["Alpha"])

# subtle mud patches toward road center
mnz = dnt.nodes.new("ShaderNodeTexNoise")
mnz.inputs["Scale"].default_value = 25.0
mrmp = dnt.nodes.new("ShaderNodeValToRGB")
mrmp.color_ramp.elements[0].position = 0.42
mrmp.color_ramp.elements[1].position = 0.58
mul = dnt.nodes.new("ShaderNodeMath")
mul.operation = "MULTIPLY"
mul.inputs[1].default_value = 0.45
mmix = MixWrap(dnt.nodes.new("ShaderNodeMixRGB"))
mmix.a.default_value = BASE
mmix.b.default_value = srgb_lin("#6E5B44")
dnt.links.new(mnz.outputs["Fac"], mrmp.inputs["Fac"])
dnt.links.new(mrmp.outputs["Color"], mul.inputs[0])
dnt.links.new(mul.outputs["Value"], mmix.fac)
dnt.links.new(mmix.outp, db.inputs["Base Color"])
road.data.materials.append(dm)


# ---------------- previews ----------------
os.makedirs(REN, exist_ok=True)
prev_cam = scene.camera

cd = bpy.data.cameras.new("fv_cam_top_data")
cd.type = "ORTHO"
cd.ortho_scale = 150.0
top = bpy.data.objects.new("fv_cam_top", cd)
scene.collection.objects.link(top)
top.location = (0.0, 0.0, 80.0)
top.rotation_euler = (0.0, 0.0, 0.0)

paths = []


def shot(cam, path):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    paths.append(path)
    print("RENDERED", path)


shot(top, os.path.join(REN, "ph1_top.png"))
strategy = bpy.data.objects.get("fv_cam_strategy")
if strategy is None:
    raise RuntimeError("fv_cam_strategy missing - run ph0_scaffold.py first")
shot(strategy, os.path.join(REN, "ph1_strategy.png"))
scene.camera = prev_cam
bpy.data.objects.remove(top, do_unlink=True)

for o in (terr, road):
    o.data.calc_loop_triangles()
    print(
        "OBJ %s tris=%d dims=(%.2f, %.2f, %.2f)"
        % (o.name, len(o.data.loop_triangles),
           o.dimensions.x, o.dimensions.y, o.dimensions.z)
    )

out_blend = bpy.data.filepath or BLEND_FALLBACK
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("SAVED", out_blend)
print("DONE ph1")
