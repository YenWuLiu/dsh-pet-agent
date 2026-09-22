/**
 * Pet agent bridge over @deepseek-ai/dsh-chat-agent: one long-lived chat
 * Agent per pet id. Tool access (pwsh computer management included) comes
 * from the dsh-base composition the app boots with.
 *
 * @module @deepseek-ai/dsh-pet-app/agent-chat
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createChatAgent, type ChatAgent } from './vendor/chat-agent.ts'
import { NO_MODEL_CONFIGURED } from './messages.ts'
import { stripThink } from './think-strip.ts'

/** POST /chat response (dsh-pet shared/chat.ts contract). */
export type PetChatResult =
  | { ok: true; reply: string; ts: number }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string }

/**
 * One incremental frame of a streamed chat turn (`POST /chat/stream`, NDJSON).
 * `text` frames carry the WHOLE reply assembled so far, not a delta, so a
 * client renders the bubble by replacement and never has to reassemble text.
 */
export type PetChatFrame =
  | { v: 1; type: 'user'; text: string }
  | { v: 1; type: 'delta'; text: string }
  | { v: 1; type: 'reasoning'; text: string }
  | { v: 1; type: 'tool'; name: string; detail: string }
  | { v: 1; type: 'status'; text: string }
  | { v: 1; type: 'final'; text: string; ts: number }
  | { v: 1; type: 'error'; reason: 'provider-missing' | 'generate-error' | 'aborted'; message?: string }

/** What one streamed turn settled as (fed to the transcript ring and the caller). */
export interface PetTurnOutcome {
  /** Assembled assistant text ('' when the turn produced none). */
  reply: string
  /** Set when the turn failed or was cancelled; `reply` may still hold a prefix. */
  error: { reason: string; message: string } | undefined
  /** True when the turn ended because the user (or the closed dialog) cancelled it. */
  aborted: boolean
  ts: number
}

/** petId -> live chat handle. Agents (and their session logs) persist for the process lifetime. */
const pool = new Map<string, ChatAgent>()
/** session id -> petId (approval requests carry an Agent; this maps it back). */
const sessionToPet = new Map<string, string>()

/**
 * The pet's own model route (provider/model over the pet-registered `dsh-pet`
 * route — see model-config.ts). Undefined means the user has not configured a
 * model yet: the pet does NOT fall back to the DSH deployment's selection.
 */
let modelOverride: { provider: string; model: string } | undefined

/**
 * Replace the model route used for FUTURE agent creation. Existing pool
 * entries keep their route; call closeAllPetAgents to recycle them.
 * @param selection - the pet's own route, or undefined when unconfigured.
 */
export function setModelOverride(selection: { provider: string; model: string } | undefined): void {
  modelOverride = selection
}

/** Read the pet's model route (undefined = not configured yet). */
export function getModelOverride(): { provider: string; model: string } | undefined {
  return modelOverride
}

/** Close every pooled chat Agent (e.g. after a model change; the next chat recreates them). */
export async function closeAllPetAgents(): Promise<void> {
  const entries = [...pool.entries()]
  pool.clear()
  sessionToPet.clear()
  await Promise.all(entries.map(async ([, chat]) => {
    try { await chat.close() } catch { /* already disposed */ }
  }))
}

/**
 * Return the pet's chat Agent, creating it on first use. The session id is
 * STABLE (`pet-<petId>`): the persisted JSONL log replays as conversation
 * history on the next process start — that is the pet's cross-restart
 * memory. A resume rejection falls back to a fresh id (memory lost, pet
 * still boots).
 * @param ctx - plugin context carrying agents.
 * @param petId - the pet instance id (one Agent per id).
 * @returns the chat handle.
 */
export async function ensurePetAgent(ctx: Context, petId: string): Promise<ChatAgent> {
  const existing = pool.get(petId)
  if (existing !== undefined) return existing
  // No deployment-default fallback: the pet runs only on the user's own model
  // configuration (settings dialog → model-config.ts).
  if (modelOverride === undefined) {
    throw new Error(NO_MODEL_CONFIGURED)
  }
  let chat: ChatAgent
  const route = {
    sessionId: `pet-${petId}`,
    resume: true as const,
    provider: modelOverride.provider,
    model: modelOverride.model,
  }
  try {
    chat = await createChatAgent(ctx, route)
  } catch (error) {
    process.stderr.write(`dsh-pet: resume session pet-${petId} failed (${error instanceof Error ? error.message : String(error)}), starting fresh\n`)
    chat = await createChatAgent(ctx, { ...route, sessionId: `pet-${petId}-${randomUUID()}`, resume: false })
  }
  pool.set(petId, chat)
  sessionToPet.set(String(chat.agent.session.id), petId)
  return chat
}

/**
 * Map an approval request's Agent session id back to its pet.
 * @param sessionId - `req.agent.session.id` as a plain string.
 * @returns the owning pet id, or undefined for non-pet agents.
 */
export function petIdForSession(sessionId: string): string | undefined {
  return sessionToPet.get(sessionId)
}

/**
 * Run one chat turn for a pet and return the reply in the shared/chat.ts
 * contract. Turns serialize per pet inside ChatAgent.send.
 * @param ctx - plugin context carrying agents.
 * @param petId - the pet instance id.
 * @param text - the user's message.
 * @returns the chat response payload.
 */
