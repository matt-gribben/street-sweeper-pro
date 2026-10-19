"""One-off generator for placeholder human grids (SSP-098, the Tuesday cast).

Emits ``assets-src/sprites/npc/<name>.sprite.txt`` for ``npc.businessman``, ``npc.litterbug`` and
``npc.market_trader``: 24x24 cells, S/SW/W/NW/N authored with mirror lines for SE/E/NE, and the 13
frames per direction of ART_BIBLE §7.1 (walk 4, idle 2, startle 2, fall 3, angry 2), so 65 authored
frames and 104 frame IDs each. The committed ``.sprite.txt`` files are the source of truth, not this
script: once a grid is hand-edited, never re-run the script over it. It is kept so the remaining
adult placeholders can reuse the templated body, poses and colour keys.

Run from the repo root::

    uv run --project tools/forge python tools/sprites/placeholder_people.py [--write] [id ...]

Without ``--write`` it only prints the bounds report (figure bounding box per frame, ink
outline included; ART_BIBLE §7.2 wants <= 18x22 with the feet on row 22).

Drawing model: each frame is drawn as colour roles on an empty cell (far limbs, torso, near
limbs, head, props), the roles are mapped through the character's colour key, and then every
transparent pixel 4-adjacent to a non-ink pixel becomes ink (index 00), which is the 1 px outside
outline of ART_BIBLE §6.3 (the manifest says ``outline: false`` because the grid carries it).
Shading is top-lit only (§6.2): far limbs and lower garments take the shade step, so the
SE/E/NE mirrors stay correct.

Pose conventions (ART_BIBLE §7.2, §8.3, §10.2):

- Adult build: head 8 (hair 3 with the top outline, face 4, chin 1), torso 7, legs 7, i.e. rows 1-22.
  The pivot is the bottom-centre of the feet on row 22; row 23 stays clear.
- startle 0 is the hop, so the whole body is raised 1 px (feet on row 21); startle 1 is the
  sidestep with the arms still up.
- fall 0 tips back with the arms flung up, fall 1 sits down hard, fall 2 lies flat with the legs
  in the air (comic, never hurt: the dizzy star is ``fx.impact_star`` at runtime).
- angry raises a fist above the head (the body squats 1 px so the fist clears the head and the
  figure stays 22 px tall); frame 1 is the shake.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt

CELL = 24
T = -1  # transparent
INK = 0
REPO = Path(__file__).resolve().parents[2]
NPC_DIR = REPO / "assets-src" / "sprites" / "npc"

DIRS = ("s", "sw", "w", "nw", "n")
STATES = (("walk", 4), ("idle", 2), ("startle", 2), ("fall", 3), ("angry", 2))
MIRRORS = (("se", "sw"), ("e", "w"), ("ne", "nw"))
KEY = ".0123456789abcdefghijklmnopqrstuv"  # default key: '.' then indices 00-31

IntArray = npt.NDArray[np.int16]
Point = tuple[int, int]


# --------------------------------------------------------------------------------------------
# Canvas


class Canvas:
    """A 24x24 grid of colour roles (strings), drawn back to front."""

    def __init__(self) -> None:
        self.roles: list[list[str | None]] = [[None] * CELL for _ in range(CELL)]

    def px(self, x: int, y: int, role: str) -> None:
        if 0 <= x < CELL and 0 <= y < CELL:
            self.roles[y][x] = role

    def rect(self, x0: int, y0: int, x1: int, y1: int, role: str) -> None:
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.px(x, y, role)

    def line(self, pts: list[Point], w: int, role: str) -> None:
        """A polyline of w x w squares anchored at their top-left pixel (Bresenham per segment)."""
        for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
            for x, y in _bresenham(x0, y0, x1, y1):
                self.rect(x, y, x + w - 1, y + w - 1, role)
        if len(pts) == 1:
            x, y = pts[0]
            self.rect(x, y, x + w - 1, y + w - 1, role)

    def stamp(self, rows: list[str], x: int, y: int, roles: dict[str, str]) -> None:
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != ".":
                    self.px(x + i, y + j, roles[ch])


def _bresenham(x0: int, y0: int, x1: int, y1: int) -> list[Point]:
    pts: list[Point] = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            return pts
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def outline(a: IntArray) -> IntArray:
    """Ink every transparent pixel 4-adjacent to a non-ink opaque pixel (ART_BIBLE §6.3)."""
    body = np.pad((a != T) & (a != INK), 1, constant_values=False)
    near = body[:-2, 1:-1] | body[2:, 1:-1] | body[1:-1, :-2] | body[1:-1, 2:]
    out = a.copy()
    out[(a == T) & near] = INK
    return out


# --------------------------------------------------------------------------------------------
# Heads: per character and view, 7 rows. Characters: R hair, H hat/hood, h hat/hood shade,
# C cap peak, S skin, s skin shade, E eye, M mouth (closed: skin shade), m extra open-mouth
# pixel (skin when closed), B brow pixel (skin unless angry).

HEAD_ROLES = {
    "R": "hair",
    "H": "hat",
    "h": "hat_sh",
    "C": "peak",
    "S": "skin",
    "s": "skin_sh",
    "E": "eye",
    "M": "mouth",
    "m": "skin",
    "B": "skin",
}


@dataclass(frozen=True)
class Head:
    rows: dict[str, list[str]]  # view -> 7 rows

    def width(self, view: str) -> int:
        return len(self.rows[view][0])


# --------------------------------------------------------------------------------------------
# Characters


@dataclass(frozen=True)
class Character:
    asset_id: str
    name: str
    head: Head
    colours: dict[str, int]
    torso: Callable[[Canvas, str, int, int], None]  # (canvas, view, dx, dy) garment details
    seam: int | None = None  # replaces interior ink (ART_BIBLE 6.3) when the key cannot spare 00
    special_arm: str | None = None  # "phone" or "pocket": which arm gets the special pose
    idle: str = "plain"  # "phone", "pocket", "calling"
    walk_head_down: bool = False
    comments: list[str] = field(default_factory=list)


# Torso boxes per view (x0, x1); rows 9-15 at dy 0.
TORSO_X = {"s": (8, 15), "n": (8, 15), "sw": (8, 14), "nw": (8, 14), "w": (9, 14)}
# Head centre column per view (the head is placed at centre - width // 2).
HEAD_CX = {"s": 12, "n": 12, "sw": 11, "nw": 11, "w": 11}
# Shoulder anchors (top-left of a 2 px arm) for the screen-left and screen-right arm.
SHOULDER = {"s": (6, 16), "n": (6, 16), "sw": (6, 15), "nw": (6, 15), "w": (11, 11)}
# Leg columns (x0, x1) for the screen-left and screen-right leg in the front-ish views.
LEGS = {"s": ((8, 10), (13, 15)), "n": ((8, 10), (13, 15)), "sw": ((8, 10), (12, 14)), "nw": ((8, 10), (12, 14))}
BACK = {"n", "nw"}


def _businessman_torso(c: Canvas, view: str, dx: int, dy: int) -> None:
    x0, x1 = TORSO_X[view]
    if view == "s":
        c.rect(10 + dx, 9 + dy, 13 + dx, 9 + dy, "shirt")
        c.rect(10 + dx, 10 + dy, 10 + dx, 10 + dy, "shirt")
        c.rect(13 + dx, 10 + dy, 13 + dx, 10 + dy, "shirt")
        c.rect(11 + dx, 10 + dy, 12 + dx, 12 + dy, "tie")
    elif view == "sw":
        c.rect(9 + dx, 9 + dy, 12 + dx, 9 + dy, "shirt")
        c.rect(9 + dx, 10 + dy, 9 + dx, 10 + dy, "shirt")
        c.rect(12 + dx, 10 + dy, 12 + dx, 10 + dy, "shirt")
        c.rect(10 + dx, 10 + dy, 11 + dx, 12 + dy, "tie")
    elif view == "w":
        c.rect(x0 + dx, 9 + dy, x0 + 1 + dx, 9 + dy, "shirt")
        c.rect(x0 + dx, 10 + dy, x0 + dx, 12 + dy, "tie")
    else:  # back views: a shirt collar line above the jacket
        c.rect(x0 + 2 + dx, 9 + dy, x1 - 2 + dx, 9 + dy, "shirt")
    c.rect(x0 + dx, 15 + dy, x1 + dx, 15 + dy, "top_sh")


def _litterbug_torso(c: Canvas, view: str, dx: int, dy: int) -> None:
    x0, x1 = TORSO_X[view]
    if view == "s":
        c.px(10 + dx, 9 + dy, "string")
        c.px(13 + dx, 9 + dy, "string")
        c.rect(9 + dx, 12 + dy, 14 + dx, 13 + dy, "top_sh")  # pouch pocket
    elif view == "sw":
        c.px(9 + dx, 9 + dy, "string")
        c.px(12 + dx, 9 + dy, "string")
        c.rect(8 + dx, 12 + dy, 12 + dx, 13 + dy, "top_sh")
    elif view == "w":
        c.px(x0 + dx, 9 + dy, "string")
        c.rect(x0 + dx, 12 + dy, x0 + 2 + dx, 13 + dy, "top_sh")
    c.rect(x0 + dx, 15 + dy, x1 + dx, 15 + dy, "top_sh")  # ribbed hem


def _apron_stripes(c: Canvas, x0: int, x1: int, y0: int, y1: int) -> None:
    for x in range(x0, x1 + 1):
        c.rect(x, y0, x, y1, "apron_b" if x % 2 else "apron_a")


def _trader_torso(c: Canvas, view: str, dx: int, dy: int) -> None:
    x0, x1 = TORSO_X[view]
    if view == "s":
        _apron_stripes(c, 9 + dx, 14 + dx, 10 + dy, 15 + dy)
        c.px(9 + dx, 9 + dy, "apron_a")  # neck strap
        c.px(14 + dx, 9 + dy, "apron_a")
    elif view == "sw":
        _apron_stripes(c, 8 + dx, 12 + dx, 10 + dy, 15 + dy)
        c.px(8 + dx, 9 + dy, "apron_a")
        c.px(12 + dx, 9 + dy, "apron_a")
    elif view == "w":
        _apron_stripes(c, x0 + dx, x0 + 1 + dx, 10 + dy, 15 + dy)
    else:  # back: the apron ties across the small of the back
        c.rect(x0 + dx, 13 + dy, x1 + dx, 13 + dy, "apron_a")
        cx = (x0 + x1) // 2 + dx
        c.px(cx, 14 + dy, "apron_a")
        c.px(cx + 1, 14 + dy, "apron_a")


def _trader_apron_skirt(c: Canvas, view: str, dx: int, dy: int, bottom: int) -> None:
    """The apron hangs over the thighs to row 18 (front-ish views only)."""
    if view in BACK:
        x0, x1 = TORSO_X[view]
        c.rect(x0 + dx, 16 + dy, x0 + dx, min(bottom, 18 + dy), "apron_a")
        c.rect(x1 + dx, 16 + dy, x1 + dx, min(bottom, 18 + dy), "apron_a")
        return
    if view == "s":
        _apron_stripes(c, 8 + dx, 15 + dx, 16 + dy, min(bottom, 18 + dy))
    elif view == "sw":
        _apron_stripes(c, 7 + dx, 13 + dx, 16 + dy, min(bottom, 18 + dy))
    else:
        _apron_stripes(c, 8 + dx, 10 + dx, 16 + dy, min(bottom, 18 + dy))


BUSINESSMAN_HEAD = Head(
    {
        "s": [
            ".RRRRRR.",
            "RRRRRRRR",
            "RSBSSBSR",
            "SSESSESS",
            "SSSSSSSS",
            "sSSMmSSs",
            ".ssssss.",
        ],
        "sw": [
            ".RRRRRR.",
            "RRRRRRRR",
            "SBSSBSRR",
            "SESSESsR",
            "SSSSSSsR",
            "SSMmSSsR",
            ".ssssss.",
        ],
        "w": [
            "..RRRRR.",
            ".RRRRRRR",
            ".SBSRRRR",
            ".SESsRRR",
            "SSSSsRRR",
            ".MmSsRR.",
            "..ssss..",
        ],
        "nw": [
            ".RRRRRR.",
            "RRRRRRRR",
            "RRRRRRRR",
            "sRRRRRRR",
            "SsRRRRRR",
            "SsRRRRRR",
            ".ssRRRR.",
        ],
        "n": [
            ".RRRRRR.",
            "RRRRRRRR",
            "RRRRRRRR",
            "RRRRRRRR",
            "sRRRRRRs",
            "RRRRRRRR",
            ".ssssss.",
        ],
    }
)

LITTERBUG_HEAD = Head(
    {
        "s": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "HHCCCCCCHH",
            "HhSESSEShH",
            "HhSSSSSShH",
            "HhsSMmSshH",
            "HHhsssshHH",
        ],
        "sw": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "CCCCCChHHH",
            ".SESSEhHHH",
            ".SSSSShHHH",
            ".sSMmshHHH",
            "..hssshHH.",
        ],
        "w": [
            "...HHHHHH.",
            "..HHHHHHHH",
            "CCCChHHHHH",
            ".SEShHHHHH",
            ".SSShHHHHH",
            ".Mmshhhhhh",
            "..hhHHHHH.",
        ],
        "nw": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "CCHHHHHHHH",
            "hHHHHHHHHH",
            "hHHHHHHHHH",
            ".hHHHHHHHH",
            "..HHHHHHH.",
        ],
        "n": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "HHHHHHHHHH",
            "HHHHhhHHHH",
            "HHHHHHHHHH",
            "hHHHHHHHHh",
            ".hHHHHHHh.",
        ],
    }
)

TRADER_HEAD = Head(
    {
        "s": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "hhhhhhhhhh",
            ".RSESSESR.",
            ".RSSSSSSR.",
            ".sSSMmSSs.",
            "..ssssss..",
        ],
        "sw": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "hhhhhhhHH.",
            ".SESSERRR.",
            ".SSSSSsRR.",
            ".SSMmSsR..",
            "..ssssss..",
        ],
        "w": [
            "...HHHHHH.",
            "..HHHHHHHH",
            "hhhhhHHHHH",
            "..ESSsRRR.",
            ".SSSSsRRR.",
            "..MmSsRR..",
            "..sssss...",
        ],
        "nw": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            "hhHHHHHHHH",
            ".sRRRRRRR.",
            ".SsRRRRRR.",
            "..sRRRRR..",
            "..ssssss..",
        ],
        "n": [
            "..HHHHHH..",
            ".HHHHHHHH.",
            ".HHHHHHHH.",
            ".RRRRRRRR.",
            ".sRRRRRRs.",
            "..RRRRRR..",
            "..ssssss..",
        ],
    }
)


BUSINESSMAN = Character(
    asset_id="npc.businessman",
    name="businessman",
    head=BUSINESSMAN_HEAD,
    colours={
        "hair": 8, "hat": 8, "hat_sh": 8, "peak": 8,
        "skin": 12, "skin_sh": 11, "eye": 8, "mouth": 11, "mouth_open": 8, "brow": 8,
        "top": 3, "top_sh": 2, "sleeve": 2, "sleeve_far": 2, "hand": 12,
        "leg": 3, "leg_far": 2, "shoe": 8,
        "shirt": 7, "tie": 18, "phone": 5,
    },
    torso=_businessman_torso,
    seam=2,
    special_arm="phone",
    idle="phone",
    comments=[
        "suit 03 jacket and trousers / 02 sleeves, hem and leg seams, shirt 07, tie 18, hair and shoes 08,",
        "skin 12/11.",
        "Phone 05 with its 00 ink outline, held at the ear by his left hand in walk, idle and angry",
        "(the arm-to-ear silhouette, ART_BIBLE 7.2); startled or falling, the phone stays in the",
        "flung-up hand. Eyes are 08, not",
        "00/01: the key already spends four neutral steps (02, 03, 05, 07), and interior ink would",
        "be a fifth (ART_BIBLE 5.4, forge lint 'ramps'), so gaps inside the silhouette (between the legs,",
        "inside the elbow) are 02 rather than ink (ART_BIBLE 6.3: interior lines use the darker step).",
    ],
)

LITTERBUG = Character(
    asset_id="npc.litterbug",
    name="litterbug",
    head=LITTERBUG_HEAD,
    colours={
        "hair": 4, "hat": 4, "hat_sh": 3, "peak": 18,
        "skin": 12, "skin_sh": 11, "eye": 0, "mouth": 11, "mouth_open": 0, "brow": 0,
        "top": 4, "top_sh": 3, "sleeve": 3, "sleeve_far": 3, "hand": 12,
        "leg": 26, "leg_far": 25, "shoe": 7, "string": 7,
    },
    torso=_litterbug_torso,
    special_arm="pocket",
    idle="pocket",
    walk_head_down=True,
    comments=[
        "hoodie 04 / 03 shade, cap peak 18 under the raised hood, jeans 26 / 25, trainers and",
        "drawstrings 07, skin 12/11, eyes 00. Hood up and hands in the pouch pocket in walk and idle;",
        "the walk frames keep the head down 1 px, so the slink-off after a Caught! reuses them.",
    ],
)

MARKET_TRADER = Character(
    asset_id="npc.market_trader",
    name="market_trader",
    head=TRADER_HEAD,
    colours={
        "hair": 8, "hat": 3, "hat_sh": 2, "peak": 2,
        "skin": 12, "skin_sh": 11, "eye": 0, "mouth": 11, "mouth_open": 0, "brow": 0,
        "top": 22, "top_sh": 21, "sleeve": 22, "sleeve_far": 21, "hand": 12,
        "leg": 13, "leg_far": 13, "shoe": 8,
        "apron_a": 26, "apron_b": 7,
    },
    torso=_trader_torso,
    idle="calling",
    comments=[
        "flat cap 03 / 02 brim, striped apron 26/07 over a 22 / 21 jumper, trousers 13, hair",
        "(sideburns) and boots 08, skin 12/11, eyes 00. Idle is calling out: frame 0 cups a hand",
        "to the open mouth, frame 1 waves the other arm up.",
    ],
)

CHARACTERS = {c.asset_id: c for c in (BUSINESSMAN, LITTERBUG, MARKET_TRADER)}


# --------------------------------------------------------------------------------------------
# Poses


@dataclass
class Pose:
    dy: int = 0  # body (head, torso, shoulders, hips) vertical offset
    dx: int = 0  # body lean
    head_dx: int = 0
    head_dy: int = 0
    mouth: str = "closed"  # closed | open
    brows: bool = False
    eye_dx: int = 0
    # Arms: hand target (top-left of the 2 px hand) per side, absolute at dy 0; None = default.
    # A value is ("hang"|"fwd"|"back"|"up"|"up_hi"|"fist"|"fist_shake"|"flail"|..., ) keyword.
    arm_l: str = "hang"
    arm_r: str = "hang"
    # Legs: (x shift, foot row) per side; foot row is absolute (the shoe row).
    leg_l: tuple[int, int] = (0, 21)
    leg_r: tuple[int, int] = (0, 21)
    layout: str = "stand"  # stand | sit | lie


def generic_pose(view: str, state: str, n: int) -> Pose:
    if state == "walk":
        # 0 / 2 contact (left / right leg forward), 1 / 3 passing (the other foot lifted).
        if view == "w":
            return [
                Pose(arm_l="fwd_far", arm_r="back", leg_l=(-3, 21), leg_r=(3, 21)),
                Pose(arm_l="hang", arm_r="hang", leg_l=(1, 20), leg_r=(0, 21)),
                Pose(arm_l="back_far", arm_r="fwd", leg_l=(3, 21), leg_r=(-3, 21)),
                Pose(arm_l="hang", arm_r="hang", leg_l=(0, 21), leg_r=(1, 20)),
            ][n]
        return [
            Pose(arm_l="back", arm_r="fwd", leg_l=(0, 21), leg_r=(0, 20)),
            Pose(arm_l="hang", arm_r="hang", leg_l=(0, 21), leg_r=(0, 19)),
            Pose(arm_l="fwd", arm_r="back", leg_l=(0, 20), leg_r=(0, 21)),
            Pose(arm_l="hang", arm_r="hang", leg_l=(0, 19), leg_r=(0, 21)),
        ][n]
    if state == "idle":
        return [Pose(), Pose(head_dy=1 if view in BACK else 0, eye_dx=-1)][n]
    if state == "startle":
        if n == 0:  # the hop: everything 1 px up, feet together off the ground
            return Pose(dy=-1, mouth="open", arm_l="up_hi", arm_r="up_hi", leg_l=(0, 20), leg_r=(0, 20))
        return Pose(mouth="open", arm_l="up", arm_r="up", leg_l=(-1, 21), leg_r=(1, 21))
    if state == "fall":
        if n == 0:
            return Pose(dx=1, head_dx=1, mouth="open", arm_l="flail_l", arm_r="flail_r", leg_l=(-1, 19), leg_r=(1, 21))
        if n == 1:
            return Pose(mouth="open", layout="sit")
        return Pose(mouth="open", layout="lie")
    if state == "angry":
        if n == 0:
            return Pose(dy=1, brows=True, arm_l="akimbo", arm_r="fist", leg_l=(-1, 21), leg_r=(1, 21))
        return Pose(dy=1, brows=True, mouth="open", arm_l="akimbo", arm_r="fist_shake", leg_l=(-1, 21), leg_r=(1, 21))
    raise ValueError(state)


def hand_target(view: str, side: str, kind: str, dy: int) -> list[Point] | None:
    """Polyline (shoulder ... hand) for a 2 px arm; the last point anchors the hand."""
    sl, sr = SHOULDER[view]
    if view == "w":
        sx = sl
        far = side == "l"
        y = 9 + dy
        table: dict[str, list[Point]] = {
            "hang": [(sx, y), (sx, y + 5)],
            "fwd": [(sx, y), (sx - 2, y + 5)],
            "back": [(sx, y), (sx + 2, y + 5)],
            "fwd_far": [(sx, y), (sx - 2, y + 5)],
            "back_far": [(sx, y), (sx + 2, y + 5)],
            "up": [(sx, y), (sx - 4, y - 5)] if not far else [(sx, y), (sx + 3, y - 5)],
            "up_hi": [(sx, y), (sx - 5, y - 7)] if not far else [(sx, y), (sx + 4, y - 7)],
            "flail_l": [(sx, y), (sx + 4, y - 5)],
            "flail_r": [(sx, y), (sx - 3, y - 6)],
            "akimbo": [(sx, y), (sx + 1, y + 2), (sx, y + 4)],
            "fist": [(sx + 1, y), (sx + 4, y - 4), (sx + 4, y - 8)],
            "fist_shake": [(sx + 1, y), (sx + 5, y - 4), (sx + 5, y - 7)],
        }
        return table.get(kind)
    sx = sl if side == "l" else sr
    out = -1 if side == "l" else 1  # direction away from the body
    y = 9 + dy
    table = {
        "hang": [(sx, y), (sx, y + 5)],
        "fwd": [(sx, y), (sx, y + 6)],
        "back": [(sx, y), (sx, y + 4)],
        "up": [(sx, y), (sx + out, y - 4)],
        "up_hi": [(sx, y), (sx + out, y - 6)],
        "flail_l": [(sx, y), (sx + out, y - 4)],
        "flail_r": [(sx, y), (sx + out, y - 5)],
        "akimbo": [(sx, y), (sx + out, y + 2), (sx, y + 4)],
        "fist": [(sx, y), (sx, y - 8)],
        "fist_shake": [(sx, y), (sx + out, y - 7)],
    }
    return table.get(kind)


def draw_arm(c: Canvas, pts: list[Point], role: str, fist: bool = False) -> None:
    c.line(pts, 2, role)
    hx, hy = pts[-1]
    sy = pts[0][1]
    if fist:
        c.rect(hx, hy, hx + 1, hy + 1, "hand")
    elif hy >= sy:
        c.rect(hx, hy + 1, hx + 1, hy + 1, "hand")
    else:
        c.rect(hx, hy, hx + 1, hy, "hand")


def head_rows(ch: Character, view: str, pose: Pose) -> list[str]:
    rows = [list(r) for r in ch.head.rows[view]]
    for j, row in enumerate(rows):
        for i, cch in enumerate(row):
            if cch == "M" and pose.mouth == "open":
                row[i] = "O"
            elif cch == "m" and pose.mouth == "open":
                row[i] = "O"
            elif cch == "B" and pose.brows:
                row[i] = "b"
        rows[j] = row
    if pose.eye_dx:
        for row in rows:
            eyes = [i for i, cch in enumerate(row) if cch == "E"]
            for i in eyes:
                row[i] = "S"
            for i in eyes:
                k = i + pose.eye_dx
                if 0 <= k < len(row) and row[k] in "Ss":
                    row[k] = "E"
                else:
                    row[i] = "E"
    return ["".join(r) for r in rows]


def head_role_map() -> dict[str, str]:
    return {**HEAD_ROLES, "O": "mouth_open", "b": "brow"}


def draw_head(c: Canvas, ch: Character, view: str, pose: Pose) -> None:
    rows = head_rows(ch, view, pose)
    w = len(rows[0])
    x = HEAD_CX[view] - w // 2 + pose.dx + pose.head_dx
    y = 2 + pose.dy + pose.head_dy
    c.stamp(rows, x, y, head_role_map())


def draw_legs_front(c: Canvas, ch: Character, view: str, pose: Pose) -> None:
    (l0, l1), (r0, r1) = LEGS[view]
    hip = 16 + pose.dy
    far_r = view in ("sw", "nw")
    for (x0, x1), (shift, foot), role in (
        ((r0, r1), pose.leg_r, "leg_far" if far_r else "leg"),
        ((l0, l1), pose.leg_l, "leg"),
    ):
        c.rect(x0 + shift, hip, x1 + shift, foot - 1, role)
        c.rect(x0 + shift, foot, x1 + shift, foot, "shoe")


def draw_legs_side(c: Canvas, ch: Character, pose: Pose) -> None:
    hip = 16 + pose.dy
    # leg_l is the far leg, leg_r the near one; foot = shoe row, shift = horizontal stride.
    for (shift, foot), role, hx in ((pose.leg_l, "leg_far", 10), (pose.leg_r, "leg", 11)):
        fx = hx + shift
        c.line([(hx, hip), (fx, foot - 2)], 2, role)
        c.rect(fx - 1, foot, fx + 1, foot, "shoe")


PHONE_SIDE = {"s": "r", "sw": "r", "w": "r", "nw": "l", "n": "l"}
"""Screen side of the businessman's phone hand (his left hand) per authored view."""


