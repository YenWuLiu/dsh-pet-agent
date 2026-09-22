# NOTICE — 第三方代码与素材署名 / Third-Party Notices

DSH-PET-AGENT 的**代码**来自上游 dsh-pet（MIT）；**动画素材为本项目自制**。
`assets/pic/` 的界面图标目前仍沿用上游素材包，受「开源可用、禁止商用」约束。

The **code** of DSH-PET-AGENT comes from the upstream dsh-pet project (MIT). The
**animations are produced by this project and are not shipped in this repository**.
The UI icons in `assets/pic/` still come from the upstream asset pack and are
"open-source use only, no commercial use".

---

## 1. 桌宠外壳代码：dsh-pet（MIT）

- **上游仓库**: <https://github.com/PC2005-cloud/dsh-pet>
- **代码许可证**: MIT（见 `licenses/LICENSE.dsh-pet`）
- **本项目使用/修改的部分**（仅代码）:
  - `runtime/electron-helper/`（Electron 桌面壳：`main.js` / `renderer.js` /
    `preload.js` / `index.html` / `shared-core.js`——本项目在其上做了修改：
    设置与审批对话框、双击打开对话面板、屏幕可视矩形钳制、右键菜单项裁剪、
    托盘提示文案改为本版角色名）
  - `src/vendor/config.ts` / `src/vendor/whisper.ts` /
    `src/vendor/llm-reasoning.ts`（host 侧配置合并与碎碎念生成）
  - `shell/shared/`（**16 个文件，上游 dsh-pet v0.2.11 `src/shared/*.ts` 的逐字节副本**，
    只取纯逻辑层：常量/选择器/多屏几何/运动/物理/积分/配置拍平/菜单/气泡。
    本项目对上游的差异实现单独放在 `shell/ours/`，不修改这批副本；
    构建与验收方式见 `shell/README.md`）
  - `shell/ours/`（本项目自有实现：常驻流式对话面板 `chat.js`、
    右键菜单夹取基准兼容层 `menu.ts`——均取自/扩展本仓库自身代码）

> `runtime/electron-helper/shared-core.js` 自本次改造起是**构建产物**
> （由 `pnpm build:desktop-core` 从 `shell/` 生成），不再手工编辑；
> 重建前的产物留档在 `shell/legacy/shared-core.built-old.js` 作为差分比对基准。

## 2. 素材：动画自制 + 界面图标沿用上游（非商业授权）

- **本项目自制（不适用下面那条限制）**:
  - `assets/webm/` — 动画素材目录，**只放本项目自制的动画**（不附带上游素材包）。
    动画由本项目自行生产：规格契约见 [`assets/README.md`](assets/README.md)，
    生成流程见 `docs/动画生成清单.md` 与 `docs/自制素材指南.md`，
    转码与验收工具见 `scripts/key-video.py`、`scripts/normalize-webm.py`、
    `scripts/check-assets.ps1`。
  - `assets/fonts/上首软糖体.ttf` — 本项目自带的界面字体
    **站酷快乐体 2016（HappyZcool-2016）**，内嵌版权声明
    `(c) Copyright LuiBingKe 2016`（Version 3.12，6763 个常用汉字，字重 400）。
    它**不适用**下面那条「禁止商用」限制，自身授权以版权方条款及本项目取得的授权为准。
    - 文件名 `上首软糖体.ttf` 是渲染端硬编码的**槽位名**（见 `scripts/swap-assets.ps1`），
      不代表字体身份；
    - 上游原版字体（SSRuanTangTi，4MB）已移出 `assets/`，留档在
      `shell/legacy/fonts/`（该目录不进发行包）。
- **仍来自上游 dsh-pet 素材包（受下面条款约束）**:
  - `assets/pic/` — 手套拖拽光标 ×2 + 通知表情图标 ×6
  - `assets/config.jsonc` — 由上游随素材发布的动画池配置改写而来
    （动画名已替换为本项目自制清单，当前为占位名）
- **授权条款（上游作者声明，仅适用于上面仍来自上游的部分）**:

  > **允许开源使用，禁止商用。**

  - 可以在开源项目中使用、修改、再分发这些素材（保留本说明与署名）。
  - **不可以**用于商业用途（商业产品、付费服务、广告素材等）。
  - 这些素材**不适用**本仓库根目录的 MIT License——MIT 只覆盖代码。
- **署名**: 素材作者 **PC2005-cloud**（dsh-pet 项目），
  原始出处 <https://github.com/PC2005-cloud/dsh-pet>

> 若要让本项目**完全脱离**上游素材条款，只需把 `assets/pic/` 那 8 个图标换成自制图标
> （文件名保持不变即可，渲染端按名取用）。这是目前唯一的遗留项。

## 3. dsh 内核（DeepSeek Harness，MIT）

- **本项目引用**: <https://github.com/YenWuLiu/dsh-kernel-0.1.2-rc.1>
  （`@deepseek-ai/*@0.1.5-rc.2` npm 依赖的对应源码）
- **原始上游**: <https://github.com/deepseek-ai/deepseek-harness>（MIT）
- **使用方式**: 内核作为普通 npm 依赖引用（cordis 插件框架、agent-loop、LLM
  抽象、pwsh/fs 工具、会话持久化等）。未修改其源码，仅以 cordis 组合（patch
  层）裁剪了与桌宠无关的行——见 `cordis.patch.yml` / `cordis.patch.prod.yml`。
- **自带许可证文件**: `licenses/LICENSE.deepseek-harness`

## 4. 其余 npm 依赖

见 `package.json`。koffi（MIT）、electron（MIT）、tsx（MIT）、
typescript（Apache-2.0）等，均保留其各自许可证。

---

**致谢**: 上游 dsh-pet 提供了桌宠外壳的代码与界面图标；动画规范文档
（`docs/`）来自本项目早前的自制素材工程。
