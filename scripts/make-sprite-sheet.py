# -*- coding: utf-8 -*-
"""精灵图验证工具：VP9-Alpha webm → 精灵图 / 动画 WebP，并量化体积与解码内存。

用途：判断「把桌宠动画从 webm 换成精灵图」是否可行。输入必须是**带 alpha 的 webm**，
解码必须显式指定 `-c:v libvpx-vp9`——ffmpeg 原生 vp9 解码器会把 WebM 的 alpha 平面
（BlockAdditional）丢掉，报 pix_fmt=yuv420p，解出来的帧背景是黑的；libvpx 才给 yuva420p。

输出（<outdir>/<name>/）：
  <name>.sheet.<fps>fps.png    精灵图（PNG，RGBA）
  <name>.sheet.<fps>fps.webp   精灵图（无损 WebP，同样 RGBA，通常比 PNG 小很多）
  <name>.anim.webp             动画 WebP（对照组：同样带 alpha 的「视频」格式）
  <name>.meta.json             尺寸/帧数/bbox/体积/解码内存
  preview.html                 与原 webm 并排播放的可视化页

用法：
  python scripts/make-sprite-sheet.py assets/webm/原地小憩沉眠.webm .sprite-lab
  python scripts/make-sprite-sheet.py <src.webm> <outdir> --sweep 24,12,8,6 --cell 320x180
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = shutil.which('ffmpeg') or 'ffmpeg'
FFPROBE = shutil.which('ffprobe') or 'ffprobe'
ALPHA_THR = 40                      # 与 normalize-webm.py 一致：判定「可见像素」
MAX_HOLD_BYTES = 2 * 1024 ** 3      # 全帧常驻内存上限，超了就拒绝而不是 OOM

sys.stdout.reconfigure(encoding='utf-8')


def probe(path):
    """探测源片规格。alpha 用 ALPHA_MODE 标签判断，pix_fmt 不可信（见文件头注释）。"""
    def q(args):
        return subprocess.run([FFPROBE, '-v', 'error', *args, str(path)],
                              capture_output=True, text=True, encoding='utf-8',
                              errors='replace').stdout
    raw = q(['-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames',
             '-show_entries', 'format=duration,size', '-show_entries', 'stream_tags=ALPHA_MODE',
             '-of', 'json'])
    d = json.loads(raw)
    st = d['streams'][0]
    w, h = int(st['width']), int(st['height'])
    num, den = (st.get('r_frame_rate') or '24/1').split('/')
    fps = float(num) / float(den or 1)
    dur = float(st.get('duration') or d['format'].get('duration') or 0)
    return {
        'w': w, 'h': h, 'fps': fps, 'duration': dur,
        'bytes': int(d['format'].get('size') or 0),
        'has_alpha': str(st.get('tags', {}).get('ALPHA_MODE', '')) == '1',
    }


def decode_rgba(path, w, h):
    """流式解码为 RGBA 帧列表。必须 libvpx-vp9，否则 alpha 丢失。"""
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9',
           '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            bufsize=10 ** 8)
    n = w * h * 4
    frames = []
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        frames.append(np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 4).copy())
    proc.stdout.close()
    proc.wait()
    if not frames:
        raise SystemExit(f'解码出 0 帧：{path}（alpha 片必须用 -c:v libvpx-vp9）')
    return frames


def union_bbox(frames):
    """整片可见像素并集 bbox（半开区间）。只用来报告动作幅度，不裁剪。"""
    ux0 = uy0 = 10 ** 9
    ux1 = uy1 = -1
    for f in frames:
        ys, xs = np.where(f[..., 3] > ALPHA_THR)
        if len(xs) == 0:
            continue
        ux0 = min(ux0, int(xs.min())); uy0 = min(uy0, int(ys.min()))
        ux1 = max(ux1, int(xs.max()) + 1); uy1 = max(uy1, int(ys.max()) + 1)
    if ux1 < 0:
        raise SystemExit('整片无可见像素')
    return [ux0, uy0, ux1, uy1]


def build_sheet(frames, cell, cols):
    """把帧列表拼成 cols×rows 的网格精灵图。"""
    cw, ch = cell
    n = len(frames)
    rows = (n + cols - 1) // cols
    sheet = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im = Image.fromarray(f, 'RGBA')
        if (cw, ch) != (f.shape[1], f.shape[0]):
            # 预乘 alpha 后重采样再反预乘：直接缩放 RGBA 会把透明背景色混进轮廓边
            a = np.asarray(im, dtype=np.float32)
            al = a[..., 3:4] / 255.0
            pm = np.dstack([a[..., :3] * al, a[..., 3]])
            out = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), 'RGBA')
            chans = [np.asarray(c.convert('F').resize((cw, ch), Image.LANCZOS),
                                dtype=np.float32) for c in out.split()]
            po = np.dstack(chans)
            ao = po[..., 3:4]
            rgb = np.where(ao > 1e-6, po[..., :3] * 255.0 / np.maximum(ao, 1e-6), 0.0)
            im = Image.fromarray(
                np.dstack([np.clip(rgb, 0, 255), np.clip(ao, 0, 255)]).astype(np.uint8), 'RGBA')
        sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
    return sheet, cols, rows


def anim_webp(src, dst, lossless=True):
    """动画 WebP 对照组：同样带 alpha，但有帧间压缩，可作 webm 的替代品。"""
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-c:v', 'libvpx-vp9',
           '-i', str(src), '-c:v', 'libwebp_anim', '-loop', '0', '-an']
    cmd += ['-lossless', '1'] if lossless else ['-q:v', '80']
    r = subprocess.run(cmd + [str(dst)], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(f'  !! 动画 WebP 失败：{(r.stderr or "").strip()[:200]}')
        return None
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('outdir')
    ap.add_argument('--sweep', default='24,12,8,6',
                    help='要对比的有效帧率（逗号分隔；24=原速，其余按步长抽帧）')
    ap.add_argument('--counts', default='',
                    help='改成按「固定帧数」抽帧（逗号分隔，如 8,12,16,24）——'
                         '直接对应「静图管线要画几张关键帧」，比帧率更贴近成本问题')
    ap.add_argument('--cell', default='320x180', help='精灵图单格尺寸 WxH')
    ap.add_argument('--cols', default='auto', help='列数或 auto')
    ap.add_argument('--anim-webp', action='store_true', default=True)
    args = ap.parse_args()

    src = Path(args.src).resolve()
    if not src.exists():
        raise SystemExit(f'找不到输入：{src}')
    cw, ch = (int(v) for v in args.cell.lower().split('x'))

    info = probe(src)
    print(f'{src.name}: {info["w"]}×{info["h"]} @{info["fps"]:g}fps '
          f'{info["duration"]:.2f}s  {info["bytes"] / 1024:.0f} KB  '
          f'alpha={"有" if info["has_alpha"] else "无"}')
    if not info['has_alpha']:
        print('  !! 源片没有 ALPHA_MODE 标签——精灵图不会比原片多出透明度，结果仅供体积参考')

    frames = decode_rgba(src, info['w'], info['h'])
    need = len(frames) * info['w'] * info['h'] * 4
    if need > MAX_HOLD_BYTES:
        raise SystemExit(f'全帧常驻需要 {need / 2**30:.1f} GB，超过上限，请先抽帧或降分辨率')
    bbox = union_bbox(frames)
    print(f'  解出 {len(frames)} 帧（RGBA 常驻 {need / 2**20:.0f} MB）；'
          f'动作并集 bbox={bbox} 即 {bbox[2]-bbox[0]}×{bbox[3]-bbox[1]}px')

    out = Path(args.outdir).resolve() / src.stem
    out.mkdir(parents=True, exist_ok=True)

    variants = []
    plans = []   # (label, 抽出的帧, 有效帧率)
    if args.counts:
        for c in [int(x) for x in args.counts.split(',') if x.strip()]:
            c = max(1, min(c, len(frames)))
            idx = np.linspace(0, len(frames) - 1, c).round().astype(int)
            plans.append((f'{c}帧', [frames[i] for i in idx], info['fps'] * c / len(frames)))
    else:
        for fps in [float(x) for x in args.sweep.split(',') if x.strip()]:
            step = max(1, int(round(info['fps'] / fps)))
            plans.append((f'{info["fps"] / step:g}fps', frames[::step], info['fps'] / step))

    for label, picked, eff_fps in plans:
        cols = (max(1, int(round((len(picked) * ch / cw) ** 0.5))) if args.cols == 'auto'
                else int(args.cols))
        cols = min(cols, len(picked))
        sheet, cols, rows = build_sheet(picked, (cw, ch), cols)

        png = out / f'{src.stem}.sheet.{label}.png'
        webp = out / f'{src.stem}.sheet.{label}.webp'
        sheet.save(png)
        sheet.save(webp, lossless=True, quality=100, method=6)

        v = {
            'label': label, 'fps': eff_fps, 'step': len(frames) / len(picked),
            'frames': len(picked), 'cols': cols, 'rows': rows,
            'sheet_w': sheet.width, 'sheet_h': sheet.height,
            'cell': [cw, ch],
            'png_bytes': png.stat().st_size, 'webp_bytes': webp.stat().st_size,
            # 浏览器会把整张图解到显存：这是精灵图相对视频的硬成本
            'decoded_mb': sheet.width * sheet.height * 4 / 2 ** 20,
        }
        variants.append(v)
        print(f'  {v["label"]:>6}  {v["frames"]:>3} 帧  {cols}×{rows} 格  '
              f'画布 {sheet.width}×{sheet.height}  '
              f'PNG {v["png_bytes"]/1024:>7.0f} KB  WebP {v["webp_bytes"]/1024:>7.0f} KB  '
              f'显存 {v["decoded_mb"]:>6.1f} MB')

    aw = None
    if args.anim_webp:
        aw = anim_webp(src, out / f'{src.stem}.anim.webp')
        if aw:
            print(f'  动画 WebP（全 {len(frames)} 帧）  {aw.stat().st_size/1024:.0f} KB')

    meta = {
        'source': {'name': src.name, 'w': info['w'], 'h': info['h'], 'fps': info['fps'],
                   'duration': info['duration'], 'bytes': info['bytes'],
                   'has_alpha': info['has_alpha'], 'frames': len(frames),
                   'union_bbox': bbox, 'decoded_mb': need / 2 ** 20},
        'anim_webp_bytes': aw.stat().st_size if aw else None,
        'variants': variants,
    }
    (out / f'{src.stem}.meta.json').write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'-> {out}')
    return meta


if __name__ == '__main__':
    main()
