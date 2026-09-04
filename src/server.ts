/**
 * Pet server: the desktop pet's backend on the dsh kernel. Serves the
 * dsh-pet `/dsh-pet-7340` route contract over plain HTTP on 127.0.0.1
 * (config, assets, whisper, chat, balance stub, broadcast stub), drives one
 * kernel Agent per pet for chat (with the full dsh-base tool catalog — pwsh
 * computer management included), and spawns the Electron desktop helper for
 * desktop-visible pets.
 *
 * The chat route is the upgrade over upstream dsh-pet: replies come from a
 * real kernel Agent (session-persisted, tool-using), not a bare LLM call.
 *
 * @module @deepseek-ai/dsh-pet-app/server
 */

import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { flattenPetList, readAllConfig, type ConfigPaths } from './vendor/config.ts'
import { generateWhisper } from './vendor/whisper.ts'
import { chatWithAgent, closeAllPetAgents, ensurePetAgent, getModelOverride, petIdForSession, setModelOverride } from './agent-chat.ts'
import { resolveElectronExe, spawnPetElectron, type PetWindowSpec } from './electron.ts'
// Empty type imports carry the Context service/event merges.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-user-approval'

const execFileAsync = promisify(execFile)

/** Stable Cordis plugin name. */
export const name = 'pet-server'

/** Core services the pet backend consumes. */
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'llm']

/** Plugin config: HTTP port and whether to spawn the desktop helper. */
export interface Config {
  port: number
  electron: boolean
}

export const Config: z<Config> = z.object({
  port: z.number().default(7340),
  electron: z.boolean().default(true),
})

/** This app's package root (src/ sits one level below it). */
const APP_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const ROUTE_PREFIX = '/dsh-pet-7340'

const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.jsonc': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

/** Normalize and confine a relative asset path to its root (path-traversal guard). */
function resolveAsset(root: string, rel: string): string | undefined {
  if (rel.length === 0) return undefined
  const candidate = normalize(join(root, rel))
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined
  return candidate
}

function resolveExisting(root: string, rel: string): string | undefined {
  const candidate = resolveAsset(root, rel)
  return candidate !== undefined && existsSync(candidate) ? candidate : undefined
}

function sendJson(res: ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
    ...CORS,
    ...headers,
  })
  res.end(body)
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...CORS })
  res.end(text)
}

async function sendFile(res: ServerResponse, file: string, contentType: string): Promise<void> {
  const { size } = await stat(file)
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'cache-control': 'public, max-age=3600',
    ...CORS,
  })
  const stream = createReadStream(file)
  stream.on('error', () => { res.destroy() })
  stream.pipe(res)
}

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = ''
  for await (const chunk of req) raw += chunk as string
  return raw
}

/** The pet's final persona for whisper: its entry's whisperPrompt plus a name line. */
function petWhisperPrompt(entry: Record<string, unknown> | undefined, petId: string): string {
  const base = typeof entry?.whisperPrompt === 'string' ? entry.whisperPrompt : ''
  const petName = typeof entry?.name === 'string' && entry.name !== '' ? entry.name : petId
  return `${base}\n你的名字是${petName}。`.trim()
}

/** Desktop-visible pets of one merged config product (display desktop|both). */
function desktopPets(merged: Record<string, Record<string, unknown>>): PetWindowSpec[] {
  return flattenPetList(merged)
    .filter(p => p.display === 'desktop' || p.display === 'both')
    .map(p => ({ id: String(p.id), size: Number(p.size) > 0 ? Number(p.size) : 462 }))
}

