# shell/ —— 桌宠外壳的「纯逻辑层」源码

这里的东西决定**桌宠长什么样、怎么动**，不决定**她想什么**。

产物是 `runtime/electron-helper/shared-core.js`（IIFE，全局 `window.PetShared`），
由渲染层 `runtime/electron-helper/renderer.js` 第 27 行 `const S = window.PetShared;` 消费。
在本目录出现之前，那个产物是**手改的构建文件**（改完没人能重建）；现在它是这份源码的构建结果。

## 架构边界（2026-09 定）

> **dsh-pet 只作为桌宠外壳的来源，不提供智能。涉及 agent 的全部采用本项目自己的实现。**

| 采用（外壳：动画与桌宠操作） | 不采用（智能：全部走本项目 agent） |
|---|---|
| 动画播放/换片、拖拽抛掷物理、跨窗碰撞、点击穿透命中、多屏几何、右键菜单、积分弹窗、气泡渲染、配置拍平与权重抽签 | 上游 host 层的 `chat.ts` / `whisper.ts` / `llm-reasoning.ts` / `memes.ts` / `balance.ts` / `work-status.ts` / `notify-events.ts` / `index.ts`（61KB 宿主）；上游 `ctx.llm` / `agentDefaultModel` / `credentials` 依赖；上游 `memory.json` 记忆 |

对话与碎碎念的数据源一律是本项目 agent：`POST /dsh-pet-7340/chat/stream`（NDJSON 帧
`delta` / `tool` / `status` / `final` / `error`）。工作状态与气泡由 host 侧
`src/server.ts` 把 agent 事件写进 `/work-status` 与 `/broadcast`（`server.ts:188/222/229/240/313`）。

## 目录

| 路径 | 内容 | 规则 |
|---|---|---|
| `shared/` | 上游 **dsh-pet v0.2.11**（commit `8f57010`）`src/shared/*.ts` 的**逐字节副本**，16 个文件 | **不要在这里改代码**——保持逐字节是为了将来能直接与上游 diff / 整体升级 |
| `ours/` | 本项目的差异实现（覆盖同名上游模块）：`chat.ts`（常驻流式对话面板，含气泡模式的 `detach()` 收起通道）、`menu.ts`（菜单夹取兼容层）、`chat-place.ts`（面板落位）、`bubble.ts`（头顶气泡节奏：阅读时长 / 排队 / 分屏） | 全部 TypeScript；改行为改这里，并在下方「覆盖清单」登记 |
| `legacy/shared-core.built-old.js` | 重建前的旧产物备份（87 个导出） | 差分比对的"旧基准"；回退就是把它拷回 `runtime/electron-helper/shared-core.js` |
| `index.ts` | 构建入口：显式列举参与构建的模块 | 显式列举而非 `export * from './shared/index'`：ES 规范里同名 star-export 会被**静默忽略**，显式列举能让冲突变成构建期错误 |
| `tsconfig.json` | `ours/` + 入口的类型检查配置（`strict`，`lib: DOM`） | `pnpm check:shell-types` 跑它；上游 `shared/` 在 strict 下也干净通过（所以这道闸能连它一起盯） |

## 构建与验收

```sh
pnpm check:shell-types     # tsc -p shell/tsconfig.json（ours/ + 入口 + 被引入的上游 shared）
pnpm build:desktop-core     # esbuild 打包 shell/index.ts → runtime/electron-helper/shared-core.js
pnpm check:desktop-core     # 只做产物自检（导出面 / 渲染层符号 / 覆盖层断言）
node scripts/inspect-font.mjs --check --expect-family HappyZcool-2016   # 界面字体闸（字面 + 缺字）
node scripts/check-shared-parity.mjs   # 新旧产物差分比对（同一批输入喂两版，逐项对比）
node scripts/check-ps1-bom.mjs         # PowerShell 脚本 BOM 闸（含中文的 .ps1 必须有 UTF-8 BOM）
node scripts/check-menu-clamp.mjs      # 右键菜单夹取基准（无头 DOM 桩，6 项）
node scripts/check-chat-placement.mjs  # 面板落位与屏幕边缘碰撞（17 项 + 穷举扫描）
node scripts/check-bubble-schedule.mjs # 头顶气泡节奏：阅读时长 / 排队不打断 / 长回复分屏（32 项）
node scripts/check-pointer-target.mjs  # 点击穿透兜底通道（14 项）
node tools/chat-smoke/panel-test.mjs   # 对话面板 55 项断言（无头）
pnpm verify:shell                      # 上面全部一次跑完（含类型检查）
```

八道闸分别守：

1. **`check:shell-types`** —— `shell/` 的 TypeScript 类型检查（strict + DOM lib）。
   本项目的三个实现文件与构建入口，连同被 import 的上游 `shared/*` 一起检查。
