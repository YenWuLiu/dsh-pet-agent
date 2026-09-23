# DSH-PET-AGENT 🐾

一个**装在自己电脑上的独立 Agent**（基于 DeepSeek Harness 内核）：会聊天，也会真的
动手干活——pwsh 执行命令、读写文件、控鼠标键盘、管窗口、开程序、截图"看"屏幕。
**桌宠只是她的外壳**：一只角色站在桌面右上角，双击就说话。**动画由本项目自制 —— 不附带上游素材包**（`assets/webm/` 只放自制动画，逐条出片），见 [素材与授权](#素材与授权)。

> **独立运行**：不装 dsh CLI、不需要 monorepo，整个内核作为普通 npm 依赖跑在自己的
> 进程里。
> **自己的配置**：模型走她自己的一份——右键 → 设置里填协议 / 接口地址 / API Key /
> 模型 id，Key 进凭据库（`~/.dsh/.credentials.yaml`，0600），不进配置文件；会话记忆、
> 托盘、开机自启项也都是她自己的。
> **动画自己生产**：出片流程见 `docs/动画生成清单.md`，转码与验收见 `assets/README.md`。

## 素材与授权（重要）

**本仓库不附带上游素材包**：`assets/webm/` 只放本项目自制的动画，逐条生产
（规格契约与生产流程见 [`assets/README.md`](assets/README.md) 与
`docs/动画生成清单.md`）。`assets/config.jsonc` 引用的动画名**与 `assets/webm/` 里实际存在的文件一一对应**。

| 内容 | 状态 | 授权 |
|---|---|---|
| `assets/webm/` | 本项目自制动画（**现有 24 条**，逐条出片） | 自制，随代码 MIT |
| `assets/fonts/上首软糖体.ttf` | 本项目自带界面字体 **站酷快乐体 2016**（HappyZcool-2016）；文件名是渲染端硬编码的槽位名，不代表字体身份 | 版权方条款（内嵌声明 © LuiBingKe 2016） |
| `assets/pic/` | 手套拖拽光标 ×2 + 通知表情图标 ×6，**目前仍沿用上游素材包** | 上游条款：允许开源使用，**禁止商用** |
| `assets/config.jsonc` | 由上游动画池配置改写，动画名换成本项目清单 | 随代码 MIT |

**授权：允许开源使用，禁止商用**——这条**只适用于**上表里仍来自上游的 `assets/pic/`。
上游素材不适用本仓库根目录的 MIT License（MIT 只覆盖代码）；署名与完整条款见
[`assets/README.md`](assets/README.md) 与 [`NOTICE.md`](NOTICE.md)。素材作者：
**PC2005-cloud**（<https://github.com/PC2005-cloud/dsh-pet>）。
> 想彻底脱离上游素材条款，只需把那 8 个图标换成自制图标（文件名不变即可）。

**当前进度（2026-09-23）**：`assets/webm/` 有 **24 条**自制动画。母版是重出的一批**纯黑底 HEVC**
（无 alpha，752×560 / 864×496 / 560×752，30fps，10.07s），经 `scripts/key-video.py` 抠像
（边界洪水填充去黑底，`--thresh 10`）并锚定成 640×360 VP9-Alpha：
待机 1 · 转向 1 · 点击回应 2 · 移动 1 · 小动作 7 · 玩耍 10 · 吃什么 2。
`assets/config.jsonc` **只引用这 24 条**，`scripts/check-assets.ps1` **三项全绿**：
配置共引用 24 个动画、0 个缺文件、全部 640×360 带 alpha，锚点契约 23 条全部达标
（最大偏差 2px，容差 ±8px）。上一版那 92 个"待出片槽位名"已按「以新素材为准」整体放弃。

> **本批相对上一版的变化**：素材从 14 条增加到 24 条，其中 `东张西望`（转向）、
> `点击回应-害羞惊讶` / `点击回应-开心跃动`（点击回应）、`吃Token` / `吹气球` / `扑克魔术` /
> `玩水枪` / `被吓一跳` / `趴地熟睡` / `跪坐干饭` / `原地向左奔跑` / `鲸鱼吐泡泡` 都是新片。
> 因此 `turn` / `clicks` 两个池子**第一次被填上**（`animationWeights.turn` 从 0 给回 5），
> 宠物现在会真的转身（`facing` 会翻转）。上一版两条锚点超差（`整体换装试色` 脚底 −19px、
> `小提琴演奏` 脚底 −11px）随重出素材一并消失。

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

### 三个联动开关：都先关着（等动画出片）

`assets/config.jsonc` 里 `pets[0]` 的三个开关决定她会不会「自己加戏」。本项目**还没有**
碎碎念与工作状态这两组动画，所以两者先关着（出片后改 true 并填 `animations.events`）；
`balanceEnabled` 保持 false（余额查询已整体删除）：

| 开关 | 本版 | 说明 |
|---|---|---|
| `workStatusEnabled` | **false** | 跟着内核会话事件换档位动画 + 气泡（思考/干活/等待确认/收工/出错）。只监听事件，不额外调模型；**非终态档位循环播**（多候选档位自动轮换），成功/出错播一遍回待机 |
| `whisperEnabled` | **false** | 碎碎念：按 `eventsRefreshSec.whisper`（默认 300s）调一次当前模型生成一句话 + 播碎碎念动画。**这会消耗额度**，想省就改回 false（菜单「碎碎念」手动点播不受影响） |
| `balanceEnabled` | **false** | 余额查询已去掉（宿主无 `/balance` 路由、渲染端不轮询不弹气泡）。该字段与 `eventsRefreshSec.balance` 都只是**兼容旧配置的必填项**，不再有任何行为；6 条余额档位动画还没出片，所以暂时也不在「动作」菜单里 |

右键菜单：对话 / 设置 / 回到初始位置 / 退出桌宠 + 「动作」（**待机 1 · 转向 1 · 点击回应 2 ·
移动 1 · 小动作 7 · 玩耍 10 · 吃什么 2**，全是已出片的，可直接点播）。**「碎碎念」这一项暂时不显示**——它要先请宿主
生成一句话（真花额度）再抽 `events.whisper` 里的动画播 + 弹气泡，而 3 条碎碎念动画还没出片，
池子空时生成完什么都播不出来；出片并填进 config 后菜单项自动回来（判定见
`runtime/electron-helper/renderer.js` 的 tools 列表）。

### 换片：硬切，无溶解/无首尾焊接

`runtime/electron-helper/renderer.js` 的换片是**硬切**——新动画首帧真正上屏
（`requestVideoFrameCallback`）后，同一帧里把旧层停播并撤下，两段不叠、不淡化。
开发期那套「交叉淡化（溶解）」与「首尾焊接」是按自制素材的接缝问题做的；上游这套动作
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
| `DSH-PET-<ver>-setup.exe` | **NSIS 安装版**：按用户装到 `%LOCALAPPDATA%\Programs`，无需管理员，带开始菜单/桌面快捷方式与卸载项 | ~2 秒 |
| `win-unpacked\DSH-PET.exe` | 免解包直跑目录（同一份内容），适合绿色部署 | ~2 秒 |

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

## 与 DSH-PET 的关系（身份隔离）

本项目是 `DSH-PET` 的**独立发行版**：同一套内核能力，但**动画自制**，且与本机上的
DSH-PET **完全隔离**，两个桌宠可以同时运行、互不干扰：

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
> **路由前缀 `/dsh-pet-7340` 故意没改**：它在上游逐字节副本 `shell/shared/` 里有 28 处
> 引用，而 `shell/shared/` 受 `scripts/check-shared-parity.mjs` 的逐字节一致性约束不许动。
> 前缀只是路径命名空间，两进程端口不同即不冲突。改端口就够了。

## 目录速查

| 路径 | 作用 |
|---|---|
| `assets/` | 素材包 + `config.jsonc`（动画池/物理/联动的唯一事实来源） |
| `runtime/electron-helper/` | Electron 桌宠壳（透明窗、渲染、菜单、托盘）；其中 `shared-core.js` 是 **构建产物** |
| `shell/` | 外壳纯逻辑层源码：`shared/`（上游 dsh-pet v0.2.11 逐字节副本）+ `ours/`（本项目覆盖）+ `legacy/`（旧产物基准）；`pnpm build:desktop-core` 产出上面那个 `shared-core.js` |
| `src/` | host 侧 TS：`bin.ts`（内核组合入口）、`server.ts`（HTTP 路由）、`computer-use.ts`、`model-config.ts`、`autostart.ts`、`vendor/` |
| `lib/` | `pnpm build` 的产物（`cordis.patch.prod.yml` 指向这里） |
| `scripts/` | 素材与打包脚本：`check-assets.ps1`（校验配置↔素材齐备）、`make-tray-icon.py`（从 `assets/pic/` 派生托盘/应用图标）、`normalize-webm.py`、`key-video.py`、`pack-exe.ps1` 等 |
| `tools/chat-smoke/` | 对话面板自检（无头 55 项断言 + 真窗口驱动） |

## 许可证

- **代码**: [MIT](LICENSE)
- **动画**（`assets/webm/`）: 本项目自制，随代码按 MIT 处理（**不附带上游素材包**）
- **界面图标**（`assets/pic/`）: 仍来自上游 dsh-pet 素材包，**开源可用、禁止商用**；
  换成自制图标即可完全脱离该条款
- 完整署名与条款见 [`assets/README.md`](assets/README.md) 与 [`NOTICE.md`](NOTICE.md)
