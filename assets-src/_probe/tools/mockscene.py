"""Compose a mock gameplay frame from probe outputs to judge cross-technique consistency."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from PIL import Image
P = sys.argv[1]
pal_hex = [l.strip() for l in open(f"{P}/tools/endesga32.hex") if l.strip()]
pal = [int(h[i:i+2], 16) for h in pal_hex for i in (0, 2, 4)]
pimg = Image.new("P", (1, 1)); pimg.putpalette(pal + pal[:3] * (256 - len(pal_hex)))
def topal(im):
    a = im.split()[-1] if im.mode == "RGBA" else None
    q = im.convert("RGB").quantize(palette=pimg, dither=Image.Dither.NONE).convert("RGBA")
    if a: q.putalpha(a.point(lambda v: 255 if v >= 128 else 0))
    return q
road = Image.open(f"{P}/codex3/road_tile.png").convert("RGB")
# box (area-average) to 64 then palette; compare with block-mode via pixelize util
road64 = topal(road.resize((64, 64), Image.BOX))
road64.save(f"{P}/post_fixed/road64.png")
W, H = 192, 128
scene = Image.new("RGBA", (W, H))
for ty in range(0, H, 64):
    for tx in range(0, W, 64):
        scene.paste(road64, (tx, ty))
def put(path, x, y):
    s = Image.open(path).convert("RGBA"); scene.alpha_composite(s, (x, y))
put(f"{P}/post_v2/sweeper_r000_ol.png", 20, 30)
put(f"{P}/post_v2/sweeper_r090_ol.png", 120, 70)
put(f"{P}/post_h14/old_woman_sheet_codex_r0c0_h14.png", 90, 20)
put(f"{P}/post_h14/businessman_sheet_codex2_r0c0_h14.png", 105, 22)
put(f"{P}/ascii/oldwoman_s_f0.png", 90, 45)
put(f"{P}/ascii/cat_e.png", 150, 40)
for i, n in enumerate(["can", "banana", "bottle"]):
    put(f"{P}/ascii/{n}.png", 75 + i * 12, 100)
put(f"{P}/post_fixed/old_woman_sheet_codex_r0c0_native.png", 160, 2)
scene.resize((W * 5, H * 5), Image.NEAREST).save(f"{P}/view_mockscene.png")
print("ok")
