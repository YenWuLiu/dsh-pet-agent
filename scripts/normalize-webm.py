# -*- coding: utf-8 -*-
"""归一化：任意分辨率 → 桌宠规格 640×360 VP9-Alpha（首帧对齐待机锚点）

输入支持 `.webm`（VP9-Alpha 成品）与 `.mov`（手工抠好的带 alpha 母版，
如 ProRes 4444 / qtrle / PNG-in-MOV）——两者的输入解码器不同，按扩展名自动分派。

用法：
  python scripts/normalize-webm.py <源目录> <输出目录> [--anchor 待机呼吸] [--target-h 0.75]
                                  [--margin 8] [--crf 15] [--dry]

规则（与「对齐」工具同源）：
  1. 流式解码每个源片，量出「首帧角色 bbox」与「整片 union bbox」；
  2. 每个片按 s = 目标角色高 / 该片首帧角色高 缩放 —— 等价于把每个动画的首帧
     对齐到锚点首帧（锚点只提供"标准角色高 = 0.75 × 360 = 270px"这个约定）；
  3. 若装配不下（缩放后超出画布），自动下调缩放；
  4. 裁剪窗 = 整片**全部内容** bbox（含独立气泡/道具/特效）+ margin（保证不被切），再缩放；
     缩放与锚点只用**最大连通块**（角色本体），避免气泡把角色顶小；
  5. 透明画布 640×360，首帧脚底贴 y=330（引擎 FEET_Y）、首帧水平中心贴 x=320；
  6. libvpx-vp9 / yuva420p / auto-alt-ref 0 / CRF 15 编码，保留 alpha。
     默认 CRF 2026-09-23 从 20 改到 15：实测在**实际显示尺寸**上 +1.19 dB（体积 +24%）。
     再往下（CRF 12）只再 +1 dB 却再多 16% 体积，不划算；往上到 20 则明显发软。

引擎常量对照（runtime/electron-helper/shared-core.js:6-15）：
  CANVAS_H=360、FEET_Y=330、HIT_BOX={200,50,440,335}、PET_REF_WIDTH=462
  角色高 270px（0.75×360）+ 脚底 330 → 头顶 y=60，正好落在命中区内。
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

try:                      # scipy 只用于加速最大连通块量测（缺失时回落到纯 numpy 实现）
    from scipy import ndimage
except Exception:         # pragma: no cover
    ndimage = None

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'

CW, CH = 640, 360          # 输出画布
FEET_Y = 330               # 引擎常量 shared-core.js: FEET_Y=330（命中区 y 50~335）
ANCHOR_X = 320             # 画布水平中心（HIT_BOX x 200~440 的中心）
ALPHA_THR = 40             # 角色可见像素阈值
SRC_EXTS = ('.webm', '.mov')   # .webm = VP9-Alpha 成品；.mov = 手工抠好的带 alpha 母版

sys.stdout.reconfigure(encoding='utf-8')


def in_decoder(path):
    """输入解码器参数。

    VP9-Alpha 的 alpha 存在 WebM 的 BlockAdditional 侧数据里，**必须**用 libvpx-vp9
    解码器才出 alpha（原生 vp9 解码器只给 yuv420p）；反过来，对 MOV（ProRes 4444 /
    qtrle / PNG）硬指定 libvpx-vp9 会直接解码失败。所以按扩展名分派。"""
    return ['-c:v', 'libvpx-vp9'] if Path(path).suffix.lower() == '.webm' else []


def probe_size(path):
    p = subprocess.run([str(FFMPEG), '-hide_banner', '-i', str(path)],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    ms = re.findall(r'(\d{2,5})x(\d{2,5})', p.stderr)
    m = re.search(r'(\d+(?:\.\d+)?) fps', p.stderr)
    fps = float(m.group(1)) if m else 30.0
    if not ms:
        raise SystemExit('无法探测分辨率：%s' % path)
    w, h = (int(v) for v in ms[0])
    return w, h, fps


def measure(path, w, h):
    """流式解码整片，返回 (首帧角色 bbox, 角色 union bbox, 全部内容 union bbox, 帧数)

    两套 bbox 分工（2026-09-23 修正）：

    * **角色 bbox**（= 最大不透明连通块）：用于缩放与锚点。即梦片带的"AI生成"水印是
      独立小块，若按 alpha>thr 整体取 bbox，量到的是"头顶→水印底"，据此缩放会把角色
      压小、脚底悬空（2026-09 实测事故）。
    * **全部内容 bbox**（= 所有 alpha>thr 像素）：用于**裁剪窗**。有些片故意带与角色
      不连通的对话气泡 / 道具 / 特效（深度思考碎碎念 的三个中文气泡、玩游戏气急败坏
      掉在地上的手柄、鲸鱼现世 的鲸鱼虚影），只按角色 bbox 裁会把它们切掉。

    本批（带 alpha 的手扣 MOV）实测：深度思考碎碎念 的气泡恰好落在角色 union 内、
    侥幸没被切，但那只是运气——所以这里显式分开，气泡/道具一律以"全部内容"为准。
    """
    cmd = [str(FFMPEG), '-hide_banner', '-loglevel', 'error'] + in_decoder(path) + [
           '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10 ** 8)
    n = w * h * 4
    ux0 = uy0 = 10 ** 9
    ux1 = uy1 = -1
    ax0 = ay0 = 10 ** 9
    ax1 = ay1 = -1
    first = None
    frames = 0
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        a = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 4)[..., 3]
        mask = a > ALPHA_THR
        b = largest_blob_bbox(mask)
        if b is not None:
            if first is None:
                first = b
            ux0 = min(ux0, b[0]); uy0 = min(uy0, b[1])
            ux1 = max(ux1, b[2]); uy1 = max(uy1, b[3])
        ys, xs = np.where(mask)
        if len(xs):
            ax0 = min(ax0, int(xs.min())); ay0 = min(ay0, int(ys.min()))
            ax1 = max(ax1, int(xs.max()) + 1); ay1 = max(ay1, int(ys.max()) + 1)
        frames += 1
    proc.stdout.close()
    proc.wait()
    if first is None:
        raise SystemExit('整片无可见像素：%s' % path)
    if ax1 < 0:                       # 理论上不会发生（first 不为 None 即 mask 有像素）
        ax0, ay0, ax1, ay1 = ux0, uy0, ux1, uy1
    return first, (ux0, uy0, ux1, uy1), (ax0, ay0, ax1, ay1), frames


def even(v):
    v = int(round(v))
    return v - (v % 2)


def largest_blob_bbox(mask):
    """最大连通块 bbox (半开区间 x0,y0,x1,y1)；无可见像素返回 None。

    只认最大块 = 角色本体，弃掉即梦"AI生成"水印等独立小块（它们会把脚底/高度量错）。

    实现说明：优先用 scipy.ndimage.label（4 连通，与下面 BFS 同语义）——纯 Python 的
    逐像素 BFS 每帧要 0.5~1s，302 帧的片子单是量测就要几分钟，15 条就得跑一小时；
    ndimage 把同样的量测压到毫秒级。没有 scipy 时自动回落到 BFS，结果一致。"""
    if ndimage is not None:
        lab, n = ndimage.label(mask)
        if n == 0:
            return None
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0                       # 0 是背景标签，不参与竞争
        keep = int(np.argmax(sizes))
        sl = ndimage.find_objects(lab, max_label=keep)[keep - 1]
        return (int(sl[1].start), int(sl[0].start), int(sl[1].stop), int(sl[0].stop))
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    bx0, by0 = int(xs.min()), int(ys.min())
    bx1, by1 = int(xs.max()) + 1, int(ys.max()) + 1
    sub = mask[by0:by1, bx0:bx1]
    sh, sw = sub.shape
    seen = np.zeros((sh, sw), dtype=bool)
    best = None
    for sy in range(sh):
        row = sub[sy]
        for sx in range(sw):
            if not row[sx] or seen[sy, sx]:
                continue
            stack = [(sy, sx)]; seen[sy, sx] = True
            x0 = x1 = sx; y0 = y1 = sy; area = 0
            while stack:
                cy, cx = stack.pop(); area += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < sh and 0 <= nx < sw and sub[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; stack.append((ny, nx))
            if best is None or area > best[0]:
                best = (area, (x0 + bx0, y0 + by0, x1 + 1 + bx0, y1 + 1 + by0))
    return best[1]


def plan_clip(path, target_h, margin, anchor_h=None):
    """算出该片的 crop/scale/pad 参数"""
    w, h, fps = probe_size(path)
    first, union, union_all, frames = measure(path, w, h)
    fh = first[3] - first[1]                      # 首帧角色高
    scale = target_h / fh                         # 与锚点同尺寸
    cx = (first[0] + first[2]) / 2.0              # 首帧水平中心
    feet = float(first[3])                        # 首帧脚底

    # 裁剪窗 = **全部内容**的动作范围 + margin（夹到画面内）——含独立气泡/道具，
    # 用角色 union 会把它们切掉（见 measure 的说明）
    x0 = max(0, union_all[0] - margin)
    y0 = max(0, union_all[1] - margin)
    x1 = min(w, union_all[2] + margin)
    y1 = min(h, union_all[3] + margin)
    cw, ch = x1 - x0, y1 - y0

    # 装配不下就下调缩放
    fit = min(CW / cw, CH / ch)
    if scale > fit:
        scale = fit

    sw, sh = max(2, even(cw * scale)), max(2, even(ch * scale))
    px = ANCHOR_X - (cx - x0) * scale             # 首帧水平中心 → x=320
    py = FEET_Y - (feet - y0) * scale             # 首帧脚底 → y=330（引擎 FEET_Y）
    # 兜底：只在画布内平移，绝不裁掉内容
    px = max(0, min(px, CW - sw))
    py = max(0, min(py, CH - sh))
    return {
        'w': w, 'h': h, 'fps': fps, 'frames': frames,
        'first_h': fh, 'scale': scale, 'crop': (even(cw), even(ch), even(x0), even(y0)),
        'scaled': (sw, sh), 'pad': (even(px), even(py)),
        'union': union, 'union_all': union_all, 'first': first,
        'detached': union != union_all,           # 片里是否有独立气泡/道具/特效
    }


def convert(path, out, p, crf):
    cw, ch, x0, y0 = p['crop']
    sw, sh = p['scaled']
    px, py = p['pad']
    vf = ('crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,'
          'pad=%d:%d:%d:%d:color=0x00000000,format=yuva420p,setsar=1'
          % (cw, ch, x0, y0, sw, sh, CW, CH, px, py))
    cmd = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y'] + in_decoder(path) + [
           '-i', str(path), '-vf', vf,
           '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
           '-crf', str(crf), '-b:v', '0', '-row-mt', '1', '-an', str(out)]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src_dir')
    ap.add_argument('out_dir')
    ap.add_argument('--anchor', default='', help='锚点素材名（仅用于打印提示，规则本身按统一目标高）')
    ap.add_argument('--target-h', type=float, default=0.75, help='角色高占画布比例（默认 0.75 → 270px）')
    ap.add_argument('--margin', type=int, default=8)
    ap.add_argument('--crf', type=int, default=15)
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    src_dir, out_dir = Path(args.src_dir), Path(args.out_dir)
    files = sorted(f for f in src_dir.iterdir()
                   if f.is_file() and f.suffix.lower() in SRC_EXTS)
    if not files:
        raise SystemExit('源目录没有 %s：%s' % ('/'.join(SRC_EXTS), src_dir))
    target_h = args.target_h * CH
    print('目标角色高 %.0fpx，画布 %dx%d，脚底 y=%d（引擎 FEET_Y）' % (target_h, CW, CH, FEET_Y))
    if args.anchor:
        print('锚点：%s（所有片首帧统一对齐到该标准尺寸/位置）' % args.anchor)
    print()
    print('%-16s %-11s %-9s %-8s %-20s %-14s %s' % ('素材', '源画布', '首帧高', '缩放', '裁剪窗(w,h,x,y)', '缩放后+偏移', '备注'))
    plans = {}
    for f in files:
        p = plan_clip(f, target_h, args.margin)
        plans[f] = p
        note = '含独立气泡/道具' if p['detached'] else ''
        print('%-16s %-11s %-9d %-8.3f %-20s %-14s %s' % (
            f.stem, '%dx%d' % (p['w'], p['h']), p['first_h'], p['scale'],
            '%d,%d,%d,%d' % p['crop'], '%dx%d+%d+%d' % (p['scaled'][0], p['scaled'][1], p['pad'][0], p['pad'][1]),
            note))
    if args.dry:
        print('\n（--dry：未写出文件）')
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    print()
    for f, p in plans.items():
        out = out_dir / (f.stem + '.webm')   # .mov 母版也要产出 .webm 容器
        convert(f, out, p, args.crf)
        print('✓ %s → %s（%d KB，%d 帧 @ %gfps）' % (
            f.name, out, out.stat().st_size // 1024, p['frames'], p['fps']))


if __name__ == '__main__':
    main()
