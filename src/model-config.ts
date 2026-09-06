/**
 * Pet-owned model configuration — the pet no longer rides the DSH deployment's
 * model selection (agentDefaultModel / llm-deepseek). The user fills in their
 * own provider protocol, endpoint, API key, and model id in the pet settings
 * dialog; this module turns that into a live LLM route the pet's Agents use.
 *
 * Mechanics (all public kernel seams, no private API):
 *   - The key is written to the managed credential store under the pet's own
 *     reference (`DSH_PET_API_KEY`, 0600 `$DSH_HOME/.credentials.yaml`) —
 *     never into the pet's own settings.json.
 *   - A hand-declared provider profile is written into the `llm-pi-ai`
 *     settings section (`providers.dsh-pet`), which the dormant pi-ai adapter
 *     picks up live: the `dsh-pet` route registers without a restart and
 *     re-registers from the persisted settings document on every boot.
 *   - The in-memory model override in agent-chat points chat/whisper at that
 *     route; the pet's own settings.json persists only the non-secret fields
 *     (protocol/baseURL/model) so the override survives restarts.
 *
 * @module @deepseek-ai/dsh-pet-app/model-config
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { closeAllPetAgents, setModelOverride } from './agent-chat.ts'

/** The LLM provider route this app owns inside the `llm-pi-ai` settings section. */
export const PET_PROVIDER = 'dsh-pet'
/** Credential reference (env-var-shaped name) the pet's API key is stored under. */
export const PET_API_KEY_REF = 'DSH_PET_API_KEY'

/** Wire protocols a hand-declared pi-ai route can speak (mirrors llm-pi-ai supportedProtocols()). */
export const PET_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
export type PetProtocol = (typeof PET_PROTOCOLS)[number]

/** Non-secret model configuration persisted in the pet's own settings.json. */
export interface PetModelConfig {
  protocol: PetProtocol
  baseURL: string
  model: string
}

/** Validate one settings-dialog submission; returns the normalized config or an error message. */
export function validatePetModelConfig(raw: unknown): { ok: true; config: PetModelConfig } | { ok: false; message: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const protocol = String(o.protocol ?? '').trim()
  if (!(PET_PROTOCOLS as readonly string[]).includes(protocol)) {
    return { ok: false, message: `协议必须是 ${PET_PROTOCOLS.join(' / ')} 之一` }
  }
  const baseURL = String(o.baseURL ?? '').trim()
  if (baseURL === '') return { ok: false, message: '接口地址（baseURL）不能为空' }
  try {
    const u = new URL(baseURL)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
  } catch {
    return { ok: false, message: '接口地址（baseURL）必须是合法的 http(s) URL' }
  }
  const model = String(o.model ?? '').trim()
  if (model === '') return { ok: false, message: '模型 id 不能为空' }
  return { ok: true, config: { protocol: protocol as PetProtocol, baseURL, model } }
}

/** Whether an API key is currently resolvable for the pet route (for the settings dialog's prefill). */
export async function petApiKeyConfigured(ctx: Context): Promise<boolean> {
  try {
    const hit = await ctx.credentials.resolve(credentialRef(PET_API_KEY_REF))
    return hit !== undefined && hit.value !== ''
  } catch {
    return false
  }
}

/**
 * Register (or replace) the pet's provider route and point all future chat
 * Agents at it. Order matters: the key lands in the credential store first,
 * then the settings write validates + registers the route, then the override
 * flips and pooled Agents are recycled so the next turn uses the new route.
 * @param ctx - plugin context carrying credentials/settings/llm.
 * @param config - the validated non-secret configuration.
 * @param apiKey - a newly entered key; undefined keeps the stored one.
 */
export async function applyPetModel(ctx: Context, config: PetModelConfig, apiKey: string | undefined): Promise<void> {
  if (apiKey !== undefined && apiKey !== '') {
    await ctx.credentials.set(credentialRef(PET_API_KEY_REF), apiKey)
  } else {
    const existing = await ctx.credentials.resolve(credentialRef(PET_API_KEY_REF))
    if (existing === undefined || existing.value === '') {
      throw new Error('请填写 API Key（首次配置必须提供）')
    }
  }
  await ctx.settings.mutate('llm-pi-ai', [{
    op: 'set',
    path: ['providers', PET_PROVIDER],
    value: {
      apiKeyEnv: PET_API_KEY_REF,
      displayName: '桌宠自定义',
      api: config.protocol,
      baseURL: config.baseURL,
      models: [{ id: config.model, name: config.model }],
    },
  }])
  setModelOverride({ provider: PET_PROVIDER, model: config.model })
  await closeAllPetAgents()
}

/** Remove the pet's provider route, stored key, and override; pooled Agents are recycled. */
export async function clearPetModel(ctx: Context): Promise<void> {
  await ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', PET_PROVIDER] }])
  await ctx.credentials.unset(credentialRef(PET_API_KEY_REF))
  setModelOverride(undefined)
  await closeAllPetAgents()
}

/**
 * Boot-time restore: the persisted settings document re-registers the route on
 * its own, but re-applying it is idempotent and self-heals a profile the user
 * deleted by hand; the in-memory override always needs restoring.
 * @param ctx - plugin context carrying credentials/settings.
 * @param saved - the persisted non-secret configuration, if any.
 */
export async function restorePetModel(ctx: Context, saved: PetModelConfig | undefined): Promise<void> {
  if (saved === undefined) return
  try {
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set',
      path: ['providers', PET_PROVIDER],
      value: {
        apiKeyEnv: PET_API_KEY_REF,
        displayName: '桌宠自定义',
        api: saved.protocol,
        baseURL: saved.baseURL,
        models: [{ id: saved.model, name: saved.model }],
      },
    }])
    setModelOverride({ provider: PET_PROVIDER, model: saved.model })
  } catch (error) {
    process.stderr.write(`dsh-pet: restore model config failed (${error instanceof Error ? error.message : String(error)})\n`)
  }
}