export async function chatWithAgent(ctx: Context, petId: string, text: string): Promise<PetChatResult> {
  let chat: ChatAgent
  try {
    chat = await ensurePetAgent(ctx, petId)
  } catch (error) {
    return { ok: false, reason: 'provider-missing', message: error instanceof Error ? error.message : String(error) }
  }
  const reply = await chat.send(text)
  // 剥掉可能混进正文的思考段（有的推理模型不把思考拆到 reasoning 字段）
  const answer = stripThink(reply.text).text
  if (answer === '') {
    return { ok: false, reason: 'generate-error', message: reply.error ?? '模型未返回文本' }
  }
  return { ok: true, reply: answer, ts: Date.now() }
}

/** Pretty-print one tool call's raw arguments into a short single-line detail. */
function toolDetail(raw: string): string {
  const text = raw.trim()
  if (text === '') return ''
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return text.slice(0, 120)
  }
  if (typeof value !== 'object' || value === null) return String(value).slice(0, 120)
  const flat = Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => `${key}=${typeof v === 'string' ? v : JSON.stringify(v) ?? ''}`)
    .join(' ')
  return flat.replace(/\s+/g, ' ').slice(0, 120)
}

/**
 * Run one chat turn and report it as it happens: the caller's `emit` receives
 * every progress frame (user echo, tool calls, growing reply text, terminal
 * frame). Live text comes from the process-local assistant stream; when a host
 * publishes none, the settled text is emitted once at turn end (the ChatAgent
 * facade already makes that choice — see vendor/chat-agent.ts).
 *
 * A missing model or a failed agent creation is reported as an `error` frame
 * rather than thrown, so the HTTP layer keeps one response shape.
 *
 * @param ctx - plugin context carrying agents.
 * @param petId - the pet instance id.
 * @param text - the user's message.
 * @param emit - synchronous frame sink (the NDJSON writer).
 * @param signal - aborted when the client goes away; the turn is cancelled too.
 * @returns the settled outcome (also already emitted as the terminal frame).
 */
export async function streamPetTurn(
  ctx: Context,
  petId: string,
  text: string,
  emit: (frame: PetChatFrame) => void,
  signal?: AbortSignal,
): Promise<PetTurnOutcome> {
  let chat: ChatAgent
  try {
    chat = await ensurePetAgent(ctx, petId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ v: 1, type: 'error', reason: 'provider-missing', message })
    return { reply: '', error: { reason: 'provider-missing', message }, aborted: false, ts: Date.now() }
  }
  if (signal?.aborted === true) {
    return { reply: '', error: undefined, aborted: true, ts: Date.now() }
  }

  emit({ v: 1, type: 'user', text })
  let assembledRaw = '' // 模型原始输出（可能含混进正文的思考段）
  let assembled = '' // 剥掉思考段之后、给她说的话
  let aborted = false
  let sawText = false
  // Reasoning is noisy: one transient status line per turn, cleared by the first
  // real token (the renderer removes its status row on the first `delta`).
  let sawReasoning = false
  const unsubscribe = chat.onEvent((event) => {
    if (event.type === 'text-delta') {
      assembledRaw += event.text
      // 有的推理模型把思考写进 content 通道（`…思考…</think>正文`）：这类内容必须先剥掉，
      // 否则整段推理会被当回复显示（实机踩到过）。剥离期间显示"正在思考…"。
      const stripped = stripThink(assembledRaw)
      if (stripped.pending) {
        if (sawReasoning) return
        sawReasoning = true
        emit({ v: 1, type: 'status', text: '正在思考…' })
        return
      }
      sawText = true
      assembled = stripped.text
      emit({ v: 1, type: 'delta', text: assembled })
      return
    }
    if (event.type === 'reasoning-delta') {
      if (sawReasoning) return
      sawReasoning = true
      emit({ v: 1, type: 'status', text: '正在思考…' })
      return
    }
    if (event.type === 'tool-call') {
      emit({ v: 1, type: 'tool', name: event.name, detail: toolDetail(event.arguments) })
      return
    }
    if (event.type === 'approval-asked') {
      emit({ v: 1, type: 'status', text: `等待确认「${event.toolName}」…` })
    }
  })
  const onAbort = (): void => {
    aborted = true
    try {
      chat.agent.cancel({ kind: 'user' })
    } catch { /* already settled: nothing to cancel */ }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const reply = await chat.send(text)
    if (reply.text !== '' && !sawText) {
      // Host published no live frames: show the settled text as one delta（同样剥思考段）
      assembled = stripThink(reply.text).text
      if (assembled !== '') emit({ v: 1, type: 'delta', text: assembled })
    }
    if (aborted || reply.error !== undefined) {
      const message = reply.error ?? '已停止'
      const reason = aborted ? 'aborted' : 'generate-error'
      emit({ v: 1, type: 'error', reason, message })
      return { reply: assembled, error: { reason, message }, aborted, ts: Date.now() }
    }
    if (assembled === '') {
      const message = '模型未返回文本'
      emit({ v: 1, type: 'error', reason: 'generate-error', message })
      return { reply: '', error: { reason: 'generate-error', message }, aborted: false, ts: Date.now() }
    }
    const ts = Date.now()
    emit({ v: 1, type: 'final', text: assembled, ts })
    return { reply: assembled, error: undefined, aborted: false, ts }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ v: 1, type: 'error', reason: 'generate-error', message })
    return { reply: assembled, error: { reason: 'generate-error', message }, aborted, ts: Date.now() }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}

/**
 * Cancel the pet's in-flight turn (dialog「停止」, or a client that vanished
 * mid-stream). A no-op when the pet has no live agent or nothing is running.
 * @param petId - the pet instance id.
 * @returns true when a live agent accepted the cancel request.
 */
export function cancelPetTurn(petId: string): boolean {
  const chat = pool.get(petId)
  if (chat === undefined) return false
  try {
    chat.agent.cancel({ kind: 'user' })
    return true
  } catch {
    return false
  }
}
