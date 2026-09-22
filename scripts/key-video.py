# 通用 AI 视频 → 桌宠 640×360 VP9-Alpha 透明 webm 转换器
# 专为「白底/浅底/纯绿底」AI 生成片设计：colorkey 会吃白围裙，改用逐帧边界洪水填充抠背景。
# 管线：ffmpeg 解帧 → 每帧角点取样背景色 → 边界连通背景去除（ndimage.label）
#       → 腐蚀 1px 去白边 → 只保留最大连通域（去 AI生成 水印/Zzz/杂点）
#       → alpha 羽化 0.6 → （绿底时）边缘去绿 → 全片统一裁剪窗+缩放+锚定 → VP9-Alpha 编码
# 用法：
#   python scripts/key-video.py <src.mp4> <dst.webm> [--anchor frame0|bottom|center]
#         [--target-h 0.75] [--scale 1.0] [--thresh 26] [--bitrate 1M] [--keep-png 目录]
#
# 锚定（--anchor）：
#   frame0（默认，引擎契约）＝ 首帧（契约要求的中立站姿）角色高 → target_h×360，
#          首帧脚底 → FEET_Y=330、首帧水平中心 → x=320（与 runtime/electron-helper/shared-core.js 一致）。
#          凡动作幅度大的片（跳跃/抬手）必须走这个模式：按"整片 union"缩放会把站姿压小，
#          出现"待机正常、一点击就变小/悬空"（2026-09 实测事故，见 assets-custom/QA-NOTES.md）。
#   bottom ＝ 旧行为：裁窗底边距画布底 BOTTOM_MARGIN px（union 缩放，仅在无契约要求时用）
#   center ＝ 裁窗垂直居中
#   注意：frame0 以"首帧姿势"当站姿基准。首帧本来就是非站姿的片（如拖拽悬空 姿势-09）
#        只能得到近似比例，需人工复核或用 --anchor center。
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
FEET_Y = 330               # 引擎脚底线（shared-core.js FEET_Y）——frame0 锚定用
BOTTOM_MARGIN = 8          # bottom 锚定时脚底距画布底边 px
CENTER_X = CANVAS_W // 2

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--anchor', choices=['frame0', 'bottom', 'center'], default='frame0',
                help='锚定：frame0=引擎契约（首帧角色高→target_h、首帧脚底→FEET_Y、首帧水平中心→画布中心，默认）')
ap.add_argument('--target-h', type=float, default=0.75, help='角色窗高度占画布比例上限')
ap.add_argument('--scale', type=float, default=1.0, help='在自动缩放基础上再乘的修正系数')
ap.add_argument('--thresh', type=int, default=36, help='背景色最大通道差阈值')
ap.add_argument('--bitrate', default='1M')
ap.add_argument('--keep-png', default='', help='调试用：保留抠好的 RGBA 帧序列到该目录')
ap.add_argument('--workdir', default='', help='中间产物目录（默认系统临时目录；受限/沙箱环境请指定工作区内的已存在目录）')
ap.add_argument('--erode', type=int, default=2, help='alpha 腐蚀像素数（吃绿边，默认 2）')
ap.add_argument('--two-pass', action='store_true',
                help='两段背景（剪映导出：灰画布边 + 内嵌黑面板，面板不贴边第一炮洪水够不着）：'
                     '先按角点色洪水去灰边，再对露出的纯黑(<=8)面板二次洪水。黑底片有灰边时用')
ap.add_argument('--fps', type=float, default=0, help='强制输出帧率（0=自动探测；Seedance 60fps 片请传 60，避免探测到假 fps）')
args = ap.parse_args()

SRC = Path(args.src)
DST = Path(args.dst)
if not SRC.exists():
    raise SystemExit(f'找不到输入：{SRC}')
DST.parent.mkdir(parents=True, exist_ok=True)

# ---- 1. 解帧（原生帧率）----
tmp = Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix='dsh-key-'))
tmp.mkdir(parents=True, exist_ok=True)
frames_dir = tmp / 'frames'
frames_dir.mkdir(parents=True, exist_ok=True)
probe = subprocess.run([str(FFMPEG), '-i', str(SRC)], capture_output=True, text=True, encoding='utf-8', errors='replace')
if args.fps > 0:
    fps = args.fps
else:
    m = re.search(r'(\d+(?:\.\d+)?) fps', probe.stderr)
    fps = float(m.group(1)) if m else 24.0
    # 注意：不做「按时长×常见帧率校准」——ffprobe 的时长是四舍五入的，4.1s 片会被误判成 60fps
    # （实测 4.10s×60=246 整数 → 误选 60）。即梦/Kimi 片一律 24fps，直接信报告帧率；
    # 确需强制时用 --fps 参数（convert-jimeng-batch.ps1 默认传 24）。
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

    # 两段背景（--two-pass）：剪映导出片可能是「灰画布边 + 内嵌黑面板」——黑面板被灰边
    # 包住、不贴帧边界，第一炮洪水够不着（成片会把黑面板当角色保留）。第一炮去掉灰边后，
    # 把 (已判背景 ∪ 纯黑≤8) 一起打标签再洪一次：面板经灰边变得边界可达，且只清黑像素，
    # 深藏青裙发（>8）不受影响。
    if args.two_pass:
        blackish = (a.max(axis=2) <= 8)
        lab_b, _ = ndimage.label(blackish | is_bg)
        border_b = np.unique(np.concatenate([lab_b[0, :], lab_b[-1, :], lab_b[:, 0], lab_b[:, -1]]))
        border_b = border_b[border_b != 0]
        is_bg = is_bg | (np.isin(lab_b, border_b) & blackish)

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

