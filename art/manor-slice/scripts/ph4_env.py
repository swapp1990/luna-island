import bpy, math, random
import numpy as np
from mathutils import Vector

rng = random.Random(23)
BLEND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\scenes\village.blend"
RD = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders"

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

def mat_simple(name, base, rough=0.95):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexcol(base)
    b.inputs['Roughness'].default_value = rough
    return m

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

MLEAF = mat_two_noise('fv_leaf_canopy', '#3E5230', '#56683C', 2.5)
MLEAF_A = mat_two_noise('fv_leaf_autumn', '#8A4A22', '#C98A2E', 2.5)
MTRUNK = mat_two_noise('fv_bark', '#4A3826', '#5C4A34', 6.0)
MSHRUB = mat_two_noise('fv_leaf_shrub', '#465A34', '#617441', 4.0)
MSOIL = mat_two_noise('fv_soil', '#4A3A2A', '#5E4A36', 8.0)
MCAB = mat_simple('fv_cabbage', '#5E7A3A', 0.8)
MWATTLE = mat_two_noise('fv_wattle', '#6E5E44', '#82725A', 5.0)
MPICKET = mat_simple('fv_picket', '#C9BFA8', 0.9)
MHAY = mat_two_noise('fv_hay', '#A88A4E', '#C4A860', 7.0)
MWOOD = mat_simple('fv_prop_wood', '#6E5A40', 0.9)
MWOOD_D = mat_simple('fv_prop_wood_dark', '#4E4030', 0.9)

th = bpy.data.materials['fv_roof_thatch']
nt = th.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
bumps = [n for n in nt.nodes if n.type == 'BUMP']
if len(bumps) >= 2:
    fine, coarse = bumps[0], bumps[1]
    for l in list(bsdf.inputs['Normal'].links):
        nt.links.remove(l)
    nt.links.new(coarse.outputs['Normal'], bsdf.inputs['Normal'])
    fine.inputs['Strength'].default_value = 0.5
    for n in nt.nodes:
        if n.type == 'TEXNOISE' and n.inputs['Scale'].default_value >= 10:
            n.inputs['Scale'].default_value = 12.0
    print('thatch bump chain fixed')

def mesh_obj(name, verts, faces, mats, root=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col('fv_Environment' if root is None or not root.name.startswith('fv_prop') else 'fv_Props').objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    if root:
        ob.parent = root
    return ob

def blob(name, r, seed, mat, root=None, squash=0.85, subdiv_detail=1):
    me = bpy.data.meshes.new(name)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv_detail, radius=r)
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

def tree(name, kind, root=None):
    created = root is None
    r = root or bpy.data.objects.new(name, None)
    if created:
        col('fv_Environment').objects.link(r)
    rr = random.Random(hash(name) % 9999)
    if kind == 'spruce':
        cyl(name + '_trunk', 0.16, 0.1, 2.2, 7, MTRUNK, r)
        for i, (cz, cr) in enumerate(((1.2, 1.5), (2.4, 1.2), (3.5, 0.85), (4.4, 0.5))):
            c = blob(name + f'_c{i}', cr, rr.randint(0, 999), MLEAF, r, squash=0.7)
            c.location = (rr.uniform(-0.15, 0.15), rr.uniform(-0.15, 0.15), cz)
        r['height'] = 5.2
    else:
        th = rr.uniform(2.0, 2.6)
        cyl(name + '_trunk', 0.22, 0.14, th, 7, MTRUNK, r)
        n_blobs = 3 if kind == 'oak' else 4
        for i in range(n_blobs):
            rad = rr.uniform(1.4, 2.1)
            c = blob(name + f'_c{i}', rad, rr.randint(0, 999), MLEAF, r, squash=0.8)
            ang = 2 * math.pi * i / n_blobs + rr.uniform(-0.4, 0.4)
            d = rr.uniform(0.8, 1.5)
            c.location = (math.cos(ang) * d, math.sin(ang) * d, th + rad * 0.55 + rr.uniform(-0.2, 0.3))
        r['height'] = th + 3.2
    return r

