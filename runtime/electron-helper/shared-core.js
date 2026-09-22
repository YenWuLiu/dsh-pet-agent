"use strict";
var PetShared = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // shell/index.ts
  var index_exports = {};
  __export(index_exports, {
    ACCEL_GAIN_MAX: () => ACCEL_GAIN_MAX,
    ACCEL_REF: () => ACCEL_REF,
    ANIMATION_EXT: () => ANIMATION_EXT,
    BUBBLE_MAX_MS: () => BUBBLE_MAX_MS,
    BUBBLE_MIN_MS: () => BUBBLE_MIN_MS,
    BUBBLE_MS_PER_CHAR: () => BUBBLE_MS_PER_CHAR,
    BUBBLE_PAGE_CHARS: () => BUBBLE_PAGE_CHARS,
    BUBBLE_PAGE_MAX: () => BUBBLE_PAGE_MAX,
    BUBBLE_QUEUE_MAX: () => BUBBLE_QUEUE_MAX,
    BubbleQueue: () => BubbleQueue,
    CANVAS_H: () => CANVAS_H,
    CHAT_CSS: () => CHAT_CSS,
    DEAD_ZONE_SPEED: () => DEAD_ZONE_SPEED,
    DEEPSEEK_FULL_BALANCE_CNY: () => DEEPSEEK_FULL_BALANCE_CNY,
    DEFAULT_PHYSICS: () => DEFAULT_PHYSICS,
    DEFAULT_THROW_POWER: () => DEFAULT_THROW_POWER,
    DRAG_THRESHOLD: () => DRAG_THRESHOLD,
    FEET_Y: () => FEET_Y,
    GRAVITY: () => GRAVITY,
    GROUND_FRICTION: () => GROUND_FRICTION,
    HIT_BOX: () => HIT_BOX,
    MAX_BODY: () => MAX_BODY,
    MAX_STEP_DT: () => MAX_STEP_DT,
    MAX_THROW_SPEED: () => MAX_THROW_SPEED,
    MEME_BUBBLE_CLASS: () => MEME_BUBBLE_CLASS,
    MEME_BUBBLE_CSS: () => MEME_BUBBLE_CSS,
    MEME_IMG_CLASS: () => MEME_IMG_CLASS,
    MENU_CSS: () => MENU_CSS,
    MIN_SPAN_MS: () => MIN_SPAN_MS,
    NOTIFY_ICONS: () => NOTIFY_ICONS,
    OPENCODE_QUOTA_USD: () => OPENCODE_QUOTA_USD,
    PEAK_WEIGHT: () => PEAK_WEIGHT,
    PET_BOUNCE_E: () => PET_BOUNCE_E,
    PET_DISPLAYS: () => PET_DISPLAYS,
    PET_REF_WIDTH: () => PET_REF_WIDTH,
    RELEASE_STALE_MS: () => RELEASE_STALE_MS,
    RELEASE_WINDOW_MS: () => RELEASE_WINDOW_MS,
    RESTITUTION: () => RESTITUTION,
    REST_VX: () => REST_VX,
    REST_VY: () => REST_VY,
    SCORE_MIN_SPEED: () => SCORE_MIN_SPEED,
    SCORE_POPUP_CSS: () => SCORE_POPUP_CSS,
    SCORE_POPUP_DURATION_MS: () => SCORE_POPUP_DURATION_MS,
    SEG_MIN_DT_MS: () => SEG_MIN_DT_MS,
    SPRING_C: () => SPRING_C,
    SPRING_K: () => SPRING_K,
    SQ_DURATION_MS: () => SQ_DURATION_MS,
    SQ_HARD_SPEED: () => SQ_HARD_SPEED,
    SQ_MAX_SQUASH: () => SQ_MAX_SQUASH,
    SQ_SOFT_SPEED: () => SQ_SOFT_SPEED,
    SQ_SQUASH: () => SQ_SQUASH,
    TRAIL_KEEP_MS: () => TRAIL_KEEP_MS,
    WINDOW_LABELS: () => WINDOW_LABELS,
    WORK_STATUS_INDEX: () => WORK_STATUS_INDEX,
    WORK_STATUS_STATES: () => WORK_STATUS_STATES,
    anchorPixel: () => anchorPixel,
    balanceBubbleView: () => balanceBubbleView,
    balanceEventIndex: () => balanceEventIndex,
    balancePercent: () => balancePercent,
    bodyPixelBox: () => bodyPixelBox,
    boundingRect: () => boundingRect,
    bubbleDwellMs: () => bubbleDwellMs,
    buildMenuTree: () => buildMenuTree,
    clampPointInRect: () => clampPointInRect,
    clampPointToRegion: () => clampPointToRegion,
    clickScore: () => clickScore,
    collidePet: () => collidePet,
    createMemeImage: () => createMemeImage,
    decideBalanceNotice: () => decideBalanceNotice,
    deepseekPricingTier: () => deepseekPricingTier,
    distToRectSq: () => distToRectSq,
    estimateReleaseVelocity: () => estimateReleaseVelocity,
    fetchBalanceState: () => fetchBalanceState,
    fetchTriggerCount: () => fetchTriggerCount,
    fetchWhisperState: () => fetchWhisperState,
    fetchWhisperTrigger: () => fetchWhisperTrigger,
    fetchWorkStatus: () => fetchWorkStatus,
    flattenConfigPets: () => flattenConfigPets,
    frameToToast: () => frameToToast,
    indexAtPoint: () => indexAtPoint,
    injectMemeBubbleCss: () => injectMemeBubbleCss,
    isDesktopVisible: () => isDesktopVisible,
    isEventAnim: () => isEventAnim,
    isNoMirrorAnimation: () => isNoMirrorAnimation,
    isWebVisible: () => isWebVisible,
    landingSquash: () => landingSquash,
    memeImageUrl: () => memeImageUrl,
    mountChatDialog: () => mountChatDialog,
    mountContextMenu: () => mountContextMenu2,
    mountScorePopup: () => mountScorePopup,
    nearestIndex: () => nearestIndex,
    nextWorkStatusAnim: () => nextWorkStatusAnim,
    pick: () => pick,
    pickCategoryAction: () => pickCategoryAction,
    pickSlot: () => pickSlot,
    pickWeightedCategory: () => pickWeightedCategory,
    placeChatPanel: () => placeChatPanel,
    planMove: () => planMove,
    pointInRect: () => pointInRect,
    poolIncludes: () => poolIncludes,
    randomBetween: () => randomBetween,
    rectAtPoint: () => rectAtPoint,
    rectBottom: () => rectBottom,
    rectRight: () => rectRight,
    rectsOverlap: () => rectsOverlap,
    regionArea: () => regionArea,
    regionHoleRatio: () => regionHoleRatio,
    resetInText: () => resetInText,
    resolveRect: () => resolveRect,
    rollKind: () => rollKind,
    screenOfBox: () => screenOfBox,
    sendChat: () => sendChat,
    sendChatStream: () => sendChatStream,
    slotIncludes: () => slotIncludes,
    spawnScoreBurst: () => spawnScoreBurst,
    splitBubbleText: () => splitBubbleText,
    springStep: () => springStep,
    squashScale: () => squashScale,
    throwBounds: () => throwBounds,
    throwBoundsIn: () => throwBoundsIn,
    throwSpace: () => throwSpace,
    throwStep: () => throwStep,
    throwStepRegion: () => throwStepRegion,
    translateRects: () => translateRects,
    trimTrail: () => trimTrail,
    truncate: () => truncate,
    urgentWindow: () => urgentWindow,
    whisperBubbleView: () => whisperBubbleView
  });

  // shell/shared/constants.ts
  var CANVAS_H = 360;
  var FEET_Y = 330;
  var HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };
  var DRAG_THRESHOLD = 5;
  var PET_REF_WIDTH = 462;
  var ANIMATION_EXT = ".webm";

  // shell/shared/pickers.ts
  var pick = (pool, exclude) => {
    const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
    const src = entries.length ? entries : pool;
    return src[Math.floor(Math.random() * src.length)];
  };
  var pickSlot = (slot, exclude) => {
    if (typeof slot === "string") return slot;
    const entries = exclude === void 0 ? slot : slot.filter((n) => n !== exclude);
    const src = entries.length ? entries : slot;
    return src[Math.floor(Math.random() * src.length)];
  };
  var slotIncludes = (slot, anim) => typeof slot === "string" ? slot === anim : slot.includes(anim);
  var poolIncludes = (pool, anim) => pool.some((slot) => slotIncludes(slot, anim));
  var isEventAnim = (events, anim) => events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;
  var nextWorkStatusAnim = (pool, current) => {
    const idx = pool.findIndex((slot2) => slotIncludes(slot2, current));
    if (idx === -1) return null;
    const slot = pool[idx];
    if (!Array.isArray(slot) || slot.length <= 1) return null;
    return pickSlot(slot, current);
  };
  var randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
  var pickWeightedCategory = (categories, facing) => {
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
  var rollKind = (roll, w) => {
    const topEnd = (w.idle + w.turn + w.move) / 100;
    if (roll < w.idle / 100) return "idle";
    if (roll < (w.idle + w.turn) / 100) return "turn";
    if (roll < topEnd) return "move";
    return "action";
  };
  var pickCategoryAction = (categories, idlePool, facing, current) => {
    const cat = pickWeightedCategory(categories, facing);
    if (!cat) return { id: "FALLBACK", name: pick(idlePool, current) };
    return { id: cat.id, name: pick(cat.actions, current) };
  };

  // shell/shared/displays.ts
  var rectRight = (r) => r.x + r.width;
  var rectBottom = (r) => r.y + r.height;
  var boundingRect = (rects) => {
    if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, rectRight(r));
      y1 = Math.max(y1, rectBottom(r));
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  var pointInRect = (r, x, y) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
  var rectAtPoint = (rects, x, y) => {
    for (const r of rects) if (pointInRect(r, x, y)) return r;
    return null;
  };
  var indexAtPoint = (rects, x, y) => {
    for (let i = 0; i < rects.length; i++) if (pointInRect(rects[i], x, y)) return i;
    return -1;
  };
  var distToRectSq = (r, x, y) => {
    const dx = Math.max(r.x - x, 0, x - rectRight(r));
    const dy = Math.max(r.y - y, 0, y - rectBottom(r));
    return dx * dx + dy * dy;
  };
  var nearestIndex = (rects, x, y) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const d = distToRectSq(rects[i], x, y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  var resolveRect = (rects, x, y) => {
    const hit = rectAtPoint(rects, x, y);
    if (hit) return hit;
    const i = nearestIndex(rects, x, y);
    return i < 0 ? null : rects[i];
  };
  var clampPointInRect = (r, x, y) => ({
    x: Math.min(Math.max(x, r.x), rectRight(r) - 1),
    y: Math.min(Math.max(y, r.y), rectBottom(r) - 1)
  });
  var clampPointToRegion = (rects, x, y) => {
    if (rectAtPoint(rects, x, y)) return { x, y };
    const i = nearestIndex(rects, x, y);
    return i < 0 ? { x, y } : clampPointInRect(rects[i], x, y);
  };
  var regionArea = (rects) => rects.reduce((s, r) => s + r.width * r.height, 0);
  var regionHoleRatio = (rects) => {
    const hull = boundingRect(rects);
    const hullArea = hull.width * hull.height;
    if (hullArea <= 0) return 0;
    return Math.max(0, 1 - regionArea(rects) / hullArea);
  };
  var translateRects = (rects, dx, dy) => rects.map((r) => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }));

  // shell/shared/motion.ts
  var planMove = (o) => {
    const side = o.sideAllow ?? 0;
    const distance = randomBetween(o.minDist, o.maxDist);
    const target = o.cx + o.dir * distance;
    if (o.areas && o.areas.length > 0) {
      const bodyHalf = o.halfW - side;
      if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
      if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
    } else {
      const leftBound = o.margin + o.halfW - side;
      const rightBound = o.W - o.margin - o.halfW + side;
      if (target < leftBound || target > rightBound) return null;
    }
    return {
      startRatio: o.cx / o.W,
      startYRatio: o.cy / o.H,
      targetRatio: target / o.W,
      totalRatio: Math.abs(target - o.cx) / o.W
    };
  };
  var anchorPixel = (o) => {
    const height = o.size * 9 / 16;
    const a = o.area ?? { x: 0, y: 0, width: o.W, height: o.H };
    const left = a.x + o.marginX;
    const top = a.y + o.marginY;
    const right = a.x + a.width - o.size - o.marginX;
    const bottom = a.y + a.height - height - o.marginY;
    switch (o.corner) {
      case "top-left":
        return { x: left, y: top };
      case "top-right":
        return { x: right, y: top };
      case "bottom-left":
        return { x: left, y: bottom };
      case "bottom-right":
        return { x: right, y: bottom };
    }
  };

  // shell/shared/balance.ts
  var TIMEOUT_MS = 2e4;
  var RETRIES = 2;
  async function getWithRetry(url) {
    let last;
    for (let i = 0; i <= RETRIES; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) return res;
        last = new Error("HTTP " + res.status);
      } catch (e) {
        last = e;
      }
      if (i < RETRIES) await new Promise((r) => setTimeout(r, 600));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
  async function fetchBalanceState(baseUrl = "/dsh-pet-7340/balance") {
    const res = await getWithRetry(baseUrl);
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 余额响应非法");
    const provider = String(raw.provider ?? "unknown");
    if (raw.ok !== true) {
      const reason = raw.reason === "unsupported" || raw.reason === "credential-missing" || raw.reason === "fetch-error" ? raw.reason : "fetch-error";
      return { provider, ok: false, reason, message: typeof raw.message === "string" ? raw.message : void 0 };
    }
    if (raw.kind === "opencode") {
      const d = raw.data;
      if (!d || typeof d !== "object") throw new Error("dsh-pet: opencode 数据非法");
      const rolling = Number(d.rolling);
      const weekly = Number(d.weekly);
      const monthly = Number(d.monthly);
      if (![rolling, weekly, monthly].every(Number.isFinite)) throw new Error("dsh-pet: opencode 百分比非数字");
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
  var DEEPSEEK_FULL_BALANCE_CNY = 20;
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
  var OPENCODE_QUOTA_USD = {
    rolling: 12,
    weekly: 30,
    monthly: 60
  };
  var WINDOW_LABELS = {
    rolling: "5h",
    weekly: "周",
    monthly: "月"
  };
  function urgentWindow(v) {
    if (v.kind !== "opencode") return void 0;
    const windows = ["rolling", "weekly", "monthly"];
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
    return Math.max(0.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小时";
  }
  function deepseekPricingTier(now = /* @__PURE__ */ new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23"
      // h23 避免午夜被格式化为 "24:00"
    }).formatToParts(now);
    const pick2 = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = pick2("weekday");
    const hour = Number(pick2("hour"));
    if (weekday === "Sat" || weekday === "Sun") return "idle";
    return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "idle";
  }
  function unavailableRows(state) {
    const rows = state.reason === "unsupported" ? [
      { role: "error", text: "当前服务商暂不支持余额查询" },
      { role: "sub", text: "当前服务商：" + state.provider }
    ] : state.reason === "credential-missing" ? [
      // host 的 message 本身已带「缺少凭证 X」前缀：这里只作次要行原样展示，不再加前缀
      // （曾经的「缺少凭证：缺少凭证 X」双重前缀）
      { role: "error", text: "缺少余额查询凭证" },
      { role: "sub", text: state.message ?? "" }
    ] : [
      { role: "error", text: "余额查询失败" },
      { role: "sub", text: state.message ?? "" }
    ];
    return rows.filter((r) => r.text !== "");
  }
  function balanceBubbleView(state) {
    if (state.ok) {
      if (state.kind === "opencode") {
        const w = urgentWindow(state);
        if (w) {
          const reset = resetInText(w.resetsAt);
          const rows = [
            { role: "label", text: w.label + "额度已用 " + Math.round(w.percent) + "%" },
            { role: "sub", text: reset ? reset + "重置" : "已重置" }
          ];
          return rows;
        }
        return [{ role: "label", text: "额度数据不可用" }];
      }
      const tier = deepseekPricingTier();
      return [
        { role: "label", text: "余额（" },
        { role: "tier", tier, text: tier === "peak" ? "峰" : "谷" },
        { role: "label", text: "）¥" + (state.total ?? "-") }
      ];
    }
    return unavailableRows(state);
  }
  function decideBalanceNotice(state, lastKey, explicit) {
    if (state.ok) return { show: false, key: null };
    const key = state.reason + ":" + state.provider;
    return { show: explicit || key !== lastKey, key };
  }

  // shell/shared/whisper.ts
  var TIMEOUT_MS2 = 3e4;
  var RETRIES2 = 2;
  async function getWithRetry2(url) {
    let last;
    for (let i = 0; i <= RETRIES2; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS2) });
        if (res.ok) return res;
        last = new Error("HTTP " + res.status);
      } catch (e) {
        last = e;
      }
      if (i < RETRIES2) await new Promise((r) => setTimeout(r, 800));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
  async function fetchWhisperState(baseUrl = "/dsh-pet-7340/whisper") {
    const res = await getWithRetry2(baseUrl);
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 碎碎念响应非法");
    if (raw.ok !== true) {
      return {
        ok: false,
        reason: raw.reason === "provider-missing" ? "provider-missing" : "generate-error",
        message: typeof raw.message === "string" ? raw.message : void 0
      };
    }
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    const ts = Number(raw.ts);
    if (!text || !Number.isFinite(ts)) throw new Error("dsh-pet: 碎碎念数据非法");
    const image = typeof raw.image === "string" && raw.image.trim() ? raw.image.trim() : void 0;
    return image ? { ok: true, text, image, ts } : { ok: true, text, ts };
  }
  function memeImageUrl(name, base = "/dsh-pet-7340") {
    return base + "/pic/memes/" + encodeURIComponent(name) + ".png";
  }
  var MEME_IMG_CLASS = "pet-bub-img";
  var MEME_BUBBLE_CLASS = "has-img";
  var MEME_BUBBLE_CSS = [
    ".pet-bub-img{display:block;width:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.34);height:auto;",
    "border-radius:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.026);",
    "margin:0 auto calc(var(--dsh-pet-size,var(--pet-size,462px))*0.017);object-fit:cover;",
    "pointer-events:none;user-select:none}",
    ".pet-bubble.has-img,.dsh-pet-bubble.has-img{min-width:0}"
  ].join("");
  var memeCssInjected = false;
  function injectMemeBubbleCss() {
    if (memeCssInjected || typeof document === "undefined") return;
    memeCssInjected = true;
    if (document.querySelector('style[data-plugin-css="dsh-pet/meme-bubble"]') !== null) return;
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-pet";
    tag.dataset.pluginCss = "dsh-pet/meme-bubble";
    tag.textContent = MEME_BUBBLE_CSS;
    document.head.appendChild(tag);
  }
  function createMemeImage(name, base = "/dsh-pet-7340") {
    const key = String(name ?? "").trim();
    if (!key) return null;
    injectMemeBubbleCss();
    const img = document.createElement("img");
    img.className = MEME_IMG_CLASS;
    img.src = memeImageUrl(key, base);
    img.alt = key;
    return img;
  }
  function fetchWhisperTrigger(baseUrl = "/dsh-pet-7340/whisper/trigger") {
    return fetchWhisperState(baseUrl);
  }
  function whisperBubbleView(state) {
    if (state.ok) return [{ role: "label", text: state.text }];
    const msg = state.reason === "provider-missing" ? "当前对话未配置模型，碎碎念不可用" : "碎碎念生成失败" + (state.message ? "：" + state.message : "");
    return [{ role: "label", text: msg }];
  }

  // shell/shared/config.ts
  var PET_DISPLAYS = ["web", "desktop", "both", "none"];
  var isWebVisible = (display) => display === "web" || display === "both";
  var isDesktopVisible = (display) => display === "desktop" || display === "both";
  function flattenConfigPets(merged) {
    const out = [];
    for (const [entry, conf] of Object.entries(merged)) {
      const list = Array.isArray(conf?.pets) ? conf.pets : [];
      for (const p of list) {
        out.push({
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
    }
    return out;
  }

  // shell/shared/notify.ts
  var NOTIFY_ICONS = {
    done: "notify-done",
    error: "notify-error",
    truncated: "notify-truncated",
    approval: "notify-approval",
    question: "notify-question",
    test: "notify-test"
  };
  var MAX_BODY = 80;
  function truncate(text) {
    return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
  }
  function frameToToast(frame) {
    switch (frame.type) {
      case "session/event": {
        const ev = frame.event ?? {};
        if (ev.type !== "turn/end") return null;
        const kind = ev.data?.reason?.kind;
        if (kind === "completed") return { title: "对话完成", body: "", icon: NOTIFY_ICONS.done };
        if (kind === "error")
          return { title: "生成失败", body: ev.data?.reason?.error?.message ?? "", icon: NOTIFY_ICONS.error };
        if (kind === "max-tokens")
          return { title: "输出被截断", body: "已达到输出 token 上限", icon: NOTIFY_ICONS.truncated };
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
        return { title: "模型在等你回答", body: q, icon: NOTIFY_ICONS.question };
      }
      case "host/agent-error": {
        return {
          title: "生成失败",
          body: typeof frame.message === "string" ? frame.message : "",
          icon: NOTIFY_ICONS.error
        };
      }
      default:
        return null;
    }
  }

  // shell/shared/menu.ts
  var EVENT_LABELS = {
    balance: "余额档位",
    whisper: "碎碎念",
    workStatus: "工作状态"
  };
  var leaf = (anim) => ({ label: anim, anim });
  function buildMenuTree(animations) {
    const groups = [];
    const pools = [
      ["待机", animations.idle],
      ["转向", animations.turn],
      ["拖拽", animations.drag],
      ["点击回应", animations.clicks],
      ["移动", animations.moves.actions.map((m) => m.name)]
    ];
    for (const [label, pool] of pools) {
      if (pool.length) groups.push({ label, children: pool.map(leaf) });
    }
    const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
    for (const c of cats) {
      groups.push({ label: c.id, children: c.actions.map(leaf) });
    }
    const events = animations.events ?? {};
    for (const key of Object.keys(events)) {
      const pool = events[key] ?? [];
      const names = [];
      for (const slot of pool) {
        if (typeof slot === "string") names.push(slot);
        else names.push(...slot);
      }
      if (names.length) groups.push({ label: EVENT_LABELS[key] ?? key, children: names.map(leaf) });
    }
    if (!groups.length) return [];
    return [{ label: "动作", children: groups }];
  }
  function isNoMirrorAnimation(categories, anim) {
    return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
  }
  var MENU_CSS = [
    ".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
    "font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
    ".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
    ".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:240px;padding:4px;",
    "background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
    "box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;",
    // 自定义滚动条：细圆角半透明条（Chromium 系 Chrome/Edge/Electron 走 ::-webkit-scrollbar；
    // Firefox 走 scrollbar-width/scrollbar-color）。thumb 用 border+background-clip 内缩 2px 留白，
    // 与菜单的圆角白底协调；hover 加深并与 item:hover 的蓝呼应。track 透明不抢视觉。
    "scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}",
    ".dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}",
    ".dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}",
    ".dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;",
    "border:2px solid transparent;background-clip:content-box}",
    ".dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);",
    "border:2px solid transparent;background-clip:content-box}",
    ".dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}",
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
    const { tree, x, y, onAction, onClose, clamp } = opts;
    const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const root = document.createElement("div");
    root.className = "dsh-pet-menu";
    root.style.left = "0px";
    root.style.top = "0px";
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    let closed = false;
    const openChild = /* @__PURE__ */ new Map();
    let leaveTimer = null;
    const hideChain = (panel) => {
      panel.style.display = "none";
      const child = openChild.get(panel);
      if (child) {
        openChild.delete(panel);
        hideChain(child);
      }
    };
    const showPanel = (panel, item) => {
      const rect = item.getBoundingClientRect();
      panel.style.left = "";
      panel.style.top = "";
      panel.style.display = "block";
      let left = rect.right + 4;
      if (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;
      left = Math.max(c.x + 4, left);
      let top = rect.top;
      if (top + panel.offsetHeight > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - panel.offsetHeight);
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    };
    const buildPanel = (nodes) => {
      const panel = document.createElement("div");
      panel.className = "dsh-pet-menu-column";
      panel.style.display = "none";
      if (clamp) panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + "px";
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
    rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + "px";
    rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + "px";
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
    return { el: root, close };
  }

  // shell/shared/physics.ts
  var SPRING_K = 200;
  var SPRING_C = 30;
  var TRAIL_KEEP_MS = 200;
  var RELEASE_WINDOW_MS = 150;
  var RELEASE_STALE_MS = 150;
  var MIN_SPAN_MS = 20;
  var SEG_MIN_DT_MS = 8;
  var DEAD_ZONE_SPEED = 500;
  var MAX_THROW_SPEED = 3600;
  var PEAK_WEIGHT = 0.5;
  var ACCEL_REF = 8e3;
  var ACCEL_GAIN_MAX = 0.6;
  var GRAVITY = 1400;
  var RESTITUTION = 0.78;
  var GROUND_FRICTION = 2.5;
  var DEFAULT_PHYSICS = {
    gravity: GRAVITY,
    restitution: RESTITUTION,
    groundFriction: GROUND_FRICTION,
    ceilingBounce: true,
    throwPower: 1,
    petCollision: false
  };
  var DEFAULT_THROW_POWER = 1;
  var REST_VY = 40;
  var REST_VX = 15;
  var MAX_STEP_DT = 0.05;
  var SQ_SQUASH = 0.55;
  var SQ_DURATION_MS = 220;
  var SQ_SOFT_SPEED = 300;
  var SQ_HARD_SPEED = 1500;
  var SQ_MAX_SQUASH = 0.55;
  var landingSquash = (impactSpeed) => {
    const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
    return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
  };
  var squashScale = (u, squash = SQ_SQUASH) => {
    if (u < 0.45) {
      const p2 = u / 0.45;
      return 1 - (1 - squash) * p2 * p2;
    }
    const p = (u - 0.45) / 0.55;
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
  };
  var throwBounds = (o) => {
    const h = o.size * 9 / 16;
    return { minX: -o.sideAllow, minY: 0, maxX: o.W - o.size + o.sideAllow, maxY: o.H - h };
  };
  var throwBoundsIn = (area, size, sideAllow) => {
    const h = size * 9 / 16;
    return {
      minX: area.x - sideAllow,
      minY: area.y,
      maxX: rectRight(area) - size + sideAllow,
      maxY: rectBottom(area) - h
    };
  };
  var throwSpace = (o) => ({
    bounds: o.areas.map((a) => throwBoundsIn(a, o.size, o.sideAllow)),
    areas: o.areas,
    panels: o.panels && o.panels.length === o.areas.length ? o.panels : o.areas,
    // 面板缺失/不同序：退化用工作区（保持旧行为）
    size: o.size,
    sideAllow: o.sideAllow
  });
  var screenOfBox = (space, x, y) => {
    const cx = x + space.size / 2;
    const cy = y + space.size * 9 / 16 / 2;
    const hit = indexAtPoint(space.areas, cx, cy);
    return hit >= 0 ? hit : nearestIndex(space.areas, cx, cy);
  };
  var trimTrail = (trail, now) => {
    const cutoff = now - TRAIL_KEEP_MS;
    let i = 0;
    while (i < trail.length && trail[i].t < cutoff) i++;
    return i === 0 ? trail : trail.slice(i);
  };
  var springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
  var softClampSpeed = (speed) => {
    if (speed <= 0) return 0;
    return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
  };
  var estimateReleaseVelocity = (trail, now, physics = DEFAULT_PHYSICS) => {
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
        segSpeeds.push({ speed: Math.hypot(s.x - px, s.y - py) / dt * 1e3, tEnd: s.t });
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
    return { vx: baseVx / baseSpeed * speed, vy: baseVy / baseSpeed * speed };
  };
  var throwStep = (s, dtRaw, b, physics = DEFAULT_PHYSICS) => {
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
    return { x, y, vx, vy, bounced, atRest };
  };
  var throwStepRegion = (s, dtRaw, space, physics = DEFAULT_PHYSICS) => {
    const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
    let { x, y, vx, vy } = s;
    vy += physics.gravity * dt;
    x += vx * dt;
    y += vy * dt;
    if (space.areas.length === 0) return { x, y, vx, vy, screen: -1, bounced: false, atRest: false };
    const h = space.size * 9 / 16;
    let bounced = false;
    let cur = screenOfBox(space, x, y);
    let b = space.bounds[cur];
    let a = space.areas[cur];
    const pa = space.panels[cur] || a;
    const cy = y + h / 2;
    if (x < b.minX) {
      if (indexAtPoint(space.panels, pa.x - 1, cy) < 0) {
        x = b.minX;
        vx = Math.abs(vx) * physics.restitution;
        bounced = true;
      }
    } else if (x > b.maxX) {
      if (indexAtPoint(space.panels, rectRight(pa), cy) < 0) {
        x = b.maxX;
        vx = -Math.abs(vx) * physics.restitution;
        bounced = true;
      }
    }
    cur = screenOfBox(space, x, y);
    b = space.bounds[cur];
    a = space.areas[cur];
    const pa2 = space.panels[cur] || a;
    const cx = x + space.size / 2;
    if (y < b.minY) {
      if (physics.ceilingBounce && indexAtPoint(space.panels, cx, pa2.y - 1) < 0) {
        y = b.minY;
        vy = Math.abs(vy) * physics.restitution;
        bounced = true;
      }
    } else if (y >= b.maxY) {
      if (indexAtPoint(space.panels, cx, rectBottom(pa2)) < 0) {
        y = b.maxY;
        vx *= Math.max(0, 1 - physics.groundFriction * dt);
        if (Math.abs(vy) < REST_VY) vy = 0;
        else vy = -Math.abs(vy) * physics.restitution;
        bounced = true;
      }
    }
    cur = screenOfBox(space, x, y);
    b = space.bounds[cur];
    const speed = Math.hypot(vx, vy);
    const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;
    return { x, y, vx, vy, screen: cur, bounced, atRest };
  };
  var PET_BOUNCE_E = 0.995;
  var bodyPixelBox = (o) => {
    const h = o.size * 9 / 16;
    return {
      left: o.x + HIT_BOX.x0 / 640 * o.size,
      top: o.y + o.bottomPad + HIT_BOX.y0 / 360 * h,
      right: o.x + HIT_BOX.x1 / 640 * o.size,
      bottom: o.y + o.bottomPad + HIT_BOX.y1 / 360 * h
    };
  };
  var rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  var collidePet = (fly, hit) => {
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

  // shell/shared/score.ts
  var SCORE_MIN_SPEED = 400;
  var SCORE_SPEED_PER_POINT = 100;
  var clickScore = (speed, size) => {
    if (speed <= 0 || size <= 0) return 0;
    return Math.max(1, Math.round(speed / SCORE_SPEED_PER_POINT * (PET_REF_WIDTH / size)));
  };

  // shell/shared/score-popup.ts
  var SCORE_POPUP_DURATION_MS = 2200;
  var SCORE_POPUP_CSS = [
    // 积分卡片：金色主值 + 灰色明细，居中，弹出动画
    ".dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
    "background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
    "box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
    "font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;}",
    ".dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}",
    ".dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
    ".dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
    // 粒子层：整屏固定、不挡交互；粒子为绝对定位小圆点，位移/透明度由 rAF 直接写
    ".dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
    ".dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
    "@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}"
  ].join("");
  var scoreCssInjected = false;
  function injectScoreCss() {
    if (scoreCssInjected || typeof document === "undefined") return;
    scoreCssInjected = true;
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-pet";
    tag.dataset.pluginCss = "dsh-pet/score";
    tag.textContent = SCORE_POPUP_CSS;
    document.head.appendChild(tag);
  }
  var BURST_COUNT = 20;
  var BURST_SPEED_MIN = 120;
  var BURST_SPEED_MAX = 460;
  var BURST_GRAVITY = 700;
  var BURST_LIFE_MIN = 500;
  var BURST_LIFE_MAX = 900;
  var BURST_RADIUS_MIN = 3;
  var BURST_RADIUS_MAX = 7;
  var BURST_COLORS = ["#ffb300", "#ff8f00", "#ff7043", "#f4511e", "#ffc400", "#ffd54f", "#ef5350"];
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
        p.el.style.transform = "translate(" + p.vx * tSec + "px," + (p.vy * tSec + 0.5 * BURST_GRAVITY * tSec * tSec) + "px)";
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
    void root.offsetWidth;
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
    return { el: root, close };
  }

  // shell/shared/work-status.ts
  var WORK_STATUS_STATES = ["thinking", "working", "result", "waiting", "success", "error"];
  var WORK_STATUS_INDEX = {
    thinking: 0,
    // turn/start → 思考
    working: 1,
    // tool/call → 工作
    result: 2,
    // tool/result → 整理
    waiting: 3,
    // approval/asked → 等待
    success: 4,
    // turn/end completed → 完成
    error: 5
    // turn/end error/max-tokens → 出错
  };
  var TIMEOUT_MS3 = 1e4;
  async function fetchWorkStatus(baseUrl = "/dsh-pet-7340/work-status") {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(TIMEOUT_MS3) });
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

  // shell/ours/chat.ts
  var SEND_TIMEOUT_MS = 6e4;
  var CHAT_COMPACT_MIN_W = 160;
  var CHAT_COMPACT_MAX_W = 340;
  var CHAT_COMPACT_PAD = 24;
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
  async function sendChatStream(baseUrl, text, onFrame, opts) {
    const signal = opts && opts.signal ? opts.signal : void 0;
    let res;
    try {
      res = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        ...signal ? { signal } : {}
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
    for (; ; ) {
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
  var CHAT_CSS = [
    // 面板本体：白色圆角卡（与菜单/气泡同一套视觉）；对话期间整窗已由渲染端保持可交互
    ".dsh-pet-chat{position:fixed;z-index:2147483001;max-width:80vw;display:flex;flex-direction:column;",
    "background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:12px;overflow:hidden;",
    "box-shadow:0 12px 36px rgba(0,0,0,.22);color:#2b2b2b;font-size:13px;line-height:1.5;",
    // 字体：family 别名 ShangshouSoftCandy（与气泡/菜单/设置同一套），实际字库是
    // assets/fonts/ 那个槽位里的**站酷快乐体 2016（HappyZcool-2016）**——本项目自带字体；
    // 想再换字体只替换那个 .ttf 即可（槽位文件名是历史硬编码，见 scripts/swap-assets.ps1）。
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
  var CHAT_MIN_W = 240;
  var CHAT_MAX_W = 340;
  var CHAT_H_PAD = 52;
  var CHAT_TIGHT_MIN_W = 140;
  var CHAT_EDGE_PAD = 4;
  var CHAT_HISTORY_MAX = 12;
  var CHAT_HISTORY_TEXT_MAX = 400;
  var chatCssInjected = false;
  function injectChatCss() {
    if (chatCssInjected || typeof document === "undefined") return;
    chatCssInjected = true;
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-pet";
    tag.dataset.pluginCss = "dsh-pet/chat";
    tag.textContent = CHAT_CSS;
    document.head.appendChild(tag);
  }
  function mountChatDialog(opts) {
    injectChatCss();
    const petId = opts.petId;
    const petName = opts.petName || petId;
    const chatBase = opts.baseUrl ?? "/dsh-pet-7340/chat";
    const streamUrl = chatBase + "/stream?pet=" + encodeURIComponent(petId);
    const onSend = opts.onSend;
    const onCancel = opts.onCancel;
    const onClose = opts.onClose;
    const size = Number(opts.size) > 0 ? Number(opts.size) : 462;
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
    let measureCtx = null;
    const measureText = (text) => {
      const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
      ctx.font = getComputedStyle(input).font;
      return ctx.measureText(text).width;
    };
    let dragFrom = null;
    let placed = null;
    let widthCap = Number.POSITIVE_INFINITY;
    let heightCap = Number.POSITIVE_INFINITY;
    const viewport = () => window.__dshPetVisibleRect ?? {
      x0: 0,
      y0: 0,
      x1: window.innerWidth,
      y1: window.innerHeight
    };
    function applyPlace(x, y, sizeHint) {
      const rr = sizeHint ?? root.getBoundingClientRect();
      const vp = viewport();
      root.style.left = Math.max(vp.x0 + CHAT_EDGE_PAD, Math.min(x, vp.x1 - rr.width - CHAT_EDGE_PAD)) + "px";
      root.style.top = Math.max(vp.y0 + CHAT_EDGE_PAD, Math.min(y, vp.y1 - rr.height - CHAT_EDGE_PAD)) + "px";
    }
    function reclampAfterResize() {
      if (placed && !dragFrom) applyPlace(placed.x, placed.y);
    }
    const desiredWidth = () => {
      const cap = Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, Math.round(size * 0.72)));
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
    const fitWidth = () => {
      if (compact) {
        const want2 = Math.ceil(measureText(input.value || input.placeholder)) + CHAT_COMPACT_PAD;
        const cap = widthCap === Number.POSITIVE_INFINITY ? CHAT_COMPACT_MAX_W : Math.max(CHAT_COMPACT_MIN_W, Math.min(CHAT_COMPACT_MAX_W, widthCap));
        root.style.width = Math.max(CHAT_COMPACT_MIN_W, Math.min(want2, cap)) + "px";
        reclampAfterResize();
        return;
      }
      const want = desiredWidth();
      root.style.width = (widthCap === Number.POSITIVE_INFINITY ? want : Math.max(CHAT_TIGHT_MIN_W, Math.min(want, widthCap))) + "px";
      reclampAfterResize();
    };
    const resizeInput = () => {
      input.style.height = "auto";
      input.style.height = Math.min(Math.max(input.scrollHeight, 22), 120) + "px";
    };
    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 36;
    const toBottom = () => {
      log.scrollTop = log.scrollHeight;
    };
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
    const restore = (messages) => {
      if (!Array.isArray(messages) || messages.length === 0) return;
      const tail = messages.slice(-CHAT_HISTORY_MAX);
      for (const m of tail) {
        if (!m || typeof m.text !== "string" || m.text === "") continue;
        const text = m.text.length > CHAT_HISTORY_TEXT_MAX ? m.text.slice(0, CHAT_HISTORY_TEXT_MAX) + "…" : m.text;
        append(m.role === "user" ? "me" : "pet", text);
      }
    };
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
    let lastUserText = "";
    let closed = false;
    let detached = false;
    let busy = false;
    let finished = false;
    let aborter = null;
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
      input.placeholder = flag ? "正在回复… 可继续输入" : "说点什么… 回车发送";
    };
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
      const run = onSend ? onSend(outgoing, { signal: controller.signal }) : sendChatStream(streamUrl, outgoing, (frame) => handleFrame(frame), { signal: controller.signal });
      const handleFrame = (frame) => {
        if (closed || !frame) return;
        const type = frame.type;
        if (type === "delta") reply = typeof frame.text === "string" ? frame.text : "";
        else if (type === "final") {
          finished = true;
          if (typeof frame.text === "string" && frame.text !== "") reply = frame.text;
        } else if (type === "error") finished = true;
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
            streamBubble.textContent = next;
            if (stick) toBottom();
            fitWidth();
          }
        }
      };
      try {
        const result = await run;
        if (closed) return;
        if (!detached && streamRow && result && typeof result.reply === "string" && result.reply !== "") {
          streamBubble.textContent = result.reply;
        }
        if (result && result.ok) {
          if (!detached) {
            clearStatus();
            endTurn();
            dot.classList.remove("busy");
            dot.classList.remove("err");
          }
          if (opts.onReply) opts.onReply(result.reply || reply);
        } else if (result && result.aborted) {
          if (!detached) {
            clearStatus();
            endTurn();
            dot.classList.remove("busy");
            setStatus("已停止");
          }
        } else {
          const raw = result && (result.message || result.reason) || "";
          const prefix = result && result.reason === "provider-missing" ? "未配置模型：" : "对话失败：";
          const already = prefix === "未配置模型：" ? /^(尚未)?(未)?配置模型/.test(raw) : /^对话失败/.test(raw);
          const message = already ? raw : prefix + (raw || (prefix === "未配置模型：" ? "右键 → 设置" : "未知原因"));
          if (!detached) showError(message);
        }
      } catch (e) {
        if (closed) return;
        if (!detached) showError("对话异常：" + String(e && e.message ? e.message : e));
      } finally {
        aborter = null;
        if (!closed && !detached) {
          setBusy(false);
          sendBtn.disabled = input.value.trim() === "";
          input.focus();
        }
      }
    };
    const abortInFlight = () => {
      if (!aborter) return;
      const controller = aborter;
      aborter = null;
      try {
        controller.abort();
      } catch {
      }
      if (onCancel) onCancel();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      abortInFlight();
      teardownDom();
      if (onClose) onClose();
    };
    const teardownDom = () => {
      document.removeEventListener("mousedown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeyDown, true);
      document.removeEventListener("mousemove", onDragMove, true);
      document.removeEventListener("mouseup", onDragEnd, true);
      root.remove();
    };
    const detach = () => {
      if (closed || detached) return;
      detached = true;
      teardownDom();
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
    const onDragMove = (e) => {
      if (!dragFrom) return;
      const from = dragFrom;
      const rr = root.getBoundingClientRect();
      const vp = viewport();
      const left = Math.max(vp.x0 + CHAT_EDGE_PAD, Math.min(from.left + (e.clientX - from.x), vp.x1 - rr.width - CHAT_EDGE_PAD));
      const top = Math.max(vp.y0 + CHAT_EDGE_PAD, Math.min(from.top + (e.clientY - from.y), vp.y1 - rr.height - CHAT_EDGE_PAD));
      root.style.left = left + "px";
      root.style.top = top + "px";
    };
    const onDragEnd = () => {
      dragFrom = null;
      document.removeEventListener("mousemove", onDragMove, true);
      document.removeEventListener("mouseup", onDragEnd, true);
      if (opts.onMoved) opts.onMoved();
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
      if (compact) fitWidth();
      sendBtn.disabled = !busy && input.value.trim() === "";
    });
    input.addEventListener("keydown", (e) => {
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
    const reposition = (x, y, sizeHint) => {
      placed = { x, y };
      applyPlace(x, y, sizeHint);
    };
    const limit = (maxWidth, maxHeight) => {
      const nextW = typeof maxWidth === "number" && Number.isFinite(maxWidth) && maxWidth > 0 ? Math.floor(maxWidth) : Number.POSITIVE_INFINITY;
      const nextH = typeof maxHeight === "number" && Number.isFinite(maxHeight) && maxHeight > 0 ? Math.floor(maxHeight) : Number.POSITIVE_INFINITY;
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

  // shell/ours/menu.ts
  function mountContextMenu2(opts) {
    if (opts.clamp !== void 0) return mountContextMenu(opts);
    const rect = typeof window === "undefined" ? void 0 : window.__dshPetVisibleRect;
    if (rect === void 0 || !Number.isFinite(rect.x1) || !Number.isFinite(rect.y1)) {
      return mountContextMenu(opts);
    }
    return mountContextMenu({
      ...opts,
      clamp: { x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 }
    });
  }

  // shell/ours/chat-place.ts
  function placeChatPanel(o) {
    const { pet, panel, vis } = o;
    const gap = o.gap ?? 6;
    const pad = o.pad ?? 4;
    const minWidth = o.minWidth ?? 140;
    const desiredW = Math.max(0, Math.round(panel.width));
    const desiredH = Math.max(0, Math.round(panel.height));
    const roomRight = Math.floor(vis.x1 - pad - (pet.right + gap));
    const roomLeft = Math.floor(pet.left - gap - (vis.x0 + pad));
    let side;
    if (desiredW <= roomRight) side = "right";
    else if (desiredW <= roomLeft) side = "left";
    else side = roomRight >= roomLeft ? "right" : "left";
    const room = Math.max(0, side === "right" ? roomRight : roomLeft);
    const width = desiredW <= room ? desiredW : Math.max(Math.min(minWidth, desiredW), room);
    const maxWidth = width < desiredW ? width : void 0;
    const wantLeft = side === "right" ? pet.right + gap : pet.left - gap - width;
    const loX = vis.x0 + pad;
    const hiX = Math.max(loX, vis.x1 - pad - width);
    const left = Math.min(Math.max(wantLeft, loX), hiX);
    const availH = Math.floor(vis.y1 - pad - (vis.y0 + pad));
    const height = desiredH <= availH ? desiredH : Math.max(0, availH);
    const maxHeight = height < desiredH ? height : void 0;
    const loY = vis.y0 + pad;
    const hiY = Math.max(loY, vis.y1 - pad - height);
    const top = Math.min(Math.max(pet.top + gap, loY), hiY);
    return { side, left, top, maxWidth, maxHeight, room: { left: roomLeft, right: roomRight } };
  }

  // shell/ours/bubble.ts
  var BUBBLE_MS_PER_CHAR = 1e3 / 4.5;
  var BUBBLE_MIN_MS = 4e3;
  var BUBBLE_MAX_MS = 3e4;
  var BUBBLE_QUEUE_MAX = 5;
  var BUBBLE_PAGE_CHARS = 110;
  var BUBBLE_PAGE_MAX = 6;
  function bubbleDwellMs(text) {
    const chars = [...String(text ?? "")].filter((ch) => !/\s/.test(ch)).length;
    if (chars === 0) return BUBBLE_MIN_MS;
    return Math.min(BUBBLE_MAX_MS, Math.max(BUBBLE_MIN_MS, Math.round(chars * BUBBLE_MS_PER_CHAR)));
  }
  function splitBubbleText(text, maxChars = BUBBLE_PAGE_CHARS, maxPages = BUBBLE_PAGE_MAX) {
    const body = String(text ?? "").trim();
    if (body === "") return [];
    const limit = Math.max(1, Math.floor(maxChars));
    const pages = [];
    let rest = body;
    while (rest !== "" && pages.length < pageCap(maxPages)) {
      if ([...rest].length <= limit) {
        pages.push(rest);
        rest = "";
        break;
      }
      const chars = [...rest];
      const window2 = chars.slice(0, limit);
      let cut = -1;
      for (let i = window2.length - 1; i >= Math.floor(limit * 0.5); i--) {
        if (/[。！？；!?;\n]/.test(window2[i] ?? "")) {
          cut = i + 1;
          break;
        }
      }
      if (cut <= 0) cut = limit;
      pages.push(chars.slice(0, cut).join("").trim());
      rest = chars.slice(cut).join("").trim();
    }
    if (rest !== "") {
      const last = pages.length - 1;
      const room = Math.max(0, limit - [...pages[last] ?? ""].length);
      pages[last] = (pages[last] ?? "") + [...rest].slice(0, room).join("") + "…";
    }
    return pages.filter((p) => p !== "");
  }
  function pageCap(maxPages) {
    return Math.max(1, Math.floor(maxPages));
  }
  var BubbleQueue = class {
    cur = null;
    queue = [];
    /** 当前显示的气泡（没有则 null）。 */
    current() {
      return this.cur === null ? null : this.cur.item;
    }
    /** 排队等着显示的气泡条数。 */
    pending() {
      return this.queue.length;
    }
    /**
     * 当前这条还要停留多久。
     * @param now - 当前时刻。
     * @returns 剩余毫秒；流式回复期间为 Infinity（流没结束不计时）；没有气泡为 0。
     */
    remaining(now) {
      if (this.cur === null) return 0;
      if (this.cur.streaming) return Number.POSITIVE_INFINITY;
      return Math.max(0, this.cur.until - now);
    }
    /**
     * 推一条一次性气泡（碎碎念、或已经拿到整段文本的回复）。
     * @param kind - `whisper` 会让路：有真回复在显示/排队时直接丢弃。
     * @param text - 气泡文本；空白文本视为无效，返回空步骤。
     * @param now - 当前时刻。
     * @returns 需要渲染层执行的步骤。
     */
    push(kind, text, now) {
      const body = String(text ?? "").trim();
      if (body === "") return {};
      if (kind === "whisper") {
        if (this.queue.length > 0) return {};
        if (this.cur !== null && this.cur.item.kind === "chat") return {};
        this.cur = { item: { kind, text: body }, until: now + bubbleDwellMs(body), streaming: false };
        return { show: this.cur.item };
      }
      if (this.cur === null || this.cur.item.kind === "whisper") {
        this.cur = { item: { kind, text: body }, until: now + bubbleDwellMs(body), streaming: false };
        return { show: this.cur.item };
      }
      this.queue.push({ kind, text: body });
      if (this.queue.length > BUBBLE_QUEUE_MAX) this.queue.shift();
      return {};
    }
    /**
     * 流式回复开始：立即占位显示（用户刚发完消息，答案就该马上出现），期间不计时。
     * 正在显示的碎碎念被顶掉，正在显示的旧回复直接接替（用户自己发起的新回合不等）。
     * @param text - 占位文本（如「正在思考…」）。
     * @param now - 当前时刻。
     * @returns 需要渲染层执行的步骤。
     */
    begin(text, now) {
      const body = String(text ?? "").trim();
      this.cur = { item: { kind: "chat", text: body }, until: Number.POSITIVE_INFINITY, streaming: true };
      return { show: this.cur.item };
    }
    /**
     * 流式增量：就地替换当前气泡文本（气泡是「整段替换」渲染，不做逐字追加）。
     * @param text - 到目前为止的整段文本。
     */
    update(text) {
      if (this.cur === null || !this.cur.streaming) return;
      this.cur.item.text = String(text ?? "");
    }
    /**
     * 流式结束：定稿文本并按它重新计时（长回复因此拿到完整阅读时间）。
     * @param text - 最终文本。
     * @param now - 当前时刻。
     * @returns 需要渲染层执行的步骤。
     */
    finish(text, now) {
      if (this.cur === null || !this.cur.streaming) return {};
      const body = String(text ?? "").trim();
      if (body !== "") this.cur.item.text = body;
      this.cur.streaming = false;
      this.cur.until = now + bubbleDwellMs(this.cur.item.text);
      return { show: this.cur.item };
    }
    /**
     * 流式结束 + 分屏定稿：长回复切成多屏，第一屏现在显示，其余屏排队依次显示。
     * 每屏各自拿一份按字数的阅读时间，所以「上一句还没读完就跳走」不会发生。
     * @param text - 最终文本。
     * @param now - 当前时刻。
     * @param maxChars - 每屏字数上限（默认 {@link BUBBLE_PAGE_CHARS}）。
     * @returns 需要渲染层执行的步骤。
     */
    finishPaged(text, now, maxChars = BUBBLE_PAGE_CHARS) {
      if (this.cur === null || !this.cur.streaming) return {};
      const pages = splitBubbleText(text, maxChars);
      if (pages.length === 0) return this.finish(text, now);
      this.cur.item.text = pages[0];
      this.cur.streaming = false;
      this.cur.until = now + bubbleDwellMs(this.cur.item.text);
      for (const page of pages.slice(1)) {
        this.queue.push({ kind: "chat", text: page });
        if (this.queue.length > BUBBLE_QUEUE_MAX) this.queue.shift();
      }
      return { show: this.cur.item };
    }
    /**
     * 当前这条读完了：显示队列里的下一条，队列空了就收起气泡。
     * @param now - 当前时刻。
     * @returns 需要渲染层执行的步骤。
     */
    next(now) {
      const head = this.queue.shift();
      if (head === void 0) {
        this.cur = null;
        return { hide: true };
      }
      this.cur = { item: head, until: now + bubbleDwellMs(head.text), streaming: false };
      return { show: this.cur.item };
    }
    /** 清空一切（宠物关闭/重载时用）。 */
    clear() {
      this.cur = null;
      this.queue = [];
    }
  };
  return __toCommonJS(index_exports);
})();
