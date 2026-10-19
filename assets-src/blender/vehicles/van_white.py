"""veh.van_white: M3 placeholder white van (Dave's). 96 px cell, body 30x60 px (1.88 x 3.75 m).

PLACEHOLDER (SSP-100): flat-colour primitive boxes at true size, so the frame IDs
``veh.van_white:body:h00:0`` .. ``h31`` are final from day one. SSP-128 (M4) replaces the
model behind the same IDs. ``veh.van_white_parked`` is a manifest alias of these frames
(ASSET_PIPELINE §7.5), never a render of its own.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2):

- state ``body`` -> h00..h31.png

Cell (SSP-100 lead decision, ART_BIBLE §7.1): 96x96, rendered ``--size 384`` with an
``ortho_scale`` of 6 m, like veh.bin_lorry. The 30x60 px body has a half-diagonal of 33.5 px,
so at the headings near the diagonals (h06 spans 67 px) it cannot fit a 64 px cell with its
outline.

Look (ART_BIBLE §8.2): a 07 chalk box van (06 kerb shade, chalk lit), a short bonnet and a
25 navy windscreen band (27 sky NW highlight) at the front, the tall cargo box behind it and
a 05 slab ladder rack (two rails, four rungs) on the box roof. No lettering: it would not
read at 1x. 16 lemon headlight cores (chalk would vanish on the chalk body) and 18
postbox_red tail lights.

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``; z in metres.
Model space: Z up, facing +Y (north), centred on the origin at ground level, every part
parented to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.van_white [--check]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 96
STATES = {"body": 1}  # state -> frames per heading; forge blender expects exactly these frames


def px(v: float) -> float:
    """Target pixels -> metres (16 px per metre)."""
    return v / rig.PX_PER_M


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


def block(name, x0, x1, y0, y1, z0, z1, mat, parent, bevel=1.25):
    """Box from px (x, y) and metre (z) extents with a 45 deg chamfer of ``bevel`` px on its top edges.

    A chamfer facing NW lands on the toon ramp's lit step and one facing SE on its dark step
    (ART_BIBLE §6.2); the flat top renders the base step.
    """
    x0, x1, y0, y1 = px(x0), px(x1), px(y0), px(y1)
    b = px(bevel)
    zm = z1 - b
    verts = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, zm), (x1, y0, zm), (x1, y1, zm), (x0, y1, zm),
        (x0 + b, y0 + b, z1), (x1 - b, y0 + b, z1), (x1 - b, y1 - b, z1), (x0 + b, y1 - b, z1),
    ]  # fmt: skip
    faces = [
        (0, 3, 2, 1),  # bottom
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),  # sides
        (4, 5, 9, 8), (5, 6, 10, 9), (6, 7, 11, 10), (7, 4, 8, 11),  # chamfers
        (8, 9, 10, 11),  # top
    ]  # fmt: skip
    return _object(name, verts, faces, mat, parent)


def build() -> bpy.types.Object:
    """The white van at h00 (front to +Y)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    paint = rig.toon_material("paint", lit="chalk", base="chalk", dark="kerb")
    glass = rig.toon_material("glass", lit="sky", base="navy", dark="navy")
    rack = rig.toon_material("rack", lit="kerb", base="slab", dark="slab_dk")
    head = rig.toon_material("headlight", lit="lemon", base="lemon", dark="lemon")
    tail = rig.toon_material("taillight", lit="postbox_red", base="postbox_red", dark="postbox_red")

    # The 30x60 px footprint: bonnet (front 6 px), windscreen band (5 px), cargo box (49 px).
    block("bonnet", -15, 15, 24, 30, 0.30, 1.05, paint, root)
    block("windscreen", -14.5, 14.5, 19, 24.5, 0.30, 1.85, glass, root, bevel=1.0)
    block("box", -15, 15, -30, 19, 0.30, 2.35, paint, root, bevel=1.5)
    for x in (-8.5, 8.5):
        block(f"rail_{'l' if x < 0 else 'r'}", x - 0.75, x + 0.75, -25, 14, 2.35, 2.45, rack, root, bevel=0)
    for y in (-21.0, -10.0, 1.0, 11.0):
        block(f"rung_{y:+.0f}", -7.75, 7.75, y - 0.75, y + 0.75, 2.36, 2.44, rack, root, bevel=0)
    for side in (-1, 1):
        x0, x1 = sorted((side * 9.0, side * 12.0))
        block(f"headlight_{side:+d}", x0, x1, 27.5, 29.5, 1.05, 1.07, head, root, bevel=0)
        block(f"taillight_{side:+d}", x0, x1, -29.5, -27.5, 2.35, 2.37, tail, root, bevel=0)
    return root


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root = build()
    rig.render_headings(scene, root, out, args.headings)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
