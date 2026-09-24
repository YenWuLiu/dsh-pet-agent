# 生成桌宠的两个拖拽光标（本项目自制）：
#   assets/pic/cursor-grab.png       —— 抓住前：张开的手（hover 在宠物身上时）
#   assets/pic/cursor-grabbing.png   —— 拖拽中：握起来的手（.pet-hit.dragging）
#
# 为什么是脚本而不是两张手绘 PNG：渲染端把这两个文件当**槽位名**用
# （renderer.js: `cursor:url(.../pic/cursor-grab.png) 16 16, grab`），文件名不能变；
# 而光标是"看得见但没人会去重建"的那类资源——手绘一张就没有第二个人能再生成。
# 这里按角色配色（深藏青勾边 + 女仆白填充）用几何图形画出来，改配色改常量即可。
#
# 规格（渲染端硬要求）：
#   · 画布 32×32、带 alpha；**热点固定在 (16,16)** —— URL 后面的 `16 16` 就是它，
#     两张图的热点必须落在同一处，否则按下瞬间光标会跳一下。
#   · 描边 1.5px 起：光标要压在任意桌面背景上，纯色填充在浅色/深色壁纸上都会糊掉，
#     所以统一"深色勾边 + 浅色填充"两层。
#
# 用法：
#   python scripts/make-cursors.py                  # 覆盖 assets/pic/ 里那两个文件
#   python scripts/make-cursors.py --out <目录>      # 写到别处（预览用）
#   python scripts/make-cursors.py --preview 8      # 额外输出 8 倍放大图，便于肉眼验收
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / 'assets' / 'pic'

# 最终尺寸与渲染端 `16 16` 热点一致：热点 = 画布中心
SIZE = 32
# 超采样倍数：几何图形先按 8 倍画，再 LANCZOS 缩回 32×32，边缘才不会有锯齿
SS = 8
# 描边宽度（最终像素）——1.5px 在 16px 的托盘/桌面尺度上是"看得见但不臃肿"
OUTLINE = 1.5

# 配色：与角色设定集（docs/images/character-design-sheet.png）同一套
FILL = (255, 255, 255, 255)      # MAID WHITE：手掌填充
STROKE = (35, 42, 92, 255)       # DEEP NAVY：勾边（同时保证浅背景上不糊）


def _rr(draw: ImageDraw.ImageDraw, box, radius, fill) -> None:
    """圆角矩形（box 用最终像素坐标，函数内部换算到超采样画布）。"""
    x0, y0, x1, y1 = (v * SS for v in box)
    draw.rounded_rectangle((x0, y0, x1, y1), radius=radius * SS, fill=fill)


def _blob(shape) -> Image.Image:
    """把 shape(draw) 画成 1 张超采样的 alpha 蒙版。"""
    img = Image.new('L', (SIZE * SS, SIZE * SS), 0)
    shape(ImageDraw.Draw(img))
    return img


def _grab_mask() -> Image.Image:
    """张开的手：四指并拢朝上 + 左侧拇指，掌心在下，整体居中。"""

    def shape(d: ImageDraw.ImageDraw) -> None:
        # 掌心
        _rr(d, (8.6, 15.0, 23.4, 26.4), 4.2, 255)
        # 四根手指（高度错开，读起来才是"手"而不是"梳子"）
        _rr(d, (9.6, 6.4, 12.8, 18.0), 1.6, 255)    # 食指
        _rr(d, (13.2, 4.8, 16.4, 18.0), 1.6, 255)   # 中指
        _rr(d, (16.8, 5.8, 20.0, 18.0), 1.6, 255)   # 无名指
        _rr(d, (20.4, 8.6, 23.4, 18.0), 1.6, 255)   # 小指
        # 拇指：往左上斜出去
        thumb = Image.new('L', (SIZE * SS, SIZE * SS), 0)
        td = ImageDraw.Draw(thumb)
        _rr(td, (4.0, 13.0, 9.4, 24.0), 2.6, 255)
        thumb = thumb.rotate(38, resample=Image.BICUBIC, center=(7.0 * SS, 18.5 * SS))
        d.bitmap((0, 0), thumb, fill=255)

    return _blob(shape)


