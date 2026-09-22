/**
 * shell/ours/menu.ts —— 右键菜单的「夹取基准」兼容层（薄包装，不复制上游实现）。
 *
 * 背景（上游 v0.2.11 的接口变更）：
 *   旧版 `mountContextMenu` 自己读全局 `window.__dshPetVisibleRect`（渲染端在打开菜单前写入
 *   ——「屏幕工作区 ∩ 窗口」），用于把菜单/子面板夹在**真正可见**的矩形内；没有该全局时
 *   回落整个窗口视口。
 *   新版改成显式可选参数 `clamp: {x,y,w,h}`，**不再读那个全局**；不传 = 按 window.innerWidth/Height
 *   夹取。上游桌面壳因此改成自己算好再传进去（见上游 runtime/electron-helper/sprite.js 的
 *   `visibleClampRect()`）。
 *
 * 问题：本项目渲染层 `runtime/electron-helper/renderer.js` 打开菜单时不传 `clamp`
 *   （它走的是旧契约：先写全局再调用）。直接换新版会让菜单退回「按窗口尺寸夹取」——
 *   桌面窗比屏幕大出宠物四周外扩余量，宠物贴屏幕边缘时菜单/子面板会落进屏幕外的不可见区
 *   （不抛异常，纯定位回归）。
 *
 * 本包装：调用方没给 `clamp` 时，从旧全局推导出 `clamp` 再交给上游实现。
 *   - 语义等价：`{x: x0, y: y0, w: x1-x0, h: y1-y0}`；
 *   - 有限性判据与旧版一致（只查 x1/y1）；x0/y0 缺失时由上游自己的有限性守卫回落整视口
 *     （比旧版算出 NaN 更安全）；
 *   - 顺带获得上游两项改进：每列内联 `maxHeight` 封顶 + 新版 `MENU_CSS` 的滚动条样式
 *     （两者都是上游对同一类「面板溢出被裁」问题的修法，方向一致）。
 *
 * 待办（step2 重构渲染层时）：让 renderer 直接传 `clamp`，然后删掉本包装。
 */
import { mountContextMenu as upstreamMountContextMenu } from '../shared/menu';
import type { ContextMenuMount, MenuNode, MenuLeaf } from '../shared/menu';

/** 旧契约里渲染端写入的全局矩形（视口坐标）。 */
interface LegacyVisibleRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 菜单挂载（兼容签名）：与上游同参，外加「未传 clamp 时按旧全局推导」。
 * @param opts 上游 `mountContextMenu` 的全部选项。
 * @returns 上游的 `{el, close}`。
 */
export function mountContextMenu(opts: {
  tree: MenuNode[];
  x: number;
  y: number;
  onAction: (leaf: MenuLeaf) => void;
  onClose?: () => void;
  clamp?: { x: number; y: number; w: number; h: number };
}): ContextMenuMount {
  if (opts.clamp !== undefined) return upstreamMountContextMenu(opts);
  const rect =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { __dshPetVisibleRect?: LegacyVisibleRect }).__dshPetVisibleRect;
  if (rect === undefined || !Number.isFinite(rect.x1) || !Number.isFinite(rect.y1)) {
    return upstreamMountContextMenu(opts);
  }
  return upstreamMountContextMenu({
    ...opts,
    clamp: { x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 },
  });
}
