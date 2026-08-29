import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector

SEED = 7
rng = random.Random(SEED)
OUT = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders\ph2b_kit.png"
BLEND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\scenes\village.blend"

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

def link(o, cname):
    for uc in list(o.users_collection):
        uc.objects.unlink(o)
    col(cname).objects.link(o)

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

def mat_find_or_make(name, base, rough=0.9):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hexcol(base)
    bsdf.inputs["Roughness"].default_value = rough
    return m

def mesh_obj(name, verts, faces, mats, cname, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    for i, m in enumerate(mats):
        me.materials.append(m)
        me.polygons[i].material_index = 0 if i == 0 else i
    link(ob, cname)
    return ob

M = {
    'thatch': None, 'plaster': None, 'timber': None, 'tile': None, 'shingle': None,
}

def build_materials():
    M['timber'] = mat_find_or_make('fv_timber_oak', '#3E2E1E', 0.85)
    M['plaster'] = mat_find_or_make('fv_plaster_whitewash', '#E8E0CC', 0.95)
    M['plaster_ochre'] = mat_find_or_make('fv_plaster_ochre', '#D9B878', 0.95)
    M['plaster_weathered'] = mat_find_or_make('fv_plaster_weathered', '#B9B4A6', 0.95)

    m = bpy.data.materials.get('fv_roof_thatch') or bpy.data.materials.new('fv_roof_thatch')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    bmp = nt.nodes.new('ShaderNodeBump')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = -0.3
    mr.inputs['From Max'].default_value = 3.6
    ramp.color_ramp.elements[0].color = hexcol('#5E5340')
    ramp.color_ramp.elements[1].color = hexcol('#8A7A5E')
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    noise.inputs['Scale'].default_value = 18.0
    noise.inputs['Detail'].default_value = 4.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    bmp.inputs['Strength'].default_value = 0.35
    nt.links.new(noise.outputs['Fac'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.95
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    M['thatch'] = m

    def roof_tile_mat(name, c1, c2, moss_hex, row_w):
        mm = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mm.use_nodes = True
        nt = mm.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        tc = nt.nodes.new('ShaderNodeTexCoord')
        brick = nt.nodes.new('ShaderNodeTexBrick')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        zmr = nt.nodes.new('ShaderNodeMapRange')
        mn = nt.nodes.new('ShaderNodeTexNoise')
        mfac = nt.nodes.new('ShaderNodeMath')
        mixm = nt.nodes.new('ShaderNodeMix')
        bmp = nt.nodes.new('ShaderNodeBump')
        brick.offset = 0.5
        brick.inputs['Scale'].default_value = 1.0
        brick.inputs['Color1'].default_value = hexcol(c1)
        brick.inputs['Color2'].default_value = hexcol(c2)
        brick.inputs['Mortar'].default_value = hexcol('#6B4028')
        brick.inputs['Mortar Size'].default_value = 0.02
        brick.inputs['Brick Width'].default_value = row_w
        brick.inputs['Row Height'].default_value = row_w * 0.5
        nt.links.new(tc.outputs['Object'], brick.inputs['Vector'])
        nt.links.new(brick.outputs['Color'], bsdf.inputs['Base Color'])
        sep2 = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Object'], sep2.inputs['Vector'])
        zmr.inputs['From Min'].default_value = 0.0
        zmr.inputs['From Max'].default_value = 1.6
        nt.links.new(sep2.outputs['Z'], zmr.inputs['Value'])
        mn.inputs['Scale'].default_value = 0.6
        mn.inputs['Detail'].default_value = 3.0
        nt.links.new(tc.outputs['Object'], mn.inputs['Vector'])
        mfac.operation = 'MULTIPLY'
        mfac.inputs[1].default_value = 0.55
        nt.links.new(mn.outputs['Fac'], mfac.inputs[0])
        mixm.data_type = 'RGBA'
        mixm.blend_type = 'MIX'
        mixm.inputs[0].default_value = 0.0
        nt.links.new(zmr.outputs['Result'], mixm.inputs[0])
        mixm.inputs[6].default_value = hexcol(c1)
        mixm.inputs[7].default_value = hexcol(moss_hex)
        nt.links.new(brick.outputs['Color'], mixm.inputs[6])
        nt.links.new(mixm.outputs[2], bsdf.inputs['Base Color'])
        bmp.inputs['Strength'].default_value = 0.4
        nt.links.new(brick.outputs['Fac'], bmp.inputs['Height'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = 0.9
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        return mm

    M['tile'] = roof_tile_mat('fv_roof_tile', '#9C5F3C', '#8A4A38', '#6E705C', 0.7)
    M['shingle'] = roof_tile_mat('fv_roof_shingle', '#7C8378', '#6E7468', '#5E6657', 0.5)

def gable_roof(name, span, length, pitch_deg, mats, cname, sag_max=0.07, y0=0.0):
    half = span / 2
    ov = 0.4
    ridge_z = half * math.tan(math.radians(pitch_deg))
    z0 = -0.15
    ex = half + ov
    th = 0.25
    v = []
    def add(pt):
        v.append(pt)
        return len(v) - 1
    L0o = add((-ex, y0, z0)); R0o = add((0, y0, ridge_z)); Rt0o = add((ex, y0, z0))
    L1o = add((-ex, y0+length, z0)); R1o = add((0, y0+length, ridge_z)); Rt1o = add((ex, y0+length, z0))
    L0i = add((-ex+0.28, y0, z0+th)); Rt0i = add((ex-0.28, y0, z0+th)); R0i = add((0, y0, ridge_z-th))
    L1i = add((-ex+0.28, y0+length, z0+th)); Rt1i = add((ex-0.28, y0+length, z0+th)); R1i = add((0, y0+length, ridge_z-th))
    L0d = add((-ex, y0, z0-th)); L1d = add((-ex, y0+length, z0-th))
    Rt0d = add((ex, y0, z0-th)); Rt1d = add((ex, y0+length, z0-th))
    f_thatch, f_plaster = 0, 1
    faces = [
        ([L0o, R0o, R1o, L1o], f_thatch),
        ([R0o, Rt0o, Rt1o, R1o], f_thatch),
        ([L0i, L1i, R1i, R0i], f_thatch),
        ([R0i, R1i, Rt1i, Rt0i], f_thatch),
        ([L0o, L0i, L1i, L1o], f_thatch),
        ([Rt0o, Rt1o, Rt1i, Rt0i], f_thatch),
        ([L0o, L1o, L1d, L0d], f_thatch),
        ([Rt0o, Rt1o, Rt1d, Rt0d], f_thatch),
        ([L0i, R0i, Rt0i], f_plaster),
        ([L1i, R1i, Rt1i], f_plaster),
    ]
    ob = mesh_obj_multi(name, v, faces, [mats[0], mats[1]], cname)
    me = ob.data
    for p in me.polygons:
        p.material_index = 1 if p.center.z > ridge_z - th + 0.01 and abs(p.center.x) < 0.1 and (p.center.y - y0 < 0.1 or p.center.y - y0 > length - 0.1) and len(p.vertices) == 3 else 0
    for vtx in me.vertices:
        x, y, z = vtx.co
        if abs(x) < 0.05 and z > ridge_z * 0.8:
            vtx.co.z -= rng.uniform(0.03, sag_max) * math.sin(math.pi * (y - y0) / length)
        if z < z0 + 0.6 and abs(abs(x) - ex) < 0.05:
            vtx.co.x += math.copysign(0.05 + 0.03 * math.sin(y * 2.1 + rng.random()), x)
    return ob

def mesh_obj_multi(name, verts, face_mat_pairs, mats, cname):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [f for f, _ in face_mat_pairs])
    me.validate()
    for p in me.polygons:
        p.use_smooth = True
    for m in mats:
        me.materials.append(m)
    for p, (_, mi) in zip(me.polygons, face_mat_pairs):
        p.material_index = mi
    ob = bpy.data.objects.new(name, me)
    link(ob, cname)
    return ob

def hip_roof(name, span, length, pitch_deg, mats, cname):
    half = span / 2
    ov = 0.4
    ridge_z = half * math.tan(math.radians(pitch_deg))
    z0 = -0.15
    ex = half + ov
    ry0, ry1 = length * 0.2, length * 0.8
    v = [
        (-ex, 0, z0), (ex, 0, z0), (ex, length, z0), (-ex, length, z0),
        (0, ry0, ridge_z), (0, ry1, ridge_z),
        (-ex+0.28, 0.28, z0+0.25), (ex-0.28, 0.28, z0+0.25),
        (ex-0.28, length-0.28, z0+0.25), (-ex+0.28, length-0.28, z0+0.25),
        (0, ry0+0.3, ridge_z-0.25), (0, ry1-0.3, ridge_z-0.25),
        (-ex, 0, z0-0.25), (ex, 0, z0-0.25), (ex, length, z0-0.25), (-ex, length, z0-0.25),
    ]
    faces = [
        ([0, 4, 5, 2 - 2], 0),
        ([0, 4, 5, 3], 0),
        ([1, 4, 5, 2], 0),
        ([0, 1, 4], 0),
        ([3, 2, 5], 0),
        ([6, 7, 8, 9], 0),
        ([7, 10, 11, 8], 0),
        ([6, 10, 11, 9], 0),
        ([7, 8, 10], 0),
        ([9, 11, 10], 0),
        ([0, 1, 13, 12], 0),
        ([1, 2, 14, 13], 0),
        ([2, 3, 15, 14], 0),
        ([3, 0, 12, 15], 0),
    ]
    faces = [([0, 4, 5, 3], 0), ([1, 2, 5, 4], 0), ([0, 1, 4], 0), ([3, 2, 5], 0)]
    ob = mesh_obj_multi(name, v, faces, [mats[0]], cname)
    for vtx in ob.data.vertices:
        x, y, z = vtx.co
        if abs(x) < 0.05 and z > ridge_z * 0.8:
            vtx.co.z -= rng.uniform(0.03, 0.07) * math.sin(math.pi * y / length)
    return ob

def rebuild_infill(name, plaster_mat, braced=False):
    purge([name])
    v, f = [], []
    def box(x0, x1, y0, y1, z0, z1, mi):
        idx = len(v)
        for dx, dy, dz in [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]:
            v.append((dx, dy, dz))
        for a, b, c, d in [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
            f.append((tuple(idx+j for j in (a, b, c, d)), mi))
    box(-1.5+0.03, 1.5-0.03, -0.03, 0.03, 0.05, 2.45, 0)
    for x in (-1.5, 1.32):
        box(x, x+0.18, 0.0, 0.09, 0.0, 2.5, 1)
    for z, h in ((0.0, 0.18), (1.22, 0.16), (2.32, 0.18)):
        box(-1.5, 1.5, 0.0, 0.09, z, z+h, 1)
    if braced:
        def diag(p0, p1, w=0.14):
            a0 = Vector((p0[0], 0.045, p0[1]))
            a1 = Vector((p1[0], 0.045, p1[1]))
            n2 = (a1 - a0).cross(Vector((0, 1, 0))).normalized() * w / 2
            idx = len(v)
            for pt in (a0 + n2, a1 + n2, a1 - n2, a0 - n2):
                v.append((pt.x, pt.y, pt.z))
            f.append((tuple(idx+j for j in (0, 1, 2)), 1))
            f.append((tuple(idx+j for j in (0, 2, 3)), 1))
        diag((-1.32, 0.35), (1.32, 1.3))
        diag((1.32, 0.35), (-1.32, 1.3))
        arc = [(math.cos(t) * 0.9 - 0.0, 1.55 + math.sin(t) * 0.55) for t in [math.radians(a) for a in range(10, 171, 16)]]
        for i in range(len(arc) - 1):
            x0, z0 = arc[i]; x1, z1 = arc[i + 1]
            idx = len(v)
            for xx, zz in ((x0, z0), (x1, z1)):
                v.append((xx, 0.045, zz))
                v.append((xx, 0.135, zz))
            f.append((tuple(idx+j for j in (0, 1, 3)), 1))
            f.append((tuple(idx+j for j in (0, 3, 2)), 1))
    ob = mesh_obj_multi(name, v, f, [plaster_mat, M['timber']], 'fv_Buildings')
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob

def grass_macro():
    m = bpy.data.materials.get('fv_grass_base')
    if not m:
        print('grass mat missing')
        return
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if not bsdf:
        for n in nt.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                bsdf = n
                break
    src = bsdf.inputs['Base Color'].links[0].from_socket if bsdf.inputs['Base Color'].links else None
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ns = nt.nodes.new('ShaderNodeTexNoise')
    ns.inputs['Scale'].default_value = 0.07
    ns.inputs['Detail'].default_value = 2.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = hexcol('#000000')
    ramp.color_ramp.elements[1].color = hexcol('#FFFFFF')
    mixA = nt.nodes.new('ShaderNodeMix')
    mixA.data_type = 'RGBA'
    mixA.inputs[7].default_value = hexcol('#9AA05A')
    nt.links.new(tc.outputs['Object'], ns.inputs['Vector'])
    nt.links.new(ns.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mixA.inputs[0])
    if src:
        nt.links.new(src, mixA.inputs[6])
        nt.links.new(mixA.outputs[2], bsdf.inputs['Base Color'])
    else:
        mixA.inputs[6].default_value = hexcol('#7A8F4A')
        nt.links.new(mixA.outputs[2], bsdf.inputs['Base Color'])
    print('grass macro variation added')

def thicken_kit():
    for nm in ('fv_kit_post', 'fv_kit_rail'):
        o = bpy.data.objects.get(nm)
        if o:
            d = o.dimensions
            tgt = {'fv_kit_post': (0.18, 0.18, None), 'fv_kit_rail': (None, 0.18, 0.18)}[nm]
            if tgt[0]: o.scale.x *= tgt[0] / max(d.x, 1e-5)
            if tgt[1]: o.scale.y *= tgt[1] / max(d.y, 1e-5)
            if tgt[2]: o.scale.z *= tgt[2] / max(d.z, 1e-5)
    for m in bpy.data.materials:
        if any(k in m.name.lower() for k in ('timber', 'oak', 'wood', 'plank')) and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED' and not n.inputs['Base Color'].links:
                    n.inputs['Base Color'].default_value = hexcol('#3E2E1E')
    print('kit timber thickened/darkened')

def render_to(path, cam):
    scn = bpy.context.scene
    old = scn.camera
    scn.camera = cam
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scn.camera = old

def frame_row_cam(prefix, name):
    objs = [o for o in bpy.data.objects if o.name.startswith(prefix) and o.type == 'MESH']
    pts = [o.matrix_world.translation for o in objs]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]
    cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
    span = max(max(xs)-min(xs), max(ys)-min(ys)) + 14
    cd = bpy.data.cameras.new(name)
    cd.lens = 50
    cob = bpy.data.objects.new(name, cd)
    link(cob, 'fv_Lookdev')
    cob.location = (cx, cy - span * 0.75, span * 0.28)
    d = Vector((cx, cy, 1.2)) - cob.location
    cob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cob

def sample(path, regions):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    px = px[::-1]
    res = {}
    for label, (x0f, x1f, y0f, y1f) in regions.items():
        r = px[int(h*y0f):int(h*y1f), int(w*x0f):int(w*x1f), :3]
        mean = (r.mean(axis=(0, 1)) * 255).astype(int)
        res[label] = tuple(mean)
    if 'white' in regions or True:
        band = px[int(h*0.35):int(h*0.62), int(w*0.70):, :3]
        white = int((band.min(axis=2) > 0.90).sum())
        res['white_px_right'] = white
        g = px[int(h*0.75):int(h*0.95), int(w*0.05):int(w*0.95), :3]
        res['grass_std'] = float(g.std(axis=(0, 1)).mean())
    bpy.data.images.remove(img)
    return res

purge(['fv_roof_thatch_gable', 'fv_roof_thatch_hip', 'fv_roof_tile_gable',
       'fv_kit_wall_infill_whitewash', 'fv_kit_wall_infill_ochre', 'fv_kit_wall_infill_weathered',
       'fv_tmp_cam'])
build_materials()
g = gable_roof('fv_roof_thatch_gable', 6.8, 8.4, 50, [M['thatch'], M['plaster']], 'fv_Buildings')
h = hip_roof('fv_roof_thatch_hip', 6.94, 9.55, 50, [M['thatch']], 'fv_Buildings')
t = gable_roof('fv_roof_tile_gable', 6.8, 8.4, 50, [M['tile'], M['plaster']], 'fv_Buildings')
rebuild_infill('fv_kit_wall_infill_whitewash', M['plaster'], braced=True)
rebuild_infill('fv_kit_wall_infill_ochre', M['plaster_ochre'])
rebuild_infill('fv_kit_wall_infill_weathered', M['plaster_weathered'])
thicken_kit()
grass_macro()

row_objs = [g, h, t]
kit_children = [o for o in bpy.data.objects if o.name.startswith('fv_kit_') and o.type == 'MESH']
disp = bpy.data.objects.get('fv_kit_display')
if disp:
    kit_children = [o for o in disp.children_recursive if o.type == 'MESH'] or kit_children
xs = sorted(set(round(o.location.x) for o in kit_children))
slot = max(xs) + 12 if xs else 0
for i, o in enumerate((g, h, t)):
    o.location = (slot + i * 12, 35, 0)
for i, nm in enumerate(('fv_kit_wall_infill_whitewash', 'fv_kit_wall_infill_ochre', 'fv_kit_wall_infill_weathered')):
    o = bpy.data.objects.get(nm)
    if o:
        o.location = (slot - 12 * (i + 1), 35, 0)
bpy.context.view_layer.update()

def closeup_cam(obj, name):
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    ctr = sum(bb, Vector()) / 8
    diag = max((b - a).length for a in bb for b in bb)
    cd = bpy.data.cameras.new(name)
    cd.lens = 50
    cob = bpy.data.objects.new(name, cd)
    link(cob, 'fv_Lookdev')
    cob.location = ctr + Vector((0.35, -1.0, 0.28)) * diag * 1.5
    d = ctr - cob.location
    cob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cob

def render_closeup(obj, path, label):
    cam = closeup_cam(obj, 'fv_tmp_cam')
    render_to(path, cam)
    bpy.data.objects.remove(cam, do_unlink=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1, :, :3]
    ctr = px[int(h*0.30):int(h*0.70), int(w*0.35):int(w*0.65)]
    mean = tuple((ctr.mean(axis=(0, 1)) * 255).astype(int))
    white = int((px.min(axis=2) > 0.90).sum())
    bpy.data.images.remove(img)
    print(f'{label}: mean={mean} white_px={white}')

for o, lbl in ((g, 'THATCH_GABLE'), (h, 'THATCH_HIP'), (t, 'TILE_GABLE')):
    render_closeup(o, OUT.replace('ph2b_kit.png', f'ph2b_{lbl.lower()}.png'), lbl)
cam = frame_row_cam('fv_roof_', 'fv_tmp_cam')
render_to(OUT, cam)
bpy.data.objects.remove(cam, do_unlink=True)

img = bpy.data.images.load(OUT)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[::-1, :, :3]
gband = px[int(h*0.78):int(h*0.95), int(w*0.05):int(w*0.95)]
print('ROW grass_std', round(float(gband.std(axis=(0, 1)).mean()), 4))
bpy.data.images.remove(img)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('PH2B DONE')
