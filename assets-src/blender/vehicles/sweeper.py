"""veh.sweeper: Bessie, the Dustmaster 3000. 64 px cell, body 28x52 px (1.75 x 3.25 m).

Straight-down orthographic renders on the shared rig (ASSET_PIPELINE §7.2, §7.4):

- state ``body``   -> h00..h31.png
- state ``dented`` -> dented_h00..dented_h31.png (shown below 40 HP)

The brush discs and suction mouth are a separate asset, ``veh.sweeper_brush``
(``sweeper_brush.py``), because they do not fit a 64 px cell.

Livery (ART_BIBLE §8.1): body 15 sweeper_yellow (shade 14 ochre, lit 16 lemon), cab roof
07 chalk, 2 px 26 council_blue stripe along both flanks, 2x2 px 17 hivis_orange beacon near
the back of the cab roof, 25 navy windscreen band with a 27 sky highlight on its NW edge,
00/01 tyres peeking at the corners, a 1 px 14 rear door seam with 05 hinges.

Geometry is written in target pixels (1 px = 1/16 m) through ``px()``. At h00 every outer
edge sits on a whole pixel, so the 4x block reduction lands on the 28x52 body exactly.
Model space: metres, Z up, facing +Y (north), centred on the origin at ground level, every
part parented (directly or through the rear door) to the empty ``root``.

Render through the forge only:  npm run assets:blender -- veh.sweeper [--check]
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # assets-src/blender
import bmesh  # noqa: E402
import bpy  # noqa: E402
import rig  # noqa: E402

CELL_PX = 64
STATES = {"body": 1, "dented": 1}  # state -> frames per heading; forge blender expects exactly these frames


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


def block(name, x0, x1, y0, y1, z0, z1, mat, parent, bevel=1.25, sides="nesw"):
    """Box from px (x, y) and metre (z) extents with 45 deg chamfers on its top edges.

    ``bevel`` is the chamfer width in px; ``sides`` lists the edges (n, e, s, w) that are
    chamfered. A chamfer facing NW lands on the toon ramp's lit step and one facing SE on
    its dark step, which gives the 1 px light and dark bevels of ART_BIBLE §6.2.
    """
    x0, x1, y0, y1 = px(x0), px(x1), px(y0), px(y1)
    b = px(bevel)
    zm = z1 - b
    tx0 = x0 + (b if "w" in sides else 0.0)
    tx1 = x1 - (b if "e" in sides else 0.0)
    ty0 = y0 + (b if "s" in sides else 0.0)
    ty1 = y1 - (b if "n" in sides else 0.0)
    verts = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, zm), (x1, y0, zm), (x1, y1, zm), (x0, y1, zm),
        (tx0, ty0, z1), (tx1, ty0, z1), (tx1, ty1, z1), (tx0, ty1, z1),
    ]  # fmt: skip
    faces = [
        (0, 3, 2, 1),  # bottom
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),  # sides
        (4, 5, 9, 8), (5, 6, 10, 9), (6, 7, 11, 10), (7, 4, 8, 11),  # chamfers
        (8, 9, 10, 11),  # top
    ]  # fmt: skip
    return _object(name, verts, faces, mat, parent)


def tyre(name, x, y, mat, parent, radius=0.42, width=0.30, segments=16):
    """A tyre at (x, y) px: a cylinder on the X axis, standing on the ground."""
    cx, cy = px(x), px(y)
    ring = [(math.sin(2 * math.pi * k / segments), math.cos(2 * math.pi * k / segments)) for k in range(segments)]
    verts = [(cx + sx * width / 2, cy + s * radius, radius + c * radius) for sx in (-1, 1) for s, c in ring]
    n = segments
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    return _object(name, verts, faces, mat, parent)


def build() -> tuple[bpy.types.Object, dict, dict]:
    """Bessie at h00. Returns root plus the parts unique to the body and dented states."""
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    body = rig.toon_material("body", lit="lemon", base="sweeper_yellow", dark="ochre")
    cab = rig.toon_material("cab", lit="chalk", base="chalk", dark="kerb")
    glass = rig.toon_material("glass", lit="sky", base="navy", dark="navy")
    stripe = rig.toon_material("stripe", lit="sky", base="council_blue", dark="navy")
    beacon = rig.toon_material("beacon", lit="hivis_orange", base="hivis_orange", dark="hivis_orange")
    rubber = rig.toon_material("tyre", lit="tar", base="tar", dark="ink")
    steel = rig.toon_material("steel", lit="kerb", base="slab", dark="slab_dk")
    seam = rig.toon_material("seam", lit="ochre", base="ochre", dark="ochre")
    notch = rig.toon_material("notch", lit="tar", base="tar", dark="tar")

    # Running gear: a tar chassis (shows through the open door gap when dented) and four
    # tyres whose outer 1.5 px peek past the 25 px wide body at each corner.
    block("chassis_front", -12.5, 12.5, -13, 25, 0.30, 0.90, rubber, root, bevel=0)
    block("chassis_mid", -11, 12.5, -21.5, -13, 0.30, 0.90, rubber, root, bevel=0)
    block("chassis_rear", -12.5, 12.5, -25, -21.5, 0.30, 0.90, rubber, root, bevel=0)
    block("bumper", -12, 12, -25.5, -24, 0.40, 0.65, steel, root, bevel=0)  # under the door overhang
    for side in (-1, 1):
        for y in (17.0, -17.0):
            tyre(f"tyre_{'l' if side < 0 else 'r'}{'f' if y > 0 else 'r'}", side * 11.6, y, rubber, root)

    # Cab (front 14 px): chalk roof, windscreen band across the full width at the front,
    # beacon 2x2 px centred near the back of the roof.
    block("cab", -12.5, 12.5, 12, 26, 0.50, 1.95, cab, root, sides="esw")
    block("windscreen", -12.5, 12.5, 22.5, 26, 1.95, 2.03, glass, root, bevel=1.0)
    block("beacon", -1, 1, 13.25, 15.25, 1.95, 2.10, beacon, root, bevel=0)

    # Hopper (rear 38 px), built from flush blocks so the dented state can swap panels.
    block("hopper_front", -12.5, 12.5, -13, 12, 0.50, 2.20, body, root, sides="new")
    for x0, x1 in ((-11.25, -9.25), (9.25, 11.25)):  # 2 px flank stripes, inside the chamfers
        block(f"stripe_{'l' if x0 < 0 else 'r'}", x0, x1, -21.5, 11, 2.20, 2.21, stripe, root, bevel=0)
    door = block("door", -12.5, 12.5, -26, -21.5, 0.50, 2.20, body, root, sides="esw")
    block("door_seam", -11.25, 11.25, -22.75, -21.5, 2.20, 2.22, seam, door, bevel=0)
    for x in (-6.0, 6.0):
        block(f"hinge_{'l' if x < 0 else 'r'}", x - 0.75, x + 0.75, -23.25, -21.75, 2.21, 2.24, steel, door, bevel=0)

    panel_body = block("panel", -12.5, 12.5, -21.5, -13, 0.50, 2.20, body, root, sides="ew")

    # Dented (below 40 HP), literal offsets only: the rear-left panel pushed in 1.25 px and
    # crumpled into tilted facets with two notch pixels (14 ochre, 01 tar) on its edge, the
    # rear bumper's left corner dangling out past the body, and the rear door ajar by 1 px.
    # The corner is 4.5 px long (SSP-009): at 7 px its tip reached 33.5 px from the centre and
    # was clipped by the 64 px cell at the diagonals, leaving no room for the 1 px outline.
    panel_dent = block("panel_dent", -11.25, 12.5, -21.5, -13, 0.50, 2.20, body, root, sides="e")
    z = 2.20
    crumple = [
        (-11.25, -21.5, z + 0.01), (-9.0, -21.5, z + 0.01), (-6.5, -21.5, z + 0.01),
        (-11.25, -18.75, z + 0.03), (-9.25, -19.0, z + 0.16), (-6.5, -18.5, z + 0.01),
        (-11.25, -16.25, z + 0.12), (-8.75, -16.0, z + 0.02), (-6.5, -16.0, z + 0.01),
        (-11.25, -13.5, z + 0.01), (-9.0, -13.5, z + 0.09), (-6.5, -13.5, z + 0.01),
    ]  # fmt: skip
    crumple_faces = []
    for r in range(3):
        for c in range(2):
            a, b_, d, e = r * 3 + c, r * 3 + c + 1, (r + 1) * 3 + c, (r + 1) * 3 + c + 1
            crumple_faces += [(a, b_, e), (a, e, d)] if (r + c) % 2 == 0 else [(a, b_, d), (b_, e, d)]
    crumple_ob = _object("crumple", [(px(x), px(y), zz) for x, y, zz in crumple], crumple_faces, body, root)
    notch_a = block("notch_a", -11.25, -10.0, -15.5, -14.25, 2.30, 2.32, seam, root, bevel=0)
    notch_b = block("notch_b", -11.25, -10.0, -20.0, -18.75, 2.30, 2.32, notch, root, bevel=0)
    bumper_corner = block("bumper_corner", -15.0, -10.5, -25.75, -23.75, 0.40, 0.65, steel, root, bevel=0)
    _dangle(bumper_corner)

    body_only = {"panel": panel_body}
    dented_only = {
        "panel_dent": panel_dent,
        "crumple": crumple_ob,
        "notch_a": notch_a,
        "notch_b": notch_b,
        "bumper_corner": bumper_corner,
        "door": door,
    }
    return root, body_only, dented_only


def _dangle(ob: bpy.types.Object) -> None:
    """Rotate the bumper corner 35 deg about its inner end so it hangs out of the rear-left corner."""
    pivot_x, pivot_y = px(-10.5), px(-24.75)
    ang = math.radians(35.0)
    ca, sa = math.cos(ang), math.sin(ang)
    for v in ob.data.vertices:
        x, y, zz = v.co
        dx, dy = x - pivot_x, y - pivot_y
        v.co = (pivot_x + dx * ca - dy * sa, pivot_y + dx * sa + dy * ca, zz)
    ob.data.update()


def set_state(body_only: dict, dented_only: dict, dented: bool) -> None:
    for ob in body_only.values():
        ob.hide_render = dented
    for name, ob in dented_only.items():
        if name == "door":
            ob.location.y = px(-1.0) if dented else 0.0  # door ajar by 1 px
        else:
            ob.hide_render = not dented


def main() -> None:
    args = rig.parse_args()
    out = Path(args.out)
    scene = rig.reset_scene(CELL_PX, args.size, args.tilt)
    root, body_only, dented_only = build()

    set_state(body_only, dented_only, dented=False)
    rig.render_headings(scene, root, out, args.headings)

    set_state(body_only, dented_only, dented=True)
    rig.render_headings(scene, root, out, args.headings, prefix="dented_")

    rig.write_render_json(out, Path(__file__).resolve(), args, CELL_PX, args.headings)


main()
