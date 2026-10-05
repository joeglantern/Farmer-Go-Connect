"""
Slice the ChatGPT sheets in design/generated/ into app assets (apps/app/src/assets/img/).
Re-runnable: python design/slice_assets.py
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'generated'
OUT = ROOT.parent / 'apps' / 'app' / 'src' / 'assets' / 'img'
STORE = ROOT / 'store'
for d in ['categories', 'roles', 'banners', 'produce', 'farmers', 'farms', 'badges', 'patterns', 'photos']:
    (OUT / d).mkdir(parents=True, exist_ok=True)
STORE.mkdir(exist_ok=True)


def load(n):
    return Image.open(SRC / f'raw-{n:02d}.png').convert('RGB')


def save_webp(im, path, size=None, q=82):
    if size:
        im = im.copy()
        im.thumbnail(size, Image.LANCZOS)
    im.save(path, 'WEBP', quality=q, method=6)


# ─── helpers ────────────────────────────────────────────────────


def bands(mask_1d, min_len):
    """Runs of True in a 1D boolean array, as (start, end) with end exclusive."""
    runs, start = [], None
    for i, v in enumerate(mask_1d):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    if start is not None and len(mask_1d) - start >= min_len:
        runs.append((start, len(mask_1d)))
    return runs


def content_bbox(arr, bg, tol=18):
    """Bounding box of pixels that differ from the background colour."""
    diff = np.abs(arr.astype(int) - np.array(bg)[None, None, :]).max(axis=2)
    ys, xs = np.where(diff > tol)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def cut_out(im, bg, tol=22, soft=10):
    """Remove a flat background by flood fill from the edges, with a soft alpha edge."""
    arr = np.asarray(im).astype(int)
    h, w, _ = arr.shape
    dist = np.abs(arr - np.array(bg)[None, None, :]).max(axis=2)
    bgmask = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if dist[y, x] <= tol and not bgmask[y, x]:
                bgmask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dist[y, x] <= tol and not bgmask[y, x]:
                bgmask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not bgmask[ny, nx] and dist[ny, nx] <= tol:
                bgmask[ny, nx] = True
                q.append((ny, nx))
    # Soft shadows: pixels near the background colour but reached by the fill become partly transparent.
    alpha = np.where(bgmask, 0, 255).astype(np.uint8)
    a = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.2))
    # Keep a faint contact shadow: background pixels that are darker than bg get alpha by darkness.
    lum_bg = sum(bg) / 3
    lum = arr.mean(axis=2)
    shadow = np.clip((lum_bg - lum) * 4, 0, 90).astype(np.uint8)
    a = np.maximum(np.asarray(a), np.where(bgmask, shadow, 0).astype(np.uint8))
    rgba = np.dstack([np.asarray(im), a]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def square_pad(im, pad_ratio=0.06):
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return out


def clean_edges(im, bgc, tol=28, max_share=0.04):
    """Paint out small fragments of neighbouring cells that touch the crop's edge."""
    from scipy import ndimage

    arr = np.asarray(im).copy()
    diff = np.abs(arr.astype(int) - np.array(bgc)[None, None, :]).max(axis=2) > tol
    labels, n = ndimage.label(diff)
    h, w = diff.shape
    edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    sizes = ndimage.sum(diff, labels, range(1, n + 1))
    for lab in edge:
        if sizes[lab - 1] < max_share * h * w:
            m = ndimage.binary_dilation(labels == lab, iterations=3)
            arr[m] = bgc
    return Image.fromarray(arr)


def grid_cells(im, cols, rows, box=None):
    x0, y0, x1, y1 = box or (0, 0, im.width, im.height)
    cw, ch = (x1 - x0) / cols, (y1 - y0) / rows
    for r in range(rows):
        for c in range(cols):
            yield r, c, (int(x0 + c * cw), int(y0 + r * ch), int(x0 + (c + 1) * cw), int(y0 + (r + 1) * ch))


