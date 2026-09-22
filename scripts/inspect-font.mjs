#!/usr/bin/env node
/**
 * inspect-font.mjs —— TTF/OTF 体检：字面名 / 字重 / 字形数 / 字符覆盖 / 与另一个字体的差异。
 *
 * 用途：换字体（assets/fonts/*.ttf）之前先确认
 *   1) 是不是同一套字的不同字重（usWeightClass 决定"看起来粗不粗"）；
 *   2) 汉字覆盖够不够——很多字体包是"常用字子集"，换上去会大面积缺字；
 *   3) 与现用字体的实际差异（字形数/覆盖/字重）。
 *
 * 用法：
 *   node scripts/inspect-font.mjs <font.ttf> [--compare <other.ttf>] [--chars 文字样张]
 *   默认样张取自本项目界面文案（对话面板 / 宠物名 / 动画名），可自行追加。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 界面字体槽位：assets/fonts/ 下唯一的 .ttf（文件名被渲染端硬编码，故按目录取而不是按名字取）。 */
function slotFont() {
  const dir = join(ROOT, 'assets', 'fonts');
  const fonts = existsSync(dir) ? readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ttf')) : [];
  if (fonts.length !== 1) {
    console.error(`assets/fonts/ 下应当恰好有 1 个 .ttf（界面字体槽位），实际 ${fonts.length} 个：${fonts.join(', ') || '无'}`);
    process.exit(2);
  }
  return join(dir, fonts[0]);
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** 位置参数（排除 --flag 后面的值） */
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const CHECK = argv.includes('--check');
const expectFamily = flag('--expect-family');
const compareFile = flag('--compare');
const extraChars = flag('--chars') ?? '';
const file = positional[0] ?? slotFont();

/** 默认样张：本项目真实会显示的字符（面板文案 + 角色名 + 动画名常见字）。 */
const DEFAULT_SAMPLE =
  '说点什么发送停止重试正在回复可继续输入允许一次拒绝设置开机自启碎碎念回到初始位置退出桌宠' +
  '你好呀我是一只住在桌面上的女仆主人记得吃饭休息' +
  '未配置模型右键填写接口地址与密钥余额工作状态思考执行完成出错';

/**
 * 界面语料：**渲染时会用界面字体显示**的字符串（面板 / 设置 / 审批 / 失败行）。
 * 新增界面文案就加到这里——`--check` 会替你查缺字：字体缺某个字符时会**静默**回退到后备
 * 字体族，界面上只是"个别字粗细不对"，肉眼几乎定位不到（全角括号就是这么被抓出来的）。
 */
const UI_CORPUS = [
  '说点什么… (Enter 发送)',
  '正在回复… (可继续输入)',
  '发送',
  '停止',
  '重试',
  '已停止',
  '对话失败：',
  '未配置模型：',
  '对话异常：',
  '未知原因',
  '右键 → 设置',
  '设置',
  '开机自启 (登录后自动启动桌宠)',
  'OpenAI 兼容 (DeepSeek / 通义 / 月之暗面 / OpenRouter…)',
  'Anthropic (Claude)',
  '接口地址 (baseURL)',
  '模型 id',
  '清除配置',
  '保存',
  '已保存 API Key，留空表示不修改',
  '尚未保存 API Key，请填写',
  '接口地址与模型 id 必填 (或点「清除配置」停用模型)',
  '自启目标：',
  '(未知)',
  '允许执行',
  '吗？',
  '允许一次',
  '拒绝',
];

/**
 * 字库已知缺口：站酷快乐体 2016 的 ASCII 里没有这 8 个字形 `( ) [ \ ] ^ _ \` |`
 * （字母数字与常见标点都有）。它们由后备字体族（Microsoft YaHei UI）渲染，因此**不算缺字**；
 * 但界面文案尽量别用——需要括号时改用「」或换说法（对话面板的占位符就是这么改的）。
 */
const ALLOWED_FALLBACK = new Set([...'()[]\\^_`|']);

/** 配置语料：动画名 / 状态文案 / 角色名（whisperPrompt 是给模型的提示词、不上屏，排除）。 */
function configCorpus() {
  const f = join(ROOT, 'assets', 'config.jsonc');
  if (!existsSync(f)) return '';
  return readFileSync(f, 'utf8')
    .split(/\r?\n/)
    // 先剥行尾注释再判整行注释：注释里的标点不上屏，别把它算进语料（否则全是假警报）
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .filter((line) => !/^\s*\/\//.test(line))
    .filter((line) => !/^\s*"[\w]*[Pp]rompt[\w]*"\s*:/.test(line))
    .join('');
}

/**
 * 解析 sfnt 结构（TTF/OTF 通用）。
 * @param {Buffer} buf 文件内容
 * @returns {{sfnt:string, tables:Map<string,{offset:number,length:number}>, numGlyphs:number|null, unitsPerEm:number|null, weightClass:number|null, names:Record<string,string>, cmap:Set<number>}}
 */
function parseFont(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString('ascii', off, off + 4);
    tables.set(tag, { offset: buf.readUInt32BE(off + 8), length: buf.readUInt32BE(off + 12) });
  }
  const out = {
    sfnt: buf.toString('ascii', 0, 4),
    tables,
    numGlyphs: null,
    unitsPerEm: null,
    weightClass: null,
    names: {},
    cmap: new Set(),
  };
  const maxp = tables.get('maxp');
  if (maxp) out.numGlyphs = buf.readUInt16BE(maxp.offset + 4);
  const head = tables.get('head');
  if (head) out.unitsPerEm = buf.readUInt16BE(head.offset + 18);
  const os2 = tables.get('OS/2');
  if (os2) out.weightClass = buf.readUInt16BE(os2.offset + 4);

  // name 表：只取 Windows(3,1,0x409) 与 Mac(1,0,0) 的常用条目
  const name = tables.get('name');
  if (name) {
    const count = buf.readUInt16BE(name.offset + 2);
    const stringOffset = name.offset + buf.readUInt16BE(name.offset + 4);
    const WANT = { 0: 'copyright', 1: 'family', 2: 'subfamily', 3: 'uniqueId', 4: 'fullName', 5: 'version', 6: 'postscript', 8: 'manufacturer', 11: 'designer' };
    for (let i = 0; i < count; i++) {
      const rec = name.offset + 6 + i * 12;
      const platform = buf.readUInt16BE(rec);
      const encoding = buf.readUInt16BE(rec + 2);
      const language = buf.readUInt16BE(rec + 4);
      const nameId = buf.readUInt16BE(rec + 6);
      const len = buf.readUInt16BE(rec + 8);
      const off = buf.readUInt16BE(rec + 10);
      const key = WANT[nameId];
      if (!key) continue;
      if (!((platform === 3 && encoding === 1 && language === 0x409) || (platform === 1 && encoding === 0 && language === 0))) continue;
      const raw = buf.subarray(stringOffset + off, stringOffset + off + len);
      const text = platform === 3 ? raw.swap16().toString('utf16le') : raw.toString('latin1');
      if (out.names[key] === undefined) out.names[key] = text.replace(/\0/g, '').trim();
    }
  }

  // cmap：把所有格式 4 / 12 的子表并起来（够用即可，不求完备）
  const cmap = tables.get('cmap');
  if (cmap) {
    const n = buf.readUInt16BE(cmap.offset + 2);
    for (let i = 0; i < n; i++) {
      const rec = cmap.offset + 4 + i * 8;
      const sub = cmap.offset + buf.readUInt32BE(rec + 4);
      const format = buf.readUInt16BE(sub);
      if (format === 4) {
        const segCount = buf.readUInt16BE(sub + 6) / 2;
        const endBase = sub + 14;
        const startBase = endBase + segCount * 2 + 2;
        for (let s = 0; s < segCount; s++) {
          const end = buf.readUInt16BE(endBase + s * 2);
          const start = buf.readUInt16BE(startBase + s * 2);
          if (start === 0xffff) continue;
          for (let c = start; c <= end && c !== 0xffff; c++) out.cmap.add(c);
        }
      } else if (format === 12) {
        const groups = buf.readUInt32BE(sub + 12);
        for (let g = 0; g < groups; g++) {
          const rec2 = sub + 16 + g * 12;
          const start = buf.readUInt32BE(rec2);
          const end = buf.readUInt32BE(rec2 + 4);
          for (let c = start; c <= end; c++) out.cmap.add(c);
        }
      }
    }
  }
  return out;
}

/** 统计 CJK 统一表意文字覆盖数。 */
function cjkCount(cmap) {
  let n = 0;
  for (const c of cmap) if (c >= 0x4e00 && c <= 0x9fff) n++;
  return n;
}

function report(label, path) {
  const buf = readFileSync(path);
  const f = parseFont(buf);
  const weightName = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }[f.weightClass] ?? `?(${f.weightClass})`;
  console.log(`\n===== ${label} =====`);
  console.log(`文件        ${basename(path)}  ${buf.length} bytes  (${f.sfnt})`);
  console.log(`字面        family="${f.names.family ?? '?'}"  subfamily="${f.names.subfamily ?? '?'}"`);
  console.log(`全名/PS名   ${f.names.fullName ?? '?'} / ${f.names.postscript ?? '?'}`);
  console.log(`版本        ${f.names.version ?? '?'}`);
  console.log(`版权        ${(f.names.copyright ?? '?').slice(0, 120)}`);
  console.log(`字重        usWeightClass=${f.weightClass} → ${weightName}`);
  console.log(`字形数      ${f.numGlyphs ?? '?'}   unitsPerEm=${f.unitsPerEm ?? '?'}`);
  console.log(`字符覆盖    cmap ${f.cmap.size} 码位，其中汉字 (U+4E00–9FFF) ${cjkCount(f.cmap)} 个`);
  console.log(`轮廓        ${f.tables.has('glyf') ? 'glyf (TrueType 轮廓)' : f.tables.has('CFF ') ? 'CFF (PostScript 轮廓)' : '?'}`);
  const sample = DEFAULT_SAMPLE + extraChars;
  const missing = [...new Set(sample)].filter((ch) => !f.cmap.has(ch.codePointAt(0)));
  console.log(`样张缺字    ${missing.length === 0 ? '无（本项目常用字全覆盖）' : `${missing.length} 个: ${missing.join('')}`}`);
  return f;
}