2. **`build:desktop-core`** —— 导出面必须是旧产物的**严格超集**（不许有符号消失）；渲染层
   `runtime/electron-helper/*.js` 里出现的每个 `S.<符号>` 都必须在产物里存在；并且断言
   4 个覆盖层符号确实是**本项目的实现**（防止被上游同名实现悄悄顶掉）。
3. **`inspect-font.mjs --check`** —— 界面字体闸：槽位里必须是预期字面（family 对不上直接失败
   ——"字体文件被换成另一套字"是本项目真实踩过的坑），且界面语料不得有新的缺字
   （字库是 CJK 子集，`( ) [ \ ] ^ _ \` |` 这 8 个 ASCII 字形是**登记在案的已知缺口**，
   由后备字体族渲染；除此之外任何缺字都失败）。
4. **`check-shared-parity.mjs`** —— 65 项深度相等探针 + 不变量检查（含随机函数）+ 新版独有
   符号的健全性检查。当前基线：**0 抛错 / 0 不变量失败 / 2 项取值差异**（CHAT_CSS 是本项目
   主动调整的字体与文案，MENU_CSS 是上游新增的滚动条规则，见下）。
5. **`check-menu-clamp.mjs`** —— 6 项，钉住「旧全局 `__dshPetVisibleRect` → clamp」这层翻译
   （含显式 clamp 优先、无效值不传 NaN）。这条路径出错不抛异常，只让菜单落到屏幕外，所以必须机器守。
6. **`check-chat-placement.mjs`** —— 17 项，钉住对话面板落位：空间够贴右侧、右侧出屏翻左侧、
   两侧都窄压窄但不出屏、纵向夹取、面板过高给 `maxHeight`，外加 2600+ 组「宠物位置 × 可视矩形」
   的穷举扫描（横向/纵向从不越界）。同样是不抛异常的静默回归，必须机器守。
7. **`check-bubble-schedule.mjs`** —— 32 项，钉住头顶气泡的显示节奏（`ours/bubble.ts`）：停留时长
   按字数给阅读时间（4.5 字/秒，夹在 4~30 秒）、后来的气泡**排队而不顶掉**没读完的那条、碎碎念
   遇到真回复直接丢弃、流式期间不计时、长回复分屏（每屏 ≤110 字、最多 6 屏、超出并进末屏加省略号）。
   它守的是用户实际反馈过的那句「经常性上一句还没读就跳到下一个了」——这类问题不抛异常，只能机器守。
8. **`check-pointer-target.mjs`** —— 14 项，钉住点击穿透兜底通道：命中区与渲染端公式在
   size=300/462/600 下逐项一致、`HIT_BOX` 与产物同源、四条判定规则、以及"拖拽中光标被甩出
   窗口外也必须保持可交互"（上游 0.2.10 的回归）。
9. **`check-ps1-bom.mjs`** —— 含**非 ASCII**（中文注释/文案）的 `.ps1` 必须带 UTF-8 BOM，纯 ASCII
   的免检。Windows PowerShell 5.1 读无 BOM 的脚本会按 ANSI/GBK 解码，中文立刻变乱码、脚本直接
   语法错误——`scripts/pack-exe.ps1` 就这么坏过一次（某次编辑把 BOM 吃掉，打包当场失败），
   所以做成闸：改完这类文件跑一次就知道有没有踩到。
10. **`panel-test.mjs`** —— 55/55。除了面板自身的收发/重试/停止，还钉住 `detach()`（气泡模式
   收起面板的通道）与 `close()` 的**唯一差别**：detach **不取消**在飞回合，回复仍走到 `onReply`；
   以及 `compact` 形态（气泡模式的极简输入条：带 `is-compact` 标记、样式表藏掉标题栏/记录区/
   状态行/发送键、宽度跟着输入文本走、回车发送、Esc 关闭）。
11. 真窗口冒烟（改动壳的窗口/交互时跑）：`tools/chat-smoke/run-chat-smoke.ps1` +
   `.smoke/` 截图人工确认。**只换纯逻辑时不需要**（renderer/main 未动）；注意无交互式桌面
   会话时 Electron 起不来渲染进程，脚本会拿不到 verdict/截图（属已知限制，不是失败）。

> `pnpm verify:shell` 还含一道**宿主侧**的闸：`scripts/check-think-strip.mjs`（把模型混进正文的
> 思考段剥掉，实现见 `src/think-strip.ts`）——它守的是面板内容本身，与外壳同一条链上跑。

