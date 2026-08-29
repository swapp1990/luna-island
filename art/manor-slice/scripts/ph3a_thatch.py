import bpy

hx = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)
nt = bpy.data.materials['fv_roof_thatch'].node_tree

ramp = next(n for n in nt.nodes if n.type == 'VALTORGB')
ramp.color_ramp.elements[0].color = hx('#332A20')
ramp.color_ramp.elements[1].color = hx('#6B5A42')
print('ramp:', [(round(e.position, 2), tuple(round(c, 3) for c in e.color)) for e in ramp.color_ramp.elements])

fine_bump = next(n for n in nt.nodes if n.type == 'BUMP')
texco = next(n for n in nt.nodes if n.type == 'TEX_COORD')

coarse = nt.nodes.new('ShaderNodeTexNoise')
coarse.name = 'Noise Clump'
coarse.label = 'Clump Noise'
coarse.inputs['Scale'].default_value = 3.5
coarse.inputs['Detail'].default_value = 3.0
coarse.location = (fine_bump.location.x - 320, fine_bump.location.y - 280)
nt.links.new(texco.outputs['Object'], coarse.inputs['Vector'])

mul = nt.nodes.new('ShaderNodeMath')
mul.operation = 'MULTIPLY'
mul.inputs[1].default_value = 0.5
mul.location = (coarse.location.x + 200, coarse.location.y)
nt.links.new(coarse.outputs['Fac'], mul.inputs[0])

coarse_bump = nt.nodes.new('ShaderNodeBump')
coarse_bump.name = 'Bump Clump'
coarse_bump.label = 'Clump Bump'
coarse_bump.inputs['Strength'].default_value = 0.5
coarse_bump.inputs['Distance'].default_value = 0.03
coarse_bump.location = (fine_bump.location.x + 210, fine_bump.location.y - 240)

for l in [l for l in nt.links if l.from_node == fine_bump and l.to_node.type == 'BSDF_PRINCIPLED']:
    nt.links.remove(l)
nt.links.new(fine_bump.outputs['Normal'], coarse_bump.inputs['Normal'])
nt.links.new(mul.outputs[0], coarse_bump.inputs['Height'])

bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
nt.links.new(coarse_bump.outputs['Normal'], bsdf.inputs['Normal'])
print('chain: fine_noise->bump1->bump2(normal in), clump_fac*0.5->bump2.height, bump2->BSDF.Normal')

bpy.ops.wm.save_mainfile()
print('PH3A DONE')