def fence_run(name, x0, y0, x1, y1, style, root=None):
    r = root or bpy.data.objects.new(name, None)
    col('fv_Environment').objects.link(r)
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy)
    n = max(2, int(ln / 1.5) + 1)
    ang = math.atan2(dy, dx)
    for i in range(n):
        t = i / (n - 1)
        px, py = x0 + dx * t, y0 + dy * t
        if style == 'wattle':
            cyl(f'{name}_p{i}', 0.045, 0.04, 1.05, 6, MWATTLE, r, x=px, y=py, z0=0)
        else:
            box_p = mesh_obj(f'{name}_p{i}', [(px-0.04, py-0.04, 0), (px+0.04, py-0.04, 0), (px+0.04, py+0.04, 0), (px-0.04, py+0.04, 0),
                                              (px-0.04, py-0.04, 0.9), (px+0.04, py-0.04, 0.9), (px+0.04, py+0.04, 0.9), (px-0.04, py+0.04, 0.9)],
                              [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)], MPICKET, r)
        if i > 0:
            pt = 0.95 if style == 'wattle' else 0.72
            if style == 'wattle':
                for zz in (0.3, 0.6, 0.9):
                    sag = math.sin(math.pi * t) * 0.05
                    bar_m = mesh_obj(f'{name}_r{i}_{zz}', [(x0+dx*(t-1/n), y0+dy*(t-1/n), zz-0.035+sag), (px, py, zz-0.035+sag),
                                                           (px, py, zz+0.035+sag), (x0+dx*(t-1/n), y0+dy*(t-1/n), zz+0.035+sag)],
                                     [(0, 1, 2, 3)], MWATTLE, r)
            else:
                pass
    if style == 'picket':
        m = int(ln / 0.28)
        for i in range(m + 1):
            t = i / m
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

def garden_bed(name, x, y, w, d, rot=0.0, root=None):
    r = root or bpy.data.objects.new(name, None)
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
            cx = -w/2 + 0.25 + i * 0.45
            cy = -d/2 + 0.2 + j * 0.4
            c = blob(name + f'_c{i}{j}', 0.14, rng.randint(0, 999), MCAB, r, squash=0.75, subdiv_detail=1)
            c.location = (cx, cy, 0.24)
            c.scale = (1, 1, rng.uniform(0.7, 1.0))
    return r

def prop_barrel(name, x, y, root):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    for i, (z, rad) in enumerate(((0.0, 0.26), (0.25, 0.32), (0.5, 0.32), (0.75, 0.26))):
        pass
    cyl(name + '_b0', 0.26, 0.31, 0.28, 10, MWOOD_D, r, z0=0.0)
    cyl(name + '_b1', 0.31, 0.31, 0.24, 10, MWOOD_D, r, z0=0.28)
    cyl(name + '_b2', 0.31, 0.25, 0.26, 10, MWOOD_D, r, z0=0.52)
    return r

def prop_firewood(name, x, y, rot, root):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    r.rotation_euler = (0, 0, rot)
    rr = random.Random(hash(name) % 999)
    for row in range(3):
        for i in range(4):
            cyl(f'{name}_{row}{i}', 0.07, 0.06, 0.8, 6, MWOOD, r,
                x=-0.3 + i * 0.2 + rr.uniform(-0.02, 0.02), y=0, z0=0.07 + row * 0.13, axis='X', cap=False)
    return r

def prop_hay(name, x, y, root):
    h = blob(name, 0.9, 42, MHAY, None, squash=0.6)
    h.location = (x, y, 0.35)
    h.parent = root
    return h

def prop_cart(name, x, y, rot, root):
    r = bpy.data.objects.new(name, None)
    col('fv_Props').objects.link(r)
    r.location = (x, y, 0)
    r.rotation_euler = (0, 0, rot)
    mesh_obj(name + '_bed', [(-0.9, -0.55, 0.45), (0.9, -0.55, 0.45), (0.9, 0.55, 0.45), (-0.9, 0.55, 0.45),
                             (-0.9, -0.55, 0.75), (0.9, -0.55, 0.75), (0.9, 0.55, 0.75), (-0.9, 0.55, 0.75)],
             [(0, 1, 2, 3), (4, 6, 7, 5), (0, 2, 6, 4), (1, 3, 7, 5), (0, 1, 5, 4), (2, 3, 7, 6)], MWOOD, r)
    for sx in (-0.6, 0.6):
        cyl(f'{name}_w{sx}', 0.34, 0.34, 0.06, 10, MWOOD_D, r, x=sx, y=-0.62, z0=0.12, axis='X', cap=False)
    for sx in (-0.85, 0.85):
        mesh_obj(f'{name}_h{sx}', [(sx-0.04, -0.05, 0.5), (sx+0.04, -0.05, 0.5), (sx+0.04, 0.05, 0.5), (sx-0.04, 0.05, 0.5),
                                   (sx + (1.1 if sx > 0 else -1.1) - 0.04, -0.05, 0.62), (sx + (1.1 if sx > 0 else -1.1) + 0.04, -0.05, 0.62),
                                   (sx + (1.1 if sx > 0 else -1.1) + 0.04, 0.05, 0.62), (sx + (1.1 if sx > 0 else -1.1) - 0.04, 0.05, 0.62)],
                 [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], MWOOD, r)
    return r

