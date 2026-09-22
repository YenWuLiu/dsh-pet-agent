# -*- coding: utf-8 -*-
"""build-chain.py — 把「待机头 + 动作主体 + 待机尾」烘焙成一条自洽的动画片。

为什么需要它（2026-09 实测）
  桌宠的动作片与待机是**不同批次生成**的：站位和姿势一致（首尾帧轮廓 IoU 0.94），
  但头发/尾巴的渲染细节不同，实测像素差 25~35 RMS，是待机自身帧间噪声（~12）的
  2~3 倍。这个差靠裁剪消不掉，硬切就是"闪一下"。

  做法是让每条片**首帧 = 待机循环点、末帧 = 循环点的前一帧**：
    [待机 f0 … ] → [溶解] → [动作主体] → [溶解] → [ … 待机 f61]
    · 进片：引擎从"活着的待机"淡入片子第 0 帧 —— 同一像素，交叉淡化变空操作；
    · 出片：末帧是待机 f61，淡回待机也是同代同姿势；
    · 跨代的那点贴图差全夹在片子内部两段溶解里，10 帧摊薄到每帧 ~3，看不见。
  于是不依赖引擎行为：硬切也不闪。

  溶解必须在 **premultiplied 空间线性插值**（out=(1-t)A+tB，RGB 与 alpha 一起插），
  覆盖度恒等不变。两层各自降透明度再叠加得到的是 1-(1-t)(1-t)，t=0.5 时覆盖度
  掉到 0.75 —— 那就是之前修过的"换片闪一下"。

几何
  主体的 crop/scale/pad 直接复用 scripts/normalize-webm.py 的 plan_clip()，全片仍
  满足锚点契约（角色高 270 / 脚底 FEET_Y=330 / 中心 x=320）；烘焙后首帧是待机帧，
  锚点更是天然一致。

用法
  python scripts/build-chain.py                    # 按内置 CHAIN 表全量构建
  python scripts/build-chain.py --dry              # 只算几何、不写文件
  python scripts/build-chain.py --only 睡觉        # 只做一条
  python scripts/build-chain.py --crf 22 --preview-dir assets-custom/raw-local/chain-preview
退出码：0 成功；1 有验收不达标；2 环境缺依赖。
"""
import argparse
import gc
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')

CW, CH, FPS = 640, 360, 30
LOCAL_FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
FFMPEG = str(LOCAL_FFMPEG) if LOCAL_FFMPEG.exists() else 'ffmpeg'
WORK = ROOT / '.tmp-chain'

# 切点来自实测：d0 = 每帧与自身首帧的姿态差，取峰值的 10% 作为"开始在动"，
# 再各留 3 帧缓冲。见 assets-custom/QA-NOTES.md。
CHAIN = {
    'idle': 'assets/webm/待机呼吸.webm',
    'master_dir': 'assets-custom/raw-local/manual-key-masters-20260914',
    'out_dir': 'assets/webm',
    # 过渡方式：**硬切**（2026-09-14 用户定：重影比跳变更影响观感）
    #
    # 为什么不做溶解：动作片与待机是不同批次生成，轮廓差几像素（尾巴角度、发丝边缘），
    # 两张图各 50% 一叠就是清清楚楚的双影。实测 10 帧溶解（0.33s）比引擎自带的
    # 240ms 交叉淡化还长，用户直接报"切换到待机有重影"；缩到 4 帧（0.13s）仍能看出
    # 短暂发虚。跨代贴图差消不掉，只能选"瞬变"还是"持续双影"——选瞬变。
    #
    # 硬切结构：待机头 4 帧（第 0 帧 = 循环点）→ 硬切进主体 → 硬切回待机尾 4 帧
    #           （末帧 = 循环点前一帧）。首末帧仍是待机帧，所以引擎那两次淡入淡出
    #           依旧是空操作；两处硬切的幅度由 verify() 量出来，并给出"邻近帧里能做到的
    #           最小值"，确认切点没浪费。
    # 想回到溶解：--dissolve 4（软切）或 --dissolve 10（更软但双影明显）。
    'head_frames': 4,        # 纯待机头（帧 0 就是循环点）
    'tail_frames': 4,        # 纯待机尾（末帧 = 循环点前一帧）
    'dissolve_frames': 0,    # 0 = 硬切；>0 = 两段 premultiplied 线性溶解
    'clips': [
        {'name': '点击回应开心', 'start': 45, 'end': 140},
        {'name': '点击回应生气', 'start': 15, 'end': 142},
        {'name': '吃干饭', 'start': 4, 'end': 241},
        {'name': '睡觉', 'start': 9, 'end': 290},
    ],
}


