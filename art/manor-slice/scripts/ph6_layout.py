import bpy, math, os
import numpy as np
from mathutils import Vector

BLEND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\scenes\village.blend"
RD = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

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

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

def mat_two_noise(name, c1, c2, scale=1.2):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ns = nt.nodes.new('ShaderNodeTexNoise')
    ns.inputs['Scale'].default_value = scale
    ns.inputs['Detail'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = hexcol(c1)
    ramp.color_ramp.elements[1].color = hexcol(c2)
    nt.links.new(tc.outputs['Object'], ns.inputs['Vector'])
    nt.links.new(ns.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m

MLEAF = bpy.data.materials['fv_leaf_canopy']
MTRUNK = bpy.data.materials['fv_bark']
MSHRUB = bpy.data.materials['fv_leaf_shrub']
MSOIL = bpy.data.materials['fv_soil']
MCAB = bpy.data.materials['fv_cabbage']
MWATTLE = bpy.data.materials['fv_wattle']
MPICKET = bpy.data.materials['fv_picket']
MHAY = bpy.data.materials['fv_hay']
MWOOD = bpy.data.materials['fv_prop_wood']
MWOOD_D = bpy.data.materials['fv_prop_wood_dark']

def mesh_obj(name, verts, faces, mats, root=None, smooth=False, coll='fv_Environment'):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col(coll).objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    if root:
        ob.parent = root
    return ob

def blob(name, r, seed, mat, root=None, squash=0.85):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    rr = random.Random(seed)
    for v in bm.verts:
        v.co *= rr.uniform(0.78, 1.25)
        v.co.z *= squash
    bm.to_mesh(me)
    bm.free()
    me.validate()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col('fv_Environment').objects.link(ob)
    if root:
        ob.parent = root
    return ob

import random
rng = random.Random(31)

def cyl(name, r0, r1, h, seg, mats, root=None, x=0.0, y=0.0, z0=0.0, axis='Z', smooth=True, cap=True):
    verts, faces = [], []
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        b0 = len(verts)
        verts += [(x + r0 * math.cos(a0), y + r0 * math.sin(a0), z0),
                  (x + r0 * math.cos(a1), y + r0 * math.sin(a1), z0),
                  (x + r1 * math.cos(a1), y + r1 * math.sin(a1), z0 + h),
                  (x + r1 * math.cos(a0), y + r1 * math.sin(a0), z0 + h)]
        faces.append((b0, b0 + 1, b0 + 2, b0 + 3))
        if cap and r0 > 0.01:
            faces.append((b0 + 3, b0 + 2, b0 + 1, b0))
    ob = mesh_obj(name, verts, faces, mats, root, smooth=smooth)
    if axis == 'Y':
        ob.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'X':
        ob.rotation_euler = (0, math.pi / 2, 0)
    return ob

def fence_run(name, x0, y0, x1, y1, style):
    r = bpy.data.objects.new(name, None)
    col('fv_Environment').objects.link(r)
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy)
    n = max(2, int(ln / 1.5) + 1)
    for i in range(n):
        t = i / (n - 1)
        px, py = x0 + dx * t, y0 + dy * t
        if style == 'wattle':
            cyl(f'{name}_p{i}', 0.045, 0.04, 1.05, 6, MWATTLE, r, x=px, y=py, z0=0)
        else:
            mesh_obj(f'{name}_p{i}', [(px-0.04, py-0.04, 0), (px+0.04, py-0.04, 0), (px+0.04, py+0.04, 0), (px-0.04, py+0.04, 0),
                                      (px-0.04, py-0.04, 0.9), (px+0.04, py-0.04, 0.9), (px+0.04, py+0.04, 0.9), (px-0.04, py+0.04, 0.9)],
                     [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)], MPICKET, r)
        if i > 0 and style == 'wattle':
            for zz in (0.3, 0.6, 0.9):
                sag = math.sin(math.pi * t) * 0.05
                px0, py0 = x0 + dx * (i - 1) / (n - 1), y0 + dy * (i - 1) / (n - 1)
                mesh_obj(f'{name}_r{i}_{zz}', [(px0, py0, zz - 0.035 + sag), (px, py, zz - 0.035 + sag),
                                               (px, py, zz + 0.035 + sag), (px0, py0, zz + 0.035 + sag)],
                         [(0, 1, 2, 3)], MWATTLE, r)
    if style == 'picket':
        m = int(ln / 0.28)
        for i in range(m + 1):
            t = i / max(m, 1)
            px, py = x0 + dx * t, y0 + dy * t
            mesh_obj(f'{name}_s{i}', [(px-0.05, py-0.015, 0.12), (px+0.05, py-0.015, 0.12), (px+0.05, py+0.015, 0.12), (px-0.05, py+0.015, 0.12),
                                      (px-0.05, py-0.015, 0.78), (px+0.05, py-0.015, 0.78), (px+0.05, py+0.015, 0.78), (px-0.05, py+0.015, 0.78),
                                      (px-0.05, py-0.015, 0.9), (px+0.05, py-0.015, 0.9), (px+0.05, py+0.015, 0.9), (px-0.05, py+0.015, 0.9)],
                     [(0, 1, 2, 3), (4, 5, 6, 7), (8, 9, 10, 11), (0, 3, 7, 4), (1, 2, 6, 5), (3, 2, 6, 7), (0, 1, 5, 4),
                      (4, 5, 9, 8), (5, 6, 10, 9), (6, 7, 11, 10), (7, 4, 8, 11), (0, 3, 11, 8), (1, 2, 10, 9)], MPICKET, r)
        for zz in (0.3, 0.62):
            mesh_obj(f'{name}_rail{zz}', [(x0-0.02, y0-0.02, zz), (x1+0.02, y1-0.02, zz), (x1+0.02, y1+0.02, zz+0.07), (x0-0.02, y0+0.02, zz+0.07),
                                          (x0-0.02, y0-0.02, zz+0.07), (x1+0.02, y1-0.02, zz+0.07), (x1+0.02, y1+0.02, zz+0.14), (x0-0.02, y0+0.02, zz+0.14)],
                     [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], MPICKET, r)
    return r

