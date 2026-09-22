#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 成片（mp4，纯绿幕）→ 桌宠 640×360 VP9-Alpha 透明 webm。

【为什么不用现成的 mp4-keyer / normalize-webm】
  `tools/mp4-keyer.py`（不加 --keep-size）和 `scripts/normalize-webm.py` 都会**重新锚定**：
  它们量「整片 union bbox」再缩放，把 union 高度凑成 270px，脚底放在"距底 8px"（y=352）。
  这对 H3 成片是**错**的，两个原因：
    1. 脚底线对不上引擎常量 FEET_Y=330（差 22px，宠物会浮空或陷地）；
    2. 动作幅度大的片子（跳跃 / 抬手 / 放烟花）union 远大于站姿，按 union 缩放会把角色压小，
       出现"待机正常、一播动作就变小"的经典事故（见 scripts/check-anchor.py 文件头事故记录）。

  H3 这条线根本**不需要重新锚定** —— 首帧就是锚图本身（AddGuide frame_idx=0），
  锚图在 1024×576 上已经满足契约（角色高 75%、脚底 91.67%、水平居中，见 anchors-h3/manifest.json）。
  1024×576 → 640×360 正好 ×0.625：
      角色高 432 → 270px　脚底 528 → 330　中心 512 → 320
  与引擎常量（CANVAS_H=360 / FEET_Y=330 / ANCHOR_X=320）**逐项吻合**。
  所以这里只做「抠绿 + 等比缩小」，几何一个像素都不动。

【抠像配方怎么定的（实测，不是拍脑袋）】
  在 h3-out/样片-00002.mp4 上比过 5 组：
    chromakey 单单用      → 边缘绿偏均值 +213.8，100% 边缘像素绿偏>20（一圈明显绿边）
    chromakey + despill   → 绿偏均值 -3.9，0% 超阈值，不透明像素数不变（62569→62574）← 采用
    similarity 收到 0.05  → 边缘像素暴涨到 34 万（alpha 发虚）← 否决
    colorkey              → 边缘只剩 584px（硬边、无羽化）← 否决
  结论：`chromakey=0x00FF00:0.08:0.05,despill=type=green` 最优。

【用法】
  python scripts/h3-postprocess.py                          # h3-out/*.mp4 → assets-custom/webm/
  python scripts/h3-postprocess.py --only 待机呼吸休闲,东张西望
  python scripts/h3-postprocess.py --src h3-out --out assets-custom/webm --pick last
  python scripts/h3-postprocess.py --dry                    # 只打印要跑什么
  python scripts/h3-postprocess.py --scale-only             # 源已带 alpha 时只缩放（跳过抠像）
跑完接：
  python scripts/check-anchor.py --webm-dir assets-custom/webm
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
sys.stdout.reconfigure(encoding='utf-8')

CANVAS_W, CANVAS_H = 640, 360
KEY = 'chromakey=0x00FF00:0.08:0.05'
DESPILL = 'despill=type=green'
SCALE = f'scale={CANVAS_W}:{CANVAS_H}:flags=lanczos'


def probe(path: Path):
    """返回 (宽, 高, 帧率, 时长秒)；拿不到返回 None。"""
    r = subprocess.run([str(FFMPEG), '-hide_banner', '-i', str(path)],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = r.stderr or ''
    m = re.search(r'Video:.*?(\d{2,5})x(\d{2,5})', txt)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    fps = re.search(r'([\d.]+) fps', txt)
    dur = re.search(r'Duration: (\d+):(\d+):([\d.]+)', txt)
    secs = (int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))) if dur else 0.0
    return w, h, (float(fps.group(1)) if fps else 0.0), secs


def split_seed(stem: str):
    """`动作名-1234567890` → ('动作名', '1234567890')；没有种子后缀则种子为 ''。"""
    m = re.match(r'^(.*)-(\d{6,})$', stem)
    return (m.group(1), m.group(2)) if m else (stem, '')