purge(['fv_tree_', 'fv_shrub_', 'fv_fence_', 'fv_garden_', 'fv_prop_', 'fv_envcam'])

trees_root = bpy.data.objects.new('fv_trees', None)
col('fv_Environment').objects.link(trees_root)
for i, (tx, ty, kind) in enumerate(((-52, 18, 'oak'), (-44, -20, 'beech'), (48, 22, 'oak'),
                                    (40, -18, 'spruce'), (-20, 26, 'beech'), (22, 28, 'oak'),
                                    (-58, -2, 'spruce'), (56, 2, 'beech'))):
    e = bpy.data.objects.new(f'fv_tree_{kind}{i}', None)
    col('fv_Environment').objects.link(e)
    e.parent = trees_root
    tree(e.name, kind, e)
    e.location = (tx, ty, 0)
    e.rotation_euler = (0, 0, rng.uniform(0, 6.28))
    s = rng.uniform(0.85, 1.25)
    e.scale = (s, s, s)
for i in range(6):
    b = blob(f'fv_shrub_{i}', rng.uniform(0.5, 0.8), rng.randint(0, 999), MSHRUB, None, squash=0.7)
    b.location = (rng.uniform(-40, 40), rng.choice((-14, 14)) + rng.uniform(-2, 2), 0.35)

fence_run('fv_fence_wattle_a', -33.5, -27.0, -33.5, -37.0, 'wattle')
fence_run('fv_fence_wattle_b', -26.5, -27.0, -26.5, -37.0, 'wattle')
fence_run('fv_fence_picket_a', -12.0, -26.5, -12.0, -37.5, 'picket')
fence_run('fv_fence_picket_b', -12.0, -37.5, -2.0, -37.5, 'picket')
garden_bed('fv_garden_a', -30.0, -39.5, 5.0, 2.2)
garden_bed('fv_garden_b', -18.5, -39.0, 4.2, 2.0, rot=0.12)
props_root = bpy.data.objects.new('fv_props', None)
col('fv_Props').objects.link(props_root)
prop_barrel('fv_prop_barrel_a', -28.2, -36.6, props_root)
prop_barrel('fv_prop_barrel_b', 2.5, -35.0, props_root)
prop_firewood('fv_prop_firewood_a', -27.2, -36.9, 0.15, props_root)
prop_firewood('fv_prop_firewood_b', -4.2, -36.5, -0.1, props_root)
prop_hay('fv_prop_hay_a', -31.5, -34.5, props_root)
prop_cart('fv_prop_cart_a', -8.0, -24.5, 0.4, props_root)
bpy.context.view_layer.update()
bpy.ops.wm.save_mainfile()

scn = bpy.context.scene
old = scn.camera or bpy.data.objects.get('fv_cam_strategy')

def render_cam(loc, target, path, lens=50):
    cd = bpy.data.cameras.new('fv_tmp_cam')
    cd.lens = lens
    cam = bpy.data.objects.new('fv_tmp_cam', cd)
    col('fv_Lookdev').objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    scn.camera = old

def hide_staging(state):
    for en in ('fv_kit_display', 'fv_bldg_display'):
        e = bpy.data.objects.get(en)
        if e:
            for o in e.children_recursive:
                o.hide_render = state

hide_staging(True)
render_cam((-24, -52, 2.2), (-27, -36, 1.0), f'{RD}\\ph4_yard.png', lens=40)
render_cam((-16, -44, 3.4), (-14, -30, 2.0), f'{RD}\\ph4_fence.png', lens=45)
render_cam((6, 26, 4.5), (-6, 8, 2.0), f'{RD}\\ph4_tree.png', lens=45)
render_cam((-38, -62, 26), (0, -14, 0), f'{RD}\\ph4_strategy.png', lens=40)
hide_staging(False)
bpy.ops.wm.save_mainfile()

import os
for f in ('ph4_yard.png', 'ph4_fence.png', 'ph4_tree.png', 'ph4_strategy.png'):
    p = os.path.join(RD, f)
    print(f, os.path.getsize(p) if os.path.exists(p) else 'MISSING')
print('PH4 DONE')
