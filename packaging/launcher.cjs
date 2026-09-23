// DSH-PET-AGENT 打包版启动器（electron-builder 安装版 / win-unpacked 的 Electron 主进程）。
//
// Electron 二进制一鱼三吃，所以本文件必须按 argv 分派两种角色：
//
//   A) 无参启动 = 外壳壳进程：拿单实例锁 → 用捆绑的 node.exe 拉起 dsh 内核 →
//      内核退出时跟着退出。它自己**永不创建窗口**。
//   B) 带一个「桌宠窗口宿主目录」参数启动 = 桌宠窗口宿主：内核经 DSH_PET_ELECTRON_EXE
//      复用同一个 exe 拉起第二个 Electron 实例（src/electron.ts），此时必须直接 require
//      该目录的 main.js。
//
// 角色 B 是必需的而不是可选优化：Electron 的 main 入口固定在 package.json 的 main，
// 第二次启动同一个 exe 也会跑到本文件；如果这里无条件抢单实例锁，第二实例必然失败退出，
// 结果就是「打包版起了内核、却永远没有桌宠窗口」。判断依据是参数指向一个含 main.js 的目录。
//
// 无控制台窗口：内核 stderr 写入 ~/.dsh/dsh-pet-agent/pet-kernel.log 便于排障。
const { app } = require('electron')
const { spawn } = require('node:child_process')
const { createWriteStream, mkdirSync, statSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

/** 参数里的桌宠宿主目录（存在且含 main.js）——命中即本进程是角色 B。 */
function helperDirFromArgv(argv) {
  for (const arg of argv.slice(1)) {
    try {
      if (!statSync(arg).isDirectory()) continue
      const entry = join(arg, 'main.js')
      if (existsSync(entry)) return entry
    } catch {
      /* 不是路径：跳过 */
    }
  }
  return null
}

const helperEntry = helperDirFromArgv(process.argv)

if (helperEntry) {
  // ---- 角色 B：桌宠窗口宿主 ----
  require(helperEntry)
} else {
  // ---- 角色 A：外壳壳进程 ----
  let kernel = null
  let quitting = false

  /**
   * 自启注册表要写的 exe。portable 目标下本进程的 process.execPath 是 %TEMP% 里的
   * 一次性解包副本（退出即删），写进 Run 键下次开机必然找不到——portable 存根把原始
   * exe 路径放在 PORTABLE_EXECUTABLE_FILE 里，那个才是稳定路径。
   * （portable 已不再构建，这里留着是为了将来真要出单文件版时不用重新踩一遍。）
   */
  const autostartExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath

  function startKernel() {
    const appRoot = __dirname // resources/app
    const nodeExe = join(appRoot, 'runtime-node', 'node.exe')
    kernel = spawn(nodeExe, [join(appRoot, 'lib', 'bin.js')], {
      env: {
        ...process.env,
        DSH_PET_ELECTRON_EXE: process.execPath,
        DSH_PET_AUTOSTART_EXE: autostartExe,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    try {
      const logDir = join(homedir(), '.dsh', 'dsh-pet-agent')
      mkdirSync(logDir, { recursive: true })
      const log = createWriteStream(join(logDir, 'pet-kernel.log'), { flags: 'a' })
      log.write(`\n=== ${new Date().toISOString()} kernel start (packaged) ===\n`)
      log.write(`=== exe=${process.execPath}\n=== autostart-exe=${autostartExe}\n`)
      kernel.stderr.pipe(log)
    } catch { /* 日志失败不影响运行 */ }
    kernel.on('error', (err) => { if (!quitting) { console.error('kernel spawn failed:', err); app.exit(1) } })
    kernel.on('exit', (code) => { if (!quitting) app.exit(typeof code === 'number' ? code : 0) })
  }

  // 单实例：重复启动直接退出（内核有随机端口回退，但没有窗口重复开的必要）。
  // 注意：托盘「退出」走的是内核侧 /quit，最终由 kernel.on('exit') 收敛到 app.exit，
  // 所以这里不需要额外监听退出路径。
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.whenReady().then(startKernel)
    app.on('will-quit', () => {
      quitting = true
      if (kernel && !kernel.killed) kernel.kill()
    })
    // 无窗口应用：桌宠窗口是角色 B（另一个 Electron 实例）的，本壳不因窗口事件退出
    app.on('window-all-closed', () => {})
  }
}
