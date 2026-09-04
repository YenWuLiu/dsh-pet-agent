# NOTICE — 第三方代码与素材署名 / Third-Party Notices

本项目是衍生作品，站在两个优秀的开源项目肩膀上。谨按要求完整保留各上游的
版权与许可证声明，并在此明确致谢。

This project is a derivative work built on two open-source projects. Their
copyright and license notices are preserved here as required, with thanks.

---

## 1. dsh-pet（桌面宠物外壳与动画素材）

- **上游仓库**: <https://github.com/PC2005-cloud/dsh-pet>
- **代码许可证**: MIT（见 `licenses/LICENSE.dsh-pet`）
- **本项目使用/修改的部分**:
  - `runtime/electron-helper/`（Electron 桌面壳：`main.js` / `renderer.js` /
    `preload.js` / `index.html` —— 在本项目中有修改：新增设置/审批对话框、
    双击打开对话框、屏幕可视矩形钳制、菜单项裁剪等）
  - `runtime/electron-helper/shared-core.js`（由上游 `src/shared/` 构建的
    iife 纯逻辑包 —— 在本项目中对 `menu.ts` / `chat.ts` 做了屏幕可视矩形
    钳制修改后重新构建）
  - `src/vendor/config.ts` / `src/vendor/whisper.ts` /
    `src/vendor/llm-reasoning.ts`（host 侧配置合并与碎碎念生成，原样移植）
- **动画与字体素材（`assets/webm/`、`assets/fonts/`、`assets/pic/`）**:
  上游作者明确声明——**允许开源使用，禁止商用**。
  这些素材**不属于**本项目的 MIT 授权范围，商用前请取得上游作者许可。
  详见 `assets/README.md`。

## 2. DeepSeek Harness（dsh 内核）

- **上游仓库**: <https://github.com/deepseek-ai/deepseek-harness>
- **代码许可证**: MIT
- **使用方式**: 本项目把内核作为普通 npm 依赖引用
  （`@deepseek-ai/*@0.1.2-rc.1`）：cordis 插件框架、agent-loop、LLM 抽象、
  pwsh/fs 工具、会话持久化等。未修改其源码，仅以 cordis 组合（patch 层）
  裁剪了与桌宠无关的行。
- **自带许可证文件**: `licenses/LICENSE.deepseek-harness`

## 3. 其余 npm 依赖

见 `package.json`。koffi（MIT）、electron（MIT）、tsx（MIT）、
typescript（Apache-2.0）等，均保留其各自许可证。

---

**开源精神说明**: 若本项目对你有帮助，欢迎 Star/Fork；若你在自己的作品中
使用了本项目，请同样保留下游署名链（本项目 NOTICE + 两个上游的 LICENSE）。
