"""veh.bicycle: M3 placeholder cycle courier. 32 px cell, body 8x26 px (0.5 x 1.63 m).

PLACEHOLDER (SSP-100): flat-colour primitive boxes at true size, so the frame IDs
``veh.bicycle:body:h00:0`` .. ``h31`` are final from day one. SSP-129 (M4) replaces the
model behind the same IDs.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2):

- state ``body`` -> h00..h31.png

Cell: 32x32, rendered ``--size 128`` with an ``ortho_scale`` of 2 m (ASSET_PIPELINE §7.5).

Look (ART_BIBLE §8.2): a 05 slab frame and handlebar (06 lit, 04 dark), 01 tar tyres (02 lit) front
and back, and the rider modelled in: a 29 teal top (torso and arms reaching the bars, 25 navy
shade) and a 07 chalk helmet over the front of the torso. The handlebar sets the 8 px width.

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``; z in metres.
Model space: Z up, facing +Y (north), centred on the origin at ground level, every part
parented to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.bicycle [--check]
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
    """The bicycle and rider at h00 (front to +Y)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    frame = rig.toon_material("frame", lit="kerb", base="slab", dark="slab_dk")
    rubber = rig.toon_material("tyre", lit="asphalt", base="tar", dark="tar")
    top = rig.toon_material("top", lit="teal", base="teal", dark="navy")
    helmet = rig.toon_material("helmet", lit="chalk", base="chalk", dark="kerb")

    block("tyre_front", -1, 1, 6, 13, 0.0, 0.70, rubber, root, bevel=0.5)  # the 26 px length
    block("tyre_rear", -1, 1, -13, -6, 0.0, 0.70, rubber, root, bevel=0.5)
    block("frame", -1, 1, -6, 6, 0.50, 0.85, frame, root, bevel=0.5)
    block("handlebar", -4, 4, 5, 7, 0.95, 1.05, frame, root, bevel=0.5)  # the 8 px width
    block("torso", -3, 3, -5, 2, 0.90, 1.45, top, root, bevel=1.0)
    for x0, x1 in ((-3.5, -2), (2, 3.5)):
        block(f"arm_{'l' if x0 < 0 else 'r'}", x0, x1, 1, 6, 1.05, 1.25, top, root, bevel=0.5)
    block("helmet", -2, 2, -1, 4, 1.45, 1.70, helmet, root, bevel=1.0)
    return root


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root = build()
    rig.render_headings(scene, root, out, args.headings)
    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
