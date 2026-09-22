#!/usr/bin/env node
/**
 * check-shared-parity.mjs —— 外壳纯逻辑层「新旧产物差分比对」。
 *
 * 背景：`runtime/electron-helper/shared-core.js` 已从「手改的构建产物」改为由
 * `shell/`（上游 dsh-pet v0.2.11 的 src/shared 逐字节副本 + 本项目覆盖层）构建。
 * 重建会顺带把上游这一年的逻辑改动带进来 —— 这是目的，但**同名函数语义漂移**
 * 会让渲染层静默出错（面板自检只覆盖对话模块，菜单/物理/常量它看不到）。
 *
 * 本脚本把旧产物（shell/legacy/shared-core.built-old.js）与当前产物放进两个
 * 独立的 vm 上下文，用**同一批输入**调用同一批纯函数，逐项比对返回值：
 *   - 纯函数：深度相等比对（SAME / DIFF / THROW）
 *   - 含随机的函数：不比对具体取值，改比对不变量（取值域、合法形状）
 *   - 常量：全部共有键深度比对（默认参数漂移是"看不见的行为变化"）
 *
 * 判定策略：DIFF 不直接失败 —— 有些漂移是**预期内的收益**（上游新增能力/修 bug）。
 * 脚本打印完整 diff，并把「渲染层真正依赖的符号」清单标出来，由人判断是否需要
 * 在 shell/ours/ 里做覆盖。加 `--strict` 则任何 DIFF 都算失败（用于回归场景）。
 *
 * 用法：node scripts/check-shared-parity.mjs [--strict]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_FILE = join(ROOT, 'shell', 'legacy', 'shared-core.built-old.js');
const NEW_FILE = join(ROOT, 'runtime', 'electron-helper', 'shared-core.js');
const STRICT = process.argv.includes('--strict');

/** 在独立上下文里加载一份产物，返回 window.PetShared。 */
function load(file) {
  if (!existsSync(file)) throw new Error(`产物不存在：${file}`);
  const sandbox = { window: {}, console, fetch: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
  const api = sandbox.window.PetShared ?? sandbox.PetShared;
  if (!api) throw new Error(`${file}: 没有暴露 PetShared`);
  return api;
}

const oldApi = load(OLD_FILE);
const newApi = load(NEW_FILE);

/** 渲染层实际引用的符号（从 runtime/electron-helper/*.js 扫出来）。 */
function shellSymbols() {
  const dir = join(ROOT, 'runtime', 'electron-helper');
  const re = /(?:\bS|window\.PetShared|PetShared)\.([A-Za-z_$][\w$]*)/g;
  const set = new Set();
  for (const name of readdirSyncSafe(dir)) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const m of text.matchAll(re)) set.add(m[1]);
  }
  return set;
}
function readdirSyncSafe(dir) {
  // 只扫渲染层脚本，跳过产物自身
  return readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'shared-core.js');
}
const USED = shellSymbols();

// ---------------------------------------------------------------- 比对工具
const diffs = [];
const throws = [];
let same = 0;

/** 递归深度比对（NaN 视为相等；对象键序无关）。 */
function deepEqual(a, b) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
const show = (v) => {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
  return s === undefined ? String(v) : s.length > 220 ? s.slice(0, 217) + '...' : s;
};

/**
 * 用同一批输入调用新旧两版同名函数并比对结果。
 * @param name 裸函数名（比对用）
 * @param expr 形如 (S) => S.xxx(...) 的调用表达式
 * @param note 人类可读的用例说明
 */
function probe(name, expr, note) {
  let a, b, ea, eb;
  try { a = expr(oldApi); } catch (e) { ea = e; }
  try { b = expr(newApi); } catch (e) { eb = e; }
  if (ea || eb) {
    throws.push({ name, note, old: ea ? String(ea.message ?? ea) : show(a), new: eb ? String(eb.message ?? eb) : show(b) });
    return;
  }
  if (deepEqual(a, b)) { same++; return; }
  diffs.push({ name, note, old: show(a), new: show(b) });
}

/** 不变量探针：含随机/含环境的函数，只校验"取值落在合法域内"。 */
const invariantFails = [];
function invariant(name, note, fn) {
  for (const [label, api] of [['旧', oldApi], ['新', newApi]]) {
    let ok = true, detail = '';
    try { const r = fn(api); ok = r === true; detail = r === true ? '' : String(r); }
    catch (e) { ok = false; detail = String(e.message ?? e); }
    if (!ok) invariantFails.push(`${name} [${label}] ${note}: ${detail}`);
  }
}

