# 生成桌宠的两个派生图形资源：
#   1) runtime/electron-helper/tray.png —— 系统托盘图标（32×32）
#   2) packaging/app.ico               —— 打包用应用图标（exe / 快捷方式 / 安装器 / 任务栏）
#
# 为什么是派生文件而不是手绘素材：图标必须与角色形象一致，而角色形象由
# assets/pic/ 的表情图标决定（自制素材管线 § make-icons.py）。这里按 alpha 重新
# 裁紧 + 极窄留白后缩小——直接拿 256×256 的原图缩会保留 5% 透明边距，
# 在 16px 的托盘里脸只剩 14px，糊成一团。
#
# 用法：
#   python scripts/make-tray-icon.py                 # notify-done → tray.png + app.ico
#   python scripts/make-tray-icon.py --src assets/pic/notify-question.png
#
# 换角色形象后必须重跑一次——否则托盘/任务栏上挂的还是上一个角色的脸。
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / 'assets' / 'pic' / 'notify-done.png'
TRAY_OUT = ROOT / 'runtime' / 'electron-helper' / 'tray.png'
ICO_OUT = ROOT / 'packaging' / 'app.ico'

# 托盘实际显示尺寸：Windows 100% DPI = 16px，200% = 32px。
# 出 32×32 让高 DPI 屏有原生像素，低 DPI 由 Electron 下采样。
TRAY_SIZE = 32
# Windows 图标要的多档尺寸；electron-builder 要求 ico 里至少含 256×256
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
# 裁紧后再留 4% 呼吸位，避免图标顶到边缘
PAD_RATIO = 0.04


def squared(src: Path, side: int) -> Image.Image:
    """读源图标 → 按 alpha 裁紧 → 补正方形留白 → 缩到 side×side。"""
    img = Image.open(src).convert('RGBA')
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    canvas_side = max(1, int(round(max(w, h) * (1 + PAD_RATIO * 2))))
    canvas = Image.new('RGBA', (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(img, ((canvas_side - w) // 2, (canvas_side - h) // 2), img)
    return canvas.resize((side, side), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser(description='生成桌宠托盘图标与应用图标')
    ap.add_argument('--src', default=str(DEFAULT_SRC), help=f'源 PNG（默认 {DEFAULT_SRC}）')
    ap.add_argument('--out', default=str(TRAY_OUT), help=f'托盘 PNG 输出（默认 {TRAY_OUT}）')
    ap.add_argument('--ico', default=str(ICO_OUT), help=f'应用 ICO 输出（默认 {ICO_OUT}）')
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_file():
        print(f'[X] 源图标不存在：{src}')
        print('  先补齐 assets/pic/（见 assets/README.md），或换 --src')
        return 1

    tray_out = Path(args.out)
    tray_out.parent.mkdir(parents=True, exist_ok=True)
    tray = squared(src, TRAY_SIZE)
    tray.save(tray_out, optimize=True)
    print(f'[OK] 托盘图标 {tray.size[0]}x{tray.size[1]} <- {src.name}  =>  {tray_out.relative_to(ROOT)}')

    ico_out = Path(args.ico)
    ico_out.parent.mkdir(parents=True, exist_ok=True)
    # ICO 从 256 母版缩，避免逐档从 32px 放大糊掉
    squared(src, 256).save(ico_out, format='ICO', sizes=[(s, s) for s in ICO_SIZES])
    print(f'[OK] 应用图标 {ICO_SIZES} <- {src.name}  =>  {ico_out.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
