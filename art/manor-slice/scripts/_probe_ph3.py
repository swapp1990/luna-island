import bpy
print('COLLECTIONS:', sorted(c.name for c in bpy.data.collections))
print('MATERIALS:')
for m in sorted(bpy.data.materials.keys()):
    print('  ', m)
print('OBJECTS (fv_):')
for o in sorted(bpy.data.objects.keys()):
    if o.startswith('fv_'):
        print('  ', o)
scn = bpy.context.scene
print('scene:', scn.name, 'engine:', scn.render.engine, 'cam:', scn.camera.name if scn.camera else None)
print('res:', scn.render.resolution_x, scn.render.resolution_y, 'samples:', scn.eevee.taa_render_samples)
