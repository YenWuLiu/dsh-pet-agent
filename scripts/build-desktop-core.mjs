#!/usr/bin/env node
/**
 * build-desktop-core.mjs —— 把 shell/（外壳纯逻辑层）构建成
 * `runtime/electron-helper/shared-core.js`（经典 script，全局 window.PetShared）。
 *
 * 为什么是经典 script 而非 ESM：Electron 的 loadFile 从 file:// 加载页面，
 * Chromium 对 file:// 的 ES module 有 CORS 限制（origin null 被阻），经典 script 无此问题
 * ——shared-core.js 先于 renderer.js 加载，渲染层读全局。（与上游同因，见其
 * scripts/build-desktop-core.mjs 头部注释。）
 *
 * 与上游的差异：上游用 rolldown，我们用 esbuild。上游把 rolldown 列为 devDependency，
 * 本项目没有；esbuild 已随 tsx 间接存在于 pnpm store，故构建器优先解析 store 里的副本，
 * 这样**不改 package.json / lockfile** 也能构建。若将来想显式声明依赖：
 *   pnpm add -D esbuild && node scripts/build-desktop-core.mjs
 *
 * 用法：node scripts/build-desktop-core.mjs [--check]
 *   --check   只做产物自检，不重新构建（校验导出面 vs 渲染层实际用到的符号）。
 *
 * 沙箱注意：esbuild 的 JS API 会以 piped stdio 起子进程，在受限沙箱下会 spawn EPERM；
 * 本脚本改走 CLI 且 stdio: 'inherit'（esbuild 的 bin shim 内部也是 execFileSync + inherit），
 * 因此在受限环境同样可用。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'shell', 'index.ts');
const OUT = join(ROOT, 'runtime', 'electron-helper', 'shared-core.js');
const SHELL_DIR = join(ROOT, 'runtime', 'electron-helper');
const GLOBAL_NAME = 'PetShared';

/** 解析可用的 esbuild CLI。@returns {{cmd: string, prefix: string[]}} */
function resolveEsbuild() {
  const req = createRequire(join(ROOT, 'package.json'));
  // 1) 已声明依赖（最稳）
  try {
    return { cmd: process.execPath, prefix: [req.resolve('esbuild/bin/esbuild')] };
  } catch {
    /* fall through */
  }
  // 2) pnpm store：esbuild 自身（随 tsx 带入）
  const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    const shims = readdirSync(pnpmDir)
      .filter((name) => /^esbuild@/.test(name))
      .sort()
      .reverse()
      .map((name) => join(pnpmDir, name, 'node_modules', 'esbuild', 'bin', 'esbuild'))
      .filter((p) => existsSync(p));
    if (shims.length > 0) return { cmd: process.execPath, prefix: [shims[0]] };
    // 3) 平台二进制（无 JS shim 时）
    const bins = readdirSync(pnpmDir)
      .filter((name) => /^@esbuild\+/.test(name))
      .flatMap((name) => {
        const pkgDir = join(pnpmDir, name, 'node_modules', '@esbuild');
        if (!existsSync(pkgDir)) return [];
        return readdirSync(pkgDir).map((plat) => join(pkgDir, plat, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'));
      })
      .filter((p) => existsSync(p));
    if (bins.length > 0) return { cmd: bins[0], prefix: [] };
  }
  throw new Error(
    '找不到 esbuild。请执行 `pnpm add -D esbuild` 后重试（构建桌宠外壳的纯逻辑层需要它）。',
  );
}

/** 读取产物里的 window.PetShared。@returns {Record<string, unknown>} */
function loadApi(file) {
  const source = readFileSync(file, 'utf8');
  const sandbox = { window: {}, self: {}, globalThis: undefined, console, fetch: () => {}, document: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  const api = sandbox.window[GLOBAL_NAME] ?? sandbox[GLOBAL_NAME];
  if (!api || typeof api !== 'object') {
    throw new Error(`${file}: 产物没有暴露 ${GLOBAL_NAME}`);
  }
  return api;
}

/** 读取产物里的 window.PetShared 导出符号集合。@returns {string[]} */
function exportSurface(file) {
  return Object.keys(loadApi(file)).sort();
}

/**
 * 覆盖层断言：确认产物里的这几个符号确实来自 `shell/ours/`（而不是悄悄被上游同名实现顶掉）。
 * 判据是该实现体内必然出现的特征字符串 —— 上游源码里没有它们。
 */
const OVERRIDE_ASSERTIONS = [
  { symbol: 'mountContextMenu', needle: '__dshPetVisibleRect', why: 'shell/ours/menu.ts：旧全局 → clamp 兼容层' },
  { symbol: 'mountChatDialog', needle: 'dsh-pet-chat-head', why: 'shell/ours/chat.js：本项目常驻对话面板' },
  { symbol: 'CHAT_CSS', needle: 'dsh-pet-chat-head', why: '样式必须与面板实现成对（上游 CSS 无此类名）' },
  { symbol: 'sendChatStream', needle: 'getReader', why: 'shell/ours/chat.js：NDJSON 逐帧流式传输' },
];

/**
 * 扫描外壳脚本里对 `S.<符号>` / `window.PetShared.<符号>` 的引用。
 * @returns {Map<string, string[]>} 符号 → 引用处（文件:行）
 */
function shellUsages() {
  const usages = new Map();
  const files = readdirSync(SHELL_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js') && e.name !== 'shared-core.js')
    .map((e) => e.name);
  const re = /(?:\bS|window\.PetShared|PetShared)\.([A-Za-z_$][\w$]*)/g;
  for (const name of files) {
    const text = readFileSync(join(SHELL_DIR, name), 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const symbol = m[1];
        const where = `${name}:${i + 1}`;
        const list = usages.get(symbol) ?? [];
        if (!list.includes(where)) list.push(where);
        usages.set(symbol, list);
      }
    });
  }
  return usages;
}

/** 构建产物自检：导出面 vs 渲染层引用。@returns {boolean} 是否通过 */
function check() {
  if (!existsSync(OUT)) {
    console.error(`[build-desktop-core] ✗ 产物不存在：${OUT}（先不带 --check 跑一次）`);
    return false;
  }
  const surface = exportSurface(OUT);
  const surfaceSet = new Set(surface);
  const api = loadApi(OUT);
  const legacy = join(ROOT, 'shell', 'legacy', 'shared-core.built-old.js');
  const legacySurface = existsSync(legacy) ? exportSurface(legacy) : [];
  const legacySet = new Set(legacySurface);

  const usages = shellUsages();
  const missing = [...usages.keys()].filter((s) => !surfaceSet.has(s)).sort();
  const added = surface.filter((s) => !legacySet.has(s));
  const removed = legacySurface.filter((s) => !surfaceSet.has(s));

  console.log(`[build-desktop-core] 导出符号 ${surface.length} 个（旧产物 ${legacySurface.length} 个）`);
  if (added.length > 0) console.log(`  新增: ${added.join(', ')}`);
  if (removed.length > 0) console.log(`  移除: ${removed.join(', ')}`);
  console.log(`  渲染层引用 ${usages.size} 个符号`);

  let ok = true;
  if (missing.length > 0) {
    ok = false;
    console.error(`  ✗ 渲染层用到但产物里没有（${missing.length} 个）：`);
    for (const s of missing) console.error(`      ${s}  ← ${usages.get(s).join(', ')}`);
  } else {
    console.log('  ✓ 渲染层引用的符号全部存在');
  }
  if (removed.length > 0) {
    ok = false;
    console.error('  ✗ 有符号在重建后消失（旧产物有、新产物没有）——会导致渲染层运行时报错');
  }
  for (const a of OVERRIDE_ASSERTIONS) {
    const value = api[a.symbol];
    const text = typeof value === 'string' ? value : typeof value === 'function' ? String(value) : '';
    if (text === '') {
      ok = false;
      console.error(`  ✗ 覆盖层断言失败：产物里没有可检查的 ${a.symbol}（${a.why}）`);
    } else if (!text.includes(a.needle)) {
      ok = false;
      console.error(`  ✗ 覆盖层断言失败：${a.symbol} 不是本项目的实现（缺特征 "${a.needle}"）——可能被上游同名实现顶掉了。${a.why}`);
    } else {
      console.log(`  ✓ 覆盖层生效：${a.symbol} ← ${a.why}`);
    }
  }
  return ok;
}

function build() {
  if (!existsSync(ENTRY)) throw new Error(`入口不存在：${ENTRY}`);
  const { cmd, prefix } = resolveEsbuild();
  const args = [
    ...prefix,
    ENTRY,
    '--bundle',
    '--format=iife',
    `--global-name=${GLOBAL_NAME}`,
    '--platform=browser',
    '--target=chrome120',
    '--charset=utf8',
    '--legal-comments=none',
    '--log-level=warning',
    `--outfile=${OUT}`,
  ];
  console.log(`[build-desktop-core] esbuild ${cmd === process.execPath ? 'shim' : cmd}`);
  // stdio: 'inherit' —— 不捕获子进程输出（受限沙箱下管道会 EPERM）
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
  const size = statSync(OUT).size;
  console.log(`[build-desktop-core] ✓ ${OUT.replace(ROOT + '\\', '').replace(ROOT + '/', '')} (${size} bytes)`);
}

const checkOnly = process.argv.includes('--check');
if (!checkOnly) build();
process.exit(check() ? 0 : 1);
