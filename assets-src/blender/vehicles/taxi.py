"""veh.taxi: M3 placeholder taxi (a black cab). 64 px cell, body 28x54 px (1.75 x 3.38 m).

PLACEHOLDER (SSP-100): flat-colour primitive boxes at true size, so the frame IDs
``veh.taxi:body:h00:0`` .. ``h31`` are final from day one. SSP-128 (M4) replaces the
model behind the same IDs. ``veh.taxi_parked`` is a manifest alias of these frames
(ASSET_PIPELINE §7.5), never a render of its own.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2):

- state ``body`` -> h00..h31.png

Look (ART_BIBLE §8.2): a black cab, never yellow (15 is reserved for Bessie). Body 01 tar
with 02 asphalt lit bevels; its SE bevels stay 01, because a 00 ink bevel on the body edge would
become the outline itself and shrink the silhouette 1 px below the 28x54 sim body (the 00 shade
of §8.2 is carried by the forge's ink outline here; SSP-128 can put 00 in interior creases). A 02
asphalt base roof (03 lit, 01 dark), glass
25 navy with a 27 sky NW highlight, a 16 lemon roof sign near the front of the roof (lit at
night in M4), 07 chalk headlight dots and 18 postbox_red tail lights. The greenhouse is taller
than the saloon's, as a cab's is.

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``; z in metres.
Model space: Z up, facing +Y (north), centred on the origin at ground level, every part
parented to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.taxi [--check]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 64
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
    """The taxi at h00 (front to +Y)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    body = rig.toon_material("body", lit="asphalt", base="tar", dark="tar")
    roof = rig.toon_material("roof", lit="asphalt_lt", base="asphalt", dark="tar")
    glass = rig.toon_material("glass", lit="sky", base="navy", dark="navy")
    sign = rig.toon_material("sign", lit="lemon", base="lemon", dark="ochre")
    head = rig.toon_material("headlight", lit="chalk", base="chalk", dark="chalk")
    tail = rig.toon_material("taillight", lit="postbox_red", base="postbox_red", dark="postbox_red")

    block("body", -14, 14, -27, 27, 0.25, 1.00, body, root)  # the 28x54 px footprint
    block("glass", -12.5, 12.5, -18, 12, 1.00, 1.65, glass, root, bevel=1.0)
    block("roof", -11.5, 11.5, -15, 8, 1.65, 1.73, roof, root, bevel=1.0)
    block("sign", -4, 4, 3, 6, 1.73, 1.85, sign, root, bevel=0.75)
    for side in (-1, 1):
        x0, x1 = sorted((side * 7.5, side * 11.0))
        block(f"headlight_{side:+d}", x0, x1, 24.5, 26.5, 1.00, 1.02, head, root, bevel=0)
        block(f"taillight_{side:+d}", x0, x1, -26.5, -24.5, 1.00, 1.02, tail, root, bevel=0)
    return root


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root = build()
    rig.render_headings(scene, root, out, args.headings)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
