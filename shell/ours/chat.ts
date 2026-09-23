/**
 * shell/ours/chat.ts —— 对话面板（本项目自有实现，非上游代码）
 *
 * 来源：runtime/electron-helper/shared-core.js 的 `//#region src/shared/chat.ts` 区逐字提取
 * （旧产物备份见 shell/legacy/shared-core.built-old.js），随后**只加类型、不改逻辑**移植成 TS。
 * 行为由两道闸钉住：`tools/chat-smoke/panel-test.mjs`（43 项断言）与
 * `scripts/check-shared-parity.mjs`（CHAT_CSS 等常量与旧产物逐项比对）。
 *
 * 为什么不采用上游 src/shared/chat.ts：
 *   上游是「极简输入框 → 发一句 → 弹窗消失 → 一条气泡回复」（222 行，非流式）；
 *   本项目是「常驻面板 + 逐字流式 + 工具状态 + 停止/重试」。
 *   runtime/electron-helper/renderer.js 依赖本模块的 mountChatDialog 选项与
 *   sendChatStream 的 NDJSON 帧契约（delta/tool/status/final/error），不能换成上游实现。
 *
 * 边界（本项目架构约定）：**dsh-pet 只作为外壳来源，不提供智能**。
 *   本模块只负责「显示与传输」；回复内容来自本项目 agent 的
 *   POST /dsh-pet-7340/chat/stream（NDJSON），不引入上游任何 LLM 依赖。
 */

/** 一轮对话的失败原因（与宿主 `/chat` 的响应契约一致；`aborted` 是流式端点额外的取消态）。 */
export type ChatTurnReason = 'provider-missing' | 'generate-error' | 'config-error' | 'bad-request' | 'aborted'

/** 一轮对话的终态结果（`sendChat` 非流式 / `sendChatStream` 流式共用同一形状）。 */
export interface ChatTurnResult {
  ok: boolean
  /** ok=true 时的完整回复 */
  reply?: string
  /** 宿主时间戳（ok=true） */
  ts?: number
  /** ok=false 时的原因 */
  reason?: ChatTurnReason | string
  /** ok=false 时的人类可读说明（可能已自带「尚未配置模型：」这类前缀） */
  message?: string
  /** 本轮被取消（reason=aborted 时为 true） */
  aborted?: boolean
}

/**
 * `/chat/stream` 的 NDJSON 帧（`{v:1,type:...}`）。
 * `delta` 是**到目前为止的整段文本**（渲染按替换，不要追加）；`final`/`error` 为终帧。
 */
export interface ChatFrame {
  v?: number
  type: 'user' | 'delta' | 'reasoning' | 'tool' | 'status' | 'final' | 'error'
  text?: string
  /** type='tool'：工具名与参数摘要 */
  name?: string
  detail?: string
  /** 终帧字段 */
  reason?: string
  message?: string
  ts?: number
}

/** 面板挂载选项（渲染层 `renderer.js` 的调用点为准）。 */
export interface ChatDialogOpts {
  /** 宠物 id（拼在 ?pet= 上） */
  petId: string
  /** 标题栏显示名（缺省用 petId） */
  petName?: string
  /** 对话端点基址，缺省 `/dsh-pet-7340/chat`（流式自动推导为 `/chat/stream`） */
  baseUrl?: string
  /** 宠物宽度（面板宽度/日志高度按它缩放），缺省 462 */
  size?: number
  /** 初始期望位置（窗口坐标；渲染层随后会调 reposition 重新落位） */
  x?: number
  y?: number
  /** 自定义回合执行器（冒烟/嵌入用）：缺省走 sendChatStream */
  onSend?: (text: string, opts: { signal: AbortSignal }) => Promise<ChatTurnResult>
  /** 「停止」或关面板时触发：渲染层用它请求宿主取消在飞回合 */
  onCancel?: () => void
  /** 收到终帧回复（面板开着时用它展示；面板已关则由渲染层弹气泡） */
  onReply?: (reply: string) => void
  /** 面板关闭（✕ / Esc / 点外部）后的通知 */
  onClose?: () => void
  /** 用户手动拖动过标题栏（渲染层不再据此放弃跟随，仅作事件回调） */
  onMoved?: () => void
  /**
   * 极简输入条模式（气泡式聊天用）：只留一条输入框——没有标题栏/聊天记录/发送键，
   * 宽度跟着输入文本走（160 → 340），回车发送、Esc 或点外关闭。
   * 与面板共用同一套落位/夹取/收起逻辑，只是那几块 DOM 用 CSS 藏起来。
   */
  compact?: boolean
}

