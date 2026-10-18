"""prop.lamp_post: a seaside column lamp post as a 4-slice sprite stack. 32 px cell per slice (2 m).

M0 spike asset under its final ID (SSP-020, placeholder first; SSP-131 may redo it in M4).
Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2, §7.5, §10.2):

- state ``slice`` -> slice_0.png .. slice_3.png, ``k`` = 0 at the ground, upward.

Each slice is the top-down view of one height band in ``SLICES``: the camera's ``clip_start``
and ``clip_end`` are moved so that only geometry inside the band is drawn. Straight down, a
vertical wall has no area, so every part is modelled as a closed solid that lies wholly inside
one band and ends in a cap just below the band top; a part that crossed a band edge would be
cut open by the clip and show its inside. ``check_bands`` enforces this before rendering.

The engine draws slice ``k`` at the TOP of its band (src/render/spriteStack.ts, which keeps its
own copy of the band tops; tests/unit/spriteStack.test.ts checks the two agree). Band tops are
chosen with an even tenths digit, so 31.5 m - top has an odd tenths digit and no pixel centre
of a centred slice lands exactly on a texel edge (see spriteStack.ts).

Look (ART_BIBLE §8.6): a cast-iron post in 01 tar on an octagonal plinth, a ladder crossbar
under the lantern, and a lantern whose pyramid roof is 07 chalk (base 06 kerb, dark 05 slab),
the lamp head that will write the light mask at night (SSP-021). Iron is lit 03 asphalt_lt and
has no darker step: a 00 ink shade on a 4 px post reads as a hole in its outline. The cone caps
and the pyramid roof give the NW-lit / SE-dark steps of §6.2.

Model space: metres, Z up, +Y north, the post's foot on the origin, every part parented to the
empty ``root`` (props render 1 heading, so it never rotates).

Render through the forge only:  npm run assets:blender -- prop.lamp_post [--check]
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402
from mathutils import Vector  # noqa: E402

CELL_PX = 32
STATES = {"slice": 4}  # state -> frames; forge blender expects slice_0..slice_3.png

# Height bands (z0, z1) in metres, slice 0 at the ground. The engine draws slice k at z1.
SLICES = [(0.0, 0.6), (0.6, 2.4), (2.4, 3.6), (3.6, 4.4)]

# Parts end this far below their band top, so no cap sits on a clip plane.
CAP_GAP_M = 0.02


def _object(name: str, verts: list, faces: list, mat: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    """A flat-shaded mesh object with outward normals, linked to the scene and parented."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def column(name, r0, z0, z1, r_top, z_top, mat, parent, segments=8):
    """A closed octagonal prism of radius ``r0`` from ``z0`` to ``z1``, capped by a cone (frustum)
    rising to radius ``r_top`` at ``z_top``. A cone cap catches the sun, unlike a flat top."""
    ring = [(math.cos(2 * math.pi * (k + 0.5) / segments), math.sin(2 * math.pi * (k + 0.5) / segments)) for k in range(segments)]
    n = segments
    verts = [(r0 * x, r0 * y, z0) for x, y in ring]
    verts += [(r0 * x, r0 * y, z1) for x, y in ring]
    verts += [(r_top * x, r_top * y, z_top) for x, y in ring]
    faces = [tuple(reversed(range(n))), tuple(range(2 * n, 3 * n))]
    for ring_lo in (0, n):
        faces += [(ring_lo + k, ring_lo + (k + 1) % n, ring_lo + n + (k + 1) % n, ring_lo + n + k) for k in range(n)]
    return _object(name, verts, faces, mat, parent)


def box(name, size, centre, mat, parent):
    """An axis-aligned box of ``size`` (x, y, z) metres centred on ``centre``."""
    hx, hy, hz = (s / 2 for s in size)
    cx, cy, cz = centre
    verts = [(cx + sx * hx, cy + sy * hy, cz + sz * hz) for sz in (-1, 1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _object(name, verts, faces, mat, parent)


def pyramid(name, half, z0, z_apex, mat, parent):
    """A square pyramid (faces toward N, E, S, W) on a ``2 * half`` square base at ``z0``."""
    verts = [(-half, -half, z0), (half, -half, z0), (half, half, z0), (-half, half, z0), (0.0, 0.0, z_apex)]
    faces = [(0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    return _object(name, verts, faces, mat, parent)


def build() -> bpy.types.Object:
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    iron = rig.toon_material("iron", lit="asphalt_lt", base="tar", dark="tar")
    lamp = rig.toon_material("lamp", lit="chalk", base="kerb", dark="slab")

    (b0, t0), (b1, t1), (b2, t2), (b3, t3) = SLICES
    # Slice 0: octagonal plinth, 0.6 m across, with a chamfered top that steps in to the post.
    column("plinth", 0.30, b0, 0.44, 0.15, t0 - CAP_GAP_M, iron, root)
    # Slice 1: the lower post, 0.26 m across.
    column("post_lower", 0.13, b1 + CAP_GAP_M, t1 - 0.14, 0.05, t1 - CAP_GAP_M, iron, root)
    # Slice 2: the upper post and the ladder crossbar (east-west) just under the lantern.
    column("post_upper", 0.11, b2 + CAP_GAP_M, t2 - 0.12, 0.04, t2 - CAP_GAP_M, iron, root)
    box("crossbar", (0.90, 0.12, 0.10), (0.0, 0.0, t2 - 0.30), iron, root)
    # Slice 3: the lantern: a 0.56 m glazed box (its sides are invisible from straight above) under a
    # 0.68 m chalk pyramid roof and a small iron finial.
    box("lantern", (0.56, 0.56, 0.36), (0.0, 0.0, b3 + CAP_GAP_M + 0.18), lamp, root)
    pyramid("roof", 0.34, b3 + CAP_GAP_M + 0.36, t3 - 0.10, lamp, root)
    column("finial", 0.05, t3 - 0.16, t3 - 0.06, 0.02, t3 - CAP_GAP_M, iron, root)
    return root


def check_bands() -> None:
    """Every mesh must lie wholly inside one band (a part crossing a clip plane would render open).

    Vertex coordinates are float32, hence the 1e-5 m tolerance.
    """
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        zs = [(ob.matrix_world @ Vector(v.co)).z for v in ob.data.vertices]
        lo, hi = min(zs), max(zs)
        if not any(z0 <= lo and hi <= z1 - CAP_GAP_M + 1e-5 for z0, z1 in SLICES):
            raise RuntimeError(f"lamp_post: {ob.name} spans z {lo:.3f}..{hi:.3f}, outside every band of {SLICES}")


def render_slices(scene: bpy.types.Scene, out: Path) -> None:
    """slice_<k>.png: the camera clips everything outside band k. The rig camera sits
    CAMERA_DISTANCE_M above the ground looking straight down, so height z is at depth D - z."""
    out.mkdir(parents=True, exist_ok=True)
    cam = scene.camera.data
    d = rig.CAMERA_DISTANCE_M
    for k, (z0, z1) in enumerate(SLICES):
        cam.clip_start = d - z1
        cam.clip_end = d - z0
        scene.render.filepath = str(out / f"slice_{k}.png")
        bpy.ops.render.render(write_still=True)


def main() -> None:
    args = rig.parse_args()
    if args.headings != 1:
        raise SystemExit(f"lamp_post: sprite-stack props render 1 heading, got --headings {args.headings}")
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    build()
    bpy.context.view_layer.update()
    check_bands()
    render_slices(scene, out)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
