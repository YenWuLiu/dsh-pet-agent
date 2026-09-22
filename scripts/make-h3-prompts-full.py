#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把《桌面宠物 10 秒动作提示词.md》的**全量 106 条**动作，生成 H3/ref2va 落地版。

与 `make-h3-prompts.py`（13 条试点版）的关系：
  · 复用同一个 PREFIX / SUBST / PATCHES / extract()（用 importlib 直接加载那个文件），
    保证前缀与试点样片**逐字一致** —— 试点跑通过的提示词，全量里不许漂移。
  · 槽位表不再手写 13 条，而是**从素材集的 config.jsonc 反推**：
    106 条动画就是 106 条动作，一一对应（idle/turn/drag/clicks/moves/categories/events）。

产出（都在 assets-custom/h3-full/）：
  08B-动作提示词库（H3全量106版）.md   人读：槽位表 + 全部正文
  prompts-h3-full.json                 机读：scripts/h3-batch.py --jobs 直接吃
  _report.json                         自检：残留风险措辞 / 覆盖缺口 / 锚点缺失

为什么需要"每条可覆盖前缀"：
  全库 PREFIX 的负面里有「文字，字幕，水印」和「永远只出现这一个角色」。
  但素材集里确有几条**天生要出文字**（是啊，吃什么 / 深度思考碎碎念 / 碎碎念×3 …）
  和**天生要出 Q 版小动物**（撸猫 / 变鸽子 / 动物环绕 / 蓝鲸现世 …）。
  不改这几条 = 模型被自己的负面提示词按住，出不来正确画面。

用法：python scripts/make-h3-prompts-full.py
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # 引擎工作区
MANUAL = ROOT.parent / 'Minmax H3'                     # H3 手册目录
LIB = MANUAL / '桌面宠物 10 秒动作提示词.md'
SRC_CONFIG = ROOT.parent / 'assets-backup-20260908-131017' / 'config.jsonc'   # 素材集的原配置
ANCHOR_DIR = ROOT / 'assets-custom' / 'anchors-h3'
OUT_DIR = ROOT / 'assets-custom' / 'h3-full'
OUT_MD = OUT_DIR / '08B-动作提示词库（H3全量106版）.md'
OUT_JSON = OUT_DIR / 'prompts-h3-full.json'
OUT_JSON_FL = OUT_DIR / 'prompts-h3-full-fl2va.json'
OUT_REPORT = OUT_DIR / '_report.json'

FRAMES_10S = 243          # 17*14+5 = 10.125 秒（H3 帧数网格 17k+5）
FPS = 24
ANCHOR_1024 = '正面锚点-1024x576.png'
ANCHOR_1024_MIRROR = '正面锚点-1024x576-镜像.png'

sys.stdout.reconfigure(encoding='utf-8')

# ---------------------------------------------------------------- 复用试点生成器
_spec = importlib.util.spec_from_file_location('mhp', ROOT / 'scripts' / 'make-h3-prompts.py')
mhp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mhp)

PREFIX = mhp.PREFIX
SUBST = mhp.SUBST
PATCHES = dict(mhp.PATCHES)
NEW_PROMPTS = mhp.NEW_PROMPTS

# 这两段必须原样存在，否则下面的"每条可覆盖前缀"会静默失效 —— 直接报错，别猜。
SENT_SOLO = ('画面中**永远只出现这一个角色**：不出现第二个角色、不出现其他人的手、'
             '不出现参考图里的多个视图或表情格子。')
SENT_SOLO_TEXT = ('画面中**永远只出现这一个人形角色**：不出现第二个人形角色、不出现其他人的手、'
                  '不出现参考图里的多个视图或表情格子。本条**允许**出现正文描述的 Q 版气泡文字'
                  '（仅限气泡里的那几句话，字迹清晰可读），除此之外画面内不得出现任何其它文字、'
                  '字幕、水印或界面元素。')
SENT_SOLO_ANIMAL = ('画面中**永远只出现这一个人形角色**：本条**允许**出现正文描述的那一只 Q 版小动物'
                    '（作为她互动的对象，体积小、不遮挡她的面部与躯干、同样走"无→有→无"闭环），'
                    '但绝不出现第二个人形角色、不出现其他人的手、不出现参考图里的多个视图或表情格子。')
