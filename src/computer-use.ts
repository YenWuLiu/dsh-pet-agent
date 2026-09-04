/**
 * Computer-use plugin: real GUI control for the pet's Agent.
 *
 * Tools registered into the booted composition's tool catalog:
 *   screenshot        — capture the virtual screen to a model-visible image
 *   mouse_move/click/drag — pointer control via SendInput (koffi → user32)
 *   keyboard_type/key — text and named-key input via SendInput
 *   window_list/focus — top-level window enumeration and foregrounding
 *   app_open          — launch an executable, file, or URI
 *   clipboard_read/write — text clipboard (PowerShell)
 *   notify            — Windows balloon-tip notification (PowerShell)
 *
 * Screenshot images are committed through the mounted attachment store and
 * returned as `image` content blocks: models with image input see the screen,
 * text-only models get the standard placeholder (dsh-llm degradation).
 *
 * @module @deepseek-ai/dsh-pet-app/computer-use
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import koffi from 'koffi'

/** Stable Cordis plugin name. */
export const name = 'computer-use'

/** The tool registry plus the image attachment store (screenshot pipeline). */
export const inject = ['tools', 'attachments']

const execFileAsync = promisify(execFile)

/** Run one PowerShell snippet; returns stdout trimmed. */
async function pwsh(script: string, timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync(
    'pwsh',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  )
  return String(stdout).trim()
}

// ── koffi → user32.dll bindings (mouse/keyboard/window) ─────────────────────

const user32 = koffi.load('user32.dll')

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'long',
  dy: 'long',
  mouseData: 'uint',
  dwFlags: 'uint',
  time: 'uint',
  dwExtraInfo: 'uintptr',
})
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'ushort',
  wScan: 'ushort',
  dwFlags: 'uint',
  time: 'uint',
  dwExtraInfo: 'uintptr',
})
const INPUT_UNION = koffi.union('PET_INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT })
// Win32 INPUT on x64 = type(4) + padding(4) + union(32) = 40 bytes; cbSize must be exact.
const INPUT = koffi.struct('PET_INPUT', { type: 'uint', padding: 'uint', u: INPUT_UNION })

const SetCursorPos = user32.func('bool SetCursorPos(int x, int y)')
const SendInput = user32.func('uint SendInput(uint nInputs, void *pInputs, int cbSize)')
const EnumWindows = user32.func('bool EnumWindows(void *lpEnumFunc, intptr lparam)')
const IsWindowVisible = user32.func('bool IsWindowVisible(void *hWnd)')
const GetWindowTextW = user32.func('int GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)')
const GetWindowTextLengthW = user32.func('int GetWindowTextLengthW(void *hWnd)')
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void *hWnd)')
const ShowWindow = user32.func('bool ShowWindow(void *hWnd, int nCmdShow)')
const GetScreenWidth = user32.func('int GetSystemMetrics(int nIndex)') // SM_CXSCREEN=0
const GetScreenHeight = user32.func('int GetSystemMetrics(int nIndex)')

const INPUT_TYPE_MOUSE = 0
const INPUT_TYPE_KEYBOARD = 1
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_MIDDLEDOWN = 0x0020
const MOUSEEVENTF_MIDDLEUP = 0x0040
const MOUSEEVENTF_MOVE = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const SW_RESTORE = 9

/** One pointer button event at the current cursor position. */
function mouseButtonEvent(flags: number): void {
  const input = { type: INPUT_TYPE_MOUSE, padding: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
  const sent = SendInput(1, [input], koffi.sizeof(INPUT))
  if (sent !== 1) throw new Error(`SendInput(mouse ${String(flags)}) delivered ${String(sent)}/1`)
}

/** One virtual-key event (down or up). */
function keyEvent(vk: number, up: boolean): void {
  const input = { type: INPUT_TYPE_KEYBOARD, padding: 0, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } } }
  const sent = SendInput(1, [input], koffi.sizeof(INPUT))
  if (sent !== 1) throw new Error(`SendInput(key ${String(vk)}) delivered ${String(sent)}/1`)
}

