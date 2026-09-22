#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 锚点工厂：绿幕竖版锚点 → 统一规格的 16:9 绿幕首末帧锚点。

为什么需要它（三件事一次解决）：
  ① 几何统一：引擎契约（640x360）要求每条动画首帧「角色高 270px、脚底 y=330、
     中心 x=320」，占比即 **高 75.0% / 脚底 91.67% / 中心 50%**。
     ref-src-clean 里的锚点高矮脚线各不一样，直接拿去当 first_frame，
     生成出来的角色大小就会一条一个样，最后过不了 check-anchor.py。
  ② 画布统一：那 5 张是 1024x1536 竖版，而 H3 的 first_frame/last_frame 必须是
     横版视频画布；除了「正面」之外都没有横版。
  ③ 绿值统一：5 张的绿幕色值各不相同（(20,222,1) / (7,231,0) / (20,234,2) …），
     而提示词库要求「全库色值完全一致 #00FF00」——色值不统一 = 后期抠像毛边。

做法：绿幕抠出角色 → 只留最大连通块（丢弃水印/角标，check-anchor.py 里记着
2026-09 被水印撑大 bbox 的事故）→ 按目标占比缩放 → 贴到纯 #00FF00 画布 →
把输出**重新量一遍**做自检 → 写 manifest.json。

用法：
  python scripts/make-h3-anchors.py            # 生成全部 5 视角 × 2 尺寸
  python scripts/make-h3-anchors.py --view 3-4左
输出：assets-custom/anchors-h3/{视角}锚点-{W}x{H}.png + manifest.json
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / 'assets-custom' / 'ref-src-clean'
OUT_DIR = ROOT / 'assets-custom' / 'anchors-h3'

# 引擎契约换算（640x360：高 270 / 脚底 330 / 中心 320）
HEIGHT_FRAC = 270 / 360.0     # 0.75000
FEET_FRAC = 330 / 360.0       # 0.91667
CENTER_FRAC = 0.5
SIDE_MARGIN = 0.96            # 角色最宽不得超过画幅 96%（左右各留 2% 余量）

SIZES = ((1024, 576), (1344, 768))
GREEN = np.array([0.0, 255.0, 0.0], dtype=np.float32)

# 绿主导度 dom = g - max(r,b)：绿幕为正、角色为负。
# alpha 只在这个区间做渐变：dom<=0 一律全不透明（角色），dom>=T_BG 一律全透明（背景）。
# ⚠ 别写成 (T_BG-dom)/(T_BG-T_CHAR)：那样纯白(dom=0)会算成半透明，白围裙会被染绿，
#   角色还会在测量时被切成两半（2026-09 踩过）。
T_BG = 12.0

SOURCES = (
    ('正面', '正面锚点-1280x720.png'),      # 已是横版且已按引擎契约做过
    ('1-3侧面', '1-3侧面锚点.png'),
    ('3-4左', '3-4左侧面锚点.png'),
    ('3-4右', '3-4右侧面锚点.png'),
    ('背面', '背面锚点.png'),
)

sys.stdout.reconfigure(encoding='utf-8')


def matte(a: np.ndarray) -> np.ndarray:
    """绿幕 → alpha。dom<=0（不绿）全不透明，dom>=T_BG 全透明，中间线性过渡。"""
    dom = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    return np.clip(1.0 - dom / T_BG, 0.0, 1.0)


def cut_out(path: Path):
    """绿幕抠像 → (合成到纯绿的 RGB uint8, 角色 bbox, 被丢弃的杂块面积列表)。"""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    alpha = matte(a)

    core = alpha > 0.5
    lab, n = ndimage.label(core)
    if n == 0:
        raise RuntimeError(f'{path.name}：抠不出角色（背景不是绿幕？）')
    areas = ndimage.sum(core, lab, range(1, n + 1))
    keep = int(np.argmax(areas)) + 1
    dropped = sorted((int(s) for i, s in enumerate(areas, 1) if i != keep), reverse=True)
    alpha = np.where(lab == keep, alpha, 0.0)

    # 去绿溢：角色像素里绿仍占优的（边缘溢色），把绿压回 max(r,b) 附近
    dom = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    spill = (alpha > 0.5) & (dom > 0)
    a[..., 1] = np.where(spill, np.maximum(a[..., 0], a[..., 2]) + dom * 0.15, a[..., 1])

    rgb = a * alpha[..., None] + GREEN * (1.0 - alpha[..., None])
    ys, xs = np.where(alpha > 0.15)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return rgb.astype(np.uint8), bbox, dropped


def measure(arr: np.ndarray):
    """量一张成品锚点的角色几何（与 check-anchor.py 同口径：最大连通块）。"""
    core = matte(arr.astype(np.float32)) > 0.5
    lab, n = ndimage.label(core)
    if n == 0:
        return None
    keep = int(np.argmax(ndimage.sum(core, lab, range(1, n + 1)))) + 1
    ys, xs = np.where(lab == keep)
    h, w = arr.shape[:2]
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    return {
        'bbox': [x0, y0, x1, y1],
        'char_w': x1 - x0, 'char_h': y1 - y0,
        'height_pct': round((y1 - y0) / h * 100, 2),
        'feet_pct': round(y1 / h * 100, 2),
        'center_pct': round((x0 + x1) / 2 / w * 100, 2),
    }