def _grabbing_mask() -> Image.Image:
    """握起来的手：手指收进掌心，只剩指节鼓包 + 压在外面的拇指。"""

    def shape(d: ImageDraw.ImageDraw) -> None:
        # 掌心
        _rr(d, (8.6, 11.4, 23.4, 26.4), 5.0, 255)
        # 四个指节鼓包：贴着掌心上缘，比"张开"矮一大截
        _rr(d, (9.6, 8.2, 12.8, 16.0), 1.6, 255)
        _rr(d, (13.2, 7.2, 16.4, 16.0), 1.6, 255)
        _rr(d, (16.8, 7.8, 20.0, 16.0), 1.6, 255)
        _rr(d, (20.4, 9.6, 23.4, 16.0), 1.6, 255)
        # 拇指横压在掌前（收拢的标志）
        thumb = Image.new('L', (SIZE * SS, SIZE * SS), 0)
        td = ImageDraw.Draw(thumb)
        _rr(td, (8.0, 18.4, 21.0, 23.2), 2.6, 255)
        thumb = thumb.rotate(-12, resample=Image.BICUBIC, center=(14.5 * SS, 20.8 * SS))
        d.bitmap((0, 0), thumb, fill=255)

    return _blob(shape)


def _dilate(mask: Image.Image, px: float) -> Image.Image:
    """按最终像素 dilate（MaxFilter 每遍只长 (size-1)/2，所以要循环）。"""
    grow = max(1, round(px * SS))
    step, out = 9, mask
    done = 0
    while done < grow:
        out = out.filter(ImageFilter.MaxFilter(step))
        done += (step - 1) // 2
    return out


def render(mask: Image.Image, detail=None) -> Image.Image:
    """蒙版 → 「深色勾边 + 浅色填充」的 RGBA 光标图。

    detail 是画在填充之上、并被蒙版裁掉的内部结构线（指缝 / 拇指边）——
    全白的实心块在 16px 上会糊成一个白团，靠这几根线才有"手"的形状。
    """
    outer = _dilate(mask, OUTLINE)
    img = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    img.paste(Image.new('RGBA', mask.size, STROKE), (0, 0), outer)
    img.paste(Image.new('RGBA', mask.size, FILL), (0, 0), mask)
    if detail is not None:
        ink = Image.new('L', mask.size, 0)
        detail(ImageDraw.Draw(ink))
        ink = Image.composite(ink, Image.new('L', mask.size, 0), mask)  # 只留掌内的线
        img.paste(Image.new('RGBA', mask.size, STROKE), (0, 0), ink)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def _grab_detail(d: ImageDraw.ImageDraw) -> None:
    """张开的手：指缝。"""
    for x in (13.0, 16.6, 20.2):
        d.line((x * SS, 6.0 * SS, x * SS, 17.6 * SS), fill=255, width=int(0.6 * SS))


def _grabbing_detail(d: ImageDraw.ImageDraw) -> None:
    """握起来的手：指节分界 + 拇指压痕。"""
    for x in (13.0, 16.6):
        d.line((x * SS, 8.4 * SS, x * SS, 15.6 * SS), fill=255, width=int(0.6 * SS))
    d.line((8.8 * SS, 18.0 * SS, 21.2 * SS, 18.0 * SS), fill=255, width=int(0.7 * SS))


def main() -> int:
    ap = argparse.ArgumentParser(description='生成 assets/pic/ 的两个拖拽光标（自制）')
    ap.add_argument('--out', default=str(DEFAULT_OUT), help=f'输出目录（默认 {DEFAULT_OUT}）')
    ap.add_argument('--preview', type=int, default=0, metavar='N',
                    help='额外输出 N 倍放大的预览图（便于肉眼验收，不参与发行）')
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, mask, detail in (
        ('cursor-grab.png', _grab_mask(), _grab_detail),
        ('cursor-grabbing.png', _grabbing_mask(), _grabbing_detail),
    ):
        img = render(mask, detail)
        if img.getbbox() is None:
            print(f'[X] {name} 画出来是空的（几何常量写错了？）')
            return 1
        path = out_dir / name
        img.save(path)
        if args.preview > 0:
            img.resize((SIZE * args.preview, SIZE * args.preview), Image.NEAREST).save(
                out_dir / name.replace('.png', f'@{args.preview}x.png'))
        print(f'[OK] {name} {img.size[0]}x{img.size[1]} alpha=有 热点=(16,16)  ->  {path}')

    print('     提示：热点由渲染端 CSS 写死（renderer.js 的 `16 16`），改画布尺寸要同步改那里。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
