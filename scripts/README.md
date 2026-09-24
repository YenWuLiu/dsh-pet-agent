# scripts/ —— 素材管线、验收闸、打包

**16 个脚本，分三类，没有一个是一次性调试残留。** 判断标准很简单：要么在当前流程里，
要么在 `pnpm verify:shell` 的闸里。不满足这两条的会被删掉（本目录曾从 37 个精简到 15 个，
后来补回一个图形资源生成器）。

## 一、素材管线（6）

从「手扣好的 MOV」到「能播的 webm」，以及配套的验收与派生图形资源。

| 脚本 | 作用 | 何时跑 |
|---|---|---|
| `get-ffmpeg.ps1` | 下载 ffmpeg 到 `tools\ffmpeg.exe` 并体检能力 | **新克隆的仓库第一次**。这个二进制 100~212 MB，不进版本管理，不装它下面三个脚本全跑不了 |
| `normalize-webm.py` | MOV 母版 → 640×360 VP9-Alpha（量角色高 → 缩放 → 对齐首帧锚点 → 裁切含道具的窗） | 出片。平时不用手敲，走 `素材加工\出片.bat` |
| `check-assets.ps1` | 素材三项验收：配置引用的文件齐备 + 640×360/真 alpha + 锚点契约 | 出片后、打包前 |
| `check-anchor.py` | 锚点契约的实查部分（只认最大连通块，忽略水印），被 `check-assets.ps1` 调用 | 一般不单独跑 |
| `make-tray-icon.py` | 从 `assets/pic/` 的角色表情派生 `runtime/electron-helper/tray.png` + `packaging/app.ico` | **换角色形象后**。忘了就还是上一个角色的脸挂在托盘上 |
| `make-cursors.py` | 生成 `assets/pic/cursor-grab.png` / `cursor-grabbing.png`（32×32、热点 (16,16)，角色配色） | **换配色/换画布尺寸时**。文件名是渲染端槽位名，不要改 |

```sh
.\scripts\check-assets.ps1          # 日常验收
.\scripts\get-ffmpeg.ps1 -Check     # 只体检 ffmpeg，不下载
python scripts\normalize-webm.py <MOV目录> assets\webm --anchor 休闲待机
```

## 二、外壳验收闸（9）

全部由 `pnpm verify:shell` 串起来跑，**不要单独依赖某一个**。它们守的是外壳纯逻辑层
（`shell/` → `runtime/electron-helper/shared-core.js`）不被改坏。

| 脚本 | 守什么 | 断言数 |
|---|---|---|
| `check-think-strip.mjs` | 思考标记（`<thinking>` 等 5 种变体）必须被剥干净，不能漏进气泡 | 15 |
| `check-ps1-bom.mjs` | 被跟踪的 `.ps1` 含中文就必须带 UTF-8 BOM（PS 5.1 否则按 GBK 读 → 语法错误） | 4 |
| `build-desktop-core.mjs` | 从 `shell/` 重建 `shared-core.js`；`--check` 只自检不写盘 | — |
| `inspect-font.mjs` | 界面字体必须是站酷快乐体 2016（`HappyZcool-2016`），并报字形缺口 | — |
| `check-shared-parity.mjs` | 新旧产物逐符号差分（上游副本 vs 本项目覆盖），差异必须是有意的 | 65 项探测 |
| `check-menu-clamp.mjs` | 右键菜单夹取在可视矩形内 | 6 |
| `check-chat-placement.mjs` | 对话面板落位：贴边、翻转、夹取、不压瘪 | 17 |
| `check-bubble-schedule.mjs` | 气泡节奏：按字数的停留时长、分页、排队、被回复顶掉 | 32 |
| `check-pointer-target.mjs` | 鼠标穿透兜底：宠物身上不穿透，窗外恢复穿透，拖拽中永不翻回 | 14 |

```sh
pnpm verify:shell                   # 一次跑完，55/55 才算过（含 tools/chat-smoke 的 55 项面板断言）
```

> 改了 `shell/` 必须先 `pnpm build:desktop-core` 重建产物，否则闸会报产物过期 —— 这正是它存在的意义。

## 三、打包（1）

| 脚本 | 作用 |
|---|---|
| `pack-exe.ps1` | tsc 编译 → 组装 staging（launcher + lib + assets + runtime + 生产依赖 + node.exe）→ electron-builder 出 NSIS 安装版 |

```sh
.\scripts\pack-exe.ps1              # 或双击仓库根的 打包.bat（会先跑上面两组闸）
```

> ⚠️ 改 `pack-exe.ps1` 必须保住开头的 UTF-8 BOM —— 见上面 `check-ps1-bom.mjs` 那条。

## 约定

- **新增脚本前先问：它进 `verify:shell` 吗？** 不进闸又不进流程的脚本，过一阵就会变成
  "文档里描述的工具其实不存在" —— 本项目已经吃过这个亏。
- **`.ps1` 带中文就要 BOM**，写完跑一次 `node scripts/check-ps1-bom.mjs`。
- **不要在 `scripts/` 里放一次性调试脚本**（比如手动移动鼠标验证 Win32 结构体那种），
  验完即删，git 历史里留档就够。
