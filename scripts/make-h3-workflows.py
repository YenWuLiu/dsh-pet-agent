#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""make-h3-workflows.py —— 生成两条路线的 API 格式工作流（h3-batch.py 直接吃）。

【起点是"真家伙"，不是手搓】
  `h3-out/样片-00002.mp4` 里嵌着生成它的完整工作流（ComfyUI 默认把
  `workflow`（UI 版）+ `prompt`（API 版）写进 mp4 元数据）。本脚本把 **API 版**解出来当基线——
  那是**已经出过片、验证过的图**，比照文档手搓靠谱得多。

【基线长什么样（实测解出来的 26 个节点）】
  UNETLoader(fl2va) → ComfySwitchNode(turbo 开关, 出厂 False → 裸跑 20 步)
    → BasicScheduler(simple) / BasicGuider / KSamplerSelect(res_multistep)
    → SamplerCustomAdvanced ← RandomNoise
    → VAEDecode → CreateVideo(fps=24) → SaveVideo
  条件节点 MiniMaxH3ImageToVideo(first_frame=LoadImage)，没有 last_frame。
  全部 26 个节点都是**官方核心节点**（ComfyMathExpression 在 comfy_extras/nodes_math.py、
  ComfySwitchNode 在 nodes_logic.py、ResolutionSelector 也内置）——**零第三方插件**。

【基线有两个必须改的地方】
  1. **补 last_frame**。样片只接了首帧；而我们的提示词契约是"首帧=末帧=锚图"
     （《00-开始先读我》的核心方案：站姿→动作→站姿闭环）。
     h3-batch.py 改写时，`if slot not in ins: continue` —— **ins 里没有 last_frame 这个键，
     它就静默跳过**，末帧根本不会被锚定。所以必须把这个键补上。
  2. **不要 ResolutionSelector 的方形档**。样片用 `1:1 / 0.4MP` 出了 640×640（方形），
     我们的素材契约是 16:9 640×360。批量时 h3-batch.py 会用 `--size` 覆盖 width/height，
     这里把出厂值也改成 1024×576，免得手动跑时又出方图。

【两条路线】
  fl2va  ：MiniMaxH3ImageToVideo + 首末帧。**先跑这条**——样片验证过的就是它，
           不需要参考图 token，快且省。提示词用 prompts-h3-full-fl2va.json。
  ref2va ：MiniMaxH3ReferenceToVideo + 5 张转面参考图 + 两个 MiniMaxH3AddGuide 钉首末帧。
           身份一致性更好，但参考图 token 参与每一步采样，慢很多。
           提示词用 prompts-h3-full.json（前缀里本来就写着 <Picture i>）。

【ref2va 为什么要 AddGuide（源码事实）】
  `comfy_extras/nodes_minimax_h3.py` 里 MiniMaxH3ReferenceToVideo 的输入表**根本没有
  first_frame / last_frame**——它只有 ref_image_1..9 / ref_video_1..3 / ref_audio_1..3。
  想钉首末帧，只能用 MiniMaxH3AddGuide 挂在 conditioning 链上：
      frame_idx=0  → 首帧；frame_idx=-1 → 末帧（负数是"从末尾数"，源码里
      resolved = frame_idx if frame_idx>=0 else frame_count+frame_idx）。
  这也正是 h3-batch.py 认的写法（它按 frame_idx 判断该填 first_frame 还是 last_frame）。

用法：python scripts/make-h3-workflows.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = ROOT / 'tools' / 'ffmpeg.exe'
SAMPLE = ROOT / 'h3-out' / '样片-00002.mp4'
OUT = ROOT / 'assets-custom' / 'h3-full'
sys.stdout.reconfigure(encoding='utf-8')

FL2VA_MODEL = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'
REF2VA_MODEL = 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'
CLIP_MODEL = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors'
AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors'
LORA_FL2V = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'
LORA_REF2V = 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'

# 5 张转面参考图（顺序即 prompt 里的 <Picture 1>…<Picture 5>）
REF_VIEWS = ['正面锚点-1024x576.png', '1-3侧面锚点-1024x576.png', '3-4左锚点-1024x576.png',
             '3-4右锚点-1024x576.png', '背面锚点-1024x576.png']
