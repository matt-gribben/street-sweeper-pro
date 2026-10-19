"""veh.mobility_scooter: M3 placeholder mobility scooter. 32 px cell, body 14x22 px (0.88 x 1.38 m).

PLACEHOLDER (SSP-100): flat-colour primitive boxes at true size, so the frame IDs
``veh.mobility_scooter:body:h00:0`` .. ``h31`` are final from day one. SSP-129 (M4) replaces the
model behind the same IDs.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2):

- state ``body`` -> h00..h31.png

Cell: 32x32, rendered ``--size 128`` with an ``ortho_scale`` of 2 m (ASSET_PIPELINE §7.5).

Look (ART_BIBLE §8.2): a 26 council_blue body (27 sky lit, 25 navy shade) with its tiller at
the front and a 05 slab basket ahead of it, and the rider modelled in: a 30 plum coat (31
lavender lit, 25 navy shade) over the seat, knees forward and arms out to the tiller, and a
06 kerb head of hair (07 lit, 05 shade) on top.

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``; z in metres.
Model space: Z up, facing +Y (north), centred on the origin at ground level, every part
parented to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.mobility_scooter [--check]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 32
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
    """The mobility scooter and rider at h00 (front to +Y)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    body = rig.toon_material("body", lit="sky", base="council_blue", dark="navy")
    basket = rig.toon_material("basket", lit="kerb", base="slab", dark="slab_dk")
    coat = rig.toon_material("coat", lit="lavender", base="plum", dark="navy")
    hair = rig.toon_material("hair", lit="chalk", base="kerb", dark="slab")

    block("base", -7, 7, -11, 11, 0.15, 0.55, body, root, bevel=1.0)  # the 14x22 px footprint
    block("tiller", -1, 1, 4, 8, 0.55, 1.00, body, root, bevel=0.5)
    block("bars", -3.5, 3.5, 4.5, 6, 1.00, 1.08, body, root, bevel=0.5)
    block("basket", -4, 4, 7.5, 10.5, 0.55, 0.85, basket, root, bevel=0.5)
    block("coat", -5, 5, -9, -1, 0.55, 1.30, coat, root, bevel=1.0)
    block("knees", -4, 4, -1, 3.5, 0.55, 0.85, coat, root, bevel=0.5)
    for x0, x1 in ((-5, -3.5), (3.5, 5)):
        block(f"arm_{'l' if x0 < 0 else 'r'}", x0, x1, -2, 5, 0.90, 1.10, coat, root, bevel=0.5)
    block("head", -2.5, 2.5, -7, -2, 1.30, 1.55, hair, root, bevel=1.0)
    return root


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root = build()
    rig.render_headings(scene, root, out, args.headings)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
