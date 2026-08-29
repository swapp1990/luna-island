import bpy
from mathutils import Vector

dg = bpy.context.evaluated_depsgraph_get()
scn = bpy.context.scene

print('--- objects with world-bbox diag > 30m ---')
for o in bpy.data.objects:
    if o.type not in ('MESH', 'CURVE'):
        continue
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    d = (mx - mn).length
    if d > 30.0:
        print('%-24s diag=%.0f mn=(%.0f,%.0f,%.0f) mx=(%.0f,%.0f,%.0f)' %
              (o.name, d, mn.x, mn.y, mn.z, mx.x, mx.y, mx.z))

print('--- ray casts from south of burgage_l1 toward its center ---')
root = bpy.data.objects.get('fv_burgage_l1')
ctr = Vector((-42, -32, 3.0))
for dist in (10, 18, 33, 60, 120):
    import math
    el = math.radians(12)
    horiz = dist * math.cos(el)
    loc = ctr + Vector((-math.sin(math.radians(18)) * horiz, -math.cos(math.radians(18)) * horiz, dist * math.sin(el)))
    direction = (ctr - loc).normalized()
    hit, hp, hn, fi, fo, m = scn.ray_cast(dg, loc, direction, distance=dist + 5)
    name = fo.name if hit else 'NOTHING'
    hd = (hp - loc).length if hit else -1
    print('camdist=%3d from=(%.0f,%.0f,%.1f) hit=%s at %.1fm' % (dist, loc.x, loc.y, loc.z, name, hd))

print('--- vertical ray down over row area ---')
for (x, y) in ((-42, -60), (-42, -80), (-42, -110), (0, -80), (30, -80)):
    hit, hp, hn, fi, fo, m = scn.ray_cast(dg, Vector((x, y, 50)), Vector((0, 0, -1)), distance=100)
    print('down@(%.0f,%.0f): %s z=%.2f' % (x, y, fo.name if hit else 'NOTHING', hp.z if hit else -99))

print('--- collection visibility ---')
vl = bpy.context.view_layer
def walk(lc, depth=0):
    print('  ' * depth, lc.collection.name, 'exclude=', lc.exclude, 'hide_viewport=', lc.hide_viewport)
    for ch in lc.children:
        walk(ch, depth + 1)
walk(vl.layer_collection)
print('scene.camera:', scn.camera.name if scn.camera else None)
