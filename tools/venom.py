# venom.py — headless Venom head for Dark Veil.
#
# Base shape is a union of scaled spheres, voxel-remeshed and smoothed so the
# seams fuse into flesh fillets; the maw is a boolean difference; teeth, tongue
# and eye patches are separate solids. Cycles with a transparent film, so the
# frames drop straight onto the page over the existing backdrop.
#
#   contact sheet:  blender -b -P venom.py -- angles=0,26,51,77,103,129,154,180 w=240 h=300 samples=32 out=/tmp/vrender/sheet
#   final sequence: blender -b -P venom.py -- frames=48 w=960 h=700 samples=160 out=/tmp/vrender/frames
#   encode:         cwebp -q 88 -alpha_q 95 -m 6 -quiet fNNN.png -o public/venom/fNNN.webp
#
# The 960x700 frame is a field of view, not an output size: the render border
# below writes only the 727x620 rectangle the head sweeps within it.
#
# Blender is Z-up / Y-forward: +Y is the direction the face looks, +Z is up.
import bpy, math, os, sys, random
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(key, default):
    for a in argv:
        if a.startswith(key + '='):
            return a.split('=', 1)[1]
    return default


W       = int(arg('w', 600))
H       = int(arg('h', 750))
SAMPLES = int(arg('samples', 96))
OUT     = arg('out', '/tmp/vrender/frames')
VOXEL   = float(arg('voxel', 0.018))
_angles = arg('angles', '')
FRAMES  = int(arg('frames', 48))