NEG_TEXT_OLD = '文字，字幕，水印，'
NEG_TEXT_NEW = '水印，'
NEG_EARS_OLD = '猫耳，翅膀，'
NEG_EARS_NEW = '角色长出猫耳，角色长出翅膀，'

for _probe in (SENT_SOLO, NEG_TEXT_OLD, NEG_EARS_OLD):
    if _probe not in PREFIX:
        raise SystemExit(f'✗ PREFIX 里找不到预期片段，前缀改写会静默失效：{_probe[:30]}…')

# ============================================================
# 一、每条例外：需要出文字 / 需要出小动物的动作
# ============================================================
# 依据：素材集原片实测 + 库正文。逐条核对过（见 _inspect1.md / 抽帧）。
TEXT_ACTIONS = {
    '是啊，吃什么',            # 原片：头顶两个思考气泡写着「吃什么？」「是啊，吃什么？」
    '深度思考碎碎念',          # 原片：头顶依次冒出「中午吃啥…」「好困啊…」「不想动了…」
    '碎碎念-擦桌碎碎念',
    '碎碎念-发呆碎碎念',
    '碎碎念-对屏碎碎念',
    '写福字',                 # 写的是「福」字，属于画面内容不是字幕
    '工作状态-思考冒泡',        # 头顶浮一个半透明「?」符号
}

ANIMAL_ACTIONS = {
    '撸猫',                   # 原片：怀里一只橘白小奶猫
    '变鸽子',
    '动物环绕',
    '蝴蝶蜜蜂环绕头顶开花',
    '蓝鲸现世',
    '鲸鱼吐泡泡特效',
    '骑木马',                 # 木马是道具，但同理需要"非人形对象"豁免
    '三球抛接',               # 三个球同理
    '下五子棋',               # 棋盘棋子同理
    '抽陀螺',
    '踢毽子',
}

# 追加约束段（挂在正文之后；只给真正需要的条目加，避免全库漂移）
ADDENDA = {
    '撸猫': '【本条小动物】只出现一只 Q 版橘白小奶猫（约她一个手掌大），全程在她掌心/怀里的安全区内，'
            '不落地、不出画、不遮挡她的脸；结尾随光点一起消散，末帧无残留。',
    '变鸽子': '【本条小动物】只出现一只 Q 版小白鸽，体积不超过她的头部，全程在画幅安全区内起落，'
              '不遮挡她的脸；结尾化光点消散，末帧无残留。',
    '动物环绕': '【本条小动物】只出现 2~3 只 Q 版小动物（体积小），环绕她但始终留在安全区内，'
                '不遮挡她的脸与躯干；结尾依次消散，末帧无残留。',
    '蝴蝶蜜蜂环绕头顶开花': '【本条小动物】只出现 2~4 只 Q 版蝴蝶与蜜蜂（体积极小），'
                            '全部在头顶上方的安全区内飞舞，不遮挡面部；结尾依次消散，末帧无残留。',
    '蓝鲸现世': '【本条小动物】只出现一头 Q 版半透明小蓝鲸虚影（体积不超过画幅高度的三分之一，'
                '位于她身后/身侧的安全区内），不遮挡她的面部；结尾化光点消散，末帧无残留。',
    '鲸鱼吐泡泡特效': '【本条特效】泡泡为半透明 Q 版水泡，全部在安全区内，不遮挡面部；'
                      '结尾泡泡依次破掉，末帧无残留。',
}

# 移动类：引擎会平移窗口，素材本身必须原地 + 首尾有静止段
MOVE_ACTIONS = {'螃蟹走路', '原地漂浮踏步', '原地左转奔跑'}
MOVE_ADDENDUM = ('【本条为移动类（引擎负责平移）】角色自身**绝不位移**：双脚落点全程钉在画面水平正中同一点，'
                 '只做出行走/奔跑的姿态与动势；首 1 秒保持标准站姿静止（引擎起步窗口），'
                 '最后 1.5 秒回到标准站姿静止（引擎落地窗口）。')
for _m in MOVE_ACTIONS:
    ADDENDA.setdefault(_m, MOVE_ADDENDUM)

