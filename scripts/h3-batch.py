#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 批量出片：把 prompts-h3.json 的 13 条动作逐个提交给云端 ComfyUI，自动收片。

它解决什么：
  《06-批量生产》里写着"在界面里改提示词、改时长、Queue"——13 条 × 多抽几个种子 = 手工点上百次，
  还容易点错种子/贴错提示词。这个脚本读机读版提示词表，自动换提示词、首末帧、帧数、种子，
  提交 → 轮询 → 把成片按「动作名-种子.mp4」落盘（《06》定的命名规范）。

只用 Python 标准库（urllib），云端/本地都不需要额外装包。

【用法】
  1) 在 ComfyUI 里把工作流导出成 **API 格式**：设置 → 开启 Dev mode → 「Save (API Format)」
     存成 api-workflow.json 拿回本地。
  2) 先看它认不认这个工作流（不改任何东西，只打印节点与连线）：
       python scripts/h3-batch.py --workflow api-workflow.json --inspect
  3) 干跑一遍，确认每条会被填成什么：
       python scripts/h3-batch.py --workflow api-workflow.json --dry-run
  4) 真跑（先只跑一条试水）：
       python scripts/h3-batch.py --workflow api-workflow.json --only 待机呼吸休闲 --seeds 1
  5) 全量（13 条 × 2 种子）：
       python scripts/h3-batch.py --workflow api-workflow.json --seeds 2