def phone_arm(view: str, dy: int) -> list[Point]:
    """The phone arm: elbow out, hand at the ear (the arm-to-ear silhouette, ART_BIBLE 7.2)."""
    y = 9 + dy
    return {
        "s": [(16, y), (18, y + 2), (16, y - 3)],
        "sw": [(15, y), (17, y + 2), (15, y - 3)],
        "w": [(12, y), (14, y + 2), (12, y - 3)],
        "nw": [(6, y), (4, y + 2), (6, y - 3)],
        "n": [(6, y), (4, y + 2), (6, y - 3)],
    }[view]


def draw_phone_hand(c: Canvas, view: str, pts: list[Point]) -> None:
    """Hand and phone, drawn after the head so they sit in front of it."""
    hx, hy = pts[-1]
    c.rect(hx, hy, hx + 1, hy, "hand")
    if view == "w":
        c.rect(hx, hy - 2, hx, hy - 1, "phone")
        return
    px = hx - 1 if view in ("s", "sw") else hx + 2
    c.rect(px, hy - 1, px, hy + 1, "phone")


def draw_pocket_arms(c: Canvas, view: str, dy: int) -> None:
    """Hands in the hoodie pouch: sleeves tight to the body, no hands showing."""
    y = 9 + dy
    if view in ("s", "n"):
        c.line([(6, y), (6, y + 2), (7, y + 3)], 2, "sleeve")
        c.line([(16, y), (16, y + 2), (15, y + 3)], 2, "sleeve")
    elif view in ("sw", "nw"):
        c.line([(6, y), (6, y + 2), (7, y + 3)], 2, "sleeve")
        c.line([(15, y), (15, y + 2), (14, y + 3)], 2, "sleeve_far")
    else:
        c.line([(11, y), (12, y + 2), (10, y + 3)], 2, "sleeve")