def garden_bed(name, x, y, w, d, rot=0.0):
    r = bpy.data.objects.new(name, None)
    col('fv_Environment').objects.link(r)
    r.location = (x, y, 0)
    r.rotation_euler = (0, 0, rot)
    mesh_obj(name + '_soil', [(-w/2, -d/2, 0), (w/2, -d/2, 0), (w/2, d/2, 0), (-w/2, d/2, 0),
                              (-w/2, -d/2, 0.22), (w/2, -d/2, 0.22), (w/2, d/2, 0.22), (-w/2, d/2, 0.22)],
             [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)], MSOIL, r)
    nx = max(2, int(w / 0.45))
    ny = max(1, int(d / 0.4))
    for i in range(nx):
        for j in range(ny):
            c = blob(name + f'_c{i}{j}', 0.14, rng.randint(0, 999), MCAB, r, squash=0.75)
            c.location = (-w/2 + 0.25 + i * 0.45, -d/2 + 0.2 + j * 0.4, 0.24)
    return r

def prop_barrel(name, x, y):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    cyl(name + '_b0', 0.26, 0.31, 0.28, 10, MWOOD_D, r, z0=0.0)
    cyl(name + '_b1', 0.31, 0.31, 0.24, 10, MWOOD_D, r, z0=0.28)
    cyl(name + '_b2', 0.31, 0.25, 0.26, 10, MWOOD_D, r, z0=0.52)
    return r

def prop_firewood(name, x, y, rot):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    r.rotation_euler = (0, 0, rot)
    rr = random.Random(hash(name) % 999)
    for row in range(3):
        for i in range(4):
            cyl(f'{name}_{row}{i}', 0.07, 0.06, 0.8, 6, MWOOD, r,
                x=-0.3 + i * 0.2 + rr.uniform(-0.02, 0.02), z0=0.07 + row * 0.13, axis='X', cap=False)
    return r

def prop_hay(name, x, y):
    h = blob(name, 0.9, 42, MHAY, None, squash=0.6)
    h.location = (x, y, 0.35)
    return h

def prop_cart(name, x, y, rot):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    r.rotation_euler = (0, 0, rot)
    mesh_obj(name + '_bed', [(-0.9, -0.55, 0.45), (0.9, -0.55, 0.45), (0.9, 0.55, 0.45), (-0.9, 0.55, 0.45),
                             (-0.9, -0.55, 0.75), (0.9, -0.55, 0.75), (0.9, 0.55, 0.75), (-0.9, 0.55, 0.75)],
             [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)], MWOOD, r, coll='fv_Props')
    for sx in (-0.6, 0.6):
        cyl(f'{name}_w{sx}', 0.34, 0.34, 0.06, 10, MWOOD_D, r, x=sx, y=-0.62, z0=0.12, axis='X', cap=False)
    return r

purge(['fv_fence_', 'fv_garden_', 'fv_prop_'])

L = {
    'fv_burgage_l1': (-20, 10, 0),
    'fv_burgage_l2': (-8, 9, 0),
    'fv_church_wooden': (24, 14, 0),
    'fv_granary_barn': (-16, -13, 0),
    'fv_market_stall_a': (2, 7, math.radians(90)),
    'fv_market_stall_b': (9.5, 7, math.radians(-90)),
    'fv_market_stall_c': (6, 10.5, math.radians(180)),
    'fv_well_stone': (6, 5, 0),
}
for nm, (x, y, rz) in L.items():
    o = bpy.data.objects.get(nm)
    if o:
        o.location = (x, y, 0)
        o.rotation_euler = (0, 0, rz)
    else:
        print('MISSING', nm)

