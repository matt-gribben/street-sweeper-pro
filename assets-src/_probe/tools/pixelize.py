"""Deterministic post-process: AI 'pixel art' sheets / Blender renders -> game sprites.

Steps per sheet: chroma-key bg (median border colour) -> split cols x rows -> crop to bbox ->
estimate pseudo-pixel size (FFT of edge profile) -> sample block centres (native res) and
block-mode resample to a fixed target height -> shared 32-colour palette (median cut, no dither)
-> binary alpha.

usage: pixelize.py OUTDIR TARGET_H COLORS  sheet:path:cols:rows ...  render:path ...
"""
import sys, os, json
import numpy as np
from PIL import Image

OUT, TARGET_H, NCOL = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
os.makedirs(OUT, exist_ok=True)
report = {}

def key_bg(img, thr=110):
    if img.mode == "RGBA" and (np.asarray(img)[:, :, 3] == 0).mean() > 0.2:  # real alpha: just threshold it
        a = np.asarray(img).copy()
        a[:, :, 3] = (a[:, :, 3] >= 128) * 255
        return Image.fromarray(a, "RGBA"), "alpha"
    a = np.asarray(img.convert("RGB")).astype(np.int32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = (d > thr).astype(np.uint8) * 255
    rgba = np.dstack([a.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA"), bg.tolist()

def pixel_period(rgb, axis):
    """Dominant period of colour edges along axis (pseudo-pixel size)."""
    a = rgb.astype(np.float32)
    g = np.abs(np.diff(a, axis=axis)).sum(-1)
    prof = g.sum(axis=1 - axis)
    prof = prof - prof.mean()
    n = len(prof)
    spec = np.abs(np.fft.rfft(prof, n=n * 4))
    freqs = np.fft.rfftfreq(n * 4)
    ok = (freqs > 1 / 16) & (freqs < 1 / 3)  # periods 3..16 px (pseudo-pixel, not frame spacing)
    f = freqs[ok][np.argmax(spec[ok])]
    return 1 / f

def bbox_crop(im):
    bb = im.getchannel("A").getbbox()
    return im.crop(bb) if bb else im

def block_mode_resize(im, out_w, out_h):
    """Each output pixel = most common opaque colour in its source block (alpha by majority)."""
    a = np.asarray(im)
    H, W = a.shape[:2]
    res = np.zeros((out_h, out_w, 4), np.uint8)
    for y in range(out_h):
        y0, y1 = int(y * H / out_h), max(int((y + 1) * H / out_h), int(y * H / out_h) + 1)
        for x in range(out_w):
            x0, x1 = int(x * W / out_w), max(int((x + 1) * W / out_w), int(x * W / out_w) + 1)
            blk = a[y0:y1, x0:x1].reshape(-1, 4)
            op = blk[blk[:, 3] >= 128]
            if len(op) * 2 < len(blk):
                continue
            q = (op[:, :3] // 8).astype(np.int32)
            keys = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]
            vals, counts = np.unique(keys, return_counts=True)
            k = vals[np.argmax(counts)]
            res[y, x, :3] = op[keys == k][:, :3].mean(0)
            res[y, x, 3] = 255
    return Image.fromarray(res, "RGBA")

def centre_sample(im, period):
    w, h = im.size
    nw, nh = max(1, round(w / period)), max(1, round(h / period))
    return block_mode_resize(im, nw, nh)  # mode within each detected pseudo-pixel

sprites = {}  # name -> (native, target)
for spec in sys.argv[4:]:
    kind, rest = spec.split(":", 1)
    if kind == "sheet":
        path, cols, rows = rest.rsplit(":", 2)
        cols, rows = int(cols), int(rows)
        src = Image.open(path)
        keyed, bg = key_bg(src)
        rgb = np.asarray(keyed.convert("RGB")) * (np.asarray(keyed)[:, :, 3:] > 0)
        px, py = pixel_period(rgb, 1), pixel_period(rgb, 0)
        period = (px + py) / 2
        base = os.path.splitext(os.path.basename(path))[0] + "_" + os.path.basename(os.path.dirname(path))
        report[base] = {"size": src.size, "bg_rgb": bg if isinstance(bg, str) else [round(v) for v in bg], "period_x": round(px, 2), "period_y": round(py, 2)}
        W, H = keyed.size
        for r in range(rows):
            for c in range(cols):
                cell = keyed.crop((c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows))
                cell = bbox_crop(cell)
                native = centre_sample(cell, period)
                tw = max(1, round(cell.width * TARGET_H / cell.height))
                target = block_mode_resize(cell, tw, TARGET_H)
                sprites[f"{base}_r{r}c{c}"] = (native, target)
        report[base]["native_cell_px"] = [list(sprites[f"{base}_r0c0"][0].size)]
    elif kind == "render":
        path = rest
        im = Image.open(path).convert("RGBA")
        name = os.path.splitext(os.path.basename(path))[0]
        sz = 48
        nearest = im.resize((sz, sz), Image.NEAREST)
        mode = block_mode_resize(im, sz, sz)
        sprites[name + "_nearest"] = (nearest, nearest)
        sprites[name + "_mode"] = (mode, mode)

# ---- shared palette across everything ----
def opaque_pixels(im):
    a = np.asarray(im)
    return a[a[:, :, 3] >= 128][:, :3]

allpx = np.concatenate([opaque_pixels(t) for n, t in sprites.values()] + [opaque_pixels(n) for n, t in sprites.values()])
allpx = np.unique((allpx // 4) * 4, axis=0)  # dedupe so big flat areas don't hog palette slots
strip = Image.fromarray(allpx.reshape(1, -1, 3).astype(np.uint8), "RGB")
if os.environ.get("PALETTE"):  # fixed curated palette file: one hex per line
    hexes = [l.strip().lstrip("#") for l in open(os.environ["PALETTE"]) if l.strip()]
    palette = [int(h[i:i + 2], 16) for h in hexes for i in (0, 2, 4)]
    NCOL = len(hexes)
    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette(palette + palette[:3] * (256 - NCOL))
else:
    pal_img = strip.quantize(colors=NCOL, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = pal_img.getpalette()[: NCOL * 3]
report["palette"] = ["#%02x%02x%02x" % tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]

def apply_pal(im):
    rgb = im.convert("RGB").quantize(palette=pal_img, dither=Image.Dither.NONE).convert("RGB")
    a = (np.asarray(im)[:, :, 3] >= 128).astype(np.uint8) * 255
    return Image.fromarray(np.dstack([np.asarray(rgb), a]), "RGBA")

for name, (native, target) in sprites.items():
    apply_pal(native).save(os.path.join(OUT, f"{name}_native.png"))
    apply_pal(target).save(os.path.join(OUT, f"{name}_h{TARGET_H}.png"))
    report.setdefault("sprites", {})[name] = {"native": native.size, "target": target.size}

json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in report.items() if k != "sprites"}, indent=1))
