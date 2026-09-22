# tools/ —— 素材管线工具箱（自检/编辑/验收）

> 主流程脚本在 `scripts/`（转码/验收/打包），本目录是自检与精修工具。
> 素材流水线总览（新片从即梦到上线）：
>
> ```
> ① 即梦出片 mp4 → 放入 assets-custom/raw-staging/
   纯绿/纯色背景批量直转：`scripts/convert-jimeng-batch.ps1 -Engine keyer`（色度键，无需剪映）；
   白底/复杂边缘：`-Engine flood`（洪水填充，默认）；剪映精修导出绿幕片同样走 keyer
> ② 抠图转码:   scripts/convert-jimeng-batch.ps1   （白底片专用，→ assets-custom/webm/ 暂存区；绿幕片用户自抠后直接放暂存区）
>    锚点契约:  key-video.py 默认 --anchor frame0（首帧角色高→270px、脚底→FEET_Y=330、中心→x=320）；
>               量角色只取**最大连通块**，否则即梦"AI生成"水印会把几何量成"头顶→水印底"
> ③ 几何对齐:   tools/adjust-webm.py --align-to    （角色高矮/站位对齐到锚点，可选）
> ④ 首尾焊接:   tools/weld-seams.py                （循环用 --ramp smooth，见下）
> ⑤ 验收:       tools/check-seams.py assets-custom\webm   （全部接缝 <3 即过线）
> ⑤b 锚点验收:  python scripts/check-anchor.py            （逐片首帧角色高/脚底线/中心 vs idle 锚点，
>               已并进 scripts/check-assets.ps1；水印小块只告警）
> ⑥ 上线:       暂存区成品复制进 assets/webm/（覆盖同名文件）
> ⑦ 规格校验:   scripts/check-assets.ps1           （上线后跑；查暂存区加 -WebmDir assets-custom\webm）
> ⑧ 重启桌宠生效
> ```

## webm 实验室（生产工具台）

`python tools/webm-lab/webm-lab.py` → http://127.0.0.1:8934，五个工具位（左侧图标栏）：

| 工具 | 用途 |
|---|---|
| 🎞 预览 | 素材库（接缝徽章）、图层叠放、循环实测、叠放对比 |
| ✂️ 抠图 | **一键 ffmpeg 转换**（抠图在剪映做）：选源视频 → chromakey+CRF20 → 透明 webm 落 assets-custom/webm；键色自动取样，预览实时 |
| 🧹 精修 | 已抠 webm 的边缘/alpha 后期（去边/收缩/扩张/羽化/清残留/降噪） |
| 🎬 K帧 | 全片帧胶片带浏览、A/B 标记、导出单帧 PNG、按标记裁剪、设对齐参照帧 |
| 📐 对齐 | 以基准素材首帧为锚点，全素材偏差体检 + 批量对齐（可联焊尾） |
| 🔧 编辑 | 单片的裁剪/几何变换/首尾焊接（精细操作） |

流水线：`raw-staging MP4 → 抠图 → (精修) → K帧检查 → 对齐 → 编辑焊接 → assets/webm 上线`。

**剪映联合工作流**（剪映抠图好但导不出透明通道时）：剪映抠图 → 导出【纯绿幕】高码率 MP4
（选绿不选黑/白：深藏青发色近黑、围裙白色，绿色与角色零冲突）→ 放 raw-staging →
实验室「抠图」背景=绿幕（强度40/阴影30/羽化2/去边60 起步）→ 透明 webm。

## 本目录

| 工具 | 用途 | 常用命令 |
|---|---|---|
| `ffmpeg.exe` | 解码/编码引擎（被各工具调用） | — |
| `weld-seams.py` | 首尾帧焊接到锚点 + 渐变带 | `python tools/weld-seams.py in.webm out.webm --anchor 锚点.png --bitrate 2M` |
| `adjust-webm.py` | 缩放/平移/自动对齐锚点 | `python tools/adjust-webm.py in.webm out.webm --align-to 锚点.png` |
| `check-seams.py` | 接缝质检（自循环/回 idle/镜像契约） | `python tools/check-seams.py assets\\webm` |
| `mp4-keyer.py` | 源 MP4/MOV → 透明 webm，三引擎：Python 色度键（精细）/ **ffmpeg 单遍**（chromakey+CRF20，剪映同款预设，快）/ 源带 alpha 自动**直通** | `python tools/mp4-keyer.py in.mp4 out.webm [--engine ffmpeg --crf 20]` |
| `webm-lab/` | 可视化实验室（循环实测/图层叠放/编辑） | `python tools/webm-lab/webm-lab.py` → http://127.0.0.1:8934；默认加载暂存区 `assets-custom/webm`，编辑结果默认输出到线上区 `assets/webm`（勾「覆盖原文件」才写回来源目录） |

## 焊接参数速查（按引擎槽位）

| 槽位 | 参数 |
|---|---|
| idle（循环） | `--head 8 --tail 8 --ramp smooth`（循环动画必须平滑权重，防速度急刹顿挫） |
| clicks / 小动作 | `--no-head`（首帧是动作姿势，只焊尾） |
| turn（东张西望） | `--mirror-tail`（末帧 = 首帧镜像） |
| styleTurn（转身） | `--tail-anchor 对面风格站姿.png --mirror-tail` |
| drag（拖拽悬空） | 不焊（末帧必须保持悬空） |
| move（散步） | 默认头+尾 |

- 锚点图 = 各风格组 idle 的第 0 帧导出图（640×360 整帧，1:1 贴入最真）；用实验室「定格首帧」或 ffmpeg 抽帧都行。
- 焊接片统一 `--bitrate 2M`（1M 的编码噪底≈3，贴着无感线）。
- 判定阈值（check-seams / 实验室通用）：<3 无感 / 3~8 轻微 / >8 跳变。

## 相关文档

- 生成提示词与清单：`docs/动画生成清单.md`
- 衔接契约与状态机：`docs/动画设计与衔接规范.md`
- 角色设定唯一基准：`assets-custom/CHARACTER.md`
- 质检台账（历次实测数据）：`assets-custom/QA-NOTES.md`