# 0 = back of head to camera, 180 = face on.
ANGLES = ([float(a) for a in _angles.split(',')] if _angles
          else [i * 180.0 / (FRAMES - 1) for i in range(FRAMES)])

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def sphere(loc, scale, rot=(0.0, 0.0, 0.0), segs=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2,
                                         radius=1.0, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = Euler(rot, 'XYZ')
    return o
def bake_transform(obj):
    """Modifiers run in local space, so object scale has to be baked into the
    mesh before any voxel remesh or shrinkwrap, or it comes out anisotropic."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def boolean(target, cutter, op):
    m = target.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def apply_mod(obj, kind, **kw):
    m = obj.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)


# ------------------------------------------------------------------- the head
# Metaballs, not booleaned spheres: metaball fusion is a true smooth blend, so
# cranium, brow, muzzle and jaw melt into one mass. Unioned spheres just stack
# up as separate lumps with rounded seams, which reads as a snowman.
mb = bpy.data.metaballs.new('venom')
mb.resolution = 0.022
mb.render_resolution = 0.018
head = bpy.data.objects.new('head', mb)
bpy.context.collection.objects.link(head)


def blob(loc, half, rot=(0.0, 0.0, 0.0), stiff=2.0):
    """One ellipsoid element roughly filling the given half-extents.

    Measured semantics (Blender 5.0): for an ELLIPSOID element, size_x/y/z are
    axis ratios and `radius` is the overall scale, with full width coming out at
    size * radius * 1.15 for stiffness 2. So half-extent h needs
    size = h / (0.575 * radius). Influence scales with the element's own extent,
    which is what makes big masses blend over big distances.
    """
    e = mb.elements.new(type='ELLIPSOID')
    e.co = loc
    e.radius = 1.0
    e.size_x, e.size_y, e.size_z = (h / 0.575 for h in half)
    e.stiffness = stiff
    e.rotation = Euler(rot, 'XYZ').to_quaternion()
    return e


blob((0.0, -0.14,  0.08), (0.60, 0.86, 0.76))                     # cranium
blob((0.0,  0.58,  0.22), (0.58, 0.34, 0.11))                     # brow ridge
blob((0.0,  0.56,  0.00), (0.58, 0.50, 0.27))                     # brow
blob((0.0,  0.70, -0.26), (0.46, 0.80, 0.24))                     # upper muzzle
blob((0.0,  0.50, -0.66), (0.42, 0.80, 0.22), (-0.42, 0.0, 0.0))  # lower jaw
blob((0.0, -0.10, -0.55), (0.40, 0.40, 0.30))                     # throat/hinge

bpy.ops.object.select_all(action='DESELECT')
head.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.convert(target='MESH')
head = bpy.context.active_object
head.name = 'head'
bake_transform(head)

# Carve the maw out of that single mass, then even out the topology — the voxel
# pass also rounds the cut into a lip, which is what the mouth needs.
boolean(head, sphere((0.0, 0.82, -0.40), (0.48, 0.62, 0.32), (0.20, 0.0, 0.0)),
        'DIFFERENCE')
apply_mod(head, 'REMESH', mode='VOXEL', voxel_size=VOXEL)
apply_mod(head, 'SMOOTH', factor=0.35, iterations=4)
bpy.ops.object.shade_smooth()


# ------------------------------------------------------------------ the fangs
def fang(base, tip, r):
    d = Vector(tip) - Vector(base)
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=r, radius2=0.0015,
                                    depth=d.length,
                                    location=(Vector(base) + d * 0.5))
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o


fangs = []
for i in range(4):
    a  = (i + 0.55) / 4.0 * 1.45
    x  = math.sin(a) * 0.40
    y  = 0.86 - (1.0 - math.cos(a)) * 0.56
    g  = 1.0 + 0.6 * (i / 3.0)                 # corner canines are the long ones
    for sx in (1.0, -1.0):
        lu = (0.22 + 0.16 * random.random()) * g
        ll = (0.18 + 0.15 * random.random()) * g
        jx = 0.03 * (random.random() - 0.5)
        # Tips raked inward so the two rows interlock instead of meeting flat.
        fangs.append(fang((sx * (x + jx), y, -0.13),
                          (sx * (x * 0.72 + jx), y - 0.06 - 0.05 * random.random(),
                           -0.13 - lu), 0.036 + 0.014 * random.random()))
        fangs.append(fang((sx * (x - jx), y + 0.05, -0.71),
                          (sx * (x * 0.74 - jx), y + 0.03 * random.random(),
                           -0.71 + ll), 0.032 + 0.013 * random.random()))

bpy.ops.object.select_all(action='DESELECT')
for f in fangs:
    f.select_set(True)
bpy.context.view_layer.objects.active = fangs[0]
bpy.ops.object.join()
teeth = bpy.context.active_object
teeth.name = 'teeth'
bpy.ops.object.shade_smooth()
# ----------------------------------------------------------------- the tongue
# Out of the maw, lolling to one side, then down and curling back under itself.
def tongue_pt(t):
    return (0.26 * math.sin(t * 2.1),
            0.86 + 0.62 * t - 0.30 * t * t,
            -0.42 - 0.34 * t * t - 0.06 * t)


bpy.ops.curve.primitive_bezier_circle_add(radius=0.11)
profile = bpy.context.active_object
profile.name = 'tongue_profile'
profile.scale = (1.0, 0.44, 1.0)          # a ribbon, not a sausage
profile.hide_render = True

cu = bpy.data.curves.new('tongue', 'CURVE')
cu.dimensions = '3D'
cu.resolution_u = 14
cu.twist_mode = 'Z_UP'
cu.bevel_depth = 0.105
cu.bevel_resolution = 8
cu.use_fill_caps = True
sp = cu.splines.new('BEZIER')
STEPS = 7
sp.bezier_points.add(STEPS)
for i, pt in enumerate(sp.bezier_points):
    t = i / STEPS
    pt.co = tongue_pt(t)
    pt.handle_left_type = pt.handle_right_type = 'AUTO'
    pt.radius = 1.0 - 0.85 * t ** 1.25
tongue = bpy.data.objects.new('tongue', cu)
bpy.context.collection.objects.link(tongue)

# ------------------------------------------------------------- the eye patches
# Paint on the skin, not balls in sockets. Intersecting a canted lens with a
# copy of the head yields a patch whose outer face IS the head surface; nudging
# it out along its own normals leaves a black lip, which is the outline the
# character has. Shrinkwrapping a disc instead smears it into a band.
eyes = []
for sx in (1.0, -1.0):
    bpy.ops.object.select_all(action='DESELECT')
    head.select_set(True)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.duplicate()
    patch = bpy.context.active_object
    patch.name = 'eye'
    # Three lobes along one inward-and-down sweep, not one oval: broad outer end,
    # a middle, then a narrow tip that nearly reaches the centreline. That sweep
    # is the teardrop, and it has to be big — the eyes own the upper face.
    lens = sphere((sx * 0.31, 0.78, 0.10), (0.36, 0.32, 0.14),
                  (0.0, -sx * 0.85, 0.0))
    boolean(lens, sphere((sx * 0.17, 0.84, -0.04), (0.18, 0.27, 0.085)), 'UNION')
    boolean(lens, sphere((sx * 0.05, 0.88, -0.15), (0.11, 0.23, 0.050)), 'UNION')
    boolean(patch, lens, 'INTERSECT')
    apply_mod(patch, 'DISPLACE', direction='NORMAL', mid_level=0.0,
              strength=0.005)
    bpy.ops.object.shade_smooth()
    eyes.append(patch)
# -------------------------------------------------------------------- shading
def principled(name, **vals):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    for sock, v in vals.items():
        sock = sock.replace('_', ' ')
        if sock in p.inputs:
            p.inputs[sock].default_value = v
    return m


def add_bump(m, scale, detail, strength, distortion=0.0):
    """Procedural sinew: near-black skin has almost no diffuse, so the only
    thing that gives the surface texture is what the highlight rolls over."""
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = detail
    if 'Distortion' in noise.inputs:
        noise.inputs['Distortion'].default_value = distortion
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


skin = principled('skin', Base_Color=(0.011, 0.011, 0.017, 1.0),
                  Roughness=0.34, Coat_Weight=0.35, Coat_Roughness=0.30,
                  Specular_IOR_Level=0.5)
add_bump(skin, scale=9.0, detail=8.0, strength=0.30, distortion=2.0)

bone = principled('bone', Base_Color=(0.78, 0.75, 0.68, 1.0), Roughness=0.44,
                  Subsurface_Weight=0.12, Subsurface_Radius=(0.05, 0.03, 0.02))

flesh = principled('flesh', Base_Color=(0.32, 0.035, 0.115, 1.0),
                   Roughness=0.14, Coat_Weight=1.0, Coat_Roughness=0.08,
                   Subsurface_Weight=0.34, Subsurface_Radius=(0.22, 0.05, 0.04))
add_bump(flesh, scale=34.0, detail=4.0, strength=0.07)

sclera = principled('sclera', Base_Color=(0.86, 0.90, 0.93, 1.0), Roughness=0.22,
                    Coat_Weight=0.7, Coat_Roughness=0.10)

head.data.materials.append(skin)
teeth.data.materials.append(bone)
tongue.data.materials.append(flesh)
for e in eyes:
    e.data.materials.append(sclera)
# ------------------------------------------------------------------- lighting
# Three lights in the page's own palette: cool key, violet back rim to match the
# backdrop, dim cyan fill. World stays black so the alpha holds.
def area(name, loc, energy, color, size, rot):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.color = color
    d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = Euler(rot, 'XYZ')
    bpy.context.collection.objects.link(o)
    return o


area('key',  (-2.6,  -2.2,  2.6), 115.0, (0.72, 0.86, 0.95), 4.2,
     (0.72, -0.62, -0.30))
area('rim',  ( 2.9,   2.4, 0.60), 200.0, (0.62, 0.30, 0.95), 3.2,
     (1.42, 0.30, 2.28))
# Big and weak, not small and bright: a small lamp on glossy skin reflects as a
# handful of discrete round spots that read as blemishes. Broad and dim gives a
# gradient instead, and the rougher coat above keeps it from plating.
area('fill', ( 2.6,  -2.2, -1.6), 10.0, (0.25, 0.85, 0.95), 7.0,
     (2.10, 0.30, 0.72))

# A dim lamp inside the maw, or the teeth and tongue sit in pure shadow and the
# open mouth reads as a black hole.
maw_d = bpy.data.lights.new('maw', 'POINT')
maw_d.energy = 1.5
maw_d.color = (0.85, 0.92, 0.98)
maw_d.shadow_soft_size = 0.22
maw_l = bpy.data.objects.new('maw', maw_d)
maw_l.location = (0.0, 0.62, -0.42)
bpy.context.collection.objects.link(maw_l)

scene.world = bpy.data.worlds.new('w')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = \
    (0.012, 0.010, 0.022, 1.0)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.30

dg = bpy.context.evaluated_depsgraph_get()
for o in (head, teeth, tongue, *eyes):
    n = len(o.evaluated_get(dg).to_mesh().vertices)
    print('GEOM %-8s verts=%d' % (o.name, n), flush=True)

# --------------------------------------------------------------------- camera
cam_d = bpy.data.cameras.new('cam')
# 46mm, not 62: at the profile angles the muzzle reaches x ~= 1.2, and a 62mm
# lens from this distance only covers +/-1.07, so 27 of the 48 frames had the
# snout running off the right edge. The head lands smaller in frame as a result,
# which the common-bbox crop at encode time gives back.
cam_d.lens = float(arg('lens', 43.0))
# Pin the sensor to the vertical axis. Under AUTO the 36mm sensor maps to
# whichever output dimension is larger, so widening the frame to hunt for the
# true horizontal extent of the head would silently change the FOV as soon as
# width passed height. Pinned, extra width is purely extra field of view.
cam_d.sensor_fit = 'VERTICAL'
cam = bpy.data.objects.new('cam', cam_d)
# Low, not level: measured over the full turn the head sits 26/1000 of the frame
# below centre, because the jaw and tongue hang well under the pivot.
cam.location = (0.0, -4.60, -0.214)
cam.rotation_euler = Euler((math.pi / 2.0, 0.0, 0.0), 'XYZ')  # look down +Y
bpy.context.collection.objects.link(cam)
scene.camera = cam

# ------------------------------------------------------- turntable and render
# Parent everything to one empty and spin that. Lights stay put, so the key
# sweeps across the face as it turns, which is what sells the reveal.
pivot = bpy.data.objects.new('pivot', None)
bpy.context.collection.objects.link(pivot)
for o in (head, teeth, tongue, *eyes):
    o.parent = pivot
profile.parent = pivot
maw_l.parent = pivot          # the mouth lamp has to turn with the mouth
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 4
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.compression = 90
# Standard, not AgX/Filmic: a tone map would lift the near-black skin to grey
# and desaturate the violet rim, which is the whole look.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

# Render only the rectangle the head actually sweeps, and write exactly that.
# Measured over all 48 angles at lens 43: the union of the per-frame alpha boxes
# is x 0.200..0.958, y 0.060..0.947 of a 960x700 frame (Blender's border origin
# is bottom-left), which is 728x621 out. Cropping here rather than at encode time
# keeps a third of the frame from being path-traced for nothing, and a fixed box
# — not per-frame boxes — is what stops the head jittering between frames.
_border = arg('border', '0.2000,0.9583,0.0600,0.9471')
if _border != 'off':
    bx0, bx1, by0, by1 = (float(v) for v in _border.split(','))
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_max_x = bx0, bx1
    scene.render.border_min_y, scene.render.border_max_y = by0, by1

os.makedirs(OUT, exist_ok=True)
for i, a in enumerate(ANGLES):
    # Clockwise seen from above = negative rotation about +Z. At 0 the face
    # points +Y (away from the camera); at 180 it points -Y, straight at it.
    pivot.rotation_euler = Euler((0.0, 0.0, -math.radians(a)), 'XYZ')
    scene.render.filepath = os.path.join(OUT, 'f%03d.png' % i)
    bpy.ops.render.render(write_still=True)
    print('RENDERED %d/%d angle=%.1f -> %s'
          % (i + 1, len(ANGLES), a, scene.render.filepath), flush=True)

print('ALL-DONE %d frames in %s' % (len(ANGLES), OUT), flush=True)
