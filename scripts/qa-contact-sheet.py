# 逐条质检拼图：每个 webm 抽 首/中/末 三帧（品红衬底看透明），拼成大表一眼验收
# 用法：python scripts/qa-contact-sheet.py [webm目录] [帧数]
# 产出：tools/qa-sheet.png（N 行 × 3 帧，行首标动画名）
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
WEBM = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets-custom' / 'webm'
TOTAL = int(sys.argv[2]) if len(sys.argv) > 2 else 81   # 标准帧数
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
TMP = ROOT / 'tools' / 'qa-tmp'
TMP.mkdir(parents=True, exist_ok=True)
DST = ROOT / 'tools' / 'qa-sheet.png'

THUMB_W = 320
LABEL_W = 150
KEYFRAMES = [0, TOTAL // 2, TOTAL - 1]

files = sorted(WEBM.glob('*.webm'))
if not files:
    raise SystemExit('没有 webm：' + str(WEBM))

rows = []
for f in files:
    imgs = []
    for n in KEYFRAMES:
        png = TMP / f'{f.stem}-{n}.png'
        subprocess.run(
            [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
             '-f', 'lavfi', '-i', 'color=0xFF00FF:s=640x360',
             '-c:v', 'libvpx-vp9', '-i', str(f),
             '-filter_complex', f'[1:v]select=eq(n\\,{n})[m];[0:v][m]overlay=0:0',
             '-frames:v', '1', '-update', '1', str(png)],
            check=False)
        if png.exists():
            im = Image.open(png).convert('RGB')
            im.thumbnail((THUMB_W, 9999), Image.LANCZOS)
        else:
            im = Image.new('RGB', (THUMB_W, int(THUMB_W * 9 / 16)), (120, 0, 0))
        imgs.append(im)
    rows.append((f.stem, imgs))
    print('抽帧：' + f.stem)

th = int(THUMB_W * 9 / 16)
sheet = Image.new('RGB', (LABEL_W + 3 * THUMB_W, len(rows) * th), (30, 30, 36))
d = ImageDraw.Draw(sheet)
for i, (name, imgs) in enumerate(rows):
    d.text((6, i * th + th // 2 - 6), name, fill=(255, 255, 120))
    for j, im in enumerate(imgs):
        sheet.paste(im, (LABEL_W + j * THUMB_W, i * th))
sheet.save(DST)
print('->', DST)