def load_normalizer():
    spec = importlib.util.spec_from_file_location(
        'normalize_webm', str(ROOT / 'scripts' / 'normalize-webm.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode_raw(cmd, w=CW, h=CH, tag='tmp'):
    """跑一条 ffmpeg 命令，把 rawvideo 落到文件再 mmap（沙箱里管道不可用）。

    `-fps_mode passthrough` 不能省：rawvideo 不带时间戳，带 -vf 时 ffmpeg 会按
    默认 25fps 做一次 CFR 转换，把 30fps 的帧抽掉 1/6（2026-09 实测 96 帧变 81 帧，
    溶解步进因此虚高一倍）。"""
    WORK.mkdir(exist_ok=True)
    raw = WORK / ('%s.raw' % tag)
    subprocess.run(cmd + ['-fps_mode', 'passthrough', '-f', 'rawvideo', str(raw)],
                   check=True)
    n = raw.stat().st_size // (w * h * 4)
    return np.memmap(raw, dtype=np.uint8, mode='r').reshape(n, h, w, 4), raw


def drop(mem, path):
    """读完就释放 mmap 并删文件 —— Windows 下句柄不放手就删不掉。"""
    del mem
    gc.collect()
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def decode_idle(path):
    arr, raw = decode_raw([FFMPEG, '-y', '-v', 'error', '-c:v', 'libvpx-vp9',
                           '-i', str(path), '-pix_fmt', 'rgba'], tag='idle')
    out = np.array(arr)
    drop(arr, raw)
    return out


def extract_body(master, start, end, plan, tag, fps=FPS):
    cw, ch, x0, y0 = plan['crop']
    sw, sh = plan['scaled']
    px, py = plan['pad']
    vf = ("select='between(n\\,%d\\,%d)',setpts=N/%d/TB,"
          "crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,"
          "pad=%d:%d:%d:%d:color=0x00000000,format=yuva420p,setsar=1"
          % (start, end, fps, cw, ch, x0, y0, sw, sh, CW, CH, px, py))
    return decode_raw([FFMPEG, '-y', '-v', 'error', '-c:v', 'libvpx-vp9',
                       '-i', str(master), '-vf', vf, '-pix_fmt', 'rgba'], tag=tag)


def premult(a):
    x = a.astype(np.float32)
    return np.concatenate([x[..., :3] * (x[..., 3:4] / 255.0), x[..., 3:4]], axis=-1)


def unpremult(p):
    al = p[..., 3:4]
    rgb = np.divide(p[..., :3], np.maximum(al, 1e-6) / 255.0)
    return np.concatenate([np.clip(rgb, 0, 255), np.clip(al, 0, 255)], axis=-1).astype(np.uint8)


def dissolve(a, b, t):
    """premultiplied 线性插值：覆盖度恒等，不会出现 1-t+t² 的凹陷。"""
    return unpremult((1.0 - t) * premult(a) + t * premult(b))


def bake(idle, body, head, tail, dissolve_frames, with_tail=True):
    """拼一条片。

    dissolve_frames = 0：**硬切**——待机头 + 整个主体 + 待机尾，两个交界处直接切。
      首帧仍是待机 f0、末帧仍是待机 f61，所以引擎那两次淡入淡出都是空操作；
      片内两处是硬切，没有双影（跨代贴图差表现为一次瞬变，而不是持续 0.1s+ 的重影）。
    dissolve_frames > 0：两段 premultiplied 线性溶解（见文件头说明）。

    with_tail=False：**不烘待机尾**（片子在主体自身姿势上收尾）。给"就是不回站姿"的片
      （坐定抱膝、转向收尾）用：硬切回站姿等于把大姿势差压成 1 帧瞬变（比什么都难看），
      交回引擎 240ms 交叉淡化更自然。条目结构：待机头 + 主体。
    """
    n = body.shape[0]
    if dissolve_frames <= 0:
        out = [idle[i] for i in range(head)]
        out.extend(body)
        if with_tail:
            out.extend(idle[idle.shape[0] - tail:])
        return out

    L = dissolve_frames
    if n <= 2 * L:
        raise SystemExit('主体只有 %d 帧，放不下两段 %d 帧的溶解' % (n, L))
    # L=1 时没有混合，等价于硬切（j/(L-1) 会 0/0）
    def t_of(j):
        return 0.0 if L <= 1 else j / (L - 1.0)

    out = [idle[i] for i in range(head)]
    if not with_tail:
        for j in range(L):
            out.append(dissolve(idle[head + j], body[j], t_of(j)))
        out.extend(body[L:n])
        return out
    for j in range(L):
        out.append(dissolve(idle[head + j], body[j], t_of(j)))
    out.extend(body[L:n - L])
    for j in range(L):
        out.append(dissolve(body[n - L + j], idle[idle.shape[0] - L + j], t_of(j)))
    return out


def load_micro_dissolve():
    """复用 tools/micro-dissolve.py 的局部微溶解（硬切缝的收尾打磨）。

    2026-09-14 实测：跨代贴图差集中在头发/尾巴（~12% 画面），全场溶解会把
    无差异像素也叠虚（用户否决）；只在差异区溶 2 帧（66ms）切变 15~18→5.3~6.1，
    低于待机自身帧间噪声 p95 7.6，慢放验收通过。"""
    spec = importlib.util.spec_from_file_location(
        'micro_dissolve', str(ROOT / 'tools' / 'micro-dissolve.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def apply_micro_dissolve(frames, head, n_body, k, thr, with_tail=True):
    """在烘焙后的帧序列上，把硬切（入口 head-1→head；有尾时再加出口）各替换为
    k 帧局部微溶解。返回新帧列表（有尾 +2k，无尾 +k）。"""
    md = load_micro_dissolve()
    cut_in = head - 1
    br_in, _ = md.micro_dissolve(frames[cut_in], frames[cut_in + 1], k, thr)
    if not with_tail:
        return frames[:cut_in + 1] + br_in + frames[cut_in + 1:]
    cut_out = head + n_body - 1
    br_out, _ = md.micro_dissolve(frames[cut_out], frames[cut_out + 1], k, thr)
    return (frames[:cut_in + 1] + br_in + frames[cut_in + 1:cut_out + 1]
            + br_out + frames[cut_out + 1:])


def encode(frames, out_path, crf, fps=FPS):
    """编码成 VP9-Alpha WebM。

    `-metadata:s:v:0 alpha_mode=1` 不能省：以 rawvideo 为输入时，libvpx 编码器
    不会给 matroska 写上 AlphaMode 元素，Chromium 就**不会去解码 alpha 平面**，
    桌宠会变成一块黑矩形。以 webm 为输入时（normalize-webm.py 的路径）ffmpeg 会
    自己带上，rawvideo/PNG 输入都不会 —— 2026-09 实测 A/D 无、B/C 有，B 写出的
    元数据字节与线上素材逐字节一致。"""
    WORK.mkdir(exist_ok=True)
    raw = WORK / 'baked.raw'
    np.stack(frames).tofile(raw)
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-f', 'rawvideo',
                    '-pix_fmt', 'rgba', '-s', '%dx%d' % (CW, CH), '-r', str(fps),
                    '-i', str(raw), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                    '-auto-alt-ref', '0', '-crf', str(crf), '-b:v', '0',
                    '-row-mt', '1', '-metadata:s:v:0', 'alpha_mode=1',
                    '-an', str(out_path)], check=True)
    raw.unlink()


def rms_feat(f1, f2, sel=None):
    a, b = premult(f1), premult(f2)
    if sel is not None:
        a, b = a[sel], b[sel]
    d = a - b
    return float(np.sqrt((d * d).mean()))


def best_shift(m1, m2, rad=4):
    def iou(sh):
        s1 = np.roll(np.roll(m1, sh[0], 0), sh[1], 1)
        return (s1 & m2).sum() / max(1, (s1 | m2).sum())
    best, bv = (0, 0), iou((0, 0))
    for dy in range(-rad, rad + 1):
        for dx in range(-rad, rad + 1):
            v = iou((dy, dx))
            if v > bv:
                best, bv = (dy, dx), v
    return (best[1], best[0]), float(bv)


def verify(out_path, idle, head, tail, body, dissolve_frames, micro_k=0, snap=12, with_tail=True):
    """验收：

    ① 首帧必须**就是**待机 f0；有尾时末帧必须**就是**待机 f61（"引擎那两次淡化是空操作"的根据）；
       无尾（with_tail=False）时末帧落在主体自身收尾姿势上，只验收首帧；
    ② 硬切模式（dissolve=0）：量出切变的幅度，并给出"邻近帧里能做到的最小切变"，
       说明切点没有白白浪费（切变本身是跨代贴图差，消不掉，只能选最小处）；
    ③ 溶解模式：溶解段里不能出现比"那一段本来就在动的幅度"更大的跳变；
    ④ alpha 平面齐全（ALPHA_MODE）。
    """
    res = {'file': str(out_path), 'dissolve_frames': dissolve_frames, 'with_tail': with_tail}
    arr, raw = decode_raw([FFMPEG, '-y', '-v', 'error', '-c:v', 'libvpx-vp9',
                           '-i', str(out_path), '-pix_fmt', 'rgba'],
                          tag='verify_' + out_path.stem)
    v = np.array(arr)
    drop(arr, raw)
    res['frames'] = int(v.shape[0])
    n_body = body.shape[0]

    istep = np.array([rms_feat(idle[i], idle[i + 1]) for i in range(idle.shape[0] - 1)])
    bstep = np.array([rms_feat(body[i], body[i + 1]) for i in range(n_body - 1)])
    res['idle_step_median'] = float(np.median(istep))
    res['idle_step_p95'] = float(np.percentile(istep, 95))
    res['body_step_median'] = float(np.median(bstep))
    res['body_step_p95'] = float(np.percentile(bstep, 95))
    res['first_vs_idle0'] = rms_feat(v[0], idle[0])
    res['first_vs_idle1'] = rms_feat(v[0], idle[1])
    res['last_vs_idle_last'] = rms_feat(v[-1], idle[-1])
    res['last_vs_idle_prev'] = rms_feat(v[-1], idle[-2])

    step = np.array([rms_feat(v[i], v[i + 1]) for i in range(v.shape[0] - 1)])
    if dissolve_frames <= 0:
        if micro_k > 0:
            # 微溶解模式：硬切已被 K 帧桥接替换，量桥区窗口内的最大步进
            res['cut_in'] = float(step[head - 1:head + micro_k + 1].max())
            if with_tail:
                res['cut_out'] = float(step[head + n_body + micro_k - 1:head + n_body + 2 * micro_k + 1].max())
        else:
            res['cut_in'] = float(step[head - 1])
            if with_tail:
                res['cut_out'] = float(step[head + n_body - 1])
        res['cut_in_best'] = min(rms_feat(idle[head - 1], body[k])
                                 for k in range(0, min(snap, n_body)))
        res['cut_in_best_at'] = int(min(range(0, min(snap, n_body)),
                                        key=lambda k: rms_feat(idle[head - 1], body[k])))
        if with_tail:
            lo = max(0, n_body - snap)
            res['cut_out_best'] = min(rms_feat(body[k], idle[idle.shape[0] - tail])
                                      for k in range(lo, n_body))
            res['cut_out_best_at'] = int(min(range(lo, n_body),
                                             key=lambda k: rms_feat(body[k], idle[idle.shape[0] - tail])))
            res['dissolve_out_max'] = res['cut_out']
            res['base_out'] = res['idle_step_p95']
        res['dissolve_in_max'] = res['cut_in']
        res['base_in'] = res['idle_step_p95']
    else:
        L = dissolve_frames
        d1 = step[head - 1:head + L]
        res['dissolve_in_max'] = float(d1.max())
        res['base_in'] = max(res['idle_step_p95'], float(np.percentile(bstep[:L + 1], 95)))
        if with_tail:
            d2 = step[v.shape[0] - L - 1:v.shape[0] - 1]
            res['dissolve_out_max'] = float(d2.max())
            res['base_out'] = max(res['idle_step_p95'], float(np.percentile(bstep[-(L + 1):], 95)))

    res['alpha_mode'] = has_alpha_mode(out_path)
    res['ok'] = bool(res['first_vs_idle0'] < 0.5 * res['idle_step_median']
                     and (not with_tail
                          or res['last_vs_idle_last'] < 0.5 * res['idle_step_median'])
                     and res['alpha_mode']
                     and (dissolve_frames <= 0
                          or (res['dissolve_in_max'] <= 1.3 * res['base_in']
                              and (not with_tail
                                   or res['dissolve_out_max'] <= 1.3 * res['base_out']))))
    return res


def has_alpha_mode(path):
    """ALPHA_MODE 标记：Chromium 靠它识别 VP9 侧向 alpha 平面。"""
    return b'ALPHA_MODE' in open(path, 'rb').read(4096 * 64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--crf', type=int, default=20)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--head', type=int, default=None, help='覆盖 CHAIN 的 head_frames')
    ap.add_argument('--dissolve', type=int, default=None,
                    help='溶解帧数：0 = 硬切（默认），>0 = premultiplied 线性溶解')
    ap.add_argument('--out-dir', default='', help='覆盖输出目录（做变体对比用）')
    ap.add_argument('--micro-dissolve', type=int, default=2, metavar='K',
                    help='硬切缝局部微溶解桥帧数（默认 2 = 66ms；0=关闭，回到纯硬切）')
    ap.add_argument('--md-thr', type=float, default=20.0, help='微溶解差异阈值（premult 0-255）')
    ap.add_argument('--spec', default='',
                    help='外部 clips 规格 JSON：{"master_dir":..., "clips":[{name,start,end,master?,fps?}]} '
                         '——新素材不改动内置 CHAIN 表；master 缺省取 master_dir/<name>.webm，fps 缺省 30')
    args = ap.parse_args()
    if args.spec:
        spec = json.loads(Path(args.spec).read_text(encoding='utf-8'))
        if spec.get('master_dir'):
            CHAIN['master_dir'] = spec['master_dir']
        CHAIN['clips'] = spec['clips']
    if args.head is not None:
        CHAIN['head_frames'] = args.head
    if args.dissolve is not None:
        CHAIN['dissolve_frames'] = args.dissolve

    nw = load_normalizer()
    idle_path = ROOT / CHAIN['idle']
    if not idle_path.exists():
        raise SystemExit('待机素材不存在：%s' % idle_path)
    idle = decode_idle(idle_path)
    head, tail = CHAIN['head_frames'], CHAIN['tail_frames']
    dis = CHAIN['dissolve_frames']
    print('待机素材 %s：%d 帧（首帧=循环点，末帧=循环点前一帧）' % (idle_path.name, idle.shape[0]))
    if dis <= 0:
        print('烘焙参数：待机头 %d 帧 + 主体 + 待机尾 %d 帧（**硬切**，不做溶解）'
              % (head, tail))
    else:
        print('烘焙参数：待机头 %d 帧 + 溶解 %d 帧 + 主体 + 溶解 %d 帧' % (head, dis, dis))
    print()
    print('%-14s %-9s %-14s %-8s %-9s %s' %
          ('动画', '主体帧区间', '主体时长', '成品帧数', '成品时长', '验收'))

    master_dir = ROOT / CHAIN['master_dir']
    out_dir = ROOT / (args.out_dir or CHAIN['out_dir'])
    out_dir.mkdir(parents=True, exist_ok=True)
    results, failed = [], 0
    for clip in CHAIN['clips']:
        name = clip['name']
        if args.only and args.only != name:
            continue
        master = Path(clip['master']) if clip.get('master') else master_dir / (name + '.webm')
        fps = float(clip.get('fps', FPS))
        if not master.exists():
            print('%-14s 缺少母版 %s' % (name, master))
            failed += 1
            continue
        plan = nw.plan_clip(master, 0.75 * CH, 8)
        n_body = clip['end'] - clip['start'] + 1

        if args.dry:
            print('%-14s f%03d-f%03d   %.2fs      %-8s %-9s %s'
                  % (name, clip['start'], clip['end'], n_body / fps, '-', '-',
                     'crop=%d,%d,%d,%d scale=%dx%d pad=%d+%d fps=%g'
                     % (plan['crop'] + plan['scaled'] + plan['pad'], fps)))
            continue

        body, body_raw = extract_body(master, clip['start'], clip['end'], plan,
                                      'body_' + name, fps=fps)
        with_tail = clip.get('tail', True) is not False
        if clip.get('pingpong'):
            # 不回站姿的片：主体正放后接倒放（坐下→起身），末帧回到起始站姿。
            # 2026-09-14 起默认不再自动启用（倒放观感抽象，用户否决），仅显式指定时用。
            body = np.concatenate([body, body[-2:0:-1]], axis=0)
            n_body = body.shape[0]
        shift, iou = best_shift(np.asarray(body[0][..., 3]) >= 128,
                                np.asarray(idle[0][..., 3]) >= 128)
        frames = bake(idle, body, head, tail, CHAIN['dissolve_frames'], with_tail=with_tail)
        md_k = args.micro_dissolve if CHAIN['dissolve_frames'] <= 0 else 0
        if md_k > 0:
            frames = apply_micro_dissolve(frames, head, n_body, md_k, args.md_thr, with_tail=with_tail)
        out = out_dir / (name + '.webm')
        encode(frames, out, args.crf, fps=fps)
        del frames
        res = verify(out, idle, head, tail, body, CHAIN['dissolve_frames'], micro_k=md_k,
                     with_tail=with_tail)
        drop(body, body_raw)
        res.update(name=name, start=clip['start'], end=clip['end'],
                   body_frames=n_body, shift=list(shift), shift_iou=iou,
                   bytes=out.stat().st_size)
        results.append(res)
        if not res['ok']:
            failed += 1
        print('%-14s f%03d-f%03d   %.2fs      %-8d %-9s %s%s'
              % (name, clip['start'], clip['end'], n_body / fps, res['frames'],
                 '%.2fs' % (res['frames'] / fps), '✓' if res['ok'] else '✗',
                 '' if with_tail else '  [无尾：末帧留在主体收尾姿势，出口交引擎淡化]'))
        if with_tail:
            print('               首帧vs待机f0 %.2f  末帧vs待机f61 %.2f（待机帧间噪声 %.2f）'
                  % (res['first_vs_idle0'], res['last_vs_idle_last'], res['idle_step_median']))
        else:
            print('               首帧vs待机f0 %.2f  末帧=主体末帧（vs待机f61 %.2f，交引擎 240ms 淡化）'
                  % (res['first_vs_idle0'], res['last_vs_idle_last']))
        if CHAIN['dissolve_frames'] <= 0:
            if with_tail:
                print('               硬切 进%.1f（邻近最小 %.1f @主体f%03d）/ 出%.1f'
                      '（邻近最小 %.1f @主体f%03d）'
                      % (res['cut_in'], res['cut_in_best'], res['cut_in_best_at'],
                         res['cut_out'], res['cut_out_best'], res['cut_out_best_at']))
            else:
                print('               硬切 进%.1f（邻近最小 %.1f @主体f%03d）/ 出口不烘（无尾）'
                      % (res['cut_in'], res['cut_in_best'], res['cut_in_best_at']))
        else:
            print('               溶解步进 进%.1f/出%.1f  局部基底 进%.1f/出%.1f'
                  % (res['dissolve_in_max'], res.get('dissolve_out_max', float('nan')),
                     res['base_in'], res.get('base_out', float('nan'))))
        print('               主体自身步进 中位%.1f p95%.1f  主体对齐 %+d,%+d IoU %.3f'
              % (res['body_step_median'], res['body_step_p95'], shift[0], shift[1], iou))

    if args.dry:
        return 0
    report = ROOT / 'assets-custom' / 'raw-local' / 'chain-report.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(report.read_text(encoding='utf-8')) if report.exists() else []
    old = [r for r in old if r.get('name') not in {r2['name'] for r2 in results}] + results
    report.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding='utf-8')
    print('\n报告：%s' % report)
    print('不达标 %d 条' % failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
