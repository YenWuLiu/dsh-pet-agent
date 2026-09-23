/**
 * dsh-pet desktop helper renderer —— 每只桌面宠物一个独立局部小窗口里的宠物本体。
 *
 * 与浏览器 overlay 严格对齐（宠物行为/文案完全一致）：
 *   - 纯逻辑（常量/选择器/移动几何/余额折算/拍平）来自 shared-core.js
 *     （= src/shared 的构建产物，window.PetShared）——与浏览器 bundle 共用同一份源码；
 *   - 配置唯一来源 = 宿主 /dsh-pet-7340/config 的**成品聚合**（host readAllConfig 合并，
 *     绝对正确、字段填满）：一步 fetch → S.flattenConfigPets 拍平，加载失败**大声报错**
 *     并显示红色错误条（每 5s 自动重试），绝无静默兜底池；
 *   - 动画素材经宿主 /dsh-pet-7340/thumb/<素材根>/<name>.webm（素材根 = 条目 key）；
 *   - 几何模型：窗口 = 宠物包围盒 + 四周外扩余量（WINDOW_MARGIN_RATIO，为气泡/弹窗预留空间）。
 *     sprite 固定在窗口内 (margin.l, margin.t) 处，宠物的"移动"由本页把目标屏幕位置
 *     逐帧上报（petBridge.setBounds）→ 主进程按 sprite 位置 + 外扩余量移动窗口；
 *     视口 = 主屏工作区（workAreaW/H 由主进程注入），漫游/角落/位置换算都用它。
 *     外扩区透明且点击穿透（只有身体命中区可交互），不挡下层应用。
 *   - 右键级联菜单（与浏览器共用同一份组件：树+渲染+样式来自 shared-core 的 menu 模块）：
 *     右键宠物弹出，桌面端工具根项「对话 / 设置 / 碎碎念 / 回到初始位置 / 退出桌宠」
 *     + 动作点播（含余额档位、碎碎念两档事件池）；
 *     菜单开启期间整窗保持可交互（悬停菜单不触发穿透翻转），关闭/离开窗口即恢复穿透。
 *   - 系统通知不是宠物行为（浏览器半侧 notify.ts 负责），桌面端不重复实现。
 *
 * 端点全部由 CONFIG.configUrl 的 origin 推导（BASE = origin + /dsh-pet-7340）。
 * 入口仅加载：shared-core.js（经典 script）→ renderer.js（本文件）。
 */
'use strict';

const S = window.PetShared;

const params = new URLSearchParams(location.search);
const CONFIG = {
  configUrl: params.get('configUrl') || 'http://127.0.0.1:7341/dsh-pet-7340/config',
  scale: Number(params.get('scale') || '1'),
  petIndex: Number(params.get('petIndex') || '0'),
};
// bridge 模式（DSH_PET_BRIDGE=1）：请求走自定义 scheme，经 Electron 主进程转宿主管道——
// 绕开 DSH Desktop 2.0.3+ 的浏览器访问闸门（只放行带令牌的请求，插件自拉进程的裸 HTTP 全 403）
const BRIDGE = params.get('bridge') === '1';
// 视口 = 主屏工作区（窗口只是宠物的一块局部画布）：漫游边界/角落定位/位置比例换算用它
const VIEW = {
  w: Number(params.get('workAreaW') || (window.screen && window.screen.availWidth) || 1920),
  h: Number(params.get('workAreaH') || (window.screen && window.screen.availHeight) || 1080),
};
const ORIGIN = new URL(CONFIG.configUrl).origin;
/** 宿主 /dsh-pet-7340 前缀：bridge 走自定义 scheme（主进程转发），否则 HTTP 直连宿主 */
const BASE = BRIDGE ? 'dsh-pet-bridge://dsh-pet/dsh-pet-7340' : ORIGIN + '/dsh-pet-7340';
const WHISPER_URL = BASE + '/whisper';
// 窗口四周外扩 = 该比例 × 宠物尺寸：为气泡 / 未来可能的弹窗预留显示空间；
// 外扩区透明且点击穿透（只有身体命中区可交互）。单点可调——按实际观感改这里。
const WINDOW_MARGIN_RATIO = 0.5;
// 换片方式：硬切——新画面首帧上屏后一次性掀掉旧层，不做交叉淡化/首尾焊接
// （上游素材每段首尾都是同一站姿，本来就是连贯的；见 switchTo）。

// ---------- 全局状态 ----------
const rootEl = document.getElementById('root');
const errorEl = document.getElementById('pet-error');
let config = null; // { pets: 拍平后的成品实例列表, refreshSec: 主条目周期 }（loadConfig 填充）
let sprites = []; // PetSprite[]（本窗口只装一只宠物）
let bootTimer = null;
let loopsStarted = false;
// 对话形式（宿主 settings.json 持久化）：'bubble' = 宠物头顶气泡（默认，更有对话感），
// 'dialog' = 常驻对话面板。启动时拉一次，设置弹窗里切换后立即生效。
let chatForm = 'bubble';

/** 读对话形式（失败就用默认值：气泡）。 */
async function loadChatForm() {
  try {
    const res = await fetch(BASE + '/settings', { cache: 'no-store' });
    const s = await res.json();
    chatForm = s && s.chatForm === 'dialog' ? 'dialog' : 'bubble';
  } catch {
    /* 宿主没起来就用默认值 */
  }
}

// ---------- 调试钩子（冒烟自检/排障用；真实运行也可排查错误/配置/气泡） ----------
window.__dshPetDebug = {
  errors: [],
  configOk: false,
  spriteCount: 0,
  lastBubbleTitle: '',
  menuOpen: false,
  chatOpen: false,
  bootAt: Date.now(),
};
window.addEventListener('error', (event) => {
  window.__dshPetDebug.errors.push(String(event.message || event.error));
});

// ---------- 配置（大声报错；失败 5s 重试） ----------
function showError(message) {
  console.error('[dsh-pet] ' + message);
  window.__dshPetDebug.configOk = false;
  errorEl.textContent = 'dsh-pet 配置错误：' + message;
  errorEl.classList.add('visible');
}
function hideError() {
  errorEl.classList.remove('visible');
  errorEl.textContent = '';
}
function scheduleReboot() {
  if (bootTimer) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void boot();
  }, 5000);
}

