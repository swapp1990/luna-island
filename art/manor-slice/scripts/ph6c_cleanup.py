import bpy, math, os
from mathutils import Vector

RD = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

def col(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

ROOTS = ('fv_burgage_l1', 'fv_burgage_l2', 'fv_church_wooden', 'fv_granary_barn',
         'fv_market_stall_a', 'fv_market_stall_b', 'fv_market_stall_c', 'fv_well_stone')
keep = set()
live_roofs = {}
for rn in ROOTS:
    r = bpy.data.objects.get(rn)
    if not r:
        print('ROOT MISSING', rn)
        continue
    for o in r.children_recursive:
        keep.add(o)
        for pfx in ('l1_roof', 'l2_roof', 'ch_roof', 'gr_roof'):
            if o.name.startswith(pfx):
                live_roofs[pfx] = o

orphans = []
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o in keep:
        continue
    if o.name.startswith(('fv_kit_', 'fv_roof_', 'fv_terrain', 'fv_road')):
        continue
    if o.users_collection and o.users_collection[0].name in ('fv_Buildings',):
        orphans.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
print('ORPHANS REMOVED:', len(orphans), orphans[:12])

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

m = bpy.data.materials.get('fv_roof_soffit')
if not m:
    m = bpy.data.materials.new('fv_roof_soffit')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexcol('#241D16')
    b.inputs['Roughness'].default_value = 1.0

def fix_gable(o):
    me = o.data
    me.materials.append(m)
    si = len(me.materials) - 1
    if len(me.polygons) >= 10:
        for pi in (2, 3, 6, 7):
            me.polygons[pi].material_index = si
    return True

def fix_hip(o):
    me = o.data
    me.materials.append(m)
    si = len(me.materials) - 1
    vs = [v.co.copy() for v in me.vertices]
    if len(vs) < 12:
        return False
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    verts = [bm.verts.new(v) for v in vs]
    start = len(me.polygons)
    for f in ((6, 10, 11, 9), (7, 8, 11, 10)):
        try:
            bm.faces.new([verts[i] for i in f])
        except ValueError:
            pass
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in list(me.polygons)[start:]:
        p.material_index = si
        p.use_smooth = False
    return True

report = {}
for pfx, fn in (('l1_roof', fix_hip), ('l2_roof', fix_gable), ('gr_roof', fix_gable), ('ch_roof', fix_gable)):
    o = live_roofs.get(pfx)
    report[pfx] = (o.name if o else 'MISSING', fn(o) if o else False)
print('SOFFIT', report)
bpy.ops.wm.save_mainfile()

scn = bpy.context.scene
old = scn.camera or bpy.data.objects.get('fv_cam_strategy')

def render_cam(loc, target, path, lens=40):
    cd = bpy.data.cameras.new('fv_tmp_cam4')
    cd.lens = lens
    cam = bpy.data.objects.new('fv_tmp_cam4', cd)
    col('fv_Lookdev').objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    scn.camera = old

render_cam((-30, -1.2, 1.7), (14, 3.5, 2.4), os.path.join(RD, 'ph6c_street.png'), lens=40)
render_cam((-6, -4, 2.0), (7, 8, 1.6), os.path.join(RD, 'ph6c_market.png'), lens=40)
render_cam((-34, -50, 30), (0, 6, 0), os.path.join(RD, 'ph6c_village.png'), lens=35)
for f in ('ph6c_street.png', 'ph6c_market.png', 'ph6c_village.png'):
    p = os.path.join(RD, f)
    print(f, os.path.getsize(p) if os.path.exists(p) else 'MISSING')
print('PH6C DONE')