@dataclass
class Arm:
    pts: list[Point]
    role: str
    fist: bool = False
    front: bool = False  # drawn after the head (a hand at the face)


def draw_standing(c: Canvas, ch: Character, view: str, state: str, n: int, pose: Pose) -> None:
    x0, x1 = TORSO_X[view]
    dx, dy = pose.dx, pose.dy
    y = 9 + dy
    phone = ch.special_arm == "phone" and state in ("walk", "idle", "angry")
    pockets = ch.special_arm == "pocket" and state in ("walk", "idle")

    # Legs first (the torso hem and apron overlap the hips).
    if view == "w":
        draw_legs_side(c, ch, pose)
    else:
        draw_legs_front(c, ch, view, pose)

    kinds = {"l": pose.arm_l, "r": pose.arm_r}
    if phone and kinds[PHONE_SIDE[view]].startswith("fist"):
        # Angry with the phone still at his ear: the free hand makes the fist.
        free = "l" if PHONE_SIDE[view] == "r" else "r"
        kinds[free] = kinds[PHONE_SIDE[view]]
    arms: dict[str, Arm] = {}
    for side, kind in kinds.items():
        pts = hand_target(view, side, kind, dy)
        if pts is None:
            continue
        far = (view in ("sw", "nw") and side == "r") or (view == "w" and side == "l")
        arms[side] = Arm([(x + dx, yy) for x, yy in pts], "sleeve_far" if far else "sleeve", kind.startswith("fist"))
    if ch.idle == "calling" and state == "idle":
        pose.mouth = "open"
        if n == 0:  # a hand cupped beside the open mouth
            if view == "s":
                arms["r"] = Arm([(16, y), (18, y + 1), (16, y - 2)], "sleeve", True, front=True)
            elif view == "sw":
                arms["l"] = Arm([(6, y), (4, y + 1), (5, y - 2)], "sleeve", True, front=True)
            elif view == "w":
                arms["r"] = Arm([(10, y), (7, y + 1), (5, y - 2)], "sleeve", True, front=True)
            else:  # back views: the hand goes up beside the head
                sr = SHOULDER[view][1]
                arms["r"] = Arm([(sr, y), (sr + 1, y + 2), (sr, y - 4)], "sleeve", True)
        elif view == "w":  # waving the other arm up
            arms["l"] = Arm([(11, y), (13, y - 4), (14, y - 7)], "sleeve_far")
        else:
            arms["l"] = Arm([(6, y), (5, y - 4), (5, y - 7)], "sleeve")
    if pockets:
        arms = {}
    if phone:
        arms.pop(PHONE_SIDE[view], None)

    for a in arms.values():  # far arms behind the torso
        if a.role == "sleeve_far":
            draw_arm(c, a.pts, a.role, a.fist)
    c.rect(x0 + dx, 9 + dy, x1 + dx, 15 + dy, "top")
    ch.torso(c, view, dx, dy)
    if ch.name == "market_trader":
        _trader_apron_skirt(c, view, dx, dy, min(pose.leg_l[1], pose.leg_r[1]) - 1)
    if pockets:
        draw_pocket_arms(c, view, dy)
    for a in arms.values():
        if a.role != "sleeve_far" and not a.front:
            draw_arm(c, a.pts, a.role, a.fist)
    phone_pts = [(x + dx, yy) for x, yy in phone_arm(view, dy)] if phone else None
    if phone_pts:
        c.line(phone_pts, 2, "sleeve")
    draw_head(c, ch, view, pose)
    if phone_pts:
        draw_phone_hand(c, view, phone_pts)
    for a in arms.values():
        if a.front:
            draw_arm(c, a.pts, a.role, a.fist)
    if state == "startle" and ch.special_arm == "phone":
        # Startled, he throws both hands up with the phone still in his left hand.
        # The phone takes the outer pixel of the raised 2 px hand (away from the head).
        a = arms.get(PHONE_SIDE[view])
        if a is not None:
            hx, hy = a.pts[-1]
            px = hx + 1 if hx >= HEAD_CX[view] else hx
            c.px(px, hy, "phone")


