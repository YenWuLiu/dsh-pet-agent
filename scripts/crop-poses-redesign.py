# 从「动作姿势表.png」裁出 12 张姿势图（白底原图，保持设定图本身画风）
# 用途：即梦 I2V 首帧姿势锚图（v2 重制版，四张表唯一基准）
# 输出：assets-custom/refs-redesign/姿势-01..12.png（白底，482×328）
# 用法：python scripts/crop-poses-redesign.py
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-custom' / 'ref-src' / '动作姿势表.png'
OUT = ROOT / 'assets-custom' / 'refs-redesign'
OUT.mkdir(parents=True, exist_ok=True)

# 网格坐标（与 make-pose-refs.py 一致）：4 列 3 行
COLS = [18, 527, 1036, 1545]
ROWS = [33, 424, 815]
CELL_W, CELL_H = 502, 386
PAD_TOP, PAD_BOTTOM, PAD_X = 6, 52, 10

img = Image.open(SRC).convert('RGB')
n = 0
for r in ROWS:
    for c in COLS:
        n += 1
        cell = img.crop((c + PAD_X, r + PAD_TOP, c + CELL_W - PAD_X, r + CELL_H - PAD_BOTTOM))
        dst = OUT / f'姿势-{n:02d}.png'
        cell.save(dst)
        print(f'姿势-{n:02d}.png  {cell.size[0]}x{cell.size[1]}')
print(f'完成，共 {n} 张 → {OUT}')
