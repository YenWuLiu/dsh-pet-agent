# -*- coding: utf-8 -*-
"""精灵图验证页生成器：扫描 <lab>/*/*.meta.json，生成并排对比页 index.html。

左起第一格是原 webm（24fps 全帧，当前引擎在用的格式），右边是同一片的
N 帧精灵图。所有格子**统一 320×180 显示**，所以肉眼看到差异只来自「帧数」，
不来自分辨率——这样才能判断「少到几张静图还能不能看」。

用法：
  python scripts/make-sprite-preview.py .sprite-lab
"""
import html
import json
import os
import sys
from pathlib import Path

LAB = Path(sys.argv[1] if len(sys.argv) > 1 else '.sprite-lab').resolve()
BOX_W, BOX_H = 320, 180

sys.stdout.reconfigure(encoding='utf-8')


def main():
    metas = sorted(LAB.glob('*/*.meta.json'))
    if not metas:
        raise SystemExit(f'{LAB} 下没有 meta.json，先跑 make-sprite-sheet.py')

    rows = []
    for mp in metas:
        m = json.loads(mp.read_text(encoding='utf-8'))
        d = mp.parent
        rel = d.relative_to(LAB).as_posix()
        src = m['source']
        # 原片：从 assets/webm 反查（meta 只存了名字）
        webm = Path(os.path.relpath(LAB.parent / 'assets' / 'webm' / src['name'], LAB)).as_posix()
        variants = m['variants']

        cells = [f'''<figure>
  <video src="{html.escape(webm)}" width="{BOX_W}" height="{BOX_H}"
         autoplay loop muted playsinline></video>
  <figcaption><b>原片 webm</b><br>{src['frames']} 帧 @{src['fps']:g}fps<br>
  <span class=dim>{src['bytes']/1024:.0f} KB · 流式解码 ~0.9 MB</span></figcaption>
</figure>''']

        for v in variants:
            # 精灵图文件名用 stem（make-sprite-sheet.py 里是 src.stem），不是带扩展名的 name
            sheet = f'{rel}/{Path(src["name"]).stem}.sheet.{v["label"]}.png'
            cells.append(f'''<figure>
  <canvas width="{BOX_W}" height="{BOX_H}"
          data-sheet="{html.escape(sheet)}" data-cols="{v['cols']}"
          data-rows="{v['rows']}" data-frames="{v['frames']}"
          data-cw="{v['cell'][0]}" data-ch="{v['cell'][1]}"
          data-fps="{v['fps']:.6f}"></canvas>
  <figcaption><b>{v['label']}</b>（{v['fps']:.2f}fps）<br>{v['frames']} 帧 · {v['cols']}×{v['rows']}<br>
  <span class=dim>{v['png_bytes']/1024:.0f} KB · 显存 {v['decoded_mb']:.1f} MB</span></figcaption>
</figure>''')

        ratio = variants[0]['png_bytes'] / src['bytes'] if src['bytes'] else 0
        rows.append(f'''<section>
<h2>{html.escape(src['name'])} <span class=dim>— 原片 {src['w']}×{src['h']}，
动作并集 {src['union_bbox'][2]-src['union_bbox'][0]}×{src['union_bbox'][3]-src['union_bbox'][1]}px，
alpha {'有' if src['has_alpha'] else '无'}</span></h2>
<div class=strip>{''.join(cells)}</div>
</section>''')

    doc = f'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>精灵图验证 · 原片 vs N 帧精灵图</title>
<style>
 body {{ background:#14161a; color:#e8eaed; font:14px/1.5 "Microsoft YaHei UI",sans-serif;
        margin:0; padding:24px 28px 60px; }}
 h1 {{ font-size:19px; margin:0 0 6px; }}
 h2 {{ font-size:15px; font-weight:600; margin:26px 0 10px; color:#cfd4da; }}
 .dim {{ color:#8b929c; font-weight:400; }}
 .strip {{ display:flex; flex-wrap:wrap; gap:14px; }}
 figure {{ margin:0; background:#1d2026; border:1px solid #2b2f37; border-radius:8px;
           padding:10px; }}
 figure video, figure canvas {{
   display:block; border-radius:4px; image-rendering:auto;
   /* 棋盘格衬底：透明区域一眼可辨（桌宠贴桌面时就是这种效果） */
   background-color:#2a2e36;
   background-image:linear-gradient(45deg,#22252b 25%,transparent 25%,transparent 75%,#22252b 75%),
                    linear-gradient(45deg,#22252b 25%,transparent 25%,transparent 75%,#22252b 75%);
   background-size:16px 16px; background-position:0 0,8px 8px; }}
 figcaption {{ margin-top:8px; font-size:12px; color:#dfe3e8; text-align:center; }}
 .bar {{ position:sticky; top:0; z-index:9; background:#14161af2; padding:10px 0 12px;
         border-bottom:1px solid #2b2f37; margin-bottom:4px; }}
 .bar button {{ background:#2b3038; color:#e8eaed; border:1px solid #3a404a;
                border-radius:6px; padding:5px 12px; margin-right:8px; cursor:pointer;
                font:inherit; }}
 .bar button:hover {{ background:#353b45; }}
 .bar button.on {{ background:#3d6fd4; border-color:#3d6fd4; }}
</style>
<div class=bar>
  <h1>精灵图验证：原片 webm vs N 帧精灵图</h1>
  <div class=dim style="margin-bottom:8px">
    所有格子统一 320×180 显示 —— 肉眼差异只来自帧数，不来自分辨率。
    棋盘格 = 透明区。放慢播放更容易看出卡顿。
  </div>
  <button data-s="1" class=on>1×</button>
  <button data-s="0.5">0.5×</button>
  <button data-s="0.25">0.25×</button>
  <button data-s="0.1">0.1×</button>
</div>
{''.join(rows)}
<script>
const imgs = new Map();
let speed = 1, t0 = performance.now();

for (const cv of document.querySelectorAll('canvas[data-sheet]')) {{
  const im = new Image();
  im.src = cv.dataset.sheet;
  imgs.set(cv, im);
}}

function draw(now) {{
  const el = (now - t0) / 1000 * speed;
  for (const [cv, im] of imgs) {{
    const d = cv.dataset, n = +d.frames, fps = +d.fps, cw = +d.cw, ch = +d.ch;
    if (!im.complete || !im.naturalWidth) continue;
    const period = n / fps;                       // 与原片等长的一轮
    const i = Math.min(n - 1, Math.floor((el % period) * fps));
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, (i % +d.cols) * cw, Math.floor(i / +d.cols) * ch, cw, ch,
                  0, 0, cv.width, cv.height);
  }}
  requestAnimationFrame(draw);
}}
requestAnimationFrame(draw);

for (const b of document.querySelectorAll('.bar button')) {{
  b.onclick = () => {{
    // 重锚时间基准，避免变速瞬间跳帧
    const now = performance.now();
    t0 = now - (now - t0) * speed / +b.dataset.s;
    speed = +b.dataset.s;
    for (const v of document.querySelectorAll('video')) v.playbackRate = speed;
    document.querySelectorAll('.bar button').forEach(x => x.classList.toggle('on', x === b));
  }};
}}
</script>
</html>'''
    out = LAB / 'index.html'
    out.write_text(doc, encoding='utf-8')
    print(f'-> {out}（{len(metas)} 个素材）')


if __name__ == '__main__':
    main()
