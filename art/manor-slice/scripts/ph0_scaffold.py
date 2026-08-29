"""Phase 0 scaffold: clean slate, fv_* collections, lookdev rig, engine, save.

Run inside Blender via tools/blender_client.py exec scripts/ph0_scaffold.py
"""
import math
import os
import bpy
from mathutils import Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
BLEND = os.path.join(ROOT, "scenes", "village.blend")
PREFIX = "fv_"
DEFAULT_KILL = {"Cube", "Camera", "Light"}


def purge():
    for ob in list(bpy.data.objects):
        if ob.name.startswith(PREFIX) or ob.name in DEFAULT_KILL:
            bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        if c.name.startswith(PREFIX):
            bpy.data.collections.remove(c)
    try:
        bpy.data.orphans_purge(do_recursive=True)
    except Exception as exc:
        print("purge skipped:", exc)


purge()

scene = bpy.context.scene
COLLS = ["fv_Terrain", "fv_Buildings", "fv_Environment", "fv_Props", "fv_Lookdev"]
made = []
for nm in COLLS:
    c = bpy.data.collections.new(nm)
    scene.collection.children.link(c)
    made.append(c.name)
look = bpy.data.collections["fv_Lookdev"]


def link(ob):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    look.objects.link(ob)


# ---------------- Sun ----------------
el = math.radians(25.0)  # elevation above horizon
# light travels from SW toward NE and down
direction = Vector((
    math.cos(el) / math.sqrt(2.0),
    math.cos(el) / math.sqrt(2.0),
    -math.sin(el),
))
quat = direction.to_track_quat("-Z", "Y")
sun_data = bpy.data.lights.new("fv_sun_data", type="SUN")
sun_data.energy = 3.0
sun_data.color = (1.0, 0.88, 0.72)
try:
    sun_data.angle = math.radians(2.5)
except Exception as exc:
    print("sun angle not set:", exc)
sun = bpy.data.objects.new("fv_sun", sun_data)
link(sun)
sun.rotation_euler = quat.to_euler()
print("SUN_EULER(deg)", tuple(round(math.degrees(a), 2) for a in sun.rotation_euler))


# ---------------- World ----------------
world = bpy.data.worlds.get("fv_world") or bpy.data.worlds.new("fv_world")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
try:
    out_n = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    for st in ("NISHITA", "SINGLE_SCATTERING"):  # 5.x renamed Nishita
        try:
            sky.sky_type = st
            break
        except TypeError:
            continue
    try:
        sky.sun_disc = False
    except Exception as exc:
        print("sky.sun_disc unavailable:", exc)
    sky.sun_elevation = el
    sky.sun_rotation = math.radians(225.0)  # sun sits toward SW
    bg.inputs["Strength"].default_value = 0.6
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out_n.inputs["Surface"])
    print("WORLD_OK %s elev=25deg rot=225deg strength=0.6 sun_disc=%s" % (sky.sky_type, getattr(sky, "sun_disc", "n/a")))
except Exception as exc:
    print("WORLD_FALLBACK flat gray:", exc)
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.35, 0.40, 0.45, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out_n.inputs["Surface"])


# ---------------- Cameras ----------------
def make_cam(name, loc, tgt_loc, lens):
    cd = bpy.data.cameras.new(name + "_data")
    cd.lens = lens
    cam = bpy.data.objects.new(name, cd)
    link(cam)
    cam.location = loc
    tgt = bpy.data.objects.new(name + "_tgt", None)
    link(tgt)
    tgt.location = tgt_loc
    tr = cam.constraints.new(type="TRACK_TO")
    tr.target = tgt
    tr.track_axis = "TRACK_NEGATIVE_Z"
    tr.up_axis = "UP_Y"
    return cam


make_cam("fv_cam_strategy", (60.0, -60.0, 45.0), (0.0, 10.0, 0.0), 40.0)
make_cam("fv_cam_ground", (12.0, -8.0, 1.7), (0.0, 8.0, 1.5), 35.0)


# ---------------- Engine ----------------
chosen = None
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = eng
        chosen = eng
        break
    except TypeError:
        continue
print("ENGINE", chosen)

flags = []
ee = getattr(scene, "eevee", None)
if ee is not None:
    for attr in ("use_shadows", "use_raytracing", "use_soft_shadows"):
        try:
            setattr(ee, attr, True)
            flags.append(attr)
        except Exception:
            pass
    try:
        ee.taa_render_samples = 32
        flags.append("taa_render_samples=32")
    except Exception:
        pass
print("ENGINE_FLAGS", flags)

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100


# ---------------- Save ----------------
os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)

print("OBJECTS", sorted((o.name, o.type) for o in scene.objects))
print("COLLECTIONS", made)
print("SAVED", BLEND)