// ---------------------------------------------------------------- 夹具
const PHYS = { gravity: 2400, restitution: 0.42, groundFriction: 6, ceilingBounce: true, throwPower: 1, petCollision: true };
const BOUNDS_ARGS = { W: 1920, H: 1040, size: 462, sideAllow: 115.5 };
const bounds = oldApi.throwBounds(BOUNDS_ARGS);
const trail = [
  { x: 100, y: 100, t: 0 },
  { x: 140, y: 96, t: 16 },
  { x: 190, y: 90, t: 33 },
  { x: 260, y: 80, t: 50 },
];
const colliderA = { x: 300, y: 200, vx: 900, vy: -120, size: 462 };
const colliderB = { x: 520, y: 190, vx: -200, vy: 0, size: 300 };
const ANIMATIONS = ['idle', 'turn', 'drag', 'clicks', 'move', 'styleTurn', 'whisper', 'workStatus', 'balance'];
/** 与 src/shared/types.ts 的 Animations 同构的最小夹具（真实形态取自 assets/config.jsonc）。 */
const ANIM_CFG = {
  idle: ['待机呼吸'],
  turn: ['东张西望'],
  drag: ['被抓起悬空'],
  clicks: ['点击回应-开心', '点击回应-惊讶'],
  moves: { actions: [{ name: '螃蟹走路' }, { name: '原地漂浮踏步' }] },
  categories: [
    { id: '小动作', actions: ['打哈欠', '伸懒腰'], weight: 10, noMirror: false },
    { id: '玩耍', actions: ['玩魔方'], weight: 5, noMirror: true },
  ],
  events: { whisper: ['碎碎念'], workStatus: ['思考中', '干活中'], balance: ['钱袋满溢', '分文不剩'] },
};

// ---------------------------------------------------------------- 常量比对
for (const key of Object.keys(oldApi).sort()) {
  if (!(key in newApi)) continue;
  const a = oldApi[key];
  const b = newApi[key];
  if (typeof a === 'function' || typeof b === 'function') continue;
  if (deepEqual(a, b)) { same++; continue; }
  diffs.push({ name: key, note: `常量（${USED.has(key) ? '渲染层在用' : '渲染层未用'}）`, old: show(a), new: show(b) });
}

// ---------------------------------------------------------------- 物理/几何
probe('throwBounds', (S) => S.throwBounds(BOUNDS_ARGS), '单一工作区边界');
probe('throwStep', (S) => S.throwStep({ x: bounds.maxX - 2, y: bounds.maxY - 2, vx: 1500, vy: -300 }, 1 / 60, bounds, PHYS), '右下角反弹 + 摩擦');
probe('throwStep', (S) => S.throwStep({ x: 500, y: 100, vx: 0, vy: -4000 }, 1 / 60, bounds, PHYS), '顶部越界（ceilingBounce）');
probe('bodyPixelBox', (S) => S.bodyPixelBox({ x: 400, y: 300, size: 462, bottomPad: 38.5 }), '身体包围盒换算');
probe('rectsOverlap', (S) => [S.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 15, bottom: 15 }), S.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 11, top: 0, right: 20, bottom: 10 })], '相交 / 相离');
probe('collidePet', (S) => S.collidePet(colliderA, colliderB), '两只宠物碰撞动量重分配');
probe('collidePet', (S) => S.collidePet({ x: 0, y: 0, vx: -1, vy: 0, size: 400 }, { x: 10, y: 0, vx: 1, vy: 0, size: 400 }), '正在分离（应返回空）');
probe('springStep', (S) => S.springStep(1200, 300, 500, 1 / 60, 1), '弹簧单轴步进');
probe('estimateReleaseVelocity', (S) => S.estimateReleaseVelocity(trail, 60, PHYS), '甩出初速估算');
probe('estimateReleaseVelocity', (S) => S.estimateReleaseVelocity(trail, 10_000, PHYS), '轨迹过期（应返回空）');
probe('trimTrail', (S) => S.trimTrail([...trail, { x: 1, y: 1, t: 10_000 }], 10_000), '轨迹裁剪');
probe('landingSquash', (S) => [S.landingSquash(0), S.landingSquash(600), S.landingSquash(3000)], '落地 Q 弹深度');
probe('squashScale', (S) => [S.squashScale(0), S.squashScale(0.5), S.squashScale(1), S.squashScale(2)], '挤压曲线');

