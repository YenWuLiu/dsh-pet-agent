/**
 * 气泡调度（本项目实现，纯逻辑）：桌宠头顶气泡的显示节奏。
 *
 * 为什么要单独一个模块：气泡原先是「固定 10 秒 + 新消息直接顶掉旧消息」，而它同时承载
 * 三类内容——对话回复、碎碎念、审批提示。实际用起来经常上一句还没读完就被下一句替换
 * （用户反馈的原话：「经常性上一句还没读就跳到下一个了」）。这里把节奏拆成两条规则：
 *
 *   1. **停留时长按字数给阅读时间**：约 4.5 字/秒，下限 4s、上限 30s（宁可多留一会儿）；
 *   2. **同一时刻只显示一条，后来的排队**：不打断还没读完的那条；只有用户自己发起的
 *      新回合才立即接替（人就在跟前，等上一句读完反而别扭）。
 *
 * 碎碎念额外让路：气泡里正显示真回复、或有回复在排队时，碎碎念直接丢弃——随口一句
 * 不该盖住正经回答，也不该排在它前面。
 *
 * 纯逻辑：不碰 DOM、时间由调用方传入（`now`），因此可以在没有浏览器的情况下验收
 * （见 scripts/check-bubble-schedule.mjs），渲染层只负责把 `BubbleStep` 画出来。
 */

/** 气泡内容类别：真回复 / 碎碎念。 */
export type BubbleKind = 'chat' | 'whisper'

/** 一条待显示的气泡。 */
export interface BubbleItem {
	kind: BubbleKind
	text: string
}

/** 一次调度结果：`show` = 现在显示这条（文本可能被就地更新）；`hide` = 收起气泡；都没有 = 什么都不做（被丢弃）。 */
export interface BubbleStep {
	show?: BubbleItem
	hide?: boolean
}

/** 阅读速度：约 4.5 字/秒（取中文默读速度的下限侧）。 */
export const BUBBLE_MS_PER_CHAR = 1000 / 4.5
/** 停留下限：再短的一句话也留 4 秒，够看清 + 反应过来。 */
export const BUBBLE_MIN_MS = 4000
/** 停留上限：再长的一段也留 30 秒，久了会挡屏幕。 */
export const BUBBLE_MAX_MS = 30000
/** 排队上限：真回复极少连发，超过就丢最旧的（避免异常情况下越排越长）。 */
export const BUBBLE_QUEUE_MAX = 5
/** 一屏气泡的字数上限：长回复拆成多屏依次显示（气泡再大也挡不住整段长文）。 */
export const BUBBLE_PAGE_CHARS = 110
/** 一屏上限的兜底：超过这么多屏就把后面的并到最后一屏并截断（避免刷个没完）。 */
export const BUBBLE_PAGE_MAX = 6

/**
 * 一条气泡的停留时长：按字数给阅读时间（空白字符不计）。
 * @param text - 气泡文本。
 * @returns 停留毫秒数，夹在 [{@link BUBBLE_MIN_MS}, {@link BUBBLE_MAX_MS}] 之间。
 */
export function bubbleDwellMs(text: string): number {
	const chars = [...String(text ?? '')].filter((ch) => !/\s/.test(ch)).length
	if (chars === 0) return BUBBLE_MIN_MS
	return Math.min(BUBBLE_MAX_MS, Math.max(BUBBLE_MIN_MS, Math.round(chars * BUBBLE_MS_PER_CHAR)))
}

/**
 * 把一段回复切成若干「屏」：优先在句末断开（。！？；!?;\n），否则按字数硬切。
 * 每屏各自拿一份阅读时间，所以长回复是「读完一屏再翻下一屏」，既不截断也不糊满屏。
 * @param text - 回复全文。
 * @param maxChars - 每屏字数上限（默认 {@link BUBBLE_PAGE_CHARS}）。
 * @param maxPages - 屏数上限（默认 {@link BUBBLE_PAGE_MAX}）；超出部分并进最后一屏并截断。
 * @returns 分屏后的文本数组；空文本返回空数组。
 */
