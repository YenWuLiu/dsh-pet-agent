#!/usr/bin/env node
/**
 * check-bubble-schedule.mjs —— 头顶气泡「显示节奏」验收（无头）。
 *
 * 守的是什么：`shell/ours/bubble.ts` 的停留时长与队列规则。气泡同时承载对话回复、
 * 碎碎念、命令提示，用户反馈的原话是「经常性上一句还没读就跳到下一个了」——所以这里
 * 钉住四条行为：
 *   1. 停留时长按字数给阅读时间（约 4.5 字/秒，夹在 4s~30s）；
 *   2. 后来的气泡排队，不顶掉还没读完的那条；
 *   3. 碎碎念让路：真回复在显示/排队时，碎碎念直接丢弃；
 *   4. 长回复分屏：每屏各自拿阅读时间，屏数以 6 为上限、超出并进最后一屏。
 *
 * 打的是**真实产物** runtime/electron-helper/shared-core.js，所以顺带覆盖了
 * 「渲染层要用的 S.BubbleQueue / S.bubbleDwellMs 确实在产物里」。
 *
 * 用法：node scripts/check-bubble-schedule.mjs
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

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${detail === undefined ? '' : '  ' + detail}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail === undefined ? '' : '  ' + detail}`);
  }
};

if (typeof S?.BubbleQueue !== 'function' || typeof S?.bubbleDwellMs !== 'function') {
  console.error('✗ 产物里没有 PetShared.BubbleQueue / bubbleDwellMs（构建入口漏了 shell/ours/bubble.ts？）');
  process.exit(1);
}
ok('产物导出 BubbleQueue / bubbleDwellMs / splitBubbleText', typeof S.splitBubbleText === 'function');

// ── 1. 停留时长：按字数给阅读时间 ────────────────────────────────────────────
const { bubbleDwellMs, splitBubbleText, BubbleQueue, BUBBLE_MIN_MS, BUBBLE_MAX_MS, BUBBLE_QUEUE_MAX } = S;

ok('下限：短句也留 4 秒', bubbleDwellMs('你好') === BUBBLE_MIN_MS, `dwell(你好)=${bubbleDwellMs('你好')}`);
const d20 = bubbleDwellMs('一二三四五六七八九十一二三四五六七八九十');
ok('20 字约 4.4 秒（4.5 字/秒）', d20 > 4000 && d20 < 5000, `dwell(20字)=${d20}`);
ok('上限：超长文本封顶 30 秒', bubbleDwellMs('字'.repeat(400)) === BUBBLE_MAX_MS, `dwell(400字)=${bubbleDwellMs('字'.repeat(400))}`);
ok('空白不计入阅读量', bubbleDwellMs('你好 呀') === bubbleDwellMs('你好呀'));
ok('空文本不炸且取下限', bubbleDwellMs('') === BUBBLE_MIN_MS);

// ── 2. 队列：不打断没读完的那条 ──────────────────────────────────────────────
const q = new BubbleQueue();
const t0 = 1_000_000;
ok('第一条气泡立即显示', q.push('chat', '第一句', t0).show?.text === '第一句');
ok('停留时长 = 按字数的阅读时间', q.remaining(t0) === bubbleDwellMs('第一句'), `remaining=${q.remaining(t0)}`);
const second = q.push('chat', '第二句', t0 + 100);
ok('第二条排队而不是顶掉第一条', second.show === undefined && q.pending() === 1, `pending=${q.pending()}`);
ok('当前仍是第一条', q.current().text === '第一句');
ok('时间没到就不换（不打断阅读）', q.remaining(t0 + 100) > 0, `remaining=${q.remaining(t0 + 100)}`);
const nextStep = q.next(t0 + 5000);
ok('读完自动翻下一条', nextStep.show?.text === '第二句' && q.pending() === 0);
const endStep = q.next(t0 + 9000);
ok('队列空了才收起气泡', endStep.hide === true && q.current() === null);

// ── 3. 碎碎念让路给真回复 ────────────────────────────────────────────────────
const q2 = new BubbleQueue();
q2.push('chat', '正经回答', t0);
ok('回复显示期间碎碎念被丢弃', q2.push('whisper', '随口一句', t0 + 10).show === undefined && q2.current().text === '正经回答');
const q3 = new BubbleQueue();
q3.push('chat', '回复一', t0);
q3.push('chat', '回复二', t0 + 10); // 排队
ok('回复排队期间碎碎念也被丢弃', q3.push('whisper', '随口一句', t0 + 20).show === undefined && q3.pending() === 1);
const q4 = new BubbleQueue();
const w1 = q4.push('whisper', '碎碎念一', t0);
ok('没有回复时碎碎念照常显示', w1.show?.kind === 'whisper');
const w2 = q4.push('whisper', '碎碎念二', t0 + 10);
ok('碎碎念就地在原气泡上换新（不排队）', w2.show?.text === '碎碎念二' && q4.pending() === 0);
ok('回复到场时顶掉正在显示的碎碎念', q4.push('chat', '正经回答', t0 + 20).show?.text === '正经回答');

// ── 4. 流式回复：占位 → 增量 → 定稿计时 ─────────────────────────────────────
const q5 = new BubbleQueue();
ok('流式开始先占位显示', q5.begin('正在思考…', t0).show?.text === '正在思考…');
ok('流式期间不计时（不会读到一半被换掉）', q5.remaining(t0 + 60000) === Number.POSITIVE_INFINITY);
q5.update('你好呀');
ok('增量就地替换文本', q5.current().text === '你好呀');
const fin = q5.finish('你好呀', t0 + 5000);
ok('定稿后按最终文本计时', fin.show?.text === '你好呀' && q5.remaining(t0 + 5000) === bubbleDwellMs('你好呀'));

// ── 5. 长回复分屏 ────────────────────────────────────────────────────────────
const long = '第一句话说明背景。第二句话补充细节。第三句话给出结论。'.repeat(8); // ≈ 192 字
const pages = splitBubbleText(long, 110);
ok('长文本拆成多屏', pages.length >= 2, `pages=${pages.length}`);
ok('每屏不超过上限', pages.every((p) => [...p].length <= 110), `max=${Math.max(...pages.map((p) => [...p].length))}`);
ok('空文本不分屏', splitBubbleText('   ').length === 0);
const sentence = splitBubbleText('甲。乙。丙。丁。戊。己。庚。辛。壬。癸。'.repeat(12), 20);
ok(
  '优先在句末断开（封顶那屏除外）',
  sentence.filter((p) => !p.endsWith('…')).every((p) => /[。！？；!?;\n]$/.test(p)),
  `first=${sentence[0]}`,
);
const capped = splitBubbleText('字'.repeat(4000), 110, 6);
ok('屏数封顶 6 屏', capped.length <= 6, `pages=${capped.length}`);
ok('封顶后每屏仍不超上限（多出的只有省略号）', capped.every((p) => [...p].length <= 111), `max=${Math.max(...capped.map((p) => [...p].length))}`);
ok('超长时最后一屏带省略号', capped[capped.length - 1].endsWith('…'));
const q6 = new BubbleQueue();
q6.begin('正在思考…', t0);
q6.finishPaged(long, t0 + 100, 110);
ok('分屏定稿：第一屏现在就显示', q6.current().text === pages[0]);
ok('其余屏排队等阅读', q6.pending() >= 1, `pending=${q6.pending()}`);
const q7 = new BubbleQueue();
q7.begin('正在思考…', t0);
q7.finishPaged('字'.repeat(4000), t0 + 100, 110);
ok('排队不超过上限', q7.pending() <= BUBBLE_QUEUE_MAX, `pending=${q7.pending()}`);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
