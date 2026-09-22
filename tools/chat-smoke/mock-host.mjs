/**
 * Mock pet host for the chat-panel smoke test.
 *
 * Serves the minimum of the /dsh-pet-7340 contract the Electron helper needs
 * (config, one animation asset, chat history) plus a REAL NDJSON /chat/stream
 * implementation whose frames mimic a kernel turn: thinking status → tool call
 * → reply text in chunks → final. The point is to exercise the panel's whole
 * state machine (status line, streaming caret, terminal settle) without booting
 * the kernel or spending model tokens.
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PORT = Number(process.env.MOCK_PORT || 7399)

/** Animation asset served for /thumb/...: any real packaged webm keeps the sprite happy. */
function assetFile() {
  const dir = join(ROOT, 'assets', 'webm')
  if (!existsSync(dir)) return undefined
  const first = readdirSync(dir).find((f) => f.endsWith('.webm'))
  return first === undefined ? undefined : join(dir, first)
}

/** The reply this mock streams back, split so the client sees several deltas. */
const REPLY = '我叫小蓝，是主人桌上的蓝鲸小女仆～刚才你在历史里叫我，我当然记得你叫小明呀。'

/** The real pet config (assets/config.jsonc) is JSONC; strip comments for the mock. */
function readPetConfig() {
  const raw = readFileSync(join(ROOT, 'assets', 'config.jsonc'), 'utf8')
  const stripped = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return JSON.parse(stripped)
}

/** Merged host config: { <entry>: { pets, animations, ... } } — what flattenConfigPets walks. */
function mergedConfig() {
  const cfg = readPetConfig()
  const pet = cfg.pets[0]
  return {
    main: {
      ...cfg,
      pets: [{ ...pet, balanceEnabled: false, whisperEnabled: false, workStatusEnabled: false }],
      eventsRefreshSec: { whisper: 3600, balance: 3600 },
      workStatusTexts: [],
      physics: cfg.physics,
    },
  }
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const rest = url.pathname.replace(/^\/dsh-pet-7340/, '')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' })
    res.end()
    return
  }
  if (rest === '/config') {
    sendJson(res, 200, mergedConfig())
    return
  }
  if (rest.startsWith('/thumb/') || rest.startsWith('/pic/') || rest.startsWith('/font/')) {
    const file = assetFile()
    if (file === undefined) {
      res.writeHead(404)
      res.end('mock: no packaged asset to serve')
      return
    }
    const body = readFileSync(file)
    res.writeHead(200, {
      'content-type': rest.startsWith('/thumb/') ? 'video/webm' : rest.startsWith('/font/') ? 'font/ttf' : 'image/png',
      'content-length': body.length,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    res.end(body)
    return
  }
  if (rest === '/whisper' || rest === '/broadcast' || rest === '/work-status' || rest === '/approval/pending') {
    sendJson(res, 200, { ok: true, text: '', ts: 0, state: null, pending: [] })
    return
  }
  if (rest === '/chat' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, messages: [] })
    return
  }
  if (rest === '/chat/cancel' && req.method === 'POST') {
    console.log('[mock] cancel requested')
    sendJson(res, 200, { ok: true, cancelled: true })
    return
  }
  if (rest === '/chat/stream' && req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let text = ''
      try { text = String(JSON.parse(raw).text || '') } catch { /* ignore */ }
      console.log('[mock] stream turn:', JSON.stringify(text))
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      })
      const emit = (frame) => res.write(JSON.stringify(frame) + '\n')
      emit({ v: 1, type: 'user', text })
      let cancelled = false
      res.on('close', () => { cancelled = true })
      const chunks = REPLY.match(/[^，。！～]{1,6}[，。！～]?/g) ?? [REPLY]
      let i = 0
      let acc = ''
      const frameAt = (type, delay) => new Promise((resolve) => setTimeout(() => {
        if (cancelled) { resolve('cancelled'); return }
        if (type === 'status') emit({ v: 1, type: 'status', text: '正在思考…' })
        if (type === 'tool') emit({ v: 1, type: 'tool', name: 'pwsh', detail: 'command=echo hi' })
        if (type === 'delta') {
          acc += chunks[i] ?? ''
          i += 1
          emit({ v: 1, type: 'delta', text: acc })
        }
        if (type === 'final') {
          emit({ v: 1, type: 'final', text: REPLY, ts: Date.now() })
          res.end()
        }
        resolve('ok')
      }, delay))
      const run = async () => {
        if (await frameAt('status', 250) === 'cancelled') return
        if (await frameAt('tool', 350) === 'cancelled') return
        for (let n = 0; n < chunks.length; n += 1) {
          if (await frameAt('delta', 90) === 'cancelled') return
        }
        await frameAt('final', 120)
      }
      void run()
    })
    return
  }
  res.writeHead(404, { 'access-control-allow-origin': '*' })
  res.end('mock: not found ' + rest)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] pet host on http://127.0.0.1:${PORT}/dsh-pet-7340`)
})
