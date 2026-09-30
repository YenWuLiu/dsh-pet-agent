# -*- coding: utf-8 -*-
"""出 README 用的动画预览 GIF：assets/webm/<名>.webm → assets/preview/<名>.gif

为什么需要这一层：**GitHub 的 markdown 不能内嵌仓库里的 webm**（`<video>` 会被 sanitize
掉、`![](x.webm)` 也不出画面），README 里不摆动画，52 条素材就等于不存在。所以把要展示的
几条转成 GIF —— 上游 dsh-pet 也是这么做的（它发 `assets/preview/*.gif`）。

三个必须写下来的决定：

1. **解码必须带 `-c:v libvpx-vp9`**：VP9-Alpha 的 alpha 存在 WebM 的 BlockAdditional
   侧数据里，原生 vp9 解码器只给 yuv420p。少了这个开关，出来的 GIF **背景是纯黑而不是
   透明**（实测：压在浅色 README 上就是一块黑板），而且 ffmpeg **一声不吭**——
   静默错，只能靠眼睛发现。与 `normalize-webm.py` 的 `in_decoder()` 同一处坑。

2. **逐条裁方窗再缩放**：webm 是 640×360，而角色只占中间约 210×272。整帧直接缩到 200px
   宽，角色只剩 76px 高、在 README 里看不清；按「全部内容 bbox」裁一个正方形再缩到 SIDE，
   同样的显示宽度下角色能大一倍。bbox 口径与 `normalize-webm.py` 的 union_all 一致
   （alpha > ALPHA_THR 的所有像素），所以手里的乐器、头顶的气泡、鲸鱼虚影都不会被切掉。

3. **GIF 只有 1 位 alpha**：webm 是软件 alpha（边缘抗锯齿），GIF 只能"一个像素要么全透明、
   要么全不透明"，所以边缘会比 webm 略硬、头发渐变会有一点点色带。这是 GIF 格式的硬限制
   （上游那批预览 GIF 也是这个样子），不是参数没调好——要看原画质直接开 `assets/webm/`。

用法：
  python scripts/make-previews.py                # 出 README 展示的那 9 条（默认清单）
  python scripts/make-previews.py 吃Token 撸猫    # 出指定的几条
  python scripts/make-previews.py --all          # 出全部 52 条（约 25 MB，README 只用 9 条）
  python scripts/make-previews.py --side 280     # 改输出边长（默认 224）
"""
from __future__ import annotations

import argparse
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
WEBM = ROOT / 'assets' / 'webm'
DEFAULT_OUT = ROOT / 'assets' / 'preview'

CW, CH = 640, 360        # assets/webm/ 的画布（引擎契约，见 assets/README.md）
ALPHA_THR = 40           # 「内容」阈值：与 normalize-webm.py 的 union_all 同口径
MARGIN = 1.12            # bbox 外扩比例：留出抗锯齿边缘，绝不切到内容
SIDE = 180               # 输出正方形边长（README 里按 width=160 显示）
FPS = 12                 # 30fps 降采样。GIF 体积几乎与帧数成正比：14→12 省 20%，画质看不出
MAX_COLORS = 64          # 256 档里留 1 档给全透明。128→64 省约 30%，180px 下几乎看不出色带
ALPHA_CUT = 128          # 半透明像素归"不透明"还是"透明"的分界

# 实测（吃Token，本项目最"忙"的一条，180px/12fps）：none 815 KB / sierra2_4a 860 KB /
# bayer 826 KB —— 抖动方式只差 5%，所以选画质最好的 sierra2_4a。**真正决定体积的是
# 输出边长、帧率和色数**（224px/14fps/128 色会到 1.7 MB，是现在的两倍）。
DITHER = 'sierra2_4a'

# README 里展示的那几条：**每个动作池各一条**，挑的是各池里最有代表性的一条。
# （池子划分见 assets/config.jsonc 的 animations / events，条数见 README 的素材表。）
CURATED = [
    '休闲待机',           # 待机 —— 也是全部素材的锚点基准
    '东张西望',           # 转向 —— 整片朝向会真的翻过来
    '点击回应-开心跃动',   # 点击回应
    '螃蟹走路',           # 移动
    '整体换装试色',        # 小动作
    '优雅女仆舞',         # 玩耍
    '吃Token',           # 吃什么
    '深度思考碎碎念',      # 文字 —— 唯一带中文气泡、必须 noMirror 的一条
    '工作状态-冒泡思考',   # 工作状态
]

sys.stdout.reconfigure(encoding='utf-8')


def even_floor(v: float) -> int:
    """向下取到偶数：yuva420p 是 4:2:0，pad/crop 的尺寸与偏移都用偶数最稳。

    注意是 floor 而不是 int()——方窗中心可能落到画布外（left/top 为负），
    截断取整会在负半轴上往 0 靠，把窗挪偏一像素。负数取偶要走 math.floor。
    """
    return int(math.floor(v / 2.0)) * 2


def in_decoder(path: Path) -> list[str]:
    """输入解码器参数：VP9-Alpha 的 alpha 只有 libvpx-vp9 解得出（见文件头第 1 条）。"""
    return ['-c:v', 'libvpx-vp9'] if path.suffix.lower() == '.webm' else []


