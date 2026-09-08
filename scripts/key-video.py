# 通用 AI 视频 → 桌宠 640×360 VP9-Alpha 透明 webm 转换器
# 专为「白底/浅底/纯绿底」AI 生成片设计：colorkey 会吃白围裙，改用逐帧边界洪水填充抠背景。
# 管线：ffmpeg 解帧 → 每帧角点取样背景色 → 边界连通背景去除（ndimage.label）
#       → 腐蚀 1px 去白边 → 只保留最大连通域（去 AI生成 水印/Zzz/杂点）
#       → alpha 羽化 0.6 → （绿底时）边缘去绿 → 全片统一裁剪窗+缩放+锚定 → VP9-Alpha 编码
# 用法：
#   python scripts/key-video.py <src.mp4> <dst.webm> [--anchor bottom|center]
#         [--target-h 0.75] [--scale 1.0] [--thresh 26] [--bitrate 1M] [--keep-png 目录]
import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'

CANVAS_W, CANVAS_H = 640, 360
BOTTOM_MARGIN = 8          # bottom 锚定时脚底距画布底边 px
CENTER_X = CANVAS_W // 2

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--anchor', choices=['bottom', 'center'], default='bottom')
ap.add_argument('--target-h', type=float, default=0.75, help='角色窗高度占画布比例上限')
ap.add_argument('--scale', type=float, default=1.0, help='在自动缩放基础上再乘的修正系数')
ap.add_argument('--thresh', type=int, default=36, help='背景色最大通道差阈值')
ap.add_argument('--bitrate', default='1M')
ap.add_argument('--keep-png', default='', help='调试用：保留抠好的 RGBA 帧序列到该目录')
ap.add_argument('--erode', type=int, default=2, help='alpha 腐蚀像素数（吃绿边，默认 2）')
args = ap.parse_args()

SRC = Path(args.src)
DST = Path(args.dst)
if not SRC.exists():
    raise SystemExit(f'找不到输入：{SRC}')
DST.parent.mkdir(parents=True, exist_ok=True)

# ---- 1. 解帧（原生帧率）----
tmp = Path(tempfile.mkdtemp(prefix='dsh-key-'))
frames_dir = tmp / 'frames'
frames_dir.mkdir()
probe = subprocess.run([str(FFMPEG), '-i', str(SRC)], capture_output=True, text=True, encoding='utf-8', errors='replace')
m = re.search(r'(\d+(?:\.\d+)?) fps', probe.stderr)
fps = float(m.group(1)) if m else 24.0
subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
                '-i', str(SRC), str(frames_dir / '%04d.png')], check=True)
files = sorted(frames_dir.glob('*.png'))
if not files:
    raise SystemExit('解帧失败')
print(f'{SRC.name}: {len(files)} 帧 @ {fps:g}fps')