> ⚠️ 验收脚本一律放 `scripts/`：`.gitignore` 忽略了整个 `tools/`（为排除 ffmpeg 二进制），
> 放里面的闸在提交时会静默消失。
>
> ⚠️ 改本目录的文件请用能保证 UTF-8 的方式（编辑器 / Node 的 `fs`）。
> Windows PowerShell 的 `Get-Content`/`Set-Content` 默认按 ANSI 代码页处理无 BOM 文件，
> 会把中文写成乱码并让构建直接报「Unterminated string literal」。

## 覆盖清单（本项目对上游的差异）

| 符号 | 覆盖实现 | 为什么 |
|---|---|---|
| `mountChatDialog` / `CHAT_CSS` / `sendChat` / `sendChatStream` | `ours/chat.ts` | 上游是「极简输入框 → 发一句 → 弹窗消失 → 一条气泡」（222 行、非流式）；本项目是「常驻面板 + 逐字流式 + 工具状态行 + 停止/重试 + 历史回放」。渲染层依赖 `mountChatDialog` 的 8 项返回对象（`restore/append/isBusy/reposition/isFinished`…）与 `/chat/cancel`，换上游实现会直接 `TypeError`。**样式与实现必须成对**（两边都自带 `injectChatCss`）。已从"逐字提取的 JS"移植为 TypeScript（只加类型、不改逻辑；移植等价性对拍结论：导出面一致、48 个常量逐字节相同、`sendChat`/`sendChatStream` 归一化后完全相同、`mountChatDialog` 仅 4 处预期差异） |
| `mountContextMenu` | `ours/menu.ts`（薄包装，调用上游实现） | 上游 v0.2.11 不再读全局 `window.__dshPetVisibleRect`，改成显式 `clamp` 参数；本项目渲染层仍走旧契约（先写全局再调用），不包装则菜单退回「按窗口尺寸夹取」——桌面窗比屏幕大出外扩余量，宠物贴边时菜单会落进屏幕外不可见区 |
| `placeChatPanel` | `ours/chat-place.js` | 「面板跟随宠物 + 屏幕边缘碰撞」的唯一实现：贴宠物右侧 → 右侧在屏幕内放不下就翻到左侧 → 两侧都窄就压窄面板（下限 140px）；纵向贴着上缘但夹进可视区，面板过高时返回 `maxHeight` 让它内部滚动。渲染层 `layoutChatDialog()` 在**每次窗口移动后**调用（拖拽/抛掷/漫游/回位全走 `sendBounds`），面板自身的 `reposition()` 再按可视矩形夹一次作为最后保险；审批/设置弹窗也走同一个函数（`minWidth = 自身宽度` → 只借位置、不被压窄）。性能：渲染层用 `ResizeObserver` 缓存面板尺寸并把尺寸作为 hint 回传，拖动时不再逐帧 `getBoundingClientRect` |
| `BubbleQueue` / `bubbleDwellMs` / `splitBubbleText`（新增，不覆盖上游） | `ours/bubble.ts` | 上游没有气泡节奏这层：气泡固定 10 秒、新消息直接顶掉旧消息，而同一个气泡承载对话回复/碎碎念/命令提示——用户反馈「经常性上一句还没读就跳到下一个了」。这里把节奏抽成纯逻辑（时间由调用方传入，因此可无头验收）：按字数给阅读时间（4.5 字/秒、4~30 秒）、后来的排队不打断、碎碎念遇真回复丢弃、长回复分屏（≤110 字/屏、最多 6 屏）。渲染层 `showWhisper/pushBubble/renderBubble` 只是把 `BubbleStep` 画出来 |
| `mountChatDialog` 新增 `detach()` | `ours/chat.ts` | 气泡模式下面板只当输入框：发出去就收起，答案走头顶气泡。`close()` 会取消在飞回合，所以需要一个「收起但不取消」的通道——`detach()` 与 `close()` 的差别只有这一处（DOM/监听/`onClose` 完全一致），回合结束时 `onReply` 照常回调（`panel-test.mjs` 第 7 节钉住这 5 条） |
| `mountChatDialog` 新增 `compact` | `ours/chat.ts` | 气泡模式的输入条回到上游那版「极简输入框」：`compact: true` 时根元素多一个 `is-compact`，CSS 藏掉标题栏/记录区/状态行/发送键，宽度跟着输入文本走（160 → 340，超出在框内折行）。实现仍按整套面板构建（DOM 节点都在，只是不显示），因此落位/夹取/收起/`detach` 全部与面板同源，零重复代码 |

## 已知且接受的差异