const a = report('字体 A', file);
if (compareFile) {
  const b = report('字体 B（对照）', compareFile);
  console.log('\n===== 差异对比 =====');
  console.log(`字重        A=${a.weightClass}  B=${b.weightClass}  ${a.weightClass === b.weightClass ? '（相同）' : '（不同 —— 粗细差异来自字重）'}`);
  console.log(`字形数      A=${a.numGlyphs}  B=${b.numGlyphs}`);
  console.log(`汉字覆盖    A=${cjkCount(a.cmap)}  B=${cjkCount(b.cmap)}  ${cjkCount(a.cmap) < cjkCount(b.cmap) ? `（A 少 ${cjkCount(b.cmap) - cjkCount(a.cmap)} 个，可能是子集/精简版）` : ''}`);
  const onlyB = [...b.cmap].filter((c) => !a.cmap.has(c)).length;
  const onlyA = [...a.cmap].filter((c) => !b.cmap.has(c)).length;
  console.log(`互不共有    仅 B 有 ${onlyB} 个码位；仅 A 有 ${onlyA} 个码位`);
  console.log(`字面名      ${a.names.family === b.names.family ? '相同' : `不同（A="${a.names.family}" B="${b.names.family}"）`}`);
}

// ---------------------------------------------------------------- 字体闸（--check）
// 守两类静默故障：① 槽位里被换成另一套字库（界面对不上，但没有任何报错）；
// ② 字库是"常用字子集"，某几个界面字缺字形 → 逐字回退到别的字体族（看着就是"个别字不对"）。
if (CHECK) {
  const corpus = UI_CORPUS.join('') + configCorpus() + extraChars + DEFAULT_SAMPLE;
  const chars = [...new Set(corpus)].filter((c) => !/\s/.test(c));
  const absent = chars.filter((c) => !a.cmap.has(c.codePointAt(0)));
  const allowed = absent.filter((c) => ALLOWED_FALLBACK.has(c));
  const missing = absent.filter((c) => !ALLOWED_FALLBACK.has(c));
  let bad = false;

  if (expectFamily !== undefined && a.names.family !== expectFamily) {
    bad = true;
    console.error(`\n✗ 槽位里装的不是预期字库：期望 family="${expectFamily}"，实际 "${a.names.family}"`);
    console.error('  换素材时把界面字体一起换掉了？确认无误后更新 --expect-family，并同步 NOTICE.md / assets/README.md。');
  }
  if (missing.length > 0) {
    bad = true;
    console.error(`\n✗ 界面语料有 ${missing.length} 个字符不在字库里（会静默回退到后备字体族）：`);
    console.error('  ' + missing.map((c) => `${c} U+${c.codePointAt(0).toString(16).toUpperCase()}`).join('  '));
    console.error('  两条路：换一份含这些字形的字库，或把这些界面文案改成字库有的写法。');
  }
  if (allowed.length > 0) {
    console.log(`\nℹ 语料命中 ${allowed.length} 个字库已知缺口（由后备字体族渲染，属预期）：${allowed.join(' ')}`);
  }
  if (bad) process.exit(1);
  console.log(`✓ 字体闸通过：family="${a.names.family}"，界面语料 ${chars.length} 字无意外缺字`);
  process.exit(0);
}
