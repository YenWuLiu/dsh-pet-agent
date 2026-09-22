/**
 * Logon autostart for the pet (HKCU Run key).
 *
 * Three deployment shapes have to reach the same registry value, and picking
 * the wrong one silently registers a launcher that dies at logon:
 *
 *   packaged exe — the launcher (`packaging/launcher.cjs`) exports the *outer*
 *     executable path as DSH_PET_AUTOSTART_EXE. Inside a portable build
 *     `process.execPath` is the throwaway extraction under %TEMP%, so the
 *     portable stub's PORTABLE_EXECUTABLE_FILE is the only stable answer
 *     (portable is no longer built — the branch stays as a cheap guard for a
 *     build shape that may come back).
 *   lib/ build   — `node <APP_ROOT>/lib/bin.js`.
 *   src/ dev run — `node --import tsx/esm <APP_ROOT>/src/bin.ts`.
 *
 * The last two go through a wscript wrapper, because a Run value can only hold
 * one command line and starting `node.exe` directly opens a console window that
 * never closes.
 *
 * @module @deepseek-ai/dsh-pet-app/autostart
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const execFileAsync = promisify(execFile)

/** The Run key the pet registers under (per-user: no elevation required). */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
/** The Run value name; stable so upgrades overwrite instead of accumulate. */
const RUN_VALUE = 'DshPetAgent'

/** How this installation is relaunched after logon. */
export type AutostartMode = 'exe' | 'script' | 'unsupported'

/** One resolved autostart registration. */
export interface AutostartPlan {
  /** Which launcher shape was resolved. */
  mode: AutostartMode
  /** Exactly what the Run value holds, or undefined when unsupported. */
  runValue?: string
  /** The command that actually ends up running, for display in the settings UI. */
  detail?: string
  /** Why no registration is possible (only for 'unsupported'). */
  reason?: string
}

/** This app's package root (src/ or lib/ sits one level below it). */
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** This app's state directory under $DSH_HOME. */
export const STATE_DIR = join(resolveDshHome(), 'dsh-pet-agent-v2')

/** Whether this process was loaded from the compiled lib/ tree rather than TS source. */
function runningFromLib(): boolean {
  return /[\\/]lib[\\/][^\\/]+\.js$/.test(fileURLToPath(import.meta.url))
}

/** Quote one argv element for a Windows command line (always quote: paths contain spaces). */
function quote(value: string): string {
  return `"${value}"`
}

/** Quote a value for embedding inside a VBScript string literal. */
function vbsQuote(value: string): string {
  return value.replace(/"/g, '""')
}

/** wscript.exe, which runs the hidden-launch wrapper without a console window. */
function wscriptExe(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
}

/** Hidden-launch wrapper location (inside this app's state dir). */
function wrapperPath(): string {
  return join(STATE_DIR, 'start-pet-hidden.vbs')
}

/** The node command line this installation needs when it is not a packaged exe. */
function scriptLaunch(): { cwd: string; argv: string[] } {
  const entry = runningFromLib()
    ? { file: join(APP_ROOT, 'lib', 'bin.js'), loader: [] as string[] }
    : { file: join(APP_ROOT, 'src', 'bin.ts'), loader: ['--import', 'tsx/esm'] }
  return { cwd: APP_ROOT, argv: [process.execPath, ...entry.loader, entry.file] }
}

/**
 * Resolve how to relaunch this exact installation.
 * @returns the plan; `mode: 'unsupported'` when no launcher can be reached.
 */
export function resolveAutostartPlan(): AutostartPlan {
  const packaged = process.env.DSH_PET_AUTOSTART_EXE
  if (packaged !== undefined && packaged !== '' && existsSync(packaged)) {
    return { mode: 'exe', runValue: quote(packaged), detail: quote(packaged) }
  }
  const entry = runningFromLib() ? join(APP_ROOT, 'lib', 'bin.js') : join(APP_ROOT, 'src', 'bin.ts')
  if (!existsSync(entry)) {
    return {
      mode: 'unsupported',
      reason: `找不到启动入口 ${entry}（先 pnpm build，或用打包版 exe 注册自启）`,
    }
  }
  const { argv } = scriptLaunch()
  return {
    mode: 'script',
    runValue: `${quote(wscriptExe())} ${quote(wrapperPath())}`,
    detail: argv.map(quote).join(' '),
  }
}

/**
 * Read whether the Run value is currently registered.
 * @returns true when `reg query` finds the value.
 */
export async function autostartRead(): Promise<boolean> {
  return (await autostartReadCommand()) !== undefined
}

/**
 * Read the registered command line.
 * @returns the value data as registered, or undefined when absent.
 */
export async function autostartReadCommand(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', RUN_KEY, '/v', RUN_VALUE])
    const match = /REG_SZ\s+(.*)$/m.exec(stdout)
    const value = match?.[1]?.trim()
    return value === undefined || value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Register or remove the logon autostart entry.
 * @param enable - true to register, false to delete the value.
 * @returns the plan that was applied (so callers can report the exact command).
 * @throws when the resolved plan is unsupported, or when `reg` itself fails.
 */
export async function autostartWrite(enable: boolean): Promise<AutostartPlan> {
  const plan = resolveAutostartPlan()
  if (!enable) {
    try {
      await execFileAsync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'])
    } catch { /* absent: already disabled */ }
    return plan
  }
  if (plan.mode === 'unsupported' || plan.runValue === undefined) {
    throw new Error(plan.reason ?? 'autostart unsupported')
  }
  if (plan.mode === 'script') {
    // The Run key holds one command line, so the real launch command (node +
    // loader + entry) is baked into the wrapper the value points at.
    const { cwd, argv } = scriptLaunch()
    await mkdir(STATE_DIR, { recursive: true })
    const vbs = [
      'Set sh = CreateObject("Wscript.Shell")',
      `sh.CurrentDirectory = "${vbsQuote(cwd)}"`,
      `sh.Run "${vbsQuote(argv.map(quote).join(' '))}", 0, False`,
      '',
    ].join('\r\n')
    await writeFile(wrapperPath(), vbs, 'ascii')
  }
  await execFileAsync('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', plan.runValue, '/f'])
  return plan
}
