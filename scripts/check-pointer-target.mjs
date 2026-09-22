#!/usr/bin/env node
/**
 * check-pointer-target.mjs —— 点击穿透「兜底通道」的纯判定验收（无头）。
 *
 * 守的是什么：`runtime/electron-helper/pointer-target.js`（上游 issue #55 的修法）决定主进程
 * 每 60ms 该不该让窗口保持穿透。它出错**不抛异常**：表现为"宠物贴边点不动""拖拽甩快时宠物
 * 自己飞出去""透明区挡住下层应用"——全是难复现的手感问题，所以必须机器守。
 *
 * 三类断言：
 *   1. 几何对齐：本模块的 spriteHitRect 必须与渲染端 renderer.js 的 hitRect 公式**逐项一致**
 *      （同一条命中区，两条通道各算一遍；含本项目补上的 bottomPad —— 上游原版漏了这一项）；
 *   2. HIT_BOX 同源：与构建产物 shared-core 的 HIT_BOX 相同（上游自己的守卫测试也钉这条）；
 *   3. 判定规则：busy 最高优先、窗外恢复穿透、身上可交互、窗口余量区保持原状。
 *
 * 用法：node scripts/check-pointer-target.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pt = require(join(ROOT, 'runtime', 'electron-helper', 'pointer-target.js'));

// 构建产物里的 HIT_BOX（渲染端实际用的那份）
const sandbox = { window: {}, console, fetch: () => {} };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'runtime', 'electron-helper', 'shared-core.js'), 'utf8'), sandbox);
const S = sandbox.window.PetShared ?? sandbox.PetShared;

const cases = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  cases.push({ name, ok, actual, expected });
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------- 1. 几何对齐
// 渲染端公式（renderer.js）：窗口 = 包围盒 + 四周 margin(=size/2)，舞台被 translateY(bottomPad) 下移
function rendererHitRect(size) {
  const height = (size * 9) / 16;
  const bottomPad = (height * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
  const margin = size * 0.5;
  return {
    left: margin + (S.HIT_BOX.x0 / 640) * size,
    top: margin + bottomPad + (S.HIT_BOX.y0 / 360) * height,
    right: margin + (S.HIT_BOX.x1 / 640) * size,
    bottom: margin + bottomPad + (S.HIT_BOX.y1 / 360) * height,
  };
}

for (const size of [300, 462, 600]) {
  const margin = Math.round(size * 0.5);
  // 窗口摆在原点：此时窗口内坐标 == 屏幕坐标，可直接与渲染端公式（窗口内坐标）比
  const bounds = { x: 0, y: 0, width: size + margin * 2, height: size };
  const got = pt.spriteHitRect(bounds);
  const want = rendererHitRect(size);
  const same =
    near(got.left, want.left) && near(got.top, want.top) && near(got.right, want.right) && near(got.bottom, want.bottom);
  cases.push({
    name: `命中区与渲染端公式一致（size=${size}）`,
    ok: same,
    actual: { l: +got.left.toFixed(2), t: +got.top.toFixed(2), r: +got.right.toFixed(2), b: +got.bottom.toFixed(2) },
    expected: { l: +want.left.toFixed(2), t: +want.top.toFixed(2), r: +want.right.toFixed(2), b: +want.bottom.toFixed(2) },
  });
}

// 绝对坐标：窗口在屏幕 (100, 200)，尺寸 924×744（size 462）
{
  const margin = 231;
  const bounds = { x: 100, y: 200, width: 462 + margin * 2, height: 0 };
  const got = pt.spriteHitRect(bounds);
  const rel = rendererHitRect(462);
  check(
    '命中区随窗口位置平移（绝对坐标）',
    [Math.round(got.left), Math.round(got.top)],
    [Math.round(100 + rel.left), Math.round(200 + rel.top)],
  );
}

// ---------------------------------------------------------------- 2. HIT_BOX 同源
check('HIT_BOX 与产物一致', pt.HIT_BOX, S.HIT_BOX);
check('CANVAS_H 与产物一致', pt.CANVAS_H, S.CANVAS_H);
check('轮询间隔为 60ms', pt.POINTER_POLL_MS, 60);

// ---------------------------------------------------------------- 3. 判定规则
const B = { x: 0, y: 0, width: 924, height: 744 };
const rect = pt.spriteHitRect(B);
const onPet = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
const outsideWindow = { x: B.x + B.width + 50, y: B.y + 50 };
const inMargin = { x: B.x + 4, y: B.y + 4 }; // 窗口内、宠物外（左上角余量）

check('光标在宠物身上 → 可交互（不穿透）', pt.decideWindowIgnore(B, onPet, true, false), false);
check('光标在窗外 → 恢复穿透', pt.decideWindowIgnore(B, outsideWindow, false, false), true);
check('窗口余量区 → 保持当前状态（穿透→穿透）', pt.decideWindowIgnore(B, inMargin, true, false), true);
check('窗口余量区 → 保持当前状态（可交互→可交互）', pt.decideWindowIgnore(B, inMargin, false, false), false);
check('busy（拖拽/面板）→ 绝不翻回穿透：窗外也保持可交互', pt.decideWindowIgnore(B, outsideWindow, false, true), false);
check('busy → 优先级高于位置判定（宠物身上同样不穿透）', pt.decideWindowIgnore(B, onPet, true, true), false);

// busy 优先的边界：拖拽甩快时宠物滞后于光标，光标可能落在窗口外——这正是 0.2.10 的回归
{
  const far = { x: B.x - 300, y: B.y - 300 };
  cases.push({
    name: '回归守卫：拖拽中光标被甩出窗口外也必须可交互',
    ok: pt.decideWindowIgnore(B, far, true, true) === false,
    actual: pt.decideWindowIgnore(B, far, true, true),
    expected: false,
  });
}

// ---------------------------------------------------------------- 报告
let failed = 0;
for (const c of cases) {
  if (c.ok) {
    console.log(`PASS  ${c.name}  ${JSON.stringify(c.actual)}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}`);
    console.log(`      期望 ${JSON.stringify(c.expected)}`);
    console.log(`      实际 ${JSON.stringify(c.actual)}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
