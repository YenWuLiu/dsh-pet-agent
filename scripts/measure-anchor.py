# 量「参考锚点」的角色几何，并与《桌面宠物 10 秒动作提示词.md》的通用前缀逐项比对。
# 目的：前缀里的位置/大小硬指标会不会让生成结果偏离引擎契约（命中区/脚底线）。
from PIL import Image
import numpy as np
from scipy import ndimage

P = 'assets-custom/ref-src-clean/正面锚点-1280x720.png'
im = Image.open(P).convert('RGB')
a = np.asarray(im).astype(np.int16)
h, w, _ = a.shape

corners = np.concatenate([
    a[0:8, 0:8].reshape(-1, 3), a[0:8, -8:].reshape(-1, 3),
    a[-8:, 0:8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3),
])
bg = np.median(corners, axis=0)
green_screen = bool(bg[1] > bg[0] * 1.3 and bg[1] > bg[2] * 1.3)

near = (np.abs(a - bg).max(axis=2) <= 36)
lab, _ = ndimage.label(near)
border = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
border = border[border != 0]
is_bg = np.isin(lab, border) | ((a[:, :, 1] > a[:, :, 0] + 12) & (a[:, :, 1] > a[:, :, 2] + 12))
al = np.where(is_bg, 0, 255).astype(np.uint8)
al = np.where(ndimage.binary_erosion(al > 0, iterations=2), 255, 0).astype(np.uint8)

lab2, n2 = ndimage.label(al > 0)
sizes = ndimage.sum(al > 0, lab2, range(1, n2 + 1))
keep = int(np.argmax(sizes)) + 1
ys, xs = np.where(lab2 == keep)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
cw, ch = x1 - x0 + 1, y1 - y0 + 1

print(f'背景色 {bg}  绿幕判定 {green_screen}   连通块数 {n2}   最大块/次大块 = '
      f'{int(max(sizes))}/{int(sorted(sizes)[-2]) if n2 > 1 else 0}')
print(f'画幅 {w}x{h}   角色 bbox {cw}x{ch}')
print(f'  高占比 {ch/h*100:.1f}%   宽占比 {cw/w*100:.1f}%   w/h {cw/ch:.3f}')
print(f'  头顶 y={y0} ({y0/h*100:.1f}%)   脚底 y={y1} ({y1/h*100:.1f}%)')
print(f'  左缘 x={x0} ({x0/w*100:.1f}%)   右缘 x={x1} ({x1/w*100:.1f}%)')
print(f'  bbox 水平中心 x={(x0+x1)/2:.0f} ({(x0+x1)/2/w*100:.1f}%)')

prefix_w_over_h = (0.50 * 16) / (0.65 * 9)
print()
print('通用前缀：头顶 20% / 脚底 85% / 左缘 25% / 右缘 75%')
print(f'  => 高占比 65.0%（参考图 {ch/h*100:.1f}%）  宽占比 50.0%（参考图 {cw/w*100:.1f}%）')
print(f'  => 前缀隐含 w/h {prefix_w_over_h:.3f}   参考图实测 w/h {cw/ch:.3f}')

HIT_W = 240  # shared-core HIT_BOX x 200~440
print()
print(f'引擎命中区宽 {HIT_W}px（HIT_BOX x200~440），角色高 270px 时：')
print(f'  按参考图比例 -> 角色宽 {270*cw/ch:.0f}px  {"放得下" if 270*cw/ch <= HIT_W else "超出"}')
print(f'  按前缀比例   -> 角色宽 {270*prefix_w_over_h:.0f}px  '
      f'{"放得下" if 270*prefix_w_over_h <= HIT_W else "超出命中区，边缘点不到"}')
