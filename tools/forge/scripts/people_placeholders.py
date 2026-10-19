"""One-off generator for the M3 placeholder people grids (SSP-097; reusable for SSP-098).

Run it from the repo root through the forge venv:

    uv run --project tools/forge python tools/forge/scripts/people_placeholders.py            # write the grids
    uv run --project tools/forge python tools/forge/scripts/people_placeholders.py --report   # bounds report
    uv run --project tools/forge python tools/forge/scripts/people_placeholders.py --preview build/tmp/people

The committed ``assets-src/sprites/npc/<name>.sprite.txt`` files are the source of truth
(ASSET_PIPELINE §6.2, CLAUDE.md §3 rule 9). This script only emits a first draft: once a grid has
been hand-edited, do not re-run the generator over it (``--only`` limits which grids it writes, and
it refuses to overwrite a grid whose ``# generated-sha256:`` stamp no longer matches its frames
unless ``--force`` is given).

How a figure is built (ART_BIBLE §7.1-7.3, §8.3):

- Every frame is composed back to front from parts in *role* colours (hair, skin, top, legs...),
  then each character maps the roles to Kerbside-32 indices (its colour keys, ART_BIBLE §7.3).
- Two builds: ``adult`` (22 px tall with outline: head 8, torso 7, legs 7) and ``elderly``
  (19 px, hunched: head 8 sunk into the shoulders, torso 6, legs 5).
- Five authored directions (S, SW, W, NW, N); SE, E and NE are ``mirror`` lines.
- 13 frames per direction: walk 4, idle 2, startle 2, fall 3, angry 2.
- The pivot is the bottom-centre of the feet: the lowest opaque row is always row 22 (the ink
  under the shoes, or under the lying body in ``fall``), and row 23 stays clear. The cell centre
  is x = 12, so a figure centred on columns 8..15 mirrors onto itself.
- The grid draws its own 1 px ink outline (manifest ``outline: false``): a final pass rings the
  silhouette, and carried props get their own ring so they separate from the body.

Reaction poses must read as 1x silhouettes (ART_BIBLE §8.3), and must stay inside 18x22:

- ``startle``: arms up beside the head, body raised 1 px. Elderly figures have headroom and rise
  1 px over their idle pose in both frames. An adult already fills 22 rows standing, so frame 0 is
  a 1 px flinch (crouched, arms going up) and frame 1 rises 1 px from it with the arms fully up.
- ``fall``: 0 = bumped down onto the bottom, legs kicked out, arms flung up; 1 and 2 = flat on the
  back (horizontal body, face up) with the legs in the air, kicking. Comic, never hurt.
- ``angry``: a fist raised above the head; frame 1 shakes it. Adults bend their knees 2 px so the
  fist fits under the 22 px limit.

``npc.old_woman`` keeps her ingested, hand-repaired ``idle:<dir>:0`` frames (SSP-014, D-13) and
her ``origin:``/``ingest_sha256:`` headers; ``idle:<dir>:1`` is that frame with a 1 px squash
(a "harrumph" breath), and every other frame comes from the template.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from forge.outline import INK, add_outline, outline_gaps
from forge.palette import REPO_ROOT, TRANSPARENT
from forge.sprite import SpriteGrid, format_frames, format_sprite, read_sprite, render_frames

I16 = npt.NDArray[np.int16]

CELL = 24
FOOT_ROW = 21
"""Shoe row. The outline under it is row 22, the pivot row (ART_BIBLE §7.2)."""
PIVOT_ROW = 22
MAX_W, MAX_H = 18, 22

AUTHORED_DIRS = ("s", "sw", "w", "nw", "n")
MIRRORS = (("se", "sw"), ("e", "w"), ("ne", "nw"))
STATES = (("walk", 4), ("idle", 2), ("startle", 2), ("fall", 3), ("angry", 2))

# ---------------------------------------------------------------------------------------------
# Roles. A frame is first composed in roles (negative codes), then mapped per character.
# Non-negative values are literal palette indices (props are drawn with those directly).

ROLE_NAMES = (
    "hair",  # H
    "hair_sh",  # h
    "skin",  # S
    "skin_sh",  # s
    "eye",  # E
    "mouth",  # M
    "brow",  # B
    "top",  # T
    "top_sh",  # t
    "top_hi",  # U
    "collar",  # K
    "band",  # Q
    "band_sh",  # q
    "sleeve",  # (arms)
    "leg",  # L
    "leg_sh",  # l
    "shoe",  # F
    "hem",  # C (long coat below the torso)
    "hem_sh",  # c
)
ROLE = {name: -2 - i for i, name in enumerate(ROLE_NAMES)}
ROLE_CHARS = {
    "H": ROLE["hair"],
    "h": ROLE["hair_sh"],
    "S": ROLE["skin"],
    "s": ROLE["skin_sh"],
    "E": ROLE["eye"],
    "M": ROLE["mouth"],
    "B": ROLE["brow"],
    "T": ROLE["top"],
    "t": ROLE["top_sh"],
    "U": ROLE["top_hi"],
    "K": ROLE["collar"],
    "Q": ROLE["band"],
    "q": ROLE["band_sh"],
    "A": ROLE["sleeve"],
    "L": ROLE["leg"],
    "l": ROLE["leg_sh"],
    "F": ROLE["shoe"],
    "C": ROLE["hem"],
    "c": ROLE["hem_sh"],
    "0": INK,
}

# Default key for literal prop templates (ASSET_PIPELINE §6.2: 0-9 = 00-09, a-v = 10-31).
LITERAL = {str(i): i for i in range(10)} | {chr(ord("a") + i - 10): i for i in range(10, 32)}


def tpl(rows: Sequence[str], chars: dict[str, int] | None = None) -> I16:
    """A template (list of equal-length strings) as an index/role array; ``.`` = transparent."""
    key = ROLE_CHARS if chars is None else chars
    w = max(len(r) for r in rows)  # short rows are padded with transparency on the right
    out = np.full((len(rows), w), TRANSPARENT, dtype=np.int16)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                out[y, x] = key[ch]
    return out


# ---------------------------------------------------------------------------------------------
# Canvas


class Canvas:
    def __init__(self) -> None:
        self.a = np.full((CELL, CELL), TRANSPARENT, dtype=np.int16)

    def put(self, x: int, y: int, v: int) -> None:
        if 0 <= x < CELL and 0 <= y < CELL:
            self.a[y, x] = v

    def blit(self, sprite: I16, x: int, y: int) -> None:
        h, w = sprite.shape
        for dy in range(h):
            for dx in range(w):
                v = int(sprite[dy, dx])
                if v != TRANSPARENT:
                    self.put(x + dx, y + dy, v)

    def line(self, x0: int, y0: int, x1: int, y1: int, v: int, width: int = 1) -> list[tuple[int, int]]:
        pts = bresenham(x0, y0, x1, y1)
        for x, y in pts:
            for k in range(width):
                self.put(x + k, y, v)
        return pts

    def layer(self, other: Canvas, ring: bool) -> None:
        """Composite ``other`` over this canvas; with ``ring`` its silhouette gets an ink border."""
        mask = other.a != TRANSPARENT
        if ring:
            grow = np.zeros_like(mask)
            grow[1:, :] |= mask[:-1, :]
            grow[:-1, :] |= mask[1:, :]
            grow[:, 1:] |= mask[:, :-1]
            grow[:, :-1] |= mask[:, 1:]
            self.a[grow & ~mask] = INK
        self.a[mask] = other.a[mask]


def bresenham(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    pts: list[tuple[int, int]] = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if x == x1 and y == y1:
            return pts
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


# ---------------------------------------------------------------------------------------------
# Heads (8 wide x 6 rows of fill: hair 2, face 4; ART_BIBLE §7.2). Light from the NW (§6.1).

HEADS: dict[str, list[str]] = {
    "s": [
        ".HHHHHH.",
        "HHHHHHHh",
        "HSSSSSSh",
        "HSESSEsh",
        ".SSSSSs.",
        "..SMMs..",
    ],
    "sw": [
        "..HHHHH.",
        ".HHHHHHh",
        "HSSSSHHh",
        "SESSEsHh",
        ".SSSSsh.",
        "..MSs...",
    ],
    "w": [
        "..HHHHH.",
        ".HHHHHHh",
        ".SSSHHHh",
        "SSESHHHh",
        "SSSSsHh.",
        ".MSs....",
    ],
    "nw": [
        "..HHHHH.",
        ".HHHHHHh",
        "SHHHHHHh",
        "SsHHHHHh",
        ".sHHHHh.",
        "..shh...",
    ],
    "n": [
        ".HHHHHH.",
        "HHHHHHHh",
        "HHHHHHHh",
        "HHHHHHhh",
        ".HHHHhh.",
        "..sSSs..",
    ],
}
# Brow pixels (row, col) per facing for the angry face; back views have none.
BROWS: dict[str, list[tuple[int, int]]] = {"s": [(2, 2), (2, 5)], "sw": [(2, 1), (2, 4)], "w": [(2, 2)]}
HEAD_X = {"s": 8, "sw": 7, "w": 7, "nw": 7, "n": 8}
"""Left column of the 8-wide head per facing (S and N are centred on the cell's x = 12)."""


def head_sprite(facing: str, expr: str, blink: bool = False) -> I16:
    h = tpl(HEADS[facing])
    if expr == "angry":
        for r, c in BROWS.get(facing, []):
            h[r, c] = ROLE["brow"]
    if expr in ("angry", "shock"):
        h[h == ROLE["mouth"]] = INK
    if blink:
        h[h == ROLE["eye"]] = ROLE["skin_sh"]
    return h


# ---------------------------------------------------------------------------------------------
# Torsos (role templates). ``K`` = collar row, ``Q``/``q`` = the mid band (hi-vis on the postie).

TORSO_ADULT = {
    "front": ["KKKKKK", "UTTTTt", "TTTTTt", "QQQQQq", "TTTTTt", "TTTTTt", "TTTTtt"],
    "side": ["KKKKK.", "UTTTTt", "TTTTTt", "QQQQQq", "TTTTTt", "TTTTTt", "TTTTt."],
}
TORSO_ELDER = {
    "front": ["KKKKKK", "UTTTTt", "QQQQQq", "TTTTTt", "TTTTTt", "TTTTtt"],
    "side": ["KKKTTt", "UTTTTt", "QQQQQq", "TTTTTt", "TTTTTt", "TTTTt."],
}


@dataclass(frozen=True)
class Build:
    name: str
    head_y: int  # first fill row of the head
    torso_y: int  # first torso row
    torso: dict[str, list[str]]
    hip_y: int  # first leg row
    arm_len: int  # sleeve rows before the hand
    elderly: bool


ADULT = Build("adult", head_y=2, torso_y=9, torso=TORSO_ADULT, hip_y=16, arm_len=4, elderly=False)
ELDER = Build("elderly", head_y=5, torso_y=11, torso=TORSO_ELDER, hip_y=17, arm_len=3, elderly=True)

TORSO_X = 9
"""Torso core columns 9..14 (6 px); arms hang at x = 8 and x = 15, so the body is 8 + outline = 10."""


# ---------------------------------------------------------------------------------------------
# Poses


@dataclass
class Pose:
    dy: int = 0  # whole upper body (head, torso, shoulders) down by dy (crouch / bob)
    head_dy: int = 0  # head only (idle nod)
    legs: str = "stand"  # stand | walk0..walk3
    arms: str = "down"  # down | walk0..walk3 | up_half | up | fist0 | fist1
    expr: str = "normal"  # normal | angry | shock
    blink: bool = False


def walk_pose(n: int) -> Pose:
    # Contact frames 0 and 2 stand tall; passing frames 1 and 3 dip 1 px.
    return Pose(dy=n % 2, legs=f"walk{n}", arms=f"walk{n}")


def poses_for(build: Build) -> dict[str, Pose]:
    p: dict[str, Pose] = {}
    for n in range(4):
        p[f"walk:{n}"] = walk_pose(n)
    p["idle:0"] = Pose()
    p["idle:1"] = Pose(head_dy=1, blink=True)
    if build.elderly:
        p["startle:0"] = Pose(dy=-1, arms="up_half", expr="shock")
        p["startle:1"] = Pose(dy=-1, arms="up", expr="shock")
        p["angry:0"] = Pose(arms="fist0", expr="angry")
        p["angry:1"] = Pose(dy=0, arms="fist1", expr="angry")
    else:
        p["startle:0"] = Pose(dy=1, arms="up_half", expr="shock")
        p["startle:1"] = Pose(dy=0, arms="up", expr="shock")
        p["angry:0"] = Pose(dy=2, arms="fist0", expr="angry")
        p["angry:1"] = Pose(dy=2, arms="fist1", expr="angry")
    return p


# ---------------------------------------------------------------------------------------------
# Character definitions


@dataclass
class Character:
    asset_id: str
    build: Build
    colours: dict[str, int]
    long_coat: int = 0  # rows of coat hem drawn over the top of the legs
    lead_hand: bool = False  # dog walker: the near hand reaches forward for the lead
    keep_ingested_idle: bool = False


def default_colours(**over: int) -> dict[str, int]:
    base = {
        "eye": INK,
        "brow": INK,
        "mouth": 11,
        "skin": 12,
        "skin_sh": 11,
    }
    base.update(over)
    for role in ("collar", "band"):
        base.setdefault(role, base["top"])
    base.setdefault("band_sh", base["top_sh"])
    base.setdefault("top_hi", base["top"])
    base.setdefault("sleeve", base["top_sh"])
    base.setdefault("hem", base["top"])
    base.setdefault("hem_sh", base["top_sh"])
    base.setdefault("leg_sh", base["leg"])
    return base


# ---------------------------------------------------------------------------------------------
# Body assembly


def facing_kind(facing: str) -> str:
    return "side" if facing == "w" else "front"


def shoulders(facing: str, top: int) -> tuple[tuple[int, int], tuple[int, int]]:
    """(far/left arm shoulder, near/right arm shoulder) on screen."""
    if facing == "w":
        return (12, top + 1), (11, top + 1)
    return (8, top), (15, top)


def draw_arm(c: Canvas, pts: Sequence[tuple[int, int]], colours_fist: bool = False) -> None:
    """A 1 px sleeve along the polyline; the last point is the hand (2x2 when ``colours_fist``)."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        c.line(x0, y0, x1, y1, ROLE["sleeve"])
    hx, hy = pts[-1]
    if colours_fist:
        for dx in (0, 1):
            for dy in (0, 1):
                c.put(hx + dx, hy + dy, ROLE["skin"])
        c.put(hx + 1, hy + 1, ROLE["skin_sh"])
    else:
        c.put(hx, hy, ROLE["skin"])


def arm_paths(facing: str, arms: str, top: int, build: Build, head_top: int) -> tuple[list[list[tuple[int, int]]], list[list[tuple[int, int]]], list[bool], list[bool]]:
    """Polylines for the arms: (behind-torso arms, in-front arms, fist flags back, fist flags front)."""
    (lx, ly), (rx, ry) = shoulders(facing, top)
    n = build.arm_len
    back: list[list[tuple[int, int]]] = []
    front: list[list[tuple[int, int]]] = []
    fb: list[bool] = []
    ff: list[bool] = []
    if facing == "w":
        # Profile facing left: the far arm is behind the torso, the near arm in front of it.
        far: list[tuple[int, int]]
        near: list[tuple[int, int]]
        if arms.startswith("walk"):
            k = int(arms[4])
            swing = {0: (3, -3), 1: (0, 0), 2: (-3, 3), 3: (0, 0)}[k]  # (near dx, far dx)
            near = [(rx, ry), (rx + swing[0] // 2, ry + n // 2 + 1), (rx + swing[0], ry + n)]
            far = [(lx, ly), (lx + swing[1] // 2, ly + n // 2 + 1), (lx + swing[1], ly + n - 1)]
        elif arms == "down":
            near = [(rx, ry), (rx, ry + n)]
            far = [(lx, ly), (lx, ly + n)]
        elif arms in ("up_half", "up"):
            hy = head_top + (3 if arms == "up_half" else 1)
            near = [(rx, ry), (5, hy)]
            far = [(lx, ly), (16, hy)]
        elif arms in ("fist0", "fist1"):
            fx, fy = (4, head_top - 2) if arms == "fist0" else (5, head_top - 2)
            near = [(rx, ry), (fx + 1, fy + 2)]
            far = [(lx, ly), (lx + 1, ly + n)]
            front.append(near + [(fx, fy)])
            ff.append(True)
            back.append(far)
            fb.append(False)
            return back, front, fb, ff
        else:
            raise ValueError(arms)
        back.append(far)
        fb.append(False)
        front.append(near)
        ff.append(False)
        return back, front, fb, ff

    # Front, back and three-quarter views: one arm each side of the torso.
    if arms == "down":
        left = [(lx, ly), (lx, ly + n)]
        right = [(rx, ry), (rx, ry + n)]
        fists = [False, False]
    elif arms.startswith("walk"):
        k = int(arms[4])
        dl, dr = {0: (0, -1), 1: (0, 0), 2: (-1, 0), 3: (0, 0)}[k]
        left = [(lx, ly), (lx, ly + n + dl)]
        right = [(rx, ry), (rx, ry + n + dr)]
        if facing in ("sw", "nw"):
            # The far (screen-left) arm swings out past the torso edge.
            left = [(lx, ly), (lx - (1 if k == 0 else 0), ly + n + dl)]
        fists = [False, False]
    elif arms in ("up_half", "up"):
        hy = head_top + (3 if arms == "up_half" else 0)
        spread = 1 if arms == "up_half" else 2
        left = [(lx, ly), (lx - spread, hy)]
        right = [(rx, ry), (rx + spread, hy)]
        fists = [False, False]
    elif arms in ("fist0", "fist1"):
        # Right (screen) fist above the head, left hand on the hip.
        fx, fy = (16, head_top - 2) if arms == "fist0" else (15, head_top - 2)
        right = [(rx, ry), (fx, fy + 2), (fx, fy)]
        left = [(lx, ly), (lx - 1, ly + 2), (lx, ly + n)]
        fists = [False, True]
    else:
        raise ValueError(arms)
    front.extend([left, right])
    ff.extend(fists)
    return back, front, fb, ff


def leg_paths(facing: str, legs: str, hip_y: int) -> list[tuple[list[tuple[int, int]], int, int]]:
    """Leg polylines (hip -> ankle) as (points, role, toe dx), drawn in list order (far first)."""
    foot = FOOT_ROW - 1  # last leg row above the shoe
    if legs == "stand":
        k = -1
    else:
        k = int(legs[4])
    if facing == "w":
        # Far leg (shaded) behind, near leg in front; feet point left (toe dx -1).
        if k == 0:
            far, near = (14, foot), (9, foot)
        elif k == 2:
            far, near = (9, foot), (14, foot)
        elif k == 1:
            far, near = (12, foot - 1), (11, foot)
        elif k == 3:
            far, near = (11, foot), (12, foot - 1)
        else:
            far, near = (12, foot), (11, foot)
        return [
            ([(12, hip_y), far], ROLE["leg_sh"], -1),
            ([(11, hip_y), near], ROLE["leg"], -1),
        ]
    lx, rx = 9, 13
    ldx = rdx = 0
    ldy = rdy = 0
    if k == 0:
        rdy = -1
        if facing in ("sw", "nw"):
            ldx, rdx = -1, 1
    elif k == 2:
        ldy = -1
        if facing in ("sw", "nw"):
            ldx, rdx = 1, -1
    left = ([(lx, hip_y), (lx + ldx, foot + ldy)], ROLE["leg"], 0)
    right = ([(rx, hip_y), (rx + rdx, foot + rdy)], ROLE["leg_sh"], 0)
    return [left, right]


def draw_legs(c: Canvas, facing: str, legs: str, hip_y: int) -> None:
    for pts, role, toe in leg_paths(facing, legs, hip_y):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
            c.line(x0, y0, x1, y1, role, width=2)
        ax, ay = pts[-1]
        sy = ay + 1
        if facing == "w":
            for x in (ax - 1, ax, ax + 1):
                c.put(x, sy, ROLE["shoe"])
        else:
            c.put(ax, sy, ROLE["shoe"])
            c.put(ax + 1, sy, ROLE["shoe"])


def torso_sprite(build: Build, facing: str) -> I16:
    return tpl(build.torso[facing_kind(facing)])


def draw_upright(ch: Character, facing: str, pose: Pose) -> Canvas:
    """The standing family of poses (walk, idle, startle, angry) for one facing."""
    b = ch.build
    top = b.torso_y + pose.dy
    head_top = b.head_y + pose.dy + pose.head_dy
    hip_y = b.hip_y + pose.dy
    body = Canvas()
    back_arms, front_arms, fist_b, fist_f = arm_paths(facing, pose.arms, top, b, b.head_y + pose.dy)
    if ch.lead_hand and pose.arms in ("down", "walk1", "walk3", "walk0", "walk2"):
        # The dog walker holds the lead out in front: the near hand reaches forward.
        front_arms, fist_f = _lead_arm(facing, front_arms, fist_f, top, b)

    # Back to front: far arm, legs, torso (+ long coat hem), head, near arms.
    for pts, fist in zip(back_arms, fist_b, strict=True):
        draw_arm(body, pts, fist)
    draw_legs(body, facing, pose.legs, hip_y)
    torso = torso_sprite(b, facing)
    body.blit(torso, TORSO_X, top)
    if ch.long_coat:
        hem_rows = ch.long_coat
        for r in range(hem_rows):
            y = top + torso.shape[0] + r
            x0 = TORSO_X - (1 if r == hem_rows - 1 and facing_kind(facing) == "front" else 0)
            x1 = TORSO_X + 5 + (1 if r == hem_rows - 1 and facing_kind(facing) == "front" else 0)
            for x in range(x0, x1 + 1):
                body.put(x, y, ROLE["hem_sh"] if x == x1 else ROLE["hem"])
    head = head_sprite(facing, pose.expr, pose.blink)
    hx = HEAD_X[facing]
    if b.elderly:
        hx += {"s": 0, "sw": -1, "w": -2, "nw": -1, "n": 0}[facing]
    if b.elderly and facing in ("n", "nw"):
        # Hunched, seen from behind: the rounded back rises over the bottom of the head.
        body.blit(head, hx, head_top)
        hump = tpl([".TTTT.", "TTTTTt"]) if facing == "n" else tpl(["..TTT.", ".TTTTt"])
        body.blit(hump, TORSO_X, top - 2)
    else:
        if b.elderly:
            # Hunched, seen from the front or side: the rounded back and shoulders rise behind the
            # head (from this high camera the hump shows above the shoulder line).
            if facing == "s":
                for y in range(head_top + 2, top):
                    body.put(hx - 1, y, ROLE["top_hi"])
                    for x in range(hx, hx + 8):
                        body.put(x, y, ROLE["top"])
                    body.put(hx + 8, y, ROLE["top_sh"])
            elif facing == "sw":
                for y in range(head_top + 1, top):
                    for x in range(hx + 4, hx + 8):
                        body.put(x, y, ROLE["top"])
                    body.put(hx + 8, y, ROLE["top_sh"])
                body.put(hx + 8, head_top + 1, TRANSPARENT)
            elif facing == "w":
                for y in range(head_top + 1, top):
                    for x in range(TORSO_X + 2, TORSO_X + 5):
                        body.put(x, y, ROLE["top"])
                    body.put(TORSO_X + 5, y, ROLE["top_sh"])
                body.put(TORSO_X + 5, head_top + 1, TRANSPARENT)
        else:
            # Adult neck row between chin and collar.
            if facing in ("s", "sw", "n"):
                body.put(TORSO_X + 2, top - 1, ROLE["skin_sh"])
                body.put(TORSO_X + 3, top - 1, ROLE["skin_sh"])
            elif facing == "w":
                body.put(TORSO_X + 2, top - 1, ROLE["skin_sh"])
        body.blit(head, hx, head_top)
    for pts, fist in zip(front_arms, fist_f, strict=True):
        draw_arm(body, pts, fist)
    if ch.lead_hand and pose.arms.startswith(("down", "walk")):
        # The extendable lead's handle (18) in the forward hand; the lead itself is runtime.
        hx_, hy_ = front_arms[-1][-1]
        body.put(hx_, hy_ + 1, 18)
        body.put(hx_ - 1 if facing == "w" else hx_ + 1, hy_ + 1, 18)
    return body


def _lead_arm(facing: str, front_arms: list[list[tuple[int, int]]], fists: list[bool], top: int, b: Build) -> tuple[list[list[tuple[int, int]]], list[bool]]:
    """Replace the near arm with one held out ahead (the runtime lead starts at this hand, §8.3)."""
    arms = [list(a) for a in front_arms]
    if facing == "w":
        sx, sy = arms[-1][0]
        arms[-1] = [(sx, sy), (sx - 2, sy + 2), (sx - 4, sy + 3)]
    elif facing in ("s", "sw"):
        sx, sy = arms[-1][0]  # screen-right arm (the walker's left)
        arms[-1] = [(sx, sy), (sx + 1, sy + 2), (sx + 1, sy + b.arm_len + 1)]
    else:  # n, nw: the lead goes ahead, up the screen; the hand is raised a little in front
        sx, sy = arms[-1][0]
        arms[-1] = [(sx, sy), (sx + 1, sy + 1), (sx + 1, sy + b.arm_len - 1)]
    return arms, fists


def draw_fallen(ch: Character, facing: str, n: int) -> Canvas:
    """Fall frames, drawn with the head to the right (compose flips N so it falls to the left).

    0: bumped down onto the bottom, legs kicked out to the left, arms flung up (the facing's own
    head and torso). 1-2: flat on the back, face up (the S head and front torso turned a quarter
    clockwise), legs in the air, kicking. Mirrors flip the east-facing ones.
    """
    b = ch.build
    c = Canvas()
    if n == 0:
        torso = torso_sprite(b, facing)
        th = torso.shape[0]
        top = FOOT_ROW - th  # hem on row 20, the ground row 21 under the bottom
        hip = top + th - 1
        c.line(9, hip, 7, hip - 3, ROLE["leg_sh"], width=2)
        c.line(9, hip + 1, 7, hip, ROLE["leg"], width=2)
        for x, y in ((5, hip - 4), (6, hip - 4), (5, hip), (6, hip)):
            c.put(x, y, ROLE["shoe"])
        c.blit(torso, TORSO_X, top)
        head = head_sprite(facing, "shock")
        head_top = top - (7 if not b.elderly else 6)
        if not b.elderly and facing in ("s", "sw", "n"):
            c.put(TORSO_X + 2, top - 1, ROLE["skin_sh"])
            c.put(TORSO_X + 3, top - 1, ROLE["skin_sh"])
        c.blit(head, HEAD_X[facing] + (1 if facing == "w" else 0), head_top)
        draw_arm(c, [(8, top), (6, top - 4)])
        draw_arm(c, [(15, top), (17, top - 4)])
        return c

    torso = np.rot90(tpl(b.torso["front"]), k=-1)  # (6 rows, torso-height cols)
    th_w = torso.shape[1]
    head = np.rot90(head_sprite("s", "shock"), k=-1)  # (8 rows, 6 cols)
    ty = FOOT_ROW - torso.shape[0] + 1  # torso rows ty..21
    tx = 15 - th_w  # the head sits on columns 15..20
    hip_x, hip_y = tx, ty + 1
    up = 5 if not b.elderly else 4  # leg length in the air
    if n == 1:
        c.line(hip_x, hip_y + 2, hip_x - 1, hip_y - up, ROLE["leg_sh"], width=2)
        c.line(hip_x + 1, hip_y + 3, hip_x + 3, hip_y - up + 1, ROLE["leg"], width=2)
        shoes = [(hip_x - 2, hip_y - up - 1), (hip_x - 1, hip_y - up - 1), (hip_x + 3, hip_y - up), (hip_x + 4, hip_y - up)]
    else:
        c.line(hip_x, hip_y + 2, hip_x - 2, hip_y - up + 1, ROLE["leg_sh"], width=2)
        c.line(hip_x + 1, hip_y + 3, hip_x + 2, hip_y - up, ROLE["leg"], width=2)
        shoes = [(hip_x - 3, hip_y - up), (hip_x - 2, hip_y - up), (hip_x + 2, hip_y - up - 1), (hip_x + 3, hip_y - up - 1)]
    for x, y in shoes:
        c.put(x, y, ROLE["shoe"])
    c.blit(torso, tx, ty)
    c.blit(head, 15, FOOT_ROW - head.shape[0] + 1)
    sx = 14
    if n == 1:
        draw_arm(c, [(sx, ty), (sx + 1, ty - 4)])
    else:
        draw_arm(c, [(sx - 1, ty), (sx - 3, ty - 3)])
    return c


# ---------------------------------------------------------------------------------------------
# Props (literal palette indices). Each returns a list of (sprite, x, y, layer). Props stand on
# the ground, so they do not bob with the body. Fall props are placed for the head-right layout.

PropList = list[tuple[I16, int, int, str]]


def _lit(rows: Sequence[str]) -> I16:
    return tpl(rows, LITERAL)


# Doris's tartan trolley: 25 navy / 18 red check, 01 wheels, 05 handle (ART_BIBLE §7.3).
TROLLEY_TALL = _lit(["5.", "5.", "5.", "pip", "ipi", "pip", "ipi", "pip", "1.1"])
TROLLEY_SIDE = _lit(["5...", ".5..", "..5.", "pipi", "ipip", "pipi", "ipip", "1..1"])
TROLLEY_TIPPED = _lit(["pipip5", "ipipi.", "1...1."])


def doris_props(facing: str, state: str, n: int) -> PropList:
    if state == "fall":
        return [(TROLLEY_TALL, 17, 13, "back")] if n == 0 else [(TROLLEY_TIPPED, 15, 11, "back")]
    if facing == "s":
        return [(TROLLEY_TALL, 16, 13, "front")]
    if facing in ("sw", "nw"):
        return [(TROLLEY_TALL, 16, 13, "back")]
    if facing == "w":
        return [(TROLLEY_SIDE, 15, 14, "back")]
    return [(TROLLEY_TALL, 5, 13, "front")]  # n: the trolley trails behind her, on the screen-left


# The old man's walking frame, 06 lit / 05 shade, drawn ahead of his feet.
FRAME_FRONT = _lit(["6666666666", "6........5", "6........5", "6........5", "6........5", "6........5", "6........5"])
FRAME_SIDE = _lit(["6666", "6..5", "6..5", "6..5", "6..5", "6..5", "6...5", "6....5"])
FRAME_BACK = _lit(["666666666666", "6..........5", "6..........5", "6..........5", "6..........5", "6..........5"])
FRAME_FALLEN = _lit(["66666666", "5......5"])


def old_man_props(facing: str, state: str, n: int) -> PropList:
    if state == "fall":
        return [(FRAME_FALLEN, 12, 19, "back")] if n == 0 else [(FRAME_FALLEN, 12, 12, "back")]
    if facing == "s":
        return [(FRAME_FRONT, 7, 15, "front")]
    if facing == "sw":
        return [(FRAME_FRONT, 4, 15, "front")]
    if facing == "w":
        return [(FRAME_SIDE, 3, 14, "front")]
    if facing == "nw":
        return [(FRAME_BACK, 4, 12, "back")]
    return [(FRAME_BACK, 6, 12, "back")]


# Mum's pushchair: 25 navy hood and seat with a 27 blanket, 03 frame, 01 wheels (ART_BIBLE §7.3).
PUSHCHAIR_FRONT = _lit([".pppppp.", "pqqqqqqp", "pprrrrpp", "pppppppp", "3......3", "1......1"])
PUSHCHAIR_SIDE = _lit(["..ppp.", ".pqqqp", "ppppp.", "pppppp", "3....3", "1....1"])
PUSHCHAIR_BACK = _lit(["3..........3", "3..........3", "pppppppppppp", "pqqqqqqqqqqp", ".pppppppppp."])


def mum_props(facing: str, state: str, n: int) -> PropList:
    if state == "fall":
        return [(PUSHCHAIR_SIDE, 15, 15, "back")] if n == 0 else [(PUSHCHAIR_SIDE, 14, 8, "back")]
    if facing == "s":
        return [(PUSHCHAIR_FRONT, 8, 16, "front")]
    if facing == "sw":
        return [(PUSHCHAIR_FRONT, 4, 16, "front")]
    if facing == "w":
        return [(PUSHCHAIR_SIDE, 2, 15, "front")]
    if facing == "nw":
        return [(PUSHCHAIR_BACK, 4, 10, "back")]
    return [(PUSHCHAIR_BACK, 6, 10, "back")]


# The postie's red trolley (18 with 19 shade, 03 handle, 01 wheels) and post bag (18, 19 strap).
POST_TROLLEY = _lit(["3.", "3.", "iij", "iij", "iij", "iij", "iij", "1.1"])
POST_TROLLEY_TIPPED = _lit(["iiiii3", "jjjjj.", "1...1."])
POST_BAG = _lit(["ij", "ij", "jj"])


def postie_props(facing: str, state: str, n: int) -> PropList:
    if state == "fall":
        return [(POST_TROLLEY, 17, 14, "back")] if n == 0 else [(POST_TROLLEY_TIPPED, 14, 11, "back")]
    bag_y = ADULT.torso_y + 4
    if facing == "s":
        return [(POST_TROLLEY, 17, 14, "back"), (POST_BAG, 7, bag_y, "front")]
    if facing == "sw":
        return [(POST_TROLLEY, 16, 14, "back"), (POST_BAG, 7, bag_y, "front")]
    if facing == "w":
        return [(POST_TROLLEY, 15, 14, "back"), (POST_BAG, 9, bag_y, "front")]
    if facing == "nw":
        return [(POST_TROLLEY, 16, 13, "back"), (POST_BAG, 7, bag_y, "back")]
    return [(POST_TROLLEY, 5, 13, "back"), (POST_BAG, 15, bag_y, "back")]


PROPS: dict[str, Callable[[str, str, int], PropList]] = {
    "npc.old_woman": doris_props,
    "npc.old_man_frame": old_man_props,
    "npc.mum_pushchair": mum_props,
    "npc.postie": postie_props,
}


# ---------------------------------------------------------------------------------------------
# The Monday cast (ART_BIBLE §7.3 colour keys)

CHARACTERS: list[Character] = [
    Character(
        "npc.shopper",
        ADULT,
        # Primary garment (top) in the swap keys 21/22/23, secondary (scarf + trousers) in
        # 14/15/16 with at most 4 px of 15; skin 12 lit / 11 shade (ART_BIBLE §5.6).
        default_colours(
            hair=8, hair_sh=8, top=22, top_sh=21, top_hi=23, collar=16, band=22, band_sh=21, leg=14, leg_sh=14, shoe=1
        ),
    ),
    Character(
        "npc.old_woman",
        ELDER,
        # Coat 30/31, headscarf 31 (30 shade), hair 06 under it, handbag 19, trolley 18/25.
        default_colours(hair=31, hair_sh=30, top=30, top_sh=30, top_hi=31, collar=31, sleeve=31, leg=11, shoe=1),
        long_coat=2,
        keep_ingested_idle=True,
    ),
    Character(
        "npc.old_man_frame",
        ELDER,
        # Cardigan 13 (08 shade), trousers 03, flat cap 09, walking frame 05/06.
        default_colours(hair=9, hair_sh=8, top=13, top_sh=8, leg=3, shoe=8),
    ),
    Character(
        "npc.mum_pushchair",
        ADULT,
        # Coat 20 (19 shade), pushchair 25/03; hair 10, jeans 02.
        default_colours(hair=10, hair_sh=9, top=20, top_sh=19, leg=2, shoe=1),
    ),
    Character(
        "npc.postie",
        ADULT,
        # Jacket 18/19 with the 17 hi-vis band, navy trousers, trolley and bag 18.
        default_colours(hair=8, hair_sh=8, top=18, top_sh=19, band=17, band_sh=17, leg=25, shoe=1),
    ),
    Character(
        "npc.dog_walker",
        ADULT,
        # Coat 22 (21 shade, 23 lit), a 25 woolly hat over 13 hair, the lead handle 18 in the
        # forward hand; the lead itself is a runtime line from that hand (ART_BIBLE §8.3).
        default_colours(hair=25, hair_sh=25, top=22, top_sh=21, top_hi=23, leg=3, leg_sh=2, shoe=1),
        lead_hand=True,
    ),
]

# Per-character head extras drawn after the head (literal indices), e.g. Doris's hair fringe
# under the scarf and the old man's cap brim. (facing, expr) -> list of (dx, dy, index) relative
# to the head origin.


def head_extras(asset_id: str, facing: str) -> list[tuple[int, int, int]]:
    if asset_id == "npc.old_woman":
        # A 06 grey fringe under the headscarf, and the scarf knot under the chin.
        return {
            "s": [(2, 2, 6), (3, 2, 6), (4, 2, 6), (5, 2, 6)],
            "sw": [(1, 2, 6), (2, 2, 6), (3, 2, 6)],
            "w": [(1, 2, 6), (2, 2, 6)],
            "nw": [],
            "n": [],
        }[facing]
    if asset_id == "npc.dog_walker":
        # 13 hair under the woolly hat.
        return {
            "s": [(0, 2, 13), (0, 3, 13), (7, 2, 13), (7, 3, 13)],
            "sw": [(0, 2, 13), (6, 3, 13), (7, 3, 13)],
            "w": [(4, 3, 13), (5, 3, 13), (6, 3, 13), (5, 4, 13), (7, 3, 13)],
            "nw": [(2, 4, 13), (3, 4, 13), (4, 4, 13), (5, 4, 13)],
            "n": [(1, 4, 13), (2, 4, 13), (3, 4, 13), (4, 4, 13), (5, 4, 13), (6, 4, 13)],
        }[facing]
    if asset_id == "npc.old_man_frame":
        # Flat cap brim (09) over the face, grey 06 sideburns.
        return {
            "s": [(1, 2, 9), (2, 2, 9), (3, 2, 9), (4, 2, 9), (5, 2, 9), (6, 2, 9), (0, 3, 6), (7, 3, 6)],
            "sw": [(0, 2, 9), (1, 2, 9), (2, 2, 9), (3, 2, 9), (4, 2, 9), (6, 3, 6)],
            "w": [(-1, 2, 9), (0, 2, 9), (1, 2, 9), (4, 3, 6)],
            "nw": [(6, 4, 6)],
            "n": [(1, 4, 6), (6, 4, 6)],
        }[facing]
    return []


# ---------------------------------------------------------------------------------------------
# Composition


def pose_head_origin(ch: Character, facing: str, pose: Pose) -> tuple[int, int]:
    b = ch.build
    hx = HEAD_X[facing]
    if b.elderly:
        hx += {"s": 0, "sw": -1, "w": -2, "nw": -1, "n": 0}[facing]
    return hx, b.head_y + pose.dy + pose.head_dy


def compose(ch: Character, facing: str, state: str, n: int) -> I16:
    poses = poses_for(ch.build)
    if state == "fall":
        body = draw_fallen(ch, facing, n)
        pose = Pose()
    else:
        pose = poses[f"{state}:{n}"]
        body = draw_upright(ch, facing, pose)
        for dx, dy, v in head_extras(ch.asset_id, facing):
            hx, hy = pose_head_origin(ch, facing, pose)
            if ch.build.elderly and facing in ("n", "nw") and hy + dy >= ch.build.torso_y + pose.dy - 2:
                continue
            if body.a[hy + dy, hx + dx] != TRANSPARENT or (dx < 0 or dx > 7):
                body.put(hx + dx, hy + dy, v)
        if ch.asset_id == "npc.old_woman":
            _doris_handbag(body, facing, pose)
    mapped = map_roles(body.a, ch.colours)
    props = PROPS.get(ch.asset_id)
    final = Canvas()
    plist = props(facing, state, n) if props else []
    for spr, x, y, layer in plist:
        if layer == "back":
            pc = Canvas()
            pc.blit(spr, x, y)
            final.layer(pc, ring=True)
    bc = Canvas()
    bc.a = mapped
    final.layer(bc, ring=True)
    for spr, x, y, layer in plist:
        if layer == "front":
            pc = Canvas()
            pc.blit(spr, x, y)
            final.layer(pc, ring=True)
    out = add_outline(final.a)
    if state == "fall" and facing == "n":
        # Facing away, she topples back towards the camera and lands to the left.
        out = np.ascontiguousarray(out[:, ::-1])
    return out


def _doris_handbag(body: Canvas, facing: str, pose: Pose) -> None:
    """Doris's 19 handbag hangs from the screen-left hand; in angry 1 she swings it overhead."""
    b = ELDER
    top = b.torso_y + pose.dy
    if pose.arms == "fist1":
        # the handbag whack: the bag replaces the fist, held up high
        hx, hy = (15, b.head_y + pose.dy - 3) if facing != "w" else (3, b.head_y + pose.dy - 3)
        for dx in range(3):
            for dy in range(2):
                body.put(hx + dx, hy + dy + 1, 19)
        return
    if pose.arms in ("up", "up_half"):
        return
    if facing == "w":
        return  # the bag is on her far arm, hidden by the coat
    x = 6 if facing in ("s", "n", "sw") else 6
    y = top + b.arm_len - 1
    for dx in range(3):
        for dy in range(2):
            body.put(x + dx, y + dy + 1, 19)
    body.put(x + 1, y, INK)


def map_roles(a: I16, colours: dict[str, int]) -> I16:
    out = a.copy()
    for name, code in ROLE.items():
        if name in colours:
            out[a == code] = colours[name]
        elif (a == code).any():
            raise ValueError(f"role {name} has no colour")
    return out


# ---------------------------------------------------------------------------------------------
# Doris: her ingested idle frames


def squash(frame: I16, row: int) -> I16:
    """Delete ``row`` and shift everything above it down 1 px (a breath / harrumph)."""
    out = frame.copy()
    out[1 : row + 1] = frame[0:row]
    out[0] = TRANSPARENT
    return out


DORIS_SQUASH_ROW = {"s": 18, "sw": 18, "w": 18, "nw": 18, "n": 18}


# ---------------------------------------------------------------------------------------------
# Output


def stamp(frames_text: str) -> str:
    return hashlib.sha256(frames_text.encode("utf-8")).hexdigest()


def build_grid(ch: Character, existing: SpriteGrid | None) -> SpriteGrid:
    frames: dict[str, I16] = {}
    for state, count in STATES:
        for facing in AUTHORED_DIRS:
            for n in range(count):
                fid = f"{state}:{facing}:{n}"
                if ch.keep_ingested_idle and state == "idle" and existing is not None:
                    base = existing.frames[f"idle:{facing}:0"]
                    frames[fid] = base.copy() if n == 0 else squash(base, DORIS_SQUASH_ROW[facing])
                else:
                    frames[fid] = compose(ch, facing, state, n)
    grid = SpriteGrid(
        id=ch.asset_id,
        cell=(CELL, CELL),
        frames=frames,
        mirrors=[(dst, src) for dst, src in MIRRORS],
        origin=existing.origin if (existing is not None and ch.keep_ingested_idle) else None,
        ingest_sha256=existing.ingest_sha256 if (existing is not None and ch.keep_ingested_idle) else None,
    )
    return grid


DORIS_PROVENANCE = [
    '# idle:<dir>:0 are the SSP-014 spike frames, kept unchanged: ingested from ref.people_style',
    "# (run_04, period_override 13.5 px, one sheet factor 0.9048), then hand-repaired. Never",
    "# re-ingest over this grid (SSP-133 replaces it in M4).",
    "# Hand repairs after ingest (D-13; pixels changed vs the frames as ingested):",
    "#   idle:s:0  13 (two eyes split from an ink bar, mouth, arm, trolley top row, shoes)",
    "#   idle:sw:0 12 (eye, mouth, stray orange pixel, two hands, ink blob by the handle, shoes)",
    "#   idle:w:0   7 (mouth, hand and forearm, hand on the trolley, shoe)",
    "#   idle:nw:0  6 (hand on the trolley, shoes)",
    "#   idle:n:0   7 (trolley top row, shoes)",
    "# idle:<dir>:1 squash idle:<dir>:0 by 1 px at row 18 (a breath). Every other frame is the",
    "# SSP-097 placeholder template.",
]


def header_comment(ch: Character, generated: str) -> list[str]:
    lines = [
        f"# {ch.asset_id}: M3 placeholder (SSP-097), {ch.build.name} build, 24x24, figure <= 18x22 with",
        "# feet on row 22. Drafted by tools/forge/scripts/people_placeholders.py; this grid is the source",
        "# of truth now (edit it here). Final art replaces it behind the same frame IDs in M4.",
        "# States per direction: walk 4, idle 2, startle 2, fall 3, angry 2. S, SW, W, NW, N authored;",
        "# SE, E and NE are mirrors (top-lit shading only, ART_BIBLE 6.2).",
    ]
    if ch.keep_ingested_idle:
        lines += DORIS_PROVENANCE
    lines.append(f"# generated-sha256: {generated} (the frames as generated; edits make it stale)")
    return lines


def write_grid(ch: Character, grid: SpriteGrid, path: Path) -> None:
    text = format_sprite(grid)
    frames_text = format_frames(grid)
    head, _, body = text.partition("\n\n")
    out = head + "\n" + "\n".join(header_comment(ch, stamp(frames_text))) + "\n\n" + body
    path.write_bytes(out.encode("utf-8"))


def grid_path(asset_id: str) -> Path:
    return REPO_ROOT / "assets-src" / "sprites" / "npc" / f"{asset_id.split('.', 1)[1]}.sprite.txt"


def generated_stamp(path: Path) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# generated-sha256: "):
            return line.split(": ", 1)[1].split()[0]
    return None


# ---------------------------------------------------------------------------------------------
# Bounds report


def bounds(frame: I16) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(frame != TRANSPARENT)
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def report(ids: Iterable[str]) -> int:
    bad = 0
    print(f"{'asset':22} {'frames':>6} {'max w':>5} {'max h':>5} {'feet':>6} {'row23':>5} {'gaps':>4}")
    for asset_id in ids:
        grid = read_sprite(grid_path(asset_id))
        frames = render_frames(grid)
        mw = mh = 0
        feet: set[int] = set()
        row23 = 0
        gaps = 0
        for fid, f in frames.items():
            x0, x1, y0, y1 = bounds(f)
            w, h = x1 - x0 + 1, y1 - y0 + 1
            mw, mh = max(mw, w), max(mh, h)
            feet.add(y1)
            row23 += int((f[23] != TRANSPARENT).sum())
            gaps += int(outline_gaps(f).sum())
            if w > MAX_W or h > MAX_H or y1 != PIVOT_ROW:
                print(f"  ! {asset_id}:{fid} is {w}x{h}, lowest row {y1}")
                bad += 1
        print(f"{asset_id:22} {len(frames):>6} {mw:>5} {mh:>5} {','.join(map(str, sorted(feet))):>6} {row23:>5} {gaps:>4}")
    return 1 if bad else 0


# ---------------------------------------------------------------------------------------------
# Preview (for iterating on the templates; the review evidence is `npm run assets:sheets`)


def preview(ids: Iterable[str], out_dir: Path, scale: int = 6) -> None:
    from PIL import Image

    from forge.palette import load_palette

    pal = load_palette()
    rgb = [tuple(int(v) for v in row) for row in pal.rgb]
    out_dir.mkdir(parents=True, exist_ok=True)
    order = [s for s, _ in STATES]
    dirs = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]
    for asset_id in ids:
        frames = render_frames(read_sprite(grid_path(asset_id)))
        cols = 13
        img = Image.new("RGB", (cols * 25 * scale, len(dirs) * 25 * scale), (195, 193, 192))
        for r, d in enumerate(dirs):
            c = 0
            for state in order:
                n = 0
                while f"{state}:{d}:{n}" in frames:
                    f = frames[f"{state}:{d}:{n}"]
                    tile = Image.new("RGB", (24, 24), (195, 193, 192) if (c % 2 == 0) else (154, 152, 156))
                    px = tile.load()
                    for y in range(24):
                        for x in range(24):
                            v = int(f[y, x])
                            if v != TRANSPARENT:
                                px[x, y] = rgb[v]
                    img.paste(tile.resize((24 * scale, 24 * scale), Image.NEAREST), (c * 25 * scale, r * 25 * scale))
                    c += 1
                    n += 1
        img.save(out_dir / f"{asset_id}.png")
        # 1x strip of the S row and the W row for the silhouette check
        one = Image.new("RGB", (cols * 26, 2 * 26), (154, 152, 156))
        for r, d in enumerate(("s", "w")):
            c = 0
            for state in order:
                n = 0
                while f"{state}:{d}:{n}" in frames:
                    f = frames[f"{state}:{d}:{n}"]
                    for y in range(24):
                        for x in range(24):
                            v = int(f[y, x])
                            if v != TRANSPARENT:
                                one.putpixel((c * 26 + x, r * 26 + y), rgb[v])
                    c += 1
                    n += 1
        one.resize((one.width * 3, one.height * 3), Image.NEAREST).save(out_dir / f"{asset_id}_1x_x3.png")


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", nargs="*", help="asset IDs to write (default: all six)")
    ap.add_argument("--force", action="store_true", help="overwrite grids that were edited after generation")
    ap.add_argument("--report", action="store_true", help="print the bounds report for the committed grids")
    ap.add_argument("--preview", type=Path, help="write preview PNGs of the committed grids to this directory")
    args = ap.parse_args(argv)
    ids = args.only or [c.asset_id for c in CHARACTERS]
    if args.report:
        return report(ids)
    if args.preview:
        preview(ids, args.preview)
        return 0
    by_id = {c.asset_id: c for c in CHARACTERS}
    for asset_id in ids:
        ch = by_id[asset_id]
        path = grid_path(asset_id)
        existing = read_sprite(path) if path.exists() else None
        if existing is not None and not args.force and not ch.keep_ingested_idle:
            st = generated_stamp(path)
            if st is None or st != stamp(format_frames(existing)):
                print(f"refusing to overwrite {path} (edited after generation); use --force", file=sys.stderr)
                return 1
        if ch.keep_ingested_idle and existing is not None:
            st = generated_stamp(path)
            if st is not None and st != stamp(format_frames(existing)) and not args.force:
                print(f"refusing to overwrite {path} (edited after generation); use --force", file=sys.stderr)
                return 1
        grid = build_grid(ch, existing)
        write_grid(ch, grid, path)
        print(f"wrote {path.relative_to(REPO_ROOT)} ({len(grid.frames)} authored frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