// ---------------------------------------------------------------- 配置/菜单/积分
probe('isDesktopVisible', (S) => ['web', 'desktop', 'both', 'none'].map((d) => [S.isDesktopVisible(d), S.isWebVisible(d)]), 'display 可见性判定');
probe('isNoMirrorAnimation', (S) => [['玩魔方', true], ['打哈欠', false], ['不存在', false]].map(([a]) => S.isNoMirrorAnimation(ANIM_CFG.categories, a)), '免镜像分类判定');
probe('buildMenuTree', (S) => S.buildMenuTree(ANIM_CFG), '右键动作菜单树');
probe('buildMenuTree', (S) => S.buildMenuTree({ idle: [], turn: [], drag: [], clicks: [], moves: { actions: [] } }), '空配置菜单树');
probe('pickWeightedCategory', (S) => S.pickWeightedCategory(ANIM_CFG.categories, 'right'), '朝右时的分类过滤（应只剩非 noMirror）');
probe('pickCategoryAction', (S) => S.pickCategoryAction([], ['待机呼吸'], 1, '待机呼吸'), '无分类时的 FALLBACK 分支');
probe('rollKind', (S) => [0.0, 0.05, 0.12, 0.5, 0.99].map((r) => S.rollKind(r, { idle: 10, turn: 5, move: 5 })), '动作类型抽签（按给定随机数）');
probe('clickScore', (S) => [[0, 462], [400, 462], [1200, 462], [3000, 462]].map(([v, s]) => S.clickScore(v, s)), '点击积分');
probe('whisperBubbleView', (S) => S.whisperBubbleView({ ok: true, text: '今天也要加油呀', ts: 0 }), '碎碎念气泡视图');
probe('truncate', (S) => [S.truncate('短', 10), S.truncate('一二三四五六七八九十', 5)], '文本截断');

// ---------------------------------------------------------------- 不变量（含随机）
invariant('pick', '返回池内元素', (S) => {
  const pool = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) { const v = S.pick(pool, 'a'); if (!pool.includes(v)) return `越界：${v}`; }
  return true;
});
invariant('rollKind', '返回合法类型', (S) => {
  const kinds = new Set(['idle', 'turn', 'move', 'action']);
  for (let i = 0; i < 50; i++) { const v = S.rollKind(Math.random(), { idle: 10, turn: 5, move: 5 }); if (!kinds.has(v)) return `非法：${v}`; }
  return true;
});
invariant('pickCategoryAction', '返回 {id,name} 且 name 落在池内', (S) => {
  const pool = new Set(['打哈欠', '伸懒腰', '玩魔方', '待机呼吸']);
  for (let i = 0; i < 50; i++) {
    const v = S.pickCategoryAction(ANIM_CFG.categories, ['待机呼吸'], i % 2 ? 'right' : 'left', '待机呼吸');
    if (typeof v?.id !== 'string' || !pool.has(v.name)) return `非法：${JSON.stringify(v)}`;
  }
  return true;
});
invariant('randomBetween', '落在区间内', (S) => {
  for (let i = 0; i < 50; i++) { const v = S.randomBetween(3, 7); if (!(v >= 3 && v <= 7)) return `越界：${v}`; }
  return true;
});

