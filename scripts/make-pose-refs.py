# 从「动作姿势表.png」(2048x1152, 4列x3行) 裁出 12 个姿势，逐个抠白底 → 绿幕 848x480
# 输出：assets-custom/refs/pose-<编号>.png
# 用法：python scripts/make-pose-refs.py
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-custom' / 'ref-src' / '动作姿势表.png'
OUT = ROOT / 'assets-custom' / 'refs'
OUT.mkdir(parents=True, exist_ok=True)

GREEN = (53, 181, 88)
CANVAS_W, CANVAS_H = 848, 480

# 网格：卡片间有间隙，取内边距避开卡片描边/标题栏
# 4 列 3 行；列边界 x≈[18,527,1036,1545]+宽≈502，行 y≈[33,424,815]+高≈386
COLS = [18, 527, 1036, 1545]
ROWS = [33, 424, 815]
CELL_W, CELL_H = 502, 386
# 裁掉卡片边框（上下少许）；说明文字在卡片底部，靠去孤点丢弃
PAD_TOP, PAD_BOTTOM, PAD_X = 6, 52, 10

# 需要擦除杂物的格子（1 基编号）→ 格子内坐标擦除矩形 (x0,y0,x1,y1)
# 竖杆（7）、顶边横杆（8）等
ERASE = {
    7:  [(0, 0, 40, CELL_H)],                # 左侧竖杆（她双手抓着的边缘）
    8:  [(0, 0, CELL_W, 40)],                # 顶部横边（悬挂点）
    10: [(0, 0, 60, CELL_H), (CELL_W - 60, 0, CELL_W, CELL_H)],  # 两侧速度线
}

# 肤色定向擦除（pose 9 抓头大手：与角色头部接触，矩形会误伤她，改按肤色像素清除）
# R>225 & G>175 & B>150 & R-B>25，仅限格子上半区
SKIN_ERASE_UPPER_HALF = {9}

WHITE_THRESH = 22

def flood_alpha(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    near_white = (rgb.astype(np.int16) - 255).__abs__().max(axis=2) <= WHITE_THRESH
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
    return np.where(visited, 0, 255).astype(np.uint8)

from scipy import ndimage

n_pose = 0
for r, ry in enumerate(ROWS):
    for c, cx in enumerate(COLS):
        n_pose += 1
        cell = np.asarray(Image.open(SRC).convert('RGB'))[
            ry + PAD_TOP: ry + CELL_H - PAD_BOTTOM, cx + PAD_X: cx + CELL_W - PAD_X
        ].copy()
        for (x0, y0, x1, y1) in ERASE.get(n_pose, []):
            cell[y0:y1, x0:x1] = 255
        if n_pose in SKIN_ERASE_UPPER_HALF:
            hh = cell.shape[0] // 2
            upper = cell[:hh].astype(np.int16)
            skin = (upper[:, :, 0] > 225) & (upper[:, :, 1] > 175) & (upper[:, :, 2] > 150) & ((upper[:, :, 0] - upper[:, :, 2]) > 25)
            cell[:hh][skin] = 255

        alpha = flood_alpha(cell)
        alpha = np.where(ndimage.binary_erosion(alpha > 0, iterations=1), 255, 0).astype(np.uint8)
        labels, n = ndimage.label(alpha > 0)
        if n == 0:
            print(f'pose {n_pose}: 抠空！')
            continue
        if n > 1:
            sizes = ndimage.sum(alpha > 0, labels, range(1, n + 1))
            alpha = np.where(labels == int(np.argmax(sizes)) + 1, 255, 0).astype(np.uint8)

        rgba = np.dstack([cell, alpha])
        out = Image.fromarray(rgba, 'RGBA')
        bbox = out.getbbox()
        if bbox is None:
            print(f'pose {n_pose}: 空包围盒！')
            continue
        out = out.crop(bbox)

        target_h = int(CANVAS_H * 0.72)
        scale = target_h / out.height
        target_w = max(1, int(out.width * scale))
        out = out.resize((target_w, target_h), Image.LANCZOS)

        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), GREEN + (255,))
        x = int(CANVAS_W * 0.47) - target_w // 2
        y = CANVAS_H - target_h - 8
        canvas.paste(out, (max(0, x), max(0, y)), out)
        na = np.asarray(canvas.convert('RGB')).astype(np.int16)
        noise = np.random.default_rng(7).integers(-2, 3, na.shape[:2])[:, :, None]
        na = np.clip(na + noise, 0, 255).astype(np.uint8)
        dst = OUT / f'pose-{n_pose}.png'
        Image.fromarray(na, 'RGB').save(dst)
        print(f'pose {n_pose}: bbox={bbox} -> {dst}')
print('完成')
