# tools/ —— 外部工具与冒烟夹具

本目录不是素材管线脚本（那些在 `scripts/`），只有两样东西：

| 内容 | 用途 |
|---|---|
| `ffmpeg.exe` | 出片管线依赖的 ffmpeg —— `normalize-webm.py`、`check-assets.ps1`、`check-anchor.py` 都调它。**不进版本管理**（单文件 100~212 MB，`.gitignore` 里按 `tools/*.exe` 排除） |
| `chat-smoke/` | 对话面板的回归夹具（`panel-test.mjs` 被 `pnpm verify:shell` 调用；`run-chat-smoke.ps1` 可单独跑真窗口冒烟）。`chat-smoke/out/` 是每次重跑都会重写的产出，已 gitignore |

## ffmpeg 怎么来

**新克隆的仓库没有它，跑一次：**

```sh
.\scripts\get-ffmpeg.ps1          # 装到 tools\ffmpeg.exe
.\scripts\get-ffmpeg.ps1 -Check   # 只体检现有安装，不下载
```

默认下 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 的 release **essentials** 构建
（`.zip`，109 MB，Windows 自带解压，不需要 7-Zip）。

**为什么 essentials 就够**：管线只需要

- `libvpx-vp9` **编码器** —— 出 VP9-Alpha 成品
- `qtrle` / `hevc` / `prores` **解码器** —— 读各种手扣 MOV 母版

官方库清单里 essentials 含 `libvpx`，且「所有变体都包含全部内置组件」，三类解码器都是内置的。
full 版多出来的 vulkan / whisper / libplacebo 等本管线一个都不用，而且 full 只提供 `.7z`
（169 MB，需 7-Zip）—— 要它就用 `-Url` 指过去：

```sh
.\scripts\get-ffmpeg.ps1 -Url 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z'
```

**版本差异不影响验收**：`check-assets.ps1` 查的是「640×360 / 真 alpha / 锚点契约」，
不是字节相等。仓库里已提交的 38 条 webm 是用 full 9.0.1 出的；换版本重跑，容器字节
必然不同（VP9 容器本身非确定性，同版本同输入两次转换哈希也不一样），解码后像素才一致。

## 素材管线在哪

- **生产流程 / 规格契约**：`assets/README.md`
- **生成提示词**：`docs/动画生成清单.md`
- **衔接契约（引擎怎么播）**：`docs/动画设计与衔接规范.md`
- **归一化**：`python scripts/normalize-webm.py <MOV母版目录> assets/webm --anchor 休闲待机`
- **验收**：`.\scripts\check-assets.ps1`
- **一键出片**：双击 `素材加工\出片.bat`
