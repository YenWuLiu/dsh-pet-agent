# assets/ 素材说明（DSH-PET-AGENT）

**本目录的动画素材为本项目自制；不附带上游素材包。**

| 内容 | 状态 | 授权 |
|---|---|---|
| `webm/` | 本项目自制的动画（**现有 24 条**；纯黑底 HEVC 母版经 `key-video.py` 抠像 + 锚定） | 本项目自制，按仓库根 LICENSE（MIT） |
| `fonts/上首软糖体.ttf` | 本项目自带界面字体 **站酷快乐体 2016（HappyZcool-2016）** | 版权方条款（内嵌 `(c) Copyright LuiBingKe 2016`） |
| `pic/` | 手套拖拽光标 ×2 + 通知表情图标 ×6，**目前仍沿用上游 dsh-pet 素材包** | 上游条款：允许开源使用，**禁止商用** |
| `config.jsonc` | 由上游动画池配置改写；**只引用已出片的 24 条**（上一版那 92 个"待出片槽位名"已整体放弃） | 配置本身随代码 MIT |

> 文件名 `上首软糖体.ttf` 是渲染端**硬编码的槽位名**（见 `scripts/swap-assets.ps1`），
> 不代表字体身份。换字库时必须保持这个文件名。

## 动画规格契约（渲染端硬要求）

| 项 | 值 |
|---|---|
| 画布 | 640×360 |
| 编码 | VP9-Alpha（`yuva420p` + `auto-alt-ref 0`），WebM |
| 帧率 / 时长 | 30fps / 10.07s（302 帧）；与 `moves` 的 `leadSec`/`tailSec` 假设一致 |
| 角色高 | 270px（0.75 × 360） |
| 脚底 | y = 330（引擎 `FEET_Y`，见 `runtime/electron-helper/shared-core.js`） |
| 水平中心 | x = 320（锚点按**首帧**角色高/脚底/中心算） |

> **量测必须只认最大连通块。** 按整帧 alpha 包围盒量会被「AI生成」水印等独立小块带偏：
> 实测出现过「表面 269px / 脚底 329 全达标，实际角色只有 232px、悬空 36px」的事故
> （2026-09）。`scripts/normalize-webm.py` 与 `scripts/key-video.py` 都只认最大连通块。

## 生产流程

1. **出片**：按 `docs/动画生成清单.md` 的提示词与参数生成（即梦 Seedance），存 mp4；
2. **抠像 + 锚定**：`python scripts/key-video.py <src> <dst.webm> --anchor frame0`
   —— 白底/绿底/**纯黑底**都吃，边界洪水填充 + 腐蚀去边 + 只保留最大连通域 + 首帧锚定；
   手工抠好的带 alpha 的 MOV 则跳过这一步，直接走第 3 步的 `normalize-webm.py`；
   > **纯黑底片（本批 24 条）必须显式给 `--thresh 10`**：脚本默认 36 会把角色的暗部
   > （深藏青裙/发）也当成背景吃掉。本批实测 6~10 是平台期（背景占比稳定 0.814、
   > 角色是单一连通块且零孔洞），10 再往上就开始咬断角色边缘。
3. **归一化**：`python scripts/normalize-webm.py <源目录> assets/webm --anchor 休闲待机`
   —— 统一到 640×360 并把首帧对齐锚点（锚点取 `animations.idle` 第一条）；
   第 2 步已经锚定过就不必再跑；
4. **接进配置**：把动画名写进 `assets/config.jsonc` 的对应槽位；
5. **验收**：`.\scripts\check-assets.ps1`（齐备 + 规格 + 锚点契约三项，缺一即失败）。

## 授权条款（仅适用于上面 `pic/` 等仍来自上游的部分）

> **允许开源使用，禁止商用。**

- ✅ 可以在开源项目中使用、修改、再分发这些素材（需保留本说明与署名）。
- ❌ **不可以**用于商业用途（商业产品、付费服务、广告素材）。
- 这些素材**不适用**本仓库根目录的 MIT License——MIT 只覆盖代码。

署名：素材作者 **PC2005-cloud**，<https://github.com/PC2005-cloud/dsh-pet>。

---

# Asset Notice (DSH-PET-AGENT)

**The animations in this directory are produced by this project; the upstream
asset pack is not shipped here.**

- `webm/` — own productions (MIT, same as the code), see the spec table above.
- `fonts/上首软糖体.ttf` — this project's UI font (HappyZcool-2016); the file name is a
  hard-coded slot name in the renderer and does not identify the typeface.
- `pic/` — **still from the upstream dsh-pet asset pack**: free for open-source use,
  **commercial use is NOT allowed** (not covered by this repository's MIT License).
- `config.jsonc` — rewritten from the upstream pool config; it references **only the 24
  animations that actually exist** in `webm/`.

Attribution for the upstream parts: **PC2005-cloud**,
<https://github.com/PC2005-cloud/dsh-pet>.