ANCHOR_FIRST = '正面锚点-1024x576.png'
W, H, LEN = 1024, 576, 243


def extract_api_prompt():
    """从样片 mp4 的元数据里解出 API 格式工作流。"""
    if not SAMPLE.exists():
        raise SystemExit(f'✗ 找不到样片：{SAMPLE}（它是本脚本的基线来源）')
    r = subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error',
                        '-i', str(SAMPLE), '-f', 'ffmetadata', '-'], capture_output=True)
    raw = r.stdout.decode('utf-8', 'replace')
    for line in raw.splitlines():
        if line.startswith('prompt='):
            v = line[len('prompt='):]
            o, i = [], 0
            while i < len(v):                      # ffmetadata 转义还原
                if v[i] == '\\' and i + 1 < len(v):
                    o.append(v[i + 1]); i += 2; continue
                o.append(v[i]); i += 1
            return json.loads(''.join(o))
    raise SystemExit('✗ 样片里没有嵌入 prompt 元数据')


def cond_node(wf):
    for nid, n in wf.items():
        if isinstance(n, dict) and n.get('class_type') in (
                'MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo'):
            return nid, n
    raise SystemExit('✗ 基线里找不到条件节点')


def next_ids(wf, n):
    """给新节点分配 id：避开已占用的（含 105:6 这种子图作用域 id）。"""
    used = {str(k) for k in wf}
    base = max([int(k) for k in used if k.isdigit()] + [0]) + 1
    return [str(base + i) for i in range(n)]


