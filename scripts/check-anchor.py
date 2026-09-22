# -*- coding: utf-8 -*-
"""锚点契约验收：每个动画的**首帧角色**必须与 idle 锚点同高、同脚底线、同水平中心。

为什么需要它（2026-09 实测事故）：
  即梦出片在画面底部带"AI生成"水印，水印与角色是**两个**不透明连通块。凡是按
  "不透明像素 bbox"量角色的工具（alpha>40 的 bbox、normalize-webm.py 的 measure、
  tools/weld-seams.bbox_of），量到的都是"头顶→水印底"，于是：
    ① 归一化把 头顶→水印 缩放成 270px → 角色本身只剩 ~206px（点击后整只变小）；
    ② 脚底被留在水印上方 ~62px → 角色悬空（离地不落地）。
  这类错误在按 alpha 的整体 bbox 里"看起来完全达标"（高度 271、脚底 330），
  所以必须改成"只认最大连通块（= 角色）"来量，并对每个动画逐个比对锚点。

判定：
  · 角色高 / 脚底 y / 水平中心 x 与锚点（animations.idle 的第一个动画）偏差 ≤ 容差（默认 8px）；
  · 额外的不透明小块（水印/杂点）只告警不判失败（它们不在角色块里，不影响几何）。

用法：
  python scripts/check-anchor.py                                  # 默认 assets/config.jsonc + assets/webm
  python scripts/check-anchor.py --webm-dir assets-custom/webm    # 验暂存区
  python scripts/check-anchor.py --skip 被鼠标拖拽悬空反馈         # 首帧非站姿的动画（拖拽=悬空）
退出码：0 全部达标；1 有偏差/缺文件；2 环境缺依赖。
"""
import argparse
import json
import re
import subprocess
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CANVAS_W, CANVAS_H = 640, 360
ALPHA_THR = 40          # 与管线同一口径（weld-seams.bbox_of / normalize-webm ALPHA_THR）

sys.stdout.reconfigure(encoding='utf-8')


def strip_jsonc(src: str) -> str:
    """去掉 // 与 /* */ 注释（字符串感知，避免把 URL 里的 // 当注释）。"""
    out, i, n = [], 0, len(src)
    in_str = False
    while i < n:
        c = src[i]
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True; out.append(c); i += 1; continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c); i += 1
    return ''.join(out)


def config_names(cfg_path: Path):
    """配置 animations 段引用的全部动画名 + idle 池（锚点取 idle 第一个）。"""
    raw = json.loads(strip_jsonc(cfg_path.read_text(encoding='utf-8')))
    a = raw.get('animations') or {}
    names = []
    for key in ('idle', 'turn', 'drag', 'clicks'):
        names += [str(x) for x in (a.get(key) or []) if x]
    for m in ((a.get('moves') or {}).get('actions') or []):
        if isinstance(m, dict) and m.get('name'):
            names.append(str(m['name']))
    for c in (a.get('categories') or []):
        names += [str(x) for x in (c.get('actions') or []) if x]
    for pool in (a.get('events') or {}).values():
        names += [str(x) for x in (pool or []) if x]
    idle = [str(x) for x in (a.get('idle') or []) if x]
    seen, uniq = set(), []
    for nm in names:
        if nm not in seen:
            seen.add(nm); uniq.append(nm)
    return uniq, idle


