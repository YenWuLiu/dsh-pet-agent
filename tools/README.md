# tools/ —— 外部工具与冒烟夹具

本目录不是素材管线脚本（那些在 `scripts/`），只有两样东西：

| 内容 | 用途 |
|---|---|
| `ffmpeg.exe` | 内置的 ffmpeg 9.0.1（`normalize-webm.py`、`check-assets.ps1`、`make-tray-icon.py` 等都调它）。体积大，`.gitignore` 里按 `tools/*.exe` 排除，不进版本管理 |
| `chat-smoke/` | 对话面板的回归夹具（`panel-test.mjs` 被 `pnpm verify:shell` 调用；`run-chat-smoke.ps1` 可单独跑真窗口冒烟）。`chat-smoke/out/` 是每次重跑都会重写的产出，已 gitignore |

## 素材管线在哪

- **生产流程 / 规格契约**：`assets/README.md`
- **生成提示词**：`docs/动画生成清单.md`
- **衔接契约（引擎怎么播）**：`docs/动画设计与衔接规范.md`
- **归一化**：`python scripts/normalize-webm.py <MOV母版目录> assets/webm --anchor 休闲待机`
- **验收**：`.\scripts\check-assets.ps1`
