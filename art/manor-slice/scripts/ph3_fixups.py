import bpy
import math
import os
from mathutils import Vector

REND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

m = bpy.data.materials['fv_canvas_striped']
ramp = next(n for n in m.node_tree.nodes if n.type == 'VALTORGB')
ramp.color_ramp.elements[1].position = 0.5
print('stripes: elem1 pos ->', ramp.color_ramp.elements[1].position)

root = bpy.data.objects['fv_market_stall_a']
spots = [(0.95, -0.30, 1.01), (1.02, -0.48, 1.14), (0.88, -0.60, 1.27)]
for i in range(3):
    ob = bpy.data.objects['fv_market_a_cloth%d' % i]
    ob.location = spots[i]
    print('cloth%d ->' % i, tuple(round(v, 2) for v in ob.location))

scn = bpy.context.scene

def shoot(path, loc, target, lens=50):
    cd = bpy.data.cameras.new('fv_tmp_cam')
    cd.lens = lens
    co = bpy.data.objects.new('fv_tmp_cam', cd)
    bpy.data.collections['fv_Lookdev'].objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = co
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co, do_unlink=True)

shoot(os.path.join(REND, 'ph3_market_stall_a.png'), (9.4, -37.8, 2.4), (12.5, -32.0, 1.6))

church = bpy.data.objects['fv_church_wooden']
shoot(os.path.join(REND, 'ph3_church_door.png'), (-37.5, -34.5, 3.6), (-24.2, -32.0, 2.0))

scn.camera = None
bpy.ops.wm.save_mainfile()
print('FIXUPS DONE')
