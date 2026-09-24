# DSH-PET-AGENT 🐾

一个**装在自己电脑上的独立 Agent**（基于 DeepSeek Harness 内核）：会聊天，也会真的
动手干活——pwsh 执行命令、读写文件、控鼠标键盘、管窗口、开程序、截图"看"屏幕。
**桌宠只是她的外壳**：一只角色站在桌面右上角，双击就说话。

**从素材到外壳都在这一个仓库里**：38 条动画逐条出片，表情图标与拖拽光标自己出图，
Electron 桌宠壳与外壳纯逻辑层可重建、可验收（`pnpm verify:shell`）。

> **独立运行**：不装 dsh CLI、不需要 monorepo，整个内核作为普通 npm 依赖跑在自己的
> 进程里。
> **自己的配置**：模型走她自己的一份——右键 → 设置里填协议 / 接口地址 / API Key /
> 模型 id，Key 进凭据库（`~/.dsh/.credentials.yaml`，0600），不进配置文件；会话记忆、
> 托盘、开机自启项也都是她自己的。
> **素材自己生产**：出片流程见 [`docs/动画生成清单.md`](docs/动画生成清单.md)，转码与验收见
> [`assets/README.md`](assets/README.md)。
> **外壳自己维护**：透明窗/物理/菜单/面板/气泡全在本仓库的 `shell/` 与
> `runtime/electron-helper/` 里，改了就跑 `pnpm verify:shell` 过闸，见
> [`shell/README.md`](shell/README.md)。

## 素材与授权

**`assets/` 里的素材全部由本项目自制**——动画、表情图标、拖拽光标、托盘与应用图标都是自己
出片或自己生成的，每个都能重建（生成脚本随仓库走）。代码按 [MIT](LICENSE)；第三方署名与
完整条款见 [`NOTICE.md`](NOTICE.md)。

| 内容 | 是什么 | 怎么来的 | 授权 |
|---|---|---|---|
| `assets/webm/` | **38 条动画**：待机 1 · 转向 1 · 点击回应 2 · 移动 1 · 小动作 9 · 玩耍 15 · 吃什么 2 · 文字 1 · 工作状态 6 | 手扣母版 → `python scripts/normalize-webm.py` 归一化出片 | 本项目自制，随代码 MIT |
| `assets/pic/notify-*.png` | 通知表情图标 ×6（完成 / 出错 / 提问 / 审批 / 截断 / 自检），256×256 | 本项目自己出图 | 本项目自制，随代码 MIT |
| `assets/pic/cursor-*.png` | 拖拽光标 ×2（张开 / 握起），32×32，热点 (16,16) | `python scripts/make-cursors.py` 生成 | 本项目自制，随代码 MIT |
| `runtime/electron-helper/tray.png`<br>`packaging/app.ico` | 托盘图标 32×32、应用图标（16~256 共 7 档） | `python scripts/make-tray-icon.py` 从 `notify-done.png` 派生 | 本项目自制，随代码 MIT |
| `assets/fonts/上首软糖体.ttf` | 界面字体 **站酷快乐体 2016**（HappyZcool-2016），**唯一非自制项** | 第三方字库 | 版权方条款（内嵌声明 © LuiBingKe 2016），**不适用** MIT |
| `assets/config.jsonc` | 动画池 / 物理 / 联动的**唯一事实来源** | 本项目自己维护，只引用已出片的 38 条 | 随代码 MIT |

> 文件名 `上首软糖体.ttf` 是渲染端**硬编码的槽位名**（不代表字体身份）：换字库时保持文件名
> 不变即可，字面身份由 `scripts/inspect-font.mjs` 那道闸盯着。
> 换角色形象后要重跑 `make-tray-icon.py` —— 忘了就还是上一个角色的脸挂在托盘上。