| 差异 | 影响 | 判断 |
|---|---|---|
| `CHAT_CSS` 两处微调：面板根加 `font-weight:400;font-synthesis-weight:none`；标题 `.dsh-pet-chat-name` 由 `font-weight:700` 降到 `500` 并给 `color:#1f1f1f` | 面板字体族仍是那套 family 别名 `ShangshouSoftCandy`（与气泡/菜单/设置同一套，字库 = `assets/fonts/` 槽位里的**站酷快乐体 2016**）；去掉的只是**合成假粗体**——字库只有一个 400 字面，被请求 700 时浏览器会算法加粗，笔画糊且更厚。标题的分层改由字号（14px vs 正文 13px）+ 深色承担 | 本项目主动调整。36 条规则中仅这 2 条与旧产物（60013 bytes 那份）不同，其余逐字节相同 |
| `MENU_CSS` 新增 6 条滚动条规则（`.dsh-pet-menu-column` 的 `scrollbar-width/color` + `::-webkit-scrollbar*`） | 菜单列出现滚动条时有样式；其余 510 字符前缀与后续规则**逐字节相同** | 接受（上游为「长菜单被裁」加的） |
| `mountContextMenu` 传 `clamp` 后每列获得内联 `maxHeight = min(460, max(120, h-16))` | 可视区矮时菜单列封顶并可滚动 | 接受（正是上游对同一类溢出问题的修法；上游桌面壳也是这么传的） |
| `buildMenuTree` 支持数组槽位展平 | 当前配置（events 全为扁平字符串）下输出逐字相同；将来配数组槽位时新版展平成多叶子（旧版会产出坏叶子） | 接受（升级即修 bug） |
| 新版新增 31 个导出（`throwSpace`/`throwStepRegion`/`pickSlot`/`isEventAnim`/`createMemeImage`…） | 旧渲染层不调用，无影响；**step2 移植上游 sprite.js 时正好需要** | 接受 |
| `planMove(…, areas?)` / `anchorPixel(…, area?)` 新增可选末位参 | 本项目调用点不传 → 逐位相同 | 接受（step2 要多屏漫游时再传） |

## 与上游同步

```sh
# 1) 更新上游仓库到目标提交，然后重抄 shared/（保持逐字节，不带测试文件）
$up = 'D:\dsh\dsh-pet\dsh-pet\src\shared'
Get-ChildItem $up -File -Filter *.ts | Where-Object { $_.Name -notlike '*.test.ts' } |
  ForEach-Object { Copy-Item $_.FullName shell\shared\ -Force }

# 2) 重建 + 跑闸
pnpm build:desktop-core
node scripts/check-shared-parity.mjs
node tools/chat-smoke/panel-test.mjs
```

同步后重点看 `check-shared-parity` 的差异清单：**取值差异要逐条判断是"收益"还是"漂移"**；
凡是渲染层在用（输出里标 ★）且行为变了的，就在 `ours/` 加覆盖，并按上表登记理由。

## 待办（step2：把壳升级到上游 v0.2.11 表现层）

- [x] `ours/chat`：已移植为 TypeScript 并接入类型检查（`pnpm check:shell-types`）；
      `ours/chat-place.ts` 同批完成 —— `ours/` 下已无 JS 文件
- [ ] 引入上游 `runtime/electron-helper/{constants,sprite,events}.js`，把 1800+ 行全包的
      `renderer.js` 拆成「上层装配 + 本项目的对话面板/设置卡/审批」
- [ ] `main.js` 与上游做三方合并（上游的点击穿透兜底 + 输入租约**已单独移植**，
      见 `pointer-target.js` 与 `main.js` 的 60ms 轮询；剩下的是窗口/多宠管理部分的合流）
- [ ] 事件源改造：`events.js` 保留轮询骨架、删余额段；碎碎念/工作状态继续读本项目 host
      （工作状态的数组槽位与非终态续播**已实现**，见 `renderer.js` 的 `handleEnded`）
- [ ] 多屏漫游/抛掷：改用 `throwBoundsIn` / `throwSpace` / `throwStepRegion`，并让 `main.js`
      注入 `{hull, areas, panels}`（**必须整套换**：新 sprite 还依赖 `clampPointToRegion`、
      `resolveRect`、`translateRects`、`ANIMATION_EXT` 等旧产物没有的符号——这些符号我们产物里
      **已经全有**）。⚠️ **本项目决定暂不做**（2026-09）：这套改动只能在真机双屏上验，
      而当前无法在此环境跑真窗口冒烟，盲改风险大于收益
- [ ] 让 `renderer.js` 直接给 `mountContextMenu` 传 `clamp`，然后删掉 `ours/menu.ts` 包装
- [ ] 菜单工具项：保留本项目的「对话/设置/碎碎念/回到初始位置/退出桌宠」，**不要**采用上游
      sprite.js 的「打开网站 / 查看余额」（本项目 host 无 `/balance` 路由，点了只会报错）
