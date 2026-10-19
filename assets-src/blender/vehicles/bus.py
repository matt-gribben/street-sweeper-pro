"""veh.bus: M3 placeholder bus. 128 px cell, body 38x116 px (2.38 x 7.25 m).

PLACEHOLDER (SSP-100): flat-colour primitive boxes at true size, so the frame IDs
``veh.bus:body:h00:0`` .. ``h31`` are final from day one. SSP-129 (M4) replaces the
model behind the same IDs.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2):

- state ``body`` -> h00..h31.png

Cell: 128x128, rendered ``--size 512`` with an ``ortho_scale`` of 8 m (ASSET_PIPELINE §7.5).
The body's half-diagonal is 61.0 px, so every heading fits with its outline (about 109 px at
the 45 deg headings, 122 px at h06).

Look (ART_BIBLE §8.2): an 18 postbox_red body (19 maroon shade, 17 hivis_orange lit, 2 px
bevels as on large vehicles, §6.2), 25 navy window strips along both flanks of the roof, a 07
chalk roof band down the middle with two 06 kerb roof vents on it, a 25 navy windscreen band
across the front, 16 lemon headlight cores and 19 maroon tail lights (red on red would
vanish).

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``; z in metres.
Model space: Z up, facing +Y (north), centred on the origin at ground level, every part
parented to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.bus [--check]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 128
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
    """The bus at h00 (front to +Y)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    paint = rig.toon_material("paint", lit="hivis_orange", base="postbox_red", dark="maroon")
    glass = rig.toon_material("glass", lit="sky", base="navy", dark="navy")
    band = rig.toon_material("band", lit="chalk", base="chalk", dark="kerb")
    vent = rig.toon_material("vent", lit="chalk", base="kerb", dark="slab")
    head = rig.toon_material("headlight", lit="lemon", base="lemon", dark="lemon")
    tail = rig.toon_material("taillight", lit="maroon", base="maroon", dark="maroon")

    block("body", -19, 19, -58, 58, 0.30, 3.00, paint, root, bevel=2.0)  # the 38x116 px footprint
    for x0, x1 in ((-17, -14.5), (14.5, 17)):  # window strips, inside the 2 px chamfers
        block(f"windows_{'l' if x0 < 0 else 'r'}", x0, x1, -50, 49, 3.00, 3.01, glass, root, bevel=0)
    block("windscreen", -17, 17, 52, 56, 3.00, 3.01, glass, root, bevel=0)
    block("roof_band", -4, 4, -50, 46, 3.00, 3.02, band, root, bevel=0)
    for y in (24.0, -26.0):
        block(f"vent_{y:+.0f}", -2.5, 2.5, y - 2.5, y + 2.5, 3.02, 3.12, vent, root, bevel=1.0)
    for side in (-1, 1):
        x0, x1 = sorted((side * 12.0, side * 16.0))
        block(f"headlight_{side:+d}", x0, x1, 56, 57.5, 3.00, 3.02, head, root, bevel=0)
        block(f"taillight_{side:+d}", x0, x1, -57.5, -55, 3.00, 3.02, tail, root, bevel=0)
    return root


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root = build()
    rig.render_headings(scene, root, out, args.headings)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
