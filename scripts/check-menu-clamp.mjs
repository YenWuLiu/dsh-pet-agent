#!/usr/bin/env node
/**
 * check-menu-clamp.mjs —— 右键菜单「夹取基准」兼容层的无头验收。
 *
 * 守的是什么：上游 v0.2.11 的 `mountContextMenu` 不再读全局 `window.__dshPetVisibleRect`，
 * 改成显式 `clamp` 参数；本项目渲染层仍走旧契约（打开菜单前写全局，不传 clamp）。
 * `shell/ours/menu.ts` 这层薄包装负责把旧全局翻译成 `clamp`。若这层失效（被上游同名实现
 * 顶掉、或翻译写错），**不会抛异常**——只是宠物贴屏幕边缘时菜单落到屏幕外的不可见区，
 * 肉眼很难复现，所以在无头环境用 DOM 桩把行为钉死。
 *
 * 打的是**真实产物** `runtime/electron-helper/shared-core.js`（不是源码），
 * 因此顺带覆盖了「构建产物里的 mountContextMenu 确实是我们的实现」。
 *
 * 放在 scripts/ 而不是 tools/：本仓库 .gitignore 忽略了整个 tools/（见该文件注释），
 * 验收闸必须随仓库走，否则会在提交时静默消失。
 *
 * 用法：node scripts/check-menu-clamp.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'runtime', 'electron-helper', 'shared-core.js');

// ---------------------------------------------------------------- DOM 桩
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.className = '';
    this._text = '';
    this._listeners = new Map();
    // 菜单定位要用面板尺寸；给成定值才能算出可断言的 left/top
    this.offsetWidth = 200;
    this.offsetHeight = 150;
  }
  get classList() {
    const self = this;
    const set = () => new Set(self.className.split(' ').filter(Boolean));
    return {
      add: (...c) => { const s = set(); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { const s = set(); c.forEach((x) => s.delete(x)); self.className = [...s].join(' '); },
      contains: (c) => set().has(c),
      toggle: (c, on) => { if (on) self.classList.add(c); else self.classList.remove(c); },
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  addEventListener(type, fn) {
    const list = this._listeners.get(type) ?? [];
    list.push(fn);
    this._listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this._listeners.set(type, (this._listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  contains(node) { return node === this || this.children.some((c) => c.contains(node)); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

/** 造一个上下文：window 尺寸固定 2400×1400，可视矩形按用例设置。 */
function makeContext(visibleRect) {
  const body = new El('body');
  const document = {
    body,
    createElement: (tag) => new El(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    innerWidth: 2400,
    innerHeight: 1400,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  if (visibleRect !== undefined) window.__dshPetVisibleRect = visibleRect;
  const sandbox = { window, document, console, fetch: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: BUNDLE });
  const api = sandbox.window.PetShared ?? sandbox.PetShared;
  if (!api) throw new Error('产物没有暴露 PetShared');
  return { api, body };
}

/** 挂一个菜单，返回根面板的关键样式。 */
function mount(ctx, { tree, x, y, clamp }) {
  const opts = { tree, x, y, onAction: () => {} };
  if (clamp !== undefined) opts.clamp = clamp;
  const mount1 = ctx.api.mountContextMenu(opts);
  const panel = mount1.el.children[0];
  const result = {
    left: panel?.style.left,
    top: panel?.style.top,
    maxHeight: panel?.style.maxHeight,
    close: mount1.close,
  };
  mount1.close();
  return result;
}

const TREE = [{ label: '动作', children: [{ label: '待机呼吸', anim: '待机呼吸' }] }];
const CHECKS = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  CHECKS.push({ name, ok, actual, expected });
};

// 1) 旧全局存在 → 夹取矩形 = 该全局（800×300，远小于窗口 2400×1400）
//    期望：left 被夹到 800-200-4=596，top 被夹到 300-150-4=146，列高封顶 300-16=284
const legacy = makeContext({ x0: 0, y0: 0, x1: 800, y1: 300 });
check(
  '旧全局 → 位置夹进可视矩形',
  (() => { const r = mount(legacy, { tree: TREE, x: 790, y: 290 }); return [r.left, r.top]; })(),
  ['596px', '146px'],
);
check(
  '旧全局 → 列高按可视矩形封顶',
  mount(legacy, { tree: TREE, x: 790, y: 290 }).maxHeight,
  '284px',
);

// 2) 没有旧全局 → 回落整个窗口视口（上游原生行为），且不设 maxHeight
const none = makeContext(undefined);
check(
  '无全局 → 按窗口夹取（回落行为不变）',
  (() => { const r = mount(none, { tree: TREE, x: 790, y: 290 }); return [r.left, r.top]; })(),
  ['790px', '290px'],
);
check('无全局 → 不设列高上限（上游原生分支）', mount(none, { tree: TREE, x: 790, y: 290 }).maxHeight, undefined);

// 3) 显式 clamp 优先于旧全局（调用方给了就用它的）
check(
  '显式 clamp 优先',
  (() => {
    const r = mount(legacy, { tree: TREE, x: 790, y: 290, clamp: { x: 0, y: 0, w: 500, h: 200 } });
    return [r.left, r.top, r.maxHeight];
  })(),
  ['296px', '46px', '184px'],
);

// 4) 旧全局含非有限值 → 视为无效，回落窗口视口（不把 NaN 传进上游）
const broken = makeContext({ x0: 0, y0: 0, x1: Number.NaN, y1: 300 });
check(
  '无效全局 → 回落窗口（不传 NaN clamp）',
  (() => { const r = mount(broken, { tree: TREE, x: 790, y: 290 }); return [r.left, r.maxHeight]; })(),
  ['790px', undefined],
);

// ---------------------------------------------------------------- 报告
let failed = 0;
for (const c of CHECKS) {
  if (c.ok) {
    console.log(`PASS  ${c.name}  ${JSON.stringify(c.actual)}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}`);
    console.log(`      期望 ${JSON.stringify(c.expected)}`);
    console.log(`      实际 ${JSON.stringify(c.actual)}`);
  }
}
console.log(`\n${CHECKS.length - failed}/${CHECKS.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