# 参照帧 = 第 0 帧（契约要求的中立站姿）。bbox 为闭区间，这里换半开区间避免 ±1 误差：
#   ref_h = 首帧角色高、ref_feet = 首帧脚底、ref_cx = 首帧水平中心（源像素坐标）
ref_box = bboxes[0]
ref_x0, ref_y0 = ref_box[0], ref_box[1]
ref_x1, ref_y1 = ref_box[2] + 1, ref_box[3] + 1
ref_h, ref_feet, ref_cx = ref_y1 - ref_y0, float(ref_y1), (ref_x0 + ref_x1) / 2.0

if args.anchor == 'frame0':
    # 角色高按"首帧站姿"→ target_h×画布高（不是整片 union：跳跃/抬手的片会被压小）
    s = CANVAS_H * args.target_h / ref_h * args.scale
    fit = min(CANVAS_W / win_w, CANVAS_H / win_h)   # 装配余量：动作最大幅度也必须留在画布内
    if s > fit:
        print(f'!! 动作幅度超出画布：缩放 {s:.3f} 下调到 {fit:.3f}'
              f'（该片角色会比锚点矮，需回炉素材或缩小 --target-h）')
        s = fit
    out_w = max(2, int(win_w * s) // 2 * 2); out_h = max(2, int(win_h * s) // 2 * 2)
    # 首帧脚底 → FEET_Y、首帧水平中心 → 画布中心
    px = int(round(CENTER_X - (ref_cx - x0) * s))
    py = int(round(FEET_Y - (ref_feet - y0) * s))
    # 兜底：只在画布内平移，绝不裁掉内容（真被夹住说明装配算错，必须出声）
    px_c, py_c = px, py
    px = max(0, min(px, CANVAS_W - out_w)); py = max(0, min(py, CANVAS_H - out_h))
    if (px, py) != (px_c, py_c):
        print(f'!! 锚点被画布夹住：({px_c},{py_c}) → ({px},{py})，脚底线/中心线不达契约，需复核素材')
else:
    s = min(CANVAS_H * args.target_h / win_h, CANVAS_W * 0.9 / win_w) * args.scale
    out_w = max(2, int(win_w * s) // 2 * 2); out_h = max(2, int(win_h * s) // 2 * 2)
    px = CENTER_X - out_w // 2
    py = (CANVAS_H - BOTTOM_MARGIN - out_h) if args.anchor == 'bottom' else ((CANVAS_H - out_h) // 2)
print(f'裁剪窗 {win_w}×{win_h} -> {out_w}×{out_h}（缩放 {s:.3f}，锚定 {args.anchor} @({px},{py})）')
if args.anchor == 'frame0':
    print(f'  首帧角色高 {ref_h}px → {ref_h * s:.1f}px（目标 {CANVAS_H * args.target_h:.0f}），'
          f'脚底 → {py + (ref_feet - y0) * s:.1f}（FEET_Y={FEET_Y}），'
          f'中心 x → {px + (ref_cx - x0) * s:.1f}')

# ---- 4. 逐帧合成到 640×360 透明画布 ----
png_dir = Path(args.keep_png) if args.keep_png else (tmp / 'out')
png_dir.mkdir(parents=True, exist_ok=True)


def resize_rgba(crop: Image.Image, size) -> Image.Image:
    """预乘 alpha 后重采样再反预乘：直接对 RGBA 重采样会把"透明背景色"（白/绿）混进轮廓边，
    绿底片尤其明显（成品边缘一圈绿晕）。预乘后重采样等价于只对可见像素做插值。"""
    a = np.asarray(crop, dtype=np.float32)
    al = a[..., 3:4] / 255.0
    pm = np.dstack([a[..., :3] * al, a[..., 3]])
    out = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), 'RGBA')
    # 用 F 通道分别重采样，避开 8bit 预乘的量化误差（半透明羽化边会起噪点）
    chans = out.split()
    res = [np.asarray(c.convert('F').resize(size, Image.LANCZOS), dtype=np.float32) for c in chans]
    po = np.dstack(res)
    ao = po[..., 3:4]
    rgb = np.where(ao > 1e-6, po[..., :3] * 255.0 / np.maximum(ao, 1e-6), 0.0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(ao, 0, 255)]).astype(np.uint8), 'RGBA')


for i, rgba in enumerate(keyed):
    crop = resize_rgba(Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA'), (out_w, out_h))
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
