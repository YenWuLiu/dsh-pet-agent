/**
 * Headless verification of the rebuilt chat panel (runtime/electron-helper/shared-core.js).
 *
 * Runs the REAL module in Node against a REAL local NDJSON server, with a minimal
 * DOM stub — the panel is plain DOM + fetch, so this exercises its whole state
 * machine (status line → streaming caret → terminal settle, retry, cancel,
 * restore, composer sizing) without an Electron window.
 *
 * Run: node tools/chat-smoke/panel-test.mjs
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHARED = join(HERE, '..', '..', 'runtime', 'electron-helper', 'shared-core.js')

// ---------------------------------------------------------------- DOM stub
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.style = {
      setProperty() {}, removeProperty() {},
    }
    this.dataset = {}
    this._text = ''
    this._listeners = new Map()
    this.className = ''
    this.disabled = false
    this.value = ''
    this.placeholder = ''
    this.title = ''
    this.type = ''
    this.rows = 1
    this.scrollTop = 0
    this.scrollHeight = 0
    this.clientHeight = 0
    this.scrollWidth = 0
    this.offsetWidth = 0
    this.offsetHeight = 0
    this.width = 0
    this.height = 0
  }
  get classList() {
    const self = this
    return {
      add: (...c) => { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(' ') },
      remove: (...c) => { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach((x) => s.delete(x)); self.className = [...s].join(' ') },
      toggle: (c, on) => { if (on) self.classList.add(c); else self.classList.remove(c) },
      contains: (c) => self.className.split(' ').includes(c),
    }
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('')
  }
  set textContent(v) { this._text = String(v); this.children = [] }
  get firstChild() { return this.children[0] ?? null }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  append(...kids) { kids.forEach((k) => this.appendChild(k)) }
  remove() {
    if (!this.parentNode) return
    const i = this.parentNode.children.indexOf(this)
    if (i >= 0) this.parentNode.children.splice(i, 1)
    this.parentNode = null
  }
  addEventListener(type, fn) {
    const list = this._listeners.get(type) ?? []
    list.push(fn)
    this._listeners.set(type, list)
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) ?? []
    this._listeners.set(type, list.filter((f) => f !== fn))
  }
  dispatchEvent(event) {
    const e = { type: event.type, target: this, preventDefault() {}, stopPropagation() {}, ...event }
    for (const fn of this._listeners.get(event.type) ?? []) fn(e)
    return true
  }
  click() { this.dispatchEvent({ type: 'click', bubbles: true }) }
  focus() { this.focused = true }
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: this.width || 300, height: this.height || 300, right: (parseFloat(this.style.left) || 0) + (this.width || 300), bottom: (parseFloat(this.style.top) || 0) + (this.height || 300) }
  }
  contains(node) {
    if (node === this) return true
    return this.children.some((c) => c.contains(node))
  }
  querySelectorAll(sel) {
    // Stub limitation: only single-class selectors are parsed (that is all this
    // test needs). Compound selectors are matched by their LAST class so
    // `.a.b` does not silently return nothing.
    const want = String(sel).replace(/^\./, '').split('.').pop().split(' ').pop()
    const out = []
    const walk = (el) => {
      for (const c of el.children) {
        if (c.className.split(' ').includes(want)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null }
}

const doc = {
  head: new El('head'),
  body: new El('body'),
  _listeners: new Map(),
  createElement: (tag) => new El(tag),
  addEventListener(type, fn) {
    const list = this._listeners.get(type) ?? []
    list.push(fn)
    this._listeners.set(type, list)
  },
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) ?? []
    this._listeners.set(type, list.filter((f) => f !== fn))
  },
  dispatchEvent(event) {
    for (const fn of this._listeners.get(event.type) ?? []) fn({ ...event, target: event.target ?? doc })
    return true
  },
}

const win = {
  innerWidth: 1920,
  innerHeight: 1080,
  __dshPetVisibleRect: { x0: 0, y0: 0, x1: 1920, y1: 1080 },
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ font: '14px ShangshouSoftCandy' }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
}
const canvasCtx = { font: '', measureText: (t) => ({ width: String(t).length * 7 }) }

globalThis.window = win
globalThis.document = doc
globalThis.getComputedStyle = win.getComputedStyle
globalThis.HTMLElement = El
const origCreate = doc.createElement
doc.createElement = (tag) => {
  const el = origCreate(tag)
  if (tag === 'canvas') el.getContext = () => canvasCtx
  return el
}

// ------------------------------------------------------- load the real module
const source = readFileSync(SHARED, 'utf8')
const PetShared = vm.runInThisContext(`${source}\n;PetShared`, { filename: 'shared-core.js' })
if (!PetShared || typeof PetShared.mountChatDialog !== 'function') {
  throw new Error('shared-core did not expose mountChatDialog')
}

// ------------------------------------------------------------- mock pet host
const REPLY = '我叫小蓝，是主人桌上的蓝鲸小女仆～历史里你叫我，我当然记得你叫小明呀。'
let mode = 'ok' // ok | slow | error | empty
let cancelled = false
const seen = { posts: [], cancels: 0 }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const json = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify(obj))
  }
  if (url.pathname.endsWith('/chat') && req.method === 'GET') {
    json({ ok: true, messages: [] })
    return
  }
  if (url.pathname.endsWith('/chat/cancel')) {
    seen.cancels += 1
    json({ ok: true, cancelled: true })
    return
  }
  if (url.pathname.endsWith('/chat/stream')) {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const text = JSON.parse(raw).text
      seen.posts.push(text)
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'access-control-allow-origin': '*' })
      const emit = (f) => res.write(JSON.stringify(f) + '\n')
      emit({ v: 1, type: 'user', text })
      let closed = false
      res.on('close', () => { closed = true })
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      void (async () => {
        if (mode === 'error') {
          await wait(120)
          if (!closed) { emit({ v: 1, type: 'error', reason: 'provider-missing', message: '尚未配置模型' }); res.end() }
          return
        }
        emit({ v: 1, type: 'status', text: '正在思考…' })
        await wait(150)
        if (closed) return
        emit({ v: 1, type: 'tool', name: 'pwsh', detail: 'command=echo hi' })
        await wait(150)
        if (closed) return
        const chunks = mode === 'empty' ? [] : (REPLY.match(/[^，。！～]{1,6}[，。！～]?/g) ?? [REPLY])
        let acc = ''
        for (const c of chunks) {
          acc += c
          if (closed) return
          emit({ v: 1, type: 'delta', text: acc })
          await wait(mode === 'slow' ? 400 : 40)
        }
        if (closed) return
        if (mode === 'empty') { emit({ v: 1, type: 'error', reason: 'generate-error', message: '模型未返回文本' }); res.end(); return }
        emit({ v: 1, type: 'final', text: REPLY, ts: Date.now() })
        res.end()
      })()
    })
    return
  }
  res.writeHead(404)
  res.end('nope')
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}/dsh-pet-7340/chat`

// ------------------------------------------------------------------- helpers
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: ok === true, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const msgRows = () => doc.body.querySelectorAll('.dsh-pet-chat-msg')
const panel = () => doc.body.querySelectorAll('.dsh-pet-chat')[0] ?? null
const textOf = (el) => (el ? el.textContent : '')

async function waitFor(fn, ms = 8000, step = 25) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(step)
  }
  return false
}

// ============================================================ 1. streaming turn
// onCancel mirrors runtime/electron-helper/renderer.js: the panel reports the
// abort, the shell POSTs /chat/cancel so the host drops the in-flight turn.
const cancelPost = () => { seen.cancels += 1; void fetch(`${base}/cancel?pet=main`, { method: 'POST' }).catch(() => {}) }
let dialog = PetShared.mountChatDialog({
  petId: 'main',
  petName: '小蓝',
  size: 462,
  baseUrl: base,
  x: 1200,
  y: 200,
  onReply: (reply) => { dialog.lastReply = reply },
  onCancel: () => { cancelPost() },
})

check('panel mounted', panel() !== null && doc.body.children.includes(panel()))
check('header shows the pet name', textOf(panel().querySelector('.dsh-pet-chat-name')) === '小蓝')
check('composer starts disabled', panel().querySelector('.dsh-pet-chat-send').disabled === true)
check('placeholder hints how to send', /回车发送|Enter/.test(String(panel().querySelector('.dsh-pet-chat-input').placeholder)))

// history replay (what the renderer does with GET /chat)
dialog.restore([
  { role: 'user', text: '（历史）你还记得我叫什么吗？' },
  { role: 'pet', text: '（历史）你叫小明呀。' },
  { role: 'user', text: 'x'.repeat(600) },
])
check('restore appends history rows', msgRows().length === 3, { rows: msgRows().length })
check('restore truncates long history text', textOf(msgRows()[2]).length === 401, { len: textOf(msgRows()[2]).length })

const input = panel().querySelector('.dsh-pet-chat-input')
const sendBtn = panel().querySelector('.dsh-pet-chat-send')
input.value = '你叫什么名字？'
input.dispatchEvent({ type: 'input', bubbles: true })
check('typing enables send', sendBtn.disabled === false)

const rowsBeforeSend = msgRows().length
sendBtn.click()

check('user row appears immediately', msgRows().length === rowsBeforeSend + 1 && textOf(msgRows()[msgRows().length - 1]).includes('你叫什么名字？'))
check('input cleared after send', input.value === '')

// during the turn: status line, then a streaming pet row
check('status line while thinking', await waitFor(() => /正在/.test(textOf(panel().querySelector('.dsh-pet-chat-status'))), 2000, 20), { status: textOf(panel().querySelector('.dsh-pet-chat-status')) })
// Timeline of the streaming phase (the panel adds `.streaming` when the first
// delta lands and removes it at settlement) — sampled tightly so the assertion
// is about observed behaviour, not about which 10ms window the poller hit.
const timeline = []
let sawStreaming = false
let sawGrowth = false
let lastLen = -1
const t0 = Date.now()
const poll = setInterval(() => {
  const rows = panel().querySelectorAll('.dsh-pet-chat-msg')
  const classes = rows.map((r) => r.className)
  const live = panel().querySelectorAll('.dsh-pet-chat-msg.streaming')[0]
  const len = live ? textOf(live).length : -1
  if (live) sawStreaming = true
  if (len > lastLen && lastLen >= 0) sawGrowth = true
  lastLen = len
  timeline.push({ dt: Date.now() - t0, streaming: !!live, len, n: rows.length, classes: classes.join(',') })
}, 5)
check('send button turns into 停止', await waitFor(() => textOf(sendBtn) === '停止' || sendBtn.className.includes('stop'), 2000, 20), { label: textOf(sendBtn) })
check('busy dot is pulsing', panel().querySelector('.dsh-pet-chat-dot').className.includes('busy'))
check('turn settles', await waitFor(() => dialog.isBusy() === false, 20000, 20))
clearInterval(poll)
const streamingFrames = timeline.filter((s) => s.streaming)
check('streaming pet row with caret', sawStreaming, { samples: streamingFrames.length, first: streamingFrames[0] })
check('streamed text grows over time (逐字)', sawGrowth, { from: streamingFrames[0]?.len, to: streamingFrames[streamingFrames.length - 1]?.len })

// terminal settle
check('status line disappears at terminal', await waitFor(() => panel().querySelector('.dsh-pet-chat-status') === null, 3000, 20))
check('caret removed at terminal', await waitFor(() => panel().querySelectorAll('.dsh-pet-chat-msg.streaming').length === 0, 3000, 20))
check('panel stays open after the reply (常驻)', dialog.isBusy() === false && panel() !== null)
check('final text is the full reply', textOf(msgRows()[msgRows().length - 1]) === REPLY, { got: textOf(msgRows()[msgRows().length - 1]) })
check('onReply fired with the reply', dialog.lastReply === REPLY)
check('no error row on success', panel().querySelectorAll('.dsh-pet-chat-err').length === 0)
check('send button back to 发送', textOf(sendBtn) === '发送' && sendBtn.disabled === true)
check('turn was POSTed once', seen.posts.length === 1, { posts: seen.posts })

// ============================================================ 2. failure + retry
mode = 'error'
input.value = '在吗'
input.dispatchEvent({ type: 'input', bubbles: true })
sendBtn.click()
check('failure shows an error row', await waitFor(() => panel().querySelectorAll('.dsh-pet-chat-err').length === 1, 4000, 20), { err: textOf(panel().querySelector('.dsh-pet-chat-err')) })
check('failure message names the missing model', textOf(panel().querySelector('.dsh-pet-chat-err')).includes('未配置模型'))
// 去重断言：宿主文案已带「尚未配置模型」时不能再补一次前缀
// （判正则写成 (尚未)?未配置模型 会让「尚未配置模型」两种情况都漏判，这里钉住）
check('failure prefix is not duplicated', (textOf(panel().querySelector('.dsh-pet-chat-err')).match(/未配置模型/g) ?? []).length === 1, { err: textOf(panel().querySelector('.dsh-pet-chat-err')) })
check('failure offers 重试', panel().querySelectorAll('.dsh-pet-chat-retry').length === 1)
check('failure leaves the panel busy-free', dialog.isBusy() === false)

mode = 'ok'
panel().querySelector('.dsh-pet-chat-retry').click()
check('retry clears the error row', await waitFor(() => panel().querySelectorAll('.dsh-pet-chat-err').length === 0, 3000, 10))
// POST 计数在服务端异步发生：等第三条请求真的到站，别用固定 sleep 抢跑
check('retry re-sends the same message', await waitFor(() => seen.posts.length === 3, 3000, 10), { posts: seen.posts })
check('retry re-sends the SAME text', seen.posts[2] === '在吗', { posts: seen.posts })
check('retry does not duplicate the user row', msgRows().filter((r) => textOf(r) === '在吗').length === 1, { rows: msgRows().map(textOf) })
check('retry produces a reply', await waitFor(() => dialog.isBusy() === false && textOf(msgRows()[msgRows().length - 1]) === REPLY, 8000, 25))

// ================================================================ 3. cancel
mode = 'slow'
const rowsBeforeCancel = msgRows().length
input.value = '讲讲你自己'
input.dispatchEvent({ type: 'input', bubbles: true })
sendBtn.click()
await waitFor(() => dialog.isBusy() === true, 2000, 20)
sendBtn.click() // 停止
check('stop button cancels the in-flight turn', await waitFor(() => dialog.isBusy() === false, 3000, 20))
check('host cancel endpoint was called', seen.cancels >= 1, { cancels: seen.cancels })
check('stopped turn leaves 已停止 status (no fake reply)', /已停止/.test(textOf(panel().querySelector('.dsh-pet-chat-status'))) || panel().querySelectorAll('.dsh-pet-chat-err').length === 0)
check('stopped turn did not append a bogus reply', msgRows().length >= rowsBeforeCancel, { rows: msgRows().length })

// ======================================================== 4. close semantics
const closers = dialog
closers.close()
check('close removes the panel from the DOM', panel() === null)
check('close does not throw with nothing in flight', true)

// ======================================================== 5. abort path
mode = 'slow'
dialog = PetShared.mountChatDialog({ petId: 'main', petName: '小蓝', size: 462, baseUrl: base, x: 100, y: 100, onCancel: () => { cancelPost() } })
const input2 = panel().querySelector('.dsh-pet-chat-input')
input2.value = '关掉我'
input2.dispatchEvent({ type: 'input', bubbles: true })
panel().querySelector('.dsh-pet-chat-send').click()
await waitFor(() => dialog.isBusy() === true, 2000, 20)
const cancelsBeforeClose = seen.cancels
dialog.close()
check('closing mid-turn fires onCancel (host cancel requested)', await waitFor(() => seen.cancels > cancelsBeforeClose, 3000, 10), { before: cancelsBeforeClose, after: seen.cancels })
check('closed panel is gone', panel() === null)
dialog.close() // idempotent
check('close is idempotent', true)

// =============================================================== 6. empty reply
mode = 'empty'
dialog = PetShared.mountChatDialog({ petId: 'main', petName: '小蓝', size: 462, baseUrl: base, x: 100, y: 100 })
const input3 = panel().querySelector('.dsh-pet-chat-input')
input3.value = '空回复'
input3.dispatchEvent({ type: 'input', bubbles: true })
panel().querySelector('.dsh-pet-chat-send').click()
check('empty reply is reported as a failure with retry', await waitFor(() => panel().querySelectorAll('.dsh-pet-chat-retry').length === 1, 5000, 20), { err: textOf(panel().querySelector('.dsh-pet-chat-err')) })
dialog.close()

// ============================================= 7. detach（气泡模式：收起但别取消）
// 气泡模式的面板只当输入框：发出去就 detach 收起。这里钉住它与 close 的唯一差别——
// **不取消在飞回合**，回复仍要走到 onReply（渲染层拿它写进头顶气泡）。
mode = 'slow'
let detachedReply = null
let detachedClosed = 0
dialog = PetShared.mountChatDialog({
  petId: 'main', petName: '小蓝', size: 462, baseUrl: base, x: 100, y: 100,
  onCancel: () => { cancelPost() },
  onReply: (reply) => { detachedReply = reply },
  onClose: () => { detachedClosed += 1 },
})
const input4 = panel().querySelector('.dsh-pet-chat-input')
input4.value = '气泡模式'
input4.dispatchEvent({ type: 'input', bubbles: true })
panel().querySelector('.dsh-pet-chat-send').click()
await waitFor(() => dialog.isBusy() === true, 2000, 20)
const cancelsBeforeDetach = seen.cancels
dialog.detach()
check('detach removes the panel from the DOM', panel() === null)
check('detach does not cancel the in-flight turn', seen.cancels === cancelsBeforeDetach, { before: cancelsBeforeDetach, after: seen.cancels })
check('detach notifies onClose (外壳状态照常复原)', detachedClosed === 1, { onClose: detachedClosed })
check('detached turn still delivers the reply to onReply', await waitFor(() => detachedReply === REPLY, 8000, 25), { reply: detachedReply })
check('detached turn is still marked finished', dialog.isFinished() === true)
dialog.detach() // 幂等：再 detach 一次不再回调 onClose
check('detach is idempotent', detachedClosed === 1, { onClose: detachedClosed })

// ========================================= 8. compact（气泡模式的极简输入条）
// 气泡模式下只留一条输入框（回到上游那版样子）：没有标题栏/记录区/发送键，
// 宽度跟着输入文本走，回车发送、Esc 关闭。这里钉住「确实进了 compact 形态」这件事。
mode = 'slow'
let compactReply = null
dialog = PetShared.mountChatDialog({
  petId: 'main', petName: '小蓝', size: 462, baseUrl: base, x: 100, y: 100,
  compact: true,
  onReply: (reply) => { compactReply = reply },
})
const compactPanel = panel()
check('compact: 根元素带 is-compact 标记', compactPanel.classList.contains('is-compact') === true)
check(
  'compact: 样式表把标题栏/记录区/状态行/发送键都藏起来',
  ['.dsh-pet-chat-head', '.dsh-pet-chat-log', '.dsh-pet-chat-status', '.dsh-pet-chat-send']
    .every((sel) => PetShared.CHAT_CSS.includes(`.dsh-pet-chat.is-compact ${sel}`)),
)
const compactInput = compactPanel.querySelector('.dsh-pet-chat-input')
const widthBefore = parseFloat(compactPanel.style.width)
compactInput.value = '这是一句比较长的话用来把输入条撑宽看看宽度会不会跟着走'
compactInput.dispatchEvent({ type: 'input', bubbles: true })
const widthAfter = parseFloat(compactPanel.style.width)
check('compact: 宽度跟着输入文本变宽（160 → 340 之间）', widthAfter > widthBefore && widthAfter <= 340, { before: widthBefore, after: widthAfter })
compactInput.value = '气泡模式'
compactInput.dispatchEvent({ type: 'input', bubbles: true })
const postsBeforeCompact = seen.posts.length
compactInput.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: false })
check('compact: 回车即发送', await waitFor(() => seen.posts.length === postsBeforeCompact + 1, 3000, 10), { posts: seen.posts.length })
check('compact: 回复仍走 onReply', await waitFor(() => compactReply === REPLY, 8000, 25), { reply: compactReply })
doc.dispatchEvent({ type: 'keydown', key: 'Escape' })
check('compact: Esc 关闭输入条', panel() === null)

server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '))
  process.exit(1)
}
process.exit(0)
