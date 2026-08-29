# P7b extras — farm (garden beds), shrub (berry bush), cart+hay dressing props.
import bpy, os, json

def lin(hexstr):
    h = hexstr.lstrip('#'); out = []
    for i in (0, 2, 4):
        c = int(h[i:i+2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)

FLAT = {"fv_leaf_shrub": lin("4A5F35"), "fv_leaf_canopy": lin("4A5F35"),
        "fv_bark": lin("4A3826"), "fv_soil": lin("6E5B44"),
        "fv_wattle": lin("6E5B44"), "fv_hay": lin("A99B7C"),
        "fv_mat_oak": lin("4A3826"), "fv_mat_oak_weathered": lin("5C5142")}

blend_dir = os.path.dirname(bpy.data.filepath)
outdir = os.path.normpath(os.path.join(blend_dir, "..", "export", "gltf"))

flat_cache = {}
def flattened(mat):
    if mat is None or mat.name not in FLAT: return mat
    if mat.name not in flat_cache:
        m2 = mat.copy(); m2.name = mat.name + "__flat"
        bsdf = next((n for n in m2.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            base = bsdf.inputs['Base Color']
            for l in list(base.links): m2.node_tree.links.remove(l)
            base.default_value = FLAT[mat.name]
        flat_cache[mat.name] = m2
    return flat_cache[mat.name]

# Discover shrubs + props
shrubs = [o.name for o in bpy.data.objects if o.parent is None and "shrub" in o.name.lower()][:5]
props = [o.name for o in bpy.data.objects if o.parent is None and o.name.startswith(("fv_prop_cart", "fv_prop_hay", "fv_prop_firewood"))][:6]

TARGETS = {"fv_garden_s1": "fv_farm_plot.glb"}
if shrubs: TARGETS[shrubs[0]] = "fv_shrub_a.glb"
for p in props[:2]: TARGETS[p] = p + ".glb"

results = []
for src_name, fname in TARGETS.items():
    src = bpy.data.objects.get(src_name)
    if src is None:
        results.append({"src": src_name, "skip": "missing"}); continue
    before = set(bpy.data.objects)
    bpy.ops.object.select_all(action='DESELECT')
    src.select_set(True)
    for ch in src.children_recursive: ch.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate(linked=False)
    new_objs = [o for o in bpy.data.objects if o not in before]
    dup_root = next(o for o in new_objs if o.parent not in new_objs)
    dup_root.parent = None
    dup_root.location = (0.0, 0.0, 0.0)
    for o in new_objs:
        if o.type == 'MESH':
            for slot in o.material_slots: slot.material = flattened(slot.material)
    path = os.path.join(outdir, fname)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in new_objs: o.select_set(True)
    bpy.ops.object.delete()
    results.append({"src": src_name, "file": fname, "kb": round(os.path.getsize(path)/1024, 1)})

for m2 in flat_cache.values(): bpy.data.materials.remove(m2)
print(json.dumps({"shrub_candidates": shrubs, "prop_candidates": props, "exports": results}))
