"""Spike helper for SSP-024 (D-02): build Bessie's 8-degree renders into a TEMPORARY actors atlas under build/.

Run by ``node tools/spikes/lookDecisions.ts`` (or by hand) as::

    uv run --project tools/forge python tools/spikes/tilt8Atlas.py

Input: the raw ASSET_PIPELINE §7.1 Blender renders at ``--tilt 8`` in ``build/tmp/tilt8/veh.sweeper`` and
``build/tmp/tilt8/veh.sweeper_brush`` (lookDecisions.ts runs the raw command when they are missing). Nothing under
``assets-src/`` or ``public/`` is read for writing or touched: the committed 0-degree renders stay the only
approved ones (CLAUDE.md hard rule 4, the issue's "never overwrite assets-src/rendered/ with an unapproved tilt").

1. Copy each render folder to ``build/tmp/tilt8/clipped/<id>/``. At 8 degrees the camera sits south of the
   model, so Bessie's 2.2 m hopper projects about 5 px further north than at 0 degrees, and at 16 of the 32
   body headings (h01-h04, h12-h15, h17-h20, h28-h31; 19 dented frames) her top edge reaches the 64 px cell's
   first row, where ``forge build`` cannot complete the 1 px outline (measured in SSP-024: 1-8 px per body
   frame, up to 26 for dented h16). The spike clears the outermost target-pixel ring (4 render pixels) of every
   render and reports how many target pixels that removed per frame; the headings in the frozen lean_quadrants
   frames (h00, h08, h16, h24 at tick 0; h08, h16, h24, h00 at tick 120) lose none.
2. Write ``build/tmp/tilt8/manifest.json``: the committed manifest with the two Bessie sources pointed at the
   clipped folders.
3. ``forge.build.build`` (no cache) into ``build/tmp/tilt8/out/``: frames, atlases, generated outputs.
4. Report as JSON: clipped pixels, whether the 8-degree ``actors.json`` is byte-identical to the committed one
   (it must be, so the shipping bundle's FRAME table can draw the 8-degree atlas when only actors.png is
   swapped), and the opaque bounding box of every Bessie body frame at 0 and 8 degrees.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "forge"))

from forge.build import build  # noqa: E402

TMP = REPO / "build" / "tmp" / "tilt8"
IDS = ("veh.sweeper", "veh.sweeper_brush")
RENDER_SCALE = 4
"""Renders are 4x the target cell (ASSET_PIPELINE §7.1)."""


def clip_ring(src: Path, dst: Path) -> dict[str, int]:
    """Copy ``src`` to ``dst`` with the outermost target-pixel ring made transparent; returns cleared px per frame."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    cleared: dict[str, int] = {}
    for path in sorted(src.iterdir()):
        if path.suffix != ".png":
            if path.is_file():
                shutil.copyfile(path, dst / path.name)
            continue
        with Image.open(path) as im:
            rgba = np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()
        size = rgba.shape[0]
        r = RENDER_SCALE
        ring = np.zeros(rgba.shape[:2], dtype=bool)
        ring[:r, :] = ring[-r:, :] = ring[:, :r] = ring[:, -r:] = True
        # Target pixels in the ring with any opaque render pixel.
        opaque = rgba[:, :, 3] >= 128
        blocks = (opaque & ring).reshape(size // r, r, size // r, r).any(axis=(1, 3))
        n = int(blocks.sum())
        if n:
            cleared[path.stem] = n
        rgba[ring] = 0
        Image.fromarray(rgba, "RGBA").save(dst / path.name, format="PNG", optimize=False, compress_level=9)
    return cleared


def body_bboxes(folder: Path) -> dict[str, list[int]]:
    """Opaque bounding box [x0, y0, x1, y1] (target px, inclusive) of each body render, from its pixel centres."""
    out: dict[str, list[int]] = {}
    for path in sorted(folder.glob("h*.png")):
        with Image.open(path) as im:
            a = np.asarray(im.convert("RGBA"), dtype=np.uint8)
        s = a[RENDER_SCALE // 2 :: RENDER_SCALE, RENDER_SCALE // 2 :: RENDER_SCALE, 3] >= 128
        ys, xs = np.nonzero(s)
        out[path.stem] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    return out


def main() -> int:
    report: dict[str, object] = {}
    for asset_id in IDS:
        src = TMP / asset_id
        if not (src / "render.json").is_file():
            print(f"tilt8Atlas: {src} has no render.json; run the raw Blender command first", file=sys.stderr)
            return 1
        meta = json.loads((src / "render.json").read_text(encoding="utf-8"))
        if meta.get("tilt_deg") != 8:
            print(f"tilt8Atlas: {src}/render.json tilt_deg is {meta.get('tilt_deg')!r}, not 8", file=sys.stderr)
            return 1
        report[f"{asset_id}.clippedPx"] = clip_ring(src, TMP / "clipped" / asset_id)

    manifest = json.loads((REPO / "assets-src" / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["assets"]:
        if entry["id"] in IDS:
            entry["source"] = (TMP / "clipped" / entry["id"]).relative_to(REPO).as_posix()
    manifest_path = TMP / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    out = TMP / "out"
    if out.exists():
        shutil.rmtree(out)
    result = build(manifest_path=manifest_path, repo_root=REPO, out_root=out, use_cache=False)
    report["snapChangedPx"] = result.snap_changed_px
    built = out / "public" / "assets" / "atlas"
    committed = REPO / "public" / "assets" / "atlas"
    report["actorsJsonIdentical"] = (built / "actors.json").read_bytes() == (committed / "actors.json").read_bytes()
    report["itemsPngIdentical"] = (built / "items.png").read_bytes() == (committed / "items.png").read_bytes()
    report["actorsPng"] = (built / "actors.png").relative_to(REPO).as_posix()
    report["bodyBBox0"] = body_bboxes(REPO / "assets-src" / "rendered" / "veh.sweeper")
    report["bodyBBox8"] = body_bboxes(TMP / "veh.sweeper")
    print(json.dumps(report, indent=2))
    return 0 if report["actorsJsonIdentical"] else 1


if __name__ == "__main__":
    sys.exit(main())