**当前进度（2026-09-24）**：`assets/webm/` **38 条**，合计 **57.4 MB**。母版是 `素材加工\` 下
那批**手扣、自带 alpha 通道**的 HEVC MOV（752×560 / 864×496 / 560×752，30fps，10.07~10.09s），
经 `scripts/normalize-webm.py` 归一化成 640×360 VP9-Alpha。`assets/config.jsonc` **只引用这
38 条**，`scripts/check-assets.ps1` **三项全绿**：配置共引用 38 个动画、0 个缺文件、全部
640×360 带 alpha，锚点契约 37 条全部达标（最大偏差 3px，容差 ±8px）。上一版那 92 个
"待出片槽位名"已按「以新素材为准」整体放弃。

> **要跑这条管线，先装 ffmpeg**：`.\scripts\get-ffmpeg.ps1`。它是管线硬依赖
> （`normalize-webm.py` / `check-assets.ps1` / `check-anchor.py` 都调它），但单个文件
> 100~212 MB，**不进版本管理** —— 新克隆的仓库没有它，不装就跑不了出片。详见
> [`tools/README.md`](tools/README.md)。

> ⚠ **一条踩过的坑（2026-09-23）**：早期出片脚本里带 `colorkey=0x00FF00:0.1:0.1`（绿幕键），
> 而母版是**手扣好、自带 alpha** 的 MOV。`colorkey` 只按 RGB 工作，会**丢弃输入 alpha、
> 按 RGB 重新生成一张**——键色 `#00FF00` 在这些母版的**透明黑底**上匹配不到任何像素，于是
> 新 alpha 全是 255，**成片完全不透明**（容器还照旧带 `alpha_mode:1`，实机才发现没有透明
> 通道）。实测同一份母版首帧透明占比 **0.8196 → 0.0000**。结论：**手扣好的 MOV 永远不要
> 再 key 一次**——只有绿幕片才需要先 chromakey 再编码。素材一律**直接从 MOV 母版归一化**，
> 既拿到真 alpha，又少一代有损编码。编码用 **CRF 15**（2026-09-23 从 20 下调，实测显示
> 尺寸 +1.19 dB），38 条合计 **57.4 MB**（上一版从被抠坏的 webm 转的是 70.6 MB —— 更小且
> 更清晰）。

> **本批相对上一版的变化**：素材从 14 条增加到 38 条。`turn` / `clicks` 两个池子**第一次
> 被填上**（`animationWeights.turn` 从 0 给回 5），宠物现在会真的转身（`facing` 会翻转）；
> `深度思考碎碎念` 带中文对话气泡，是唯一必须 `noMirror` 的动画，已单独归进「文字」类；
> **`events.workStatus` 六档也齐了**（冒泡思考/忙碌点按/清点归档/原地踱步张望/雀跃庆祝/
> 垂头叹气冒汗），所以 `workStatusEnabled` 已打开。上一版两条锚点超差（`整体换装试色`
> 脚底 −19px、`小提琴演奏` 脚底 −11px）随重出素材一并消失。

## 特性