# ---------------------------------------------------------------- 绿幕避让
# 后期是拿 #00FF00 抠像（chromakey）。**凡画面里有绿色道具/植物的，那部分会被一起抠掉留个洞**。
# 所以这些动作必须让绿色物体改用深绿/灰绿。负向清单里的「绿色衣服/绿色头发」管不到道具。
# 名单来自对库全文扫「绿|西瓜|青团|粽|圣诞树|树|叶|花茎|莲」后**人工剔除误报**：
#   剔除「荷叶边」（是围裙荷叶边，不是荷叶）、「竹签/竹筷」（是竹，但偏黄褐，不是绿）。
GREEN_PROP_ACTIONS = {
    '吃西瓜', '吃青团', '吃粽子', '吃汤圆', '吃腊八粥', '吃重阳糕',
    '装点圣诞树', '插茱萸赏菊', '凭空生花', '变鸽子', '蝴蝶蜜蜂环绕头顶开花',
    '吹笛子', '放风筝', '悠闲哼歌', '中秋赏月吃月饼', '放河灯', '放孔明灯',
    '堆雪人', '被落叶淹没', '放烟花', '讨糖南瓜灯', '工作状态-忙碌点按',
}
GREEN_ADDENDUM = ('【配色避让绿幕（重要）】本条画面里的绿色物体（叶子 / 青团 / 西瓜皮 / 圣诞树 / 竹子等）'
                  '一律用**深绿、墨绿或灰绿**（如 #1E5B2E、#3F6B4A），'
                  '**绝对不要**用亮绿 #00FF00 或与之接近的高饱和亮绿 —— 那是绿幕色，'
                  '会被后期抠像一起抠掉，在道具上留一个透明洞。背景本身仍然是纯 #00FF00，不要改。')
for _g in GREEN_PROP_ACTIONS:
    ADDENDA.setdefault(_g, GREEN_ADDENDUM)

# ============================================================
# 二、槽位表：从素材集 config.jsonc 反推（106 条 = 106 个槽位）
# ============================================================
def strip_jsonc(text: str) -> str:
    """去掉 // 与 /* */ 注释（不碰字符串字面量里的内容）。"""
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == '\\':
                if i + 1 < n:
                    out.append(text[i + 1])
                    i += 2
                    continue
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            i += 2
            while i + 1 < n and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def load_slots():
    """返回 [(slot, [动作名…])…]，顺序即引擎配置里的顺序。"""
    if not SRC_CONFIG.exists():
        raise SystemExit(f'✗ 找不到素材集配置：{SRC_CONFIG}')
    cfg = json.loads(strip_jsonc(SRC_CONFIG.read_text(encoding='utf-8')))
    a = cfg['animations']
    slots = [
        ('idle', list(a['idle'])),
        ('turn', list(a['turn'])),
        ('drag', list(a['drag'])),
        ('clicks', list(a['clicks'])),
        ('move', [x['name'] for x in a['moves']['actions']]),
    ]
    for cat in a['categories']:
        slots.append((cat['id'], list(cat['actions'])))
    for ev in ('balance', 'whisper', 'workStatus'):
        slots.append((f'event.{ev}', list(a['events'][ev])))
    return slots, cfg


# ============================================================
# 三、生成
# ============================================================
def prefix_for(name: str) -> str:
    p = PREFIX
    if name in TEXT_ACTIONS:
        p = p.replace(SENT_SOLO, SENT_SOLO_TEXT).replace(NEG_TEXT_OLD, NEG_TEXT_NEW)
    if name in ANIMAL_ACTIONS:
        p = p.replace(SENT_SOLO, SENT_SOLO_ANIMAL).replace(NEG_EARS_OLD, NEG_EARS_NEW)
    return p


# ---------------------------------------------------------------- fl2va 变体
# 上面那套前缀是给 **ref2va**（5 张转面参考图）写的，正文里用 <Picture i> 指代。
# 但《00-开始先读我》的核心方案是 **fl2va：首帧=末帧=同一张锚图** —— 样片验证过的也是它。
# fl2va 没有参考图入口，<Picture i> 全是悬空指代，必须换掉，否则模型会去找不存在的图。
# 注意只换「参考图那 4 行」，**不换**紧跟其后的独占句（那句在同一个 block 里）。
REF_LINES_OLD = ('【参考图约定】\n'
                 '随任务提供 5 张同一角色的转面参考图，提示词中以编号指代，全部为同一套绘制：\n'
                 '<Picture 1> = 正面站立，<Picture 2> = 1/3 侧面，<Picture 3> = 3/4 左侧面，\n'
                 '<Picture 4> = 3/4 右侧面，<Picture 5> = 背面。\n')