def spot_art(sheet, cols, rows, names, bg, folder, tol=22, size=512):
    """Illustrations on a flat background: crop each cell to its content, cut out, square, save."""
    for (r, c, box), name in zip(grid_cells(sheet, cols, rows), names):
        cell = sheet.crop(box)
        arr = np.asarray(cell)
        bb = content_bbox(arr, bg, tol=tol)
        m = 6
        bb = (max(bb[0] - m, 0), max(bb[1] - m, 0), min(bb[2] + m, cell.width), min(bb[3] + m, cell.height))
        art = cut_out(cell.crop(bb), bg, tol=tol)
        art = square_pad(art)
        art.thumbnail((size, size), Image.LANCZOS)
        art.save(OUT / folder / f'{name}.webp', 'WEBP', quality=88, method=6)
        print('art', folder, name, art.size)


def photo_panels(im, axis, white=246, min_gap=4, min_len=80):
    """Split a sheet of photos on white gutters along an axis (0 = rows, 1 = columns)."""
    arr = np.asarray(im.convert('L'))
    line_is_white = (arr > white).mean(axis=1 - axis) > 0.97
    return bands(~line_is_white, min_len)


# ─── Batch 1: categories (4 x 2 on white) ──────────────────────
spot_art(
    load(1), 4, 2,
    ['vegetables', 'fruits', 'meat-poultry', 'dairy', 'grains-staples', 'value-added', 'natural-fertilizers', 'all'],
    (255, 255, 255), 'categories', tol=14,
)

# ─── Batch 2: roles (2 x 2 on pale green) ──────────────────────
roles = load(2)
bg = tuple(int(v) for v in np.asarray(roles)[5, 5])
spot_art(roles, 2, 2, ['hotel', 'farmer', 'youth', 'household'], bg, 'roles', tol=16)

# ─── Batch 3: welcome hero ─────────────────────────────────────
save_webp(load(3), OUT / 'photos' / 'hero-welcome.webp', (1024, 1536), q=80)

# ─── Batch 4: banners (three stacked photos) ───────────────────
ban = load(4)
for i, (y0, y1) in enumerate(photo_panels(ban, 0)):
    save_webp(ban.crop((0, y0, ban.width, y1)), OUT / 'banners' / f'banner-{i + 1}.webp', (1200, 600), q=80)
    print('banner', i + 1, y1 - y0)

