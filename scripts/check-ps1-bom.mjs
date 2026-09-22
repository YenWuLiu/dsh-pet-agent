#!/usr/bin/env node
/**
 * check-ps1-bom.mjs —— PowerShell 脚本必须带 UTF-8 BOM（否则中文注释直接让脚本语法错误）。
 *
 * 守的是什么：Windows PowerShell 5.1 读**无 BOM** 的 `.ps1` 时按系统 ANSI 解码，中文机器上
 * 就是 GBK——UTF-8 的中文注释/字符串立刻变乱码，脚本报 `Unexpected token '鐗堟湰'` 之类，
 * 打包直接失败。本仓库的 `scripts/pack-exe.ps1` 踩过这个坑：某个会丢 BOM 的编辑器/工具
 * 保存过一次之后，脚本就再也没法运行。
 *
 * 所以规则是：被跟踪的 `.ps1` 里，只要含**非 ASCII 字节**（中文注释/文案），头三字节就必须是
 * `EF BB BF`；纯 ASCII 的脚本不加 BOM 也能被任何版本正确解析，不强制（免得为了过闸白改文件）。
 * 需要改这类文件时，用能保留 BOM 的方式保存（写回后跑一次本闸即可确认）。
 *
 * 用法：node scripts/check-ps1-bom.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

const listed = execFileSync('git', ['ls-files', '*.ps1'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '')

if (listed.length === 0) {
  console.error('✗ 没有找到任何被跟踪的 .ps1（git ls-files 失败？）')
  process.exit(1)
}

let bad = 0
let skipped = 0
for (const rel of listed) {
  const bytes = readFileSync(join(ROOT, rel))
  const head = bytes.subarray(0, 3)
  const nonAscii = bytes.some((b) => b >= 0x80)
  if (head.equals(BOM)) {
    console.log(`PASS  ${rel}`)
    continue
  }
  if (!nonAscii) {
    skipped++
    console.log(`SKIP  ${rel}（纯 ASCII，无 BOM 也能被 PS 5.1 正确解析）`)
    continue
  }
  bad++
  console.error(
    `FAIL  ${rel} 含非 ASCII 却没有 UTF-8 BOM（头三字节 ${[...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')}）\n` +
      '      PowerShell 5.1 会按 ANSI/GBK 解码 → 中文变乱码 → 脚本语法错误。\n' +
      `      修法：node -e "const f='${rel}',fs=require('fs');fs.writeFileSync(f,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),fs.readFileSync(f)]))"`,
  )
}

console.log(`\n${listed.length - bad}/${listed.length} checks passed（其中 ${skipped} 个纯 ASCII 免检）`)
process.exit(bad === 0 ? 0 : 1)
