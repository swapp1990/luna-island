import bpy
import numpy as np
from mathutils import Vector

OUT = r"D:\MyProjects\Claude\luna-island\art\manor-slice\renders\ph2b_kit.png"
BLEND = r"D:\MyProjects\Claude\luna-island\art\manor-slice\scenes\village.blend"

def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1,)

def link(o, cname):
    c = bpy.data.collections.get(cname)
    c.objects.link(o)

def set_ramp_colors(mat, colors):
    for n in mat.node_tree.nodes:
        if n.type == 'VALTORGB':
            for e, c in zip(n.color_ramp.elements, colors):
                e.color = hexcol(c)
            return True
    return False

def set_brick_colors(mat, c1, c2, mortar):
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_BRICK':
            n.inputs['Color1'].default_value = hexcol(c1)
            n.inputs['Color2'].default_value = hexcol(c2)
            n.inputs['Mortar'].default_value = hexcol(mortar)
            return True
    return False

def set_mix_b(mat, color):
    for n in mat.node_tree.nodes:
        if n.type == 'MIX' and n.data_type == 'RGBA':
            n.inputs[7].default_value = hexcol(color)
            return True
    return False

th = bpy.data.materials['fv_roof_thatch']
print('thatch ramp:', set_ramp_colors(th, ['#2E2820', '#5A5140']))
ti = bpy.data.materials['fv_roof_tile']
print('tile brick:', set_brick_colors(ti, '#6B4028', '#5C3422', '#452818'), 'moss:', set_mix_b(ti, '#4A4C40'))
sh = bpy.data.materials['fv_roof_shingle']
print('shingle brick:', set_brick_colors(sh, '#565C52', '#4A5046', '#383E36'), 'moss:', set_mix_b(sh, '#3E443C'))

gm = bpy.data.materials['fv_grass_base']
for n in gm.node_tree.nodes:
    if n.type == 'VALTORGB':
        n.color_ramp.elements[0].position = 0.44
        n.color_ramp.elements[1].position = 0.60
        print('grass ramp tightened')

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
    scn = bpy.context.scene
    old = scn.camera
    tmp = closeup_cam(obj, 'fv_tmp_cam')
    scn.camera = tmp
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scn.camera = old if old else bpy.data.objects.get('fv_cam_strategy')
    bpy.data.objects.remove(tmp, do_unlink=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1, :, :3]
    ctr = px[int(h*0.35):int(h*0.65), int(w*0.40):int(w*0.60)]
    mean = tuple(int(v) for v in (ctr.mean(axis=(0, 1)) * 255))
    bpy.data.images.remove(img)
    print(f'{label}: sunlit-slope mean={mean}')

for nm, lbl in (('fv_roof_thatch_gable', 'THATCH'), ('fv_roof_tile_gable', 'TILE')):
    o = bpy.data.objects[nm]
    render_closeup(o, OUT.replace('ph2b_kit.png', f'ph2c_{lbl.lower()}.png'), lbl)

scn = bpy.context.scene
old = scn.camera
cd = bpy.data.cameras.new('fv_tmp_cam')
cd.lens = 50
cam = bpy.data.objects.new('fv_tmp_cam', cd)
link(cam, 'fv_Lookdev')
roofs = [bpy.data.objects[n] for n in ('fv_roof_thatch_gable', 'fv_roof_thatch_hip', 'fv_roof_tile_gable')]
xs = [o.location.x for o in roofs]
cx = (min(xs) + max(xs)) / 2
cam.location = (cx, 35 - 34, 12)
d = Vector((cx, 35, 1.5)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scn.camera = cam
scn.render.filepath = OUT
bpy.ops.render.render(write_still=True)
scn.camera = old
bpy.data.objects.remove(cam, do_unlink=True)
img = bpy.data.images.load(OUT)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[::-1, :, :3]
gband = px[int(h*0.80):int(h*0.95), int(w*0.05):int(w*0.95)]
print('ROW grass_std', round(float(gband.std(axis=(0, 1)).mean()), 4))
bpy.data.images.remove(img)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('PH2C DONE')
