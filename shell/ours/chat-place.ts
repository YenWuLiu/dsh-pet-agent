/**
 * shell/ours/chat-place.ts —— 对话面板落位（纯函数，无 DOM；屏幕边缘碰撞检测的唯一实现）。
 *
 * 为什么需要它：
 *   面板是宠物窗口内的 DOM，窗口跟着宠物走 → 面板"被动跟随"。但只要窗口有一部分在屏幕外
 *   （宠物贴屏幕边缘时必然如此），面板就可能整块落到看不见的区域；而且窗口内的余量
 *   （WINDOW_MARGIN_RATIO × 宠物尺寸）是有限的，面板比余量宽时会被窗口裁掉。
 *   本模块把「贴哪边、贴多宽、夹到哪」算成一组纯数值，渲染层只负责测量与赋值。
 *
 * 规则（按优先级）：
 *   1. 优先贴宠物**右侧**；右侧在屏幕内放不下 → 翻到**左侧**（这就是"边缘碰撞"：撞到屏幕
 *      边缘就弹到另一边，与右键菜单/审批框同一套语义）；
 *   2. 两侧都放不下 → 选空间较大的一侧，把面板**压窄**到该侧空间（下限 minWidth，再窄没法读）；
 *   3. 竖直方向：先贴宠物上缘，再夹进可视矩形；面板比可视区还高就返回 maxHeight 让它内部滚动；
 *   4. 最后左右/上下都夹一次——即使空间不足（例如宠物几乎占满可视区），也保证面板**不出屏**
 *      （此时允许压住宠物：可读性 > 不遮挡）。
 *
 * 坐标系：一律**窗口坐标**（`pet` 来自命中区 getBoundingClientRect，`vis` 来自渲染层的
 * visibleRect() = 屏幕工作区 ∩ 本窗口）。调用方在每次宠物位置变化后重新调用即可。
 * 审批/设置弹窗也走本函数（传 `minWidth = 自身宽度` → 只借位置、不被压窄）。
 *
 * 验收：scripts/check-chat-placement.mjs（17 项 + 2600 组穷举扫描）。
 */

/** 宠物命中区（窗口坐标，通常是 getBoundingClientRect 的产物）。 */
export interface PetRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 面板当前尺寸。 */
export interface PanelBox {
  width: number
  height: number
}

/** 可视矩形（窗口坐标）：屏幕工作区 ∩ 本窗口。 */
export interface VisibleBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 落位入参。 */
export interface PlaceChatPanelOpts {
  /** 宠物身体命中区（窗口坐标） */
  pet: PetRect
  /** 面板当前尺寸 */
  panel: PanelBox
  /** 可视矩形：面板只能落在这里面 */
  vis: VisibleBox
  /** 面板与宠物之间的间距（缺省 6） */
  gap?: number
  /** 面板与可视矩形边缘的最小留白（缺省 4） */
  pad?: number
  /** 压窄下限（缺省 140）：低于它就不压了，宁可压住宠物 */
  minWidth?: number
}

/** 落位结果。 */
export interface ChatPlacement {
  /** 最终贴边 */
  side: 'left' | 'right'
  left: number
  top: number
  /** 仅在需要压窄时出现：调用方据此施加宽度上限 */
  maxWidth?: number
  /** 仅在需要收矮时出现：调用方据此施加高度上限（面板内部滚动） */
  maxHeight?: number
  /** 两侧可用空间（调试/测试用） */
  room: { left: number; right: number }
}

/**
 * 计算对话面板的落位。
 * @param o 入参（宠物命中区 / 面板尺寸 / 可视矩形 / 间距 / 留白 / 压窄下限）。
 * @returns 落位结果：`maxWidth`/`maxHeight` 仅在需要收窄/收矮时出现。
 */
export function placeChatPanel(o: PlaceChatPanelOpts): ChatPlacement {
  const { pet, panel, vis } = o;
  const gap = o.gap ?? 6;
  const pad = o.pad ?? 4;
  const minWidth = o.minWidth ?? 140;

  const desiredW = Math.max(0, Math.round(panel.width));
  const desiredH = Math.max(0, Math.round(panel.height));

  // ---- 横向：右侧优先，放不下翻左侧，两侧都窄就压窄 ----
  const roomRight = Math.floor(vis.x1 - pad - (pet.right + gap));
  const roomLeft = Math.floor(pet.left - gap - (vis.x0 + pad));
  let side: 'left' | 'right';
  if (desiredW <= roomRight) side = 'right';
  else if (desiredW <= roomLeft) side = 'left';
  else side = roomRight >= roomLeft ? 'right' : 'left';

  const room = Math.max(0, side === 'right' ? roomRight : roomLeft);
  // 压窄：不超过期望宽度，不低于 minWidth（空间实在不够时允许略微压住宠物，但不出屏）
  const width = desiredW <= room ? desiredW : Math.max(Math.min(minWidth, desiredW), room);
  const maxWidth = width < desiredW ? width : undefined;

  const wantLeft = side === 'right' ? pet.right + gap : pet.left - gap - width;
  const loX = vis.x0 + pad;
  const hiX = Math.max(loX, vis.x1 - pad - width);
  const left = Math.min(Math.max(wantLeft, loX), hiX);

  // ---- 纵向：贴上缘 → 夹进可视区 → 太高就压矮（面板内部滚动）----
  const availH = Math.floor((vis.y1 - pad) - (vis.y0 + pad));
  const height = desiredH <= availH ? desiredH : Math.max(0, availH);
  const maxHeight = height < desiredH ? height : undefined;
  const loY = vis.y0 + pad;
  const hiY = Math.max(loY, vis.y1 - pad - height);
  const top = Math.min(Math.max(pet.top + gap, loY), hiY);

  return { side, left, top, maxWidth, maxHeight, room: { left: roomLeft, right: roomRight } };
}
