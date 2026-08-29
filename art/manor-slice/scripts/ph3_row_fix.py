import bpy
import math
import os
from mathutils import Vector

REND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

def bbox_of(root):
    pts = []
    for ch in root.children:
        if ch.type == 'MESH':
            pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

names = ['fv_burgage_l1', 'fv_burgage_l2', 'fv_church_wooden', 'fv_granary_barn',
         'fv_market_stall_a', 'fv_market_stall_b', 'fv_market_stall_c', 'fv_well_stone']
mn_all = mx_all = None
for n in names:
    mn, mx = bbox_of(bpy.data.objects[n])
    mn_all = mn if mn_all is None else Vector(map(min, mn_all, mn))
    mx_all = mx if mx_all is None else Vector(map(max, mx_all, mx))
ctr = (mn_all + mx_all) / 2.0
ctr.z = mn_all.z + (mx_all.z - mn_all.z) * 0.35
span = mx_all.x - mn_all.x
D = (span / 2.0) / math.atan(math.radians(19.8)) * 1.08
el = math.radians(8.0)
loc = ctr + Vector((0, -D * math.cos(el), D * math.sin(el)))

gbm_me = bpy.data.meshes.new('fv_tmp_ground')
import bmesh
gbm = bmesh.new()
bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=250)
gbm.to_mesh(gbm_me)
gbm.free()
gbm_me.materials.append(bpy.data.materials['fv_grass_base'])
gob = bpy.data.objects.new('fv_tmp_ground', gbm_me)
gob.location = (0, 0, -0.03)
bpy.data.collections['fv_Terrain'].objects.link(gob)
bpy.context.view_layer.update()

scn = bpy.context.scene
cd = bpy.data.cameras.new('fv_tmp_cam')
cd.lens = 50
co = bpy.data.objects.new('fv_tmp_cam', cd)
bpy.data.collections['fv_Lookdev'].objects.link(co)
co.location = loc
co.rotation_euler = (ctr - loc).to_track_quat('-Z', 'Y').to_euler()
scn.camera = co
scn.render.filepath = os.path.join(REND, 'ph3_row.png')
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(co, do_unlink=True)
bpy.data.objects.remove(gob, do_unlink=True)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)
scn.camera = None
print('ROW RE-SHOT: span=%.1f dist=%.1f cov=[%.1f,%.1f]' %
      (span, D, ctr.x - D * math.tan(math.radians(19.8)), ctr.x + D * math.tan(math.radians(19.8))))