def decode_frame0(webm: Path):
    """首帧 → RGBA ndarray（VP9-Alpha 必须用 libvpx-vp9 解码器才出 alpha）。"""
    ffmpeg = 'ffmpeg'
    local = ROOT / 'tools' / 'ffmpeg.exe'
    if local.exists():
        ffmpeg = str(local)
    proc = subprocess.run(
        [ffmpeg, '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', str(webm),
         '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buf = proc.stdout
    need = CANVAS_W * CANVAS_H * 4
    if len(buf) < need:
        raise RuntimeError(f'解首帧失败（{len(buf)} 字节，ffmpeg: {proc.stderr.decode("utf-8", "replace").strip()[:200]}）')
    import numpy as np  # 延后导入：缺依赖时报错更清楚
    return np.frombuffer(buf[:need], dtype=np.uint8).reshape(CANVAS_H, CANVAS_W, 4)


def character_bbox(rgba):
    """最大不透明连通块的 bbox（= 角色本体），弃掉水印/杂点等小块。

    返回 (bbox, 额外小块列表[(area, bbox)...])；bbox 为半开区间 (x0,y0,x1,y1)。
    """
    import numpy as np
    mask = rgba[..., 3] > ALPHA_THR
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for sy in range(h):
        row = mask[sy]
        for sx in range(w):
            if not row[sx] or seen[sy, sx]:
                continue
            q = deque([(sy, sx)]); seen[sy, sx] = True
            x0 = x1 = sx; y0 = y1 = sy; area = 0
            while q:
                cy, cx = q.popleft(); area += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            comps.append((area, (x0, y0, x1 + 1, y1 + 1)))
    if not comps:
        raise RuntimeError('首帧无任何不透明像素（alpha>40）')
    comps.sort(key=lambda c: -c[0])
    main_area, main_box = comps[0]
    extras = [c for c in comps[1:] if c[0] >= 40]   # ≥40px 的独立块：水印/飘落杂点
    return main_box, extras, main_area


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', default=str(ROOT / 'assets' / 'config.jsonc'))
    ap.add_argument('--webm-dir', default=str(ROOT / 'assets' / 'webm'))
    ap.add_argument('--anchor', default='', help='锚点动画名（默认 idle 池第一个）')
    ap.add_argument('--tolerance', type=float, default=8.0, help='容许偏差 px（高/脚底/中心，默认 8）')
    ap.add_argument('--skip', default='', help='跳过的动画名，逗号分隔（首帧非站姿的，如拖拽悬空）')
    args = ap.parse_args()

    try:
        import numpy  # noqa: F401
    except ImportError as exc:
        print(f'缺依赖（{exc}）：请用带 numpy 的 Python 运行本脚本'); return 2

    cfg_path = Path(args.config)
    webm_dir = Path(args.webm_dir)
    if not cfg_path.exists():
        print(f'配置不存在：{cfg_path}'); return 1
    names, idle = config_names(cfg_path)
    if not names:
        print(f'配置 animations 段没引用任何动画：{cfg_path}'); return 1
    anchor_name = args.anchor or (idle[0] if idle else names[0])
    skip = {s.strip() for s in args.skip.split(',') if s.strip()}

    print(f'配置 {cfg_path}')
    print(f'素材 {webm_dir}')
    print(f'锚点 {anchor_name}（容差 ±{args.tolerance:g}px：角色高 / 脚底 y / 水平中心 x）')

    def probe(name):
        f = webm_dir / f'{name}.webm'
        if not f.exists():
            return None, f'缺文件 {f.name}'
        box, extras, area = character_bbox(decode_frame0(f))
        return {'box': box, 'extras': extras, 'area': area}, None

    a, err = probe(anchor_name)
    if err:
        print(f'!! 锚点不可用：{err}'); return 1
    ab = a['box']
    ah, afeet, acx = ab[3] - ab[1], ab[3], (ab[0] + ab[2]) / 2.0
    print(f'  锚点首帧角色 bbox={ab} 高={ah} 脚底={afeet} 中心x={acx:.0f}'
          f'{"  ⚠ 锚点自身带独立小块（水印？）" if a["extras"] else ""}')
    print()

    print('%-24s %6s %6s %7s %8s %8s %8s  %s' % ('动画', '高', 'Δ高', '脚底', 'Δ脚底', '中心x', 'Δ中心', '判定'))
    bad = []
    for name in names:
        if name == anchor_name:
            continue
        if name in skip:
            print('%-24s %s' % (name, '（--skip 跳过）')); continue
        info, err = probe(name)
        if err:
            print('%-24s %s' % (name, f'✗ {err}')); bad.append(f'{name}：{err}'); continue
        b = info['box']
        h, feet, cx = b[3] - b[1], b[3], (b[0] + b[2]) / 2.0
        dh, df, dc = h - ah, feet - afeet, cx - acx
        ok = abs(dh) <= args.tolerance and abs(df) <= args.tolerance and abs(dc) <= args.tolerance
        note = '✓' if ok else '✗ 与锚点不一致'
        if info['extras']:
            note += f'  ⚠ 另有 {len(info["extras"])} 块独立不透明像素（水印/杂点）：{info["extras"][:3]}'
        print('%-24s %6d %6.1f %7d %8.1f %8.0f %8.1f  %s' % (name, h, dh, feet, df, cx, dc, note))
        if not ok:
            bad.append(f'{name}：高{ h }（Δ{dh:+.1f}）脚底{feet}（Δ{df:+.1f}）中心x{cx:.0f}（Δ{dc:+.1f}）')

    print()
    if bad:
        print(f'锚点契约不达标 {len(bad)} 项 ❌')
        for x in bad:
            print(f'  - {x}')
        print('修法：用源片重转并按锚点归一化，例：'
              f'\n  python scripts/key-video.py <src.mp4> <out.webm> --anchor frame0   # 引擎契约（默认）'
              f'\n  python tools/adjust-webm.py <in.webm> <out.webm> --align-to <{anchor_name} 首帧.png>')
        return 1
    print(f'锚点契约全部达标 ✅（{len(names) - len(skip) - 1} 个动画与 {anchor_name} 同高同脚底同中心）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
