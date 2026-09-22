# 探针：对一段「AI 原始片」跑一遍 key-video.py 的抠像逻辑，统计每帧的透明连通块。
# 回答一个具体问题：key-video.py 的「只保留最大连通域」会吃掉多少东西？
#   - 若次大块普遍是几十像素 → 就是水印/杂点，现有规则正确；
#   - 若出现成百上千像素的独立块 → 那是道具/特效（雪人、烟花、蝴蝶、泡泡），
#     现有规则会把它们整段删掉，需要放宽成「按面积比保留」。
#
# 用法：python scripts/probe-blobs.py <video> [--frames 24] [--thresh 36]
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('--frames', type=int, default=24, help='抽多少帧（均匀取）')
ap.add_argument('--thresh', type=int, default=36)
ap.add_argument('--erode', type=int, default=2)
ap.add_argument('--workdir', default='')
args = ap.parse_args()

SRC = Path(args.src)
tmp = Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix='dsh-probe-'))
frames_dir = tmp / 'frames'
frames_dir.mkdir(parents=True, exist_ok=True)
subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
                '-i', str(SRC), '-vsync', '0', str(frames_dir / '%04d.png')], check=True)
files = sorted(frames_dir.glob('*.png'))
if not files:
    raise SystemExit('解帧失败')
step = max(1, len(files) // args.frames)
picked = files[::step][:args.frames]
print(f'{SRC.name}: 共 {len(files)} 帧，抽检 {len(picked)} 帧')

print(f'{"帧":>5} {"主块px":>9} {"次大px":>8} {"占比":>7}  其它块(px, 左上角/右下角)')
ratios = []
for fp in picked:
    a = np.asarray(Image.open(fp).convert('RGB')).astype(np.int16)
    h, w, _ = a.shape
    corners = np.concatenate([a[0:8, 0:8].reshape(-1, 3), a[0:8, -8:].reshape(-1, 3),
                              a[-8:, 0:8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    near = (np.abs(a - bg).max(axis=2) <= args.thresh)
    lab, _ = ndimage.label(near)
    border = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    is_bg = np.isin(lab, border)
    if bg[1] > bg[0] * 1.3 and bg[1] > bg[2] * 1.3:
        is_bg = is_bg | ((a[:, :, 1] > a[:, :, 0] + 12) & (a[:, :, 1] > a[:, :, 2] + 12))
    al = np.where(is_bg, 0, 255).astype(np.uint8)
    al = np.where(ndimage.binary_erosion(al > 0, iterations=args.erode), 255, 0).astype(np.uint8)
    lab2, n2 = ndimage.label(al > 0)
    if n2 == 0:
        print(f'{fp.stem:>5}  抠空了')
        continue
    objs = ndimage.find_objects(lab2)
    sizes = ndimage.sum(al > 0, lab2, range(1, n2 + 1))
    order = np.argsort(sizes)[::-1]
    main = int(sizes[order[0]])
    second = int(sizes[order[1]]) if n2 > 1 else 0
    ratios.append(second / main if main else 0)
    others = []
    for i in order[1:6]:
        sl = objs[i]
        others.append(f'{int(sizes[i])}px@({sl[1].start},{sl[0].start})')
    print(f'{fp.stem:>5} {main:>9} {second:>8} {second/main*100 if main else 0:>6.2f}%  {", ".join(others)}')

if ratios:
    print(f'\n次大块/主块 面积比：中位 {np.median(ratios)*100:.2f}%  最大 {max(ratios)*100:.2f}%')
    print('判读：普遍 <1% → 只是水印/杂点；出现 >5% 的帧 → 有被误删的道具/特效')
