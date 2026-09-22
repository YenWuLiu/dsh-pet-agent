# -*- coding: utf-8 -*-
"""export-loopers.py — 把「可循环素材」导出成 webm / mov / mp4 三份存档，
并生成可复现清单（逐帧拼接表 + sha256 + 复现命令）。

为什么这三份
  · webm  VP9-Alpha  —— 线上引擎用的就是它，存档里放**逐字节副本**（不重编码）
  · mov   ProRes 4444 + alpha —— 带透明的剪辑/归档母版（剪映/PR/AE/FCP 都能吃）
  · mp4   H.264 + 底色 —— 通用可播版；MP4 容器里 H.264 不支持 alpha，所以合成底色

哪些素材"可以循环"
  5 条全部可以：
  · 待机呼吸  —— 本身就是无缝循环段（接缝 = 自身常规帧间差的 0.68×）
  · 4 条动作  —— 烘焙时首帧 = 待机循环点、末帧 = 循环点前一帧，
                 所以直接整片重复播放也是无缝的（循环点就是待机的循环点）

用法
  python scripts/export-loopers.py                    # 全量导出 + 校验
  python scripts/export-loopers.py --mp4-bg green     # mp4 换绿幕底（便于二次抠像）
  python scripts/export-loopers.py --out <目录>
退出码：0 全部校验通过；1 有校验不通过；2 环境缺依赖。
"""
import argparse
import gc
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')
LOCAL_FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
FFMPEG = str(LOCAL_FFMPEG) if LOCAL_FFMPEG.exists() else 'ffmpeg'
CW, CH, FPS = 640, 360, 30
WORK = ROOT / '.tmp-export'

CLIPS = ['待机呼吸', '点击回应开心', '点击回应生气', '吃干饭', '睡觉']

# 待机循环段的出处（见 assets-custom/QA-NOTES.md「idle 无缝循环段」）
IDLE_PROVENANCE = {
    'source': '原始素材/anim-01-idle.mp4（桌面 dsh-pet-agent 目录）',
    'source_frames': 'f61–f110（24fps，50 帧 = 2.083s）',
    'master': 'assets-custom/raw-local/manual-key-masters-20260914/待机呼吸.webm',
    'master_frames': 'f77–f138（30fps，62 帧 = 2.067s）',
    'how': 'python tools/find-loop.py <源片> --min-len 1.2 → 取 max(pose,vel) 最小的区段',
    'seam': '原整片硬接 41.17 RMS（常规帧间差 11.64 的 3.54×）→ 循环段 7.86（0.68×）',
}

BG = {'white': '0xFFFFFF', 'green': '0x00B140', 'gray': '0xE8E8E8', 'black': '0x000000'}


def load_chain():
    spec = importlib.util.spec_from_file_location(
        'build_chain', str(ROOT / 'scripts' / 'build-chain.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256(path, buf=1 << 20):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        while True:
            b = fh.read(buf)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def count_frames(path):
    """数真实帧数（-count_frames 逐帧解码，不信容器元数据）。"""
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
         '-show_entries', 'stream=nb_read_frames,width,height',
         '-of', 'csv=p=0', str(path)], capture_output=True, text=True)
    w, h, n = out.stdout.strip().split(',')
    return int(w), int(h), int(n)


def load_rgba(path, tag):
    """解码成 RGBA ndarray（读完即删中间文件；Windows 下 mmap 句柄要先放）。"""
    WORK.mkdir(exist_ok=True)
    raw = WORK / ('%s.raw' % tag)
    cmd = [FFMPEG, '-y', '-v', 'error']
    if str(path).lower().endswith('.webm'):
        cmd += ['-c:v', 'libvpx-vp9']       # 原生解码器不出 alpha
    cmd += ['-i', str(path), '-fps_mode', 'passthrough', '-pix_fmt', 'rgba',
            '-f', 'rawvideo', str(raw)]
    subprocess.run(cmd, check=True)
    n = raw.stat().st_size // (CW * CH * 4)
    mem = np.memmap(raw, dtype=np.uint8, mode='r').reshape(n, CH, CW, 4)
    arr = np.array(mem)
    del mem
    gc.collect()
    try:
        raw.unlink(missing_ok=True)
    except OSError:
        pass
    return arr