/** One Unicode character event (down+up) for text typing. */
function typeChar(code: number): void {
  for (const flags of [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP]) {
    const input = { type: INPUT_TYPE_KEYBOARD, padding: 0, u: { ki: { wVk: 0, wScan: code, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
    const sent = SendInput(1, [input], koffi.sizeof(INPUT))
    if (sent !== 1) throw new Error(`SendInput(char ${String(code)}) delivered ${String(sent)}/1`)
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => { setTimeout(r, ms) })

const BUTTONS: Record<string, { down: number; up: number }> = {
  left: { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP },
  right: { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP },
  middle: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
}

const NAMED_KEYS: Record<string, number> = {
  enter: 0x0d, tab: 0x09, escape: 0x1b, esc: 0x1b, backspace: 0x08, delete: 0x2e,
  space: 0x20, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  win: 0x5b, shift: 0x10, ctrl: 0x11, alt: 0x12,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
}

/** Press a key combo like ['ctrl','c'] or ['alt','f4']: modifiers down, main tap, modifiers up. */
async function pressCombo(parts: string[]): Promise<void> {
  const modifiers = parts.slice(0, -1).map(p => NAMED_KEYS[p])
  const main = NAMED_KEYS[parts[parts.length - 1]!]
  if (main === undefined || modifiers.some(m => m === undefined)) {
    throw new Error(`unknown key in combo: ${parts.join('+')}`)
  }
  for (const m of modifiers) keyEvent(m!, false)
  await sleep(30)
  keyEvent(main, false)
  await sleep(30)
  keyEvent(main, true)
  await sleep(30)
  for (const m of [...modifiers].reverse()) keyEvent(m!, true)
}

/** Enumerate visible top-level windows with non-empty titles (raw handles kept for focus). */
function listWindows(): Array<{ hwnd: unknown; hwndText: string; title: string }> {
  const out: Array<{ hwnd: unknown; hwndText: string; title: string }> = []
  const cb = koffi.register((hwnd: unknown) => {
    if (IsWindowVisible(hwnd)) {
      const len = GetWindowTextLengthW(hwnd)
      if (len > 0) {
        const buf = Buffer.alloc((len + 1) * 2)
        GetWindowTextW(hwnd, buf, len + 1)
        const title = buf.toString('utf16le').replace(/\0+$/, '')
        if (title.trim() !== '') out.push({ hwnd, hwndText: `0x${koffi.address(hwnd).toString(16)}`, title })
      }
    }
    return true
  }, 'bool (*)(void *, intptr)')
  try {
    EnumWindows(cb, 0)
  } finally {
    koffi.unregister(cb)
  }
  return out
}

/** Mount the computer-use tool set. */
export function apply(ctx: Context): void {
  const register = (tool: ReturnType<typeof defineTool>): void => {
    ctx.tools.register(tool)
  }

  // ── screenshot ────────────────────────────────────────────────────────────
  register(defineTool({
    name: 'computer_screenshot',
    description: '截取当前电脑屏幕并返回图片给你看（视觉感知）。可选 savePath 同时把 PNG 存到指定路径。用于了解屏幕上正在显示什么。',
    parameters: {
      savePath: { type: 'string', description: '可选：同时把截图 PNG 保存到这个绝对路径' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          ref: { type: 'object', required: true, additionalProperties: true },
          savedTo: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `屏幕截图（${String(value.width)}×${String(value.height)}）：` },
        { type: 'image', attachment: value.ref as unknown as ImageAttachmentRef },
      ],
    },
    async execute(args) {
      const dir = mkdtempSync(join(tmpdir(), 'pet-shot-'))
      const file = join(dir, 'screen.png')
      try {
        await pwsh(
          `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
          `$v = [System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
          `$bmp = New-Object System.Drawing.Bitmap $v.Width, $v.Height; ` +
          `$g = [System.Drawing.Graphics]::FromImage($bmp); ` +
          `$g.CopyFromScreen($v.Left, $v.Top, 0, 0, $bmp.Size); ` +
          `$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); ` +
          `$g.Dispose(); $bmp.Dispose()`,
          60_000,
        ).catch((e: unknown) => { throw new Error(`screenshot failed: ${e instanceof Error ? e.message : String(e)}`) })
        const bytes = readFileSync(file)
        if (args.savePath !== undefined) {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(args.savePath, bytes)
        }
        const [ref] = await ctx.attachments.saveImages([{ data: bytes, mediaType: 'image/png', name: 'screenshot.png' }])
        return {
          attachmentId: String(ref!.attachmentId),
          width: ref!.width,
          height: ref!.height,
          // Spread into a plain object: the output schema sees lossless JSON;
          // render casts it back to the branded ImageAttachmentRef.
          ref: { ...ref! },
          ...(args.savePath !== undefined ? { savedTo: args.savePath } : {}),
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }))

  // ── mouse ─────────────────────────────────────────────────────────────────
  register(defineTool({
    name: 'computer_click',
    description: '在屏幕指定坐标点击鼠标（button: left/right/middle，可 double）。坐标是屏幕像素（左上角为 0,0）。',
    parameters: {
      x: { type: 'integer', required: true, description: '屏幕 X 像素坐标' },
      y: { type: 'integer', required: true, description: '屏幕 Y 像素坐标' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '默认 left' },
      double: { type: 'boolean', description: 'true = 双击' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已在 (${String(value.x)}, ${String(value.y)}) 点击` }],
    },
    execute(args) {
      const button = BUTTONS[args.button ?? 'left']!
      if (!SetCursorPos(args.x, args.y)) throw new Error('SetCursorPos failed')
      const clicks = args.double === true ? 2 : 1
      for (let i = 0; i < clicks; i++) {
        mouseButtonEvent(button.down)
        mouseButtonEvent(button.up)
      }
      return Promise.resolve({ x: args.x, y: args.y })
    },
  }))

  register(defineTool({
    name: 'computer_move',
    description: '把鼠标指针移动到屏幕指定坐标（不点击）。',
    parameters: {
      x: { type: 'integer', required: true, description: '屏幕 X 像素坐标' },
      y: { type: 'integer', required: true, description: '屏幕 Y 像素坐标' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `指针已移动到 (${String(value.x)}, ${String(value.y)})` }],
    },
    execute(args) {
      if (!SetCursorPos(args.x, args.y)) throw new Error('SetCursorPos failed')
      return Promise.resolve({ x: args.x, y: args.y })
    },
  }))

  register(defineTool({
    name: 'computer_drag',
    description: '按住左键从一个坐标拖拽到另一个坐标（平滑轨迹）。用于拖文件、框选、拖窗口。',
    parameters: {
      fromX: { type: 'integer', required: true },
      fromY: { type: 'integer', required: true },
      toX: { type: 'integer', required: true },
      toY: { type: 'integer', required: true },
      durationMs: { type: 'integer', description: '拖拽时长，默认 400ms' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: '拖拽完成' }],
    },
    async execute(args) {
      const steps = 24
      const duration = args.durationMs ?? 400
      if (!SetCursorPos(args.fromX, args.fromY)) throw new Error('SetCursorPos(from) failed')
      mouseButtonEvent(MOUSEEVENTF_LEFTDOWN)
      try {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          SetCursorPos(Math.round(args.fromX + (args.toX - args.fromX) * t), Math.round(args.fromY + (args.toY - args.fromY) * t))
          await sleep(duration / steps)
        }
      } finally {
        mouseButtonEvent(MOUSEEVENTF_LEFTUP)
      }
      return { done: true }
    },
  }))

  // ── keyboard ──────────────────────────────────────────────────────────────
  register(defineTool({
    name: 'computer_type',
    description: '在当前焦点窗口输入一段文字（Unicode 逐字输入，支持中文）。',
    parameters: {
      text: { type: 'string', required: true, description: '要输入的文字' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { chars: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已输入 ${String(value.chars)} 个字符` }],
    },
    async execute(args) {
      for (const ch of args.text) {
        for (const unit of [...ch].map(c => c.codePointAt(0)!)) {
          if (unit > 0xffff) {
            // Surrogate pair for astral planes
            const hi = 0xd800 + ((unit - 0x10000) >> 10)
            const lo = 0xdc00 + ((unit - 0x10000) & 0x3ff)
            typeChar(hi)
            typeChar(lo)
          } else {
            typeChar(unit)
          }
        }
        await sleep(4)
      }
      return { chars: args.text.length }
    },
  }))

  register(defineTool({
    name: 'computer_key',
    description: '按一个按键或组合键，如 enter / tab / escape / ctrl+c / alt+f4 / win+d / f5。',
    parameters: {
      key: { type: 'string', required: true, description: '键名或组合（+ 分隔），如 "enter"、"ctrl+c"、"alt+f4"' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已按下 ${value.key}` }],
    },
    async execute(args) {
      const parts = args.key.toLowerCase().split('+').map(p => p.trim()).filter(p => p !== '')
      if (parts.length === 0) throw new Error('empty key')
      if (parts.length === 1) {
        const vk = NAMED_KEYS[parts[0]!]
        if (vk === undefined) throw new Error(`unknown key: ${parts[0]!}（支持 enter/tab/escape/backspace/delete/space/home/end/pageup/pagedown/up/down/left/right/win/shift/ctrl/alt/f1-f12 与组合键）`)
        keyEvent(vk, false)
        await sleep(30)
        keyEvent(vk, true)
      } else {
        await pressCombo(parts)
      }
      return { key: args.key }
    },
  }))

  // ── windows ───────────────────────────────────────────────────────────────
  register(defineTool({
    name: 'window_list',
    description: '列出当前所有可见顶层窗口的标题（含 hwnd），用于找准要操作的目标窗口。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          windows: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: false, properties: { hwnd: { type: 'string', required: true }, title: { type: 'string', required: true } } },
          },
          screen: { type: 'object', additionalProperties: false, required: true, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `可见窗口 ${String(value.windows.length)} 个（屏幕 ${String(value.screen.width)}×${String(value.screen.height)}）：\n` + value.windows.map(w => `- [${w.hwnd}] ${w.title}`).join('\n') }],
    },
    execute() {
      const windows = listWindows().map(w => ({ hwnd: w.hwndText, title: w.title }))
      return Promise.resolve({ windows, screen: { width: GetScreenWidth(0), height: GetScreenHeight(1) } })
    },
  }))

  register(defineTool({
    name: 'window_focus',
    description: '把标题包含指定文本的窗口提到前台并聚焦（先还原最小化窗口）。',
    parameters: {
      title: { type: 'string', required: true, description: '窗口标题包含的文本（不区分大小写）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { focused: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.focused !== undefined ? `已聚焦窗口：${value.focused}` : '没有找到标题匹配的窗口' }],
    },
    execute(args) {
      const needle = args.title.toLowerCase()
      const hit = listWindows().find(w => w.title.toLowerCase().includes(needle))
      if (hit === undefined) return Promise.resolve({})
      ShowWindow(hit.hwnd, SW_RESTORE)
      // Foreground-lock workaround: a background process may only steal the
      // foreground right after injecting input — send a zero-delta mouse move
      // first so SetForegroundWindow is honored instead of silently failing.
      const nudge = { type: INPUT_TYPE_MOUSE, padding: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: MOUSEEVENTF_MOVE, time: 0, dwExtraInfo: 0 } } }
      SendInput(1, [nudge], koffi.sizeof(INPUT))
      const ok = SetForegroundWindow(hit.hwnd)
      if (!ok) throw new Error(`SetForegroundWindow failed for "${hit.title}"`)
      return Promise.resolve({ focused: hit.title })
    },
  }))

  // ── app / clipboard / notify ──────────────────────────────────────────────
  register(defineTool({
    name: 'app_open',
    description: '启动一个程序、文件或网址（等价于开始菜单/运行）。如 notepad、mspaint、explorer、calc、https://…',
    parameters: {
      target: { type: 'string', required: true, description: '程序名/路径/URI' },
      args: { type: 'string', description: '可选命令行参数（一个字符串）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { opened: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已启动：${value.opened}` }],
    },
    async execute(args) {
      const cmdArgs = args.args !== undefined ? ` ${args.args}` : ''
      await pwsh(`Start-Process -FilePath '${args.target.replace(/'/g, "''")}'${cmdArgs !== '' ? ` -ArgumentList '${cmdArgs.trim().replace(/'/g, "''")}'` : ''}`)
      return { opened: args.target }
    },
  }))

  register(defineTool({
    name: 'clipboard_read',
    description: '读取剪贴板里的文字内容。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text === '' ? '（剪贴板为空或不是文字）' : `剪贴板内容：${value.text}` }],
    },
    async execute() {
      const text = await pwsh('Get-Clipboard -Raw')
      return { text }
    },
  }))

  register(defineTool({
    name: 'clipboard_write',
    description: '把一段文字写入剪贴板（之后可在任何地方 Ctrl+V 粘贴）。',
    parameters: {
      text: { type: 'string', required: true, description: '要写入的文字' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { chars: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已写入剪贴板（${String(value.chars)} 字符）` }],
    },
    async execute(args) {
      const b64 = Buffer.from(args.text, 'utf8').toString('base64')
      await pwsh(`Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`)
      return { chars: args.text.length }
    },
  }))

  register(defineTool({
    name: 'notify',
    description: '在 Windows 右下角弹一条系统通知（气泡提示），用于主动提醒用户。',
    parameters: {
      title: { type: 'string', required: true, description: '通知标题' },
      message: { type: 'string', required: true, description: '通知正文' },
      seconds: { type: 'integer', description: '显示秒数，默认 5' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { shown: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: '通知已弹出' }],
    },
    async execute(args) {
      const t = Buffer.from(args.title, 'utf8').toString('base64')
      const m = Buffer.from(args.message, 'utf8').toString('base64')
      const seconds = args.seconds ?? 5
      await pwsh(
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
        `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
        `$n.Icon = [System.Drawing.SystemIcons]::Information; ` +
        `$n.Visible = $true; ` +
        `$title = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${t}')); ` +
        `$msg = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${m}')); ` +
        `$n.ShowBalloonTip(${String(seconds * 1000)}, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Info); ` +
        `Start-Sleep -Seconds ${String(Math.min(seconds, 10))}; $n.Dispose()`,
        30_000,
      )
      return { shown: true }
    },
  }))
}
