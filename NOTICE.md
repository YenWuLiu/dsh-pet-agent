# NOTICE — 第三方代码与素材署名 / Third-Party Notices

DSH-PET-AGENT 的**素材（`assets/` 下的动画、图标、光标，以及由图标派生的托盘/应用图标）
全部为本项目自制**；**桌宠外壳的代码源自上游 dsh-pet（MIT）**，本项目在其上做了大量修改，
按 MIT 保留署名。

All **assets** shipped in `assets/` (animations, icons, cursors and the tray/app icons derived
from them) are **produced by this project**. The **desktop-shell code derives from the upstream
dsh-pet project (MIT)** and has been substantially modified here; upstream attribution is kept
below. The only third-party asset still used at runtime is the UI font (see §2).

---

## 1. 桌宠外壳代码：dsh-pet（MIT）

- **上游仓库**: <https://github.com/PC2005-cloud/dsh-pet>
- **代码许可证**: MIT（见 `licenses/LICENSE.dsh-pet`）
- **本项目使用/修改的部分**（仅代码）:
  - `runtime/electron-helper/`（Electron 桌面壳：`main.js` / `renderer.js` /
    `preload.js` / `index.html` / `pointer-target.js` / `shared-core.js`）——本项目在其上做了
    大量修改与扩展：常驻流式对话面板与头顶气泡节奏、输入条（compact）形态、设置卡与
    审批对话框、双击打开对话、面板跟随与屏幕边缘碰撞、屏幕可视矩形钳制、右键菜单项裁剪、
    点击穿透兜底通道、托盘文案改为本版角色名
  - `src/vendor/config.ts` / `src/vendor/whisper.ts` /
    `src/vendor/llm-reasoning.ts`（host 侧配置合并、碎碎念生成、思考段剥离）
  - `shell/shared/`（**16 个文件，上游 dsh-pet v0.2.11 `src/shared/*.ts` 的逐字节副本**，
    只取纯逻辑层：常量/选择器/多屏几何/运动/物理/积分/配置拍平/菜单/气泡。
    本项目对上游的差异实现单独放在 `shell/ours/`，不修改这批副本；
    构建与验收方式见 `shell/README.md`）
  - `shell/ours/`（本项目自有实现：常驻流式对话面板 `chat.ts`、面板落位 `chat-place.ts`、
    气泡节奏 `bubble.ts`、菜单夹取兼容层 `menu.ts`——均取自/扩展本仓库自身代码）

> `runtime/electron-helper/shared-core.js` 是**构建产物**
> （由 `pnpm build:desktop-core` 从 `shell/` 生成），不再手工编辑；
> 重建前的产物留档在 `shell/legacy/shared-core.built-old.js` 作为差分比对基准。

## 2. 素材：全部本项目自制；界面字体是第三方字库

- **本项目自制（随代码按 MIT 处理）**:
  - `assets/webm/` — **38 条动画**，由本项目自行生产：手扣带 alpha 的 MOV 母版经
    `scripts/normalize-webm.py` 归一化为 640×360 VP9-Alpha。规格契约与生产流程见
    [`assets/README.md`](assets/README.md)，生成提示词见 `docs/动画生成清单.md`，
    衔接契约见 `docs/动画设计与衔接规范.md`，验收工具见 `scripts/check-assets.ps1`、
    `scripts/check-anchor.py`。
  - `assets/pic/notify-*.png` — 通知表情图标 ×6（完成 / 出错 / 提问 / 审批 / 截断 / 自检），
    256×256，本项目自己出图。
  - `assets/pic/cursor-*.png` — 拖拽光标 ×2（张开 / 握起），32×32、热点 (16,16)，
    由 `python scripts/make-cursors.py` 生成（几何图形 + 角色配色，可重建）。
  - `runtime/electron-helper/tray.png` 与 `packaging/app.ico` — 由
    `python scripts/make-tray-icon.py` 从 `assets/pic/notify-done.png` 派生
    （换角色形象后重跑一次）。
  - `assets/config.jsonc` — 本项目自己维护的动画池/物理/联动配置（唯一事实来源）。
- **第三方字库（不适用 MIT）**:
  - `assets/fonts/上首软糖体.ttf` — 本项目自带界面字体 **站酷快乐体 2016
    （HappyZcool-2016）**，内嵌版权声明 `(c) Copyright LuiBingKe 2016`
    （Version 3.12，6763 个常用汉字，字重 400）。它以版权方条款及本项目取得的授权为准，
    **不适用**本仓库根目录的 MIT License。
    - 文件名 `上首软糖体.ttf` 是渲染端硬编码的**槽位名**，不代表字体身份；
      字面身份由 `scripts/inspect-font.mjs --check --expect-family HappyZcool-2016` 盯着。
    - 上游原版字库文件（SSRuanTangTi，4 MB）留档在 `shell/legacy/fonts/`，**只作历史比对、
      不进发行包**（`scripts/pack-exe.ps1` 不收集该目录）；它同样不适用 MIT，
      若要彻底清空可整目录删除，没有任何脚本或验收闸引用它。

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

**致谢**: 上游 dsh-pet 提供了桌宠外壳代码的起点与纯逻辑层参考；动画规范文档
（`docs/`）来自本项目早前的自制素材工程。
