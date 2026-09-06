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

/** POST /chat response (dsh-pet shared/chat.ts contract). */
export type PetChatResult =
  | { ok: true; reply: string; ts: number }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string }

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
    throw new Error('尚未配置模型：右键桌宠 → 设置，填写 API Key、接口地址与模型')
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
  if (reply.text === '') {
    return { ok: false, reason: 'generate-error', message: reply.error ?? '模型未返回文本' }
  }
  return { ok: true, reply: reply.text, ts: Date.now() }
}
