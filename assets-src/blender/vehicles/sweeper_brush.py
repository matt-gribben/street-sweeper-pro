"""veh.sweeper_brush: Bessie's brush overlay. 96 px cell, same centre pivot as veh.sweeper.

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2, §7.4):

- state ``brush`` -> brush_h00_0..brush_h31_3.png: 32 headings x 4 spin frames.

Two 18 postbox_red gutter-brush discs (shade 19 maroon) either side of the front, each
carrying 4 radial bristle bars in 19 maroon so the spin reads from straight above, and a
05 slab suction mouth between them, just ahead of the body's front edge (y = 1.625 m).
The discs reach y = +2.2 m at h00 and 2.40 m from the body centre at diagonal headings,
which is why they live in a 96 px cell (ortho_scale 6 m) and not in the 64 px body cell.

Spin: 22.5 deg per frame. The bars are 4-fold symmetric, so 4 frames cover a quarter turn
and the loop is seamless. The left disc turns clockwise and the right one anticlockwise
(seen from above), so both sweep litter inward to the mouth.

Model space: metres, Z up, facing +Y (north), centred on the origin at ground level, every
part parented (directly or through a disc) to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.sweeper_brush [--check]
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 96
STATES = {"brush": 4}  # state -> frames per heading; forge blender expects exactly these frames


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


def box(name, size, loc, mat, parent):
    """An axis-aligned box of ``size`` (x, y, z) metres centred on ``loc`` in the parent's space."""
    hx, hy, hz = (s / 2 for s in size)
    verts = [(sx * hx, sy * hy, sz * hz) for sz in (-1, 1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = _object(name, verts, faces, mat, parent)
    ob.location = loc
    return ob


def disc(name, radius, depth, loc, mat, parent, segments=24):
    """A flat cylinder (axis Z) centred on ``loc``."""
    ring = [(radius * math.cos(2 * math.pi * k / segments), radius * math.sin(2 * math.pi * k / segments)) for k in range(segments)]
    verts = [(x, y, z) for z in (-depth / 2, depth / 2) for x, y in ring]
    n = segments
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    ob = _object(name, verts, faces, mat, parent)
    ob.location = loc
    return ob


def build() -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    """The overlay at h00. Returns root and the two discs (left first)."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    red = rig.toon_material("brush", lit="postbox_red", base="postbox_red", dark="maroon")
    bristle = rig.toon_material("bristle", lit="maroon", base="maroon", dark="maroon")
    steel = rig.toon_material("mouth", lit="kerb", base="slab", dark="slab_dk")

    # Suction mouth: 0.75 m wide, y 1.6875..1.9375, so its outline lands on the body front edge row (y 1.625).
    box("mouth", (0.75, 0.25, 0.10), (0.0, 1.8125, 0.10), steel, root)

    discs = []
    for x in (-0.85, 0.85):  # centre (+-0.85, 1.75), r 0.45: reach 2.20 m at h00, 2.40 m at diagonals
        d = disc(f"disc_{'l' if x < 0 else 'r'}", 0.45, 0.12, (x, 1.75, 0.08), red, root)
        for k in range(4):  # 4 radial bristle bars so the spin reads from straight above
            bar = box(f"bar_{'l' if x < 0 else 'r'}{k}", (0.10, 0.38, 0.02), (0.0, 0.0, 0.07), bristle, d)
            # Each bar runs from near the hub to the rim along its own radial direction.
            a = k * math.pi / 2
            bar.location = (-math.sin(a) * 0.235, math.cos(a) * 0.235, 0.07)
            bar.rotation_euler.z = a
        discs.append(d)
    return root, discs


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root, discs = build()

    # State "brush": brush_hNN_<f>.png, 4 spin frames per heading, 22.5 deg per frame.
    for f in range(4):

        def spin(_heading: int, f: int = f) -> None:
            for k, d in enumerate(discs):
                d.rotation_euler.z = (1 if k else -1) * f * (math.pi / 8)  # left clockwise, right anticlockwise

        rig.render_headings(scene, root, out, args.headings, prefix="brush_", suffix=f"_{f}", before_frame=spin)

    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
