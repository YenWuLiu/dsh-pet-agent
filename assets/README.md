# assets/ 素材说明（DSH-PET-AGENT）

**本目录的动画素材为本项目自制；不附带上游素材包。**

| 内容 | 状态 | 授权 |
|---|---|---|
| `webm/` | 本项目自制的动画（**现有 38 条**；手扣带 alpha 的 MOV 母版经 `normalize-webm.py` 归一化） | 本项目自制，按仓库根 LICENSE（MIT） |
| `fonts/上首软糖体.ttf` | 本项目自带界面字体 **站酷快乐体 2016（HappyZcool-2016）** | 版权方条款（内嵌 `(c) Copyright LuiBingKe 2016`） |
| `pic/` | 手套拖拽光标 ×2 + 通知表情图标 ×6，**目前仍沿用上游 dsh-pet 素材包** | 上游条款：允许开源使用，**禁止商用** |
| `config.jsonc` | 由上游动画池配置改写；**只引用已出片的 38 条**（上一版那 92 个"待出片槽位名"已整体放弃） | 配置本身随代码 MIT |

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
>
> **但「裁剪窗」相反：要用全部内容。** 有些片故意带与角色**不连通**的气泡/道具/特效
> （对话气泡、三球抛接的三个球、吹笛子的笛子、蝴蝶蜜蜂、鲸鱼虚影）。只按角色 bbox 裁
> 会把它们切掉。所以 `normalize-webm.py` 里分成两套 bbox：
> **角色 bbox（最大连通块）→ 缩放与锚点**；**全部内容 bbox（所有 alpha>40 像素）→ 裁剪窗**。

## 生产流程

1. **出片**：按 `docs/动画生成清单.md` 的提示词与参数生成（即梦 Seedance）；
2. **手扣 / 抠像**：得到**带 alpha 通道**的 MOV 母版（本项目用剪映等手工抠，成品自带 alpha）；
3. **归一化（唯一必做的一步）**：
   ```sh
   python scripts/normalize-webm.py <MOV母版目录> assets/webm --anchor 休闲待机
   ```
   统一到 640×360、首帧角色高 270 / 脚底 y=330 / 中心 x=320。
   > **母版 MOV 是唯一正确来源**：它自带 alpha，且少一代有损编码。
   > ⚠ **绝不要拿 `mov\output\` 里那批 webm 当来源** —— 它们是
   > `mov\convert-mov-to-webm.bat` 转的，而那个 bat 原本带的
   > `colorkey=0x00FF00:0.1:0.1` 会**把 alpha 整个丢掉**（2026-09-23 实测事故）：
   > `colorkey` 只按 RGB 工作（ffmpeg 原文 *"Turns a certain color into transparency.
   > Operates on RGB colors."*），它会**丢弃输入 alpha、按 RGB 重新生成一张**；键色
   > `#00FF00` 是给绿幕片用的，而这些母版的背景是**透明黑**（RGB 0,0,0），匹配不到任何
   > 像素 → 新 alpha 全是 255 → 成片完全不透明（容器还照旧带 `alpha_mode:1`，很难发现）。
   > 实测同一份母版首帧透明占比：**加 colorkey 后 0.8196 → 0.0000**，不加则保持 0.8196。
   > 该 bat 已修（去掉 colorkey、补 `-an`），详见 bat 内注释。
4. **接进配置**：把动画名写进 `assets/config.jsonc` 的对应槽位；
5. **验收**：`.\scripts\check-assets.ps1`（齐备 + 规格 + 锚点契约三项，缺一即失败）。

> 只有**没有 alpha 母版**的片（例如只有即梦直出的白底/绿底/纯黑底 mp4）才需要
> `scripts/key-video.py` 抠像兜底：`python scripts/key-video.py <src> <dst.webm> --anchor frame0`。
> 纯黑底片要显式给 `--thresh 10`（默认 36 会把角色暗部当背景吃掉），片里有独立气泡/道具时
> 再加 `--keep-min-blob 80`（默认"只留最大连通块"会把它们整块抹掉）。
> 抠完仍要走第 3 步归一化（或用 `normalize-webm.py` 直接吃 `.webm`）。

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
