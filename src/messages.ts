/**
 * 界面/宿主文案的唯一来源。
 *
 * 为什么单独一处：同一句话散在两个文件里，改一次忘一处就会漂移——「尚未配置模型：…」
 * 就同时在 `agent-chat.ts`（抛错）与 `vendor/whisper.ts`（结构化失败）里各写了一遍。
 * 本模块**不引用任何其他模块**（避免 model-config ↔ agent-chat 那样的循环依赖）。
 *
 * @module @deepseek-ai/dsh-pet-app/messages
 */

/** 未配置模型时的用户可见提示（对话面板与 agent 共用这一份）。 */
export const NO_MODEL_CONFIGURED = '尚未配置模型：右键桌宠 → 设置，填写 API Key、接口地址与模型'
