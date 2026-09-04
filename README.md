# dsh-pet-agent 🐾

一只**会管理你电脑**的桌面宠物：97 个手绘动画的桌宠外壳 + DeepSeek Harness
内核 Agent 大脑。双击跟她聊天，她真的会用 pwsh、鼠标、键盘、窗口管理帮你
干活——查系统、管文件、开程序、操作 GUI，还能截图"看"你的屏幕。

## 特性

- **对话即命令**：右键/双击宠物打开对话框，自然语言下任务（「看看 C 盘剩余空间」「打开记事本写一句话」「列出内存占用前 5 的进程」）
- **Computer Use**：`computer_screenshot` 截图进模型视觉、`computer_click/move/drag` 控鼠标、`computer_type/key` 输文字按键、`window_list/focus` 管窗口、`app_open` 开程序、`clipboard_read/write` 剪贴板、`notify` 系统通知
- **pwsh 全家桶**：内核 Agent 自带 pwsh / fs / jobs / todo 工具
- **流式气泡**：正在思考… → 正在执行 pwsh… → 回复逐字出现
- **审批气泡**（可选）：越权操作在宠物上弹「允许一次/拒绝」确认框
- **跨重启记忆**：重启后她还记得你叫什么
- **设置卡**：右键 → 设置——开机自启（注册表 Run 键、无窗口启动）、模型切换（provider/model，留空跟随系统默认）
- **内核即库**：不装 dsh CLI、不需要 monorepo——整个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 内核作为普通 npm 依赖运行（`@deepseek-ai/*@0.1.2-rc.1`）

## 快速开始

```sh
pnpm install     # Electron 下载慢的话，.npmrc 已配 npmmirror 镜像
pnpm start       # = node --import tsx/esm src/bin.ts
```

启动后宠物出现在桌面右上角。需要 Node.js ≥ 22.19 与 pnpm ≥ 10。

**模型凭据**（二选一）：

- 环境变量 `DEEPSEEK_API_KEY`
- 或 `~/.dsh/` 下的凭据/设置文件（与 dsh CLI 共用；`~/.dsh` 只是数据目录，不依赖 dsh 产品）

### 玩法示例

| 对她说 | 她做什么 |
|---|---|
| 「截个图看看你现在屏幕上有什么」 | computer_screenshot → 视觉模型直接看图；纯文本模型自动降级并用 window_list 复述 |
| 「打开记事本，输入『你好』」 | app_open → window_focus → computer_type（GUI 真实输入） |
| 「把这段话复制到剪贴板」 | clipboard_write，随处 Ctrl+V |
| 「10 秒后提醒我喝水」 | pwsh 定时 + notify 气泡通知 |

### 可选开关（启动前设环境变量）

| 变量 | 效果 |
|---|---|
| `DSH_PERMISSION_MODE=workspace-write` + `DSH_PET_APPROVAL=bubble` | 越权操作在宠物上弹审批确认框（默认 `danger-full-access` 全信任免打扰） |
| `DSH_PET_NO_ELECTRON=1` | 不起桌面窗口（无头调试，仅 HTTP 服务） |
| `DSH_PET_SMOKE_OUT=<path>` | 冒烟模式：延时截图后退出（CI 自检） |

## 架构

```
┌────────────────────────────────────────────┐
│ Electron 透明置顶窗口（dsh-pet 桌面壳）       │
│  动画 · 拖拽 · 菜单 · 对话/设置/审批弹窗      │
└──────────────┬─────────────────────────────┘
               │ HTTP 127.0.0.1（/dsh-pet-7340 路由契约）
┌──────────────▼─────────────────────────────┐
│ pet-server（cordis 插件）                    │
│  配置/素材/whisper/chat/settings/approval    │
└──────────────┬─────────────────────────────┘
               │ @deepseek-ai/* npm 包
┌──────────────▼─────────────────────────────┐
│ dsh 内核：agent-loop + LLM + 会话持久化       │
│  工具：pwsh · fs · jobs · todo · computer-use│
└────────────────────────────────────────────┘
```

## 许可证与署名

- **本项目代码**: [MIT](LICENSE)
- **第三方**: 见 [NOTICE.md](NOTICE.md)——本项目是衍生作品：
  - [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT 代码；桌面壳与
    shared-core 在本项目中有修改）
  - [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，内核经 npm 引用）
- **动画/字体素材（`assets/`）**: **允许开源使用，禁止商用**（上游作者声明，
  不适用 MIT），详见 [assets/README.md](assets/README.md)。商用前请取得
  dsh-pet 作者许可。
