# NOTICE — 第三方代码署名 / Third-Party Notices

本项目代码是衍生作品，站在两个优秀的开源项目肩膀上。谨按要求完整保留各上游的
版权与许可证声明，并在此明确致谢。

This project is a derivative work built on two open-source projects. Their
copyright and license notices are preserved here as required, with thanks.

**本项目 `assets/` 下的动画、字体、图标素材均为自制，不含任何上游素材**（见第 3 节）。

---

## 1. dsh-pet（桌面宠物外壳，仅代码）

- **上游仓库**: <https://github.com/PC2005-cloud/dsh-pet>
- **代码许可证**: MIT（见 `licenses/LICENSE.dsh-pet`）
- **本项目使用/修改的部分**（仅代码，**不含其动画/字体/图标素材**）:
  - `runtime/electron-helper/`（Electron 桌面壳：`main.js` / `renderer.js` /
    `preload.js` / `index.html` —— 在本项目中有修改：新增设置/审批对话框、
    双击打开对话框、屏幕可视矩形钳制、右键菜单项裁剪（下线碎碎念根项与
    动作子菜单的余额档位/碎碎念两档）等）
  - `runtime/electron-helper/shared-core.js`（由上游 `src/shared/` 构建的
    iife 纯逻辑包 —— 在本项目中对 `menu.ts`（屏幕可视矩形钳制 + 事件档位
    菜单过滤）/ `chat.ts` 修改后重新构建）
  - `src/vendor/config.ts` / `src/vendor/whisper.ts` /
    `src/vendor/llm-reasoning.ts`（host 侧配置合并与碎碎念生成，原样移植）
- **素材声明**: 上游的动画/字体/图标素材**已全部移出本仓库**（备份于仓库外），
  不再分发；其「允许开源使用、禁止商用」的限制因此不适用于本项目当前内容。

## 2. dsh 内核（DeepSeek Harness）

- **本项目引用**: <https://github.com/YenWuLiu/dsh-kernel-0.1.2-rc.1>
  （`@deepseek-ai/*@0.1.2-rc.1` npm 依赖的对应源码）
- **原始上游**: <https://github.com/deepseek-ai/deepseek-harness>（MIT）
- **使用方式**: 内核作为普通 npm 依赖引用：cordis 插件框架、agent-loop、
  LLM 抽象、pwsh/fs 工具、会话持久化等。未修改其源码，仅以 cordis 组合
  （patch 层）裁剪了与桌宠无关的行。
- **自带许可证文件**: `licenses/LICENSE.deepseek-harness`

## 3. 本项目自制素材（`assets/`）

- **角色「小蓝」**（二头身 Q 版蓝鲸女仆）及其全部内容为本项目作者自制：
  - 动画 webm ×9（12 动画制制作中）：AI 生成（Kimi Work）+ 自建逐帧洪水
    抠像转码管线（`scripts/key-video.py` 等，见 `docs/自制素材指南.md`）
  - 拖拽光标 ×2、通知图标 ×6：取自角色设定图（`assets-custom/ref-src/`）
  - 设定图：三视图与表情 / 动作姿势表 / 头部与表情 / 道具与特效表
- **字体**: `assets/fonts/上首软糖体.ttf` 实为**站酷快乐体 2016**（zcool.com，
  免费可商用授权；文件名沿用渲染端硬编码名），致谢站酷字体团队。
- 上述素材与代码一样按仓库根目录 [LICENSE](LICENSE)（MIT）处理。

## 4. 其余 npm 依赖

见 `package.json`。koffi（MIT）、electron（MIT）、tsx（MIT）、
typescript（Apache-2.0）等，均保留其各自许可证。

---

**开源精神说明**: 若本项目对你有帮助，欢迎 Star/Fork；若你在自己的作品中
使用了本项目，请同样保留下游署名链（本项目 NOTICE + 两个上游的 LICENSE）。
