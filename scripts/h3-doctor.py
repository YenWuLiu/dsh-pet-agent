#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""h3-doctor.py —— 云端 ComfyUI「能不能跑 H3」体检（只读，不改任何东西）。

【它解决什么】
  《02-云端环境准备》和《10-最小可用节点清单》都是"人眼看下拉框"的流程：
  模型下完了没？软链生效了没？ComfyUI 认不认这些节点？——全靠点界面猜。
  这个脚本直接问 ComfyUI 自己的 HTTP API，把三件事一次性查清楚：
    1. 服务活着吗、版本多少、认不认 H3 节点
    2. 工作流里用到的**每一个节点类型**在不在（缺一个就红）
    3. **模型文件在不在下拉框里** —— 这是最关键的：文件放在数据盘但软链没建好、
       或放在 models/ 子目录但文件名不匹配，界面上都是"看不到"，这里是硬证据

【用法】（在云端实例上跑，ComfyUI 已启动）
  python scripts/h3-doctor.py
  python scripts/h3-doctor.py --server http://127.0.0.1:6006
  python scripts/h3-doctor.py --workflow api-workflow.json   # 顺带查工作流的节点
  python scripts/h3-doctor.py --server https://xxx.seetacloud.com:8443   # 从本地查云端也行

只用 Python 标准库，云端/本地都不需要装包。
退出码：0 全绿；1 有缺项；2 连不上服务。
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')

# H3 必需的核心节点（官方 comfy_extras/nodes_minimax_h3.py 里的 6 个）
H3_NODES = ['MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo', 'MiniMaxH3AddGuide',
            'MiniMaxH3SigmaShift', 'EmptyMiniMaxH3LatentAV', 'MiniMaxH3FunControlNetApply']

# 模型清单：节点类名 → (输入名, [期望文件名…])
MODEL_SLOTS = [
    ('UNETLoader', 'unet_name', [
        'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
        'minimax_h3_ref2va_pruned_int8_convrot.safetensors']),
    ('CLIPLoader', 'clip_name', ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']),
    ('VAELoader', 'vae_name', ['minimax_h3_video_vae_fp16.safetensors',
                               'minimax_h3_audio_vae_fp32.safetensors']),
    ('LoraLoaderModelOnly', 'lora_name', []),   # 名字不固定（turbo 4step/8step），只列出来看
]


def get(server, path, timeout=20):
    with urllib.request.urlopen(server.rstrip('/') + path, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='http://127.0.0.1:6006')
    ap.add_argument('--workflow', default='', help='API 格式工作流 json（可选）')
    args = ap.parse_args()

    print(f'ComfyUI: {args.server}')
    print('=' * 62)

    # ---------- 1. 服务与设备 ----------
    try:
        stats = get(args.server, '/system_stats')
    except Exception as e:
        print(f'✗ 连不上 ComfyUI：{type(e).__name__}: {e}')
        print('  · 确认服务起着：cd ~/ComfyUI && python main.py --listen 0.0.0.0 --port 6006')
        print('  · 端口不对就用 --server 指定')
        return 2

    si = (stats.get('system') or {})
    devs = stats.get('devices') or [{}]
    d0 = devs[0] if devs else {}
    print(f'✅ 服务在线')
    print(f'   ComfyUI 版本 : {si.get("comfyui_version", "?")}')
    print(f'   Python/torch : {si.get("python_version", "?").split()[0]} / {si.get("pytorch_version", "?")}')
    print(f'   显卡         : {d0.get("name", "?")}')
    vram = d0.get('vram_total')
    if vram:
        print(f'   显存         : {vram / 1024**3:.1f} GB（可用 {d0.get("vram_free", 0) / 1024**3:.1f} GB）')

    # ---------- 2. 节点 ----------
    try:
        info = get(args.server, '/object_info', timeout=60)
    except Exception as e:
        print(f'✗ 取 /object_info 失败：{e}')
        return 1
    print(f'\n节点总数：{len(info)}')

    missing_h3 = [n for n in H3_NODES if n not in info]
    print(f'\n[H3 核心节点]')
    for n in H3_NODES:
        print(f'   {"✅" if n in info else "❌"} {n}')
    if missing_h3:
        print(f'   → 缺 {len(missing_h3)} 个：ComfyUI 版本太旧，不含 MiniMax H3 支持。')
        print('     升级：source /etc/network_turbo && cd ~/ComfyUI && git fetch --tags && '
              'git checkout master && git pull --ff-only && pip install -r requirements.txt')

    # ---------- 3. 模型是否真的可见 ----------
    print(f'\n[模型可见性]（"看不到"= 软链没建好或文件名不对）')
    bad_models = []
    for cls, slot, expect in MODEL_SLOTS:
        node = info.get(cls)
        if not node:
            print(f'   ❌ 节点 {cls} 不存在')
            bad_models.append(cls)
            continue
        opts = []
        inp = (node.get('input') or {}).get('required', {}).get(slot)
        if inp and isinstance(inp[0], list):
            opts = inp[0]
        h3 = [o for o in opts if 'minimax_h3' in o or 'qwen3vl' in o]
        print(f'   {cls}.{slot}：可见 {len(opts)} 个，其中 H3 相关 {len(h3)} 个')
        for o in h3:
            print(f'        · {o}')
        for e in expect:
            if e not in opts:
                print(f'        ❌ 期望有但看不到：{e}')
                bad_models.append(e)

    # ---------- 4. 工作流的节点是否齐 ----------
    wf_missing = []
    if args.workflow:
        p = Path(args.workflow)
        if not p.exists():
            print(f'\n⚠ 找不到工作流：{p}')
        else:
            wf = json.loads(p.read_text(encoding='utf-8'))
            classes = sorted({n.get('class_type') for n in wf.values() if isinstance(n, dict)})
            wf_missing = [c for c in classes if c not in info]
            print(f'\n[工作流节点] {p.name}：用了 {len(classes)} 种节点'
                  f'，{"全部存在 ✅" if not wf_missing else "缺 " + str(len(wf_missing)) + " 种 ❌"}')
            if wf_missing:
                for c in wf_missing:
                    print(f'   ❌ {c}')
                print('   → 这些多半来自插件（custom_nodes）。用 Manager 搜名字装，'
                      '或 git clone 对应仓库后重启 ComfyUI。')

    # ---------- 结论 ----------
    print('\n' + '=' * 62)
    ok = not missing_h3 and not bad_models and not wf_missing
    if ok:
        print('✅ 全绿：节点齐、模型可见、工作流可跑。')
        print('   下一步：python scripts/h3-batch.py --workflow <你的api工作流.json> --inspect')
    else:
        print('❌ 有缺项，先修完再跑批量：')
        if missing_h3:
            print(f'   · H3 节点缺 {len(missing_h3)} 个 → 升级 ComfyUI')
        if bad_models:
            print(f'   · 模型看不到 {len(bad_models)} 个 → 跑 bash 云端一键准备脚本-v3.sh --link，然后重启 ComfyUI')
        if wf_missing:
            print(f'   · 工作流节点缺 {len(wf_missing)} 种 → 装对应插件')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
