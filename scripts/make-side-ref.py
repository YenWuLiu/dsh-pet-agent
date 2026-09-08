# 从 三视图与表情.png 裁 SIDE 侧面视图 → 抠浅蓝灰底 → 贴 #35B558+噪点 绿幕 848×480
# 用法: python scripts/make-side-ref.py [box]
#   box 格式 "x0,y0,x1,y1"（默认 555,95,880,670，按 2048×1152 原图实测）
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-custom' / 'ref-src' / '三视图与表情.png'
DST = ROOT / 'assets-custom' / 'ref-stand-side.png'
DEBUG_CROP = ROOT / 'tools' / 'side-crop-debug.png'

BOX = (555, 95, 880, 670)
if len(sys.argv) > 1:
    BOX = tuple(int(v) for v in sys.argv[1].split(','))

GREEN = (53, 181, 88)
CANVAS_W, CANVAS_H = 848, 480
CHAR_HEIGHT_RATIO = 0.72
CHAR_CENTER_X_RATIO = 0.47

img = Image.open(SRC).convert('RGB')
print(f'原图: {img.size}, 裁剪框: {BOX}')
crop = img.crop(BOX)
DEBUG_CROP.parent.mkdir(parents=True, exist_ok=True)
crop.save(DEBUG_CROP)
a = np.asarray(crop).copy()
h, w, _ = a.shape

# ---- 背景色：取四角像素中位数（浅蓝灰底，非纯白）----
corners = np.concatenate([a[0:8, 0:8].reshape(-1, 3), a[0:8, -8:].reshape(-1, 3),
                          a[-8:, 0:8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
bg = np.median(corners, axis=0)
print(f'背景色: {bg}')

# ---- 脚下阴影：保留（参考图用途，淡淡投影反而自然）；不预擦除，洪水阈值只认浅蓝灰底 ----

# ---- BFS 洪水填充：从边界吃近背景色 ----
THRESH = 28
near_bg = (a.astype(np.int16) - bg.astype(np.int16)).__abs__().max(axis=2) <= THRESH
visited = np.zeros((h, w), dtype=bool)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if near_bg[y, x] and not visited[y, x]:
            q.append((y, x)); visited[y, x] = True
for y in range(h):
    for x in (0, w - 1):
        if near_bg[y, x] and not visited[y, x]:
            q.append((y, x)); visited[y, x] = True
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and near_bg[ny, nx]:
            visited[ny, nx] = True
            q.append((ny, nx))

alpha = np.where(visited, 0, 255).astype(np.uint8)
alpha = np.where(ndimage.binary_erosion(alpha > 0, iterations=1), 255, 0).astype(np.uint8)
labels, n = ndimage.label(alpha > 0)
if n > 1:
    sizes = ndimage.sum(alpha > 0, labels, range(1, n + 1))
    keep = int(np.argmax(sizes)) + 1
    alpha = np.where(labels == keep, 255, 0).astype(np.uint8)

rgba = np.dstack([a, alpha])
out = Image.fromarray(rgba, 'RGBA')
bbox = out.getbbox()
if bbox is None:
    raise SystemExit('抠完是空的——裁剪框没框住角色？')
out = out.crop(bbox)
print(f'角色包围盒: {bbox} -> {out.size}')

target_h = int(CANVAS_H * CHAR_HEIGHT_RATIO)
scale = target_h / out.height
target_w = max(1, int(out.width * scale))
out = out.resize((target_w, target_h), Image.LANCZOS)

canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), GREEN + (255,))
cx = int(CANVAS_W * CHAR_CENTER_X_RATIO)
x = cx - target_w // 2
y = CANVAS_H - target_h - 8
canvas.paste(out, (x, y), out)

na = np.asarray(canvas.convert('RGB')).astype(np.int16)
noise = np.random.default_rng(7).integers(-2, 3, na.shape[:2])[:, :, None]
na = np.clip(na + noise, 0, 255).astype(np.uint8)
Image.fromarray(na, 'RGB').save(DST)
print(f'-> {DST}')