# ─── Batch 5: produce (2 x 2 panels of 3 x 3) ──────────────────
PRODUCE = [
    ['tomatoes', 'kale', 'spinach', 'onions', 'cabbage', 'carrots', 'capsicum', 'french-beans', 'courgettes'],
    ['potatoes', 'sweet-potatoes', 'avocados', 'bananas', 'mangoes', 'passion-fruit', 'pineapple', 'watermelon', 'coriander'],
    ['ginger', 'garlic', 'kidney-beans', 'green-grams', 'maize', 'eggs', 'milk', 'honey', 'peanut-butter'],
    ['beef', 'goat-meat', 'chicken', 'dried-mango', 'yoghurt', 'ghee', 'arrowroots', 'managu', 'terere'],
]
prod = load(5)
rows_ = photo_panels(prod, 0, white=238, min_len=200)
cols_ = photo_panels(prod, 1, white=238, min_len=200)
print('produce panels', rows_, cols_)
panels = [(c0, r0, c1, r1) for (r0, r1) in rows_ for (c0, c1) in cols_]
for p, (box, names) in enumerate(zip(panels, PRODUCE)):
    for (r, c, cell), name in zip(grid_cells(prod, 3, 3, box), names):
        x0, y0, x1, y1 = cell
        ix, iy = int((x1 - x0) * 0.07), int((y1 - y0) * 0.07)
        inner = (x0 + ix, y0 + iy, x1 - ix, y1 - iy)
        sub = np.asarray(prod.crop(inner))
        bgc = tuple(int(v) for v in np.median(sub[:6].reshape(-1, 3), axis=0))
        bb = content_bbox(sub, bgc, tol=28)
        bx0, by0, bx1, by1 = (inner[0] + bb[0], inner[1] + bb[1], inner[0] + bb[2], inner[1] + bb[3]) if bb else inner
        cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
        side = int(max(bx1 - bx0, by1 - by0) * 1.16)
        side = min(side, inner[2] - inner[0], inner[3] - inner[1])
        cx = min(max(cx, inner[0] + side // 2), inner[2] - side // 2)
        cy = min(max(cy, inner[1] + side // 2), inner[3] - side // 2)
        sq = prod.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
        save_webp(clean_edges(sq, bgc), OUT / 'produce' / f'{name}.webp', (360, 360), q=82)

# ─── Batch 6: farmer portraits (3 x 2), farm scenes ────────────
def photo_grid(im, cols, rows, white=246):
    r_ = photo_panels(im, 0, white=white, min_len=150)
    c_ = photo_panels(im, 1, white=white, min_len=150)
    assert len(r_) == rows and len(c_) == cols, (r_, c_)
    return [(c0, r0, c1, r1) for (r0, r1) in r_ for (c0, c1) in c_]


fr = load(7)
for i, box in enumerate(photo_grid(fr, 3, 2)):
    save_webp(fr.crop(box), OUT / 'farmers' / f'farmer-{i + 1}.webp', (480, 480), q=80)

farms = load(8)
cells = photo_grid(farms, 3, 2)
save_webp(farms.crop(cells[4]), OUT / 'farms' / 'orchard.webp', (720, 720), q=80)
save_webp(farms.crop(cells[5]), OUT / 'farms' / 'nursery.webp', (720, 720), q=80)
split = load(11)
c_ = photo_panels(split, 1, white=246, min_len=150)
r_ = photo_panels(split.crop((c_[1][0], 0, c_[1][1], split.height)), 0, white=246, min_len=150)
save_webp(split.crop((c_[0][0], 0, c_[0][1], split.height)), OUT / 'farms' / 'rows-aerial.webp', (720, 1440), q=80)
save_webp(split.crop((c_[1][0], r_[0][0], c_[1][1], r_[0][1])), OUT / 'photos' / 'handover.webp', (1200, 900), q=80)

# ─── Batch 8 and 9: badges and textures ────────────────────────
bt = load(10)
arr = np.asarray(bt.convert('L'))
rows_bt = bands(~((arr > 246).mean(axis=1) > 0.97), 60)
print('badge/texture rows', rows_bt)
badge_box = (0, rows_bt[0][0], bt.width, rows_bt[-2][1] if len(rows_bt) > 2 else rows_bt[0][1])
badges = bt.crop(badge_box)
spot_art(badges, 3, 2, ['qualityChecked', 'organic', 'local', 'youthLed', 'womanLed', 'verified'], (255, 255, 255), 'badges', tol=14, size=256)
tex = bt.crop((0, rows_bt[-1][0], bt.width, rows_bt[-1][1]))
tc = photo_panels(tex, 1, white=250, min_len=80)
print('texture cols', tc)
for (x0, x1), name in zip(tc, ['leaves', 'rows', 'paper', 'linen']):
    tile = tex.crop((x0 + 6, 6, x1 - 6, tex.height - 6))
    tile.thumbnail((256, 256), Image.LANCZOS)
    # Mirror into a 2 x 2 block so the tile repeats without seams.
    w, h = tile.size
    block = Image.new('RGB', (w * 2, h * 2))
    block.paste(tile, (0, 0))
    block.paste(tile.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    block.paste(tile.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    block.paste(tile.transpose(Image.ROTATE_180), (w, h))
    block.save(OUT / 'patterns' / f'{name}.webp', 'WEBP', quality=84, method=6)

# ─── Batch 10: splash and store ────────────────────────────────
wide = load(12)
fg = wide.crop((0, 0, wide.width, wide.height))
fg = fg.resize((1024, int(1024 * wide.height / wide.width)), Image.LANCZOS)
top = (fg.height - 500) // 2
fg.crop((0, top, 1024, top + 500)).save(STORE / 'feature-graphic.png')
save_webp(wide, OUT / 'photos' / 'handover-wide.webp', (1800, 900), q=78)
print('done')