def premult(a):
    x = a.astype(np.float32)
    return np.concatenate([x[..., :3] * (x[..., 3:4] / 255.0), x[..., 3:4]], axis=-1)


def rms(p, q):
    d = p - q
    return float(np.sqrt((d * d).mean()))


def make_mov(src, dst):
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(src),
                    '-c:v', 'prores_ks', '-profile:v', '4444',
                    '-pix_fmt', 'yuva444p10le',
                    '-r', str(FPS), '-fps_mode', 'cfr', '-an', str(dst)], check=True)


def make_mp4(src, dst, bg, frames):
    """底色合成版。帧数用 `-frames:v n` 钉死：`overlay=shortest=1` 会少一帧
    （实测 62 → 61，色源是无限长输入时的端点判定差一帧）。"""
    fc = "[1:v]format=rgba[bg];[0:v]format=rgba[fg];[bg][fg]overlay=format=auto,format=yuv420p"
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(src),
                    '-f', 'lavfi', '-i', 'color=c=%s:s=%dx%d:r=%d' % (bg, CW, CH, FPS),
                    '-filter_complex', fc, '-frames:v', str(frames),
                    '-c:v', 'libx264', '-crf', '14',
                    '-preset', 'medium', '-pix_fmt', 'yuv420p',
                    '-r', str(FPS), '-fps_mode', 'cfr', '-movflags', '+faststart',
                    '-an', str(dst)], check=True)