/** 面板句柄（渲染层持有；冒烟脚本读 isBusy/isFinished）。 */
export interface ChatDialogHandle {
  /** 面板根元素（窗口内 DOM） */
  el: HTMLElement
  close(): void
  /**
   * 收起面板但**不取消**在飞回合：DOM 与文档级监听拆掉、onClose 照常通知（外壳状态与
   * close 一致），但**不发取消**——气泡模式下面板只当输入框，回合由渲染层自己驱动到结束。
   * 与 close 一样幂等；关掉之后面板不能再发消息（要接着聊就重新打开）。
   */
  detach(): void
  /** 回放宿主转录（截尾 + 单条截断） */
  restore(messages: Array<{ role: string; text: string }>): void
  append(role: 'me' | 'pet', text: string): HTMLElement
  isBusy(): boolean
  /** 本轮是否已收到宿主终帧（排障/冒烟用） */
  isFinished(): boolean
  /** 落位：记录期望坐标并按可视矩形夹取；sizeHint 给了就不再量面板尺寸（拖动时逐帧调用） */
  reposition(x: number, y: number, sizeHint?: PanelSize): void
  /** 尺寸上限（屏幕边缘碰撞）：undefined = 恢复按内容定宽/不封高 */
  limit(maxWidth?: number, maxHeight?: number): void
}

/** 面板尺寸（渲染层用 ResizeObserver 缓存后回传，省掉逐帧 getBoundingClientRect）。 */
export interface PanelSize {
  width: number
  height: number
}

/** 可视矩形（窗口坐标）：渲染层 `visibleRect()` 的产物（屏幕工作区 ∩ 本窗口）。 */
interface VisibleRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 标题栏拖动的起点（指针位置 + 面板当时的左上角）。 */
interface DragOrigin {
  x: number
  y: number
  left: number
  top: number
}

declare global {
  interface Window {
    /** 渲染层写的「屏幕工作区 ∩ 本窗口」：面板/菜单据此夹取，缺省回落整个窗口视口 */
    __dshPetVisibleRect?: VisibleRect
  }
}

const SEND_TIMEOUT_MS = 6e4;
/** 极简输入条的宽度区间（与上游那版一致：初始 160 → 随文本增宽 → 封顶 340） */
const CHAT_COMPACT_MIN_W = 160;
const CHAT_COMPACT_MAX_W = 340;
const CHAT_COMPACT_PAD = 24; // 输入框左右 padding（11×2）+ 描边补偿
async function sendChat(baseUrl: string, text: string): Promise<ChatTurnResult> {
	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const raw: unknown = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 对话响应非法");
	const o = raw as Record<string, unknown>;
	if (o.ok !== true) return {
		ok: false,
		reason: o.reason === "provider-missing" || o.reason === "generate-error" || o.reason === "config-error" ? o.reason : "bad-request",
		message: typeof o.message === "string" ? o.message : void 0
	};
	const reply = typeof o.reply === "string" ? o.reply.trim() : "";
	if (!reply) throw new Error("dsh-pet: 对话回复非法");
	return {
		ok: true,
		reply,
		ts: Number(o.ts) || 0
	};
}
/**
 * One streamed chat turn over NDJSON (`POST /chat/stream`). Frames are
 * dispatched to `onFrame` AS THEY ARRIVE:
 *   user      — the echoed prompt (the panel already shows it; used for ordering)
 *   delta     — the WHOLE reply text so far (render by replacement, never append)
 *   reasoning — the model has started thinking; no user-visible text yet
 *   tool      — one tool invocation {name, detail} → transient status line
 *   status    — free-form transient status text
 *   final     — terminal: the complete reply
 *   error     — terminal: {reason, message}
 * `onFrame` is the only side-effect channel: nothing is thrown for a failed
 * turn (the error frame is the report), so callers have one shape to handle.
 *
 * @param baseUrl - the `/chat/stream` endpoint (pet id already baked in).
 * @param text - the user's message.
 * @param onFrame - synchronous per-frame sink.
 * @param opts - abort to drop the connection (the host cancels the in-flight
 *   turn when the stream closes).
 * @returns the terminal summary.
 */
