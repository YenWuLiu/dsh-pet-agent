/**
 * Electron resolution and desktop-helper spawn. The helper is dsh-pet's
 * Electron shell (transparent always-on-top per-pet windows); it loads its
 * config and assets from the pet server over plain HTTP on 127.0.0.1, so no
 * DSH webserver or bridge scheme is involved.
 *
 * @module @deepseek-ai/dsh-pet-app/electron
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Resolve the Electron executable from this app's devDependency.
 * @param appRoot - this app's package root.
 * @returns the absolute exe path, or undefined when Electron is not installed.
 */
export function resolveElectronExe(appRoot: string): string | undefined {
  // 打包版（electron-builder 安装版 / win-unpacked）：内核由启动器以本 exe 路径注入，
  // 桌宠窗口直接复用同一个 Electron 二进制，无需 node_modules 里的 electron
  const forced = process.env.DSH_PET_ELECTRON_EXE
  if (forced !== undefined && forced !== '' && existsSync(forced)) return forced
  try {
    const req = createRequire(join(appRoot, 'package.json'))
    const exe: unknown = req('electron')
    return typeof exe === 'string' && existsSync(exe) ? exe : undefined
  } catch {
    return undefined
  }
}

/** One desktop pet window (dsh-pet helper DSH_PET_PETS element). */
export interface PetWindowSpec {
  id: string
  size: number
}

/**
 * Spawn the desktop helper process. stdio is inherit/ignore only: piped stdio
 * (named pipes) is blocked for processes spawned from sandboxed shells, and
 * the helper needs no stdio contract in HTTP mode.
 * @param opts - exe/helper paths, the pet server config URL, and the pet windows.
 * @returns the spawned child process.
 */
export function spawnPetElectron(opts: {
  exe: string
  helperDir: string
  configUrl: string
  pets: PetWindowSpec[]
  smoke?: { out: string; afterMs?: number }
}): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_PET_CONFIG_URL: opts.configUrl,
    DSH_PET_PETS: JSON.stringify(opts.pets),
    DSH_PET_SCALE: '1',
  }
  // HTTP mode only: the bridge scheme exists for DSH Desktop's token-gated webserver.
  delete env.DSH_PET_BRIDGE
  if (opts.smoke !== undefined) {
    env.DSH_PET_SMOKE = '1'
    env.DSH_PET_SMOKE_OUT = opts.smoke.out
    if (opts.smoke.afterMs !== undefined) env.DSH_PET_SMOKE_AFTER_MS = String(opts.smoke.afterMs)
  }
  return spawn(opts.exe, [opts.helperDir], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  })
}
