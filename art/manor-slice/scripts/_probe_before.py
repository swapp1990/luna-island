"""Capture 'before' numbers: same tuned scene under legacy AgX view transform."""
import os

import bpy
import numpy as np
from bpy_extras import object_utils
from mathutils import Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
TMP = ROOT + r"\renders\_ph1b_before.png"

scene = bpy.context.scene
vs = scene.view_settings
keep = (vs.view_transform, vs.look, vs.exposure)
cam = bpy.data.objects["fv_cam_strategy"]
dg = bpy.context.evaluated_depsgraph_get()


def patch_at(x, y, r=16):
    hit, loc, *_r = scene.ray_cast(dg, Vector((x, y, 10)), Vector((0, 0, -1)))
    uv = object_utils.world_to_camera_view(scene, cam, loc)
    w, h = scene.render.resolution_x, scene.render.resolution_y
    cx, cy = int(uv.x * w), int(uv.y * h)
    img = bpy.data.images.load(TMP)
    arr = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    arr = arr.reshape(h, w, 4)[cy - r:cy + r, cx - r:cx + r, :3].mean(axis=(0, 1))
    return tuple(int(round(c * 255)) for c in arr)


vs.view_transform = "AgX"
try:
    vs.look = "None"
except Exception:
    pass
vs.exposure = 0.0
scene.camera = cam
scene.render.filepath = TMP
bpy.ops.render.render(write_still=True)
print("BEFORE_AgX grass=%s road=%s" % (
    patch_at(-30.0, -20.0), patch_at(-12.0, 3.0 * __import__("math").sin(0.05 * -12.0 + 0.8))))
vs.view_transform, vs.look, vs.exposure = keep
scene.render.filepath = ROOT + r"\renders\ph1b_fix.png"
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
os.remove(TMP)
print("RESTORED", keep)