// ---------------------------------------------------------------- 新版独有符号的可用性（无旧版可比，只做健全性检查）
// 这些是上游 v0.2.11 新增的导出（区域感知抛掷 / 事件槽位工具），step2 移植 sprite.js 时会用到。
// 形状取自 shell/shared/types.ts 的 Rect = {x,y,width,height}，签名见 physics.ts / displays.ts。
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const NEW_ONLY_CHECKS = [
  ['pickSlot', (S) => [S.pickSlot(['a', 'b', 'c']) !== undefined, S.pickSlot('单个') === '单个']],
  ['slotIncludes', (S) => [S.slotIncludes('a', 'a') === true, S.slotIncludes(['a', 'b'], 'b') === true, S.slotIncludes(['a'], 'z') === false]],
  ['poolIncludes', (S) => [S.poolIncludes(['a', ['b', 'c']], 'c') === true, S.poolIncludes(['a'], 'z') === false]],
  ['isEventAnim', (S) => [S.isEventAnim(ANIM_CFG.events, '碎碎念') === true, S.isEventAnim(ANIM_CFG.events, '不存在') === false]],
  ['nextWorkStatusAnim', (S) => [typeof S.nextWorkStatusAnim([['思考中', '干活中']], '思考中') === 'string', S.nextWorkStatusAnim(['碎碎念'], '碎碎念') === null]],
  ['throwBoundsIn', (S) => { const b = S.throwBoundsIn(AREA, 462, 115.5); return [b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) && b.minX === -115.5 && b.maxX === 1920 - 462 + 115.5; }],
  ['throwSpace', (S) => { const sp = S.throwSpace({ areas: [AREA], size: 462, sideAllow: 115.5 }); return Array.isArray(sp.bounds) && sp.bounds.length === 1 && sp.panels === sp.areas; }],
  ['throwSpace', (S) => { const sp = S.throwSpace({ areas: [AREA], panels: [AREA, AREA], size: 462, sideAllow: 115.5 }); return sp.panels === sp.areas; }],
  ['screenOfBox', (S) => { const sp = S.throwSpace({ areas: [AREA], size: 462, sideAllow: 115.5 }); return S.screenOfBox(sp, 500, 300) === 0; }],
  ['throwStepRegion', (S) => {
    const sp = S.throwSpace({ areas: [AREA], size: 462, sideAllow: 115.5 });
    const r = S.throwStepRegion({ x: 500, y: 300, vx: 0, vy: 0 }, 1 / 60, sp, PHYS);
    return Number.isFinite(r.x) && Number.isFinite(r.y) && r.screen === 0;
  }],
  ['throwStepRegion', (S) => {
    const sp = S.throwSpace({ areas: [], size: 462, sideAllow: 115.5 });
    const r = S.throwStepRegion({ x: 0, y: 0, vx: 0, vy: 0 }, 1 / 60, sp, PHYS);
    return r.screen === -1 && r.bounced === false;
  }],
];
for (const [name, fn] of NEW_ONLY_CHECKS) {
  if (typeof newApi[name] !== 'function') {
    invariantFails.push(`${name} 在新产物里缺失或不是函数（上游 v0.2.11 新增导出）`);
    continue;
  }
  try {
    const ok = fn(newApi);
    if (ok !== true && !(Array.isArray(ok) && ok.every(Boolean))) invariantFails.push(`${name} 健全性检查未通过：${show(ok)}`);
  } catch (e) {
    invariantFails.push(`${name} 健全性检查抛错：${String(e.message ?? e)}`);
  }
}

// ---------------------------------------------------------------- 报告
console.log(`旧产物: ${OLD_FILE.replace(ROOT, '.')}`);
console.log(`新产物: ${NEW_FILE.replace(ROOT, '.')}`);
console.log(`深度相等探针 ${same} 项；差异 ${diffs.length} 项；抛错 ${throws.length} 项；不变量 ${invariantFails.length} 项失败\n`);

if (diffs.length > 0) {
  console.log('=== 差异（可能是有意升级，也可能是需要覆盖的漂移）===');
  for (const d of diffs) {
    console.log(`· ${d.name}  [${d.note}]${USED.has(d.name) ? '  ★渲染层在用' : ''}`);
    console.log(`    旧: ${d.old}`);
    console.log(`    新: ${d.new}`);
  }
  console.log('');
}
if (throws.length > 0) {
  console.log('=== 抛错（调用形状可能已变，必须处理）===');
  for (const t of throws) {
    console.log(`· ${t.name}  [${t.note}]${USED.has(t.name) ? '  ★渲染层在用' : ''}`);
    console.log(`    旧: ${t.old}`);
    console.log(`    新: ${t.new}`);
  }
  console.log('');
}
if (invariantFails.length > 0) {
  console.log('=== 不变量失败 ===');
  for (const f of invariantFails) console.log(`· ${f}`);
  console.log('');
}

const mustFix = throws.length + invariantFails.length;
if (mustFix > 0 || (STRICT && diffs.length > 0)) {
  console.error(`✗ 差分比对未通过（抛错/不变量 ${mustFix} 项${STRICT ? `，差异 ${diffs.length} 项（strict）` : ''}）`);
  process.exit(1);
}
console.log(`✓ 无破坏性差异：${diffs.length} 项取值差异需人工判断是否接受（见上）`);
