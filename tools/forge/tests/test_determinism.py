"""Determinism and acceptance checks over a real build of the committed M0 assets (SSP-009, SSP-010, SSP-014,
SSP-020, SSP-024, SSP-040, SSP-041, SSP-051, SSP-052, SSP-068, SSP-070, SSP-101).

Builds ``assets-src/manifest.json`` twice with the cache off, into two temp dirs, and checks
that every output file has the same SHA-256 (frames, atlas PNG/JSON, ``src/gen/assets.ts``,
``asset-hashes.json``, the font metrics); then inspects the built frames: 1,474 of them, 64x64 Bessie / 96x96
brush / the six 24x24 SSP-097 Monday people (104 frames each: 13 per direction, SE/E/NE mirrored) / 32x32 prop.lamp_post
(4 sprite-stack slices) / the 15 16x16 litter items (SSP-051: idle x1 + wobble x2 in the
h00/h08/h16/h24 rotations, 12 frames each, 180 in all; the banana skin is the D-07 sample) / the
SSP-041 Puddle Lane facade sets (64x80 lit/base/dark bays) and roof surfaces (32x32 variants) /
the SSP-040 ground tiles (32x32 variants, the 47 kerb blob tiles and the road-marking overlays),
the SSP-052 stains, grime overlays (32x32 ``v`` variants, world), pickups (16x16 ``bob`` x2), the
flat hydrant (32x32) and the site placeholders (64x96 depot bay, 64x32 skip) / the SSP-101 prop
grids (32x32 flats and slices), hazard decals and tile variants, cobbles and the other five power-ups /
the SSP-068 Kerbside 5x7 font (100 glyph + 100 outline frames, 7x9), Kerbside-32 colours only
with binary alpha, the outline rule, no metadata chunks, and a palette snap that changed 0
pixels; and the packed ``world``, ``actors``, ``items`` and ``ui`` atlases.
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge.build import BuildResult, build
from forge.outputs import ASSETS_TS, ATLAS_DIR, FONTS_DIR, HASHES_JSON
from forge.palette import REPO_ROOT, load_palette
from forge.pngio import FORBIDDEN_METADATA_CHUNKS, decode_indexed_png, png_chunk_types

PALETTE = load_palette()
FACADES = (
    "facade.corner_shop",
    "facade.depot_shed",
    "facade.flats_render",
    "facade.parade_brick",
    "facade.terrace_brick",
    "facade.terrace_brick_bay",
)
ROOF_VARIANTS = {"roof.depot": 1, "roof.felt": 4, "roof.slate": 4}
TILE_FRAMES = {
    "haz.open_manhole": 1,
    "haz.speed_bump": 2,
    "tile.apron": 4,
    "tile.asphalt": 6,
    "tile.cobbles": 4,
    "tile.double_yellow": 4,
    "tile.grass": 4,
    "tile.kerb": 47,
    "tile.lane_marking": 4,
    "tile.parking_bay": 4,
    "tile.pavement": 4,
    "tile.setts": 4,
    "tile.zebra": 2,
}
STAINS = {"stain.chalk_art": 3, "stain.gum": 3, "stain.milkshake": 2, "stain.oil": 2, "stain.splat": 2}
GRIME = {"tile.grime_asphalt": 4, "tile.grime_gutter": 4, "tile.grime_slab": 4}
"""SSP-052: ground decals, transparent where the ground shows through (never outlined)."""
HAZARDS = {"haz.broken_glass": 2, "haz.oil_slick": 2, "haz.pothole": 2, "haz.puddle": 2, "haz.wet_leaves": 2}
"""SSP-101: hazard ground decals (32x32 ``v`` frames, world, transparent where the ground shows through)."""
PICKUPS = (
    "collect.false_teeth",
    "collect.golden_crisp",
    "pwr.bacon_butty",
    "pwr.flask_of_tea",
    "pwr.hi_vis",
    "pwr.super_suction",
    "pwr.water_can",
    "pwr.wrench",
)
"""SSP-052 (and SSP-101's five other power-ups): 2 bob frames each, on a 1 px ground halo ring that is not
outlined (ART_BIBLE §8.5)."""
PROPS = {
    "prop.a_board": 4,
    "prop.bench": 1,
    "prop.bollard": 4,
    "prop.bus_shelter": 8,
    "prop.litter_bin": 4,
    "prop.market_stall": 8,
    "prop.phone_box": 4,
    "prop.planter": 1,
    "prop.post_box": 4,
    "prop.recycling_box": 1,
    "prop.roadworks_barrier": 4,
    "prop.shopping_trolley": 1,
    "prop.traffic_cone": 4,
    "prop.tree": 8,
    "prop.wheelie_bin": 4,
}
"""SSP-101: placeholder prop grids, 32x32 per frame (flat, or a stack of slices), items atlas, outlined."""
SITES = {"site.depot_bay": (64, 96), "site.skip": (64, 32)}
PANELS = ("ui.panel_council", "ui.panel_dark", "ui.panel_paper")
"""SSP-285: the placeholder 24x24 9-slice panels in the ui atlas, one frame each (sliced in code)."""
HUD_ART = {
    "ui.bar_fill": (66, 8),
    "ui.dump_ring": (20, 20),
    "ui.brush_meter": (64, 6),
    "ui.brush_needle": (3, 10),
    "ui.brush_state": (16, 16),
    "ui.offscreen_arrow": (11, 11),
}
"""SSP-070: the HUD's placeholder bar fill (1 frame) and dump-hold ring (9 fill steps) in the ui atlas; SSP-299:
the Brush-o-meter zones (3), its needle (1), the brush state badges and spin-up ring (2 + 9) and the off-screen
arrows (2 x 8 dirs)."""
OVERLAYS = ("tile.double_yellow", "tile.lane_marking", "tile.parking_bay", *STAINS, *GRIME, *HAZARDS)
"""World-atlas frames that are not opaque cells: road markings, stains, grime and hazard decals."""
GROUND_MARKINGS = ("site.depot_bay",)
"""Items-atlas frames painted on the ground (no ink outline, ART_BIBLE §6.3)."""
LITTER = tuple(
    f"litter.{name}"
    for name in (
        "banana_skin",
        "bin_bag",
        "chip_wrapper",
        "cigarette_butts",
        "crisp_packet",
        "dog_mess",
        "drink_can",
        "glass_bottle",
        "kebab_wrapper",
        "leaf_pile",
        "lolly_stick",
        "newspaper",
        "pizza_box",
        "plastic_bottle",
        "spilled_shopping",
    )
)
"""The 15 litter IDs (ENTITY_CATALOG §4.1), 12 frame IDs each."""
PEOPLE = ("npc.dog_walker", "npc.mum_pushchair", "npc.old_man_frame", "npc.old_woman", "npc.postie", "npc.shopper")
"""The SSP-097 Monday cast (24x24 placeholder grids; Doris keeps her SSP-014 ingested idle frames)."""
CELLS = {
    **{f: (64, 80) for f in FACADES},
    **{r: (32, 32) for r in ROOF_VARIANTS},
    **{t: (32, 32) for t in TILE_FRAMES},
    "font.kerbside5x7": (7, 9),
    **{p: (24, 24) for p in PANELS},
    **HUD_ART,
    **{t: (32, 32) for t in (*STAINS, *GRIME, *HAZARDS, *PROPS)},
    **{p: (16, 16) for p in PICKUPS},
    **SITES,
    "prop.hydrant": (32, 32),
    **{li: (16, 16) for li in LITTER},
    **{p: (24, 24) for p in PEOPLE},
    "prop.lamp_post": (32, 32),
    "veh.sweeper": (64, 64),
    "veh.sweeper_brush": (96, 96),
}
FRAME_COUNT = 1474
ATLAS_OF = {
    **{a: "world" for a in (*FACADES, *ROOF_VARIANTS, *TILE_FRAMES, *STAINS, *GRIME, *HAZARDS)},
    **{a: "items" for a in (*PICKUPS, *SITES, *PROPS, "prop.hydrant")},
    "font.kerbside5x7": "ui",
    **{p: "ui" for p in PANELS},
    **{h: "ui" for h in HUD_ART},
    **{li: "items" for li in LITTER},
    **{p: "actors" for p in PEOPLE},
    "prop.lamp_post": "items",
    "veh.sweeper": "actors",
    "veh.sweeper_brush": "actors",
}


HALO_RING = (
    ".....######.....",
    "...##......##...",
    "..#..........#..",
    ".#............#.",
    ".#............#.",
    "#..............#",
    "#..............#",
    "#..............#",
    "#..............#",
    "#..............#",
    "#..............#",
    ".#............#.",
    ".#............#.",
    "..#..........#..",
    "...##......##...",
    ".....######.....",
)
"""The 1 px pickup halo ring of the 16x16 cell (ART_BIBLE §8.5), as the SSP-052 grids draw it."""


def _halo_ring(rgba: np.ndarray) -> np.ndarray:
    """Opaque 16 lemon / 07 chalk pixels on the halo ring cells (where the icon does not cover it)."""
    ring = np.array([[c == "#" for c in row] for row in HALO_RING])
    colour = rgba[:, :, :3]
    lemon_or_chalk = np.zeros(ring.shape, dtype=bool)
    for i in (7, 16):
        lemon_or_chalk |= (colour == np.array(PALETTE.rgb[i], dtype=np.uint8)).all(axis=-1)
    return ring & lemon_or_chalk & (rgba[:, :, 3] == 255)


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture(scope="module")
def builds(tmp_path_factory: pytest.TempPathFactory) -> tuple[BuildResult, Path, Path]:
    a = tmp_path_factory.mktemp("a")
    b = tmp_path_factory.mktemp("b")
    result = build(repo_root=REPO_ROOT, out_root=a, use_cache=False)
    build(repo_root=REPO_ROOT, out_root=b, use_cache=False)
    return result, a, b


def test_two_builds_are_byte_identical(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, b = builds
    ha, hb = _hashes(a), _hashes(b)
    assert ha, "the build wrote nothing"
    assert ha == hb


def test_builds_all_m0_frames(builds: tuple[BuildResult, Path, Path]) -> None:
    result, a, _ = builds
    assert len(result.frames) == FRAME_COUNT
    counts = {aid: sum(1 for f in result.frames if f.asset_id == aid) for aid in CELLS}
    assert counts == {
        **{f: 3 for f in FACADES},
        **ROOF_VARIANTS,
        **TILE_FRAMES,
        "font.kerbside5x7": 200,
        **{p: 1 for p in PANELS},
        "ui.bar_fill": 1,
        "ui.dump_ring": 9,
        "ui.brush_meter": 3,
        "ui.brush_needle": 1,
        "ui.brush_state": 11,
        "ui.offscreen_arrow": 16,
        **STAINS,
        **GRIME,
        **HAZARDS,
        **PROPS,
        **{p: 2 for p in PICKUPS},
        **{s: 1 for s in SITES},
        "prop.hydrant": 1,
        **{li: 12 for li in LITTER},
        **{p: 104 for p in PEOPLE},
        "prop.lamp_post": 4,
        "veh.sweeper": 64,
        "veh.sweeper_brush": 128,
    }
    assert len(list((a / "frames").rglob("*.png"))) == FRAME_COUNT
    assert [f.frame_id for f in result.frames] == sorted(f.frame_id for f in result.frames)
    assert "veh.sweeper:body:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper:dented:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper_brush:brush:h07:2" in {f.frame_id for f in result.frames}
    assert "npc.old_woman:idle:s:0" in {f.frame_id for f in result.frames}
    assert "prop.lamp_post:slice:-:3" in {f.frame_id for f in result.frames}
    assert "font.kerbside5x7:outline:-:99" in {f.frame_id for f in result.frames}


def test_frames_are_cell_sized_kerbside32_with_binary_alpha(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, _ = builds
    pal = {tuple(int(v) for v in c) for c in PALETTE.rgb}
    for png in sorted((a / "frames").rglob("*.png")):
        asset_id = png.parent.name
        with Image.open(png) as im:
            assert im.size == CELLS[asset_id], png.name
            rgba = np.asarray(im.convert("RGBA"))
        alpha = rgba[:, :, 3]
        assert set(np.unique(alpha).tolist()) <= {0, 255}, png.name
        colours = {tuple(int(v) for v in c) for c in rgba[alpha == 255][:, :3]}
        assert colours and colours <= pal, png.name


def test_no_opaque_non_ink_pixel_touches_transparency(builds: tuple[BuildResult, Path, Path]) -> None:
    """ART_BIBLE §6.3 over the written PNGs; out-of-frame neighbours count as transparent.

    Tiling surfaces (facades, roofs, ground tiles) are not outlined (ART_BIBLE §6.3) and fill
    their cell, so they are checked for having no transparent pixel at all instead. The road
    markings, stains and grime (SSP-052) are ground overlays (never outlined) and are transparent
    elsewhere; so are the depot bay markings. A pickup's 1 px halo ring (16 or 07 on the ring
    cells, ART_BIBLE §8.5) is a ground marking too, so only its icon is checked. Font glyphs
    are UI text with their own 8-connected outline state (test_glyphs.py)."""
    _, a, _ = builds
    ink = tuple(int(v) for v in PALETTE.rgb[0])
    for png in sorted((a / "frames").rglob("*.png")):
        if png.parent.name in (*OVERLAYS, *GROUND_MARKINGS) or ATLAS_OF[png.parent.name] == "ui":
            continue
        if ATLAS_OF[png.parent.name] == "world":
            with Image.open(png) as im:
                assert (np.asarray(im.convert("RGBA"))[:, :, 3] == 255).all(), png.name
            continue
        with Image.open(png) as im:
            rgba = np.asarray(im.convert("RGBA"))
        clear = np.pad(rgba[:, :, 3] == 0, 1, constant_values=True)
        near_clear = clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]
        is_ink = (rgba[:, :, :3] == np.array(ink, dtype=np.uint8)).all(axis=-1)
        body = (rgba[:, :, 3] == 255) & ~is_ink
        if png.parent.name in PICKUPS:
            body &= ~_halo_ring(rgba)
        assert not (body & near_clear).any(), png.name


def test_palette_snap_changed_zero_pixels(builds: tuple[BuildResult, Path, Path]) -> None:
    result, _, _ = builds
    zero = {aid: 0 for aid in CELLS}
    assert {a.entry.id: a.snap_changed_px for a in result.assets} == zero
    assert {a.entry.id: a.source_off_palette_px for a in result.assets} == zero
    assert all(f.snap_changed_px == 0 for f in result.frames)


def test_pngs_have_no_metadata_chunks(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, _ = builds
    for png in sorted(a.rglob("*.png")):
        data = png.read_bytes()
        chunks = set(png_chunk_types(data))
        assert not chunks & FORBIDDEN_METADATA_CHUNKS, png.name
        assert chunks <= {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}, png.name
        with Image.open(io.BytesIO(data)) as im:
            assert set(im.info) == {"transparency"}, png.name


def test_pivots_body_centre_for_vehicles_and_feet_for_people(builds: tuple[BuildResult, Path, Path]) -> None:
    """Vehicles and the lamp post's slices take the cell centre from render.json (slices through the
    h00 fallback, SSP-020); the pedestrian grid pivots on its feet, row 22 of the 24x24 cell
    (ART_BIBLE §4.4, §7.2; SSP-018). Font frames pivot on the glyph's top-left, (1, 1) (SSP-068)."""
    result, _, _ = builds
    special = {**{p: (12, 22) for p in PEOPLE}, "font.kerbside5x7": (1, 1)}
    for f in result.frames:
        w, h = CELLS[f.asset_id]
        expected = special.get(f.asset_id, (w // 2, h // 2))
        assert f.pivot == expected, f.frame_id
        assert f.atlas == ATLAS_OF[f.asset_id]


def test_old_woman_mirrors_and_feet_on_the_pivot_row(builds: tuple[BuildResult, Path, Path]) -> None:
    """SSP-014/SSP-097: SE/E/NE are left-right flips of SW/W/NW, and every figure fits 18x22 with
    its feet (lowest opaque row) on row 22, row 23 clear (ART_BIBLE §7.2)."""
    result, _, _ = builds
    by_id = {f.frame_id: f.indices for f in result.frames if f.asset_id in PEOPLE}
    for fid in [f for f in by_id if f.split(":")[2] in ("sw", "w", "nw")]:
        aid, state, src, n = fid.split(":")
        dst = {"sw": "se", "w": "e", "nw": "ne"}[src]
        np.testing.assert_array_equal(by_id[f"{aid}:{state}:{dst}:{n}"], by_id[fid][:, ::-1])
    for fid, idx in by_id.items():
        ys, xs = np.nonzero(idx != -1)
        assert ys.max() == 22, fid
        assert xs.max() - xs.min() + 1 <= 18 and ys.max() - ys.min() + 1 <= 22, fid


def test_two_clean_builds_give_byte_identical_atlas_png_and_json(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, b = builds
    outputs = [
        f"{ATLAS_DIR}/world.png",
        f"{ATLAS_DIR}/world.json",
        f"{ATLAS_DIR}/actors.png",
        f"{ATLAS_DIR}/actors.json",
        f"{ATLAS_DIR}/items.png",
        f"{ATLAS_DIR}/items.json",
        f"{ATLAS_DIR}/ui.png",
        f"{ATLAS_DIR}/ui.json",
        f"{FONTS_DIR}/kerbside5x7.json",
        ASSETS_TS,
        HASHES_JSON,
    ]
    for rel in outputs:
        assert (a / rel).is_file(), rel
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel
    # The world (SSP-041 facades and roofs), actors, items and ui (SSP-068 font) atlases have frames;
    # an atlas with no frames (fx) is not emitted.
    names = sorted(p.name for p in (a / ATLAS_DIR).iterdir())
    assert names == [
        "actors.json",
        "actors.png",
        "items.json",
        "items.png",
        "ui.json",
        "ui.png",
        "world.json",
        "world.png",
    ]


@pytest.mark.parametrize(("name", "count"), [("world", 151), ("actors", 816), ("items", 263), ("ui", 244)])
def test_atlas_holds_every_frame_at_its_rect(
    builds: tuple[BuildResult, Path, Path], name: str, count: int
) -> None:
    result, a, _ = builds
    assert [x.name for x in result.atlases] == ["world", "actors", "items", "ui"]
    atlas = next(x for x in result.atlases if x.name == name)
    frames = [f for f in result.frames if f.atlas == name]
    assert len(atlas.frames) == len(frames) == count
    assert atlas.width <= 2048 and atlas.height <= 2048
    pixels = decode_indexed_png((a / ATLAS_DIR / f"{name}.png").read_bytes(), PALETTE)
    assert pixels.shape == (atlas.height, atlas.width)
    doc = json.loads((a / ATLAS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    assert set(doc) == {"frames", "swaps"} and doc["swaps"] == {}
    assert list(doc["frames"]) == sorted(f.frame_id for f in frames)
    by_id = {f.frame_id: f for f in frames}
    for fid, r in doc["frames"].items():
        f = by_id[fid]
        assert (r["w"], r["h"]) == (f.width, f.height)
        assert (r["px"], r["py"]) == f.pivot
        np.testing.assert_array_equal(pixels[r["y"] : r["y"] + r["h"], r["x"] : r["x"] + r["w"]], f.indices)