def content_bbox(path: Path) -> tuple[int, int, int, int, int]:
    """流式解码整片，返回 (x0, y0, x1, y1, 帧数)：全部内容 bbox（含道具/气泡/特效）。

    逐帧只取 alpha 平面求并集，不在内存里留帧——52 条全量跑也不会吃内存。
    """
    cmd = [str(FFMPEG), '-hide_banner', '-loglevel', 'error'] + in_decoder(path) + [
        '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10 ** 8)
    frame = CW * CH * 4
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    n = 0
    try:
        while True:
            buf = proc.stdout.read(frame)
            if len(buf) < frame:
                break
            alpha = np.frombuffer(buf, dtype=np.uint8).reshape(CH, CW, 4)[:, :, 3]
            ys, xs = np.nonzero(alpha > ALPHA_THR)
            n += 1
            if xs.size:
                x0, x1 = min(x0, int(xs.min())), max(x1, int(xs.max()))
                y0, y1 = min(y0, int(ys.min())), max(y1, int(ys.max()))
    finally:
        proc.stdout.close()
        proc.wait()
    if x1 < 0:
        raise SystemExit('[X] %s 全片没有 alpha > %d 的像素，源文件不对？' % (path.name, ALPHA_THR))
    return x0, y0, x1, y1, n


def window(bbox: tuple[int, int, int, int]) -> dict:
    """内容 bbox → 以它为中心的**正方形**裁剪窗（画布装不下的部分靠 pad 补透明）。

    先 pad 再 crop（而不是 crop 完再 pad）：这样方窗中心永远落在内容中心上，
    靠边的动作（比如往左跑的）不会被"夹回画布内"而把角色挤到画面一角。
    """
    x0, y0, x1, y1 = bbox
    side = even_floor(max(x1 - x0 + 1, y1 - y0 + 1) * MARGIN) + 2
    cx, cy = (x0 + x1 + 1) / 2.0, (y0 + y1 + 1) / 2.0
    left, top = even_floor(cx - side / 2.0), even_floor(cy - side / 2.0)
    pad_x, pad_y = max(0, -left), max(0, -top)
    pad_w = even_floor(CW + pad_x + max(0, left + side - CW)) + 2
    pad_h = even_floor(CH + pad_y + max(0, top + side - CH)) + 2
    return {
        'side': side,
        'pad': (pad_w, pad_h, pad_x, pad_y),
        'crop': (pad_x + left, pad_y + top),
    }


def convert(path: Path, out: Path, win: dict, side: int, fps: int) -> None:
    pw, ph, px, py = win['pad']
    cx, cy = win['crop']
    s = win['side']
    vf = (
        'pad=%d:%d:%d:%d:color=0x00000000,crop=%d:%d:%d:%d,'
        'fps=%d,scale=%d:%d:flags=lanczos,'
        'split[a][b];[a]palettegen=max_colors=%d:reserve_transparent=1:stats_mode=diff[p];'
        '[b][p]paletteuse=dither=%s:alpha_threshold=%d'
        % (pw, ph, px, py, s, s, cx, cy, fps, side, side, MAX_COLORS, DITHER, ALPHA_CUT)
    )
    cmd = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y'] + in_decoder(path) + [
        '-i', str(path), '-vf', vf, '-loop', '0', str(out)]
    subprocess.run(cmd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description='出 README 用的动画预览 GIF（自制）')
    ap.add_argument('names', nargs='*', help='素材名（不含 .webm）；不给就用默认清单')
    ap.add_argument('--all', action='store_true', help='出 assets/webm/ 里的全部（体积大）')
    ap.add_argument('--out', default=str(DEFAULT_OUT), help='输出目录（默认 assets/preview）')
    ap.add_argument('--side', type=int, default=SIDE, help='输出正方形边长（默认 %d）' % SIDE)
    ap.add_argument('--fps', type=int, default=FPS, help='输出帧率（默认 %d）' % FPS)
    args = ap.parse_args()

    if not FFMPEG.exists():
        raise SystemExit('[X] 找不到 %s —— 先跑 .\\scripts\\get-ffmpeg.ps1' % FFMPEG)

    if args.names:
        names = args.names
    elif args.all:
        names = sorted(p.stem for p in WEBM.glob('*.webm'))
    else:
        names = CURATED
    if not names:
        raise SystemExit('[X] assets/webm/ 里没有素材')

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print('%d 条 → %s（%d×%d / %dfps / 逐条裁方窗）' % (len(names), out_dir, args.side, args.side, args.fps))
    print()
    print('%-18s %-20s %-12s %s' % ('素材', '内容 bbox', '方窗(边/裁点)', '输出'))
    total = 0
    for name in names:
        src = WEBM / ('%s.webm' % name)
        if not src.exists():
            print('%-18s %s' % (name, '[X] 没有这个素材'))
            return 1
        bbox = content_bbox(src)[:4]
        win = window(bbox)
        out = out_dir / ('%s.gif' % name)
        convert(src, out, win, args.side, args.fps)
        size = out.stat().st_size
        total += size
        print('%-18s %-20s %-12s %s' % (
            name,
            '%d,%d,%d,%d' % bbox,
            '%d @ %s' % (win['side'], win['crop']),
            '%s  %.0f KB' % (out.name, size / 1024)))

    print()
    print('合计 %.1f MB / %d 条。README 用 <img src="assets/preview/<名>.gif" width="160"> 引用（3 个一行）；' % (total / 1048576, len(names)))
    print('      GIF 的透明是 1 位（边缘略硬属格式限制），原画质看 assets/webm/。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
