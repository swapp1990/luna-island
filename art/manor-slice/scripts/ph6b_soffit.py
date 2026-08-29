import bpy, math, os
from mathutils import Vector

RD = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

def col(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

m = bpy.data.materials.get('fv_roof_soffit')
if not m:
    m = bpy.data.materials.new('fv_roof_soffit')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexcol('#241D16')
    b.inputs['Roughness'].default_value = 1.0

fixed = []
for nm in ('l2_roof', 'gr_roof', 'ch_roof'):
    o = bpy.data.objects.get(nm)
    if not o:
        continue
    me = o.data
    if len(me.materials) < 3:
        me.materials.append(m)
    si = len(me.materials) - 1
    if len(me.polygons) >= 10:
        for pi in (2, 3, 6, 7):
            me.polygons[pi].material_index = si
    fixed.append((nm, len(me.polygons)))

o = bpy.data.objects.get('l1_roof')
if o:
    me = o.data
    me.materials.append(m)
    si = len(me.materials) - 1
    vs = [v.co.copy() for v in me.vertices]
    if len(vs) >= 12:
        add = [(6, 10, 11, 9), (7, 8, 11, 10)]
        start = len(me.polygons)
        me.from_pydata([], [], [])
        me.loops.ensure_lookup_table()
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        verts = [bm.verts.new(v) for v in vs]
        for f in add:
            bm.faces.new([verts[i] for i in f])
        bm.to_mesh(me)
        bm.free()
        me.update()
        for p in list(me.polygons)[start:]:
            p.material_index = si
            p.use_smooth = False
        fixed.append(('l1_roof', len(me.polygons)))

print('SOFFIT FIXED', fixed)
bpy.ops.wm.save_mainfile()

scn = bpy.context.scene
old = scn.camera or bpy.data.objects.get('fv_cam_strategy')

def render_cam(loc, target, path, lens=40):
    cd = bpy.data.cameras.new('fv_tmp_cam3')
    cd.lens = lens
    cam = bpy.data.objects.new('fv_tmp_cam3', cd)
    col('fv_Lookdev').objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    scn.camera = old

render_cam((-30, -1.2, 1.7), (14, 3.5, 2.4), os.path.join(RD, 'ph6b_street.png'), lens=40)
render_cam((-6, -4, 2.0), (7, 8, 1.6), os.path.join(RD, 'ph6b_market.png'), lens=40)
for f in ('ph6b_street.png', 'ph6b_market.png'):
    p = os.path.join(RD, f)
    print(f, os.path.getsize(p) if os.path.exists(p) else 'MISSING')
print('PH6B DONE')