def convert(src: Path, dst: Path, crf: int, fps: int, scale_only: bool, dry: bool):
    vf = [SCALE] if scale_only else [KEY, DESPILL, SCALE]
    cmd = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
           '-i', str(src), '-vf', ','.join(vf),
           '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
           '-crf', str(crf), '-b:v', '0', '-row-mt', '1']
    if fps > 0:
        cmd += ['-r', str(fps)]
    cmd += ['-an', str(dst)]
    if dry:
        print('    ' + ' '.join(cmd[:3]) + f' … -vf "{",".join(vf)}" … {dst.name}')
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0 or not dst.exists():
        print(f'    ✗ 失败：{(r.stderr or "").strip()[:200]}')
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=str(ROOT / 'h3-out'), help='H3 成片目录（默认 h3-out）')
    ap.add_argument('--out', default=str(ROOT / 'assets-custom' / 'webm'), help='输出目录')
    ap.add_argument('--only', default='', help='只转这些动作（逗号分隔）')
    ap.add_argument('--pick', default='first',
                    help='同一动作多个种子时选哪个：first/last/<种子号>（默认 first）')
    ap.add_argument('--crf', type=int, default=20, help='VP9 CRF（默认 20，与现役素材一致）')
    ap.add_argument('--fps', type=int, default=24, help='输出帧率（默认 24；0=跟随源）')
    ap.add_argument('--scale-only', action='store_true', help='源已带 alpha：只等比缩放到 640×360')
    ap.add_argument('--dry', action='store_true', help='只打印，不真跑')
    args = ap.parse_args()

    src_dir, out_dir = Path(args.src), Path(args.out)
    if not src_dir.is_dir():
        raise SystemExit(f'✗ 找不到源目录：{src_dir}')
    if not FFMPEG.exists():
        raise SystemExit(f'✗ 找不到 ffmpeg：{FFMPEG}')

    files = sorted([p for p in src_dir.iterdir()
                    if p.suffix.lower() in ('.mp4', '.webm', '.mov', '.mkv')])
    if args.only:
        want = {s.strip() for s in args.only.split(',') if s.strip()}
        files = [f for f in files if split_seed(f.stem)[0] in want]
    if not files:
        raise SystemExit(f'✗ {src_dir} 里没有可转的片子')

    # 按动作名分组（同名多个种子 = 多抽的版本）
    groups = {}
    for f in files:
        groups.setdefault(split_seed(f.stem)[0], []).append(f)

    print(f'源 {src_dir}　输出 {out_dir}　动作 {len(groups)} 个 / 文件 {len(files)} 个')
    print(f'配方 {"（仅缩放，不抠像）" if args.scale_only else "chromakey 0x00FF00:0.08:0.05 + despill(green)"}'
          f' + {SCALE} → VP9-Alpha CRF {args.crf}\n')

    ok = fail = 0
    for name, cands in sorted(groups.items()):
        cands.sort(key=lambda p: split_seed(p.stem)[1])
        if args.pick == 'last':
            chosen = cands[-1]
        elif args.pick.isdigit():
            hit = [c for c in cands if split_seed(c.stem)[1] == args.pick]
            chosen = hit[0] if hit else cands[0]
        else:
            chosen = cands[0]
        info = probe(chosen)
        tag = ''
        if info:
            w, h, _fps, secs = info
            if abs(w / h - 16 / 9) > 0.02:
                tag = f'  ⚠ 源不是 16:9（{w}x{h}），等比缩到 640×360 会变形'
            elif (w, h) != (1024, 576) and (w, h) != (640, 360):
                tag = f'  （{w}x{h} → 640×360）'
            else:
                tag = f'  （{w}x{h}）'
            tag += f' {secs:.2f}s'
        extra = f'　[候选 {len(cands)} 个种子，选 {split_seed(chosen.stem)[1] or "无"}]' if len(cands) > 1 else ''
        print(f'▶ {name}{tag}{extra}')
        dst = out_dir / f'{name}.webm'
        if convert(chosen, dst, args.crf, args.fps, args.scale_only, args.dry):
            if not args.dry:
                print(f'    ✓ {dst.name}（{dst.stat().st_size // 1024} KB）')
            ok += 1
        else:
            fail += 1

    print(f'\n完成：成功 {ok} / 失败 {fail}')
    if not args.dry and ok:
        print(f'下一步验收：python scripts/check-anchor.py --webm-dir {out_dir}')
        print('（拖拽那条首帧是悬空姿势，要 --skip 被鼠标拖拽悬空反馈）')
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
