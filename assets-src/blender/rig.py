"""Shared Blender rig for Street Sweeper Pro. Blender 5.2.2 LTS only.

Every asset script imports this module (ASSET_PIPELINE §7.2, §7.3). Changing it changes
script_sha256 for every render, so forge lint will ask for a full re-render.

Run asset scripts through the forge, never by hand for production renders:

    npm run assets:blender -- <asset-id> [--check]

Rules this module owns (ASSET_PIPELINE §7.2):

- orthographic camera straight down (+Y north = screen up), ortho_scale = cell metres
  at 16 px/m (CELL_PX / 16);
- square ``--size`` render at 100 %, film_transparent, view transform 'Standard' (never
  AgX or Filmic), look None, exposure 0, gamma 1, dither 0;
- EEVEE with taa_render_samples = 1 and filter_size = 0.0, PNG RGBA 8-bit;
- one sun at azimuth 315 deg (north-west), elevation 50 deg;
- unlit toon materials: dot(N, sun) -> CONSTANT ColorRamp with exact Kerbside-32 stops ->
  Emission. Colours are palette NAMES looked up in kerbside32.json; raw hex literals are
  forbidden in every bpy script;
- headings rotate the model root clockwise, never the camera; h00 = north;
- no shadow catchers or ground planes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections.abc import Callable
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
RIG_PATH = Path(__file__).resolve()
PALETTE = json.loads((REPO / "assets-src/palette/kerbside32.json").read_text(encoding="utf-8"))

BLENDER_VERSION = "5.2.2 LTS"
SUN_AZIMUTH_DEG = 315.0  # north-west, clockwise from north
SUN_ELEVATION_DEG = 50.0
# Toon thresholds, settled in SSP-008 from test renders. A flat top scores sin(50 deg) = 0.766
# -> base. A 45 deg chamfer at heading offset t from the sun azimuth scores 0.542 + 0.455 cos t,
# and at 32 headings t steps by 11.25 deg: 0.83 sits midway between t = 45 (0.863, lit) and
# t = 56.25 (0.795, base); 0.33 midway between t = 112.5 (0.368, base) and t = 123.75 (0.289, dark).
T_BASE, T_LIT = 0.33, 0.83
PX_PER_M = 16
CAMERA_DISTANCE_M = 50.0


def parse_args() -> argparse.Namespace:
    """The arguments after ``--`` that forge blender passes (ASSET_PIPELINE §7.1)."""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="rig")
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=256)
    p.add_argument("--headings", type=int, default=32)
    p.add_argument("--tilt", type=float, default=0.0)
    args = p.parse_args(argv)
    if args.size < 1 or args.headings < 1:
        p.error("--size and --headings must be >= 1")
    return args


def sun_vector() -> tuple[float, float, float]:
    """Unit vector pointing TOWARD the sun. +X east, +Y north, +Z up."""
    az, el = math.radians(SUN_AZIMUTH_DEG), math.radians(SUN_ELEVATION_DEG)
    return (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def pal(name: str) -> tuple[float, float, float, float]:
    """Linear RGBA for a Kerbside-32 colour name, so 'Standard' output reproduces the exact palette value."""
    entry = next((c for c in PALETTE["colors"] if c["name"] == name), None)
    if entry is None:
        raise KeyError(f"unknown Kerbside-32 colour name {name!r}")
    h = entry["hex"].lstrip("#")
    r, g, b = (_srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))
    return (r, g, b, 1.0)


def reset_scene(cell_px: int, size: int, tilt_deg: float) -> bpy.types.Scene:
    """Empty the file and build the camera, sun and render settings for one asset."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 1
    r = scene.render
    r.filter_size = 0.0
    r.film_transparent = True
    r.dither_intensity = 0.0
    r.resolution_x = r.resolution_y = size
    r.resolution_percentage = 100
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 15
    # No Date/Time/RenderTime/File/... text chunks, so an unchanged render is byte-identical.
    for prop in r.bl_rna.properties:
        if prop.identifier.startswith("use_stamp"):
            setattr(r, prop.identifier, False)
    vs = scene.view_settings
    vs.view_transform = "Standard"  # never AgX (the 5.x default) or Filmic
    vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0
    _assert_render_settings(scene, size)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cell_px / PX_PER_M  # cell metres: 32 px -> 2 m, 64 -> 4, 96 -> 6, 128 -> 8
    cam_data.clip_start = 0.1
    cam_data.clip_end = CAMERA_DISTANCE_M * 2.0
    cam = bpy.data.objects.new("cam", cam_data)
    t = math.radians(tilt_deg)
    # Keep the origin on the view axis at any tilt. 0 = straight down, +Y up on screen.
    cam.location = (0.0, -CAMERA_DISTANCE_M * math.sin(t), CAMERA_DISTANCE_M * math.cos(t))
    cam.rotation_euler = (t, 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_mode = "QUATERNION"
    # A sun light shines along its local -Z: point -Z away from the sun, i.e. along -sun_vector().
    sun.rotation_quaternion = (-Vector(sun_vector())).to_track_quat("-Z", "Y")
    scene.collection.objects.link(sun)
    return scene


def _assert_render_settings(scene: bpy.types.Scene, size: int) -> None:
    r, vs = scene.render, scene.view_settings
    checks = {
        "engine": (r.engine, "BLENDER_EEVEE"),
        "taa_render_samples": (scene.eevee.taa_render_samples, 1),
        "filter_size": (r.filter_size, 0.0),
        "film_transparent": (r.film_transparent, True),
        "dither_intensity": (r.dither_intensity, 0.0),
        "resolution": ((r.resolution_x, r.resolution_y, r.resolution_percentage), (size, size, 100)),
        "image": (
            (r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.color_depth),
            ("PNG", "RGBA", "8"),
        ),
        "view_transform": (vs.view_transform, "Standard"),
        "look": (vs.look, "None"),
        "exposure": (vs.exposure, 0.0),
        "gamma": (vs.gamma, 1.0),
    }
    bad = {k: got for k, (got, want) in checks.items() if got != want}
    if bad:
        raise RuntimeError(f"rig render settings did not stick: {bad}")


def toon_material(name: str, lit: str, base: str, dark: str) -> bpy.types.Material:
    """Unlit toon: dot(N, sun) -> constant ramp (exact palette stops) -> Emission.

    ``lit``, ``base`` and ``dark`` are Kerbside-32 colour names. dot < T_BASE -> dark,
    T_BASE..T_LIT -> base, >= T_LIT -> lit.
    """
    mat = bpy.data.materials.new(name)
    # Blender 5.x materials always have a node tree; setting use_nodes is deprecated.
    nt = mat.node_tree
    nt.nodes.clear()
    geom = nt.nodes.new("ShaderNodeNewGeometry")  # Normal output is world space
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = sun_vector()
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, pal(dark)
    els[1].position, els[1].color = T_BASE, pal(base)
    els.new(T_LIT).color = pal(lit)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(geom.outputs["Normal"], dot.inputs[0])
    nt.links.new(dot.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def heading_rad(i: int, headings: int) -> float:
    """Model-root Z rotation for heading ``i``: clockwise from north (Blender's +Z is counter-clockwise)."""
    return -math.radians(i * 360.0 / headings)


def render_headings(
    scene: bpy.types.Scene,
    root: bpy.types.Object,
    out: Path,
    headings: int,
    prefix: str = "",
    suffix: str = "",
    before_frame: Callable[[int], None] | None = None,
) -> None:
    """Render ``<prefix>hNN<suffix>.png`` for every heading by rotating ``root``, never the camera."""
    out.mkdir(parents=True, exist_ok=True)
    for i in range(headings):
        root.rotation_euler.z = heading_rad(i, headings)
        if before_frame:
            before_frame(i)
        scene.render.filepath = str(out / f"{prefix}h{i:02d}{suffix}.png")
        bpy.ops.render.render(write_still=True)


def script_sha256(script: Path) -> str:
    """sha256(asset script bytes + NUL + rig.py bytes): a rig change marks every render stale."""
    h = hashlib.sha256(Path(script).read_bytes())
    h.update(b"\0")
    h.update((REPO / "assets-src/blender/rig.py").read_bytes())
    return h.hexdigest()


def write_render_json(out: Path, script: Path, args: argparse.Namespace, cell_px: int, headings: int) -> None:
    """Write render.json (ASSET_PIPELINE §6.6). forge blender verifies it before the swap."""
    c = cell_px // 2
    tilt = float(args.tilt)
    (Path(out) / "render.json").write_text(
        json.dumps(
            {
                "blender_version": BLENDER_VERSION,
                "script_sha256": script_sha256(script),
                "argv": sys.argv[sys.argv.index("--") + 1 :],
                "tilt_deg": int(tilt) if tilt.is_integer() else tilt,
                "pivots_px": {f"h{i:02d}": [c, c] for i in range(headings)},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
