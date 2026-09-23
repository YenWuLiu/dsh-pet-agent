# tools/ —— 外部工具与冒烟夹具

本目录不是素材管线脚本（那些在 `scripts/`），只有两样东西：

| 内容 | 用途 |
|---|---|
| `ffmpeg.exe` | 出片管线依赖的 ffmpeg —— `normalize-webm.py`、`check-assets.ps1`、`check-anchor.py` 都调它。**不进版本管理**（单文件 100~212 MB，`.gitignore` 里按 `tools/*.exe` 排除） |
| `chat-smoke/` | 对话面板的回归夹具（`panel-test.mjs` 被 `pnpm verify:shell` 调用；`run-chat-smoke.ps1` 可单独跑真窗口冒烟）。`chat-smoke/out/` 是每次重跑都会重写的产出，已 gitignore |

## ffmpeg 怎么来

**新克隆的仓库没有它，跑一次：**

```sh
.\scripts\get-ffmpeg.ps1                      # 装到 tools\ffmpeg.exe
.\scripts\get-ffmpeg.ps1 -Check               # 只体检现有安装，不下载
.\scripts\get-ffmpeg.ps1 -FromFile <本地zip>   # 用自己下好的包安装
```

### 默认下载源（实测数据）

默认是 **BtbN 的 FFmpeg-Builds GitHub 发布，经 `gh-proxy.com` 代理** —— 本机实测各源速度差 250 倍：

| 源 | 速度 | 约需 |
|---|---|---|
| `gh-proxy.com` + BtbN 发布 | **13,815 KB/s** | ~15 秒 ← 默认 |
| `ghfast.top` + BtbN 发布 | 4,906 KB/s | ~40 秒 |
| `github.com` 直连 | 185 KB/s | ~10 分钟 |
| `gyan.dev` 官方 | 55 KB/s | ~34 分钟 |

> ⚠️ **第三方代理意味着你信任它转发的二进制。** 脚本装完会打印版本与 sha256，介意的话
> 用 `-Url` 指向官方源，或自己下好再用 `-FromFile`。
> 另外：本机实测这些源都会**中途断流**（gh-proxy 下到 54% 停住），所以脚本用 `curl.exe`
> 带 `-C -` 断点续传 + 最多 5 次重试。真下不动就用 `-FromFile`。

### 需要哪些能力

管线只依赖这几项，脚本装完会自动体检（缺一即 exit 1）：

- `libvpx-vp9` **编码器** —— 出 VP9-Alpha 成品
- `qtrle` / `hevc` / `prores` **解码器** —— 读各种手扣 MOV 母版

essentials / gpl / full 各变体都满足（解码器是 ffmpeg 内置的，编码器靠 `libvpx`，
三个变体都含）。full 版多出来的 vulkan / whisper / libplacebo 等本管线一个都不用。
要指定别的源就用 `-Url`：

```sh
.\scripts\get-ffmpeg.ps1 -Url 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z'
```

（`.7z` 需要 7-Zip；`.zip` 用 Windows 自带解压。）

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