def draw_sit(c: Canvas, ch: Character, view: str, pose: Pose) -> None:
    """fall 1: sat down hard, arms flung out, legs splayed in front."""
    sit = Pose(dy=4, mouth="open")
    x0, x1 = TORSO_X[view]
    y = 9 + sit.dy  # shoulders
    if view == "w":
        # Sitting facing left: legs stretched forward along the ground, toes up.
        c.line([(10, 19), (5, 19)], 2, "leg_far")
        c.line([(11, 20), (6, 20)], 2, "leg")
        c.rect(4, 18, 4, 21, "shoe")
        c.rect(5, 21, 5, 21, "shoe")
        c.rect(x0 + 1, y, x1 + 1, 19, "top")
        ch.torso(c, view, 1, sit.dy)
        draw_arm(c, [(11, y), (8, y - 4)], "sleeve")
        draw_arm(c, [(13, y), (16, y - 3)], "sleeve_far")
        rows = head_rows(ch, view, sit)
        c.stamp(rows, HEAD_CX[view] - len(rows[0]) // 2 + 1, 2 + sit.dy, head_role_map())
        return
    (l0, l1), (r0, r1) = LEGS[view]
    far_r = view in ("sw", "nw")
    # Legs come toward the viewer (front views) or away (back views): short blocks, feet apart.
    c.rect(r0 + 1, 19, r1 + 1, 20, "leg_far" if far_r else "leg")
    c.rect(r0 + 2, 21, r1 + 2, 21, "shoe")
    c.rect(l0 - 1, 19, l1 - 1, 20, "leg")
    c.rect(l0 - 2, 21, l1 - 2, 21, "shoe")
    sl, sr = SHOULDER[view]
    draw_arm(c, [(sr, y), (sr + 1, y - 4)], "sleeve_far" if far_r else "sleeve")
    c.rect(x0, y, x1, 18, "top")
    ch.torso(c, view, 0, sit.dy - 1)
    c.rect(x0, 18, x1, 18, "top_sh")
    draw_arm(c, [(sl, y), (sl - 1, y - 4)], "sleeve")
    if ch.special_arm == "phone":
        hx, hy = sr + 1, y - 4
        c.rect(hx + 1, hy - 1, hx + 1, hy - 1, "phone")
    rows = head_rows(ch, view, sit)
    c.stamp(rows, HEAD_CX[view] - len(rows[0]) // 2, 2 + sit.dy, head_role_map())


def draw_lie(c: Canvas, ch: Character, view: str, pose: Pose) -> None:
    """fall 2: flat on the back, legs in the air (drawn head-right; the N view is flipped)."""
    lie = Pose(mouth="open")
    rows = head_rows(ch, view, lie)
    # Rotate the head 90 degrees clockwise so its crown points right.
    grid = np.array([list(r) for r in rows])
    rot = np.rot90(grid, -1)
    hr = ["".join(r) for r in rot]
    hh = len(hr)
    # Body: torso horizontal on rows 15-20, hips at the left.
    c.line([(7, 15), (5, 9)], 2, "leg_far")  # legs kicked up in the air in a V
    c.rect(4, 8, 6, 8, "shoe")
    c.line([(9, 15), (10, 9)], 2, "leg")
    c.rect(10, 8, 12, 8, "shoe")
    c.rect(6, 15, 13, 20, "top")
    c.rect(6, 20, 13, 20, "top_sh")
    if ch.name == "businessman":
        c.rect(12, 16, 13, 19, "shirt")
        c.rect(10, 17, 13, 18, "tie")
    elif ch.name == "litterbug":
        c.rect(9, 16, 10, 19, "top_sh")
        c.px(13, 16, "string")
        c.px(13, 19, "string")
    else:
        for x in range(7, 13):
            c.rect(x, 16, x, 19, "apron_b" if x % 2 else "apron_a")
    # Arms: one thrown up in the air, one flat along the ground.
    draw_arm(c, [(12, 15), (14, 10)], "sleeve")
    c.line([(11, 21), (13, 21)], 1, "sleeve_far")
    if ch.special_arm == "phone":
        c.rect(16, 9, 16, 10, "phone")
    y0 = min(18 - hh // 2, 22 - hh)  # the head rests on the ground (row 21 at the lowest)
    c.stamp(hr, 13, y0, head_role_map())


def render(ch: Character, view: str, state: str, n: int) -> IntArray:
    pose = generic_pose(view, state, n)
    if state == "walk" and ch.walk_head_down:
        pose.head_dy = 1
    c = Canvas()
    if pose.layout == "sit":
        draw_sit(c, ch, view, pose)
    elif pose.layout == "lie":
        draw_lie(c, ch, view if view != "n" else "s", pose)
    else:
        draw_standing(c, ch, view, state, n, pose)
    a = np.full((CELL, CELL), T, dtype=np.int16)
    for y in range(CELL):
        for x in range(CELL):
            role = c.roles[y][x]
            if role is not None:
                a[y, x] = ch.colours[role]
    if pose.layout == "lie" and view == "n":
        # N falls the other way (head left) and shows the back of the head.
        c2 = Canvas()
        draw_lie(c2, ch, "n", pose)
        b = np.full((CELL, CELL), T, dtype=np.int16)
        for y in range(CELL):
            for x in range(CELL):
                role = c2.roles[y][x]
                if role is not None:
                    b[y, x] = ch.colours[role]
        a = b[:, ::-1].copy()
    a = outline(a)
    if ch.seam is not None:
        a[interior_ink(a)] = ch.seam
    return a


def interior_ink(a: IntArray) -> npt.NDArray[np.bool_]:
    """Ink pixels not 4-adjacent to transparency or the cell edge (forge lint counts them as fill)."""
    clear = np.pad(a == T, 1, constant_values=True)
    near = clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]
    return (a == INK) & ~near


# --------------------------------------------------------------------------------------------
# Output


def bounds(a: IntArray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(a != T)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def frames_of(ch: Character) -> dict[str, IntArray]:
    out: dict[str, IntArray] = {}
    for view in DIRS:
        for state, count in STATES:
            for n in range(count):
                out[f"{state}:{view}:{n}"] = render(ch, view, state, n)
    return out


def sprite_text(ch: Character, frames: dict[str, IntArray]) -> str:
    lines = [
        f"id: {ch.asset_id}",
        "cell: 24x24",
        "palette: kerbside32",
        f"# {ch.asset_id}: M3 placeholder (SSP-098), manifest technique grid, placeholder true. Final art",
        "# replaces it behind the same frame IDs in M4. First emitted by tools/sprites/placeholder_people.py;",
        "# this grid is the source of truth now, so edit it here and never re-run the script over it.",
        "# Colour key (ART_BIBLE 7.3):",
        *[f"#   {c}" for c in ch.comments],
        "# Adult build (ART_BIBLE 7.2): figure <= 18x22 including the ink outline, feet on row 22",
        "# (startle 0 is the 1 px hop), row 23 clear. Top-lit shading only, so SE/E/NE are mirrors.",
        "",
    ]
    for fid, a in frames.items():
        lines.append(f"frame {fid}")
        for row in a:
            lines.append("".join(KEY[v + 1] for v in row))
        lines.append("")
    for dst, src in MIRRORS:
        lines.append(f"mirror {dst} from {src}")
    return "\n".join(lines) + "\n"


def report(ch: Character, frames: dict[str, IntArray]) -> list[str]:
    out = []
    worst_w = worst_h = 0
    bad = []
    for fid, a in frames.items():
        x0, y0, x1, y1 = bounds(a)
        w, h = x1 - x0 + 1, y1 - y0 + 1
        worst_w, worst_h = max(worst_w, w), max(worst_h, h)
        hop = fid.startswith("startle:") and fid.endswith(":0")
        feet_ok = y1 == (21 if hop else 22)
        body = (a != T) & (a != INK)  # a colour pixel on the cell edge would have no outline beyond it
        edge = bool(body[0].any() or body[-1].any() or body[:, 0].any() or body[:, -1].any())
        if w > 18 or h > 22 or not feet_ok or edge:
            bad.append(f"{fid} {w}x{h} feet row {y1}")
    out.append(f"{ch.asset_id}: {len(frames)} authored frames, max bounds {worst_w}x{worst_h}, problems: {bad or 'none'}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ids", nargs="*", default=list(CHARACTERS))
    ap.add_argument("--write", action="store_true", help="write the .sprite.txt files")
    args = ap.parse_args(argv)
    ok = True
    for aid in args.ids:
        ch = CHARACTERS[aid]
        frames = frames_of(ch)
        for line in report(ch, frames):
            print(line)
            ok = ok and line.endswith("none")
        if args.write:
            path = NPC_DIR / f"{ch.name}.sprite.txt"
            path.write_text(sprite_text(ch, frames), encoding="utf-8")
            print(f"wrote {path.relative_to(REPO)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
