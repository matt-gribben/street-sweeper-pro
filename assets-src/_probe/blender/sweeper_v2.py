"""Procedural low-poly street sweeper -> top-down (GTA2-ish tilt) sprite renders.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P sweeper.py -- <outdir> [hires_px] [direct_px]
Produces <outdir>/hi/sweeper_rXXX.png (hires, for nearest downscale) and
<outdir>/direct/sweeper_rXXX.png (rendered straight at sprite size, no AA).
"""
import bpy, math, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
HI = int(argv[1]) if len(argv) > 1 else 256
DIRECT = int(argv[2]) if len(argv) > 2 else 48
FRAMES = 8
TILT_DEG = 22.0  # camera tilt away from straight-down

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- toon material: Diffuse -> ShaderToRGB -> constant ColorRamp ----------
def toon(name, rgb, shadow=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    emit = nt.nodes.new("ShaderNodeEmission")
    ramp.color_ramp.interpolation = "CONSTANT"
    e = ramp.color_ramp.elements
    dark = tuple(c * shadow for c in rgb)
    e[0].position, e[0].color = 0.0, (*dark, 1)
    e[1].position, e[1].color = 0.25, (*tuple(c * 0.78 for c in rgb), 1)
    e3 = ramp.color_ramp.elements.new(0.6)
    e3.color = (*rgb, 1)
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emit.inputs[0])
    nt.links.new(emit.outputs[0], out.inputs[0])
    return m

def srgb(h):  # hex -> linear rgb
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

M = {
    "body": toon("body", srgb("#F2B21B")),     # municipal yellow
    "cab": toon("cab", srgb("#EDEDED")),
    "glass": toon("glass", srgb("#2B3A55")),
    "tyre": toon("tyre", srgb("#202020")),
    "brush": toon("brush", srgb("#C23B22")),   # red brushes so they read
    "beacon": toon("beacon", srgb("#FF7A00")),
    "stripe": toon("stripe", srgb("#1E6FD9")),
}

root = bpy.data.objects.new("Sweeper", None)
scene.collection.objects.link(root)

def box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(M[mat])
    o.parent = root
    return o

def cyl(name, r, depth, loc, rot, mat, verts=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(M[mat])
    o.parent = root
    return o

# vehicle faces +Y (nose). units ~ metres. length 4.4, width 2.0
box("chassis", (1.9, 4.2, 0.35), (0, 0, 0.55), "body")
box("hopper", (1.9, 2.4, 1.3), (0, -0.9, 1.35), "body")
box("stripe", (1.92, 2.42, 0.18), (0, -0.9, 1.25), "stripe")
box("cab", (1.8, 1.4, 1.35), (0, 1.35, 1.4), "cab")
box("windscreen", (1.6, 0.08, 0.6), (0, 2.06, 1.7), "glass")
box("roofglass", (1.5, 0.9, 0.05), (0, 1.45, 2.09), "glass")  # visible from top: skylight
cyl("beacon", 0.18, 0.25, (0, 1.0, 2.2), (0, 0, 0), "beacon", 8)
for sx in (-1, 1):
    for y in (1.3, -1.3):
        cyl("wheel", 0.42, 0.3, (sx * 0.95, y, 0.42), (0, math.pi / 2, 0), "tyre", 10)
    # round side brushes at front corners: flat discs
    cyl("brush", 0.55, 0.12, (sx * 1.05, 2.25, 0.12), (0, 0, 0), "brush", 16)
cyl("mainbrush", 0.35, 1.7, (0, 0.2, 0.35), (0, math.pi / 2, 0), "brush", 10)

# ---------- light + camera ----------
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 2.2
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = (math.radians(50), math.radians(0), math.radians(-40))
scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 6.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
tilt = math.radians(TILT_DEG)
dist = 20
cam.location = (0, -dist * math.sin(tilt), dist * math.cos(tilt) + 0.8)
cam.rotation_euler = (tilt, 0, 0)
scene.camera = cam

# ---------- render settings ----------
scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 1
scene.render.film_transparent = True
scene.render.filter_size = 0.0
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

t_build = time.time() - t0
timings = []
for label, px in (("hi", HI), ("direct", DIRECT)):
    os.makedirs(os.path.join(OUT, label), exist_ok=True)
    scene.render.resolution_x = scene.render.resolution_y = px
    for i in range(FRAMES):
        root.rotation_euler = (0, 0, math.radians(i * 360 / FRAMES))
        scene.render.filepath = os.path.join(OUT, label, f"sweeper_r{i * 45:03d}.png")
        ts = time.time()
        bpy.ops.render.render(write_still=True)
        timings.append((label, i, time.time() - ts))

print(f"BUILD {t_build:.2f}s")
for l, i, t in timings:
    print(f"RENDER {l} frame{i} {t:.2f}s")
print(f"TOTAL {time.time() - t0:.2f}s")