fence_run('fv_fence_wattle_l1w', -25.5, 6.8, -25.5, 14.5, 'wattle')
fence_run('fv_fence_wattle_l1e', -14.5, 6.8, -14.5, 14.5, 'wattle')
fence_run('fv_fence_wattle_l1b', -25.5, 14.5, -14.5, 14.5, 'wattle')
fence_run('fv_fence_wattle_l2w', -13.5, 7.0, -13.5, 15.0, 'wattle')
fence_run('fv_fence_wattle_l2e', -2.5, 7.0, -2.5, 15.0, 'wattle')
fence_run('fv_fence_wattle_l2b', -13.5, 15.0, -2.5, 15.0, 'wattle')
fence_run('fv_fence_picket_cyw', 17.0, 7.0, 22.0, 7.0, 'picket')
fence_run('fv_fence_picket_cye', 26.0, 7.0, 31.0, 7.0, 'picket')
fence_run('fv_fence_picket_cyn', 17.0, 21.0, 31.0, 21.0, 'picket')
fence_run('fv_fence_picket_cys', 17.0, 7.0, 17.0, 21.0, 'picket')
fence_run('fv_fence_picket_cys2', 31.0, 7.0, 31.0, 21.0, 'picket')
fence_run('fv_fence_wattle_g1', -27.5, -6.0, -27.5, -11.0, 'wattle')
fence_run('fv_fence_wattle_g2', -20.5, -6.0, -20.5, -11.0, 'wattle')

garden_bed('fv_garden_l1', -20.0, 11.0, 5.0, 2.2)
garden_bed('fv_garden_l2', -8.0, 11.5, 4.2, 2.0)
garden_bed('fv_garden_s1', -24.0, -8.5, 4.6, 2.0, rot=0.08)

prop_barrel('fv_prop_barrel_a', -18.4, 6.9)
prop_barrel('fv_prop_barrel_b', 8.0, 3.6)
prop_barrel('fv_prop_barrel_c', -14.8, -10.2)
prop_firewood('fv_prop_firewood_a', -21.8, 6.9, 0.1)
prop_firewood('fv_prop_firewood_b', -11.0, -10.6, -0.12)
prop_hay('fv_prop_hay_a', -19.5, -9.0)
prop_hay('fv_prop_hay_b', -12.2, -15.8)
prop_cart('fv_prop_cart_a', 13.0, 2.6, 0.35)

trees_root = bpy.data.objects.get('fv_trees')
for i, (tx, ty, kind) in enumerate(((-34, -20, 'oak'), (34, -18, 'spruce'), (16, 22, 'beech'), (-30, 20, 'oak'))):
    e = bpy.data.objects.new(f'fv_tree_x{i}', None)
    col('fv_Environment').objects.link(e)
    e.parent = trees_root
    rr = random.Random(100 + i)
    if kind == 'spruce':
        cyl(f'fv_tree_x{i}_trunk', 0.16, 0.1, 2.2, 7, MTRUNK, e)
        for j, (cz, cr) in enumerate(((1.2, 1.5), (2.4, 1.2), (3.5, 0.85), (4.4, 0.5))):
            c = blob(f'fv_tree_x{i}_c{j}', cr, rr.randint(0, 999), MLEAF, e, squash=0.7)
            c.location = (0, 0, cz)
    else:
        cyl(f'fv_tree_x{i}_trunk', 0.22, 0.14, 2.3, 7, MTRUNK, e)
        for j in range(3):
            rad = rr.uniform(1.5, 2.1)
            c = blob(f'fv_tree_x{i}_c{j}', rad, rr.randint(0, 999), MLEAF, e, squash=0.8)
            ang = 2 * math.pi * j / 3
            c.location = (math.cos(ang) * 1.1, math.sin(ang) * 1.1, 2.3 + rad * 0.55)
    e.location = (tx, ty, 0)
    e.rotation_euler = (0, 0, rr.uniform(0, 6.28))
    s = rr.uniform(0.9, 1.3)
    e.scale = (s, s, s)

for o in bpy.data.objects:
    if o.name.startswith(('fv_kit_', 'fv_roof_thatch_gable', 'fv_roof_thatch_hip', 'fv_roof_tile_gable', 'fv_tmp_cam')):
        o.hide_render = True
        o.hide_viewport = True

bpy.context.view_layer.update()
bpy.ops.wm.save_mainfile()

scn = bpy.context.scene
old = scn.camera or bpy.data.objects.get('fv_cam_strategy')

def render_cam(loc, target, path, lens=40):
    cd = bpy.data.cameras.new('fv_tmp_cam2')
    cd.lens = lens
    cam = bpy.data.objects.new('fv_tmp_cam2', cd)
    col('fv_Lookdev').objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    scn.camera = old

render_cam((-34, -50, 30), (0, 6, 0), os.path.join(RD, 'ph6_village.png'), lens=35)
render_cam((-26, -5, 1.7), (-2, 8, 2.2), os.path.join(RD, 'ph6_street.png'), lens=35)
render_cam((16, -3, 2.4), (3, 7, 1.6), os.path.join(RD, 'ph6_market.png'), lens=40)
for f in ('ph6_village.png', 'ph6_street.png', 'ph6_market.png'):
    p = os.path.join(RD, f)
    print(f, os.path.getsize(p) if os.path.exists(p) else 'MISSING')
print('PH6 DONE')
