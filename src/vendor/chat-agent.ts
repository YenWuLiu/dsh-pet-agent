/**
 * @deepseek-ai/dsh-chat-agent — high-level chat Agent facade.
 *
 * The kernel's Agent registry is a composition engine: creating an Agent,
 * installing its model selection, driving turns, and projecting progress are
 * four separate moves every chat-shaped application repeats (the headless
 * runner carries the canonical implementation). This package folds them into
 * one small API:
 *
 * ```ts
 * const chat = await createChatAgent(ctx, { sessionId: 'pet-main' })
 * const off = chat.onEvent(event => render(event))
 * const reply = await chat.send('list my Downloads folder')
 * ```
 *
 * `send` serializes turns per instance and resolves with the last assistant
 * text of the owned turn, read from the durable session log (the headless
 * summarize contract). `onEvent` projects the same log into a small UI-safe
 * vocabulary — text/reasoning deltas, tool calls and results, turn ends —
 * scoped to this instance's session only.
 *
 * @module @deepseek-ai/dsh-chat-agent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'

/** UI-safe progress vocabulary projected from the instance's session log. */
export type ChatAgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; name: string; arguments: string }
  | { type: 'tool-result'; error: { name: string; code: string } | undefined }
  | { type: 'turn-end'; kind: string; error: { code: string; message: string } | undefined }

/** Outcome of one {@link ChatAgent.send} turn. */
export interface ChatReply {
  /** The last non-empty assistant text of the owned turn ('' when the turn produced none). */
  text: string
  /** The turn's error identity when it ended in error, undefined otherwise. */
  error: string | undefined
}

/** Options for {@link createChatAgent}. */
export interface ChatAgentOptions {
  /**
   * Stable session id. Defaults to a fresh `chat-<uuid>` id.
   */
  sessionId?: string
  /**
   * Resume semantics for an explicit `sessionId`: `true` tries
   * `agents.resume` first (the persisted JSONL log replays as conversation
   * history — cross-restart memory) and falls back to a fresh `agents.create`
   * on the same id when nothing durable exists (or the log cannot load).
   * Defaults to `false` (always create fresh).
   */
  resume?: boolean
  /** Workspace root recorded as session metadata. Defaults to `process.cwd()`. */
  cwd?: string
  /** Explicit provider/model; defaults to `agentDefaultModel.currentSelection()`. */
  provider?: string
  model?: string
}

/** One chat-shaped Agent handle: turn driving plus per-instance event projection. */
export interface ChatAgent {
  /** The underlying kernel Agent (escape hatch for advanced drivers). */
  readonly agent: Agent
  /**
   * Queue one user turn and resolve its outcome. Sends serialize per instance:
   * concurrent callers cannot interleave writes to the session log.
   * @param text - the user's message.
   * @returns the turn's last assistant text and error identity.
   */
  send(text: string): Promise<ChatReply>
  /**
   * Subscribe to this instance's progress events (session-scoped).
   * @param listener - invoked synchronously per mapped session event.
   * @returns an unsubscribe disposer.
   */
  onEvent(listener: (event: ChatAgentEvent) => void): () => void
  /** Stop event projection. The Agent itself stays owned by the registry. */
  dispose(): void
  /**
   * Stop event projection AND dispose the underlying registry Agent (stops
   * its loop and unregisters it). Use when the instance is being replaced —
   * e.g. a model change that must take effect on the next send.
   */
  close(): Promise<void>
}

/** Map one session event to the public vocabulary; undefined when not progress-relevant. */
function mapEvent(event: SessionEvent): ChatAgentEvent | undefined {
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk.type === 'text-delta') return { type: 'text-delta', text: chunk.text }
    if (chunk.type === 'reasoning-delta') return { type: 'reasoning-delta', text: chunk.text }
    return undefined
  }
  if (event.type === 'tool/call') {
    return { type: 'tool-call', name: event.data.name, arguments: event.data.arguments }
  }
  if (event.type === 'tool/result') {
    return { type: 'tool-result', error: event.data.error }
  }
  if (event.type === 'turn/end') {
    const reason = event.data.reason
    return {
      type: 'turn-end',
      kind: reason?.kind ?? 'unknown',
      error: reason?.kind === 'error' ? { code: reason.error.code, message: reason.error.message } : undefined,
    }
  }
  return undefined
}

/** Aggregate the last assistant text of one owned turn interval (headless summarize contract). */
function summarize(session: Session, firstSeq: SessionLogOffset): ChatReply {
  let started = false
  let text = ''
  let error: string | undefined
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) break
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end' && event.data.reason?.kind === 'error') {
      error = `${event.data.reason.error.code}: ${event.data.reason.error.message}`
    }
  }
  return { text, error }
}

/**
 * Create one chat-shaped Agent: registry creation with model selection
 * installed, ready for {@link ChatAgent.send}. The composition (tools, prompt
 * sections) is whatever the booted profile mounts — this facade changes none
 * of it.
 * @param ctx - any context whose realm resolves `agents` and `agentDefaultModel`.
 * @param options - session id, workspace root, and an optional explicit route.
 * @returns the ready chat handle (its first idle state reached).
 */
export async function createChatAgent(ctx: Context, options: ChatAgentOptions = {}): Promise<ChatAgent> {
  const selection = options.provider !== undefined && options.model !== undefined
    ? { provider: options.provider, model: options.model }
    : ctx.agentDefaultModel.currentSelection()
  const setup = (agentCtx: Parameters<typeof installModelSelection>[0]): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
  let handle: AgentHandle
  if (options.resume === true && options.sessionId !== undefined) {
    const sessionId = brandString<SessionId>(options.sessionId)
    try {
      handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    } catch {
      // Nothing durable exists (or the log cannot load): fall back to a fresh
      // session on the same id — the next boot will resume it.
      handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: options.cwd ?? process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    }
  } else {
    handle = await ctx.agents.create({
      sessionId: brandString<SessionId>(options.sessionId ?? `chat-${randomUUID()}`),
      meta: { cwd: options.cwd ?? process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
  }
  const { agent } = handle
  await agent.whenIdle()

  const listeners = new Set<(event: ChatAgentEvent) => void>()
  const disposeEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    const mapped = mapEvent(event)
    if (mapped === undefined) return
    for (const listener of [...listeners]) listener(mapped)
  })

  let queue: Promise<unknown> = Promise.resolve()
  return {
    agent,
    send(text: string): Promise<ChatReply> {
      const run = queue.then(async (): Promise<ChatReply> => {
        const firstSeq = agent.session.seq
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }))
        await agent.whenIdle()
        return summarize(agent.session, firstSeq)
      })
      queue = run.catch(() => undefined)
      return run
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      disposeEvents()
      listeners.clear()
    },
    async close() {
      disposeEvents()
      listeners.clear()
      await handle.dispose()
    },
  }
}
