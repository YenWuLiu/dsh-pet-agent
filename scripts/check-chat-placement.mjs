#!/usr/bin/env node
/**
 * check-chat-placement.mjs —— 对话面板「跟随 + 屏幕边缘碰撞」落位验收（无头）。
 *
 * 守的是什么：`shell/ours/chat-place.js` 的 `placeChatPanel` 决定面板贴宠物哪一侧、贴多宽、
 * 夹到哪。渲染层每次宠物位置变化都会调用它；这里用真实几何（宠物尺寸 462 → 命中区
 * 144.4/173.25 宽、窗口四周余量 231）验证四条规则：
 *   1. 空间够 → 贴右侧；
 *   2. 右侧出屏 → 翻到左侧（这就是"边缘碰撞"）；
 *   3. 两侧都窄 → 压窄到该侧空间（下限 140），且**仍不出屏**；
 *   4. 竖直贴下缘/面板比可视区还高 → 夹进可视区 / 返回 maxHeight 让它内部滚动。
 *
 * 打的是**真实产物** runtime/electron-helper/shared-core.js，所以顺带覆盖了
 * 「渲染层要用的 S.placeChatPanel 确实在产物里」。
 *
 * 用法：node scripts/check-chat-placement.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'runtime', 'electron-helper', 'shared-core.js');

const sandbox = { window: {}, console, fetch: () => {} };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: BUNDLE });
const S = sandbox.window.PetShared ?? sandbox.PetShared;
if (typeof S?.placeChatPanel !== 'function') {
  console.error('✗ 产物里没有 PetShared.placeChatPanel（构建入口漏了 shell/ours/chat-place.js？）');
  process.exit(1);
}

const PAD = 4;
const GAP = 6;
const MIN_W = 140;

/** 宠物尺寸 462 时，命中区在窗口坐标里的位置（renderer 的 HIT_BOX 换算）。 */
const PET = { left: 375.4, top: 288.8, right: 548.7, bottom: 494.6 };
const PANEL = { width: 320, height: 300 };
const FULL = { x0: 0, y0: 0, x1: 924, y1: 744 }; // 窗口完整在屏内

const cases = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  cases.push({ name, ok, actual, expected });
};
const near = (a, b) => Math.abs(a - b) < 0.01;
const checkNear = (name, actual, expected) => {
  const ok = near(actual, expected);
  cases.push({ name, ok, actual, expected });
};

// 1) 空间够 → 贴右侧、不压窄、贴上缘
{
  const p = S.placeChatPanel({ pet: PET, panel: PANEL, vis: FULL, gap: GAP, pad: PAD, minWidth: MIN_W });
  check('空间够 → 贴右侧', p.side, 'right');
  checkNear('空间够 → 左缘 = 宠物右缘 + 间距', p.left, PET.right + GAP);
  checkNear('空间够 → 上缘 = 宠物上缘 + 间距', p.top, PET.top + GAP);
  check('空间够 → 不压窄', p.maxWidth, undefined);
}

// 2) 宠物贴屏幕右缘（窗口有 300px 在屏外）→ 翻到左侧，且完整可见
{
  const vis = { x0: 0, y0: 0, x1: 924 - 300, y1: 744 };
  const p = S.placeChatPanel({ pet: PET, panel: PANEL, vis, gap: GAP, pad: PAD, minWidth: MIN_W });
  check('右侧出屏 → 翻左侧', p.side, 'left');
  checkNear('翻左侧 → 右缘 = 宠物左缘 − 间距', p.left + PANEL.width, PET.left - GAP);
  check('翻左侧 → 仍不压窄（左侧装得下）', p.maxWidth, undefined);
  cases.push({ name: '翻左侧 → 完整落在可视区内', ok: p.left >= vis.x0 + PAD - 0.01 && p.left + PANEL.width <= vis.x1 - PAD + 0.01, actual: [p.left, p.left + PANEL.width], expected: [vis.x0 + PAD, vis.x1 - PAD] });
}

