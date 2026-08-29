"""Diagnostic: where do the road/grass projections actually land in the render?"""
import math

import bpy
import numpy as np
from bpy_extras import object_utils
from mathutils import Vector

ROOT = r"D:\MyProjects\Claude\luna-island\art\manor-slice"
FINAL = ROOT + r"\renders\ph1b_fix.png"

scene = bpy.context.scene
cam = bpy.data.objects["fv_cam_strategy"]
road = bpy.data.objects["fv_road_main"]
print("CAM_LOC", tuple(round(v, 1) for v in cam.matrix_world.translation))
dg = bpy.context.evaluated_depsgraph_get()
hit, loc, *_ = scene.ray_cast(dg, Vector((0, 0, 10)), Vector((0, 0, -1)))
print("CENTER_HIT", hit, tuple(round(v, 2) for v in loc))

img = bpy.data.images.load(FINAL)
w, h = img.size
arr = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(arr)
arr = arr.reshape(h, w, 4)


def px(cx, cy):
    return tuple(int(round(c * 255)) for c in arr[cy, cx, :3])


def probe(name, x, y):
    h2 = scene.ray_cast(dg, Vector((x, y, 10.0)), Vector((0.0, 0.0, -1.0)))
    p = (h2[1].x, h2[1].y, h2[1].z) if h2[0] else (x, y, 0.0)
    uv = object_utils.world_to_camera_view(scene, cam, Vector(p))
    cx, cy = int(uv.x * w), int(uv.y * h)
    row = arr[max(cy - 2, 0):cy + 3, :, :3].mean(axis=0)
    rg = row[:, 0] - row[:, 2]
    band = int(np.argmax(rg))
    print(
        "%s world=(%.1f,%.1f,%.2f) uv=(%.3f,%.3f) px=(%d,%d) color=%s "
        "maxRG_col=%d colColor=%s"
        % (name, p[0], p[1], p[2], uv.x, uv.y, cx, cy, px(cx, cy), band,
           px(band, cy))
    )


probe("ROAD_A", -20.0, 3.0 * math.sin(0.05 * -20.0 + 0.8))
probe("ROAD_B", 0.0, 3.0 * math.sin(0.8))
probe("GRASS_A", -32.0, -22.0)
bpy.data.images.remove(img)
