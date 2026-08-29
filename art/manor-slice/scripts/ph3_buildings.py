import bpy, math, random
import numpy as np
from mathutils import Vector

rng = random.Random(11)
BLEND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\scenes\village.blend"
RD = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"
C = 'fv_Buildings'

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

def col(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

def purge(prefixes):
    for o in list(bpy.data.objects):
        if any(o.name.startswith(p) for p in prefixes):
            bpy.data.objects.remove(o, do_unlink=True)

def mat_simple(name, base, rough=0.9):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexcol(base)
    b.inputs['Roughness'].default_value = rough
    return m

def mat_plank(name, c1, c2, gap, pw=0.3):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Brick Width'].default_value = 9.0
    br.inputs['Row Height'].default_value = pw
    br.inputs['Mortar Size'].default_value = 0.015
    br.inputs['Color1'].default_value = hexcol(c1)
    br.inputs['Color2'].default_value = hexcol(c2)
    br.inputs['Mortar'].default_value = hexcol(gap)
    bmp = nt.nodes.new('ShaderNodeBump')
    bmp.inputs['Strength'].default_value = 0.3
    nt.links.new(tc.outputs['Object'], br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(br.outputs['Fac'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], b.inputs['Normal'])
    return m

def mat_stone(name, c1, c2):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ns = nt.nodes.new('ShaderNodeTexNoise')
    ns.inputs['Scale'].default_value = 9.0
    ns.inputs['Detail'].default_value = 5.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = hexcol(c2)
    ramp.color_ramp.elements[1].color = hexcol(c1)
    bmp = nt.nodes.new('ShaderNodeBump')
    bmp.inputs['Strength'].default_value = 0.4
    nt.links.new(tc.outputs['Object'], ns.inputs['Vector'])
    nt.links.new(ns.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(ns.outputs['Fac'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.95
    return m

def mat_canvas_stripes():
    name = 'fv_canvas_stripes'
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 2 * math.pi / 0.35
    sin = nt.nodes.new('ShaderNodeMath')
    sin.operation = 'SINE'
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = hexcol('#9E4B3C')
    ramp.color_ramp.elements[1].color = hexcol('#D8CDB4')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['X'], mul.inputs[0])
    nt.links.new(mul.outputs['Value'], sin.inputs[0])
    nt.links.new(sin.outputs['Value'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9
    return m

MTH = bpy.data.materials['fv_roof_thatch']
for n in MTH.node_tree.nodes:
    if n.type == 'VALTORGB':
        n.color_ramp.elements[0].color = hexcol('#332A20')
        n.color_ramp.elements[1].color = hexcol('#6B5A42')
has_coarse = any(n.type == 'TEXNOISE' and n.inputs['Scale'].default_value == 3.5 for n in MTH.node_tree.nodes)
if not has_coarse:
    nt = MTH.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ns = nt.nodes.new('ShaderNodeTexNoise')
    ns.inputs['Scale'].default_value = 3.5
    ns.inputs['Detail'].default_value = 3.0
    bmp2 = nt.nodes.new('ShaderNodeBump')
    bmp2.inputs['Strength'].default_value = 0.25
    old_bump = [n for n in nt.nodes if n.type == 'BUMP'][0]
    nt.links.new(tc.outputs['Object'], ns.inputs['Vector'])
    nt.links.new(ns.outputs['Fac'], bmp2.inputs['Height'])
    nt.links.new(old_bump.outputs['Normal'], bmp2.inputs['Normal'])
bsdf_th = next(n for n in MTH.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
th_bumps = [n for n in MTH.node_tree.nodes if n.type == 'BUMP']
if len(th_bumps) >= 2:
    for l in list(bsdf_th.inputs['Normal'].links):
        MTH.node_tree.links.remove(l)
    MTH.node_tree.links.new(th_bumps[1].outputs['Normal'], bsdf_th.inputs['Normal'])
    th_bumps[0].inputs['Strength'].default_value = 0.5
    th_bumps[1].inputs['Strength'].default_value = 0.45
    for n in MTH.node_tree.nodes:
        if n.type == 'TEXNOISE' and n.inputs['Scale'].default_value >= 10:
            n.inputs['Scale'].default_value = 9.0
print('thatch bump tuned')

MPL = bpy.data.materials['fv_plaster_whitewash']
MPO = bpy.data.materials.get('fv_plaster_ochre') or mat_simple('fv_plaster_ochre', '#D9B878')
MTM = bpy.data.materials['fv_timber_oak']
MSH = bpy.data.materials['fv_roof_shingle']
for n in MSH.node_tree.nodes:
    if n.type == 'TEX_BRICK':
        n.inputs['Color1'].default_value = hexcol('#5E6156')
        n.inputs['Color2'].default_value = hexcol('#50544A')
        n.inputs['Mortar'].default_value = hexcol('#3E423A')
MST = mat_stone('fv_stone_fieldstone', '#8C8578', '#6E675C')
MPW = mat_plank('fv_plank_wall', '#5C5142', '#544A3C', '#3A342C')
MCH = mat_simple('fv_brick_chimney', '#6E4A3A', 0.95)
MDK = mat_simple('fv_dark_inset', '#1E1B18', 0.85)
MCV = mat_canvas_stripes()
MCN = mat_simple('fv_canvas_tan', '#C9B896', 0.9)
MBR = mat_simple('fv_bread', '#B98D5A', 0.85)
MCL1 = mat_simple('fv_cloth_a', '#7A6A8A', 0.9)
MCL2 = mat_simple('fv_cloth_b', '#8A5A4A', 0.9)
MIR = mat_simple('fv_iron', '#2E2A26', 0.6)

def mesh_obj(name, verts, faces, mats, root=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col(C).objects.link(ob)
    if root:
        ob.parent = root
    return ob

def box(name, x0, x1, y0, y1, z0, z1, mats, root=None, jitter=0.0, smooth=False):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    order = [0, 1, 3, 2, 4, 5, 7, 6]
    verts = [(v[i][0], v[i][1], v[i][2]) for i in order]
    if jitter:
        verts = [(x + rng.uniform(-j, j), y + rng.uniform(-j, j), z + rng.uniform(-j, j))
                 for (x, y, z) in verts for j in [jitter]][0:8]
        verts = [verts[i] for i in range(8)]
    idx = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6]]
    ob = mesh_obj(name, verts, [tuple(idx[i]) for i in range(6)], mats, root)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob

def bar(name, p0, p1, w, t, mats, root=None):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ln = d.length
    me = bpy.data.meshes.new(name)
    hw, ht = w / 2, t / 2
    verts = [(-hw, -ht, -ln/2), (hw, -ht, -ln/2), (hw, ht, -ln/2), (-hw, ht, -ln/2),
             (-hw, -ht, ln/2), (hw, -ht, ln/2), (hw, ht, ln/2), (-hw, ht, ln/2)]
    faces = [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)]
    me.from_pydata(verts, [], faces)
    me.validate()
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col(C).objects.link(ob)
    ob.location = (p0 + p1) / 2
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    if root:
        ob.parent = root
        ob.matrix_parent_inverse.identity()
        ob.matrix_basis = ob.matrix_basis
    return ob

def cyl(name, r0, r1, h, seg, mats, root=None, x=0.0, y=0.0, z0=0.0, axis='Z', smooth=True, cap=True):
    verts, faces = [], []
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p00 = (x + r0 * math.cos(a0), y + r0 * math.sin(a0), z0)
        p01 = (x + r0 * math.cos(a1), y + r0 * math.sin(a1), z0)
        p10 = (x + r1 * math.cos(a0), y + r1 * math.sin(a0), z0 + h)
        p11 = (x + r1 * math.cos(a1), y + r1 * math.sin(a1), z0 + h)
        b0 = len(verts)
        verts += [p00, p01, p11, p10]
        faces.append((b0, b0 + 1, b0 + 2, b0 + 3))
        if cap and r0 > 0.01:
            faces.append((b0 + 3, b0 + 2, b0 + 1, b0))
    ob = mesh_obj(name, verts, faces, mats, root)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    if axis == 'Y':
        ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob

def gable_roof(name, span, length, pitch_deg, mats, root=None, x=0.0, y=0.0, z0=0.0, sag=0.06):
    half = span / 2
    ridge_z = half * math.tan(math.radians(pitch_deg))
    th = 0.25
    v = []
    def add(pt):
        v.append(pt)
        return len(v) - 1
    L0o = add((x-half, y, z0)); R0o = add((x, y, z0+ridge_z)); Rt0o = add((x+half, y, z0))
    L1o = add((x-half, y+length, z0)); R1o = add((x, y+length, z0+ridge_z)); Rt1o = add((x+half, y+length, z0))
    L0i = add((x-half+0.28, y, z0+th)); Rt0i = add((x+half-0.28, y, z0+th)); R0i = add((x, y, z0+ridge_z-th))
    L1i = add((x-half+0.28, y+length, z0+th)); Rt1i = add((x+half-0.28, y+length, z0+th)); R1i = add((x, y+length, z0+ridge_z-th))
    L0d = add((x-half, y, z0-th)); L1d = add((x-half, y+length, z0-th))
    Rt0d = add((x+half, y, z0-th)); Rt1d = add((x+half, y+length, z0-th))
    faces = [
        (L0o, R0o, R1o, L1o), (R0o, Rt0o, Rt1o, R1o),
        (L0i, L1i, R1i, R0i), (R0i, R1i, Rt1i, Rt0i),
        (L0o, L0i, L1i, L1o), (Rt0o, Rt1o, Rt1i, Rt0i),
        (L0o, L1o, L1d, L0d), (Rt0o, Rt1o, Rt1d, Rt0d),
        (L0i, R0i, Rt0i), (L1i, R1i, Rt1i),
    ]
    fm = [(f, 0) for f in faces[:8]] + [(faces[8], 1), (faces[9], 1)]
    ob = mesh_obj(name, v, [f for f, _ in fm], mats if isinstance(mats, (list, tuple)) else [mats], root)
    for p, (_, mi) in zip(ob.data.polygons, fm):
        p.material_index = mi
    for vtx in ob.data.vertices:
        vx, vy, vz = vtx.co
        if abs(vx - x) < 0.05 and vz > z0 + ridge_z * 0.8:
            vtx.co.z -= rng.uniform(0.03, sag) * math.sin(math.pi * (vy - y) / length)
    return ob

def hip_roof(name, span, length, pitch_deg, mats, root=None, x=0.0, y=0.0, z0=0.0):
    half = span / 2
    ridge_z = half * math.tan(math.radians(pitch_deg))
    ry0, ry1 = length * 0.2, length * 0.8
    v = [
        (x-half, y, z0), (x+half, y, z0), (x+half, y+length, z0), (x-half, y+length, z0),
        (x, y+ry0, z0+ridge_z), (x, y+ry1, z0+ridge_z),
        (x-half, y, z0-0.25), (x+half, y, z0-0.25), (x+half, y+length, z0-0.25), (x-half, y+length, z0-0.25),
    ]
    faces = [((0, 4, 5, 3), 0), ((1, 2, 5, 4), 0), ((0, 1, 4), 0), ((3, 2, 5), 0),
             ((0, 1, 7, 6), 0), ((1, 2, 8, 7), 0), ((2, 3, 9, 8), 0), ((3, 0, 6, 9), 0)]
    ob = mesh_obj(name, v, [f for f, _ in faces], mats, root)
    for p, (_, mi) in zip(ob.data.polygons, faces):
        p.material_index = mi
    for vtx in ob.data.vertices:
        vx, vy, vz = vtx.co
        if abs(vx - x) < 0.05 and vz > z0 + ridge_z * 0.8:
            vtx.co.z -= rng.uniform(0.03, 0.06) * math.sin(math.pi * (vy - y) / length)
    return ob

def window(name, x, y, z, w, h, root=None, face='-Y'):
    box(name + '_inset', x - w/2, x + w/2, y - 0.06, y + 0.06, z - h/2, z + h/2, MDK, root)
    if face == '-Y':
        bar(name + '_lintel', (x - w/2 - 0.08, y + 0.05, z + h/2 + 0.06), (x + w/2 + 0.08, y + 0.05, z + h/2 + 0.06), 0.1, 0.16, MTM, root)
        bar(name + '_sill', (x - w/2 - 0.06, y + 0.05, z - h/2 - 0.05), (x + w/2 + 0.06, y + 0.05, z - h/2 - 0.05), 0.09, 0.14, MTM, root)

def framed_wall(name, x0, x1, z0, z1, y, root, posts_every=1.4, braces=True):
    box(name + '_panel', x0, x1, y - 0.03, y + 0.03, z0, z1, MPL, root)
    xs = [x0 + 0.09]
    xx = x0 + 0.09
    while xx < x1 - 0.2:
        xx += posts_every + rng.uniform(-0.1, 0.1)
        xs.append(min(xx, x1 - 0.09))
    for i, px in enumerate(xs):
        box(f'{name}_post{i}', px - 0.09, px + 0.09, y - 0.09, y - 0.01, z0, z1, MTM, root)
    for zz, hh in ((z0, 0.16), (z1 - 0.16, 0.16), (z0 + (z1 - z0) * 0.45, 0.13)):
        bar(f'{name}_rail{zz}', (x0, y - 0.05, zz + hh/2), (x1, y - 0.05, zz + hh/2), 0.13, 0.08, MTM, root)
    if braces:
        n = len(xs)
        for i in range(n - 1):
            if rng.random() < 0.5:
                za, zb = z0 + 0.3, z1 - 0.3
                if (i % 2) == 0:
                    bar(f'{name}_brace{i}', (xs[i], y - 0.05, za), (xs[i + 1], y - 0.05, zb), 0.13, 0.08, MTM, root)
                else:
                    bar(f'{name}_brace{i}', (xs[i + 1], y - 0.05, za), (xs[i], y - 0.05, zb), 0.13, 0.08, MTM, root)

def gable_infill(name, x0, x1, y, z_base, z_apex, mat, root):
    cx = (x0 + x1) / 2
    z_sh = z_base + (z_apex - z_base) * 0.45
    mesh_obj(name, [(x0, y, z_base), (x1, y, z_base), (x1, y, z_sh), (cx, y, z_apex), (x0, y, z_sh)],
             [(0, 1, 2, 3), (0, 3, 4)], mat, root)

def new_root(name):
    e = bpy.data.objects.new(name, None)
    col(C).objects.link(e)
    return e

PURGE = ['fv_burgage_l1', 'fv_burgage_l2', 'fv_church_wooden', 'fv_granary_barn',
         'fv_market_stall_a', 'fv_market_stall_b', 'fv_market_stall_c', 'fv_well_stone', 'fv_tmp_cam']
purge(PURGE)
inv = {}

def count_tris(root):
    t = 0
    for o in root.children_recursive:
        if o.type == 'MESH':
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return t

r1 = new_root('fv_burgage_l1')
box('l1_footing', -3.1, 3.1, -4.6, 4.6, 0.0, 0.35, MST, r1, jitter=0.02)
box('l1_wall', -3.0, 3.0, -4.5, 4.5, 0.3, 2.6, MPL, r1, jitter=0.03)
for cx in (-3.0, 3.0):
    for cy in (-4.5, 4.5):
        box('l1_post', cx - 0.09, cx + 0.09, cy - 0.09, cy + 0.09, 0.3, 2.6, MTM, r1)
box('l1_door', -0.6, 0.6, -4.56, -4.44, 0.35, 2.35, MDK, r1)
bar('l1_doorframe_l', (-0.72, -4.48, 0.35), (-0.72, -4.48, 2.4), 0.14, 0.12, MTM, r1)
bar('l1_doorframe_r', (0.72, -4.48, 0.35), (0.72, -4.48, 2.4), 0.14, 0.12, MTM, r1)
window('l1_win1', -1.9, -4.5, 1.6, 0.6, 0.7, r1)
window('l1_win2', 1.9, -4.5, 1.6, 0.6, 0.7, r1)
hip_roof('l1_roof', 6.8, 9.5, 50, MTH, r1, x=0.0, y=-4.75, z0=2.55)
inv['fv_burgage_l1'] = r1

r2 = new_root('fv_burgage_l2')
box('l2_footing', -3.6, 3.6, -5.1, 5.1, 0.0, 0.35, MST, r2)
box('l2_wall_gf', -3.5, 3.5, -5.0, 5.0, 0.3, 2.45, MPL, r2, jitter=0.02)
framed_wall('l2_front_gf', -3.5, 3.5, 0.35, 2.45, -5.0, r2, braces=True)
box('l2_jetty', -3.6, 3.6, -5.25, 5.0, 2.45, 2.7, MTM, r2)
box('l2_wall_uf', -3.6, 3.6, -5.25, 4.95, 2.7, 5.0, MPL, r2, jitter=0.02)
framed_wall('l2_front_uf', -3.6, 3.6, 2.7, 5.0, -5.25, r2, posts_every=1.2, braces=True)
gable_roof('l2_roof', 7.8, 10.7, 50, MSH, r2, x=0.0, y=-5.5, z0=4.95)
gable_infill('l2_gable_s', -3.6, 3.6, -5.3, 4.95, 4.95 + 3.9 * math.tan(math.radians(50)) - 0.3, MPL, r2)
gable_infill('l2_gable_n', -3.6, 3.6, 5.1, 4.95, 4.95 + 3.9 * math.tan(math.radians(50)) - 0.3, MPL, r2)
box('l2_chimney', 1.8, 2.5, 1.0, 1.9, 4.5, 8.6, MCH, r2)
box('l2_chimney_cap', 1.7, 2.6, 0.9, 2.0, 8.6, 8.75, MST, r2)
box('l2_door', -0.7, 0.7, -5.31, -5.19, 0.35, 2.35, MDK, r2)
window('l2_w1', -2.3, -5.31, 1.4, 0.7, 0.8, r2)
window('l2_w2', 2.3, -5.31, 1.4, 0.7, 0.8, r2)
for wx in (-2.4, 0.0, 2.4):
    window(f'l2_wu{wx}', wx, -5.31, 3.8, 0.7, 0.8, r2)
inv['fv_burgage_l2'] = r2

r3 = new_root('fv_church_wooden')
box('ch_footing', -7.2, 7.2, -4.2, 4.2, 0.0, 0.5, MST, r3, jitter=0.02)
box('ch_wall', -7.0, 7.0, -4.0, 4.0, 0.45, 3.25, MPL, r3, jitter=0.02)
ch_roof = gable_roof('ch_roof', 8.8, 15.0, 55, MSH, r3, x=0.0, y=-7.5, z0=3.2)
for vtx in ch_roof.data.vertices:
    vx, vy, vz = vtx.co
    vtx.co = (-vy, vx, vz)
box('ch_door', -7.31, -7.19, -1.1, 1.1, 0.5, 2.6, MDK, r3)
cyl('ch_arch', 1.1, 1.1, 0.12, 12, MST, r3, x=-7.25, y=0.0, z0=2.6, axis='Y')
for i in range(3):
    zz = 1.6 + i * 0.7
    for sy in (-1, 1):
        box(f'ch_lancet{i}{sy}', -4.5 + i * 3.0 - 0.25, -4.5 + i * 3.0 + 0.25, sy * 4.0 - 0.06, sy * 4.0 + 0.06, zz, zz + 1.4, MDK, r3)
gable_infill('ch_gable_w', -4.0, 4.0, -7.05, 3.2, 3.2 + 4.4 * math.tan(math.radians(55)) - 0.3, MPL, r3)
gable_infill('ch_gable_e', -4.0, 4.0, 7.05, 3.2, 3.2 + 4.4 * math.tan(math.radians(55)) - 0.3, MPL, r3)
for px in (-6.1, -4.9):
    box(f'ch_cotpost{px}', px - 0.08, px + 0.08, -0.6, -0.44, 7.6, 9.1, MTM, r3)
    box(f'ch_cotpostb{px}', px - 0.08, px + 0.08, 0.44, 0.6, 7.6, 9.1, MTM, r3)
cyl('ch_spire', 1.0, 0.15, 2.8, 8, MSH, r3, x=-5.5, y=0.0, z0=8.9)
box('ch_cross_v', -5.55, -5.45, -0.04, 0.04, 11.6, 12.4, MIR, r3)
box('ch_cross_h', -5.68, -5.32, -0.04, 0.04, 11.95, 12.03, MIR, r3)
inv['fv_church_wooden'] = r3

r4 = new_root('fv_granary_barn')
box('gr_footing', -4.7, 4.7, -7.2, 7.2, 0.0, 0.3, MST, r4)
box('gr_wall', -4.5, 4.5, -7.0, 7.0, 0.25, 3.6, MPW, r4, jitter=0.02)
gable_roof('gr_roof', 9.8, 14.6, 48, [MTH, MPW], r4, x=0.0, y=-7.3, z0=3.55)
gable_infill('gr_gable_w', -4.5, 4.5, -7.1, 3.55, 3.55 + 4.9 * math.tan(math.radians(48)) - 0.35, MPW, r4)
gable_infill('gr_gable_e', -4.5, 4.5, 7.1, 3.55, 3.55 + 4.9 * math.tan(math.radians(48)) - 0.35, MPW, r4)
box('gr_door_l', -1.3, -0.1, 4.44, 4.56, 0.3, 2.9, MDK, r4)
box('gr_door_r', 0.1, 1.3, 4.44, 4.56, 0.3, 2.9, MDK, r4)
bar('gr_doorframe', (-1.5, 4.5, 0.3), (-1.5, 4.5, 3.1), 0.16, 0.14, MTM, r4)
bar('gr_doorframe2', (1.5, 4.5, 0.3), (1.5, 4.5, 3.1), 0.16, 0.14, MTM, r4)
for vx in (-2.5, 2.5):
    box(f'gr_vent{vx}', vx - 0.3, vx + 0.3, -7.06, -6.94, 2.6, 3.2, MDK, r4)
inv['fv_granary_barn'] = r4

def market_stall(nm, canopy_mat, goods=False):
    r = new_root(nm)
    for px in (-1.5, 1.5):
        for py in (-1.2, 1.2):
            box(f'{nm}_post{px}{py}', px - 0.07, px + 0.07, py - 0.07, py + 0.07, 0.0, 2.2, MTM, r)
    box(f'{nm}_table', -1.5, 1.5, -1.2, -0.2, 0.9, 1.0, MPW, r)
    box(f'{nm}_backwall', -1.5, 1.5, 1.05, 1.2, 0.9, 2.2, MPW, r)
    half = 1.7
    ridge_z = 0.8
    v = [(-half, -1.45, 2.2), (half, -1.45, 2.2), (half, 1.45, 2.2), (-half, 1.45, 2.2),
         (0, -1.0, 2.2 + ridge_z), (0, 1.0, 2.2 + ridge_z)]
    faces = [((0, 4, 5, 3), 0), ((1, 2, 5, 4), 0), ((0, 1, 4), 0), ((3, 2, 5), 0)]
    ob = mesh_obj(f'{nm}_canopy', v, [f for f, _ in faces], canopy_mat, r)
    for p, (_, mi) in zip(ob.data.polygons, faces):
        p.material_index = mi
    for vtx in ob.data.vertices:
        if vtx.co.z > 2.25:
            vtx.co.z -= rng.uniform(0.02, 0.07)
    for p in ob.data.polygons:
        p.use_smooth = True
    if goods:
        for i, bx in enumerate((-1.1, -0.7, -0.3, 0.1, 0.5)):
            cyl(f'{nm}_bread{i}', 0.11, 0.09, 0.09, 8, MBR, r, x=bx, y=-0.7, z0=1.0)
        for i, (cx, mm) in enumerate(((-0.9, MCL1), (-0.4, MCL2), (0.1, MCL1))):
            box(f'{nm}_cloth{i}', cx, cx + 0.5, -0.55, -0.35, 1.0, 1.13, mm, r)
    return r

inv['fv_market_stall_a'] = market_stall('fv_market_stall_a', MCV, goods=True)
inv['fv_market_stall_b'] = market_stall('fv_market_stall_b', MCN)
inv['fv_market_stall_c'] = market_stall('fv_market_stall_c', MTH)

r5 = new_root('fv_well_stone')
c = cyl('well_drum', 0.7, 0.72, 0.9, 12, MST, r5, z0=0.0)
for vtx in c.data.vertices:
    vx, vy, vz = vtx.co
    c.modifiers if False else None
    vtx.co.x += rng.uniform(-0.03, 0.03)
    vtx.co.y += rng.uniform(-0.03, 0.03)
cyl('well_hole', 0.55, 0.55, 0.05, 12, MDK, r5, z0=0.86, cap=False)
for px in (-0.55, 0.55):
    box(f'well_post{px}', px - 0.06, px + 0.06, -0.06, 0.06, 0.85, 2.0, MTM, r5)
cyl('well_windlass', 0.07, 0.07, 1.15, 8, MTM, r5, x=0.0, y=0.0, z0=1.1, axis='Y')
bar('well_crank', (0.0, 0.62, 1.1), (0.0, 0.75, 1.35), 0.05, 0.05, MIR, r5)
cyl('well_rope', 0.015, 0.015, 0.65, 6, MDK, r5, z0=0.78)
cyl('well_bucket', 0.14, 0.12, 0.2, 8, MPW, r5, z0=0.58, cap=False)
gable_roof('well_roof', 1.9, 1.7, 45, MSH, r5, x=0.0, y=-0.85, z0=2.0)
inv['fv_well_stone'] = r5

order = ['fv_burgage_l1', 'fv_burgage_l2', 'fv_church_wooden', 'fv_granary_barn',
         'fv_market_stall_a', 'fv_market_stall_b', 'fv_market_stall_c', 'fv_well_stone']
for i, nm in enumerate(order):
    inv[nm].location = (-30 + i * 9, -32, 0)
    inv[nm].rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

scn = bpy.context.scene
old = scn.camera or bpy.data.objects.get('fv_cam_strategy')

def render_cam_at(loc, target, path, lens=50):
    cd = bpy.data.cameras.new('fv_tmp_cam')
    cd.lens = lens
    cam = bpy.data.objects.new('fv_tmp_cam', cd)
    col('fv_Lookdev').objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    scn.camera = old

report = []
for nm in order:
    root = inv[nm]
    bb = [root.matrix_world @ Vector(c) for c in root.bound_box] if root.children_recursive else [Vector((0, 0, 0))]
    allbb = []
    for o in root.children_recursive:
        if o.type == 'MESH':
            allbb += [o.matrix_world @ Vector(c) for c in o.bound_box]
    if not allbb:
        allbb = [root.matrix_world @ Vector(c) for c in root.bound_box]
    ctr = sum(allbb, Vector()) / len(allbb)
    diag = max((a - b).length for a in allbb for b in allbb)
    path = f'{RD}\\ph3_{nm}.png'
    off = Vector((-0.45, -1.0, 0.3)).normalized() * diag * 2.6
    render_cam_at(ctr + off, ctr - Vector((0, 0, 0.5)), path)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1, :, :3]
    reg = px[int(h*0.3):int(h*0.7), int(w*0.4):int(w*0.6)]
    mean = tuple(int(v) for v in (reg.mean(axis=(0, 1)) * 255))
    sd = float(reg.std(axis=(0, 1)).mean())
    bpy.data.images.remove(img)
    report.append((nm, count_tris(root), round(diag, 1), mean, round(sd, 1)))

xs = [inv[nm].location.x for nm in order]
cx = (min(xs) + max(xs)) / 2
render_cam_at((cx, -32 - 62, 22), (cx, -32, 2.5), f'{RD}\\ph3_row.png', lens=40)
for nm, tris, diag, mean, sd in report:
    print(f'{nm}: tris={tris} diag={diag}m center_rgb={mean} std={sd}')
import os
for f in sorted(os.listdir(RD)):
    if f.startswith('ph3_'):
        print(f, os.path.getsize(os.path.join(RD, f)))
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('PH3 DONE')