# ---- 2. 逐帧抠像 ----
keyed = []   # (rgba_uint8 HxWx4)
bboxes = []
for i, fp in enumerate(files):
    a = np.asarray(Image.open(fp).convert('RGB')).astype(np.int16)
    h, w, _ = a.shape
    corners = np.concatenate([a[0:8, 0:8].reshape(-1, 3), a[0:8, -8:].reshape(-1, 3),
                              a[-8:, 0:8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    near_bg = (np.abs(a - bg).max(axis=2) <= args.thresh)

    # 边界连通的近背景色 = 背景（label 向量化，等价边界 BFS）
    lab, n = ndimage.label(near_bg)
    border = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    is_bg = np.isin(lab, border)

    # 绿幕加成：全图「绿占优」像素直接判背景，不依赖连通性
    # （阴影绿腔/暗色通道/边缘绿染全是 g>r,b；角色蓝发白裙无绿色件，零误伤）
    green_screen = bool(bg[1] > bg[0] * 1.3 and bg[1] > bg[2] * 1.3)
    if green_screen:
        greenish = (a[:, :, 1] > a[:, :, 0] + 12) & (a[:, :, 1] > a[:, :, 2] + 12)
        is_bg = is_bg | greenish

    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    alpha = np.where(ndimage.binary_erosion(alpha > 0, iterations=args.erode), 255, 0).astype(np.uint8)
    lab2, n2 = ndimage.label(alpha > 0)
    if n2 == 0:
        raise SystemExit(f'第 {i} 帧抠空了——阈值 {args.thresh} 太大或背景取样异常（bg={bg}）')
    if n2 > 1:
        sizes = ndimage.sum(alpha > 0, lab2, range(1, n2 + 1))
        keep = int(np.argmax(sizes)) + 1
        alpha = np.where(lab2 == keep, 255, 0).astype(np.uint8)

    # 封闭绿腔清除：角色轮廓围住的孔洞里，凡绿占优像素一律透明
    # （发绺缝隙/耳褶/尾鳍弯里的阴影绿，边界洪水够不着、阈值也认不出，但 g 占优是铁证；
    #   角色全身蓝/白/肤无绿色件，误伤为零）
    holes = ndimage.binary_fill_holes(alpha > 0) & ~(alpha > 0)
    if holes.any():
        rr = a[:, :, 0]; gg = a[:, :, 1]; bb = a[:, :, 2]
        kill = holes & (gg > rr + 5) & (gg > bb + 5)
        alpha[kill] = 0

    # alpha 羽化（软边，桌面显示更自然）
    alpha_f = np.clip(ndimage.gaussian_filter(alpha.astype(np.float64), 0.6), 0, 255)

    rgb = a.astype(np.uint8)
    # 绿底去绿（仅当背景明显偏绿）：所有「可见像素」（含轮廓内侧与羽化光晕区）里
    # 绿占优的一律把 g 压到 max(r,b)+20——蓝发/白裙/肤色的 g 都不占优，天然豁免
    if bg[1] > bg[0] * 1.3 and bg[1] > bg[2] * 1.3:
        r, g, b = rgb[:, :, 0].astype(np.int16), rgb[:, :, 1].astype(np.int16), rgb[:, :, 2].astype(np.int16)
        mx = np.maximum(r, b)
        greenish = (alpha_f > 8) & (g > mx + 8)
        g2 = np.where(greenish, np.minimum(g, mx + 20), g)
        rgb = np.dstack([r, g2, b]).clip(0, 255).astype(np.uint8)

    rgba = np.dstack([rgb, alpha_f.astype(np.uint8)])
    keyed.append(rgba)
    ys, xs = np.where(alpha_f > 40)
    bboxes.append((xs.min(), ys.min(), xs.max(), ys.max()))

# ---- 3. 全片统一裁剪窗（各帧 bbox 并集 + 3% 衬垫，裁切防抖）----
x0 = min(b[0] for b in bboxes); y0 = min(b[1] for b in bboxes)
x1 = max(b[2] for b in bboxes); y1 = max(b[3] for b in bboxes)
pad_x = int((x1 - x0) * 0.03); pad_y = int((y1 - y0) * 0.03)
H0, W0 = keyed[0].shape[:2]
x0 = max(0, x0 - pad_x); y0 = max(0, y0 - pad_y)
x1 = min(W0, x1 + pad_x); y1 = min(H0, y1 + pad_y)
win_w, win_h = x1 - x0, y1 - y0

s = min(CANVAS_H * args.target_h / win_h, CANVAS_W * 0.9 / win_w) * args.scale
out_w = max(2, int(win_w * s) // 2 * 2); out_h = max(2, int(win_h * s) // 2 * 2)
if args.anchor == 'bottom':
    px = CENTER_X - out_w // 2
    py = CANVAS_H - BOTTOM_MARGIN - out_h
else:
    px = CENTER_X - out_w // 2
    py = (CANVAS_H - out_h) // 2
print(f'裁剪窗 {win_w}×{win_h} -> {out_w}×{out_h}（缩放 {s:.3f}，锚定 {args.anchor} @({px},{py})）')

# ---- 4. 逐帧合成到 640×360 透明画布 ----
png_dir = Path(args.keep_png) if args.keep_png else (tmp / 'out')
png_dir.mkdir(parents=True, exist_ok=True)
for i, rgba in enumerate(keyed):
    crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').resize((out_w, out_h), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    canvas.paste(crop, (px, py), crop)
    canvas.save(png_dir / f'{i:04d}.png')

# ---- 5. VP9-Alpha 编码 ----
subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
                '-framerate', f'{fps:g}', '-i', str(png_dir / '%04d.png'),
                '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
                '-b:v', args.bitrate, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1',
                '-an', str(DST)], check=True)
print(f'-> {DST}（{DST.stat().st_size // 1024} KB）')

if not args.keep_png:
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