/** Mount the pet backend. */
export function apply(ctx: Context, config: Config): void {
  const assetsRoot = join(APP_ROOT, 'assets')
  const userRoot = join(resolveDshHome(), 'dsh-pet')
  const paths: ConfigPaths = {
    defaultFile: join(assetsRoot, 'config.jsonc'),
    userFile: join(userRoot, 'main-config.json'),
    petDir: join(userRoot, 'pet'),
  }
  const userAnimRoot = join(userRoot, 'main-animation', 'webm')

  /** Per-pet whisper cache: same-pet polls inside the interval reuse the line. */
  const whisperCache = new Map<string, { text: string; ts: number }>()

  /** Per-pet progress broadcast: the renderer polls /broadcast 1s and pops a bubble on ts change. */
  const broadcastCache = new Map<string, { text: string; ts: number }>()
  /** Pets whose Agent events are already bridged to the broadcast cache. */
  const bridgedPets = new Set<string>()
  /** Per-pet streaming accumulator: text-deltas accumulate into a growing reply bubble (throttled). */
  const streamAcc = new Map<string, { text: string; lastTs: number; thinkingShown: boolean }>()

  /**
   * Bridge one pet's Agent events into its broadcast cache (once per pet).
   * The visible arc of one turn on a heavy-reasoning model:
   *   正在思考… → (tool) 正在执行 pwsh… → 正在思考… → reply text streaming.
   * Reasoning deltas raise one "thinking" bubble per turn (their text is
   * noise); text deltas accumulate into a streaming reply bubble (ts bumped
   * at most once per 800ms so the 1s polling renderer re-pops growing text).
   */
  const bridgePetEvents = async (petId: string): Promise<void> => {
    if (bridgedPets.has(petId)) return
    const chat = await ensurePetAgent(ctx, petId)
    if (bridgedPets.has(petId)) return
    bridgedPets.add(petId)
    chat.onEvent((event) => {
      if (process.env.DSH_PET_DEBUG_EVENTS === '1') {
        process.stderr.write(`[events] pet=${petId} type=${event.type}\n`)
      }
      if (event.type === 'tool-call') {
        broadcastCache.set(petId, { text: `正在执行 ${event.name}…`, ts: Date.now() })
        return
      }
      if (event.type === 'reasoning-delta') {
        const acc = streamAcc.get(petId) ?? { text: '', lastTs: 0, thinkingShown: false }
        if (!acc.thinkingShown) {
          acc.thinkingShown = true
          broadcastCache.set(petId, { text: '正在思考…', ts: Date.now() })
        }
        streamAcc.set(petId, acc)
        return
      }
      if (event.type === 'text-delta') {
        const acc = streamAcc.get(petId) ?? { text: '', lastTs: 0, thinkingShown: false }
        acc.text += event.text
        const now = Date.now()
        if (now - acc.lastTs >= 800) {
          acc.lastTs = now
          broadcastCache.set(petId, { text: acc.text, ts: now })
        }
        streamAcc.set(petId, acc)
        return
      }
      if (event.type === 'turn-end') {
        // Flush: a fast answer can stream entirely inside one 800ms throttle
        // window — without this the final (complete) text never broadcasts.
        const acc = streamAcc.get(petId)
        if (acc !== undefined && acc.text !== '') {
          broadcastCache.set(petId, { text: acc.text, ts: Date.now() })
        }
      }
    })
  }

  // ── approval answerer (bubble mode supported) ────────────────────────────
  // approval/request is a waterfall seam: return an outcome to claim, next()
  // to delegate. Modes (DSH_PET_APPROVAL):
  //   'auto'   — allow everything with an audit line (default; also the
  //              headless/no-window stance).
  //   'bubble' — park the request in a pending map; the pet window polls
  //              /approval/pending and the user's click POSTs /approval/decide.
  //              90s without a decision resolves 'unavailable' (fail closed).
  // Under danger-full-access composition no requests fire at all; in ask
  // policy (e.g. DSH_PERMISSION_MODE=workspace-write) this is the answerer.
  type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  interface PendingApproval {
    id: string
    petId: string | undefined
    toolName: string
    reason: string | undefined
    resolve: (outcome: ApprovalOutcome) => void
    timer: NodeJS.Timeout
  }
  const approvalMode = (process.env.DSH_PET_APPROVAL ?? 'auto') === 'bubble' ? 'bubble' : 'auto'
  const pendingApprovals = new Map<string, PendingApproval>()
  let approvalSeq = 0
  const APPROVAL_TIMEOUT_MS = 90_000

  const settleApproval = (id: string, outcome: ApprovalOutcome): boolean => {
    const pending = pendingApprovals.get(id)
    if (pending === undefined) return false
    pendingApprovals.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(outcome)
    return true
  }

  ctx.on('approval/request', (req, next) => {
    void next
    if (approvalMode === 'auto') {
      process.stderr.write(`${name}: approval ${req.toolName}${req.reason !== undefined ? ` (${req.reason})` : ''} -> allowed-once (pet auto-answerer)\n`)
      return Promise.resolve('allowed-once' as const)
    }
    const petId = petIdForSession(String(req.agent.session.id))
    const id = `apv-${String(++approvalSeq)}`
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (settleApproval(id, 'unavailable')) {
          process.stderr.write(`${name}: approval ${id} ${req.toolName} timed out -> unavailable\n`)
        }
      }, APPROVAL_TIMEOUT_MS)
      pendingApprovals.set(id, {
        id,
        petId,
        toolName: req.toolName,
        reason: req.reason,
        resolve,
        timer,
      })
      req.signal?.addEventListener('abort', () => { settleApproval(id, 'cancelled') }, { once: true })
      if (petId !== undefined) {
        broadcastCache.set(petId, { text: `需要权限：${req.toolName}，请在宠物上确认`, ts: Date.now() })
      }
      process.stderr.write(`${name}: approval pending ${id} ${req.toolName} (bubble mode)\n`)
    })
  })

  // ── settings (autostart via registry Run key + model route override) ─────
  const stateDir = join(resolveDshHome(), 'dsh-pet-agent')
  const settingsFile = join(stateDir, 'settings.json')
  interface PetSettings {
    model?: { provider: string; model: string } | null
  }
  const readSettings = async (): Promise<PetSettings> => {
    try { return JSON.parse(await readFile(settingsFile, 'utf8')) as PetSettings } catch { return {} }
  }
  const writeSettings = async (s: PetSettings): Promise<void> => {
    await mkdir(stateDir, { recursive: true })
    await writeFile(settingsFile, JSON.stringify(s, null, 2) + '\n')
  }
  // Apply the saved model override at boot (creation-time route in agent-chat).
  void readSettings().then((s) => {
    if (s.model !== undefined && s.model !== null) setModelOverride(s.model)
  }).catch(() => undefined)

  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const RUN_VALUE = 'DshPet'
  const autostartRead = async (): Promise<boolean> => {
    try {
      await execFileAsync('reg', ['query', RUN_KEY, '/v', RUN_VALUE])
      return true
    } catch {
      return false
    }
  }
  const autostartWrite = async (enable: boolean): Promise<void> => {
    if (!enable) {
      try { await execFileAsync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']) } catch { /* absent */ }
      return
    }
    // Hidden launch: a wscript wrapper sets the cwd (tsx resolves from the app
    // root's node_modules) and starts node without a console window.
    const vbsPath = join(stateDir, 'start-pet-hidden.vbs')
    await mkdir(stateDir, { recursive: true })
    const runCmd = `"${process.execPath}" --import tsx/esm src\\bin.ts`
    const vbs = [
      'Set sh = CreateObject("Wscript.Shell")',
      `sh.CurrentDirectory = "${APP_ROOT}"`,
      `sh.Run "${runCmd.replace(/"/g, '""')}", 0, False`,
      '',
    ].join('\r\n')
    await writeFile(vbsPath, vbs, 'ascii')
    await execFileAsync('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `wscript.exe "${vbsPath}"`, '/f'])
  }

  const whisperIntervalSec = (): number => {
    const merged = readAllConfig(paths)
    const main = merged.main as Record<string, unknown> | undefined
    const ers = main?.eventsRefreshSec as Record<string, unknown> | undefined
    const v = Number(ers?.whisper)
    return Number.isFinite(v) && v > 0 ? v : 3600
  }

  const serveWhisper = async (petId: string, force: boolean, res: ServerResponse): Promise<void> => {
    const now = Date.now()
    const intervalMs = whisperIntervalSec() * 1000
    const cached = whisperCache.get(petId)
    if (!force && cached !== undefined && now - cached.ts < intervalMs) {
      sendJson(res, 200, { ok: true, text: cached.text, ts: cached.ts })
      return
    }
    const merged = readAllConfig(paths)
    const entry = flattenPetList(merged).find(p => String(p.id) === petId)
    const result = await generateWhisper(ctx, petWhisperPrompt(entry, petId))
    if (!result.ok) {
      sendJson(res, 200, { ok: false, reason: result.reason, message: result.message })
      return
    }
    whisperCache.set(petId, { text: result.text, ts: now })
    sendJson(res, 200, { ok: true, text: result.text, ts: now })
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }
    if (!url.pathname.startsWith(ROUTE_PREFIX)) {
      sendText(res, 404, 'dsh-pet: not found')
      return
    }
    const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
    const petId = url.searchParams.get('pet') ?? 'main'

    if (rest === 'config' && req.method === 'GET') {
      sendJson(res, 200, readAllConfig(paths))
      return
    }
    if (rest === 'config/meta' && req.method === 'GET') {
      sendJson(res, 200, { ...paths, assetsRoot, userAnimRoot })
      return
    }
    if (rest === 'config.jsonc' && req.method === 'GET') {
      await sendFile(res, paths.defaultFile, MIME['.jsonc']!)
      return
    }
    if (rest === 'whisper' && req.method === 'GET') {
      await serveWhisper(petId, false, res)
      return
    }
    if (rest === 'whisper/trigger' && req.method === 'GET') {
      await serveWhisper(petId, true, res)
      return
    }
    if (rest === 'balance' && req.method === 'GET') {
      let provider = 'unknown'
      try { provider = ctx.agentDefaultModel.currentSelection().provider } catch { /* no selection */ }
      sendJson(res, 200, { ok: false, provider, reason: 'unsupported' })
      return
    }
    if (rest === 'balance/trigger' && req.method === 'GET') {
      sendJson(res, 200, { count: 0 }, { 'cache-control': 'no-store' })
      return
    }
    if (rest === 'approval/pending' && req.method === 'GET') {
      const pending = [...pendingApprovals.values()]
        .filter(p => p.petId === petId)
        .map(p => ({ id: p.id, toolName: p.toolName, reason: p.reason }))
      sendJson(res, 200, { ok: true, pending }, { 'cache-control': 'no-store' })
      return
    }
    if (rest === 'approval/decide' && req.method === 'POST') {
      const raw = await readBody(req)
      let id = ''
      let outcome = ''
      try {
        const body = JSON.parse(raw) as { id?: unknown; outcome?: unknown }
        id = String(body.id ?? '')
        outcome = String(body.outcome ?? '')
      } catch { /* bad json */ }
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        sendJson(res, 200, { ok: false, reason: 'bad-request', message: 'outcome must be allowed-once|rejected' })
        return
      }
      if (!settleApproval(id, outcome)) {
        sendJson(res, 200, { ok: false, reason: 'bad-request', message: 'unknown or settled approval id' })
        return
      }
      process.stderr.write(`${name}: approval ${id} -> ${outcome} (pet bubble)\n`)
      sendJson(res, 200, { ok: true })
      return
    }
    if (rest === 'settings' && req.method === 'GET') {
      const saved = await readSettings()
      let effective = getModelOverride()
      if (effective === undefined) {
        try { effective = ctx.agentDefaultModel.currentSelection() } catch { effective = undefined }
      }
      sendJson(res, 200, {
        ok: true,
        autostart: await autostartRead(),
        model: saved.model ?? null,
        effective: effective ?? null,
      })
      return
    }
    if (rest === 'settings' && req.method === 'PUT') {
      const raw = await readBody(req)
      let body: { autostart?: unknown; model?: unknown }
      try {
        body = JSON.parse(raw) as typeof body
      } catch {
        sendJson(res, 200, { ok: false, reason: 'bad-request', message: 'invalid json' })
        return
      }
      if (typeof body.autostart === 'boolean') {
        try {
          await autostartWrite(body.autostart)
        } catch (error) {
          sendJson(res, 200, { ok: false, reason: 'autostart-error', message: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      if (body.model !== undefined) {
        const saved = await readSettings()
        if (body.model === null) {
          setModelOverride(undefined)
          saved.model = null
          await writeSettings(saved)
          await closeAllPetAgents()
        } else {
          const m = body.model as { provider?: unknown; model?: unknown }
          const provider = String(m.provider ?? '').trim()
          const model = String(m.model ?? '').trim()
          if (provider === '' || model === '') {
            sendJson(res, 200, { ok: false, reason: 'bad-request', message: 'provider/model 不能为空' })
            return
          }
          try {
            await ctx.llm.resolveModelInfo(provider, model)
          } catch (error) {
            sendJson(res, 200, { ok: false, reason: 'model-invalid', message: `模型不可用：${error instanceof Error ? error.message : String(error)}` })
            return
          }
          setModelOverride({ provider, model })
          saved.model = { provider, model }
          await writeSettings(saved)
          await closeAllPetAgents()
        }
      }
      sendJson(res, 200, { ok: true })
      return
    }
    if (rest === 'broadcast' && req.method === 'GET') {
      const hit = broadcastCache.get(petId)
      sendJson(res, 200, { ok: true, text: hit?.text ?? '', ts: hit?.ts ?? 0 }, { 'cache-control': 'no-store' })
      return
    }
    if (rest === 'chat' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, messages: [] })
      return
    }
    if (rest === 'chat' && req.method === 'POST') {
      const raw = await readBody(req)
      let text = ''
      try { text = String((JSON.parse(raw) as { text?: unknown }).text ?? '').trim() } catch { /* bad json */ }
      if (text === '') {
        sendJson(res, 200, { ok: false, reason: 'bad-request', message: 'empty text' })
        return
      }
      streamAcc.delete(petId) // new turn: restart the streaming bubble from empty
      await bridgePetEvents(petId)
      const result = await chatWithAgent(ctx, petId, text)
      sendJson(res, 200, result)
      return
    }
    if (rest.startsWith('thumb/') && req.method === 'GET') {
      const parts = rest.slice('thumb/'.length).split('/').map(decodeURIComponent)
      if (parts.length !== 2 || !parts[1]!.endsWith('.webm')) {
        sendText(res, 400, 'dsh-pet: expected /dsh-pet-7340/thumb/<root>/<name>.webm')
        return
      }
      const [root, file] = parts as [string, string]
      // Main pet: user animations shadow the packaged pool; pet packs read only
      // their own directory (never the main pool).
      const candidates = root === 'main'
        ? [resolveExisting(userAnimRoot, file), resolveExisting(join(assetsRoot, 'webm'), file)]
        : [resolveExisting(join(paths.petDir, `${root}-animation`), file)]
      const found = candidates.find((c): c is string => c !== undefined)
      if (found === undefined) {
        sendText(res, 404, 'dsh-pet: asset not found')
        return
      }
      await sendFile(res, found, MIME['.webm']!)
      return
    }
    if (rest.startsWith('font/') && req.method === 'GET') {
      const file = resolveExisting(join(assetsRoot, 'fonts'), decodeURIComponent(rest.slice('font/'.length)))
      if (file === undefined) { sendText(res, 404, 'dsh-pet: not found'); return }
      const ext = file.slice(file.lastIndexOf('.'))
      await sendFile(res, file, MIME[ext] ?? 'application/octet-stream')
      return
    }
    if (rest.startsWith('pic/') && req.method === 'GET') {
      const file = resolveExisting(join(assetsRoot, 'pic'), decodeURIComponent(rest.slice('pic/'.length)))
      if (file === undefined) { sendText(res, 404, 'dsh-pet: not found'); return }
      await sendFile(res, file, MIME['.png']!)
      return
    }
    sendText(res, 404, 'dsh-pet: not found')
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendText(res, 500, `dsh-pet: ${error instanceof Error ? error.message : String(error)}`)
      else res.destroy()
    })
  })

  const helperDir = join(APP_ROOT, 'runtime', 'electron-helper')
  let child: ReturnType<typeof spawnPetElectron> | undefined
  let electronStarted = false

  // Port-in-use resilience: a second instance (autostart + manual, or kernel +
  // standalone side by side) falls back to a random port instead of dying.
  server.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && config.port !== 0) {
      process.stderr.write(`${name}: port ${String(config.port)} in use, falling back to a random port\n`)
      server.listen(0, '127.0.0.1')
      return
    }
    process.stderr.write(`${name}: server error: ${error.message}\n`)
  })

  server.on('listening', () => {
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.port
    process.stderr.write(`${name}: pet server on http://127.0.0.1:${String(port)}${ROUTE_PREFIX}\n`)

    if (electronStarted) return
    electronStarted = true
    if (!config.electron || process.env.DSH_PET_NO_ELECTRON === '1') return
    const pets = desktopPets(readAllConfig(paths))
    if (pets.length === 0) {
      process.stderr.write(`${name}: no desktop-visible pets (display desktop/both), Electron not started\n`)
      return
    }
    const exe = resolveElectronExe(APP_ROOT)
    if (exe === undefined) {
      process.stderr.write(`${name}: Electron not installed (devDependency); desktop window skipped, HTTP routes live\n`)
      return
    }
    const smokeOut = process.env.DSH_PET_SMOKE_OUT
    child = spawnPetElectron({
      exe,
      helperDir,
      configUrl: `http://127.0.0.1:${String(port)}${ROUTE_PREFIX}/config`,
      pets,
      ...(smokeOut !== undefined && smokeOut !== ''
        ? { smoke: { out: smokeOut, ...(process.env.DSH_PET_SMOKE_AFTER_MS !== undefined ? { afterMs: Number(process.env.DSH_PET_SMOKE_AFTER_MS) } : {}) } }
        : {}),
    })
    child.on('error', (error) => { process.stderr.write(`${name}: electron spawn failed: ${error.message}\n`) })
    child.on('exit', (code) => { process.stderr.write(`${name}: desktop helper exited (${String(code)})\n`) })
    process.stderr.write(`${name}: desktop helper started for ${String(pets.length)} pet(s): ${pets.map(p => p.id).join(', ')}\n`)
  })
  server.listen(config.port, '127.0.0.1')

  ctx.effect(function* () {
    yield () => {
      child?.kill()
      server.close()
    }
  })
}