REF_LINES_NEW = ('【参考图约定】\n'
                 '本任务**不提供任何参考图**：没有 <Picture> 编号可用，正文里若出现编号一律忽略；\n'
                 '角色的长相、比例、服装完全由首帧锚图决定，不要自行发挥。\n')
FL2VA_PIC_SUB = [
    ('由转面图 <Picture 2> 推断出的侧脸', '由首帧站姿自然转出的侧脸'),
]


def to_fl2va(prompt: str):
    """把 ref2va 版提示词转成 fl2va 版（只动参考图措辞，动作正文一字不改）。"""
    p = prompt.replace(REF_LINES_OLD, REF_LINES_NEW)
    for a, b in FL2VA_PIC_SUB:
        p = p.replace(a, b)
    left = re.findall(r'<Picture \d>', p)
    p = re.sub(r'<Picture \d>', '首帧锚图', p)
    return p, left


def main():
    if not LIB.exists():
        raise SystemExit(f'✗ 找不到源库：{LIB}')
    lib_text = LIB.read_text(encoding='utf-8')
    slots, cfg = load_slots()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    jobs, rows, report = [], [], {'warnings': [], 'residual': {}, 'coverage': {}}
    bodies = []          # 与 jobs/rows 同序：纯动作正文（前缀已剥掉）
    seen = set()

    # 引擎补充三条（库中没有、config-h3 需要；正文复用 13 条试点版的 NEW_PROMPTS）
    extra = [('小动作·扩展', ['坐姿抱膝', '趴地熟睡', '跪坐干饭'])]

    all_slots = slots + extra
    for slot, names in all_slots:
        for name in names:
            if name in seen:
                report['warnings'].append(f'{name}：在多个槽位重复出现（{slot}），只取第一次')
                continue
            seen.add(name)

            if name in NEW_PROMPTS:
                body, src, line_no = NEW_PROMPTS[name], '新写（引擎补充）', None
            else:
                n = name
                patches = PATCHES.get(n)
                if slot == 'turn' and not patches:
                    patches = [('结尾不回正', '结尾保持在镜像站姿不回正（末帧锚图即首帧锚图水平翻转版，'
                                              '引擎播完翻转朝向接回待机）')]
                body, line_no = mhp.extract(lib_text, n)
                if body is None:
                    report['warnings'].append(f'{name}：库里找不到该条目')
                    continue
                body = mhp.rewrite(body, patches)
                src = f'库 L{line_no}'

            if '参考图' in body:
                report['warnings'].append(f'{name}：正文仍残留「参考图」')

            if name in ADDENDA:
                body = body.rstrip() + '\n\n' + ADDENDA[name]

            first = ANCHOR_1024
            last = ANCHOR_1024_MIRROR if slot == 'turn' else ANCHOR_1024
            length = FRAMES_10S

            jobs.append({
                'name': name, 'slot': slot, 'view': '正面',
                'first_frame': first, 'last_frame': last,
                'length': length, 'seconds': round(length / FPS, 2),
                'prompt': prefix_for(name) + '\n\n' + body,
            })
            bodies.append(body)
            rows.append((slot, name, src, first, last, length,
                         '文字豁免' if name in TEXT_ACTIONS else
                         ('小动物豁免' if name in ANIMAL_ACTIONS else ''),
                         '＋'.join([x for x in (
                             '移动类' if name in MOVE_ACTIONS else '',
                             '绿幕避让' if name in GREEN_PROP_ACTIONS else '') if x])))

    # ---- 覆盖自检：素材集 106 条是不是都进来了 ----
    src_names = {n for _, names in slots for n in names}
    got = {j['name'] for j in jobs}
    report['coverage'] = {
        'source_actions': len(src_names),
        'generated': len(jobs),
        'missing': sorted(src_names - got),
        'extra': sorted(got - src_names),
    }

    # ---- 残留风险措辞扫描（正文 + 前缀都扫） ----
    # 只扫**动作正文**：前缀是固定且已知good的（负面里本来就有「变焦/镜头移动」这些词），
    # 扫全文会被负面清单本身误报，等于没扫。
    # 注意「朝镜头/看向镜头/冲镜头眨眼」= 面向观众，是正面基准动画**要**的，不是镜头运动 —— 别误报。
    # 「绝不左右横移」这类**禁止句**也不是风险 —— 用 neg 前视窗排除。
    RISK = {
        '参考图': (r'参考图', None),
        '三视图类': (r'三视图|表情格|设定图', None),
        '白色残留': (r'白色间距|白色背景|白底背景', None),
        '镜头运动': (r'镜头(推|拉|摇|移|升|降|跟|切|特写|变焦|旋转|俯|仰)', None),
        '多视图指代': (r'最左侧|最右侧|中间的|左起第', None),
        '其它角色': (r'第二个人|另一个角色|旁边的人', None),
        '画幅内位移': (r'横移|走向画面|移动到画面|位移到', 8),
    }
    NEG_WORDS = ('不', '绝', '勿', '非', '无', '莫', '禁止')

    def risky(body: str, pat: str, guard):
        for m in re.finditer(pat, body):
            if guard:
                ctx = body[max(0, m.start() - guard):m.start()]
                if any(w in ctx for w in NEG_WORDS):
                    continue          # 是「不横移」这类禁止句，不是风险
            return True
        return False

    for j, body in zip(jobs, bodies):
        hits = [k for k, (pat, guard) in RISK.items() if risky(body, pat, guard)]
        if hits:
            report['residual'][j['name']] = hits

    # ---- 锚点文件自检 ----
    needed = sorted({j['first_frame'] for j in jobs} | {j['last_frame'] for j in jobs})
    report['anchors'] = {a: (ANCHOR_DIR / a).exists() for a in needed}

    payload = {
        'version': 2,
        'source': '素材集 assets-backup-20260908-131017（106 条）+ 引擎补充 3 条',
        'fps': FPS,
        'canvas_batch': list(mhp.CANVAS_BATCH),
        'canvas_final': list(mhp.CANVAS_FINAL),
        'guidance': {'video_shift': 12.0, 'audio_shift': 3.0, 'ref_image_size': 'match'},
        'jobs': jobs,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    # ---- fl2va 变体（同 109 条，只换参考图措辞）----
    jobs_fl, pic_left = [], []
    for j in jobs:
        p, left = to_fl2va(j['prompt'])
        if left:
            pic_left.append(f'{j["name"]}({",".join(left)})')
        jobs_fl.append({**j, 'prompt': p})
    payload_fl = {**payload, 'version': 3,
                  'route': 'fl2va（首帧+末帧，无参考图）',
                  'jobs': jobs_fl}
    OUT_JSON_FL.write_text(json.dumps(payload_fl, ensure_ascii=False, indent=2), encoding='utf-8')
    report['fl2va'] = {'picture_tags_replaced': pic_left,
                       'ref_block_replaced': REF_LINES_OLD not in jobs_fl[0]['prompt']}

    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    # ---- 人读文档 ----
    md = []
    md.append('# 08B · 动作提示词库（H3 / ref2va 全量版）\n')
    md.append('> 由 `scripts/make-h3-prompts-full.py` **自动生成**，勿手改。')
    md.append('> 前缀逐字复用 13 条试点版（`make-h3-prompts.py`），只对「要出文字」「要出小动物」'
              '两类动作做了**前缀级豁免**。')
    md.append(f'> 机读版：`prompts-h3-full.json`（{len(jobs)} 条，`h3-batch.py --jobs` 直接吃）\n')

    md.append('## 一、这套东西是什么\n')
    md.append(f'素材集 `webm/` 里 {report["coverage"]["source_actions"]} 条动画，'
              '和动作提示词库是 **1:1 完全对应**的（已逐条核对，无缺无多）。')
    md.append('本文件把这 106 条全部转成 H3/ref2va 可跑的提示词，角色换成 `assets-custom/anchors-h3/` 的**小蓝**。')
    md.append('另外补了引擎配置需要的 3 条（坐姿抱膝 / 趴地熟睡 / 跪坐干饭，库中没有、试点版新写）。\n')

    md.append('## 二、槽位表（' + str(len(jobs)) + ' 条）\n')
    md.append('| 槽位 | 动画名 | 来源 | 首帧 | 末帧 | 帧数 | 豁免 | 备注 |')
    md.append('|---|---|---|---|---|---|---|---|')
    for slot, name, src, first, last, length, exempt, note in rows:
        last_s = '**镜像**' if last == ANCHOR_1024_MIRROR else '同首帧'
        md.append(f'| {slot} | **{name}** | {src} | {first} | {last_s} | {length} | {exempt or "—"} | {note or "—"} |')
    md.append('')

    md.append('## 三、前缀的两类豁免（为什么必须有）\n')
    md.append('全库通用前缀的负面里写着「文字，字幕，水印」和「永远只出现这一个角色」。'
              '但素材集里确实有动作**天生要出文字**、**天生要出小动物**，照搬负面 = 模型被自己按住。\n')
    md.append(f'**出文字的 {len(TEXT_ACTIONS)} 条**（负面去掉「文字，字幕」，改为只禁"气泡之外的字"）：')
    md.append('　' + '、'.join(sorted(TEXT_ACTIONS)) + '\n')
    md.append(f'**出 Q 版小动物的 {len(ANIMAL_ACTIONS)} 条**（"只出现一个角色"改为"只出现一个人形角色"）：')
    md.append('　' + '、'.join(sorted(ANIMAL_ACTIONS)) + '\n')
    md.append('两类都**没有**放宽"不出现第二个人形角色 / 不出现其他人的手 / 不出现参考图多个视图"。\n')

    md.append('## 四、绿幕避让（后期抠像的坑）\n')
    md.append('后期是拿 `#00FF00` 做 chromakey 抠像。**画面里凡是亮绿的实物都会被一起抠掉，留一个透明洞。**')
    md.append('通用负面里的「绿色衣服 / 绿色头发」只约束角色，管不到道具 —— 所以这些动作单独加了避让约束：\n')
    md.append('　' + '、'.join(sorted(GREEN_PROP_ACTIONS)) + '\n')
    md.append('约束词：绿色物体一律用深绿/墨绿/灰绿（#1E5B2E、#3F6B4A），'
              '禁止亮绿 #00FF00 及其邻近色；背景仍是纯 #00FF00 不变。\n')
    md.append('> 名单是对库全文扫「绿 / 西瓜 / 青团 / 粽 / 圣诞树 / 树 / 叶 / 花茎 / 莲」后**人工剔除误报**得到的：')
    md.append('> 剔掉了「荷叶边」（是围裙的荷叶边，不是荷叶）和「竹签 / 竹筷」（偏黄褐，不是绿）。\n')

    md.append('## 五、移动类与 turn 的引擎契约\n')
    md.append('- **move（3 条）**：引擎播动画时自己平移窗口，所以素材必须**原地**。'
              '库正文本来就写了"X 轴坐标不偏移"，脚本再补一段强约束（首 1 秒 / 末 1.5 秒静止）。')
    md.append('- **turn（东张西望）**：末帧锚点 = 首帧锚点的**水平镜像**。'
              '引擎播完会翻 facing，镜像末帧翻回来才无缝。全库只有这一条首末帧不同。\n')

    md.append('## 六、动作正文\n')
    for j, (slot, name, src, first, last, length, exempt, note), body in zip(jobs, rows, bodies):
        md.append(f'### {slot} · {name}\n')
        md.append(f'- 来源：{src}　帧数：{length}（{j["seconds"]} 秒）'
                  f'　首帧：`{first}`　末帧：`{last}`')
        if exempt or note:
            md.append(f'- 标记：{exempt or ""}{"　" if exempt and note else ""}{note or ""}')
        if name in TEXT_ACTIONS or name in ANIMAL_ACTIONS:
            md.append('- ⚠ 本条用了**前缀豁免**（见第三节），不能直接套通用前缀。')
        md.append('')
        md.append(body)
        md.append('')

    md.append('## 七、自检结果\n')
    md.append(f'- 素材集动作数：{report["coverage"]["source_actions"]}　生成：{report["coverage"]["generated"]}')
    md.append(f'- 缺失：{report["coverage"]["missing"] or "无"}　多余：{report["coverage"]["extra"] or "无"}')
    md.append(f'- 锚点文件：{"全部就位" if all(report["anchors"].values()) else report["anchors"]}')
    md.append(f'- 残留风险措辞：{len(report["residual"])} 条'
              + ('（' + '、'.join(f'{k}→{v}' for k, v in list(report["residual"].items())[:8]) + '）'
                 if report['residual'] else '（无）'))
    md.append(f'- 警告：{report["warnings"] or "无"}\n')

    md.append('## 八、怎么跑（云端 → 本地）\n')
    md.append('**两条路线，一份提示词两套前缀**（详见《H3-云端部署手册（ComfyUI 图解版）》）：\n')
    md.append('| 路线 | 工作流 | 提示词 | 说明 |')
    md.append('|---|---|---|---|')
    md.append('| **A · fl2va**（先跑） | `api-workflow-fl2va.json` | **`prompts-h3-full-fl2va.json`** | '
              '首帧+末帧锚图，不用参考图，最快最省；**样片验证过的就是它** |')
    md.append('| B · ref2va | `api-workflow-ref2va.json` | `prompts-h3-full.json`（本文件这套） | '
              '5 张转面参考图 + 两个 AddGuide 钉首末帧，身份更稳但慢 |\n')
    md.append('两套提示词的**动作正文逐字相同**，只有「参考图约定」那几句不同：')
    md.append('fl2va 版把 `<Picture 1>`…`<Picture 5>` 全部去掉，改成"本任务不提供任何参考图"。\n')
    md.append('**云端（AutoDL 5090，ComfyUI 起着）**\n')
    md.append('```bash')
    md.append('# 0) 锚点先上传：assets-custom/anchors-h3/ 里 5 张 1024x576 + 镜像那张 → ComfyUI 的 input/')
    md.append('# 1) 体检：节点齐不齐、模型在下拉框里可见不可见')
    md.append('python scripts/h3-doctor.py --workflow assets-custom/h3-full/api-workflow-fl2va.json')
    md.append('# 2) 干跑，逐条看会被填成什么')
    md.append('python scripts/h3-batch.py --workflow assets-custom/h3-full/api-workflow-fl2va.json \\')
    md.append('  --jobs assets-custom/h3-full/prompts-h3-full-fl2va.json --dry-run')
    md.append('# 3) 先抽 3 条体验槽位，确认"是她本人"再批量（别跳过这步）')
    md.append('python scripts/h3-batch.py --workflow assets-custom/h3-full/api-workflow-fl2va.json \\')
    md.append('  --jobs assets-custom/h3-full/prompts-h3-full-fl2va.json \\')
    md.append('  --only 待机呼吸休闲,东张西望,点击回应-开心跃动 --seeds 1')
    md.append('# 4) 全量（109 条 × 2 种子）')
    md.append('python scripts/h3-batch.py --workflow assets-custom/h3-full/api-workflow-fl2va.json \\')
    md.append('  --jobs assets-custom/h3-full/prompts-h3-full-fl2va.json --seeds 2')
    md.append('```\n')
    md.append('**本地（成片回传后）**\n')
    md.append('```powershell')
    md.append('# 把云端 h3-out/*.mp4 拷回本地同目录，然后：')
    md.append('python scripts/h3-postprocess.py            # 抠绿 → 640x360 VP9-Alpha → assets-custom/webm/')
    md.append('python scripts/check-anchor.py --webm-dir assets-custom/webm \\')
    md.append('  --skip 被鼠标拖拽悬空反馈                  # 拖拽那条首帧是悬空姿势，按契约跳过')
    md.append('```\n')
    md.append('> 后期**不重新锚定**：H3 首帧就是锚图本身，1024x576 → 640x360 正好 ×0.625，'
              '角色高 432→270px、脚底 528→330、中心 512→320，与引擎常量逐项吻合（已实测：272/330/319）。')
    md.append('> 别用 `mp4-keyer.py`（不加 --keep-size）或 `normalize-webm.py` 转 H3 成片 —— ')
    md.append('> 它们按"整片 union bbox"重新锚定、脚底放 y=352，会把动作幅度大的片子压小、并让宠物浮空 22px。\n')

    OUT_MD.write_text('\n'.join(md) + '\n', encoding='utf-8')

    print(f'✅ {OUT_JSON.name}（{len(jobs)} 条）')
    print(f'✅ {OUT_MD.name}')
    print(f'✅ {OUT_REPORT.name}')
    print(f'   覆盖：素材集 {report["coverage"]["source_actions"]} 条 → 生成 {report["coverage"]["generated"]} 条'
          f'（缺 {len(report["coverage"]["missing"])} / 多 {len(report["coverage"]["extra"])}）')
    for w in report['warnings']:
        print(f'   ⚠ {w}')
    if report['residual']:
        print(f'   ⚠ 残留风险措辞 {len(report["residual"])} 条（见 _report.json）')
    bad = [a for a, ok in report['anchors'].items() if not ok]
    if bad:
        print(f'   ✗ 缺锚点：{bad}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