async function loadConfig() {
  // 唯一配置入口：宿主 /config 的成品聚合（host readAllConfig 已合并并保证绝对正确），
  // 一步拉取 → 拍平成渲染列表，零校验零兜底
  const res = await fetch(BASE + '/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config http ${res.status}`);
  const merged = await res.json();
  return {
    pets: S.flattenConfigPets(merged),
    // 主条目周期（全局节奏；合并器已填内置默认）
    refreshSec: (merged && merged.main && merged.main.eventsRefreshSec) || {},
    // 拖拽抛掷物理参数（顶层全局，所有宠物共用；合并器已填内置默认）
    physics: (merged && merged.main && merged.main.physics) || S.DEFAULT_PHYSICS,
    // 工作状态气泡文案（顶层二维数组，外层索引 = 档位；合并器已校验结构）
    workStatusTexts: (merged && merged.main && merged.main.workStatusTexts) || [],
  };
}

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
/** 工作状态的「进行中」档位：播完要续播（终态 success/error 播一遍就回 idle）。 */
const WORK_STATUS_ONGOING = new Set(['thinking', 'working', 'result', 'waiting']);

class PetSprite {
  constructor(pet) {
    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    this.size = pet.size * CONFIG.scale;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    window.__dshPetDebug.winMargin = this.margin;
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    // 素材根 = 条目 key（assetRoot，多实例共享同一素材目录）
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(pet.assetRoot || pet.id) + '/';
    // 素材 blob 缓存：后台预取全部动画 webm（本地宿主/bridge 读盘，量小秒级）。
    // 之后切换只换 blob URL——无网络往返，loadeddata 仅剩首帧解码（接缝空窗压到几十 ms）
    this.assetUrls = new Map(); // 动画名 -> blob URL（未命中回落 assetBase 直链）
    void this.prefetchAssets();
    // 切换遥测：每次翻台/同源续播记一条（动画名/方式/时刻），实机排查接缝用；
    // 经 __dshPetDebug.switchLogs[petId] 暴露，冒烟或手动 dump 时与录屏时间轴对齐
    this.switchLog = [];
    (window.__dshPetDebug.switchLogs = window.__dshPetDebug.switchLogs || {})[pet.id] = this.switchLog;
    this.front = 0; // 0 = A, 1 = B
    this.frontAnim = ''; // 前台视频**实际装载**的动画名（同源续播判定用；this.anim 是目标态，frontAnim 才是已上屏态）
    this.pending = null;
    this.gen = 0;
    // 风格组（正面/3-4 按组切换）：currentStyle 决定随机链从哪个组取动画；
    // styleTurns 里的"风格切换转身"播完会把 currentStyle 翻到另一组（动画驱动按组切换）
    this.style = this.animations.initialStyle ?? Object.keys(this.animations.groups ?? {})[0] ?? null;
    this.styleTurnChance = Number.isFinite(this.animations.styleTurnChance) ? this.animations.styleTurnChance : 0.2;
    this.anim = this.stylePool(this.animations.idle)[0] ?? this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this._inputBusy = null; // 是否正拿着鼠标输入（拖拽/面板）：同上，只在变化时上报主进程兜底通道
    // 最近一次光标位置（客户端/屏幕坐标）：面板关闭后立即用命中区判定回落，不必等下一次 mousemove
    this.lastClientX = NaN;
    this.lastClientY = NaN;
    this.lastScreenX = NaN;
    this.lastScreenY = NaN;
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 碎碎念（每只独立：自己轮询 /whisper?pet=<id>、自己的文本与触发）
    this.whisperText = '';
    this.whisperBaseline = false;
    this.prevWhisperTs = 0;
    this.whisperLoopTimer = null;
    // 头顶气泡：碎碎念 / 对话回复 / 命令提示共用同一个气泡，节奏交给队列
    // （按字数给阅读时间、没读完不被顶掉，见 shell/ours/bubble.ts）
    this.bubbleQueue = new S.BubbleQueue();
    this.bubbleItem = null; // 当前显示的气泡（与队列里的条目是同一个对象，流式时被就地改写）
    this.bubbleTimer = null;
    // 命令触发气泡（/chat 命令）：1s 轻轮询 /broadcast，ts 变化即弹气泡（与碎碎念周期独立，不受开关门控）
    this.broadcastLoopTimer = null;
    this.broadcastBaseline = false;
    this.prevBroadcastTs = 0;
    // 对话面板（shared 组件）：当前挂载的句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatDialog = null; // mountChatDialog 返回的句柄（restore/append/reposition/limit/close）
    this.chatClose = null; // chatDialog.close 的快捷引用（dispose/菜单切换用）
    this.chatOpen = false;
    this.chatPanelRO = null; // 面板尺寸订阅（ResizeObserver）：只在尺寸变化后重量，拖动时不逐帧量
    this.chatPanelSize = null; // 面板尺寸缓存（null = 需重新测量）
    this.chatLayingOut = false; // 落位重入保护（落位会改面板尺寸 → 触发 RO 回调）
    this.roamFrozen = false; // 漫游冻结：对话面板里焦点在内时冻结（打字时她别走开），焦点离开即放行
    // 权限确认弹窗（内核桌宠扩展）：/approval/pending 轮询 + DOM 确认框
    // （approvalOpen 是穿透守卫，与 chatOpen/menuOpen 同语义：确认框期间整窗保持可交互）
    this.approvalLoopTimer = null;
    this.approvalOpen = false;
    this.approvalShowing = false;
    // 设置弹窗（内核桌宠扩展）：开机自启 + 模型配置（settingsOpen 同为穿透守卫）
    this.settingsOpen = false;
    // 双击打开对话框：单击动画经 280ms 去抖，双击取消之
    this.clickTimer = null;
    // 工作状态联动（上游 workStatus 六档动画 + 气泡文案）：1s 轮询 /work-status，ts 变化即切档
    this.workStatusLoopTimer = null;
    this.prevWorkStatusTs = 0;
    this.workState = null; // 当前工作状态档位（null=空闲）；非终态档位动画播完要续播
    this.workStatePool = null; // 档位动画池（续播时查候选）

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = this.pet.name;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    this.hit.title = this.pet.name;
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClickDebounced(), { signal: ac.signal });
    this.hit.addEventListener('dblclick', () => this.onDblClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再按"还有没有
        // 面板开着"统一回落——对话面板是窗口内 DOM，鼠标还要回来点输入框，不能翻成穿透
        this.closeMenu();
        this.syncInteractive();
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            x: Number(s && s.x) || 0,
            y: Number(s && s.y) || 0,
            vx: Number(s && s.vx) || 0,
            vy: Number(s && s.vy) || 0,
            size: Number(s && s.size) || 0,
            bottomPad: Number(s && s.bottomPad) || 0,
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(vx, vy);
      });
    }
  }

  dispose() {
    this.ac.abort();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleQueue.clear();
    if (this.whisperLoopTimer !== null) window.clearTimeout(this.whisperLoopTimer);
    if (this.broadcastLoopTimer !== null) window.clearTimeout(this.broadcastLoopTimer);
    if (this.chatClose) {
      this.chatClose(); // 面板自己会回 onClose 清引用（含在飞回合的取消）
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    for (const u of this.assetUrls.values()) URL.revokeObjectURL(u);
    this.assetUrls.clear();
    this.el.remove();
  }

  // 目标包围盒左上角（工作区坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      window.petBridge.setBounds(
        this.pos.x - this.margin.l,
        this.pos.y - this.margin.t,
        this.size + this.margin.l + this.margin.r,
        this.winH + this.margin.t + this.margin.b,
        this.pos.x, // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        this.pos.y,
      );
    }
    // 面板开着：每次窗口移动后重算落位（拖拽/抛掷/漫游/回位全走这里）——
    // 窗口跟着宠物走只是"被动跟随"，面板还需要按屏幕边缘重新选边/夹取。
    if (this.chatDialog) this.layoutChatDialog();
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        marginX: this.pet.position.marginX,
        marginY: this.pet.position.marginY,
        size: this.size,
        W,
        H,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y); // 内含对话面板重落位（sendBounds → layoutChatDialog）
  }

  // 对话面板落位（跟随宠物 + 屏幕边缘碰撞）：宠物每次移动后重算——
  //   贴宠物右侧 → 右侧在屏幕内放不下就翻到左侧 → 两侧都窄就把面板压窄（下限见 chat.js）；
  //   最终由面板自己按可视矩形夹取，宠物贴屏幕边缘时面板绝不落到看不见的区域。
  // 用户手拖过面板也不脱钩：宠物一动就重新贴回去（原先是「拖过就不再跟随」的闩锁，2026-09 去掉）。
  layoutChatDialog() {
    const d = this.chatDialog;
    if (!d || typeof d.reposition !== 'function') return;
    if (this.chatLayingOut) return; // 回环保护：落位会改面板尺寸 → ResizeObserver 再喊一次
    this.chatLayingOut = true;
    try {
      const vis = this.visibleRect();
      window.__dshPetVisibleRect = vis; // 与 refreshVisibleRect() 同义：一次计算，顺带发布给 shared-core
      const pet = this.hit.getBoundingClientRect();
      const el = d.el;
      // 面板尺寸：有 ResizeObserver 就只在它变化后重量（拖动时每帧量会强制同步布局）
      if (this.chatPanelSize === null) this.chatPanelSize = this.measureChatPanel(el);
      let panel = this.chatPanelSize;
      let plan = S.placeChatPanel({ pet, panel, vis });
      const needCap = plan.maxWidth !== undefined || plan.maxHeight !== undefined;
      if (typeof d.limit === 'function') {
        // 空间不够 → 施加尺寸上限（收窄/收矮）；够了 → 清掉上一次的上限。
        // 上限一变面板尺寸就变（内容重排），所以重新量一次并再算一遍落位。
        d.limit(needCap ? plan.maxWidth : undefined, needCap ? plan.maxHeight : undefined);
        if (needCap) {
          this.chatPanelSize = this.measureChatPanel(el);
          panel = this.chatPanelSize;
          plan = S.placeChatPanel({ pet, panel, vis });
        }
      }
      d.reposition(plan.left, plan.top, panel); // 带上尺寸：面板侧不必再量一次
    } finally {
      this.chatLayingOut = false;
    }
  }

  /** 量面板尺寸，并（首次）订阅其变化：变化时作废缓存并重排一次落位。 */
  measureChatPanel(el) {
    const rr = el.getBoundingClientRect();
    if (this.chatPanelRO === null && typeof ResizeObserver === 'function') {
      this.chatPanelRO = new ResizeObserver(() => {
        this.chatPanelSize = null; // 新消息/流式长句/收窄都会改尺寸：作废缓存
        this.layoutChatDialog(); // 尺寸变了就地重排（回环由 chatLayingOut 挡住）
      });
      this.chatPanelRO.observe(el);
    }
    return { width: rr.width, height: rr.height };
  }

  /** 面板关闭：断开尺寸订阅并清缓存（下次打开重新建立）。 */
  releaseChatPanelObserver() {
    if (this.chatPanelRO !== null) {
      this.chatPanelRO.disconnect();
      this.chatPanelRO = null;
    }
    this.chatPanelSize = null;
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // ---- 素材预取（消接缝空窗）：全部动画一次性拉成 blob URL，切换零网络等待 ----
  collectAnimNames() {
    const a = this.animations || {};
    const names = new Set();
    for (const key of ['idle', 'turn', 'drag', 'clicks']) {
      for (const n of a[key] || []) names.add(n);
    }
    for (const act of (a.moves && a.moves.actions) || []) names.add(act.name);
    for (const c of a.categories || []) for (const n of c.actions || []) names.add(n);
    for (const pool of Object.values(a.events || {})) for (const n of pool) names.add(n);
    for (const pool of Object.values(a.styleTurns || {})) for (const n of pool) names.add(n);
    return [...names];
  }

  async prefetchAssets() {
    await Promise.all(
      this.collectAnimNames().map(async (name) => {
        try {
          const res = await fetch(this.assetBase + encodeURIComponent(name) + '.webm', { cache: 'no-store' });
          if (!res.ok) throw new Error('http ' + res.status);
          this.assetUrls.set(name, URL.createObjectURL(await res.blob()));
        } catch (e) {
          // 预取失败不阻塞播放：switchTo 回落原始直链（行为与旧版一致）
          console.warn('[dsh-pet] 素材预取失败（回落直链）：', name, e);
        }
      }),
    );
  }

  // 双缓冲切换（与浏览器同一套：前台整层硬切 + 降级视频清 handler 防残留 ended 雪崩）。
  // 衔接观感三要点：
  //   1) 目标 = 前台当前动画（idle 链式自滚）→ 不重载不换缓冲，原地 seek 续播（真无缝）；
  //   2) 换片时等「首帧真正上屏」（requestVideoFrameCallback）才换层——loadeddata
  //      只保证首帧解码完成，直接换会从透明闪入；
  //   3) 新层就位后旧层立即 pause——不留在屏上叠影。
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    // 同源续播 fast path：目标动画 = 前台正在播的动画（idle 自滚 / 重播同一片）→
    // 原地 seek 回 0 续播，无加载空窗、无淡化跳变。移动动画按 currentTime 驱动窗口平移，
    // 绝不可 seek（moveRef/pendingMove 守卫），走完整重载。
    // 注意判 frontAnim（已上屏态）而非 this.anim（目标态）：拖拽释放等路径会先改 anim 再切。
    const cur = this.front === 0 ? this.videoA : this.videoB;
    if (!this.pending && cur && cur.src && next === this.frontAnim && this.moveRef === null && !this.pendingMove) {
      cur.loop = !nextOnce;
      cur.onended = nextOnce ? () => this.handleEnded() : null;
      cur.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      try {
        cur.currentTime = 0;
      } catch {
        /* seek 失败无碍：让它自然播完走 ended 回链 */
      }
      cur.play().catch(() => {});
      this.switchLog.push({ t: Date.now(), anim: next, mode: 'seek' });
      if (this.switchLog.length > 200) this.switchLog.shift();
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(cur);
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetUrls.get(next) || this.assetBase + encodeURIComponent(next) + '.webm';
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      if (this.pending && this.pending.gen !== gen) return;
      let flipped = false;
      const flip = () => {
        if (flipped) return;
        flipped = true;
        if (this.pending && this.pending.gen !== gen) return;
        const old = this.front === 0 ? this.videoA : this.videoB;
        el.style.zIndex = '2';
        el.classList.add('is-front');
        if (old && old !== el) {
          old.onended = null;
          // 硬切（无交叉淡化、无首尾焊接）：新层首帧已上屏，同一帧里一次性掀掉旧层。
          // 两层只在这一次风格重算内交接，任意时刻都有一层完全不透明，背景不会从缝里透出来；
          // 旧层立刻 pause，不留残影（上游每段动画首尾都是同一站姿，硬切接得上）。
          old.classList.remove('is-front');
          old.pause();
          old.style.zIndex = '';
        }
        this.front = this.front === 0 ? 1 : 0;
        this.frontAnim = next;
        this.pending = null;
        this.switchLog.push({ t: Date.now(), anim: next, mode: 'cut' });
        if (this.switchLog.length > 200) this.switchLog.shift();
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
        // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）。
        if (this.pendingSquash) {
          this.pendingSquash = false;
          this.startSquash(el);
        }
        if (this.pendingMove) this.startMoveDrive(el);
      };
      // 先开播（opacity:0 不可见，无视觉影响），等首帧真正呈现再翻台；
      // rVFC 不可用时退化为双 rAF；超时兜底防缓冲异常卡死在旧画面
      el.play().catch(() => {});
      if (typeof el.requestVideoFrameCallback === 'function') {
        el.requestVideoFrameCallback(() => flip());
      } else {
        requestAnimationFrame(() => requestAnimationFrame(flip));
      }
      setTimeout(flip, 400);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // ---- 风格组过滤（按组切换的核心）----
  // 某动画是否属于当前风格：已登记在任何组里的 → 必须在当前组；未登记（通用）→ 任何风格可用
  isInStyle(name) {
    const groups = this.animations.groups;
    if (!groups || !this.style) return true;
    const mine = groups[this.style] || [];
    const listedAnywhere = Object.values(groups).some((list) => list.includes(name));
    return listedAnywhere ? mine.includes(name) : true;
  }
  // 从池子里筛出当前风格可用的动画（可为空；调用方负责兜底，避免跨风格混用）
  stylePool(pool) {
    if (!Array.isArray(pool)) return pool;
    return pool.filter((n) => this.isInStyle(n));
  }
  // 切换风格组（当前组 → 另一组；多于两组时取第一个不同组）
  switchStyle() {
    const keys = Object.keys(this.animations.groups ?? {});
    if (keys.length < 2) return;
    const others = keys.filter((k) => k !== this.style);
    this.style = others[0];
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    // 按当前风格组过滤池子（idle 兜底回全池，保证永远有可播的待机）
    const idlePool = this.stylePool(animations.idle);
    const idleReady = idlePool.length ? idlePool : animations.idle;
    const cats = (animations.categories || []).map((c) => ({ ...c, actions: this.stylePool(c.actions) }));
    const roll = Math.random();
    const k = S.rollKind(roll, animationWeights);
    let next;
    if (k === 'idle') {
      next = S.pick(idleReady, this.anim);
    } else if (k === 'turn') {
      // 转身：小概率触发风格切换转身（styleTurns[当前组]，播完换组），否则普通转身（同组内翻 facing）
      const styleTurnPool = animations.styleTurns && this.style ? animations.styleTurns[this.style] || [] : [];
      const sameTurnPool = this.stylePool(animations.turn || []);
      let picked = null;
      if (styleTurnPool.length && Math.random() < this.styleTurnChance) {
        picked = S.pick(styleTurnPool, this.anim);
      }
      if (!picked && sameTurnPool.length) picked = S.pick(sameTurnPool, this.anim);
      if (picked) {
        next = picked;
      } else {
        // 当前组没有可用转身 → 落到小动作池/待机兜底
        const act = S.pickCategoryAction(cats, idleReady, this.facing, this.anim);
        next = act.name;
      }
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(cats, idleReady, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(cats, idleReady, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  handleEnded() {
    if (this.dragState.active) return;
    const { animations } = { animations: this.animations };
    const idlePool = this.stylePool(animations.idle);
    const idleReady = idlePool.length ? idlePool : animations.idle;
    // 事件动画播完：**非终态**的工作状态档位续播（多候选档位自动轮换），其余回 idle。
    // isEventAnim 走 slotIncludes：槽位是数组（候选）时也算命中——旧的 pool.includes 判不出来。
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      if (this.workState !== null && WORK_STATUS_ONGOING.has(this.workState)) {
        const pool = this.workStatePool || this.animations.events?.workStatus || [];
        const cont = S.nextWorkStatusAnim(pool, this.anim);
        this.playOnce(cont ?? this.anim); // 单候选档位：续播同一段（与上游「非终态循环播」一致）
        return;
      }
      this.workState = null; // 终态（成功/出错）或其它事件动画：播完回 idle
      if (idleReady.length) this.playOnce(S.pick(idleReady, this.anim));
      return;
    }
    // 风格切换转身：播完把 currentStyle 翻到另一组 + 翻 facing（动画驱动按组切换）
    if (animations.styleTurns && this.style && (animations.styleTurns[this.style] || []).includes(this.anim)) {
      this.switchStyle();
      this.facing = this.facing === 'left' ? 'right' : 'left';
    } else if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      if (idleReady.length) this.playOnce(S.pick(idleReady, this.anim));
      return;
    }
    this.playIdle();
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    // 对话面板开着时禁止漫游：面板钉在宠物旁边，宠物一走面板就满屏跟（正在打字/读回复时很难受）。
    // 返回 false 让调用方落回原地小动作池——只"不走动"，待机/小动作照常播。
    if (this.roamFrozen) return false;
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = (moves.actions || []).filter((a) => this.isInStyle(a.name));
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin,
      halfW: this.halfW,
      sideAllow: this.sideAllow,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    const bounds = S.throwBounds({ W: VIEW.w, H: VIEW.h, size: this.size, sideAllow: this.sideAllow });
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      const res = S.throwStep(state, dt, bounds, this.physics);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测
      if (window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: state.x,
          y: state.y,
          vx: state.vx,
          vy: state.vy,
          size: this.size,
          bottomPad: this.bottomPad,
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              window.petBridge.reportCollide(pid, hit.hvx, hit.hvy);
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）
      const grounded = res.y >= bounds.maxY - 1;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：视频垂直压扁再回弹（曲线在 shared，S.squashScale）。
   *  · target 可传单个元素或数组（多层同屏时一起压，避免"压扁的新层 + 全高的旧层"看出双影；
   *    换片是硬切，正常只有一层在屏上，调用方传单个元素）；
   *  · 锚点 = 引擎脚底线 FEET_Y（不是画面底边）：以画面底边为锚点压扁会把角色往地里压
   *    （0.55 深度时脚底下沉 ~14px），锚在脚底线上才是"贴地压扁"。
   *  depth = 下压幅度（点击固定 0.55；落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(target, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = (Array.isArray(target) ? target : [target]).filter(Boolean);
    if (!els.length) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origins = els.map((e) => e.style.transformOrigin);
    const anchor = '50% ' + (100 * S.FEET_Y) / S.CANVAS_H + '%';
    for (const e of els) e.style.transformOrigin = anchor;
    const t0 = performance.now();
    const apply = (scale) => {
      const tf = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      for (const e of els) e.style.transform = tf;
    };
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      apply(S.squashScale(u, depth));
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        els.forEach((e, i) => {
          e.style.transformOrigin = origins[i];
          // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
          e.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
        });
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    this.dragState = {
      active: true,
      dragging: false,
      sx: e.screenX,
      sy: e.screenY,
      petX: this.pos.x,
      petY: this.pos.y,
    };
    this.reportInputBusy(); // 告知兜底通道：从现在起我在用这个窗口的鼠标输入
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）
    const dx = e.screenX - d.sx;
    const dy = e.screenY - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      const dragPool = this.stylePool(this.animations.drag);
      if (dragPool.length) {
        this.playOnce(S.pick(dragPool));
      }
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: e.screenX, y: e.screenY });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.reportInputBusy(); // 松手：交还给兜底通道的位置判定
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 释放后接一段循环待机（与浏览器一致），再回随机链
      const idlePool = this.stylePool(this.animations.idle);
      const idleReady = idlePool.length ? idlePool : this.animations.idle;
      if (idleReady.length) {
        const name = S.pick(idleReady, this.anim);
        this.anim = name;
        this.once = false;
        this.switchTo(name, false);
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
      this.dragTrail = [];
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy);
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  /**
   * 面板模式下的"整窗可交互"。
   *
   * 面板（对话/菜单/审批/设置）是窗口内 DOM：只要它在屏上，**整窗**就必须保持可交互，
   * 否则光标一离开身体命中区就翻回穿透——面板上的按钮/输入框会点不动（点击被透传给
   * 下层应用）。而每个面板各自维持一个 open 标记、各自在关闭时回落，容易出现
   * 「一个面板关了就把另一个还开着的面板的窗口翻成穿透」。这里集中算一次：
   * 只要还有任意面板开着就是 true，全部关掉才回落到命中区判定。
   */
  anyPanelOpen() {
    return !!(this.menuOpen || this.chatOpen || this.approvalOpen || this.settingsOpen);
  }

  /** 面板开/关/切换后的统一收口：整窗可交互（有面板）或命中区判定（无面板）。 */
  syncInteractive() {
    this.reportInputBusy(); // 面板开/关也要让兜底通道知道（否则兜底会按位置把面板点穿）
    if (this.dragState.active || this.anyPanelOpen()) {
      this.setInteractive(true);
      return;
    }
    this.applyHitTest(this.lastClientX, this.lastClientY);
  }

  /**
   * 上报「正拿着这个窗口的鼠标输入」给主进程的穿透兜底通道（拖拽中 / 任意面板开着）。
   * 只在变化时发 IPC。语义必须严格是**正在使用输入**，不含单纯悬停：
   * 悬停交给位置判定；若把悬停也算 busy，光标移出窗口后兜底通道就永远不会恢复穿透，
   * 整窗会一直挡住下层应用（那正是穿透存在的意义）。
   */
  reportInputBusy() {
    const busy = this.dragState.active || this.anyPanelOpen();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge && typeof window.petBridge.setInputBusy === 'function') {
      window.petBridge.setInputBusy(busy);
    }
  }

  /** 命中区判定：客户端坐标（窗口坐标）→ 是否落在身体命中区（sprite 坐标）。 */
  applyHitTest(clientX, clientY) {
    const r = this.hitRect;
    const hasX = Number.isFinite(clientX);
    const hasY = Number.isFinite(clientY);
    const wx = hasX ? clientX : this.lastScreenX - (this.pos.x - this.margin.l);
    const wy = hasY ? clientY : this.lastScreenY - (this.pos.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    this.setInteractive(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  // 屏幕可视矩形（窗口坐标）= 主屏工作区 ∩ 本窗口。
  // 宠物贴屏幕边缘时窗口四周外扩余量（margin）落在屏幕外——菜单/对话框若按
  // window.innerWidth/Height 钳制会定位到不可见区；shared-core 的菜单与对话
  // 弹窗读取 window.__dshPetVisibleRect（打开前由本方法刷新）。
  visibleRect() {
    const winX = this.pos.x - this.margin.l;
    const winY = this.pos.y - this.margin.t;
    return {
      x0: Math.max(0, -winX),
      y0: Math.max(0, -winY),
      x1: Math.min(window.innerWidth, VIEW.w - winX),
      y1: Math.min(window.innerHeight, VIEW.h - winY),
    };
  }

  /** 打开菜单/对话框前调用：把当前可视矩形发布给 shared-core（菜单/对话弹窗的钳制输入）。 */
  refreshVisibleRect() {
    window.__dshPetVisibleRect = this.visibleRect();
  }

  // 对话框定位（审批/设置共用）：与对话面板同一套落位规则——交给 shared-core 的
  // placeChatPanel 计算（贴身体右侧 → 右侧出屏翻左侧 → 夹进可视矩形），这里只写结果。
  // 传 minWidth = 自身宽度：这两个弹窗是定宽的，只借位置，不允许被压窄。
  placeDialog(el) {
    const vis = this.visibleRect();
    window.__dshPetVisibleRect = vis; // 与 refreshVisibleRect() 同义：一次计算，顺带发布给 shared-core
    const pet = this.hit.getBoundingClientRect();
    const rr = el.getBoundingClientRect();
    const place = S.placeChatPanel({
      pet,
      panel: { width: rr.width, height: rr.height },
      vis,
      minWidth: rr.width,
    });
    el.style.left = place.left + 'px';
    el.style.top = place.top + 'px';
  }

  onMouseMove(e) {
    // 记住最近一次光标位置：面板关闭后要立刻用命中区判定回落（不能等到下一次 mousemove
    // 才更新可交互状态——面板关掉的那一瞬间窗口可能就翻错了）
    if (Number.isFinite(e.clientX)) this.lastClientX = e.clientX;
    if (Number.isFinite(e.clientY)) this.lastClientY = e.clientY;
    if (Number.isFinite(e.screenX)) this.lastScreenX = e.screenX;
    if (Number.isFinite(e.screenY)) this.lastScreenY = e.screenY;
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）；
    // 右键菜单/对话面板/权限确认框/设置弹窗开启同样整窗可交互（悬停菜单项/点输入框/点按钮都不触发穿透翻转）
    if (this.dragState.active || this.anyPanelOpen()) {
      this.setInteractive(true);
      return;
    }
    this.applyHitTest(this.lastClientX, this.lastClientY);
  }

  // 单击 280ms 去抖：双击时第二次 click 取消这次单击动画（press 粒子和积分在 pointerdown 已即时反馈，不受影响）
  onClickDebounced() {
    if (this.clickTimer !== null) window.clearTimeout(this.clickTimer);
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = null;
      this.onClick();
    }, 280);
  }

  // 双击打开对话框（与右键菜单「对话」同一入口；拖拽后误判防护与单击一致）
  onDblClick() {
    if (this.clickTimer !== null) {
      window.clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    this.showChatFromMenu();
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    const clicksPool = this.stylePool(this.animations.clicks);
    if (!clicksPool.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(clicksPool));
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // 桌面专属工具根项（对话 / 设置 / [碎碎念] / 回到初始位置 / 退出；碎碎念为条件项）
    // + 共享菜单树（动作→分类→具体动画）
    // 原「打开网站」与「查看余额」两项已按要求删除（宿主不再提供对应端点）；6 条余额档位动画
    // 还没出片，所以暂时也不在「动作」菜单里（名字见 assets/config.jsonc 末尾名单）。
    // 「碎碎念」只在真有碎碎念动画（animations.events.whisper 非空）时出现：这一项会先请宿主
    // **强制生成一句话**（真花额度），再抽 events.whisper 里的动画播 + 弹气泡；池子空时生成完
    // 什么都播不出来（showWhisper 直接 return，只留一行 console.error），所以宁可不显示。
    // 本项目 3 条碎碎念动画还没出片 → 现在不显示；出片并填进 config 后自动回来。
    const tools = [
      { label: '对话', action: 'chat' },
      { label: '设置', action: 'settings' },
      ...(this.animations.events?.whisper?.length ? [{ label: '碎碎念', action: 'whisper' }] : []),
      { label: '回到初始位置', action: 'home' },
      { label: '退出桌宠', action: 'quit' },
    ];
    const tree = tools.concat(S.buildMenuTree(this.animations));
    if (!tree.length) return;
    this.refreshVisibleRect(); // 菜单按"屏幕工作区 ∩ 窗口"钳制（shared-core 读取该全局）
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
      },
    });
    this.menuClose = m.close;
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'settings') {
      this.showSettingsDialog(); // 打开设置弹窗（开机自启 + 模型配置，内核桌宠扩展）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }
    if (leaf.action === 'quit') {
      // 退出走主进程（托盘同一条路径：先请宿主 dispose 整棵内核树，再 app.quit）
      if (window.petBridge && typeof window.petBridge.quitPet === 'function') window.petBridge.quitPet();
      return;
    }
    if (!leaf.anim) return;
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
  }

  // 「碎碎念」菜单：立即让 host 强制新生成一句并展示（绕过节流缓存；
  // /whisper/trigger 与周期端点同一逻辑但 force=true；失败显式告警，不伪造文案）
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期轮询，手动永远可用。
  showWhisperFromMenu() {
    S.fetchWhisperTrigger(WHISPER_URL + '/trigger?pet=' + encodeURIComponent(this.pet.id))
      .then((state) => {
        if (state.ok) {
          this.showWhisper(state.text);
        } else {
          console.warn('[dsh-pet] 菜单碎碎念失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''));
        }
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。
  //
  // 面板语义（2026-09 起）：**常驻对话面板**——发送后不关闭，回复在面板里逐字流式出现，
  // 关掉再打开会从宿主 /chat（内存转录）回放最近几轮；隐藏气泡在面板关闭时仍照常弹。
  showChatFromMenu() {
    if (this.chatDialog) {
      this.chatDialog.close();
      return; // 已开着：先关旧的（close() 回调里负责清引用）
    }
    this.refreshVisibleRect(); // 对话面板按"屏幕工作区 ∩ 窗口"钳制（shared-core 读取该全局）
    // 漫游冻结改为**跟着输入焦点**：正在打字时她别走开（面板钉在她旁边、满屏跟会很难受），
    // 手一离开输入框就放行漫游——面板跟随已经修好，她走哪儿面板跟到哪儿。
    // 打开时面板会自动聚焦输入框（mountChatDialog 末尾 input.focus()），所以初始就是冻结态。
    this.roamFrozen = true;
    this.stopMove();
    this.stopThrow();
    const hr = this.hit.getBoundingClientRect();
    const petId = encodeURIComponent(this.pet.id);
    // 气泡模式：面板只当输入框——发出去就收起来，答案在头顶气泡里逐字长出来。
    // 回合因此不能由面板自己驱动（面板一关就取消），改由渲染层跑 sendChatStream。
    const bubbleMode = chatForm === 'bubble';
    const streamUrl = BASE + '/chat/stream?pet=' + petId;
    let panel = null; // onSend 触发时句柄已就绪（挂载在下面完成）
    const m = S.mountChatDialog({
      petId: this.pet.id,
      petName: this.pet.name || this.pet.id,
      size: this.size,
      baseUrl: BASE + '/chat',
      x: Math.max(4, hr.right + 6),
      y: Math.max(4, hr.top + 6),
      // 回合走宿主流式端点（sendChatStream 默认实现；这里显式传是为了把取消也接到宿主）
      onCancel: () => {
        // 「停止」/关面板：显式请宿主取消在飞的回合并让出面板状态
        void fetch(BASE + '/chat/cancel?pet=' + petId, { method: 'POST' }).catch(() => {});
      },
      // 仅气泡模式接管回合：先收起面板（detach 不取消），再由渲染层把流写进气泡
      ...(bubbleMode
        ? {
            compact: true, // 极简输入条：只要一条输入框（回到之前那版气泡聊天的样子）
            onSend: (text, o) => {
              if (panel) panel.detach();
              return this.sendTurnToBubble(streamUrl, text, o);
            },
          }
        : {}),
      onReply: (reply) => {
        console.info('[dsh-pet] 对话回复 pet=' + this.pet.id + '「' + reply + '」');
        // 气泡模式：这句已经在气泡里显示并定稿（sendTurnToBubble），别再弹第二遍
        if (bubbleMode) return;
        // 面板开着就用面板展示（气泡只会重复一遍）；关掉后气泡仍是唯一出口
        if (!this.chatOpen) this.showWhisper(reply);
      },
      onClose: () => {
        this.chatDialog = null;
        this.chatClose = null;
        this.chatOpen = false;
        this.releaseChatPanelObserver(); // 断开尺寸订阅（下次打开重建）
        this.roamFrozen = false; // 面板关了：放行漫游（随机链下一次 roll 就会走动）
        window.__dshPetDebug.chatOpen = false;
        window.__dshPetDebug.chat = null;
        this.syncInteractive(); // 面板关了：还有别的面板就继续整窗可交互，否则回落命中区判定
      },
    });
    this.chatDialog = m;
    panel = m;
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    window.__dshPetDebug.chatOpen = true;
    window.__dshPetDebug.chat = m; // 排障/冒烟：面板句柄（isBusy/isFinished/append/restore）
    this.setInteractive(true);
    this.layoutChatDialog(); // 首次落位（贴宠物右侧，屏幕放不下则翻边/压窄）
    // 漫游开关跟着面板里的焦点走：焦点在面板内（打字/点按钮）冻结漫游，焦点离开就放行。
    // focusout 用 0ms 延迟复核 document.activeElement —— 面板内部换焦点（输入框→发送）也会触发它，
    // 直接当"离开"会让宠物在打字间隙走开。
    const syncRoamFreeze = () => {
      const el = m.el;
      const inside = el && typeof el.contains === 'function' && typeof document !== 'undefined'
        ? el.contains(document.activeElement)
        : true; // 拿不到 DOM 信息时保守冻结（宁可不走，也别在打字时跑掉）
      this.roamFrozen = inside;
    };
    if (m.el && typeof m.el.addEventListener === 'function') {
      m.el.addEventListener('focusin', syncRoamFreeze);
      m.el.addEventListener('focusout', () => window.setTimeout(syncRoamFreeze, 0));
    }
    // 历史回放：宿主内存转录（内核进程重启则空，但宠物自己的记忆在会话日志里）。
    // 气泡模式的输入条没有记录区，回放无处可放，直接跳过。
    if (!bubbleMode) {
      fetch(BASE + '/chat?pet=' + petId, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (!this.chatDialog || this.chatDialog !== m) return; // 期间面板被关掉：丢弃回放
          if (d && Array.isArray(d.messages) && typeof m.restore === 'function') m.restore(d.messages);
          this.layoutChatDialog(); // 回放改写了面板宽度/高度 → 重新落位
        })
        .catch((e) => console.warn('[dsh-pet] 对话历史读取失败', e));
    }
  }

  // 气泡模式的一个回合：面板已收起，答案写进头顶气泡。
  // 流式帧逐段替换气泡文本（气泡是「整段替换」渲染），终帧后按最终长度给阅读时间。
  async sendTurnToBubble(streamUrl, text, opts) {
    this.applyBubbleStep(this.bubbleQueue.begin('正在思考…', Date.now()));
    let last = '';
    const setLive = (t) => {
      this.bubbleQueue.update(t);
      this.renderBubble();
    };
    try {
      const result = await S.sendChatStream(
        streamUrl,
        text,
        (frame) => {
          if (!frame) return;
          if (frame.type === 'delta') {
            last = typeof frame.text === 'string' ? frame.text : '';
            setLive(last);
            return;
          }
          // 还没出正文时，把进度（思考/工具）显示在气泡里，让人知道她在干活
          if (last) return;
          if (frame.type === 'tool') setLive('正在执行 ' + (frame.name || '工具') + '…');
          else if (frame.type === 'status' || frame.type === 'reasoning') setLive(frame.text || '正在思考…');
        },
        opts,
      );
      if (result && result.ok) {
        // 长回复分屏：读完一屏再翻下一屏（每屏各自按字数给阅读时间）
        this.applyBubbleStep(this.bubbleQueue.finishPaged(result.reply || last, Date.now()));
        return result;
      }
      const aborted = !!(result && result.aborted);
      const raw = (result && (result.message || result.reason)) || '';
      const prefix = result && result.reason === 'provider-missing' ? '未配置模型：' : '对话失败：';
      // 与面板同一条规矩：宿主给的消息已带前缀时不再补一遍
      const already = prefix === '未配置模型：' ? /^(尚未)?(未)?配置模型/.test(raw) : /^对话失败/.test(raw);
      const message = aborted ? '已停止' : already ? raw : prefix + (raw || '未知原因');
      this.applyBubbleStep(this.bubbleQueue.finish(message, Date.now()));
      return result;
    } catch (e) {
      const message = '对话异常：' + String(e && e.message ? e.message : e);
      this.applyBubbleStep(this.bubbleQueue.finish(message, Date.now()));
      throw e; // 面板那边照旧走失败分支（面板已收起 → 只回调，不动 DOM）
    }
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  // ---- 碎碎念（每只宠物独立：按 eventsRefreshSec.whisper 周期轮询自己的句子，用本种类人设生成） ----
  startWhisperLoop() {
    if (!this.pet.whisperEnabled || this.whisperLoopTimer !== null) return;
    const intervalMs = Math.max(1000, (this.pet.eventsRefreshSec?.whisper ?? 3600) * 1000);
    const refresh = async () => {
      try {
        const petId = encodeURIComponent(this.pet.id);
        const state = await S.fetchWhisperState(WHISPER_URL + '?pet=' + petId);
        if (!this.whisperBaseline) {
          this.whisperBaseline = true; // 首次仅记基线：避免启动/刷新时重放历史事件
          if (state.ok) {
            this.prevWhisperTs = state.ts;
            this.whisperText = state.text;
          }
          return;
        }
        if (!state.ok) {
          console.warn(
            '[dsh-pet] 碎碎念生成失败 pet=' +
              this.pet.id +
              ' reason=' +
              state.reason +
              (state.message ? ' ' + state.message : ''),
          );
          return;
        }
        if (state.ts !== this.prevWhisperTs) {
          this.prevWhisperTs = state.ts;
          this.whisperText = state.text;
          this.showWhisper(state.text);
        }
      } catch (e) {
        console.warn('[dsh-pet] 碎碎念拉取异常 pet=' + this.pet.id, e);
      }
    };
    this.whisperLoopTimer = window.setInterval(() => void refresh(), intervalMs);
    void refresh();
  }

  // 命令触发气泡（/chat 斜杠命令）：1s 轻量轮询 /broadcast?pet=<id>，ts 变化即弹气泡。
  // 与碎碎念周期轮询独立（host 广播缓存是另一条通道）：手动触发语义不受 whisperEnabled 门控
  startBroadcastLoop() {
    if (this.broadcastLoopTimer !== null) return;
    const refresh = async () => {
      try {
        const petId = encodeURIComponent(this.pet.id);
        const res = await fetch(BASE + '/broadcast' + '?pet=' + petId, { cache: 'no-store' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => null)) || {};
        const ts = typeof d.ts === 'number' ? d.ts : 0;
        if (!this.broadcastBaseline) {
          // 首拉无条件记基线（含 ts=0）：若 ts=0 提前 return 会跳过基线建立，
          // 导致第一条命令广播被当成基线吃掉（该条永不弹）
          this.broadcastBaseline = true;
          this.prevBroadcastTs = ts;
          return;
        }
        if (ts === 0 || ts === this.prevBroadcastTs) return; // 无广播 / 无变化
        this.prevBroadcastTs = ts;
        if (typeof d.text === 'string' && d.text) this.showWhisper(d.text);
      } catch (e) {
        console.warn('[dsh-pet] 广播拉取异常 pet=' + this.pet.id, e);
      }
    };
    this.broadcastLoopTimer = window.setInterval(() => void refresh(), 1000);
    void refresh();
  }

  // 权限确认（内核桌宠扩展）：2s 轻轮询 /approval/pending?pet=<id>，有待决请求即弹
  // DOM 确认框（允许一次 / 拒绝）；用户点击 POST /approval/decide，宿主瀑布监听随之放行。
  // 仅当宿主处于 bubble 审批模式（DSH_PET_APPROVAL=bubble）时 pending 才会非空；auto 模式此循环恒空转。
  startApprovalLoop() {
    if (this.approvalLoopTimer !== null) return;
    const refresh = async () => {
      try {
        if (this.approvalShowing) return; // 一次只处理一个请求
        const petId = encodeURIComponent(this.pet.id);
        const res = await fetch(BASE + '/approval/pending' + '?pet=' + petId, { cache: 'no-store' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => null)) || {};
        const first = Array.isArray(d.pending) && d.pending.length > 0 ? d.pending[0] : null;
        if (first && typeof first.id === 'string') this.showApprovalDialog(first);
      } catch (e) {
        console.warn('[dsh-pet] 权限轮询异常 pet=' + this.pet.id, e);
      }
    };
    this.approvalLoopTimer = window.setInterval(() => void refresh(), 2000);
    void refresh();
  }

  // 工作状态联动（上游六档动画接进内核桌宠）：1s 轻轮询 /work-status?pet=<id>，
  // ts 变化即按档位播 animations.events.workStatus 对应动画 + 从 workStatusTexts 抽气泡文案。
  // 档位索引（与动画数组严格同序）：0 thinking / 1 working / 2 result / 3 waiting / 4 success / 5 error。
  startWorkStatusLoop() {
    if (this.workStatusLoopTimer !== null) return;
    if (!this.pet.workStatusEnabled) return;
    const pool = this.animations.events?.workStatus;
    if (!Array.isArray(pool) || pool.length < 6) return;
    const refresh = async () => {
      try {
        const petId = encodeURIComponent(this.pet.id);
        const res = await fetch(BASE + '/work-status' + '?pet=' + petId, { cache: 'no-store' });
        if (!res.ok) return;
        const d = (await res.json().catch(() => null)) || {};
        const ts = typeof d.ts === 'number' ? d.ts : 0;
        if (ts === 0 || ts === this.prevWorkStatusTs) return;
        this.prevWorkStatusTs = ts;
        if (d.state === null || d.state === undefined) {
          this.workState = null; // 空闲：当前档位动画播完就回 idle（不打断正在播的那一段）
          return;
        }
        const idx = { thinking: 0, working: 1, result: 2, waiting: 3, success: 4, error: 5 }[d.state];
        if (idx === undefined) return;
        if (!pool[idx]) return;
        // 档位槽位可以是字符串，也可以是候选数组（档内随机、循环自动轮换）——必须走 pickSlot：
        // 直接把数组当动画名喂给 playOnce 是坏的（旧版对数组槽位就是这样）
        const name = S.pickSlot(pool[idx], this.anim);
        if (!name) return;
        this.workState = d.state; // 记住档位：非终态播完要续播（见 handleEnded）
        this.workStatePool = pool;
        // 档位文案（每档多句随机抽；缺省该档只播动画不弹字）
        const texts = (config.workStatusTexts || [])[idx];
        const text = Array.isArray(texts) && texts.length > 0 ? texts[Math.floor(Math.random() * texts.length)] : '';
        this.stopMove();
        if (text) this.showWhisper(text); // 复用碎碎念链路：气泡 10s 自动消失
        this.playOnce(name);
      } catch (e) {
        console.warn('[dsh-pet] 工作状态轮询异常 pet=' + this.pet.id, e);
      }
    };
    this.workStatusLoopTimer = window.setInterval(() => void refresh(), 1000);
    void refresh();
  }

  // 权限确认框：白底圆角卡（气泡同款字体）+ 工具名/理由 + 「允许一次 / 拒绝」两个按钮。
  // 位置吸附身体命中区右上角（与对话弹窗同一定位源），超视口夹回。
  showApprovalDialog(req) {
    this.approvalShowing = true;
    this.approvalOpen = true;
    this.setInteractive(true); // 穿透守卫：弹窗期间整窗可交互（点按钮不被翻回穿透）
    this.refreshVisibleRect();

    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;z-index:2147483002;max-width:300px;background:rgba(255,255,255,.98);' +
      'border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.22);' +
      "color:#2b2b2b;font-size:13px;line-height:1.5;padding:10px 12px;user-select:none;" +
      "font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Microsoft YaHei UI','PingFang SC','Segoe UI','Microsoft YaHei',sans-serif";

    const title = document.createElement('div');
    title.textContent = '允许执行 ' + (req.toolName || '?') + ' 吗？';
    title.style.cssText = 'font-size:14px;margin-bottom:4px';
    root.appendChild(title);

    if (typeof req.reason === 'string' && req.reason) {
      const reason = document.createElement('div');
      reason.textContent = req.reason;
      reason.style.cssText = 'color:rgba(43,43,43,.6);font-size:12px;margin-bottom:8px;white-space:pre-wrap;overflow-wrap:anywhere';
      root.appendChild(reason);
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px';
    const mkBtn = (text, primary) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText =
        'border:none;border-radius:7px;padding:4px 12px;font-size:13px;cursor:pointer;font-family:inherit;' +
        (primary ? 'background:#4a7dff;color:#fff' : 'background:rgba(0,0,0,.07);color:#2b2b2b');
      return b;
    };
    const allow = mkBtn('允许一次', true);
    const deny = mkBtn('拒绝', false);
    row.appendChild(deny);
    row.appendChild(allow);
    root.appendChild(row);
    document.body.appendChild(root);

    // 位置：身体命中区右上角（右侧不足则翻左），按可视矩形夹取——绝不伸出屏幕
    this.placeDialog(root);

    const done = () => {
      root.remove();
      this.approvalShowing = false;
      this.approvalOpen = false;
      this.syncInteractive(); // 还有别的面板就继续整窗可交互，否则回落命中区判定
    };
    const decide = (outcome) => {
      allow.disabled = true;
      deny.disabled = true;
      fetch(BASE + '/approval/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: req.id, outcome }),
      })
        .catch((e) => console.warn('[dsh-pet] 权限回执异常', e))
        .finally(done);
    };
    allow.addEventListener('click', () => decide('allowed-once'));
    deny.addEventListener('click', () => decide('rejected'));
  }

  // 设置弹窗（内核桌宠扩展）：开机自启（注册表 Run 键，host 读写）+ 桌宠自己的模型配置
  // （协议/接口地址/API Key/模型 id——不再跟随 DSH 部署默认；保存后 host 注册 dsh-pet
  // 路由并关闭旧 Agent，下一句对话起用新模型）。
  // 打开时 GET /settings 拉当前值；保存 PUT /settings，失败在框内显式提示。
  showSettingsDialog() {
    if (this.settingsOpen) return;
    this.settingsOpen = true;
    this.setInteractive(true); // 穿透守卫：弹窗期间整窗可交互
    this.refreshVisibleRect();

    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;z-index:2147483002;width:320px;background:rgba(255,255,255,.98);' +
      'border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.22);' +
      "color:#2b2b2b;font-size:13px;line-height:1.6;padding:12px 14px;user-select:none;" +
      "font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Microsoft YaHei UI','PingFang SC','Segoe UI','Microsoft YaHei',sans-serif";

    const title = document.createElement('div');
    title.textContent = '设置';
    title.style.cssText = 'font-size:15px;margin-bottom:8px';
    root.appendChild(title);

    const fieldCss =
      'width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.18);border-radius:7px;' +
      'padding:5px 8px;font-size:12px;font-family:inherit;outline:none;margin-bottom:2px;background:#fff';
    const mkBtn = (text, primary) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText =
        'border:none;border-radius:7px;padding:4px 14px;font-size:13px;cursor:pointer;font-family:inherit;' +
        (primary ? 'background:#4a7dff;color:#fff' : 'background:rgba(0,0,0,.07);color:#2b2b2b');
      return b;
    };
    const labelTo = (parent, text) => {
      const d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'margin-bottom:4px';
      parent.appendChild(d);
      return d;
    };
    const actionsOf = (parent, buttons) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px';
      for (const b of buttons) row.appendChild(b);
      parent.appendChild(row);
      return row;
    };

    // ---- 两级页面 ----
    // 主页面：常用开关（开机自启 / 对话形式）+ 模型配置入口；
    // 模型配置页：协议 / 地址 / 密钥 / 模型 id——字段多，单独一页。
    // 以前全塞在一张卡里，卡片高度超过屏幕后**保存按钮被挤出屏幕点不到**（实机踩到过）。
    // 现在除了分页，字段区还有高度上限（超出内部滚动），按钮行永远留在屏幕内。
    const pageMain = document.createElement('div');
    const pageModel = document.createElement('div');
    const bodyMain = document.createElement('div');
    const bodyModel = document.createElement('div');
    pageMain.appendChild(bodyMain);
    pageModel.appendChild(bodyModel);
    pageModel.style.display = 'none';
    root.appendChild(pageMain);
    root.appendChild(pageModel);
    const capBodies = () => {
      const vis = this.visibleRect();
      // 卡片上下留出标题/按钮/边距，剩下的给字段区滚动
      const room = Math.max(150, vis.height - 160);
      for (const b of [bodyMain, bodyModel]) {
        b.style.maxHeight = room + 'px';
        b.style.overflowY = 'auto';
        b.style.overflowX = 'hidden';
      }
    };
    const showPage = (name) => {
      const isModel = name === 'model';
      pageMain.style.display = isModel ? 'none' : 'block';
      pageModel.style.display = isModel ? 'block' : 'none';
      title.textContent = isModel ? '设置 · 模型配置' : '设置';
      capBodies();
      this.placeDialog(root); // 换页后高度变了：重新落位（仍然夹在屏幕内）
    };

    // 开机自启
    const autoRow = document.createElement('label');
    autoRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:2px';
    const autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    const autoText = document.createElement('span');
    autoText.textContent = '开机自启 (登录后自动启动桌宠)';
    autoRow.appendChild(autoBox);
    autoRow.appendChild(autoText);
    bodyMain.appendChild(autoRow);
    // 自启目标回显：打包版写 exe 路径、源码版写隐藏启动器——写错目标时用户能一眼看出来
    const autoHint = document.createElement('div');
    autoHint.style.cssText = 'color:rgba(43,43,43,.5);font-size:11px;margin-bottom:10px;white-space:pre-wrap;overflow-wrap:anywhere';
    bodyMain.appendChild(autoHint);

    // 自启开关：勾一下立刻单独保存。它以前搭在「保存」上，而「保存」提交的是模型配置表单
    // （接口地址/模型 id 必填、首次还要 API Key）——于是只想开自启的用户必须先重填一遍
    // 模型信息才存得下去（实机踩到过）。
    let autoTargetText = '';
    let autoLocked = false; // 自启不可用（找不到启动入口）时锁定开关
    const setAutoHint = (extra) => {
      autoHint.textContent = [autoTargetText, extra].filter(Boolean).join('\n');
    };
    autoBox.addEventListener('change', () => {
      const want = autoBox.checked;
      autoBox.disabled = true;
      setAutoHint('正在保存…');
      fetch(BASE + '/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // 只发自启：宿主这条路径不碰模型配置，也就不需要 API Key
        body: JSON.stringify({ autostart: want }),
      })
        .then((res) => res.json())
        .then((r) => {
          if (r && r.ok) {
            setAutoHint(want ? '已开启开机自启' : '已关闭开机自启');
            return;
          }
          autoBox.checked = !want; // 失败回滚勾选状态，别让界面说谎
          setAutoHint('保存失败：' + ((r && r.message) || '未知错误'));
        })
        .catch((e) => {
          autoBox.checked = !want;
          setAutoHint('保存异常：' + String(e && e.message ? e.message : e));
        })
        .finally(() => {
          autoBox.disabled = autoLocked;
        });
    });

    // 对话形式（气泡 / 对话框）：与自启一样「改一下立刻单独存」——它跟模型配置无关，
    // 不该被模型表单的必填校验拦住，也不该要求 API Key。
    labelTo(bodyMain, '对话形式');
    const formSel = document.createElement('select');
    formSel.style.cssText = fieldCss;
    for (const f of [
      { id: 'bubble', label: '气泡 (她在头顶说话，更有对话感)' },
      { id: 'dialog', label: '对话框 (常驻面板，能回看聊天记录)' },
    ]) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      formSel.appendChild(opt);
    }
    bodyMain.appendChild(formSel);
    const formHint = document.createElement('div');
    formHint.style.cssText = 'color:rgba(43,43,43,.5);font-size:11px;margin-bottom:12px;white-space:pre-wrap;overflow-wrap:anywhere';
    const FORM_HINT =
      '气泡模式：聊天只用一条小输入条（回车发送），发完自动收起，回复在头顶气泡里逐字出现；' +
      '气泡按字数停留 (约 4.5 字/秒，最短 4 秒)，没读完不会被下一句顶掉。';
    formHint.textContent = FORM_HINT;
    bodyMain.appendChild(formHint);
    formSel.addEventListener('change', () => {
      const want = formSel.value === 'dialog' ? 'dialog' : 'bubble';
      const back = chatForm;
      formSel.disabled = true;
      fetch(BASE + '/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatForm: want }),
      })
        .then((res) => res.json())
        .then((r) => {
          if (r && r.ok) {
            chatForm = want; // 立即生效：下一次对话就按新形式走
            formHint.textContent = want === 'bubble' ? '已切换为气泡。' : '已切换为对话框。';
            return;
          }
          formSel.value = back;
          formHint.textContent = ['保存失败：' + ((r && r.message) || '未知错误'), FORM_HINT].join('\n');
        })
        .catch((e) => {
          formSel.value = back;
          formHint.textContent = ['保存异常：' + String(e && e.message ? e.message : e), FORM_HINT].join('\n');
        })
        .finally(() => {
          formSel.disabled = false;
        });
    });

    // 模型配置入口（二级页）：主页面只显示「当前生效」，字段都挪进模型配置页
    const modelRow = document.createElement('div');
    modelRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:2px';
    const modelRowText = document.createElement('div');
    modelRowText.style.cssText = 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    modelRowText.textContent = '模型配置';
    const modelOpenBtn = mkBtn('修改…', false);
    modelRow.appendChild(modelRowText);
    modelRow.appendChild(modelOpenBtn);
    bodyMain.appendChild(modelRow);
    const effectiveHint = document.createElement('div');
    effectiveHint.style.cssText = 'color:rgba(43,43,43,.5);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere';
    bodyMain.appendChild(effectiveHint);
    actionsOf(pageMain, [mkBtn('关闭', true)]).lastChild.addEventListener('click', () => close());

    // ---- 模型配置页（二级） ----
    labelTo(bodyModel, '接口协议');
    const protocolSel = document.createElement('select');
    protocolSel.style.cssText = fieldCss;
    const PROTOCOLS = [
      { id: 'openai-completions', label: 'OpenAI 兼容 (DeepSeek / 通义 / 月之暗面 / OpenRouter…)', base: 'https://api.deepseek.com' },
      { id: 'openai-responses', label: 'OpenAI Responses', base: 'https://api.openai.com/v1' },
      { id: 'anthropic-messages', label: 'Anthropic (Claude)', base: 'https://api.anthropic.com' },
    ];
    for (const p of PROTOCOLS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      protocolSel.appendChild(opt);
    }
    bodyModel.appendChild(protocolSel);

    labelTo(bodyModel, '接口地址 (baseURL)');
    const baseInput = document.createElement('input');
    baseInput.type = 'text';
    baseInput.placeholder = '如 https://api.deepseek.com';
    baseInput.style.cssText = fieldCss;
    bodyModel.appendChild(baseInput);

    // OpenCode Go 端点强制要求 x-opencode-session 会话头（否则 400 MissingSessionID）；
    // 本宠物在保存时会自动把该头附到 provider 路由上，这里仅作提示。
    const ocHint = document.createElement('div');
    ocHint.style.cssText = 'display:none;color:#3a6ea5;font-size:11px;margin-bottom:6px;white-space:pre-wrap;overflow-wrap:anywhere';
    ocHint.textContent = '检测到 OpenCode Go 端点：保存后会自动附带 x-opencode-session 会话头，避免 400 MissingSessionID。';
    bodyModel.appendChild(ocHint);
    const updateOcHint = () => {
      let isGo = false;
      try {
        const u = new URL(baseInput.value.trim());
        const host = u.hostname.toLowerCase();
        isGo = (host === 'opencode.ai' || host.endsWith('.opencode.ai')) && /\/zen\/go\/?/.test(u.pathname);
      } catch { /* 非法 URL 不提示 */ }
      ocHint.style.display = isGo ? 'block' : 'none';
    };
    baseInput.addEventListener('input', updateOcHint);

    labelTo(bodyModel, 'API Key');
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.placeholder = 'sk-…';
    keyInput.style.cssText = fieldCss;
    keyInput.autocomplete = 'off';
    bodyModel.appendChild(keyInput);
    const keyHint = document.createElement('div');
    keyHint.style.cssText = 'color:rgba(43,43,43,.5);font-size:11px;margin-bottom:6px';
    bodyModel.appendChild(keyHint);

    labelTo(bodyModel, '模型 id');
    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.placeholder = '如 deepseek-chat / gpt-4o-mini / claude-sonnet-4-5';
    modelInput.style.cssText = fieldCss;
    bodyModel.appendChild(modelInput);

    const modelHint = document.createElement('div');
    modelHint.style.cssText = 'color:rgba(43,43,43,.5);font-size:11px;margin-bottom:8px;white-space:pre-wrap;overflow-wrap:anywhere';
    bodyModel.appendChild(modelHint);

    // 切换协议时预填该协议的常用端点（仅在用户没手填过时）
    let baseTouched = false;
    baseInput.addEventListener('input', () => { baseTouched = true; });
    protocolSel.addEventListener('change', () => {
      if (baseTouched && baseInput.value.trim() !== '') return;
      const p = PROTOCOLS.find((x) => x.id === protocolSel.value);
      if (p) baseInput.value = p.base;
    });

    // 状态行（错误/成功提示）
    const status = document.createElement('div');
    status.style.cssText = 'color:#d94f3d;font-size:12px;min-height:16px;white-space:pre-wrap;overflow-wrap:anywhere';
    bodyModel.appendChild(status);

    // 按钮行：清除 / 返回主页 / 保存
    const clear = mkBtn('清除配置', false);
    const backBtn = mkBtn('返回', false);
    const save = mkBtn('保存', true);
    actionsOf(pageModel, [clear, backBtn, save]);
    backBtn.addEventListener('click', () => showPage('main'));
    modelOpenBtn.addEventListener('click', () => showPage('model'));
    document.body.appendChild(root);

    // 位置：身体命中区右上角（右侧不足则翻左），按可视矩形夹取——绝不伸出屏幕
    capBodies();
    this.placeDialog(root);

    const close = () => {
      root.remove();
      this.settingsOpen = false;
      this.syncInteractive(); // 还有别的面板就继续整窗可交互，否则回落命中区判定
    };

    // 只提交模型配置：自启/对话形式都是独立保存的（见上面的开关），不再捆在同一次「保存」里——
    // 否则模型表单的必填校验会把「只想改自启」的保存一起拦下来。
    const putSettings = (model, done) => {
      fetch(BASE + '/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      })
        .then((res) => res.json())
        .then((r) => {
          if (r && r.ok) {
            close();
          } else {
            status.textContent = '保存失败：' + ((r && r.message) || '未知错误');
            done();
          }
        })
        .catch((e) => {
          status.textContent = '保存异常：' + String(e && e.message ? e.message : e);
          done();
        });
    };

    // 载入当前值
    fetch(BASE + '/settings', { cache: 'no-store' })
      .then((res) => res.json())
      .then((s) => {
        autoBox.checked = !!s.autostart;
        formSel.value = s.chatForm === 'dialog' ? 'dialog' : 'bubble';
        // 自启不可用（找不到启动入口）时禁用开关并说明原因，而不是让保存后静默失败
        if (s.autostartMode === 'unsupported') {
          autoBox.checked = false;
          autoLocked = true;
          autoBox.disabled = true;
          autoRow.style.cursor = 'default';
          autoRow.style.opacity = '.6';
          autoTargetText = '不可用：' + (s.autostartReason || '未找到可注册的启动入口');
        } else {
          autoTargetText = '自启目标：' + (s.autostartTarget || '(未知)');
        }
        setAutoHint();
        const effectiveText = '当前生效：' + (s.effective ? s.effective.provider + '/' + s.effective.model : '未配置');
        effectiveHint.textContent = effectiveText;
        modelRowText.textContent = s.model ? '模型配置' : '模型配置 (尚未配置)';
        if (s.model) {
          if (PROTOCOLS.some((p) => p.id === s.model.protocol)) protocolSel.value = s.model.protocol;
          baseInput.value = s.model.baseURL || '';
          modelInput.value = s.model.model || '';
          keyHint.textContent = s.model.hasApiKey ? '已保存 API Key，留空表示不修改' : '尚未保存 API Key，请填写';
        } else {
          keyHint.textContent = '首次配置必填；密钥写入系统凭据存储，不进配置文件';
          const p = PROTOCOLS.find((x) => x.id === protocolSel.value);
          if (p) baseInput.value = p.base;
        }
        updateOcHint();
        modelHint.textContent = effectiveText;
        capBodies(); // 提示行填好后高度会变
        this.placeDialog(root);
      })
      .catch((e) => {
        status.textContent = '读取设置失败：' + String(e && e.message ? e.message : e);
      });

    save.addEventListener('click', () => {
      status.textContent = '';
      const baseURL = baseInput.value.trim();
      const model = modelInput.value.trim();
      if (baseURL === '' || model === '') {
        status.textContent = '接口地址与模型 id 必填 (或点「清除配置」停用模型)';
        return;
      }
      save.disabled = true;
      putSettings(
        { protocol: protocolSel.value, baseURL, model, apiKey: keyInput.value.trim() },
        () => { save.disabled = false; },
      );
    });
    clear.addEventListener('click', () => {
      status.textContent = '';
      clear.disabled = true;
      putSettings(null, () => { clear.disabled = false; });
    });
  }

  // 碎碎念展示（本宠物）：随机抽 events.whisper 动画 + 弹文本气泡。
  // 停留时长按字数给阅读时间；气泡里正显示/排队着真回复时这条直接丢弃——随口一句
  // 不该盖住正经回答，也不该排在它前面（队列规则见 shell/ours/bubble.ts）。
  showWhisper(text) {
    const pool = this.animations.events?.whisper;
    if (!pool || pool.length === 0) {
      console.error('[dsh-pet] 配置缺少 animations.events.whisper，无法播放碎碎念动画');
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const name = S.pickSlot(picked, this.anim); // 槽位可能是候选数组（档内随机）
    if (!name) return;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' whisper pet=' +
        this.pet.id +
        ' -> [' +
        name +
        '] 「' +
        text +
        '」',
    );
    this.stopMove();
    this.playOnce(name);
    this.pushBubble('whisper', text);
  }

  // ---------- 气泡队列（碎碎念 / 对话回复 / 命令提示共用） ----------
  // 一条气泡的完整生命周期：push/begin → (update) → finish → 到点 next。
  // 渲染层只做两件事：按步骤重画气泡、按剩余停留时间定时器推进队列。

  /** 推一条一次性气泡（碎碎念 / 已拿到整段文本的回复）。 */
  pushBubble(kind, text) {
    this.applyBubbleStep(this.bubbleQueue.push(kind, text, Date.now()));
  }

  /** 执行队列给出的一步：show=重画并计时，hide=收起，空步骤=什么都不做（被丢弃）。 */
  applyBubbleStep(step) {
    if (!step) return;
    if (step.show) {
      this.bubbleItem = step.show;
      this.renderBubble();
      this.armBubbleTimer();
      return;
    }
    if (step.hide) {
      this.bubbleItem = null;
      this.renderBubble();
      this.armBubbleTimer();
    }
  }

  /** 按当前条目的剩余停留时间设置定时器；流式回复期间不计时（流结束才 finish）。 */
  armBubbleTimer() {
    if (this.bubbleTimer !== null) {
      window.clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    const ms = this.bubbleQueue.remaining(Date.now());
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.bubbleTimer = window.setTimeout(() => {
      this.bubbleTimer = null;
      this.applyBubbleStep(this.bubbleQueue.next(Date.now()));
    }, ms);
  }

  renderBubble() {
    const item = this.bubbleItem;
    // 变体样式：碎碎念=小字号自适应宽；对话=正常字号（气泡里说话的是「她」）
    this.bubble.classList.toggle('is-whisper', !!item && item.kind === 'whisper');
    this.bubble.classList.toggle('is-chat', !!item && item.kind === 'chat');
    if (item) {
      this.bubble.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = item.text;
      this.bubble.appendChild(line);
      this.bubble.classList.add('is-on');
      window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
      return;
    }
    this.bubble.classList.remove('is-on');
    window.__dshPetDebug.lastBubbleTitle = '';
  }
}

// ---------- 事件循环启动（每只宠物各自的轮询：碎碎念 / 命令气泡 / 审批 / 工作状态） ----------
function startLoops() {
  if (loopsStarted) return;
  loopsStarted = true;

  // 碎碎念：每只启用宠物独立轮询（startWhisperLoop）——各自周期、各自人设、各自一句话（与浏览器一致）
  for (const s of sprites) s.startWhisperLoop();
  // 命令触发气泡：每只宠物独立 1s 轻轮询（startBroadcastLoop）——/chat 命令写入即展示
  for (const s of sprites) s.startBroadcastLoop();
  // 权限确认（内核桌宠扩展）：每只宠物独立 2s 轻轮询（startApprovalLoop）——bubble 模式下有待决即弹确认框
  for (const s of sprites) s.startApprovalLoop();
  // 工作状态联动（上游六档动画）：每只启用宠物独立 1s 轻轮询（startWorkStatusLoop）
  for (const s of sprites) s.startWorkStatusLoop();
}

// ---------- 启动（配置校验通过才建 sprite；失败大声报错 + 5s 自动重试） ----------
async function boot() {
  try {
    const cfg = await loadConfig();
    config = cfg;
    await loadChatForm(); // 对话形式（读不到就用默认：气泡）
    hideError();
    const pets = cfg.pets.filter((p) => S.isDesktopVisible(p.display));
    if (pets.length === 0) {
      showError('配置中没有 display 为 desktop/both 的宠物，桌面模式不显示宠物');
      scheduleReboot();
      return;
    }
    // 本窗口只承载一只宠物：petIndex 由主进程按 DSH_PET_PETS 顺序注入
    const pet = pets[CONFIG.petIndex];
    if (!pet) {
      showError('petIndex=' + CONFIG.petIndex + ' 超出桌面宠物列表（共 ' + pets.length + ' 只），本窗口不创建宠物');
      scheduleReboot();
      return;
    }
    for (const s of sprites) s.dispose();
    sprites = [new PetSprite(pet)];
    window.__dshPetDebug.configOk = true;
    window.__dshPetDebug.spriteCount = sprites.length;
    for (const s of sprites) s.playIdle();
    startLoops();
  } catch (e) {
    showError('配置加载失败：' + (e && e.message ? String(e.message) : String(e)));
    scheduleReboot();
  }
}

// 注入打字资源：界面字体 + 点击/拖拽光标图标（与浏览器 overlay 同一套素材，host 经 /dsh-pet-7340/ 提供）
// 字体：槽位文件名「上首软糖体.ttf」是历史遗留的硬编码槽位名（不代表字体身份），
// 里面装的是本项目自带的界面字体——站酷快乐体 2016（HappyZcool-2016，© LuiBingKe 2016）；
// CSS 侧一律用 family 别名 ShangshouSoftCandy，换字体只换 assets/fonts/ 里的文件即可。
function injectAssets() {
  const style = document.createElement('style');
  style.textContent =
    '@font-face{font-family:"ShangshouSoftCandy";src:url("' +
    BASE +
    '/font/' +
    encodeURIComponent('上首软糖体') +
    '.ttf") format("truetype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:url("' +
    BASE +
    '/pic/cursor-grab.png") 16 16, grab}' +
    '.pet-hit.dragging{cursor:url("' +
    BASE +
    '/pic/cursor-grabbing.png") 16 16, grabbing}';
  document.head.appendChild(style);
  // 统一右键菜单样式（与浏览器注入同一份 MENU_CSS）
  const menuStyle = document.createElement('style');
  menuStyle.textContent = S.MENU_CSS;
  document.head.appendChild(menuStyle);
  checkUiFont();
}

/**
 * 界面字体自检：@font-face 指向宿主 `/font/` 的 HTTP 请求，加载失败会**静默**回退到
 * 后备字体族 —— 界面看起来"字不对/粗细不对"，但控制台与日志里没有任何报错
 * （真实踩过：字体槽位被换成另一套字，排查花了很久）。
 *
 * 结果写进 `window.__dshPetDebug.fontOk`：截图冒烟与现场排障都看这一个值。
 * 注意只报事实，不阻断启动 —— 字体没加载时软件仍然可用，只是不好看。
 */
function checkUiFont() {
  const probe = '13px ShangshouSoftCandy';
  const report = (ok, note) => {
    window.__dshPetDebug.fontOk = ok;
    if (ok) console.info('[dsh-pet] 界面字体已加载 (' + note + ')');
    else console.warn('[dsh-pet] 界面字体未加载，已回退后备字体族——检查 assets/fonts/ 与宿主 /font/ 路由：' + note);
  };
  if (!document.fonts || typeof document.fonts.load !== 'function') {
    report(false, 'document.fonts 不可用');
    return;
  }
  document.fonts
    .load(probe)
    .then((faces) => {
      const ok = faces.length > 0 && document.fonts.check(probe);
      report(ok, ok ? (faces[0].family || 'ShangshouSoftCandy') : '无匹配字面');
    })
    .catch((e) => report(false, String(e && e.message ? e.message : e)));
}

// 工作区尺寸由主进程注入并在进程生命周期内不变；窗口本身跟随宠物移动，
// 这里仍兜底处理窗口内容区尺寸异常的情况（按当前窗口位置重新规整）。
window.addEventListener('resize', () => {
  for (const s of sprites) s.position();
});

// 托盘命令（内核桌宠扩展）：主进程托盘菜单 → 与右键菜单同一条动作路径
// （sprite 在 boot() 里才建出来，所以这里按调用时读取，不能提前取 sprites[0]）。
if (window.petBridge && typeof window.petBridge.onHostCommand === 'function') {
  window.petBridge.onHostCommand((payload) => {
    const command = payload && payload.command;
    const sprite = sprites[0];
    if (!sprite) return;
    if (command === 'chat') sprite.showChatFromMenu();
    else if (command === 'settings') sprite.showSettingsDialog();
    else if (command === 'home') sprite.goHome();
  });
}

injectAssets();
void boot();