// 3) 两侧都窄（可视切片只有 264px 宽）→ 压窄到下限，且绝不出屏
{
  const vis = { x0: 360, y0: 0, x1: 624, y1: 744 };
  const p = S.placeChatPanel({ pet: PET, panel: PANEL, vis, gap: GAP, pad: PAD, minWidth: MIN_W });
  check('两侧都窄 → 压窄到下限', p.maxWidth, MIN_W);
  check('两侧都窄 → 选空间较大的一侧', p.side, 'right');
  cases.push({
    name: '两侧都窄 → 压窄后仍不出屏',
    ok: p.left >= vis.x0 + PAD - 0.01 && p.left + MIN_W <= vis.x1 - PAD + 0.01,
    actual: [p.left, p.left + MIN_W],
    expected: [vis.x0 + PAD, vis.x1 - PAD],
  });
}

// 4) 宠物贴屏幕下缘（窗口有 400px 在屏外）→ 竖直夹进可视区
{
  const vis = { x0: 0, y0: 0, x1: 924, y1: 400 };
  const p = S.placeChatPanel({ pet: PET, panel: PANEL, vis, gap: GAP, pad: PAD, minWidth: MIN_W });
  checkNear('下缘出屏 → 面板上移贴可视区底', p.top, vis.y1 - PAD - PANEL.height);
  cases.push({ name: '下缘出屏 → 完整落在可视区内', ok: p.top >= vis.y0 + PAD - 0.01 && p.top + PANEL.height <= vis.y1 - PAD + 0.01, actual: [p.top, p.top + PANEL.height], expected: [vis.y0 + PAD, vis.y1 - PAD] });
}

// 5) 面板比可视区还高 → 返回 maxHeight（面板内部滚动），且顶部贴可视区
{
  const vis = { x0: 0, y0: 0, x1: 924, y1: 300 };
  const tall = { width: 320, height: 500 };
  const p = S.placeChatPanel({ pet: PET, panel: tall, vis, gap: GAP, pad: PAD, minWidth: MIN_W });
  check('面板过高 → 返回 maxHeight', p.maxHeight, 292);
  checkNear('面板过高 → 顶部贴可视区上缘', p.top, PAD);
}

// 6) 组合遍历：任意宠物位置 × 任意可视矩形，都不能把面板放到可视区外
{
  let worstX = null;
  let worstY = null;
  for (let dx = -400; dx <= 400; dx += 40) {
    for (let dy = -400; dy <= 400; dy += 40) {
      const pet = { left: PET.left + dx, top: PET.top + dy, right: PET.right + dx, bottom: PET.bottom + dy };
      for (const [w, h] of [[924, 744], [624, 744], [400, 400], [264, 744], [924, 300], [200, 200]]) {
        const vis = { x0: 0, y0: 0, x1: w, y1: h };
        const p = S.placeChatPanel({ pet, panel: PANEL, vis, gap: GAP, pad: PAD, minWidth: MIN_W });
        const width = p.maxWidth ?? PANEL.width;
        const height = p.maxHeight ?? PANEL.height;
        // 横向：面板宽度装得下可视区时，必须完整落在里面
        if (width <= vis.x1 - vis.x0 - 2 * PAD) {
          if (p.left < vis.x0 + PAD - 0.01 || p.left + width > vis.x1 - PAD + 0.01) {
            worstX = { pet, vis, p, width };
          }
        }
        if (height <= vis.y1 - vis.y0 - 2 * PAD) {
          if (p.top < vis.y0 + PAD - 0.01 || p.top + height > vis.y1 - PAD + 0.01) {
            worstY = { pet, vis, p, height };
          }
        }
        // 尺寸上限只在真的装不下时给出（否则会白白把面板压小）
        if (p.maxWidth !== undefined && PANEL.width <= vis.x1 - vis.x0 - 2 * PAD && p.room.right >= PANEL.width) {
          worstX = { pet, vis, p, width };
        }
      }
    }
  }
  cases.push({ name: '组合遍历 → 横向从不越界', ok: worstX === null, actual: worstX, expected: null });
  cases.push({ name: '组合遍历 → 纵向从不越界', ok: worstY === null, actual: worstY, expected: null });
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