【锚点图片】必须先在云端 ComfyUI 的 input 目录里（把《上传素材》整个复制进 /root/ComfyUI/input/ 即可）。
脚本会自动找到接在 first_frame / last_frame 上的 LoadImage 节点并改文件名，不用手点。
"""
import argparse
import json
import mimetypes
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JOBS = ROOT.parent / 'Minmax H3' / 'prompts-h3.json'

sys.stdout.reconfigure(encoding='utf-8')

COND_NODES = ('MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo')
IMAGE_NODES = ('LoadImage', 'LoadImageOutput', 'ETN_LoadImageBase64', 'ImageLoad')


# ---------------------------------------------------------------- HTTP
def http_json(server, path, payload=None, timeout=30):
    url = server.rstrip('/') + path
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={'Content-Type': 'application/json'} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return json.loads(body) if body else {}


def http_get_bytes(server, path, timeout=120):
    with urllib.request.urlopen(server.rstrip('/') + path, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- 工作流改写
def find_nodes(wf, classes):
    return {nid: n for nid, n in wf.items()
            if isinstance(n, dict) and n.get('class_type') in classes}


def resolve_image_node(wf, value):
    """把 inputs.first_frame 这类 ["12", 0] 解析成它的 LoadImage 节点 id。"""
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
        node = wf.get(value[0])
        if node and node.get('class_type') in IMAGE_NODES:
            return value[0]
    return None


def seed_keys(wf):
    """所有带 seed / noise_seed 的输入（跨 ComfyUI 版本都适用）。"""
    out = []
    for nid, n in wf.items():
        if not isinstance(n, dict):
            continue
        for k in ('seed', 'noise_seed'):
            if k in (n.get('inputs') or {}):
                out.append((nid, k))
    return out


def patch(wf, job, seed, size, length):
    """按一条 job 改写工作流副本；返回 (新工作流, 改写说明)。"""
    wf = json.loads(json.dumps(wf))          # 深拷贝，保留原始模板
    notes = []

    conds = find_nodes(wf, COND_NODES)
    if not conds:
        raise SystemExit(f'✗ 工作流里找不到条件节点 {COND_NODES}：确认导出的是 API 格式')
    if len(conds) > 1:
        notes.append(f'⚠ 有 {len(conds)} 个条件节点，只改第一个：{list(conds)[0]}')
    cid, cnode = next(iter(conds.items()))
    ins = cnode.setdefault('inputs', {})
    ins['prompt'] = job['prompt']
    ins['width'], ins['height'] = size
    ins['length'] = length
    notes.append(f'条件节点 {cid}（{cnode["class_type"]}）：prompt {len(job["prompt"])} 字 / {size[0]}x{size[1]} / {length} 帧')

    # 首末帧有两条路线，都要覆盖：
    #   · fl2va：条件节点自带 first_frame / last_frame
    #   · ref2va：首末帧挂在 MiniMaxH3AddGuide 上，用 frame_idx 区分（0=首帧；负数=从末尾数，-1 即末帧）
    # 注意：工作流里常常让首末帧共用一个 LoadImage（同一张图）。遇到需要两张不同图的动作
    # （本库只有「转身」），共用节点会被后写的覆盖 → 这里自动克隆一个新节点，互不干扰。
    used = {}

    def put_image(host_id, key, want, label):
        host = wf[host_id]['inputs']
        nid = resolve_image_node(wf, host.get(key))
        if nid and used.get(nid, want) != want:
            new_id = str(max(int(k) for k in wf if str(k).isdigit()) + 1)
            wf[new_id] = json.loads(json.dumps(wf[nid]))
            wf[new_id].setdefault('inputs', {})['image'] = want
            host[key] = [new_id, 0]
            used[new_id] = want
            notes.append(f'{label} → 克隆 LoadImage {nid} 为 {new_id} ← {want}（原节点已被别的入口占用）')
            return
        if nid:
            wf[nid].setdefault('inputs', {})['image'] = want
            used[nid] = want
            notes.append(f'{label} → LoadImage {nid} ← {want}')
        else:
            host[key] = want
            notes.append(f'⚠ {label} 不是从 LoadImage 接来的，直接写死文件名 {want}')

    hit = 0
    for slot in ('first_frame', 'last_frame'):
        want = job.get(slot)
        if not want or slot not in ins:
            continue
        put_image(cid, slot, want, slot)
        hit += 1
    for gid, gnode in find_nodes(wf, ('MiniMaxH3AddGuide',)).items():
        gins = gnode.setdefault('inputs', {})
        idx = gins.get('frame_idx', 0)
        slot = 'first_frame' if idx == 0 else ('last_frame' if isinstance(idx, int) and idx < 0 else None)
        if not slot or not job.get(slot):
            continue
        put_image(gid, 'image', job[slot], f'AddGuide {gid}(frame_idx={idx})')
        hit += 1
    if hit == 0:
        notes.append('❌ 这个工作流里没有任何首末帧入口（既无 first_frame/last_frame，也无 AddGuide）')

    # ref2va 的参考图：只改文件名与我们的锚点对得上的那些
    known = {'正面锚点-1024x576.png', '1-3侧面锚点-1024x576.png', '3-4左锚点-1024x576.png',
             '3-4右锚点-1024x576.png', '背面锚点-1024x576.png'}
    for key, val in list(ins.items()):
        if not key.startswith('ref_image'):
            continue
        nid = resolve_image_node(wf, val)
        if nid and wf[nid]['inputs'].get('image') in known:
            notes.append(f'{key} → LoadImage {nid} ← {wf[nid]["inputs"]["image"]}（保持）')

    for nid, k in seed_keys(wf):
        wf[nid]['inputs'][k] = seed
    if seed_keys(wf):
        notes.append(f'种子 {seed}（{len(seed_keys(wf))} 处）')
    else:
        notes.append('⚠ 工作流里没有 seed 输入（采样是固定种子？）')
    return wf, notes


# ---------------------------------------------------------------- 提交与收片
def submit(server, wf, client_id):
    r = http_json(server, '/prompt', {'prompt': wf, 'client_id': client_id})
    if 'prompt_id' not in r:
        raise RuntimeError(f'提交被拒：{json.dumps(r, ensure_ascii=False)[:600]}')
    return r['prompt_id']


def wait(server, prompt_id, poll=5, timeout=7200):
    t0 = time.time()
    while True:
        hist = http_json(server, f'/history/{prompt_id}')
        if prompt_id in hist:
            return hist[prompt_id]
        if time.time() - t0 > timeout:
            raise TimeoutError(f'等 {timeout}s 仍未出片')
        time.sleep(poll)


def collect_outputs(entry):
    """从 history 条目里挖出所有产物文件（图片/视频/gif）。"""
    files = []
    for node_out in (entry.get('outputs') or {}).values():
        for key in ('images', 'videos', 'gifs', 'audio'):
            for f in (node_out.get(key) or []):
                if isinstance(f, dict) and f.get('filename'):
                    files.append(f)
    return files


def download(server, f, out_dir, stem):
    q = urllib.parse.urlencode({
        'filename': f['filename'], 'subfolder': f.get('subfolder', ''),
        'type': f.get('type', 'output'),
    })
    data = http_get_bytes(server, f'/view?{q}')
    ext = os.path.splitext(f['filename'])[1] or '.bin'
    dst = out_dir / f'{stem}{ext}'
    dst.write_bytes(data)
    return dst, len(data)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='http://127.0.0.1:6006', help='ComfyUI 地址（默认本机 6006）')
    ap.add_argument('--workflow', required=True, help='API 格式工作流 json（ComfyUI: Save (API Format)）')
    ap.add_argument('--jobs', default=str(DEFAULT_JOBS), help='提示词表（默认 prompts-h3.json）')
    ap.add_argument('--out', default=str(ROOT / 'h3-out'), help='成片落盘目录')
    ap.add_argument('--only', default='', help='只跑这些动作（逗号分隔，默认全部）')
    ap.add_argument('--seeds', type=int, default=1, help='每条动作抽几个种子（默认 1）')
    ap.add_argument('--size', default='', help='覆盖尺寸，如 1024x576 / 1344x768')
    ap.add_argument('--length', type=int, default=0, help='覆盖帧数（124≈5s，243≈10s）')
    ap.add_argument('--inspect', action='store_true', help='只打印工作流的节点与连线，不改不跑')
    ap.add_argument('--dry-run', action='store_true', help='只打印每条会填成什么，不提交')
    args = ap.parse_args()

    wf_path = Path(args.workflow)
    if not wf_path.exists():
        print(f'✗ 工作流不存在：{wf_path}')
        return 1
    wf = json.loads(wf_path.read_text(encoding='utf-8'))

    if args.inspect:
        print(f'工作流 {wf_path.name}：{len(wf)} 个节点\n')
        print('%-6s %-34s %s' % ('id', 'class_type', '关键输入'))
        for nid, n in sorted(wf.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
            if not isinstance(n, dict):
                continue
            ins = n.get('inputs') or {}
            keys = [k for k in ins if k in ('prompt', 'width', 'height', 'length', 'seed', 'noise_seed',
                                            'first_frame', 'last_frame', 'image', 'text', 'frame_idx') or k.startswith('ref_image')]
            vals = []
            for k in keys:
                v = ins[k]
                if k == 'prompt' or k == 'text':
                    v = f'<{len(str(v))} 字>'
                vals.append(f'{k}={v}')
            print('%-6s %-34s %s' % (nid, n.get('class_type'), ', '.join(vals) or '—'))
        print('\n【判断】')
        conds = find_nodes(wf, COND_NODES)
        print(f'  条件节点：{ {k: v["class_type"] for k, v in conds.items()} or "❌ 没找到（导出格式不对？）"}')
        for nid, n in conds.items():
            ins = n.get('inputs') or {}
            for slot in ('first_frame', 'last_frame'):
                if slot in ins:
                    rid = resolve_image_node(wf, ins[slot])
                    print(f'  {slot}: {ins[slot]} → LoadImage {rid}'
                          + (f'（当前 {wf[rid]["inputs"].get("image")}）' if rid else ' ⚠ 不是 LoadImage'))
        print(f'  种子输入：{seed_keys(wf) or "❌ 无"}')
        return 0

    jobs_doc = json.loads(Path(args.jobs).read_text(encoding='utf-8'))
    jobs = jobs_doc['jobs']
    if args.only:
        want = {s.strip() for s in args.only.split(',') if s.strip()}
        jobs = [j for j in jobs if j['name'] in want]
        if not jobs:
            print(f'✗ --only 没匹配到动作：{sorted(want)}')
            return 1

    size = tuple(int(x) for x in args.size.lower().split('x')) if args.size else tuple(jobs_doc['canvas_batch'])
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    client_id = str(uuid.uuid4())
    rng = random.Random()

    print(f'服务端 {args.server}　工作流 {wf_path.name}　动作 {len(jobs)} 条 × {args.seeds} 种子')
    print(f'尺寸 {size[0]}x{size[1]}　输出 {out_dir}\n')

    log, ok, fail = [], 0, 0
    for job in jobs:
        for i in range(args.seeds):
            seed = rng.randrange(10 ** 9)
            length = args.length or job.get('length') or 243
            try:
                wf2, notes = patch(wf, job, seed, size, length)
            except SystemExit as e:
                print(e)
                return 1
            stem = f'{job["name"]}-{seed}'
            if args.dry_run:
                print(f'▶ {stem}')
                for n in notes:
                    print(f'    {n}')
                continue

            print(f'▶ {stem}  …提交', flush=True)
            t0 = time.time()
            try:
                pid = submit(args.server, wf2, client_id)
                entry = wait(args.server, pid)
                files = collect_outputs(entry)
                if not files:
                    print(f'  ✗ 完成但没有产物（节点里没接保存节点？）')
                    fail += 1
                    continue
                for f in files:
                    dst, nbytes = download(args.server, f, out_dir, stem)
                    print(f'  ✅ {dst.name}  {nbytes/1048576:.1f} MB  用时 {time.time()-t0:.0f}s')
                    log.append({'action': job['name'], 'seed': seed, 'prompt_id': pid,
                                'file': dst.name, 'bytes': nbytes, 'seconds': round(time.time() - t0)})
                ok += 1
            except Exception as e:                                    # 单条失败不打断整批
                print(f'  ✗ {type(e).__name__}: {str(e)[:300]}')
                log.append({'action': job['name'], 'seed': seed, 'error': f'{type(e).__name__}: {e}'})
                fail += 1

    if not args.dry_run:
        (out_dir / 'batch-log.json').write_text(
            json.dumps({'server': args.server, 'size': list(size), 'jobs': log},
                       ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\n完成 {ok} 成功 / {fail} 失败　日志 {out_dir / "batch-log.json"}')
        print('下一步：把成片回传本地 → scripts/key-video.py 抠像 → scripts/check-anchor.py 验收')
    return 0 if fail == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
