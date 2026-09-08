# 从设定图裁抠 8 个图标 → assets-custom/pic/
# 光标 2 个（48x48）：手套指针（道具与特效表）
# 通知 6 个（256x256）：表情头（头部与表情.png 的 EMOTION FACES 八格）
# 用法：python scripts/make-icons.py
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC_PROPS = ROOT / 'assets-custom' / 'ref-src' / '道具与特效表.png'
SRC_FACES = ROOT / 'assets-custom' / 'ref-src' / '头部与表情.png'
OUT = ROOT / 'assets-custom' / 'pic'
OUT.mkdir(parents=True, exist_ok=True)

WHITE_THRESH = 22


def flood_transparent(img: Image.Image) -> Image.Image:
    """近白色背景（边界连通）→ 透明；只保留最大连通域。"""
    a = np.asarray(img.convert('RGB')).copy()
    h, w, _ = a.shape
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
    alpha = np.where(visited, 0, 255).astype(np.uint8)
    alpha = np.where(ndimage.binary_erosion(alpha > 0, iterations=1), 255, 0).astype(np.uint8)
    labels, n = ndimage.label(alpha > 0)
    if n > 1:
        sizes = ndimage.sum(alpha > 0, labels, range(1, n + 1))
        alpha = np.where(labels == int(np.argmax(sizes)) + 1, 255, 0).astype(np.uint8)
    rgba = np.dstack([a, alpha])
    out = Image.fromarray(rgba, 'RGBA')
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def pad_square(img: Image.Image, pad_ratio=0.06) -> Image.Image:
    w, h = img.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


# ---------- 光标：手套指针（道具与特效表 2048x1152 的 MOUSE POINTER 区域） ----------
props = Image.open(SRC_PROPS).convert('RGB')
glove = flood_transparent(props.crop((1425, 495, 1575, 650)))
glove = pad_square(glove, 0.04)
# grab = 原样（张开/指向）；grabbing = 旋转收拢 + 略缩 + 微暗，模拟「抓住」
grab = glove.resize((48, 48), Image.LANCZOS)
grab.save(OUT / 'cursor-grab.png')
grabbing = glove.rotate(18, expand=True, resample=Image.BICUBIC)
grabbing = grabbing.resize((42, 42), Image.LANCZOS)
# 稍微压暗区分状态
ga = np.asarray(grabbing).astype(np.float32)
ga[:, :, :3] *= 0.88
grabbing = Image.fromarray(np.clip(ga, 0, 255).astype(np.uint8), 'RGBA')
g2 = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
g2.paste(grabbing, (3, 3), grabbing)
g2.save(OUT / 'cursor-grabbing.png')
print('cursor-grab.png / cursor-grabbing.png')

# ---------- 通知图标：表情头（头部与表情.png 2048x1152，EMOTION FACES 2行4列） ----------
# 实测坐标（网格校准）：脸在第 515~745 / 825~1055 行，说明文字在 750/1060 行以下排除
faces = Image.open(SRC_FACES).convert('RGB')
COL_X = [(25, 285), (315, 575), (605, 865), (895, 1155)]
ROW_Y = [(515, 742), (825, 1048)]
# 表情位置（行,列 0基）：1 normal(0,0) 2 sparkling joy(0,1) 3 sad(0,2) 4 angry(0,3)
#                    5 sleepy(1,0) 6 teary(1,1) 7 dizzy(1,2) 8 in-love(1,3)
ICON_MAP = {
    'notify-done':      (0, 1),   # 星星眼开心 = 对话完成
    'notify-error':     (1, 1),   # 泪眼汪汪 = 生成失败
    'notify-truncated': (1, 2),   # 蚊香眼晕 = 输出截断
    'notify-approval':  (0, 2),   # 垂眼委屈 = 求批准
    'notify-question':  (0, 0),   # 平常脸 = 等待回答
    'notify-test':      (1, 3),   # 爱心眼 = 测试通知
}
for name, (r, c) in ICON_MAP.items():
    x0, x1 = COL_X[c]
    y0, y1 = ROW_Y[r]
    face = flood_transparent(faces.crop((x0, y0, x1, y1)))
    face = pad_square(face, 0.05).resize((256, 256), Image.LANCZOS)
    face.save(OUT / f'{name}.png')
    print(f'{name}.png <- 表情({r},{c})')

print('完成 ->', OUT)
