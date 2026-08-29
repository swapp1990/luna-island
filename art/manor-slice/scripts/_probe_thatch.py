import bpy

m = bpy.data.materials['fv_roof_thatch']
print('== thatch nodes ==')
for n in m.node_tree.nodes:
    def dv(i):
        try:
            v = i.default_value
            return [round(x, 3) for x in v] if hasattr(v, '__len__') else round(v, 3)
        except Exception:
            return '?'
    ins = {i.name: (list(i.links)[0].from_node.name if i.links else dv(i)) for i in n.inputs}
    print(n.type, n.name, '| in:', ins)
    if n.type == 'VALTORGB':
        for e in n.color_ramp.elements:
            print('   ramp elem pos', round(e.position, 3), 'col', [round(c, 3) for c in e.color])
    if n.type == 'TEX_NOISE':
        print('   noise scale', n.inputs['Scale'].default_value, 'detail', n.inputs['Detail'].default_value,
              'vec linked:', bool(n.inputs['Vector'].links))
print('output:', [(n.name, n.inputs['Surface'].links[0].from_node.name) for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL'])

for nm in ('fv_mat_stone_field', 'fv_timber_oak', 'fv_mat_opening_void', 'fv_mat_oak_weathered', 'fv_mat_iron'):
    mm = bpy.data.materials.get(nm)
    if mm and mm.use_nodes:
        bsdf = next((n for n in mm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        base = 'linked' if bsdf is None or bsdf.inputs['Base Color'].links else [round(c, 3) for c in bsdf.inputs['Base Color'].default_value]
        print(nm, 'base', base)
kit = bpy.data.objects['fv_kit_footing_stone']
print('footing mats:', [s.material.name for s in kit.material_slots])