def prune_unreachable(wf):
    """删掉从出片节点走不到的节点。

    为什么必须删：ComfyUI 提交时会**校验整张图里的所有节点**，哪怕是孤立节点。
    基线里 ResolutionSelector / ComfyMathExpression / ImageScaleToTotalPixels / GetImageSize
    这四个在批量时会被 h3-batch.py 用字面量覆盖掉（width/height/length），变成孤立节点——
    留着它们等于给"节点不存在"多留四个失败点。
    """
    # 出片口：SaveVideo（基线里是 92）；找不到就退回所有 Save* 节点
    sinks = [k for k, v in wf.items()
             if isinstance(v, dict) and str(v.get('class_type', '')).startswith('Save')]
    keep, stack = set(), list(sinks)
    while stack:
        k = stack.pop()
        if k in keep or k not in wf:
            continue
        keep.add(k)
        for v in wf[k].get('inputs', {}).values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                stack.append(v[0])
    dropped = [k for k in wf if k not in keep]
    for k in dropped:
        del wf[k]
    return dropped


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = extract_api_prompt()
    cid, cnode = cond_node(base)
    print(f'基线：{len(base)} 个节点，条件节点 {cid} = {cnode["class_type"]}')

    # ---------------- 路线 A：fl2va（首末帧） ----------------
    a = json.loads(json.dumps(base))
    ca = a[cid]['inputs']
    ca['width'], ca['height'], ca['length'] = W, H, LEN
    ca['first_frame'] = ca.get('first_frame') or ['114', 0]
    ca['last_frame'] = list(ca['first_frame'])      # ← 基线缺这个键，补上（关键）
    # 出厂开关是 False（裸跑 20 步）。保持 False 最稳；要用 turbo 就切 true 并把 LoRA 名换对。
    lora_ok = any(isinstance(n, dict) and n.get('class_type') == 'LoraLoaderModelOnly'
                  and n['inputs'].get('lora_name') == LORA_FL2V for n in a.values())
    # 锚图默认值改成 1024×576（和批量档一致；手动跑时不会又出 1344×768 的图）
    for n in a.values():
        if isinstance(n, dict) and n.get('class_type') == 'LoadImage':
            if n['inputs'].get('image', '').endswith('1344x768.png'):
                n['inputs']['image'] = ANCHOR_FIRST
    dropped_a = prune_unreachable(a)
    (OUT / 'api-workflow-fl2va.json').write_text(
        json.dumps(a, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✅ api-workflow-fl2va.json　{len(a)} 节点　'
          f'条件节点 {cid} 已补 last_frame（{ca["last_frame"]}）　'
          f'turbo LoRA 名匹配：{lora_ok}')
    print(f'   剪掉孤立节点 {len(dropped_a)} 个：{dropped_a}')

    # ---------------- 路线 B：ref2va（5 参考图 + 2 AddGuide） ----------------
    # 从**已剪枝的 A** 出发，这样锚图默认值、孤立节点清理都继承下来
    b = json.loads(json.dumps(a))
    cb = b[cid]['inputs']
    cb['width'], cb['height'], cb['length'] = W, H, LEN
    b[cid]['class_type'] = 'MiniMaxH3ReferenceToVideo'
    # ref2va 没有 first_frame/last_frame 输入 —— 必须删掉这两个键，
    # 否则 h3-batch.py 会照着写进一个节点根本不存在的输入，提交直接报错。
    first_ref = cb.pop('first_frame', ['114', 0])
    cb.pop('last_frame', None)
    cb['ref_image_size'] = 'match'
    # UNET / LoRA 换成 ref2va 那套
    for n in b.values():
        if not isinstance(n, dict):
            continue
        if n.get('class_type') == 'UNETLoader' and 'unet_name' in n.get('inputs', {}):
            n['inputs']['unet_name'] = REF2VA_MODEL
        if n.get('class_type') == 'LoraLoaderModelOnly' and 'lora_name' in n.get('inputs', {}):
            n['inputs']['lora_name'] = LORA_REF2V
        if n.get('class_type') == 'CLIPLoader':
            n['inputs']['type'] = 'minimax'          # 源码要求：不填 minimax 加载失败
    # 新节点：5 张参考图 + 1 张首末帧锚图 + 2 个 AddGuide
    ids = next_ids(b, 8)
    ref_ids, anchor_id, g1, g2 = ids[0:5], ids[5], ids[6], ids[7]
    for nid, fn in zip(ref_ids, REF_VIEWS):
        b[nid] = {'class_type': 'LoadImage', 'inputs': {'image': fn, 'upload': 'image'}}
    b[anchor_id] = {'class_type': 'LoadImage',
                    'inputs': {'image': ANCHOR_FIRST, 'upload': 'image'}}
    for i, nid in enumerate(ref_ids, 1):
        cb[f'ref_image_{i}'] = [nid, 0]
    # 采样链的上游：BasicGuider.conditioning 原本直接接条件节点，现在接到 AddGuide 链尾
    guider = next((n for n in b.values() if isinstance(n, dict)
                   and n.get('class_type') == 'BasicGuider'), None)
    if guider is not None:
        guider['inputs']['conditioning'] = [g2, 0]
    else:
        print('   ⚠ 基线里没有 BasicGuider，需要手工把 conditioning 接到 AddGuide 链尾')
    b[g1] = {'class_type': 'MiniMaxH3AddGuide',
             'inputs': {'positive': [cid, 0], 'vae': ['105:11', 0], 'latent': [cid, 1],
                        'image': [anchor_id, 0], 'frame_idx': 0}}
    b[g2] = {'class_type': 'MiniMaxH3AddGuide',
             'inputs': {'positive': [g1, 0], 'vae': ['105:11', 0], 'latent': [cid, 1],
                        'image': [anchor_id, 0], 'frame_idx': -1}}
    dropped_b = prune_unreachable(b)
    (OUT / 'api-workflow-ref2va.json').write_text(
        json.dumps(b, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✅ api-workflow-ref2va.json　{len(b)} 节点　'
          f'ref_image_1..5 ← {ref_ids}　AddGuide {g1}(frame_idx=0) → {g2}(frame_idx=-1) → BasicGuider')
    if dropped_b:
        print(f'   剪掉孤立节点 {len(dropped_b)} 个：{dropped_b}')

    print('\n两条路线的差别：')
    print(f'  fl2va  ：{FL2VA_MODEL}')
    print(f'           + {LORA_FL2V}（开关出厂 false = 裸跑 20 步）')
    print(f'  ref2va ：{REF2VA_MODEL}')
    print(f'           + {LORA_REF2V}　+ 5 张转面参考图（ref_image_size=match）')
    print('\n验证：python scripts/h3-batch.py --workflow <上面任一个> --inspect')
    return 0


if __name__ == '__main__':
    sys.exit(main())