async function sendChatStream(
	baseUrl: string,
	text: string,
	onFrame: (frame: ChatFrame) => void,
	opts?: { signal?: AbortSignal },
): Promise<ChatTurnResult> {
	const signal = opts && opts.signal ? opts.signal : void 0;
	let res: Response;
	try {
		res = await fetch(baseUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
			...(signal ? { signal } : {})
		});
	} catch (e) {
		if (signal && signal.aborted) return {
			ok: false,
			reason: "aborted",
			aborted: true
		};
		throw e;
	}
	if (!res.ok || !res.body) throw new Error("dsh-pet: 对话流 http " + res.status);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let outcome: ChatTurnResult | null = null;
	const handleLine = (line: string): void => {
		const trimmed = line.trim();
		if (trimmed === "") return;
		let frame: ChatFrame;
		try {
			frame = JSON.parse(trimmed) as ChatFrame;
		} catch {
			return;
		}
		if (!frame || typeof frame !== "object") return;
		if (frame.type === "final") outcome = {
			ok: true,
			reply: typeof frame.text === "string" ? frame.text : "",
			ts: Number(frame.ts) || 0
		};
		else if (frame.type === "error") outcome = {
			ok: false,
			reason: typeof frame.reason === "string" ? frame.reason : "generate-error",
			message: typeof frame.message === "string" ? frame.message : void 0,
			aborted: frame.reason === "aborted"
		};
		if (onFrame) onFrame(frame);
	};
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buf += decoder.decode(chunk.value, { stream: true });
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			handleLine(buf.slice(0, nl));
			buf = buf.slice(nl + 1);
			nl = buf.indexOf("\n");
		}
	}
	buf += decoder.decode();
	handleLine(buf);
	if (outcome === null) {
		return signal && signal.aborted ? {
			ok: false,
			reason: "aborted",
			aborted: true
		} : {
			ok: false,
			reason: "generate-error",
			message: "对话流意外中断"
		};
	}
	return outcome;
}
const CHAT_CSS = [
	// 面板本体：白色圆角卡（与菜单/气泡同一套视觉）；对话期间整窗已由渲染端保持可交互
	".dsh-pet-chat{position:fixed;z-index:2147483001;max-width:80vw;display:flex;flex-direction:column;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:12px;overflow:hidden;",
	"box-shadow:0 12px 36px rgba(0,0,0,.22);color:#2b2b2b;font-size:13px;line-height:1.5;",
	// 字体：family 别名 ShangshouSoftCandy（与气泡/菜单/设置同一套），实际字库是
	// assets/fonts/ 那个槽位里的**站酷快乐体 2016（HappyZcool-2016）**——本项目自带字体；
	// 想再换字体只替换那个 .ttf 即可（文件名是历史硬编码的槽位名，不代表字体身份）。
	// 后备链里的 'Yuanti SC'/'YouYuan'/'幼圆' 等只在字库加载失败时兜底；最后那串系统 UI 字体
	// 还负责字库**缺字形**的字符——该字库是 CJK 子集，ASCII 里没有 ( ) [ \ ] ^ _ ` | 这 8 个，
	// 所以界面文案尽量不用括号（用「」或直接换说法），万一出现也由雅黑 UI 渲染而不是 Comic Sans。
	"font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Microsoft YaHei UI','PingFang SC','Segoe UI','Microsoft YaHei',sans-serif;",
	// 不合成假粗体：单字面字体被请求 ≥600 时浏览器会算法加粗（笔画糊、更厚）
	"font-weight:400;font-synthesis-weight:none;",
	"user-select:none}",
	".dsh-pet-chat *{box-sizing:border-box}",
	// 气泡模式的输入条（compact）：回到上游那版「极简输入框」——没有标题栏、没有聊天记录、
	// 没有发送键，宽度跟着输入文本走（160 → 340，超了在框内折行），回车发送、Esc 关闭。
	// 这里靠 CSS 隐藏那几块（实现仍按整套面板构建），所以 DOM 逻辑与面板完全同源。
	".dsh-pet-chat.is-compact{width:160px;border-radius:10px}",
	".dsh-pet-chat.is-compact .dsh-pet-chat-head,",
	".dsh-pet-chat.is-compact .dsh-pet-chat-log,",
	".dsh-pet-chat.is-compact .dsh-pet-chat-status,",
	".dsh-pet-chat.is-compact .dsh-pet-chat-send{display:none}",
	".dsh-pet-chat.is-compact .dsh-pet-chat-compose{padding:0}",
	".dsh-pet-chat.is-compact .dsh-pet-chat-input{padding:8px 11px 9px;font-size:14px}",
	// 标题栏（拖动把手）：名字 + 状态点 + 关闭按钮
	".dsh-pet-chat-head{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 11px;",
	"border-bottom:1px solid rgba(0,0,0,.07);cursor:move;flex:0 0 auto}",
	".dsh-pet-chat-dot{width:7px;height:7px;border-radius:50%;background:#9aa4b2;flex:0 0 auto}",
	".dsh-pet-chat-dot.busy{background:#4a7dff;animation:dsh-pet-chat-pulse 1.1s ease-in-out infinite}",
	".dsh-pet-chat-dot.err{background:#d94f3d}",
	"@keyframes dsh-pet-chat-pulse{0%,100%{opacity:1}50%{opacity:.25}}",
	// 标题：字重降到 500（软糖体只有 400 字面 + 上面关了假粗体合成 → 实际就用 400 字面，
	// 比原来的「700 算法加粗」细一档）；分层改由字号（14px vs 正文 13px）和更深的颜色承担
	".dsh-pet-chat-name{flex:1 1 auto;font-weight:500;font-size:14px;color:#1f1f1f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".dsh-pet-chat-x{border:none;background:transparent;color:rgba(43,43,43,.45);font-size:16px;line-height:1;",
	"padding:1px 5px;border-radius:6px;cursor:pointer;font-family:inherit;flex:0 0 auto}",
	".dsh-pet-chat-x:hover{background:rgba(0,0,0,.06);color:#2b2b2b}",
	// 消息区：会话记录（常驻，发完不消失）；高度随宠物尺寸，收在 120~240px
	".dsh-pet-chat-log{flex:0 1 auto;overflow-y:auto;overflow-x:hidden;padding:9px 11px;display:flex;",
	"flex-direction:column;gap:7px;scrollbar-width:thin;height:calc(var(--pet-size,462px)*.26);",
	"min-height:120px;max-height:240px}",
	".dsh-pet-chat-log::-webkit-scrollbar{width:7px}",
	".dsh-pet-chat-log::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px}",
	".dsh-pet-chat-msg{display:flex;flex-direction:column;flex:0 0 auto;max-width:100%}",
	".dsh-pet-chat-msg span{border-radius:10px;padding:5px 9px;white-space:pre-wrap;overflow-wrap:anywhere}",
	".dsh-pet-chat-msg.me{align-items:flex-end}",
	".dsh-pet-chat-msg.me span{background:#4a7dff;color:#fff;border-bottom-right-radius:4px}",
	".dsh-pet-chat-msg.pet{align-items:flex-start}",
	".dsh-pet-chat-msg.pet span{background:rgba(0,0,0,.06);border-bottom-left-radius:4px}",
	// 流式光标：逐字出现（回复在飞的时候一直闪）
	".dsh-pet-chat-msg.streaming span::after{content:'';display:inline-block;width:2px;height:11px;",
	"margin-left:2px;background:currentColor;vertical-align:-1px;animation:dsh-pet-chat-caret .9s steps(1) infinite}",
	"@keyframes dsh-pet-chat-caret{0%,50%{opacity:1}50.01%,100%{opacity:0}}",
	// 工具/思考状态行：一条原地替换的灰字（不是消息）
	".dsh-pet-chat-status{flex:0 0 auto;color:rgba(43,43,43,.5);font-size:12px;padding:1px 2px;",
	"overflow-wrap:anywhere}",
	// 失败行：错误原因 + 「重试」
	".dsh-pet-chat-err{flex:0 0 auto;display:flex;align-items:center;gap:8px;color:#d94f3d;font-size:12px;",
	"padding:2px 2px;overflow-wrap:anywhere}",
	".dsh-pet-chat-retry{border:none;background:rgba(217,79,61,.12);color:#c0392b;border-radius:7px;",
	"padding:2px 9px;font-size:12px;cursor:pointer;font-family:inherit;flex:0 0 auto}",
	".dsh-pet-chat-retry:hover{background:rgba(217,79,61,.2)}",
	// 输入区：自增高输入框 + 发送 / 停止
	".dsh-pet-chat-compose{display:flex;align-items:flex-end;gap:6px;padding:7px 8px 8px 11px;",
	"border-top:1px solid rgba(0,0,0,.07);flex:0 0 auto}",
	".dsh-pet-chat-input{display:block;flex:1 1 auto;min-width:0;border:none;outline:none;background:transparent;",
	"padding:3px 0 4px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;resize:none;",
	"overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}",
	".dsh-pet-chat-input::placeholder{color:rgba(43,43,43,.45)}",
	".dsh-pet-chat-send{border:none;border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;",
	"font-family:inherit;background:#4a7dff;color:#fff;flex:0 0 auto}",
	".dsh-pet-chat-send:disabled{background:rgba(0,0,0,.12);color:rgba(43,43,43,.4);cursor:default}",
	".dsh-pet-chat-send.stop{background:#d94f3d}"
].join("");
/** 对话面板宽度：量出最长一行再定宽（钳在 [CHAT_MIN_W, CHAT_MAX_W]） */
const CHAT_MIN_W = 240;
const CHAT_MAX_W = 340;
const CHAT_H_PAD = 52;
/** 屏幕边缘碰撞时的压窄下限：低于它不再压（宁可压住宠物，也要能读） */
const CHAT_TIGHT_MIN_W = 140;
/** 面板与可视矩形边缘的最小留白（与渲染层 placeChatPanel 的 pad 同义） */
const CHAT_EDGE_PAD = 4;
/** 历史回放上限：条数与单条长度都收口，避免回放把面板撑爆 */
const CHAT_HISTORY_MAX = 12;
const CHAT_HISTORY_TEXT_MAX = 400;
let chatCssInjected = false;
function injectChatCss(): void {
	if (chatCssInjected || typeof document === "undefined") return;
	chatCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/chat";
	tag.textContent = CHAT_CSS;
	document.head.appendChild(tag);
}
/**
 * Mount the pet's chat panel: a persistent conversation (the log survives a
 * send — replies stream into it instead of closing the window), a composer that
 * grows with the text, and a stop/retry path for long or failed turns.
 *
 * The panel owns only VIEW state (busy flag, streaming node, status line) and
 * delegates the turn itself to `onSend` (缺省走 sendChatStream), which resolves
 * with the terminal frame the host reported. Nothing is auto-closed: Escape,
 * the header ✕, or a pointer down outside close it — and closing mid-turn
 * calls `onCancel`.
 *
 * @param opts 见 ChatDialogOpts 各字段说明。
 * @returns 面板句柄（见 ChatDialogHandle）。
 */
function mountChatDialog(opts: ChatDialogOpts): ChatDialogHandle {
	injectChatCss();
	const petId = opts.petId;
	const petName = opts.petName || petId;
	const chatBase = opts.baseUrl ?? "/dsh-pet-7340/chat";
	const streamUrl = chatBase + "/stream?pet=" + encodeURIComponent(petId);
	const onSend = opts.onSend;
	const onCancel = opts.onCancel;
	const onClose = opts.onClose;
	const size = Number(opts.size) > 0 ? Number(opts.size) : 462;
	/** 极简输入条（气泡式聊天）：只显示输入框那一行，其余块由 CSS 隐藏 */
	const compact = opts.compact === true;
	const root = document.createElement("div");
	root.className = compact ? "dsh-pet-chat is-compact" : "dsh-pet-chat";
	root.style.setProperty("--pet-size", size + "px");
	const head = document.createElement("div");
	head.className = "dsh-pet-chat-head";
	const dot = document.createElement("span");
	dot.className = "dsh-pet-chat-dot";
	const nameEl = document.createElement("div");
	nameEl.className = "dsh-pet-chat-name";
	nameEl.textContent = petName;
	const closeBtn = document.createElement("button");
	closeBtn.className = "dsh-pet-chat-x";
	closeBtn.type = "button";
	closeBtn.title = "关闭";
	closeBtn.textContent = "✕";
	head.appendChild(dot);
	head.appendChild(nameEl);
	head.appendChild(closeBtn);
	const log = document.createElement("div");
	log.className = "dsh-pet-chat-log";
	const compose = document.createElement("div");
	compose.className = "dsh-pet-chat-compose";
	const input = document.createElement("textarea");
	input.className = "dsh-pet-chat-input";
	input.placeholder = "说点什么… 回车发送";
	input.maxLength = 2e3;
	input.rows = 1;
	const sendBtn = document.createElement("button");
	sendBtn.className = "dsh-pet-chat-send";
	sendBtn.type = "button";
	sendBtn.textContent = "发送";
	compose.appendChild(input);
	compose.appendChild(sendBtn);
	root.appendChild(head);
	root.appendChild(log);
	root.appendChild(compose);
	document.body.appendChild(root);
	let measureCtx: CanvasRenderingContext2D | null = null;
	const measureText = (text: string): number => {
		// 非空断言与原实现一致：拿不到 2d 上下文时原样抛错（不静默换一套布局算法）
		const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"))!;
		ctx.font = getComputedStyle(input).font;
		return ctx.measureText(text).width;
	};
	// 落位状态（提前声明：fitWidth 在挂载早期就会被调用，那时还没有 reposition）
	let dragFrom: DragOrigin | null = null; // 标题栏拖动中（拖动时不抢用户的手去重夹）
	let placed: { x: number; y: number } | null = null; // 最近一次落位期望（渲染层给的坐标，窗口坐标）
	let widthCap = Number.POSITIVE_INFINITY; // 渲染层给的收窄上限（屏幕边缘碰撞）
	let heightCap = Number.POSITIVE_INFINITY; // 渲染层给的高度上限（可视区装不下时，面板内部滚动）
	/** 可视矩形（窗口坐标）：渲染层每次落位前刷新；缺失时回落整个窗口视口 */
	const viewport = (): VisibleRect => window.__dshPetVisibleRect ?? {
		x0: 0,
		y0: 0,
		x1: window.innerWidth,
		y1: window.innerHeight
	};
	/** 就地落位：按可视矩形夹取 —— 面板绝不出屏（屏幕边缘碰撞的最后一道保险）
	 *  @param x 期望左缘 · @param y 期望上缘
	 *  @param sizeHint 调用方已知的面板尺寸：给了就不再量（渲染层拖动时每帧都调本函数，
	 *    逐帧 getBoundingClientRect 会强制同步布局） */
	function applyPlace(x: number, y: number, sizeHint?: PanelSize): void {
		const rr = sizeHint ?? root.getBoundingClientRect();
		const vp = viewport();
		root.style.left = Math.max(vp.x0 + CHAT_EDGE_PAD, Math.min(x, vp.x1 - rr.width - CHAT_EDGE_PAD)) + "px";
		root.style.top = Math.max(vp.y0 + CHAT_EDGE_PAD, Math.min(y, vp.y1 - rr.height - CHAT_EDGE_PAD)) + "px";
	}
	/** 尺寸变化（回放/新消息/收窄）后就地重夹：面板变宽变高也不能越出可视区 */
	function reclampAfterResize(): void {
		if (placed && !dragFrom) applyPlace(placed.x, placed.y);
	}
	/** 面板期望宽度 = 最长一行的像素宽（钳在 [CHAT_MIN_W, CHAT_MAX_W]）；宠物越小面板越窄 */
	const desiredWidth = (): number => {
		const cap = Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, Math.round(size * .72)));
		let widest = 0;
		for (const row of log.children) {
			const text = row.textContent || "";
			for (const line of text.split("\n")) {
				const w = measureText(line);
				if (w > widest) widest = w;
			}
		}
		widest = Math.max(widest, measureText(input.placeholder), measureText(petName));
		return Math.max(CHAT_MIN_W, Math.min(Math.ceil(widest + CHAT_H_PAD), cap));
	};
	const fitWidth = (): void => {
		if (compact) {
			// 极简输入条：宽度跟着输入文本走（160 → 340），超出就在框内折行
			const want = Math.ceil(measureText(input.value || input.placeholder)) + CHAT_COMPACT_PAD;
			const cap = widthCap === Number.POSITIVE_INFINITY
				? CHAT_COMPACT_MAX_W
				: Math.max(CHAT_COMPACT_MIN_W, Math.min(CHAT_COMPACT_MAX_W, widthCap));
			root.style.width = Math.max(CHAT_COMPACT_MIN_W, Math.min(want, cap)) + "px";
			reclampAfterResize();
			return;
		}
		const want = desiredWidth();
		root.style.width = (widthCap === Number.POSITIVE_INFINITY
			? want
			: Math.max(CHAT_TIGHT_MIN_W, Math.min(want, widthCap))) + "px";
		reclampAfterResize();
	};
	/** 输入框自增高（随内容换行长高，封顶后内部滚动） */
	const resizeInput = (): void => {
		input.style.height = "auto";
		input.style.height = Math.min(Math.max(input.scrollHeight, 22), 120) + "px";
	};
	const atBottom = (): boolean => log.scrollHeight - log.scrollTop - log.clientHeight < 36;
	const toBottom = (): void => {
		log.scrollTop = log.scrollHeight;
	};
	/** 追加一条消息泡；role: 'me' | 'pet' */
	const append = (role: 'me' | 'pet', text: string): HTMLElement => {
		const row = document.createElement("div");
		row.className = "dsh-pet-chat-msg " + (role === "me" ? "me" : "pet");
		const bubble = document.createElement("span");
		bubble.textContent = text;
		row.appendChild(bubble);
		log.appendChild(row);
		toBottom();
		fitWidth();
		return row;
	};
	/** 回放宿主的历史（打开面板时）：条数与单条长度都收口 */
	const restore = (messages: Array<{ role: string; text: string }>): void => {
		if (!Array.isArray(messages) || messages.length === 0) return;
		const tail = messages.slice(-CHAT_HISTORY_MAX);
		for (const m of tail) {
			if (!m || typeof m.text !== "string" || m.text === "") continue;
			const text = m.text.length > CHAT_HISTORY_TEXT_MAX ? m.text.slice(0, CHAT_HISTORY_TEXT_MAX) + "…" : m.text;
			append(m.role === "user" ? "me" : "pet", text);
		}
	};
	// 状态行（思考/工具）：一条原地替换的灰字，出现流式文本即消失
	let statusEl: HTMLElement | null = null;
	const setStatus = (text: string): void => {
		if (!statusEl) {
			statusEl = document.createElement("div");
			statusEl.className = "dsh-pet-chat-status";
			log.appendChild(statusEl);
		}
		statusEl.textContent = text;
		toBottom();
		fitWidth();
	};
	const clearStatus = (): void => {
		if (statusEl) {
			statusEl.remove();
			statusEl = null;
		}
	};
	// 会话内的上一条用户消息（重试用）：本轮结束后 + 下一条发送前都保留
	let lastUserText = "";
	let closed = false;
	/** 面板已收起但回合仍在跑（气泡模式）：DOM 操作一律跳过，回调照常。 */
	let detached = false;
	let busy = false;
	let finished = false;
	let aborter: AbortController | null = null;
	/** 一次回合的流式对象：pet 气泡 + 光标 */
	let streamRow: HTMLElement | null = null;
	let streamBubble: Node | null = null;
	const endTurn = (): void => {
		if (streamRow) streamRow.classList.remove("streaming");
		streamRow = null;
		streamBubble = null;
	};
	const setBusy = (flag: boolean): void => {
		busy = flag;
		dot.classList.toggle("busy", flag);
		dot.classList.toggle("err", false);
		sendBtn.textContent = flag ? "停止" : "发送";
		sendBtn.classList.toggle("stop", flag);
		sendBtn.disabled = !flag && input.value.trim() === "";
		input.placeholder = flag ? "正在回复… 可继续输入" : "说点什么… 回车发送";
	};
	/** 结算一条失败：红字 + 「重试」（重试 = 再发一次上一条用户消息） */
	const showError = (message: string): void => {
		clearStatus();
		endTurn();
		dot.classList.remove("busy");
		dot.classList.add("err");
		const row = document.createElement("div");
		row.className = "dsh-pet-chat-err";
		const label = document.createElement("span");
		label.textContent = message;
		const retry = document.createElement("button");
		retry.className = "dsh-pet-chat-retry";
		retry.type = "button";
		retry.textContent = "重试";
		retry.addEventListener("click", () => {
			row.remove();
			dot.classList.remove("err");
			if (lastUserText) void doSend(lastUserText, true);
		});
		row.appendChild(label);
		row.appendChild(retry);
		log.appendChild(row);
		toBottom();
		fitWidth();
	};
	/** 跑一个回合：接管流式事件 → 结算 */
	const doSend = async (text: string, isRetry: boolean): Promise<void> => {
		if (closed || busy) return;
		const outgoing = text.trim();
		if (!outgoing) return;
		lastUserText = outgoing;
		finished = false;
		input.value = "";
		resizeInput();
		if (!isRetry) append("me", outgoing);
		log.querySelectorAll(".dsh-pet-chat-err").forEach((el) => el.remove());
		dot.classList.remove("err");
		setBusy(true);
		setStatus("正在思考…");
		const controller = new AbortController();
		aborter = controller;
		let reply = "";
		const run = onSend
			? onSend(outgoing, { signal: controller.signal })
			: sendChatStream(streamUrl, outgoing, (frame: ChatFrame) => handleFrame(frame), { signal: controller.signal });
		const handleFrame = (frame: ChatFrame): void => {
			if (closed || !frame) return;
			const type = frame.type;
			// 先记状态：终帧标记与已拼文本跟 DOM 无关，面板收起了也照记（排障/冒烟读它们）
			if (type === "delta") reply = typeof frame.text === "string" ? frame.text : "";
			else if (type === "final") {
				finished = true;
				if (typeof frame.text === "string" && frame.text !== "") reply = frame.text;
			} else if (type === "error") finished = true;
			// 面板已收起（气泡模式）：DOM 一概不碰——那边由渲染层自己驱动气泡
			if (detached) return;
			if (type === "status") {
				if (!reply) setStatus(frame.text ?? "");
				return;
			}
			if (type === "reasoning") {
				if (!reply) setStatus("正在思考…");
				return;
			}
			if (type === "tool") {
				if (!reply) setStatus("正在执行 " + (frame.name || "工具") + (frame.detail ? " " + frame.detail : "") + "…");
				return;
			}
			if (type === "delta") {
				const next = reply;
				if (!streamRow) {
					clearStatus();
					streamRow = append("pet", next);
					streamRow.classList.add("streaming");
					streamBubble = streamRow.firstChild;
				} else {
					const stick = atBottom();
					streamBubble!.textContent = next;
					if (stick) toBottom();
					fitWidth();
				}
			}
		};
		try {
			const result = await run;
			if (closed) return;
			if (!detached && streamRow && result && typeof result.reply === "string" && result.reply !== "") {
				streamBubble!.textContent = result.reply;
			}
			if (result && result.ok) {
				if (!detached) {
					clearStatus();
					endTurn();
					dot.classList.remove("busy");
					dot.classList.remove("err");
				}
				// 面板收起了也照常回调：气泡模式下这句回复由渲染层展示
				if (opts.onReply) opts.onReply(result.reply || reply);
			} else if (result && result.aborted) {
				if (!detached) {
					clearStatus();
					endTurn();
					dot.classList.remove("busy");
					setStatus("已停止");
				}
			} else {
				// 失败行：宿主给的消息本身可能已经带了前缀（如「尚未配置模型：…」），
				// 这里只在**它没有**时才补前缀——否则会出现「未配置模型：尚未配置模型：…」。
				// 注意「尚未配置模型」里的「未」是「尚未」与「未配置模型」共用的那个字
				// （尚·未·配·置·模·型），所以判定必须写成 (尚未)?(未)?配置模型，
				// 写成 (尚未)?未配置模型 的话两种情况都匹配不上（踩过）。
				const raw = (result && (result.message || result.reason)) || "";
				const prefix = result && result.reason === "provider-missing" ? "未配置模型：" : "对话失败：";
				const already = prefix === "未配置模型：" ? /^(尚未)?(未)?配置模型/.test(raw) : /^对话失败/.test(raw);
				const message = already ? raw : prefix + (raw || (prefix === "未配置模型：" ? "右键 → 设置" : "未知原因"));
				if (!detached) showError(message);
			}
		} catch (e) {
			if (closed) return;
			if (!detached) showError("对话异常：" + String(e && (e as Error).message ? (e as Error).message : e));
		} finally {
			aborter = null;
			if (!closed && !detached) {
				setBusy(false);
				sendBtn.disabled = input.value.trim() === "";
				input.focus();
			}
		}
	};
	// 关闭前先停掉在飞的回合（宿主收到连接关闭也会取消，这里显式停更干脆）
	const abortInFlight = (): void => {
		if (!aborter) return;
		const controller = aborter;
		aborter = null;
		try {
			controller.abort();
		} catch { /* 已中止 */ }
		if (onCancel) onCancel();
	};
	const close = (): void => {
		if (closed) return;
		closed = true;
		abortInFlight();
		teardownDom();
		if (onClose) onClose();
	};
	/** 拆 DOM 与文档级监听（close / detach 共用；不动在飞回合）。 */
	const teardownDom = (): void => {
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		document.removeEventListener("mousemove", onDragMove, true);
		document.removeEventListener("mouseup", onDragEnd, true);
		root.remove();
	};
	/**
	 * 收起面板但保留在飞回合（气泡模式：面板只当输入框，答案走头顶气泡）。
	 * 与 close 的差别只有一处——**不 abort**；DOM/监听/onClose 完全一致，
	 * 所以外壳的穿透守卫、漫游冻结、尺寸订阅都会照常复原。
	 */
	const detach = (): void => {
		if (closed || detached) return;
		detached = true;
		teardownDom();
		if (onClose) onClose();
	};
	const onDocPointerDown = (e: MouseEvent): void => {
		if (closed) return;
		if (root.contains(e.target as Node)) return;
		close();
	};
	const onDocKeyDown = (e: KeyboardEvent): void => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	// 标题栏拖动：面板是窗口内 DOM，可以拖到顺手的位置；宠物再动时渲染层会重新落位
	// （所以这里不做「拖过就不再跟随」的闩锁——跟随是这块面板的既定行为）
	const onDragMove = (e: MouseEvent): void => {
		if (!dragFrom) return;
		const from = dragFrom;
		const rr = root.getBoundingClientRect();
		const vp = viewport();
		const left = Math.max(vp.x0 + CHAT_EDGE_PAD, Math.min(from.left + (e.clientX - from.x), vp.x1 - rr.width - CHAT_EDGE_PAD));
		const top = Math.max(vp.y0 + CHAT_EDGE_PAD, Math.min(from.top + (e.clientY - from.y), vp.y1 - rr.height - CHAT_EDGE_PAD));
		root.style.left = left + "px";
		root.style.top = top + "px";
	};
	const onDragEnd = (): void => {
		dragFrom = null;
		document.removeEventListener("mousemove", onDragMove, true);
		document.removeEventListener("mouseup", onDragEnd, true);
		if (opts.onMoved) opts.onMoved();
	};
	head.addEventListener("mousedown", (e: MouseEvent) => {
		if (e.button !== 0 || e.target === closeBtn) return;
		e.preventDefault();
		const rr = root.getBoundingClientRect();
		dragFrom = {
			x: e.clientX,
			y: e.clientY,
			left: rr.left,
			top: rr.top
		};
		document.addEventListener("mousemove", onDragMove, true);
		document.addEventListener("mouseup", onDragEnd, true);
	});
	closeBtn.addEventListener("click", () => close());
	input.addEventListener("input", () => {
		resizeInput();
		if (compact) fitWidth(); // 极简输入条：一边打字一边变宽（面板模式宽度由记录决定，不必逐键重算）
		sendBtn.disabled = !busy && input.value.trim() === "";
	});
	input.addEventListener("keydown", (e: KeyboardEvent) => {
		// 输入法组合中的 Enter 是选字，不是发送
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			if (!busy) void doSend(input.value, false);
		}
	});
	sendBtn.addEventListener("click", () => {
		if (busy) {
			abortInFlight();
			setStatus("已停止");
			setBusy(false);
			return;
		}
		void doSend(input.value, false);
	});
	fitWidth();
	resizeInput();
	/** 落位：记录期望坐标（尺寸变化后据此重夹），并立即按可视矩形夹取 */
	const reposition = (x: number, y: number, sizeHint?: PanelSize): void => {
		placed = { x, y };
		applyPlace(x, y, sizeHint);
	};
	/**
	 * 尺寸上限（屏幕边缘碰撞时渲染层给的"这一侧/这一段还剩多少"）。
	 * 逐帧调用是常态：两个值都没变就直接返回（fitWidth 要逐行量文字，不便宜）。
	 * @param maxWidth 宽度上限（px）；undefined/非法值 = 恢复按内容定宽
	 * @param maxHeight 高度上限（px）；undefined/非法值 = 不封顶（面板过高时由 log 内部滚动承担）
	 */
	const limit = (maxWidth?: number, maxHeight?: number): void => {
		const nextW = typeof maxWidth === "number" && Number.isFinite(maxWidth) && maxWidth > 0
			? Math.floor(maxWidth)
			: Number.POSITIVE_INFINITY;
		const nextH = typeof maxHeight === "number" && Number.isFinite(maxHeight) && maxHeight > 0
			? Math.floor(maxHeight)
			: Number.POSITIVE_INFINITY;
		if (nextW === widthCap && nextH === heightCap) return;
		widthCap = nextW;
		if (nextH !== heightCap) {
			heightCap = nextH;
			if (nextH === Number.POSITIVE_INFINITY) root.style.maxHeight = "";
			else root.style.maxHeight = nextH + "px";
		}
		fitWidth();
	};
	reposition(opts.x ?? 8, opts.y ?? 8);
	setBusy(false);
	sendBtn.disabled = true;
	input.focus();
	return {
		el: root,
		close,
		detach,
		restore,
		append,
		isBusy: () => busy,
		reposition,
		limit,
		/** 本轮是否已经收到宿主终帧（排障/冒烟用） */
		isFinished: () => finished
	};
}

export { sendChat, sendChatStream, CHAT_CSS, mountChatDialog }
