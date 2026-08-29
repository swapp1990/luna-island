# P7 — material inventory: name, base color source (node-driven vs flat), viewport color.
import bpy, json

out = []
for m in bpy.data.materials:
    if not m.use_nodes:
        out.append({"name": m.name, "mode": "flat", "col": [round(c, 3) for c in m.diffuse_color[:3]]})
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        out.append({"name": m.name, "mode": "no-principled"})
        continue
    base = bsdf.inputs['Base Color']
    if base.is_linked:
        src = base.links[0].from_node.type
        out.append({"name": m.name, "mode": f"linked:{src}", "vp": [round(c, 3) for c in m.diffuse_color[:3]]})
    else:
        out.append({"name": m.name, "mode": "value", "col": [round(c, 3) for c in base.default_value[:3]]})
print(json.dumps(out))