export function splitBubbleText(text: string, maxChars = BUBBLE_PAGE_CHARS, maxPages = BUBBLE_PAGE_MAX): string[] {
	const body = String(text ?? '').trim()
	if (body === '') return []
	const limit = Math.max(1, Math.floor(maxChars))
	const pages: string[] = []
	let rest = body
	while (rest !== '' && pages.length < pageCap(maxPages)) {
		if ([...rest].length <= limit) {
			pages.push(rest)
			rest = '' // 收尾屏：清空剩余，否则下面的兜底分支会把它再拼一遍（踩过）
			break
		}
		const chars = [...rest]
		const window = chars.slice(0, limit)
		// 句末优先：从窗口末尾往回找标点，找不到就硬切
		let cut = -1
		for (let i = window.length - 1; i >= Math.floor(limit * 0.5); i--) {
			if (/[。！？；!?;\n]/.test(window[i] ?? '')) {
				cut = i + 1
				break
			}
		}
		if (cut <= 0) cut = limit
		pages.push(chars.slice(0, cut).join('').trim())
		rest = chars.slice(cut).join('').trim()
	}
	// 屏数用尽还有剩：把还能塞进最后一屏的部分补上，再以省略号收尾（不刷个没完）
	if (rest !== '') {
		const last = pages.length - 1
		const room = Math.max(0, limit - [...(pages[last] ?? '')].length)
		pages[last] = (pages[last] ?? '') + [...rest].slice(0, room).join('') + '…'
	}
	return pages.filter((p) => p !== '')
}

/** 屏数上限（至少 1 屏）。 */
function pageCap(maxPages: number): number {
	return Math.max(1, Math.floor(maxPages))
}

/** 队列内部条目：文本 + 停留截止时刻（流式期间为 Infinity，即「还不计时」）。 */
interface QueuedBubble {
	item: BubbleItem
	until: number
	streaming: boolean
}

/**
 * 气泡队列：谁在显示、显示到什么时候、下一条是谁。
 * 所有方法都接收 `now`（毫秒时间戳），因此行为完全可复现、可在测试里推时间。
 */
export class BubbleQueue {
	private cur: QueuedBubble | null = null
	private queue: BubbleItem[] = []

	/** 当前显示的气泡（没有则 null）。 */
	current(): BubbleItem | null {
		return this.cur === null ? null : this.cur.item
	}

	/** 排队等着显示的气泡条数。 */
	pending(): number {
		return this.queue.length
	}

	/**
	 * 当前这条还要停留多久。
	 * @param now - 当前时刻。
	 * @returns 剩余毫秒；流式回复期间为 Infinity（流没结束不计时）；没有气泡为 0。
	 */
	remaining(now: number): number {
		if (this.cur === null) return 0
		if (this.cur.streaming) return Number.POSITIVE_INFINITY
		return Math.max(0, this.cur.until - now)
	}

	/**
	 * 推一条一次性气泡（碎碎念、或已经拿到整段文本的回复）。
	 * @param kind - `whisper` 会让路：有真回复在显示/排队时直接丢弃。
	 * @param text - 气泡文本；空白文本视为无效，返回空步骤。
	 * @param now - 当前时刻。
	 * @returns 需要渲染层执行的步骤。
	 */
	push(kind: BubbleKind, text: string, now: number): BubbleStep {
		const body = String(text ?? '').trim()
		if (body === '') return {}
		if (kind === 'whisper') {
			if (this.queue.length > 0) return {} // 有回复在排队：碎碎念不插队
			if (this.cur !== null && this.cur.item.kind === 'chat') return {} // 回复正在显示：不打断
			// 没有回复的场合：显示或就地替换当前那条碎碎念（碎碎念按小时来，不会排长队）
			this.cur = { item: { kind, text: body }, until: now + bubbleDwellMs(body), streaming: false }
			return { show: this.cur.item }
		}
		// 真回复：正在显示的碎碎念让位；正在显示的另一条回复排队等着（不打断阅读）
		if (this.cur === null || this.cur.item.kind === 'whisper') {
			this.cur = { item: { kind, text: body }, until: now + bubbleDwellMs(body), streaming: false }
			return { show: this.cur.item }
		}
		this.queue.push({ kind, text: body })
		if (this.queue.length > BUBBLE_QUEUE_MAX) this.queue.shift()
		return {}
	}

