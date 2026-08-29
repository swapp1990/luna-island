# P7 batch export — every gameplay building root to per-asset GLB at origin.
import bpy, os, json

PREFIXES = ("fv_burgage_", "fv_church_", "fv_granary_", "fv_market_stall_", "fv_well")
blend_dir = os.path.dirname(bpy.data.filepath)
outdir = os.path.normpath(os.path.join(blend_dir, "..", "export", "gltf"))
os.makedirs(outdir, exist_ok=True)

roots = [o for o in bpy.data.objects
         if o.parent is None and o.name.startswith(PREFIXES) and not o.name.endswith("_tgt")]
results = []
for root in roots:
    before = set(bpy.data.objects)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for ch in root.children_recursive:
        ch.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.duplicate(linked=False)
    new_objs = [o for o in bpy.data.objects if o not in before]
    dup_root = next(o for o in new_objs if o.parent is None)
    dup_root.location.x = 0.0
    dup_root.location.y = 0.0
    path = os.path.join(outdir, root.name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in new_objs:
        o.select_set(True)
    bpy.ops.object.delete()
    results.append({"name": root.name, "kb": round(os.path.getsize(path) / 1024, 1)})

print(json.dumps(results))
