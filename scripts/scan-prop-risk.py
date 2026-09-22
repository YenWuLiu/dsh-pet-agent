# 粗筛《10 秒动作提示词》里「会产出独立连通块」的动作 —— 也就是会被
# key-video.py 的「只保留最大连通域」整段吃掉的道具/特效。
# 判据是关键词，不是语义理解，只用来给出量级与高危清单，不作为逐条结论。
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = Path(sys.argv[1])
text = SRC.read_text(encoding='utf-8')

sections = re.split(r'^## ', text, flags=re.M)[1:]
DETACHED = [
    '烟花', '孔明灯', '河灯', '泡泡', '气泡', '水泡', '光点', '蝴蝶', '蜜蜂',
    '环绕', '飘出画幅', '飞进', '飞出画幅', '雪花', '金币', '硬币', '幽灵',
    '雪人', '圣诞树', '落花', '花瓣', '星光', '灯', 'Zzz', '泡泡', '环绕头顶',
]
HELD = ['手持', '抱', '捧', '拿', '握', '牵', '戴', '穿', '骑', '顶在', '长在', '掌心', '捧进怀里', '放进嘴里', '咬']

hits = []
for sec in sections:
    name = sec.split('\n', 1)[0].strip()
    body = sec
    found = sorted({k for k in DETACHED if k in body})
    if not found:
        continue
    held = sorted({k for k in HELD if k in body})
    hits.append((name, found, held))

print(f'共 {len(sections)} 个动作；含"可能独立成块"关键词的有 {len(hits)} 个\n')
print('== 高危（有飘散/环绕类对象，且未见明显"持握"动作）==')
risky = [h for h in hits if not h[2]]
for name, found, _ in risky:
    print(f'  - {name}: {"/".join(found)}')
print(f'\n共 {len(risky)} 个')
print('\n== 次高危（虽有持握动作，但同帧还有飘散/环绕对象）==')
for name, found, held in hits:
    if held:
        print(f'  - {name}: 飘散={"/".join(found)}  持握={"/".join(held)}')
print(f'\n共 {len(hits) - len(risky)} 个')
