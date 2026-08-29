# P7 export probe — export ONE building root (fv_burgage_l1) to GLB at origin.
import bpy, os, json

NAME = "fv_burgage_l1"
blend_dir = os.path.dirname(bpy.data.filepath)
outdir = os.path.normpath(os.path.join(blend_dir, "..", "export", "gltf"))
os.makedirs(outdir, exist_ok=True)

root = bpy.data.objects.get(NAME)
assert root is not None, f"missing {NAME}"

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

path = os.path.join(outdir, NAME + ".glb")
bpy.ops.export_scene.gltf(
    filepath=path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
bpy.ops.object.select_all(action='DESELECT')
for o in new_objs:
    o.select_set(True)
bpy.ops.object.delete()

sz = os.path.getsize(path)
n_img = len([i for i in bpy.data.images if i.packed_file])
print(json.dumps({"file": path, "bytes": sz, "objects_exported": len(new_objs), "packed_images_in_blend": n_img}))