def build(rgb: np.ndarray, bbox, size):
    """按目标占比缩放并贴到纯绿画布上。"""
    w, h = size
    x0, y0, x1, y1 = bbox
    ch, cw = y1 - y0, x1 - x0
    target_h = HEIGHT_FRAC * h
    scale = target_h / ch

    fit = 1.0
    need_w = cw * scale
    if need_w > w * SIDE_MARGIN:                 # 太宽就整体缩到放得下为止
        fit = (w * SIDE_MARGIN) / need_w
    new_w = max(1, int(round(cw * scale * fit)))
    new_h = max(1, int(round(ch * scale * fit)))

    crop = Image.fromarray(rgb[y0:y1, x0:x1]).resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new('RGB', size, (0, 255, 0))
    px = int(round(w * CENTER_FRAC - new_w / 2))
    py = int(round(h * FEET_FRAC - new_h))
    canvas.paste(crop, (px, py))
    return canvas, {'scale': round(scale * fit, 4), 'fit': round(fit, 4),
                    'paste': [px, py], 'target_h_px': round(target_h * fit, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--view', default='', help='只做某一个视角（如 3-4左）')
    ap.add_argument('--src-dir', default=str(SRC_DIR))
    ap.add_argument('--out-dir', default=str(OUT_DIR))
    args = ap.parse_args()

    src_dir, out_dir = Path(args.src_dir), Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f'源目录 {src_dir}')
    print(f'目标几何：角色高 {HEIGHT_FRAC*100:.2f}% / 脚底 {FEET_FRAC*100:.2f}% / 中心 {CENTER_FRAC*100:.0f}%')
    print(f'目标绿值：#00FF00（0,255,0）\n')

    manifest = {'geometry': {'height_pct': HEIGHT_FRAC * 100, 'feet_pct': FEET_FRAC * 100,
                             'center_pct': CENTER_FRAC * 100, 'green': [0, 255, 0],
                             'engine_contract_640x360': {'char_h': 270, 'feet_y': 330, 'center_x': 320}},
                'views': {}}
    bad = []

    for view, fname in SOURCES:
        if args.view and view != args.view:
            continue
        src = src_dir / fname
        if not src.exists():
            print(f'✗ {view}：源文件不存在 {src}')
            bad.append(f'{view} 缺源文件')
            continue

        rgb, bbox, dropped = cut_out(src)
        src_arr = np.asarray(Image.open(src).convert('RGB'))
        src_m = measure(src_arr)
        print(f'■ {view}  ← {fname}')
        print(f'   源 {src_m["char_w"]}x{src_m["char_h"]}px  高占比 {src_m["height_pct"]}%  '
              f'脚底 {src_m["feet_pct"]}%  中心 {src_m["center_pct"]}%'
              + (f'  （丢弃 {len(dropped)} 个杂块，最大 {dropped[0]}px）' if dropped else ''))

        entry = {'source': fname, 'source_metrics': src_m, 'dropped_blobs': dropped, 'outputs': {}}
        for size in SIZES:
            canvas, info = build(rgb, bbox, size)
            out = out_dir / f'{view}锚点-{size[0]}x{size[1]}.png'
            canvas.save(out)
            got = measure(np.asarray(canvas))
            dh = abs(got['char_h'] - HEIGHT_FRAC * size[1])
            df = abs(got['feet_pct'] - FEET_FRAC * 100)
            dc = abs(got['center_pct'] - CENTER_FRAC * 100)
            ok = dh <= 2 and df <= 0.3 and dc <= 0.3
            print(f'   → {out.name}  高 {got["char_h"]}px({got["height_pct"]}%)  '
                  f'脚底 {got["feet_pct"]}%  中心 {got["center_pct"]}%  '
                  f'{"✅" if ok else "⚠️ 偏差偏大"}')
            if not ok:
                bad.append(f'{out.name}：高偏差 {dh:.1f}px / 脚底 {df:.2f}% / 中心 {dc:.2f}%')
            entry['outputs'][f'{size[0]}x{size[1]}'] = {**info, 'file': out.name, 'measured': got}
            if view == '正面':
                # 引擎的 turn 分支要求「末帧 = 首帧水平镜像」（renderer.js handleEnded：
                # 转向动画播完引擎会翻一次 facing，镜像末帧翻回来才无缝），所以正面额外出一张镜像图
                mir = canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                mout = out_dir / f'{view}锚点-{size[0]}x{size[1]}-镜像.png'
                mir.save(mout)
                entry['outputs'][f'{size[0]}x{size[1]}-镜像'] = {
                    'file': mout.name, 'for': 'turn 池的末帧', 'measured': measure(np.asarray(mir))}
                print(f'   → {mout.name}（turn 末帧用）')
        manifest['views'][view] = entry

    (out_dir / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\nmanifest → {out_dir / "manifest.json"}')

    if bad:
        print(f'\n⚠️ {len(bad)} 项没达标：')
        for x in bad:
            print(f'  - {x}')
        return 1
    print('\n全部锚点达标 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
