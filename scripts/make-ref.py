# 从表情包/设定图提取角色 → 透明化 → 合成到绿幕 848×480
# 用法：
#   python scripts/make-ref.py                       # 默认：吃干饭.png（带杂物擦除）→ ref.png
#   python scripts/make-ref.py <src> <dst>           # 指定输入输出
#   python scripts/make-ref.py <src> <dst> clean     # 干净图（单角色白底），跳过杂物擦除
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-custom' / 'ref-src' / '吃干饭.png'
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'assets-custom' / 'ref.png'
CLEAN = len(sys.argv) > 3 and sys.argv[3] == 'clean'

# ---- 1. 杂物擦除区（填纯白，基于 吃干饭.png 606x610 实测坐标；clean 模式跳过）----
ERASE_RECTS = [] if CLEAN else [
    (0, 0, 262, 165),      # 左上对话框
    (0, 165, 238, 350),    # 手指 + 闪光
    (95, 340, 265, 440),   # 「我不是大肥鱼」小气泡
    (0, 450, 275, 610),    # 碗（延伸到左边缘，保证与边缘白连通）
]

WHITE = (255, 255, 255)
# 不用纯绿 #00FF00（VAE 训练分布外，重建出噪点+漂移），改用自然绿 + 全图统一微噪点
GREEN = (53, 181, 88)
CANVAS_W, CANVAS_H = 848, 480
CHAR_HEIGHT_RATIO = 0.72   # 角色占画面高度比例
CHAR_CENTER_X_RATIO = 0.47 # 角色中心在画面宽度的位置

img = Image.open(SRC).convert('RGB')
a = np.asarray(img).copy()

for (x0, y0, x1, y1) in ERASE_RECTS:
    a[y0:y1, x0:x1] = WHITE

# ---- 2. 白底透明化：从全部边界像素 BFS 洪水填充近白色区域 ----
h, w, _ = a.shape
WHITE_THRESH = 20   # 越小越只认纯白：保护发箍等描边弱的白色件；太大背景 JPEG 噪点会残留
near_white = (a.astype(np.int16) - 255).__abs__().max(axis=2) <= WHITE_THRESH
visited = np.zeros((h, w), dtype=bool)

from collections import deque
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if near_white[y, x] and not visited[y, x]:
            q.append((y, x)); visited[y, x] = True
for y in range(h):
    for x in (0, w - 1):
        if near_white[y, x] and not visited[y, x]:
            q.append((y, x)); visited[y, x] = True

while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and near_white[ny, nx]:
            visited[ny, nx] = True
            q.append((ny, nx))

# 背景 → 全透明；角色 → 不透明
alpha = np.where(visited, 0, 255).astype(np.uint8)

# 轻微收缩 alpha（1px）去掉 JPEG 白边晕
from scipy import ndimage
alpha = np.where(ndimage.binary_erosion(alpha > 0, iterations=1), 255, 0).astype(np.uint8)

# 去孤点：只保留最大连通域（角色本体），去掉提取残留的零星小色斑
labels, n = ndimage.label(alpha > 0)
if n > 1:
    sizes = ndimage.sum(alpha > 0, labels, range(1, n + 1))
    keep = (np.argmax(sizes) + 1)
    alpha = np.where(labels == keep, 255, 0).astype(np.uint8)

rgba = np.dstack([a, alpha])
out = Image.fromarray(rgba, 'RGBA')

# ---- 3. 裁角色包围盒 ----
bbox = out.getbbox()
if bbox is None:
    raise SystemExit('抠完是空的——擦除区把角色吃掉了？')
out = out.crop(bbox)
print(f'角色包围盒: {bbox} -> {out.size}')

# ---- 4. 缩放到目标身高、贴上绿幕画布 ----
target_h = int(CANVAS_H * CHAR_HEIGHT_RATIO)
scale = target_h / out.height
target_w = max(1, int(out.width * scale))
out = out.resize((target_w, target_h), Image.LANCZOS)

canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), GREEN + (255,))
cx = int(CANVAS_W * CHAR_CENTER_X_RATIO)
x = cx - target_w // 2
y = CANVAS_H - target_h - 8   # 脚贴底部留 8px
canvas.paste(out, (x, y), out)

# 全图加 ±2 均匀噪点：让画布绿与贴入角色区的 JPEG 噪点特征一致，避免 VAE 重建出方框接缝
na = np.asarray(canvas.convert('RGB')).astype(np.int16)
noise = np.random.default_rng(7).integers(-2, 3, na.shape[:2])[:, :, None]
na = np.clip(na + noise, 0, 255).astype(np.uint8)
Image.fromarray(na, 'RGB').save(DST)
print(f'-> {DST}')