- **对话即命令**：右键/双击宠物打开对话面板，自然语言下任务（「看看 C 盘剩余空间」「打开记事本写一句话」「列出内存占用前 5 的进程」）
- **气泡式聊天（默认）**：聊天只有**一条小输入条**（回车发送，跟早期那版一样），发完自动收起，她在**头顶气泡**里逐字把话说完——更像在跟人说话。气泡按字数给阅读时间（约 4.5 字/秒，最短 4 秒、最长 30 秒），**没读完不会被下一句顶掉**：后来的消息排队，碎碎念遇到真回复直接让路；一句话说完的长回复自动**分屏**，一屏一屏翻。想改成面板形式（能回看记录）在设置卡里切「对话形式」即可
- **常驻对话面板**（可选形式）：发完不消失——你的话和她的话都留在面板里，可以连续追问；关掉再打开会回放最近几轮（内核进程重启后面板从空开始，但**她自己的记忆**在会话日志里，跨重启仍在）。回复**逐字流式**出现，过程中显示「正在思考…／正在执行 pwsh…」，跑偏了可以按「停止」中断，失败了点「重试」原地重发。模型若把**思考过程混进正文**（部分推理模型/端点会把 `…思考…</think>正文` 整段当 content 流出来），宿主会自动剥掉，气泡里只留要说的话。面板**跟着她走**：拖她/甩她/回位都会重新贴到身边；贴到屏幕边缘会**翻边**（右侧放不下就贴左侧），两侧都窄就把面板压窄——绝不跑出屏幕
- **Computer Use**：`computer_screenshot` 截图进模型视觉、`computer_click/move/drag` 控鼠标、`computer_type/key` 输文字按键、`window_list/focus` 管窗口、`app_open` 开程序、`clipboard_read/write` 剪贴板、`notify` 系统通知
- **pwsh 全家桶**：内核 Agent 自带 pwsh / fs / jobs / todo 工具
- **系统托盘**：左键单击显示/隐藏桌宠，右键出**极简菜单——只有「隐藏/显示桌宠」与「退出桌宠」**（其余动作都在宠物右键菜单里：对话 / 设置 / 碎碎念 / 回到初始位置；开机自启在「设置」卡里）。桌宠窗口是无边框、无任务栏项的穿透小窗，托盘是它唯一的「找回」与「退出」入口
- **两种退出方式**：托盘菜单或宠物右键菜单的「退出桌宠」——都先请内核 dispose 整棵插件树，再结束 Electron 外壳，不留孤儿进程
- **审批气泡**（可选）：越权操作在宠物上弹「允许一次/拒绝」确认框
- **跨重启记忆**：重启后她还记得你叫什么
- **设置卡**：右键 → 设置——**分两级**：主页是常用开关（开机自启、对话形式，两者都是**改一下立刻单独保存**，不跟模型配置捆在一起），「模型配置…」进二级页填协议 / 接口地址 / API Key / 模型 id（桌宠独立配置，不跟随 dsh 部署默认）。字段区高度有上限、超出内部滚动，所以保存按钮永远留在屏幕内
- **内核即库**：不装 dsh CLI、不需要 monorepo——整个 [dsh-kernel](https://github.com/YenWuLiu/dsh-kernel-0.1.2-rc.1) 内核作为普通 npm 依赖运行（`@deepseek-ai/*@0.1.5-rc.2`）

### 三个联动开关：工作状态已开，碎碎念仍关着

`assets/config.jsonc` 里 `pets[0]` 的三个开关决定她会不会「自己加戏」。**工作状态那 6 条
动画已出片**（`events.workStatus` 六档齐），所以 `workStatusEnabled` 已打开；碎碎念那 3 条
还没出片，仍关着；`balanceEnabled` 保持 false（余额查询已整体删除）：

| 开关 | 本版 | 说明 |
|---|---|---|
| `workStatusEnabled` | **true** | 跟着内核会话事件换档位动画 + 气泡（思考/干活/等待确认/收工/出错）。只监听事件，不额外调模型；**非终态档位循环播**，成功/出错播一遍回待机。⚠ 事件动画不受 `categories[].noMirror` 约束，`工作状态-冒泡思考` 头顶的「?」在 `facing=right` 时会以镜像形态出现——嫌碍眼就改回 false |
| `whisperEnabled` | **false** | 碎碎念：按 `eventsRefreshSec.whisper`（默认 300s）调一次当前模型生成一句话 + 播碎碎念动画。**这会消耗额度**，想省就改回 false（菜单「碎碎念」手动点播不受影响）。现状 false 是因为 `events.whisper` 那 3 条还没出片 |
| `balanceEnabled` | **false** | 余额查询已去掉（宿主无 `/balance` 路由、渲染端不轮询不弹气泡）。该字段与 `eventsRefreshSec.balance` 都只是**兼容旧配置的必填项**，不再有任何行为；6 条余额档位动画还没出片，所以暂时也不在「动作」菜单里 |

右键菜单：对话 / 设置 / 回到初始位置 / 退出桌宠 + 「动作」（**待机 1 · 转向 1 · 点击回应 2 ·
移动 1 · 小动作 9 · 玩耍 15 · 吃什么 2 · 文字 1 · 工作状态 6**，全是已出片的，可直接点播）。**「碎碎念」这一项暂时不显示**——它要先请宿主
生成一句话（真花额度）再抽 `events.whisper` 里的动画播 + 弹气泡，而 3 条碎碎念动画还没出片，
池子空时生成完什么都播不出来；出片并填进 config 后菜单项自动回来（判定见
`runtime/electron-helper/renderer.js` 的 tools 列表）。
> 菜单里的分组由 `shared-core.js` 的 `buildMenuTree` 生成：**`events` 的每个非空键也会建成一组**
> （标签取 `EVENT_LABELS`），所以「工作状态」这 6 条既会被会话事件自动触发，也能右键手动点播。

### 换片：硬切，无溶解/无首尾焊接

`runtime/electron-helper/renderer.js` 的换片是**硬切**——新动画首帧真正上屏
（`requestVideoFrameCallback`）后，同一帧里把旧层停播并撤下，两段不叠、不淡化。
开发期那套「交叉淡化（溶解）」与「首尾焊接」是按素材接缝问题做的过渡方案；本项目这批动作
每段首尾都是同一个站姿，接得上，不需要过渡。冒烟自检里的覆盖度不变量仍然守着
（任意时刻至少一层完全不透明，实测 173 次采样最小覆盖度 = 1.00，不会闪背景）。

## 快速开始

```sh
pnpm install     # Electron 下载慢的话，.npmrc 已配 npmmirror 镜像
pnpm build       # tsc 编译到 lib/（首次或改动 src/ 后）
pnpm start       # = node lib/bin.js；开发期可用 pnpm dev（tsx 直跑 src/）
```

启动后宠物出现在桌面右上角，系统托盘出现她的头像。需要 Node.js ≥ 22.19 与 pnpm ≥ 10。

> 上面这条链只覆盖 host 侧（`src/` → `lib/`）。**改了外壳的纯逻辑层 `shell/` 要另外重建产物并过闸**：
> `pnpm verify:shell` 一次跑完十一道闸——思考剥离 → `shell/` 类型检查 → PS 脚本 BOM → 产物自检 →
> 界面字体闸 → 新旧产物差分 → 菜单夹取 → 面板落位 → 气泡节奏 → 穿透兜底 → 面板 55 项断言。
> 只改了 `shell/` 时要先 `pnpm build:desktop-core` 重建产物（改了 `src/` 则是 `pnpm build`）。
> 详见 [`shell/README.md`](shell/README.md)。

**模型配置**：右键桌宠 → 设置，填写接口协议（OpenAI 兼容 / OpenAI Responses / Anthropic）、接口地址（baseURL）、API Key 与模型 id 即可——支持 DeepSeek、通义、月之暗面、OpenRouter 等任何 OpenAI 兼容端点以及 Claude。API Key 写入凭据存储（`~/.dsh/.credentials.yaml`，0600），不进配置文件；未配置时对话会提示先完成设置。

### 可选开关（启动前设环境变量）

| 变量 | 效果 |
|---|---|
| `DSH_PERMISSION_MODE=workspace-write` + `DSH_PET_APPROVAL=bubble` | 越权操作在宠物上弹审批确认框（默认 `danger-full-access` 全信任免打扰） |
| `DSH_PET_NO_ELECTRON=1` | 不起桌面窗口（无头调试，仅 HTTP 服务） |
| `DSH_PET_SMOKE_OUT=<path>` | 冒烟模式：延时截图后退出（CI 自检） |
| `DSH_PET_CHAT_SMOKE=1` | 冒烟模式附加项：脚本驱动一轮对话，把面板状态写进 `<冒烟输出>.chat.json` |

## 打包为 exe

```sh
.\scripts\pack-exe.ps1
```

> ⚠️ **改 `scripts\pack-exe.ps1` 时必须保留文件开头的 UTF-8 BOM**（`EF BB BF`）。
> Windows PowerShell 5.1 读**无 BOM** 的 `.ps1` 会按系统 ANSI（中文机器上是 GBK）解码，
> 中文注释与字符串立刻变乱码，脚本直接语法错误、打包失败——本脚本踩过这个坑。
> 用能保留 BOM 的编辑器改；改完可这样自检：
> `[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errs)`。

产出两份可直接分发的东西（`dist/`，附 `SHA256SUMS.txt`）：

| 产物 | 用途 | 冷启动 |
|---|---|---|
| `DSH-PET-AGENT-<ver>-setup.exe` | **NSIS 安装版**：按用户装到 `%LOCALAPPDATA%\Programs`，无需管理员，带开始菜单/桌面快捷方式与卸载项 | ~2 秒 |
| `win-unpacked\DSH-PET-AGENT.exe` | 免解包直跑目录（同一份内容），适合绿色部署 | ~2 秒 |

> 只出安装版（2026-09 起）：早先那个单文件 portable 版每次启动都要把 ~260 MB 的 app
> 解包到 `%TEMP%`，冷启动实测约 3 分钟——拿来「开机自启」体验很差，已去掉。
> 要绿色部署就用 `win-unpacked`（免安装、启动一样快）。

### 对话面板自检

```sh
node tools/chat-smoke/panel-test.mjs        # 55 项断言，无需 Electron / 桌面会话
```

## 架构

```
┌────────────────────────────────────────────┐
│ Electron 进程 A：桌宠壳（runtime/electron-helper）│
│  透明置顶小窗 · 动画 · 拖拽 · 菜单 · 对话/设置 │
│  · 审批弹窗 · 系统托盘（只有 显示/隐藏 · 退出）  │
└──────────────┬─────────────────────────────┘
               │ HTTP 127.0.0.1（/dsh-pet-7340 路由契约）
┌──────────────▼─────────────────────────────┐
│ pet-server（cordis 插件，node 进程）          │
│  配置/素材/whisper/settings/approval         │
│  chat（GET 转录 · POST 整轮 · /chat/stream   │
│   NDJSON 流式 · /chat/cancel 中断 turn）      │
│  /quit ← 托盘「退出桌宠」的有界退出入口        │
└──────────────┬─────────────────────────────┘
               │ @deepseek-ai/* npm 包
┌──────────────▼─────────────────────────────┐
│ dsh 内核：agent-loop + LLM + 会话持久化       │
│  工具：pwsh · fs · jobs · todo · computer-use│
└────────────────────────────────────────────┘
```

外壳自身再分两层：`runtime/electron-helper/` 是 Electron 侧（窗口、渲染、菜单、托盘），
`shell/` 是它的**纯逻辑层源码**（物理、几何、菜单树、气泡节奏、对话面板覆盖层），
`pnpm build:desktop-core` 把 `shell/` 打成 `runtime/electron-helper/shared-core.js` 供渲染层消费。

## 与早期版本 DSH-PET 的关系（互不干扰）

本项目是本机另一份桌宠 **DSH-PET** 的独立发行版：同一套内核能力，但素材自制、外壳自己维护，
且与本机上的 DSH-PET **完全隔离**，两个桌宠可以同时运行、互不干扰：

| 身份项 | 本项目（DSH-PET-AGENT） | DSH-PET |
|---|---|---|
| npm 包名 / cordis NAME | `dsh-pet-agent` | `dsh-pet` |
| HTTP 端口 | **7341** | 7340 |
| 状态目录（模型配置 / 会话记忆） | `~/.dsh/dsh-pet-agent-v2/` | `~/.dsh/dsh-pet-agent/` |
| 开机自启 Run 值 | `DshPetAgent` | `DshPet` |
| appId / 产品名 | `com.yenwuliu.dsh-pet-agent` / `DSH-PET-AGENT` | `com.yenwuliu.dsh-pet` / `DSH-PET` |

> **注意：两份状态是分开的**——API Key 与模型配置要在本项目里重新填一次
> （Key 进同一个凭据库 `~/.dsh/.credentials.yaml`，但模型配置各存各的）。
>
> **路由前缀 `/dsh-pet-7340` 是历史命名**：它在渲染端与 HTTP 契约里写死，只是个路径命名
> 空间。两个进程**端口不同即不冲突**，所以没必要改前缀——真要改，跟着
> `src/server.ts` 的 `ROUTE_PREFIX` 一起改即可。

## 目录速查

| 路径 | 作用 |
|---|---|
| `assets/` | 素材包 + `config.jsonc`（动画池/物理/联动的唯一事实来源）。素材清单、规格契约与生成脚本见 [`assets/README.md`](assets/README.md) |
| `runtime/electron-helper/` | Electron 桌宠壳（透明窗、渲染、菜单、托盘）；其中 `shared-core.js` 是 **构建产物** |
| `shell/` | 外壳纯逻辑层源码：`shared/`（常量/选择器/多屏几何/运动/物理/配置拍平/菜单/气泡等纯逻辑）+ `ours/`（本项目自己的实现：常驻流式对话面板、面板落位、气泡节奏、菜单夹取）+ `legacy/`（旧产物基准）；`pnpm build:desktop-core` 产出上面那个 `shared-core.js`。详见 [`shell/README.md`](shell/README.md) |
| `src/` | host 侧 TS：`bin.ts`（内核组合入口）、`server.ts`（HTTP 路由）、`computer-use.ts`、`model-config.ts`、`autostart.ts`、`vendor/` |
| `scripts/` | **16 个脚本**：素材管线 6 + 外壳验收闸 9 + 打包 1。清单、作用、何时跑见 [`scripts/README.md`](scripts/README.md) |
| `docs/` | 动画提示词模板、引擎衔接规范、形象设定图；**文档总入口是 [`docs/README.md`](docs/README.md)** |
| `packaging/` | `electron-builder.yml`、`launcher.cjs`（打包版启动器）、`app.ico`；`staging*/` 是组装中间产物，可随时清（`打包.bat clean`） |
| `tools/` | `ffmpeg.exe`（**不进版本管理**，用 `scripts/get-ffmpeg.ps1` 装）+ `chat-smoke/` 面板自检。见 [`tools/README.md`](tools/README.md) |
| `licenses/` | 第三方许可证全文（DeepSeek Harness 等）；适用范围与署名见 [`NOTICE.md`](NOTICE.md) |
| `patches/` | pnpm `patchedDependencies`（node-pty 补丁） |
| `lib/` | `pnpm build` 的产物（`cordis.patch.prod.yml` 指向这里） |
| `dist/` | `scripts/pack-exe.ps1` 的产物：安装版 exe + `win-unpacked/` |

> 素材生产（提示词 → 抠像 → 归一化 → 验收 → 上机）的完整链路画在
> [`docs/README.md`](docs/README.md) 里。

## 许可证

- **代码**（含桌宠外壳与内核组合层）: [MIT](LICENSE)
- **素材**（`assets/webm/` 动画、`assets/pic/` 图标与光标、托盘与应用图标）: 本项目自制，
  随代码按 MIT 处理
- **界面字体**（`assets/fonts/上首软糖体.ttf`）: 第三方字库**站酷快乐体 2016**
  （HappyZcool-2016，© LuiBingKe 2016），按版权方条款使用，**不适用** MIT
- 第三方代码署名、字体与依赖的完整条款见 [`NOTICE.md`](NOTICE.md)
