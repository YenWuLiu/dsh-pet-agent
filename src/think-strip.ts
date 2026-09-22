/**
 * 剥离模型混进正文的「思考块」。
 *
 * 背景（实机踩到）：推理模型在部分 OpenAI 兼容端点上**不把思考拆到 `reasoning_content`**，
 * 而是把「…思考…</think>正文」整段当作 content 流出来。面板只负责显示（架构边界：智能在宿主），
 * 于是整段英文推理被当成消息泡渲染出来。本模块只做一件事：从累积文本里认出思考段并切掉，
 * 剩下的才是要给她说的话。
 *
 * 约定（按命中优先级）：
 *   1. 出现闭合标记（`</think>` / `</thinking>` / `</reasoning>`，大小写不敏感）
 *      → 最后一个闭合标记之前的都算思考，之后的是正文。以闭合标记为准而不是开场标记：
 *        DeepSeek-R1 这类模型的 prompt 模板里已经带了开场标记，正文流里通常只有闭合标记。
 *   2. 只见开场标记（`<think` / `<thinking` / `<reasoning`）且尚未闭合
 *      → `pending = true`：调用方应显示「正在思考…」，而不是把半截推理当正文显示。
 *   3. 两者都没有 → 原样返回（绝大多数模型、绝大多数轮次走这条）。
 *
 * 防呆：闭合标记出现在很靠后（> THINK_SCAN_MAX）时不再当作思考块——避免把一段恰好包含
 * 该字符串的长正文整段吃掉；只见开场标记且超过同样阈值也放弃 pending（宁可显示原文，不能吞掉回复）。
 *
 * **已知限制（无法消除，只能说明）**：DeepSeek-R1 这类模型的正文流里通常**没有开场标记**
 * （开场标记在 prompt 模板里）。此时闭合标记到达之前，推理文本与正文在字面上无法区分——
 * 它会先流向调用方，闭合标记一到就被正文**整体替换**（面板按替换渲染，不是追加），
 * 因此**最终显示内容是正确的**，只是流式过程中会看到一次推理闪过。要彻底消除只能整轮缓冲
 * （牺牲所有模型的逐字流式），故不做。
 *
 * 验收：scripts/check-think-strip.mjs。
 */

/** 认作思考块闭合的标记。 */
const CLOSERS = ['</think>', '</thinking>', '</reasoning>'] as const
/** 认作思考块开场的标记（只用于判断"还在思考中"）。 */
const OPENERS = ['<think', '<thinking', '<reasoning'] as const
/** 扫描上限：标记超出这个位置就不认为是思考块（防呆，见文件头）。 */
export const THINK_SCAN_MAX = 20_000

/** 剥离结果。 */
export interface ThinkStripResult {
  /** 去掉思考段之后、可以显示的正文 */
  text: string
  /** 是否识别出思考段（调用方据此把它归入"思考"而不是"正文"） */
  thinking: boolean
  /** 是否仍在思考中（尚未闭合）：此时 text 恒为空，调用方应继续等待 */
  pending: boolean
}

/**
 * 从（可能仍在增长的）模型输出里切出正文。
 * @param raw 到目前为止累积的原始文本（每次调用可传入更长的累积值，函数无状态）。
 * @returns 正文 / 是否识别出思考段 / 是否仍在思考中。
 */
export function stripThink(raw: string): ThinkStripResult {
  const lower = raw.toLowerCase()
  // 1) 有闭合标记：最后一个之前都算思考
  let cutStart = -1
  let cutEnd = -1
  for (const closer of CLOSERS) {
    const idx = lower.lastIndexOf(closer)
    if (idx > cutStart) {
      cutStart = idx
      cutEnd = idx + closer.length
    }
  }
  if (cutStart >= 0 && cutStart <= THINK_SCAN_MAX) {
    return { text: raw.slice(cutEnd).replace(/^\s+/, ''), thinking: true, pending: false }
  }
  // 2) 只见开场标记：仍在思考
  const head = lower.trimStart()
  if (OPENERS.some((opener) => head.startsWith(opener))) {
    if (raw.length > THINK_SCAN_MAX) return { text: raw, thinking: false, pending: false } // 太长：放弃剥离
    return { text: '', thinking: true, pending: true }
  }
  // 3) 没有思考标记：原文照用
  return { text: raw, thinking: false, pending: false }
}
