/**
 * shell/index.ts —— 桌宠外壳「纯逻辑层」构建入口。
 *
 * 产物：`runtime/electron-helper/shared-core.js`（IIFE，全局 `window.PetShared`），
 * 由 `scripts/build-desktop-core.mjs` 调用 esbuild 生成；渲染层
 * `runtime/electron-helper/renderer.js` 第 27 行 `const S = window.PetShared;` 消费它。
 *
 * 三层结构：
 *   1. `shell/shared/`  —— 上游 dsh-pet v0.2.11 `src/shared/*` 的**逐字节副本**
 *      （只取纯逻辑：常量/选择器/多屏几何/运动/物理/积分/配置拍平/菜单/气泡）。
 *      保留逐字节是为了将来能直接与上游做 diff / 同步升级；**不要在这里改代码**。
 *   2. `shell/ours/`    —— 本项目的差异实现（覆盖同名上游模块）。
 *   3. 本文件           —— 组装：显式列出参与构建的模块。
 *
 * 为什么显式列模块而不是 `export * from './shared/index'`：
 *   ES 规范里同名 star-export 会被**静默忽略**（ambiguous star exports），
 *   一旦上游新增了我们也有的同名符号，`export *` 会悄悄丢掉其中一个。
 *   显式列举 + 不引入被覆盖的上游模块，冲突会变成构建期错误。
 *
 * 架构边界（本项目约定）：**dsh-pet 只作为外壳来源，不提供智能**。
 *   - 上游 host 层的智能实现（chat.ts / whisper.ts / llm-reasoning.ts / memes.ts /
 *     balance.ts / work-status.ts / notify-events.ts / index.ts）一律不引入；
 *   - 回复内容一律来自本项目 agent（`POST /dsh-pet-7340/chat/stream`）。
 */

export * from './shared/types';
export * from './shared/constants';
export * from './shared/pickers';
export * from './shared/displays';
export * from './shared/motion';
export * from './shared/balance';
export * from './shared/whisper';
export * from './shared/config';
export * from './shared/notify';
export * from './shared/menu';
export * from './shared/physics';
export * from './shared/score';
export * from './shared/score-popup';
export * from './shared/work-status';

// 对话面板：本项目实现（常驻面板 + 逐字流式，TypeScript），覆盖上游 src/shared/chat.ts
// —— 上游那份是「极简输入框 → 一条气泡」，本项目的渲染层依赖流式帧契约，故不引入。
export * from './ours/chat';

// 右键菜单：上游实现 + 本项目的一层「夹取基准」包装（显式导出会遮蔽上面的 star 导出）。
// 上游 v0.2.11 把「读 window.__dshPetVisibleRect」改成了显式 clamp 参数，本项目渲染层
// 仍走旧契约，包装负责把旧全局翻译成 clamp；理由与验证方式见该文件头部注释。
export { mountContextMenu } from './ours/menu';

// 对话面板落位（贴哪边 / 贴多宽 / 夹到哪）：纯几何，渲染层每次宠物位置变化都调用它，
// 是「面板跟随 + 屏幕边缘碰撞」的唯一实现。验收见 scripts/check-chat-placement.mjs。
export * from './ours/chat-place';

// 头顶气泡的显示节奏（按字数给阅读时间 + 后来的排队不打断 + 长回复分屏）：
// 碎碎念 / 对话回复 / 命令提示共用一套队列，纯逻辑。验收见 scripts/check-bubble-schedule.mjs。
export * from './ours/bubble';

