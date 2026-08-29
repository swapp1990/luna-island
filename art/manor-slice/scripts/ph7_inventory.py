# P7 export prep — inventory: top-level collections, object counts, dims of building roots.
import bpy, json

out = {"collections": [], "building_roots": []}
for col in bpy.data.collections:
    out["collections"].append({"name": col.name, "objects": len(col.all_objects)})

# Building roots: parentless objects whose name starts with fv_
for ob in bpy.data.objects:
    if ob.parent is None and ob.name.startswith("fv_"):
        d = ob.dimensions
        out["building_roots"].append({
            "name": ob.name, "type": ob.type,
            "children": len(ob.children_recursive) if hasattr(ob, "children_recursive") else len(ob.children),
            "dims": [round(d.x, 2), round(d.y, 2), round(d.z, 2)],
            "loc": [round(ob.location.x, 1), round(ob.location.y, 1)],
        })
out["building_roots"] = out["building_roots"][:60]
print(json.dumps(out))
