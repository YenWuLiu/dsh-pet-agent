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

## 画质：各环节实测（2026-09-23）

每一环都量过，避免"凭感觉调参"：

| 环节 | 实测 | 判断 |
|---|---|---|
| 抠像（绿幕 → alpha） | 边缘像素"绿占优"比例 **0.00%**，平均 `G − max(R,B)` = −5.6 ~ −7.5（偏蓝红） | 干净，无绿边残留 |
| 母版编码 | `hevc (Main)` / `yuv420p` = 8-bit + 4:2:0 | 有损，但**影响比预想小**（见下表） |
| 预乘 alpha | 母版是**直通道**（`CV(RGB)`=0.46 ≪ `CV(RGB/α)`=0.84）；两条缩放路径合成到浅背景后只差 **0.7/255** | 可忽略，**不必**加 premultiply |
| `-deadline best -cpu-used 0` | PSNR +0.1 dB，体积 −1.4% | 可忽略，不值得翻倍的编码时间 |
| `-auto-alt-ref` | 单遍 CRF 下 `6` 与 `0` 的产出**字节完全相同** | 该参数在本模式下不起作用，不是损失 |
| 分辨率 | 角色在成片里 270px，屏幕实际显示约 195px（**1.39× 超采样**）；母版里约 420px（2.15×） | 不是瓶颈 |

### 母版格式 × CRF：量化对比

以 `鲸鱼现世` 为例，基准 = **无损母版走同一条滤镜链**（即"编码器应该吃到的画面"）：

| 母版 | CRF | KB/条 | 素材尺寸 PSNR | **显示尺寸 PSNR** | 相对现用 |
|---|---|---|---|---|---|
| HEVC 4:2:0 8-bit | 20（旧默认） | 1436 | 39.34 | 41.09 | 基准 |
| HEVC 4:2:0 8-bit | **15（现默认）** | 1782 | 40.63 | **42.28** | 体积 +24%，**+1.19 dB** |
| 无损 qtrle（4:4:4） | 20 | 1467 | 39.94 | 41.77 | +2%，+0.68 dB |
| 无损 qtrle（4:4:4） | 15 | 1827 | 41.49 | 43.21 | +27%，+2.13 dB |
| 无损 qtrle（4:4:4） | 12 | 2125 | 42.59 | 44.21 | +48%，+3.13 dB |

> "显示尺寸"= 按宠物窗 462×260（角色约 195px 高）缩下去、合成到浅色壁纸后再比 —— 这才是眼睛看到的差异。

读出来的三件事：

1. **CRF 是大头。** 20 → 15 在显示尺寸上 **+1.19 dB**（体积 +24%），所以默认已改成 **15**。
   再往下的 CRF 12 只再 +1 dB 却再多 16% 体积，不划算；往上到 20 明显发软。
2. **无损母版只值 +0.68 dB**（同 CRF 下）。原先判断"4:2:0 / 8-bit 母版是主要瓶颈"**是错的**：
   实测发现 **0.53× 降采样把 HEVC 的压缩噪声滤掉了大半**（压缩噪声是高频的，缩放即低通），
   而 4:2:0 的色度分辨率（376×280）仍高于输出的实际需求（340×294）。
   → 为了 +0.68 dB 把 38 条母版全部重导成 **105 MB/条** 的无损 qtrle，性价比不高。
3. 两者叠加（无损 + CRF 15）才 +2.13 dB。要拿到它必须重导全部母版。

**结论：现有 HEVC 手扣母版 + CRF 15 是性价比最高的组合**（已采用，38 条合计 57.4 MB）。
除非愿意为最后约 1 dB 把母版全部重导成无损（qtrle / ProRes 4444）。

> 无损母版确实存在、也确实更好：`qtrle` + `argb` = 无损 RLE、4:4:4、8-bit、带 alpha
> （实测 88 Mbps ≈ 105 MB / 10s）。如果将来要出更大的画布、或做需要反复再编码的加工，
> 无损母版的优势才会体现出来；在"降采样到 640×360 只编一代"这条链上，它的收益有限。

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
