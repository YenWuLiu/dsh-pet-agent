var PetShared = (function(exports) {

"use strict";

//#region src/shared/constants.ts
const CANVAS_H = 360;
const FEET_Y = 330;
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
const DRAG_THRESHOLD = 5;
const PET_REF_WIDTH = 462;

//#endregion
//#region src/shared/pickers.ts
const pick = (pool, exclude) => {
	const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
	const src = entries.length ? entries : pool;
	return src[Math.floor(Math.random() * src.length)];
};
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
const pickWeightedCategory = (categories, facing) => {
	const cats = categories.filter((c) => c.actions.length > 0);
	if (!cats.length) return null;
	const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
	const eligible = filtered.length ? filtered : cats;
	const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
	let t = Math.random() * totalW;
	for (const c of eligible) {
		t -= c.weight;
		if (t <= 0) return c;
	}
	return eligible[eligible.length - 1];
};
const rollKind = (roll, w) => {
	const topEnd = (w.idle + w.turn + w.move) / 100;
	if (roll < w.idle / 100) return "idle";
	if (roll < (w.idle + w.turn) / 100) return "turn";
	if (roll < topEnd) return "move";
	return "action";
};
const pickCategoryAction = (categories, idlePool, facing, current) => {
	const cat = pickWeightedCategory(categories, facing);
	if (!cat) return {
		id: "FALLBACK",
		name: pick(idlePool, current)
	};
	return {
		id: cat.id,
		name: pick(cat.actions, current)
	};
};

//#endregion
//#region src/shared/motion.ts
const planMove = (o) => {
	const side = o.sideAllow ?? 0;
	const distance = randomBetween(o.minDist, o.maxDist);
	const target = o.cx + o.dir * distance;
	const leftBound = o.margin + o.halfW - side;
	const rightBound = o.W - o.margin - o.halfW + side;
	if (target < leftBound || target > rightBound) return null;
	return {
		startRatio: o.cx / o.W,
		startYRatio: o.cy / o.H,
		targetRatio: target / o.W,
		totalRatio: Math.abs(target - o.cx) / o.W
	};
};
const anchorPixel = (o) => {
	const height = o.size * 9 / 16;
	switch (o.corner) {
		case "top-left": return {
			x: o.marginX,
			y: o.marginY
		};
		case "top-right": return {
			x: o.W - o.size - o.marginX,
			y: o.marginY
		};
		case "bottom-left": return {
			x: o.marginX,
			y: o.H - height - o.marginY
		};
		case "bottom-right": return {
			x: o.W - o.size - o.marginX,
			y: o.H - height - o.marginY
		};
	}
};

//#endregion
//#region src/shared/balance.ts
const TIMEOUT_MS$2 = 2e4;
const RETRIES$1 = 2;
/** 带超时 + 重试的 GET（host 已内置重试，这里再兜底网络抖动）。
*  浏览器传默认相对路径；桌面模式（Electron，file:// 页面）传绝对 URL。 */
async function getWithRetry$1(url) {
	let last;
	for (let i = 0; i <= RETRIES$1; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS$2) });
			if (res.ok) return res;
			last = new Error("HTTP " + res.status);
		} catch (e) {
			last = e;
		}
		if (i < RETRIES$1) await new Promise((r) => setTimeout(r, 600));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