def splice_table(chain, n_body):
    """这条片是哪些帧拼出来的：输出帧区间 → 各来源帧号区间。"""
    head = chain.CHAIN['head_frames']
    L = chain.CHAIN['tail_frames']
    n_idle = 62
    return [
        ('输出 f000–f%03d' % (head - 1),
         '待机 f000–f%03d' % (head - 1), '%d 帧' % head,
         '纯待机头，第 0 帧 = 循环点'),
        ('输出 f%03d–f%03d' % (head, head + L - 1),
         '待机 f%03d–f%03d × 主体 f000–f%03d' % (head, head + L - 1, L - 1),
         '%d 帧' % L,
         'premultiplied 线性溶解 t=0→1，首帧纯待机、末帧纯主体'),
        ('输出 f%03d–f%03d' % (head + L, head + n_body - L - 1),
         '主体 f%03d–f%03d' % (L, n_body - L - 1),
         '%d 帧' % (n_body - 2 * L), '动作本体'),
        ('输出 f%03d–f%03d' % (head + n_body - L, head + n_body - 1),
         '主体 f%03d–f%03d × 待机 f%03d–f061' % (n_body - L, n_body - 1, n_idle - L),
         '%d 帧' % L, '溶解回待机，末帧 = 待机 f061（循环点前一帧）'),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets-custom/raw-local/loop-archive-20260914')
    ap.add_argument('--mp4-bg', default='white', choices=sorted(BG))
    args = ap.parse_args()

    chain = load_chain()
    out = ROOT / args.out
    for sub in ('webm', 'mov', 'mp4'):
        (out / sub).mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=True)
    ver = subprocess.run([FFMPEG, '-version'], capture_output=True, text=True
                         ).stdout.splitlines()[0]
    webm_dir = ROOT / 'assets' / 'webm'

    records, failed = [], 0
    print('%-10s %5s %9s %9s %9s  %s'
          % ('素材', '帧数', 'webm', 'mov', 'mp4', '校验'))
    for name in CLIPS:
        src = webm_dir / (name + '.webm')
        if not src.exists():
            print('%-10s 缺少 %s' % (name, src))
            failed += 1
            continue
        w, h, n = count_frames(src)
        base = load_rgba(src, 'src_' + name)

        webm_out = out / 'webm' / (name + '.webm')
        mov_out = out / 'mov' / (name + '.mov')
        mp4_out = out / 'mp4' / (name + '.mp4')
        shutil.copy2(src, webm_out)
        make_mov(src, mov_out)
        make_mp4(src, mp4_out, BG[args.mp4_bg], n)

        checks = {'webm_copy_identical': sha256(src) == sha256(webm_out)}
        checks['mov_frames'] = count_frames(mov_out)
        checks['mp4_frames'] = count_frames(mp4_out)
        checks['mov_frames_ok'] = checks['mov_frames'] == (w, h, n)
        checks['mp4_frames_ok'] = checks['mp4_frames'] == (w, h, n)

        mv = load_rgba(mov_out, 'mov_' + name)
        checks['mov_alpha_max'] = int(mv[..., 3].max())
        checks['mov_alpha_px'] = int((mv[..., 3] >= 128).sum())
        checks['mov_vs_webm_rms'] = rms(premult(mv), premult(base))
        pv = load_rgba(mp4_out, 'mp4_' + name)
        # mp4 是不透明的：要跟"webm 合成到底色上"比，不能直接跟带 alpha 的源比
        hexbg = BG[args.mp4_bg][2:]
        bg_rgb = np.array([int(hexbg[0:2], 16), int(hexbg[2:4], 16), int(hexbg[4:6], 16)],
                          np.float32)
        over = premult(base)[..., :3] + bg_rgb * (1.0 - base[..., 3:4].astype(np.float32) / 255.0)
        checks['mp4_vs_webm_rms'] = rms(premult(pv)[..., :3], over)
        del mv, pv, base, over

        ok = (checks['webm_copy_identical'] and checks['mov_frames_ok']
              and checks['mp4_frames_ok'] and checks['mov_alpha_max'] == 255
              and checks['mov_vs_webm_rms'] < 2.0)
        failed += 0 if ok else 1
        print('%-10s %5d %9s %9s %9s  %s'
              % (name, n,
                 '%.0fKB' % (webm_out.stat().st_size / 1024),
                 '%.1fMB' % (mov_out.stat().st_size / 1048576),
                 '%.0fKB' % (mp4_out.stat().st_size / 1024),
                 '✓' if ok else '✗ movRMS=%.2f' % checks['mov_vs_webm_rms']))

        body = next((c for c in chain.CHAIN['clips'] if c['name'] == name), None)
        nb = None if body is None else body['end'] - body['start'] + 1
        records.append({
            'name': name, 'frames': n, 'size': [w, h], 'fps': FPS,
            'seconds': round(n / FPS, 3), 'loopable': True,
            'structure': ('无缝循环段' if body is None else
                          '待机头 %d + 溶解 %d + 主体 %d + 溶解 %d'
                          % (chain.CHAIN['head_frames'], chain.CHAIN['tail_frames'], nb,
                             chain.CHAIN['tail_frames'])),
            'body_frames_in_master': (None if body is None else
                                      'f%03d–f%03d' % (body['start'], body['end'])),
            'splice_table': [] if body is None else splice_table(chain, nb),
            'files': {fmt: {'path': str((out / fmt / (name + '.' + fmt))
                                        ).replace('\\', '/'),
                            'bytes': (out / fmt / (name + '.' + fmt)).stat().st_size,
                            'sha256': sha256(out / fmt / (name + '.' + fmt))}
                      for fmt in ('webm', 'mov', 'mp4')},
            'checks': checks,
        })

    manifest = {
        'generated_by': 'scripts/export-loopers.py',
        'ffmpeg': ver, 'canvas': [CW, CH], 'fps': FPS,
        'mp4_background': args.mp4_bg,
        'idle_provenance': IDLE_PROVENANCE,
        'chain_spec': {k: v for k, v in chain.CHAIN.items() if k != 'clips'},
        'chain_clips': chain.CHAIN['clips'],
        'reproduce': [
            'python tools/find-loop.py "<原始素材>/anim-01-idle.mp4" --min-len 1.2 '
            '--json loop-report.json      # 1) 找 idle 无缝循环段 → f61–f110 @24fps',
            'python scripts/build-chain.py --crf 20'
            '                        # 2) 烘 待机头+主体+待机尾（切点见 chain_clips）',
            'python scripts/export-loopers.py'
            '                            # 3) 导出 webm/mov/mp4 + 本清单',
        ],
        'clips': records,
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                       encoding='utf-8')

    md = ['# 可循环素材存档（%s）' % out.name, '',
          '5 条素材**全部无缝可循环**：待机本身就是循环段；4 条动作片烘焙时',
          '**首帧 = 待机循环点、末帧 = 循环点前一帧**，所以整片重复播放同样无缝。', '',
          '| 素材 | 帧数 | 时长 | 结构 |', '|---|---|---|---|']
    for r in records:
        md.append('| %s | %d | %.3fs | %s |' % (r['name'], r['frames'], r['seconds'],
                                                r['structure']))
    md += ['', '## 逐帧拼接表', '']
    for r in records:
        md += ['### %s' % r['name'], '']
        if not r['splice_table']:
            md += ['无缝循环段，不是拼出来的：', '',
                   '- 源片：%s' % IDLE_PROVENANCE['source'],
                   '- 源片帧：%s' % IDLE_PROVENANCE['source_frames'],
                   '- 30fps 母版：%s' % IDLE_PROVENANCE['master_frames'],
                   '- 循环点：末帧 f%03d 接回 f000 —— %s'
                   % (r['frames'] - 1, IDLE_PROVENANCE['seam']), '']
            continue
        md += ['- 母版里的主体帧：**%s**（母版 = %s）'
               % (r['body_frames_in_master'],
                  'assets-custom/raw-local/manual-key-masters-20260914/'),
               '', '| 输出帧 | 来源帧 | 帧数 | 说明 |', '|---|---|---|---|']
        for row in r['splice_table']:
            md.append('| %s | %s | %s | %s |' % row)
        md += ['', '- 循环点：末帧（待机 f061）接回 f000（待机 f000）', '']
    md += ['## 复现', '', '```'] + manifest['reproduce'] + ['```', '',
           'ffmpeg：`%s`' % ver, '',
           '溶解定义（`scripts/build-chain.py`）：premultiplied 线性插值'
           '`out = (1-t)·A + t·B`，RGB 与 alpha 一起插值 —— 覆盖度恒等，',
           '不会出现两层各自降透明度叠加时的 `1-(1-t)(1-t)`（t=0.5 掉到 0.75）凹陷。', '',
           '## 文件与校验和', '',
           '| 素材 | 格式 | 文件 | 大小 | sha256 |', '|---|---|---|---|---|']
    for r in records:
        for fmt in ('webm', 'mov', 'mp4'):
            f = r['files'][fmt]
            size = ('%.1f MB' % (f['bytes'] / 1048576) if f['bytes'] > 1048576
                    else '%.0f KB' % (f['bytes'] / 1024))
            md.append('| %s | %s | `%s` | %s | `%s…` |'
                      % (r['name'], fmt, f['path'], size, f['sha256'][:16]))
    md += ['', '完整 sha256 见 `manifest.json`（复制走之后可用它校验完整性）。', '']
    (out / 'MANIFEST.md').write_text('\n'.join(md), encoding='utf-8')

    try:
        shutil.rmtree(WORK)
    except OSError:
        pass
    print('\n存档目录：%s' % out)
    print('清单：MANIFEST.md / manifest.json')
    print('校验不通过 %d 条' % failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