	/**
	 * 流式回复开始：立即占位显示（用户刚发完消息，答案就该马上出现），期间不计时。
	 * 正在显示的碎碎念被顶掉，正在显示的旧回复直接接替（用户自己发起的新回合不等）。
	 * @param text - 占位文本（如「正在思考…」）。
	 * @param now - 当前时刻。
	 * @returns 需要渲染层执行的步骤。
	 */
	begin(text: string, now: number): BubbleStep {
		const body = String(text ?? '').trim()
		this.cur = { item: { kind: 'chat', text: body }, until: Number.POSITIVE_INFINITY, streaming: true }
		return { show: this.cur.item }
	}

	/**
	 * 流式增量：就地替换当前气泡文本（气泡是「整段替换」渲染，不做逐字追加）。
	 * @param text - 到目前为止的整段文本。
	 */
	update(text: string): void {
		if (this.cur === null || !this.cur.streaming) return
		this.cur.item.text = String(text ?? '')
	}

	/**
	 * 流式结束：定稿文本并按它重新计时（长回复因此拿到完整阅读时间）。
	 * @param text - 最终文本。
	 * @param now - 当前时刻。
	 * @returns 需要渲染层执行的步骤。
	 */
	finish(text: string, now: number): BubbleStep {
		if (this.cur === null || !this.cur.streaming) return {}
		const body = String(text ?? '').trim()
		if (body !== '') this.cur.item.text = body
		this.cur.streaming = false
		this.cur.until = now + bubbleDwellMs(this.cur.item.text)
		return { show: this.cur.item }
	}

	/**
	 * 流式结束 + 分屏定稿：长回复切成多屏，第一屏现在显示，其余屏排队依次显示。
	 * 每屏各自拿一份按字数的阅读时间，所以「上一句还没读完就跳走」不会发生。
	 * @param text - 最终文本。
	 * @param now - 当前时刻。
	 * @param maxChars - 每屏字数上限（默认 {@link BUBBLE_PAGE_CHARS}）。
	 * @returns 需要渲染层执行的步骤。
	 */
	finishPaged(text: string, now: number, maxChars = BUBBLE_PAGE_CHARS): BubbleStep {
		if (this.cur === null || !this.cur.streaming) return {}
		const pages = splitBubbleText(text, maxChars)
		if (pages.length === 0) return this.finish(text, now)
		this.cur.item.text = pages[0] as string
		this.cur.streaming = false
		this.cur.until = now + bubbleDwellMs(this.cur.item.text)
		for (const page of pages.slice(1)) {
			this.queue.push({ kind: 'chat', text: page })
			if (this.queue.length > BUBBLE_QUEUE_MAX) this.queue.shift()
		}
		return { show: this.cur.item }
	}

	/**
	 * 当前这条读完了：显示队列里的下一条，队列空了就收起气泡。
	 * @param now - 当前时刻。
	 * @returns 需要渲染层执行的步骤。
	 */
	next(now: number): BubbleStep {
		const head = this.queue.shift()
		if (head === undefined) {
			this.cur = null
			return { hide: true }
		}
		this.cur = { item: head, until: now + bubbleDwellMs(head.text), streaming: false }
		return { show: this.cur.item }
	}

	/** 清空一切（宠物关闭/重载时用）。 */
	clear(): void {
		this.cur = null
		this.queue = []
	}
}
