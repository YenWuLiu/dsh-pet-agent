/**
 * dsh-pet-app — kernel-native desktop pet entry.
 *
 * Boots the dsh kernel composition (dsh-base + this app's cordis.patch.yml)
 * directly: no $DSH_HOME profile directory is required. Bare plugin names
 * resolve against this app's own node_modules (bareModuleBaseUrl), so the
 * kernel packages reach the loader exactly as they do for `dsh --profile`.
 *
 * Lifetime: the pet-server plugin's HTTP listener keeps the process alive;
 * SIGINT/SIGTERM (or a plugin calling the cmdline exit) disposes the tree.
 *
 * Computer-management stance: the pet is a local single-user agent whose
 * whole point is executing real commands. DSH_PERMISSION_MODE defaults to
 * danger-full-access here (overridable by setting it explicitly), which the
 * dsh-base sandbox/approval rows read at composition time.
 *
 * @module @deepseek-ai/dsh-pet-app/bin
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
  loadOptionalPatches,
  loadOverlayPatches,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'

const NAME = 'dsh-pet'
/** This app's package root (src/ sits one level below it). */
const APP_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** The telemetry row the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** Resolve one bundle package's patch file through its manifest `dsh.bundle.patch`. */
function bundlePatchFile(appRoot: string, packageName: string): string {
  const req = createRequire(join(appRoot, 'package.json'))
  const manifestPath = req.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  return resolve(dirname(manifestPath), manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml')
}

async function main(): Promise<void> {
  // The pet exists to manage this computer; composition rows read this env.
  process.env.DSH_PERMISSION_MODE ??= 'danger-full-access'

  const environment = loadLayeredEnv('dsh')
  // @deepseek-ai/dsh-http-proxy is not on the public registry; outbound proxy
  // support is optional, so resolve it dynamically and degrade to a no-op.
  const disposeProxy: () => Promise<void> = await import('@deepseek-ai/dsh-http-proxy')
    .then((m) => (m as { installProxyFromEnvironment: (env: unknown, warn: (message: string) => void) => Promise<() => Promise<void>> })
      .installProxyFromEnvironment(environment, (message) => { process.stderr.write(`${NAME}: ${message}\n`) }))
    .catch(() => async () => {})

  // Patch stack: dsh-base, then this app's bundle patch, then the optional
  // user overlay ($DSH_HOME/dsh-pet-agent/cordis.patch.yml), then the
  // telemetry switch. The bundle patch is selected by runtime form: running
  // the compiled lib/bin.js (production) uses lib-path entries; running the
  // TS source via tsx (development) uses src-path entries.
  const runningFromLib = /[\\/]lib[\\/]bin\.js$/.test(fileURLToPath(import.meta.url))
  const stateDir = join(resolveDshHome(), 'dsh-pet-agent')
  mkdirSync(stateDir, { recursive: true })
  const patches = [
    ...loadOverlayPatches(NAME, bundlePatchFile(APP_ROOT, '@deepseek-ai/dsh-base')),
    ...loadOverlayPatches(NAME, join(APP_ROOT, runningFromLib ? 'cordis.patch.prod.yml' : 'cordis.patch.yml')),
    ...(loadOptionalPatches(NAME, join(stateDir, 'cordis.patch.yml')) ?? []),
  ]
  if ((process.env.DSH_TELEMETRY_DISABLED ?? '') !== ''
    && patches.some(row => typeof row === 'object' && row !== null && (row as { id?: unknown }).id === TELEMETRY_ROW_ID)) {
    patches.push({ id: TELEMETRY_ROW_ID, disabled: true })
  }

  // The Loader needs a real include root; the composition itself is patches.
  const rootConfig = join(stateDir, 'cordis.yml')
  writeFileSync(rootConfig, '# dsh-pet-app root — composed from patch layers, edit cordis.patch.yml instead.\n[]\n')

  let disposing = false
  const shutdown = (code: number): void => {
    if (disposing) return
    disposing = true
    void disposeTree().then(
      () => process.exit(code),
      () => process.exit(1),
    )
  }
  let treeDispose: () => Promise<void> = async () => {}
  const disposeTree = async (): Promise<void> => { await treeDispose(); await disposeProxy() }

  const ctx = await boot(
    NAME,
    rootConfig,
    structuredClone(patches),
    (hostCtx) => {
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      provideCmdline(hostCtx, {
        args: process.argv.slice(2),
        exit: (code) => { shutdown(code) },
        ready: { onReady: (listener) => { listener(); return () => {} } },
      })
    },
    pathToFileURL(APP_ROOT + '/').href,
  )
  treeDispose = () => ctx.fiber.dispose()

  installFailLoud(NAME, process, async () => { await ctx.fiber.dispose() })
  process.on('SIGTERM', () => { shutdown(0) })
  process.on('SIGINT', () => { shutdown(130) })

  process.stderr.write(`${NAME}: kernel booted\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${NAME}: boot failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
