# P7b — re-export buildings + trees with flattened albedo copies for node-driven
# materials (glTF can't carry procedural shaders). Originals are never modified:
# duplicates get material COPIES, both deleted after export.
import bpy, os, json

def lin(hexstr):
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i+2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)

# Style-bible albedos for node-driven materials (specs/manor-slice-assets.md palette).
FLAT = {
    "fv_roof_thatch": lin("8A7A5E"), "fv_roof_shingle": lin("7C8378"),
    "fv_roof_tile": lin("9C5F3C"), "fv_mat_oak": lin("4A3826"),
    "fv_mat_oak_weathered": lin("5C5142"), "fv_timber_oak": lin("4A3826"),
    "fv_stone_fieldstone": lin("8C8578"), "fv_mat_stone_field": lin("8C8578"),
    "fv_plank_wall": lin("5C5142"), "fv_wattle": lin("6E5B44"),
    "fv_hay": lin("A99B7C"), "fv_soil": lin("6E5B44"),
    "fv_dirt_road": lin("B5A488"), "fv_grass_base": lin("7A8F4A"),
    "fv_leaf_canopy": lin("4A5F35"), "fv_leaf_autumn": lin("7A6B35"),
    "fv_leaf_shrub": lin("4A5F35"), "fv_bark": lin("4A3826"),
    "fv_canvas_striped": lin("C9B896"), "fv_canvas_stripes": lin("C9B896"),
}

blend_dir = os.path.dirname(bpy.data.filepath)
outdir = os.path.normpath(os.path.join(blend_dir, "..", "export", "gltf"))
os.makedirs(outdir, exist_ok=True)

BUILDINGS = ("fv_burgage_", "fv_church_", "fv_granary_", "fv_market_stall_", "fv_well")
TREES = ("fv_tree", "fv_oak", "fv_beech", "fv_spruce")
roots = [o for o in bpy.data.objects if o.parent is None and not o.name.endswith("_tgt")
         and (o.name.startswith(BUILDINGS) or o.name.startswith(TREES))]
tree_names = [o.name for o in bpy.data.objects if o.parent is None and o.name.startswith(TREES)]

flat_cache = {}
def flattened(mat):
    if mat is None or mat.name not in FLAT:
        return mat
    if mat.name not in flat_cache:
        m2 = mat.copy()
        m2.name = mat.name + "__flat"
        if m2.use_nodes:
            bsdf = next((n for n in m2.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf:
                base = bsdf.inputs['Base Color']
                for l in list(base.links):
                    m2.node_tree.links.remove(l)
                base.default_value = FLAT[mat.name]
        flat_cache[mat.name] = m2
    return flat_cache[mat.name]

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
    for o in new_objs:
        if o.type == 'MESH':
            for slot in o.material_slots:
                slot.material = flattened(slot.material)
    path = os.path.join(outdir, root.name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in new_objs:
        o.select_set(True)
    bpy.ops.object.delete()
    results.append({"name": root.name, "kb": round(os.path.getsize(path) / 1024, 1)})

for m2 in flat_cache.values():
    bpy.data.materials.remove(m2)

print(json.dumps({"tree_roots_found": tree_names[:20], "exports": results}))