async function fetchBalanceState(baseUrl = "/dsh-pet-7340/balance") {
	const res = await getWithRetry$1(baseUrl);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 余额响应非法");
	const provider = String(raw.provider ?? "unknown");
	if (raw.ok !== true) {
		const reason = raw.reason === "unsupported" || raw.reason === "credential-missing" || raw.reason === "fetch-error" ? raw.reason : "fetch-error";
		return {
			provider,
			ok: false,
			reason,
			message: typeof raw.message === "string" ? raw.message : void 0
		};
	}
	if (raw.kind === "opencode") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet: opencode 数据非法");
		const rolling = Number(d.rolling);
		const weekly = Number(d.weekly);
		const monthly = Number(d.monthly);
		if (![
			rolling,
			weekly,
			monthly
		].every(Number.isFinite)) throw new Error("dsh-pet: opencode 百分比非数字");
		return {
			provider,
			kind: "opencode",
			ok: true,
			rolling,
			weekly,
			monthly,
			rollingResetsAt: typeof d.rollingResetsAt === "string" ? d.rollingResetsAt : void 0,
			weeklyResetsAt: typeof d.weeklyResetsAt === "string" ? d.weeklyResetsAt : void 0,
			monthlyResetsAt: typeof d.monthlyResetsAt === "string" ? d.monthlyResetsAt : void 0
		};
	}
	if (raw.kind === "deepseek") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet: deepseek 数据非法");
		return {
			provider,
			kind: "deepseek",
			ok: true,
			currency: typeof d.currency === "string" ? d.currency : void 0,
			total: typeof d.total === "string" ? d.total : void 0,
			granted: typeof d.granted === "string" ? d.granted : void 0,
			toppedUp: typeof d.toppedUp === "string" ? d.toppedUp : void 0
		};
	}
	throw new Error("dsh-pet: 余额 kind 非法");
}
async function fetchTriggerCount(baseUrl = "/dsh-pet-7340/balance/trigger") {
	const res = await fetch(baseUrl, { cache: "no-store" });
	if (!res.ok) return -1;
	const data = await res.json().catch(() => null);
	return data && typeof data.count === "number" ? data.count : -1;
}
const DEEPSEEK_FULL_BALANCE_CNY = 20;
function balancePercent(v) {
	if (v.kind === "opencode") return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
	if (v.kind === "deepseek") {
		const total = Number(v.total);
		if (!Number.isFinite(total)) return void 0;
		const remaining = Math.max(0, total) / DEEPSEEK_FULL_BALANCE_CNY * 100;
		return Math.max(0, Math.min(100, 100 - remaining));
	}
	return void 0;
}
function balanceEventIndex(p) {
	if (p === 100) return 5;
	const i = Math.floor(p / 20);
	return i < 5 ? i : 4;
}
const OPENCODE_QUOTA_USD = {
	rolling: 12,
	weekly: 30,
	monthly: 60
};
const WINDOW_LABELS = {
	rolling: "5h",
	weekly: "周",
	monthly: "月"
};
function urgentWindow(v) {
	if (v.kind !== "opencode") return void 0;
	const windows = [
		"rolling",
		"weekly",
		"monthly"
	];
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	let best;
	for (const w of windows) {
		const percent = v[w] ?? 0;
		const quota = OPENCODE_QUOTA_USD[w];
		const remaining = quota * (100 - percent) / 100;
		const cand = {
			label: WINDOW_LABELS[w],
			percent,
			quotaUsd: quota,
			remainingUsd: remaining,
			resetsAt: resets[w]
		};
		if (best === void 0 || remaining < best.remainingUsd) best = cand;
	}
	return best;
}
function resetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return (Math.round(hoursF / 24 * 10) / 10).toFixed(1) + " 天";
	return Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小时";
}
function deepseekPricingTier(now = new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		hourCycle: "h23"
	}).formatToParts(now);
	const pick$1 = (type) => parts.find((p) => p.type === type)?.value;
	const weekday = pick$1("weekday");
	const hour = Number(pick$1("hour"));
	if (weekday === "Sat" || weekday === "Sun") return "idle";
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "idle";
}
function balanceBubbleView(state) {
	if (state.ok) {
		if (state.kind === "opencode") {
			const w = urgentWindow(state);
			if (w) {
				const reset = resetInText(w.resetsAt);
				const rows = [{
					role: "label",
					text: w.label + "额度已用 " + Math.round(w.percent) + "%"
				}, {
					role: "sub",
					text: reset ? reset + "重置" : "已重置"
				}];
				return rows;
			}
			return [{
				role: "label",
				text: "额度数据不可用"
			}];
		}
		const tier = deepseekPricingTier();
		return [
			{
				role: "label",
				text: "余额（"
			},
			{
				role: "tier",
				tier,
				text: tier === "peak" ? "峰" : "谷"
			},
			{
				role: "label",
				text: "）¥" + (state.total ?? "-")
			}
		];
	}
	const msg = state.reason === "unsupported" ? "当前服务商暂不支持余额查询" : state.reason === "credential-missing" ? "缺少凭证：" + (state.message ?? "") : "余额查询失败";
	return [{
		role: "error",
		text: msg
	}];
}

//#endregion
//#region src/shared/whisper.ts
const TIMEOUT_MS$1 = 3e4;
const RETRIES = 2;
/** 带超时 + 重试的 GET（host 生成 LLM 调用可能较慢，超时放宽；桌面 file:// 页面需绝对 URL） */
async function getWithRetry(url) {
	let last;
	for (let i = 0; i <= RETRIES; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS$1) });
			if (res.ok) return res;
			last = new Error("HTTP " + res.status);
		} catch (e) {
			last = e;
		}
		if (i < RETRIES) await new Promise((r) => setTimeout(r, 800));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
async function fetchWhisperState(baseUrl = "/dsh-pet-7340/whisper") {
	const res = await getWithRetry(baseUrl);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 碎碎念响应非法");
	if (raw.ok !== true) return {
		ok: false,
		reason: raw.reason === "provider-missing" ? "provider-missing" : "generate-error",
		message: typeof raw.message === "string" ? raw.message : void 0
	};
	const text = typeof raw.text === "string" ? raw.text.trim() : "";
	const ts = Number(raw.ts);
	if (!text || !Number.isFinite(ts)) throw new Error("dsh-pet: 碎碎念数据非法");
	return {
		ok: true,
		text,
		ts
	};
}
function fetchWhisperTrigger(baseUrl = "/dsh-pet-7340/whisper/trigger") {
	return fetchWhisperState(baseUrl);
}
function whisperBubbleView(state) {
	if (state.ok) return [{
		role: "label",
		text: state.text
	}];
	const msg = state.reason === "provider-missing" ? "当前对话未配置模型，碎碎念不可用" : "碎碎念生成失败" + (state.message ? "：" + state.message : "");
	return [{
		role: "label",
		text: msg
	}];
}

//#endregion
//#region src/shared/config.ts
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
const isWebVisible = (display) => display === "web" || display === "both";
const isDesktopVisible = (display) => display === "desktop" || display === "both";
function flattenConfigPets(merged) {
	const out = [];
	for (const [entry, conf] of Object.entries(merged)) {
		const list = Array.isArray(conf?.pets) ? conf.pets : [];
		for (const p of list) out.push({
			...p,
			animations: conf.animations,
			animationWeights: conf.animationWeights,
			eventsRefreshSec: conf.eventsRefreshSec,
			physics: conf.physics,
			workStatusTexts: conf.workStatusTexts,
			assetRoot: entry,
			extra: entry !== "main"
		});
	}
	return out;
}

//#endregion
//#region src/shared/notify.ts
const NOTIFY_ICONS = {
	done: "notify-done",
	error: "notify-error",
	truncated: "notify-truncated",
	approval: "notify-approval",
	question: "notify-question",
	test: "notify-test"
};
const MAX_BODY = 80;
function truncate(text) {
	return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
}
function frameToToast(frame) {
	switch (frame.type) {
		case "session/event": {
			const ev = frame.event ?? {};
			if (ev.type !== "turn/end") return null;
			const kind = ev.data?.reason?.kind;
			if (kind === "completed") return {
				title: "对话完成",
				body: "",
				icon: NOTIFY_ICONS.done
			};
			if (kind === "error") return {
				title: "生成失败",
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS.error
			};
			if (kind === "max-tokens") return {
				title: "输出被截断",
				body: "已达到输出 token 上限",
				icon: NOTIFY_ICONS.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: "正在申请权限",
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: "模型在等你回答",
				body: q,
				icon: NOTIFY_ICONS.question
			};
		}
		case "host/agent-error": return {
			title: "生成失败",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS.error
		};
		default: return null;
	}
}

//#endregion
//#region src/shared/menu.ts
/** 事件名 → 分类标签（无映射时用事件名本身） */
const EVENT_LABELS = {
	balance: "余额档位",
	whisper: "碎碎念",
	workStatus: "工作状态"
};
const leaf = (anim) => ({
	label: anim,
	anim
});
function buildMenuTree(animations) {
	const groups = [];
	const pools = [
		["待机", animations.idle],
		["转向", animations.turn],
		["拖拽", animations.drag],
		["点击回应", animations.clicks],
		["移动", animations.moves.actions.map((m) => m.name)]
	];
	for (const [label, pool] of pools) if (pool.length) groups.push({
		label,
		children: pool.map(leaf)
	});
	const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
	for (const c of cats) groups.push({
		label: c.id,
		children: c.actions.map(leaf)
	});
	const events = animations.events ?? {};
	for (const key of Object.keys(events)) {
		const pool = events[key] ?? [];
		if (pool.length) groups.push({
			label: EVENT_LABELS[key] ?? key,
			children: pool.map(leaf)
		});
	}
	if (!groups.length) return [];
	return [{
		label: "动作",
		children: groups
	}];
}
function isNoMirrorAnimation(categories, anim) {
	return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
const MENU_CSS = [
	".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
	"font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
	".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
	".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:240px;padding:4px;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
	"box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto}",
	".dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
	"gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
	".dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}",
	".dsh-pet-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}"
].join("");
function isBranchNode(n) {
	return "children" in n && Array.isArray(n.children);
}
function mountContextMenu(opts) {
	const { tree, x, y, onAction, onClose } = opts;
	const root = document.createElement("div");
	root.className = "dsh-pet-menu";
	root.style.left = "0px";
	root.style.top = "0px";
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	/**
	* 可视矩形（视口坐标）：桌面模式的窗口比屏幕大出宠物四周外扩余量——
	* 宠物贴屏幕边缘时窗口有一部分在屏幕外，按 window.innerWidth/Height 钳制
	* 会把面板定位到不可见区。渲染端在打开菜单前写入 window.__dshPetVisibleRect
	* （屏幕工作区 ∩ 窗口）；浏览器/无该全局时回落整窗视口。
	*/
	const viewport = () => {
		const v = window.__dshPetVisibleRect;
		if (v && Number.isFinite(v.x1) && Number.isFinite(v.y1)) return v;
		return {
			x0: 0,
			y0: 0,
			x1: window.innerWidth,
			y1: window.innerHeight
		};
	};
	let closed = false;
	/** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
	const openChild = new Map();
	/** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
	let leaveTimer = null;
	/** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
	const hideChain = (panel) => {
		panel.style.display = "none";
		const child = openChild.get(panel);
		if (child) {
			openChild.delete(panel);
			hideChain(child);
		}
	};
	/** 把面板显示在触发项旁边：右缘展开，贴右/下边缘自动翻转夹取（可视矩形坐标） */
	const showPanel = (panel, item) => {
		const rect = item.getBoundingClientRect();
		const vp$1 = viewport();
		panel.style.left = "";
		panel.style.top = "";
		panel.style.display = "block";
		let left = rect.right + 4;
		if (left + panel.offsetWidth > vp$1.x1 - 4) left = rect.left - panel.offsetWidth - 4;
		left = Math.max(vp$1.x0 + 4, left);
		let top = rect.top;
		if (top + panel.offsetHeight > vp$1.y1 - 4) top = Math.max(vp$1.y0 + 4, vp$1.y1 - 4 - panel.offsetHeight);
		panel.style.left = left + "px";
		panel.style.top = top + "px";
	};
	/** 构建一层面板（nodes 列表）；分支项的子面板**平级**挂到 root 下，不嵌套。
	*  面板自身先入 DOM、子面板随后入 → 层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
	const buildPanel = (nodes) => {
		const panel = document.createElement("div");
		panel.className = "dsh-pet-menu-column";
		panel.style.display = "none";
		root.appendChild(panel);
		for (const node of nodes) {
			const item = document.createElement("div");
			item.className = "dsh-pet-menu-item";
			if (isBranchNode(node)) {
				item.classList.add("dsh-pet-menu-branch");
				const label = document.createElement("span");
				label.textContent = node.label;
				const arrow = document.createElement("span");
				arrow.className = "dsh-pet-menu-arrow";
				arrow.textContent = "▸";
				item.appendChild(label);
				item.appendChild(arrow);
				const childPanel = buildPanel(node.children);
				item.addEventListener("mouseenter", () => {
					const prev = openChild.get(panel);
					if (prev && prev !== childPanel) hideChain(prev);
					openChild.set(panel, childPanel);
					showPanel(childPanel, item);
				});
			} else {
				const label = document.createElement("span");
				label.textContent = node.label;
				item.appendChild(label);
				item.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					close();
					onAction(node);
				});
			}
			panel.appendChild(item);
		}
		return panel;
	};
	const rootPanel = buildPanel(tree);
	rootPanel.style.display = "block";
	document.body.appendChild(root);
	rootPanel.style.left = "";
	rootPanel.style.top = "";
	const rw = rootPanel.offsetWidth;
	const rh = rootPanel.offsetHeight;
	const vp = viewport();
	rootPanel.style.left = Math.max(vp.x0 + 4, Math.min(x, vp.x1 - rw - 4)) + "px";
	rootPanel.style.top = Math.max(vp.y0 + 4, Math.min(y, vp.y1 - rh - 4)) + "px";
	root.addEventListener("mouseleave", () => {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = window.setTimeout(() => {
			leaveTimer = null;
			close();
		}, 200);
	});
	root.addEventListener("mouseover", () => {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	});
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const close = () => {
		if (closed) return;
		closed = true;
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/chat.ts
const SEND_TIMEOUT_MS = 6e4;
async function sendChat(baseUrl, text) {
	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 对话响应非法");
	const o = raw;
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
 * @param {string} baseUrl - the `/chat/stream` endpoint (pet id already baked in).
 * @param {string} text - the user's message.
 * @param {(frame: object) => void} onFrame - synchronous per-frame sink.
 * @param {{signal?: AbortSignal}} [opts] - abort to drop the connection (the
 *   host cancels the in-flight turn when the stream closes).
 * @returns {Promise<{ok: boolean, reply?: string, ts?: number, reason?: string,
 *   message?: string, aborted?: boolean}>} the terminal summary.
 */
async function sendChatStream(baseUrl, text, onFrame, opts) {
	const signal = opts && opts.signal ? opts.signal : void 0;
	let res;
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
	let outcome = null;
	const handleLine = (line) => {
		const trimmed = line.trim();
		if (trimmed === "") return;
		let frame;
		try {
			frame = JSON.parse(trimmed);
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
	"font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;",
	"user-select:none}",
	".dsh-pet-chat *{box-sizing:border-box}",
	// 标题栏（拖动把手）：名字 + 状态点 + 关闭按钮
	".dsh-pet-chat-head{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 11px;",
	"border-bottom:1px solid rgba(0,0,0,.07);cursor:move;flex:0 0 auto}",
	".dsh-pet-chat-dot{width:7px;height:7px;border-radius:50%;background:#9aa4b2;flex:0 0 auto}",
	".dsh-pet-chat-dot.busy{background:#4a7dff;animation:dsh-pet-chat-pulse 1.1s ease-in-out infinite}",
	".dsh-pet-chat-dot.err{background:#d94f3d}",
	"@keyframes dsh-pet-chat-pulse{0%,100%{opacity:1}50%{opacity:.25}}",
	".dsh-pet-chat-name{flex:1 1 auto;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
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
/** 历史回放上限：条数与单条长度都收口，避免回放把面板撑爆 */
const CHAT_HISTORY_MAX = 12;
const CHAT_HISTORY_TEXT_MAX = 400;
let chatCssInjected = false;
function injectChatCss() {
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
 * delegates the turn itself to `onSend`, which resolves with the terminal
 * frame the host reported. Nothing is auto-closed: Escape, the header ✕, or a
 * pointer down outside close it — and closing mid-turn calls `onCancel`.
 *
 * @param {object} opts - see the field docs below.
 * @returns {{el: HTMLElement, close: () => void, restore: (messages: Array) => void,
 *   append: (role: string, text: string) => void, isBusy: () => boolean,
 *   reposition: (x: number, y: number) => void}} the panel handle.
 */
function mountChatDialog(opts) {
	injectChatCss();
	const petId = opts.petId;
	const petName = opts.petName || petId;
	const chatBase = opts.baseUrl ?? "/dsh-pet-7340/chat";
	const withPet = chatBase + "?pet=" + encodeURIComponent(petId);
	const streamUrl = chatBase + "/stream?pet=" + encodeURIComponent(petId);
	const cancelUrl = chatBase + "/cancel?pet=" + encodeURIComponent(petId);
	const onSend = opts.onSend;
	const onCancel = opts.onCancel;
	const onClose = opts.onClose;
	let size = Number(opts.size) > 0 ? Number(opts.size) : 462;
	const root = document.createElement("div");
	root.className = "dsh-pet-chat";
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
	input.placeholder = "说点什么…（Enter 发送）";
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
	let measureCtx = null;
	const measureText = (text) => {
		const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
		ctx.font = getComputedStyle(input).font;
		return ctx.measureText(text).width;
	};
	/** 面板宽度 = 最长一行的像素宽（钳在 [CHAT_MIN_W, CHAT_MAX_W]）；宠物越小面板越窄 */
	const fitWidth = () => {
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
		root.style.width = Math.max(CHAT_MIN_W, Math.min(Math.ceil(widest + CHAT_H_PAD), cap)) + "px";
	};
	/** 输入框自增高（随内容换行长高，封顶后内部滚动） */
	const resizeInput = () => {
		input.style.height = "auto";
		input.style.height = Math.min(Math.max(input.scrollHeight, 22), 120) + "px";
	};
	const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 36;
	const toBottom = () => {
		log.scrollTop = log.scrollHeight;
	};
	/** 追加一条消息泡；role: 'me' | 'pet' */
	const append = (role, text) => {
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
	const restore = (messages) => {
		if (!Array.isArray(messages) || messages.length === 0) return;
		const tail = messages.slice(-CHAT_HISTORY_MAX);
		for (const m of tail) {
			if (!m || typeof m.text !== "string" || m.text === "") continue;
			const text = m.text.length > CHAT_HISTORY_TEXT_MAX ? m.text.slice(0, CHAT_HISTORY_TEXT_MAX) + "…" : m.text;
			append(m.role === "user" ? "me" : "pet", text);
		}
	};
	// 状态行（思考/工具）：一条原地替换的灰字，出现流式文本即消失
	let statusEl = null;
	const setStatus = (text) => {
		if (!statusEl) {
			statusEl = document.createElement("div");
			statusEl.className = "dsh-pet-chat-status";
			log.appendChild(statusEl);
		}
		statusEl.textContent = text;
		toBottom();
		fitWidth();
	};
	const clearStatus = () => {
		if (statusEl) {
			statusEl.remove();
			statusEl = null;
		}
	};
	// 会话内的上一条用户消息（重试用）：本轮结束后 + 下一条发送前都保留
	let lastUserText = "";
	let closed = false;
	let busy = false;
	let finished = false;
	let aborter = null;
	/** 一次回合的流式对象：pet 气泡 + 光标 */
	let streamRow = null;
	let streamBubble = null;
	const endTurn = () => {
		if (streamRow) streamRow.classList.remove("streaming");
		streamRow = null;
		streamBubble = null;
	};
	const setBusy = (flag) => {
		busy = flag;
		dot.classList.toggle("busy", flag);
		dot.classList.toggle("err", false);
		sendBtn.textContent = flag ? "停止" : "发送";
		sendBtn.classList.toggle("stop", flag);
		sendBtn.disabled = !flag && input.value.trim() === "";
		input.placeholder = flag ? "正在回复…（可继续输入）" : "说点什么…（Enter 发送）";
	};
	/** 结算一条失败：红字 + 「重试」（重试 = 再发一次上一条用户消息） */
	const showError = (message) => {
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
	const doSend = async (text, isRetry) => {
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
			: sendChatStream(streamUrl, outgoing, (frame) => handleFrame(frame), { signal: controller.signal });
		const handleFrame = (frame) => {
			if (closed || !frame) return;
			const type = frame.type;
			if (type === "status") {
				if (!reply) setStatus(frame.text);
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
				const next = typeof frame.text === "string" ? frame.text : "";
				if (!streamRow) {
					clearStatus();
					streamRow = append("pet", next);
					streamRow.classList.add("streaming");
					streamBubble = streamRow.firstChild;
				} else {
					const stick = atBottom();
					streamBubble.textContent = next;
					if (stick) toBottom();
					fitWidth();
				}
				reply = next;
				return;
			}
			if (type === "final") {
				finished = true;
				if (typeof frame.text === "string" && frame.text !== "") reply = frame.text;
				return;
			}
			if (type === "error") {
				finished = true;
			}
		};
		try {
			const result = await run;
			if (closed) return;
			if (streamRow && result && typeof result.reply === "string" && result.reply !== "") {
				streamBubble.textContent = result.reply;
			}
			if (result && result.ok) {
				clearStatus();
				endTurn();
				dot.classList.remove("busy");
				dot.classList.remove("err");
				if (opts.onReply) opts.onReply(result.reply || reply);
			} else if (result && result.aborted) {
				clearStatus();
				endTurn();
				dot.classList.remove("busy");
				setStatus("已停止");
			} else {
				const message = result && result.reason === "provider-missing"
					? "未配置模型：" + (result.message || "右键 → 设置")
					: "对话失败：" + ((result && (result.message || result.reason)) || "未知原因");
				showError(message);
			}
		} catch (e) {
			if (closed) return;
			showError("对话异常：" + String(e && e.message ? e.message : e));
		} finally {
			aborter = null;
			if (!closed) {
				setBusy(false);
				sendBtn.disabled = input.value.trim() === "";
				input.focus();
			}
		}
	};
	// 关闭前先停掉在飞的回合（宿主收到连接关闭也会取消，这里显式停更干脆）
	const abortInFlight = () => {
		if (!aborter) return;
		const controller = aborter;
		aborter = null;
		try {
			controller.abort();
		} catch { /* 已中止 */ }
		if (onCancel) onCancel();
	};
	const close = () => {
		if (closed) return;
		closed = true;
		abortInFlight();
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		document.removeEventListener("mousemove", onDragMove, true);
		document.removeEventListener("mouseup", onDragEnd, true);
		root.remove();
		if (onClose) onClose();
	};
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	// 标题栏拖动：面板是窗口内 DOM，拖到想看的位置（松手后不再随宠物移动）
	let dragFrom = null;
	const onDragMove = (e) => {
		if (!dragFrom) return;
		const rr = root.getBoundingClientRect();
		const vp = window.__dshPetVisibleRect ?? {
			x0: 0,
			y0: 0,
			x1: window.innerWidth,
			y1: window.innerHeight
		};
		const left = Math.max(vp.x0 + 4, Math.min(dragFrom.left + (e.clientX - dragFrom.x), vp.x1 - rr.width - 4));
		const top = Math.max(vp.y0 + 4, Math.min(dragFrom.top + (e.clientY - dragFrom.y), vp.y1 - rr.height - 4));
		root.style.left = left + "px";
		root.style.top = top + "px";
	};
	const onDragEnd = () => {
		dragFrom = null;
		document.removeEventListener("mousemove", onDragMove, true);
		document.removeEventListener("mouseup", onDragEnd, true);
		if (opts.onMoved) opts.onMoved(); // 用户摆过位置：放弃「跟随宠物」
	};
	head.addEventListener("mousedown", (e) => {
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
		sendBtn.disabled = !busy && input.value.trim() === "";
	});
	input.addEventListener("keydown", (e) => {
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
	/** 定位：优先贴 x/y，超出可视矩形夹回（宠物贴屏幕边时面板不出屏） */
	const reposition = (x, y) => {
		const rr = root.getBoundingClientRect();
		const vp = window.__dshPetVisibleRect ?? {
			x0: 0,
			y0: 0,
			x1: window.innerWidth,
			y1: window.innerHeight
		};
		root.style.left = Math.max(vp.x0 + 4, Math.min(x, vp.x1 - rr.width - 4)) + "px";
		root.style.top = Math.max(vp.y0 + 4, Math.min(y, vp.y1 - rr.height - 4)) + "px";
	};
	reposition(opts.x ?? 8, opts.y ?? 8);
	setBusy(false);
	sendBtn.disabled = true;
	input.focus();
	return {
		el: root,
		close,
		restore,
		append,
		isBusy: () => busy,
		reposition,
		/** 本轮是否已经收到宿主终帧（排障/冒烟用） */
		isFinished: () => finished
	};
}

//#endregion
//#region src/shared/physics.ts
const SPRING_K = 200;
const SPRING_C = 30;
const TRAIL_KEEP_MS = 200;
const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 500;
const MAX_THROW_SPEED = 3600;
const PEAK_WEIGHT = .5;
const ACCEL_REF = 8e3;
const ACCEL_GAIN_MAX = .6;
const GRAVITY = 1400;
const RESTITUTION = .78;
const GROUND_FRICTION = 2.5;
const DEFAULT_PHYSICS = {
	gravity: GRAVITY,
	restitution: RESTITUTION,
	groundFriction: GROUND_FRICTION,
	ceilingBounce: true,
	throwPower: 1,
	petCollision: false
};
const DEFAULT_THROW_POWER = 1;
const REST_VY = 40;
const REST_VX = 15;
const MAX_STEP_DT = .05;
const SQ_SQUASH = .55;
const SQ_DURATION_MS = 220;
const SQ_SOFT_SPEED = 300;
const SQ_HARD_SPEED = 1500;
const SQ_MAX_SQUASH = .55;
const landingSquash = (impactSpeed) => {
	const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
	return Math.min(.8, 1 - t * (1 - SQ_MAX_SQUASH));
};
const squashScale = (u, squash = SQ_SQUASH) => {
	if (u < .45) {
		const p$1 = u / .45;
		return 1 - (1 - squash) * p$1 * p$1;
	}
	const p = (u - .45) / .55;
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
	return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
const throwBounds = (o) => {
	const h = o.size * 9 / 16;
	return {
		minX: -o.sideAllow,
		minY: 0,
		maxX: o.W - o.size + o.sideAllow,
		maxY: o.H - h
	};
};
const trimTrail = (trail, now) => {
	const cutoff = now - TRAIL_KEEP_MS;
	let i = 0;
	while (i < trail.length && trail[i].t < cutoff) i++;
	return i === 0 ? trail : trail.slice(i);
};
const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
const softClampSpeed = (speed) => {
	if (speed <= 0) return 0;
	return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
const estimateReleaseVelocity = (trail, now, physics = DEFAULT_PHYSICS) => {
	if (trail.length === 0) return null;
	const last = trail[trail.length - 1];
	if (now - last.t > RELEASE_STALE_MS) return null;
	const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
	if (win.length < 2) return null;
	const t0 = win[0].t;
	const x0 = win[0].x;
	const y0 = win[0].y;
	const t1 = win[win.length - 1].t;
	const x1 = win[win.length - 1].x;
	const y1 = win[win.length - 1].y;
	const spanMs = t1 - t0;
	if (spanMs < MIN_SPAN_MS) return null;
	const baseVx = (x1 - x0) / spanMs * 1e3;
	const baseVy = (y1 - y0) / spanMs * 1e3;
	const baseSpeed = Math.hypot(baseVx, baseVy);
	if (baseSpeed < 1e-6) return null;
	const segSpeeds = [];
	let px = x0;
	let py = y0;
	let pt = t0;
	for (const s of win.slice(1)) {
		const dt = s.t - pt;
		if (dt >= SEG_MIN_DT_MS) {
			segSpeeds.push({
				speed: Math.hypot(s.x - px, s.y - py) / dt * 1e3,
				tEnd: s.t
			});
			px = s.x;
			py = s.y;
			pt = s.t;
		}
	}
	const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
	let accel = 0;
	if (segSpeeds.length >= 2) {
		const lastSeg = segSpeeds[segSpeeds.length - 1];
		const firstSeg = segSpeeds[0];
		accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1e3, MIN_SPAN_MS / 1e3);
	}
	const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
	const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
	if (speed < DEAD_ZONE_SPEED) return null;
	return {
		vx: baseVx / baseSpeed * speed,
		vy: baseVy / baseSpeed * speed
	};
};
const throwStep = (s, dtRaw, b, physics = DEFAULT_PHYSICS) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	let { x, y, vx, vy } = s;
	vy += physics.gravity * dt;
	x += vx * dt;
	y += vy * dt;
	let bounced = false;
	if (x < b.minX) {
		x = b.minX;
		vx = Math.abs(vx) * physics.restitution;
		bounced = true;
	} else if (x > b.maxX) {
		x = b.maxX;
		vx = -Math.abs(vx) * physics.restitution;
		bounced = true;
	}
	if (y < b.minY) {
		if (physics.ceilingBounce) {
			y = b.minY;
			vy = Math.abs(vy) * physics.restitution;
			bounced = true;
		}
	} else if (y >= b.maxY) {
		y = b.maxY;
		vx *= Math.max(0, 1 - physics.groundFriction * dt);
		if (Math.abs(vy) < REST_VY) vy = 0;
		else vy = -Math.abs(vy) * physics.restitution;
		bounced = true;
	}
	const speed = Math.hypot(vx, vy);
	const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;
	return {
		x,
		y,
		vx,
		vy,
		bounced,
		atRest
	};
};
const PET_BOUNCE_E = .995;
const bodyPixelBox = (o) => {
	const h = o.size * 9 / 16;
	return {
		left: o.x + HIT_BOX.x0 / 640 * o.size,
		top: o.y + o.bottomPad + HIT_BOX.y0 / 360 * h,
		right: o.x + HIT_BOX.x1 / 640 * o.size,
		bottom: o.y + o.bottomPad + HIT_BOX.y1 / 360 * h
	};
};
const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const collidePet = (fly, hit) => {
	const hf = fly.size * 9 / 16 / 2;
	const hh = hit.size * 9 / 16 / 2;
	const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
	const cy = hit.y + hh - (fly.y + hf);
	const dist = Math.hypot(cx, cy);
	if (dist < 1e-6) return null;
	const nx = cx / dist;
	const ny = cy / dist;
	const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
	if (vrel <= 0) return null;
	const e = PET_BOUNCE_E;
	const m1 = fly.size * fly.size;
	const m2 = hit.size * hit.size;
	const v1n = fly.vx * nx + fly.vy * ny;
	const v2n = hit.vx * nx + hit.vy * ny;
	const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
	const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
	return {
		fvx: fly.vx - v1n * nx + v1n2 * nx,
		fvy: fly.vy - v1n * ny + v1n2 * ny,
		hvx: hit.vx - v2n * nx + v2n2 * nx,
		hvy: hit.vy - v2n * ny + v2n2 * ny
	};
};

//#endregion
//#region src/shared/score.ts
const SCORE_MIN_SPEED = 400;
/** 每 100 px/s 记 1 分（基准尺寸 462px 下） */
const SCORE_SPEED_PER_POINT = 100;
const clickScore = (speed, size) => {
	if (speed <= 0 || size <= 0) return 0;
	return Math.max(1, Math.round(speed / SCORE_SPEED_PER_POINT * (PET_REF_WIDTH / size)));
};

//#endregion
//#region src/shared/score-popup.ts
const SCORE_POPUP_DURATION_MS = 2200;
const SCORE_POPUP_CSS = [
	".dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
	"background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
	"font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;}",
	".dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}",
	".dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
	".dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
	".dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
	".dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
	"@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}"
].join("");
/** 粒子只注入一次（同 CHAT_CSS 的 injectChatCss 模式） */
let scoreCssInjected = false;
function injectScoreCss() {
	if (scoreCssInjected || typeof document === "undefined") return;
	scoreCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/score";
	tag.textContent = SCORE_POPUP_CSS;
	document.head.appendChild(tag);
}
/** 粒子数量 */
const BURST_COUNT = 20;
/** 初速范围（px/s） */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** 重力（px/s²）：粒子向上喷出后回落 */
const BURST_GRAVITY = 700;
/** 单粒子寿命范围（ms） */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** 粒子半径范围（px） */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** 暖色盘（积分/庆祝感） */
const BURST_COLORS = [
	"#ffb300",
	"#ff8f00",
	"#ff7043",
	"#f4511e",
	"#ffc400",
	"#ffd54f",
	"#ef5350"
];
function spawnScoreBurst(x, y) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	injectScoreCss();
	const root = document.createElement("div");
	root.className = "dsh-pet-score-burst";
	document.body.appendChild(root);
	const parts = [];
	for (let i = 0; i < BURST_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
		const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
		const el = document.createElement("div");
		el.className = "dsh-pet-score-particle";
		el.style.left = x + "px";
		el.style.top = y + "px";
		el.style.width = r * 2 + "px";
		el.style.height = r * 2 + "px";
		el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
		root.appendChild(el);
		parts.push({
			el,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 80,
			t0: performance.now(),
			life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN)
		});
	}
	const step = () => {
		const now = performance.now();
		let alive = false;
		for (const p of parts) {
			const tSec = (now - p.t0) / 1e3;
			const lifeRatio = (now - p.t0) / p.life;
			if (lifeRatio >= 1) continue;
			alive = true;
			p.el.style.transform = "translate(" + p.vx * tSec + "px," + (p.vy * tSec + .5 * BURST_GRAVITY * tSec * tSec) + "px)";
			p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
		}
		if (alive) requestAnimationFrame(step);
		else root.remove();
	};
	requestAnimationFrame(step);
}
function mountScorePopup(opts) {
	injectScoreCss();
	const x = opts.x;
	const y = opts.y;
	const root = document.createElement("div");
	root.className = "dsh-pet-score";
	const val = document.createElement("div");
	val.className = "dsh-pet-score-val";
	val.textContent = "+" + opts.score;
	const sub = document.createElement("div");
	sub.className = "dsh-pet-score-sub";
	sub.textContent = "速度 " + Math.round(opts.speed) + " · 大小 " + Math.round(opts.size);
	root.appendChild(val);
	root.appendChild(sub);
	document.body.appendChild(root);
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + "px";
	root.style.top = Math.max(4, y - rr.height - 14) + "px";
	root.offsetWidth;
	root.classList.add("is-in");
	let closed = false;
	let timer = null;
	const close = () => {
		if (closed) return;
		closed = true;
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (opts.onClose) opts.onClose();
	};
	const mountedAt = performance.now();
	let graceConsumed = false;
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (!graceConsumed) {
			graceConsumed = true;
			if (e.timeStamp - mountedAt < 300) return;
		}
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	timer = window.setTimeout(close, SCORE_POPUP_DURATION_MS);
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/work-status.ts
const WORK_STATUS_STATES = [
	"thinking",
	"working",
	"result",
	"waiting",
	"success",
	"error"
];
const WORK_STATUS_INDEX = {
	thinking: 0,
	working: 1,
	result: 2,
	waiting: 3,
	success: 4,
	error: 5
};
const TIMEOUT_MS = 1e4;
async function fetchWorkStatus(baseUrl = "/dsh-pet-7340/work-status") {
	const res = await fetch(baseUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error("dsh-pet: work-status HTTP " + res.status);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: work-status 响应非法");
	const state = raw.state === null || WORK_STATUS_STATES.includes(raw.state) ? raw.state : null;
	return {
		state,
		task: typeof raw.task === "string" ? raw.task : null,
		ts: Number(raw.ts) || 0
	};
}

//#endregion
exports.ACCEL_GAIN_MAX = ACCEL_GAIN_MAX
exports.ACCEL_REF = ACCEL_REF
exports.CANVAS_H = CANVAS_H
exports.CHAT_CSS = CHAT_CSS
exports.DEAD_ZONE_SPEED = DEAD_ZONE_SPEED
exports.DEEPSEEK_FULL_BALANCE_CNY = DEEPSEEK_FULL_BALANCE_CNY
exports.DEFAULT_PHYSICS = DEFAULT_PHYSICS
exports.DEFAULT_THROW_POWER = DEFAULT_THROW_POWER
exports.DRAG_THRESHOLD = DRAG_THRESHOLD
exports.FEET_Y = FEET_Y
exports.GRAVITY = GRAVITY
exports.GROUND_FRICTION = GROUND_FRICTION
exports.HIT_BOX = HIT_BOX
exports.MAX_BODY = MAX_BODY
exports.MAX_STEP_DT = MAX_STEP_DT
exports.MAX_THROW_SPEED = MAX_THROW_SPEED
exports.MENU_CSS = MENU_CSS
exports.MIN_SPAN_MS = MIN_SPAN_MS
exports.NOTIFY_ICONS = NOTIFY_ICONS
exports.OPENCODE_QUOTA_USD = OPENCODE_QUOTA_USD
exports.PEAK_WEIGHT = PEAK_WEIGHT
exports.PET_BOUNCE_E = PET_BOUNCE_E
exports.PET_DISPLAYS = PET_DISPLAYS
exports.PET_REF_WIDTH = PET_REF_WIDTH
exports.RELEASE_STALE_MS = RELEASE_STALE_MS
exports.RELEASE_WINDOW_MS = RELEASE_WINDOW_MS
exports.RESTITUTION = RESTITUTION
exports.REST_VX = REST_VX
exports.REST_VY = REST_VY
exports.SCORE_MIN_SPEED = SCORE_MIN_SPEED
exports.SCORE_POPUP_CSS = SCORE_POPUP_CSS
exports.SCORE_POPUP_DURATION_MS = SCORE_POPUP_DURATION_MS
exports.SEG_MIN_DT_MS = SEG_MIN_DT_MS
exports.SPRING_C = SPRING_C
exports.SPRING_K = SPRING_K
exports.SQ_DURATION_MS = SQ_DURATION_MS
exports.SQ_HARD_SPEED = SQ_HARD_SPEED
exports.SQ_MAX_SQUASH = SQ_MAX_SQUASH
exports.SQ_SOFT_SPEED = SQ_SOFT_SPEED
exports.SQ_SQUASH = SQ_SQUASH
exports.TRAIL_KEEP_MS = TRAIL_KEEP_MS
exports.WINDOW_LABELS = WINDOW_LABELS
exports.WORK_STATUS_INDEX = WORK_STATUS_INDEX
exports.WORK_STATUS_STATES = WORK_STATUS_STATES
exports.anchorPixel = anchorPixel
exports.balanceBubbleView = balanceBubbleView
exports.balanceEventIndex = balanceEventIndex
exports.balancePercent = balancePercent
exports.bodyPixelBox = bodyPixelBox
exports.buildMenuTree = buildMenuTree
exports.clickScore = clickScore
exports.collidePet = collidePet
exports.deepseekPricingTier = deepseekPricingTier
exports.estimateReleaseVelocity = estimateReleaseVelocity
exports.fetchBalanceState = fetchBalanceState
exports.fetchTriggerCount = fetchTriggerCount
exports.fetchWhisperState = fetchWhisperState
exports.fetchWhisperTrigger = fetchWhisperTrigger
exports.fetchWorkStatus = fetchWorkStatus
exports.flattenConfigPets = flattenConfigPets
exports.frameToToast = frameToToast
exports.isDesktopVisible = isDesktopVisible
exports.isNoMirrorAnimation = isNoMirrorAnimation
exports.isWebVisible = isWebVisible
exports.landingSquash = landingSquash
exports.mountChatDialog = mountChatDialog
exports.mountContextMenu = mountContextMenu
exports.mountScorePopup = mountScorePopup
exports.pick = pick
exports.pickCategoryAction = pickCategoryAction
exports.pickWeightedCategory = pickWeightedCategory
exports.planMove = planMove
exports.randomBetween = randomBetween
exports.rectsOverlap = rectsOverlap
exports.resetInText = resetInText
exports.rollKind = rollKind
exports.sendChat = sendChat
exports.sendChatStream = sendChatStream
exports.spawnScoreBurst = spawnScoreBurst
exports.springStep = springStep
exports.squashScale = squashScale
exports.throwBounds = throwBounds
exports.throwStep = throwStep
exports.trimTrail = trimTrail
exports.truncate = truncate
exports.urgentWindow = urgentWindow
exports.whisperBubbleView = whisperBubbleView
return exports;
})({});