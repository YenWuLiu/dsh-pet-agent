#Requires -Version 5.1
<#
.SYNOPSIS
  打包 DSH-PET-AGENT 为安装版 exe（electron-builder，nsis 目标）。

.DESCRIPTION
  流程：
  1) tsc 编译 lib/；
  2) 组装 packaging/staging：launcher + lib + assets + runtime + 补丁 + 生产依赖
     （独立目录 pnpm --node-linker=hoisted 装真文件，剔除 electron）+ 系统 node.exe；
  3) electron-builder（npmmirror 镜像下载打包二进制）→ dist/*-setup.exe（+ dist/win-unpacked 免解包直跑目录）。

  只出安装版：portable 单文件版每次启动要解包 261MB 到 %TEMP%（实测冷启动 ~3 分钟），
  已按需要去掉（配置见 packaging/electron-builder.yml）。

.EXAMPLE
  .\scripts\pack-exe.ps1
  .\scripts\pack-exe.ps1 -Clean     打包成功后删掉中间产物（staging 约 300 MB）
#>
[CmdletBinding()]
param(
  # 打包成功后删掉 packaging\staging 与 packaging\staging-install。
  # 它们是组装中间产物（约 300 MB），可随时由本脚本重建；留着只是为了排查
  # 「产物里的文件为什么和 staging 不一样」这类问题。
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $root 'packaging\staging'
$install = Join-Path $root 'packaging\staging-install'
$dist = Join-Path $root 'dist'

# PS5.1 + ErrorActionPreference=Stop 下，原生命令任何 stderr 输出都抛 NativeCommandError。
# pnpm/electron-builder 日常往 stderr 写 WARN/进度——统一经此包装器局部降级调用。
function Invoke-Native([string]$exe, [string[]]$argv) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $exe @argv } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "$exe $argv 失败（exit $LASTEXITCODE）" }
}

# --- 0. 版本与 node ---
$rootPkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $rootPkg.version
$nodeExe = (Get-Command node -ErrorAction Stop).Source
Write-Host "版本 $version；node: $nodeExe"

# --- 1. 编译 ---
Write-Host '==> tsc 编译'
Set-Location $root
Invoke-Native pnpm @('build')

# --- 2. 组装 staging ---
Write-Host '==> 组装 staging'
foreach ($d in $staging, $install) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
New-Item -ItemType Directory -Force $staging, $install | Out-Null

# staging 的 package.json：ESM（lib/bin.js 是 ESM）+ CJS 主入口（.cjs 扩展名强制）
# 注意：app-builder-lib 的 JSON.parse 不认 BOM——必须用无 BOM UTF-8 写
$stagingPkgJson = @{ name = 'dsh-pet'; version = $version; private = $true; type = 'module'; main = 'launcher.cjs' } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $staging 'package.json'), $stagingPkgJson, [System.Text.UTF8Encoding]::new($false))
Copy-Item (Join-Path $root 'packaging\launcher.cjs') $staging

foreach ($sub in 'lib', 'assets', 'runtime', 'licenses') {
  Copy-Item (Join-Path $root $sub) (Join-Path $staging $sub) -Recurse
}
foreach ($f in 'cordis.patch.yml', 'cordis.patch.prod.yml') {
  Copy-Item (Join-Path $root $f) $staging
}
New-Item -ItemType Directory -Force (Join-Path $staging 'runtime-node') | Out-Null
Copy-Item $nodeExe (Join-Path $staging 'runtime-node\node.exe')

# staging 必须自带 pnpm-workspace.yaml，把自己锚成 workspace 根。
# electron-builder 靠 `pnpm --workspace-root exec pwd` 定位 workspace，再对该根跑 `pnpm list` 取依赖树；
# 没有这个文件时 pnpm 会一路向上找到仓库根，于是收集到的是「仓库根」的依赖（只有直接依赖），
# 打包出来的 app 里大量传递依赖缺失，启动直接 ERR_MODULE_NOT_FOUND。
# patchedDependencies 需与 lockfile 记录一致，避免 pnpm 的配置校验报错。
$stagingWsYaml = "packages:`n  - '.'`npatchedDependencies:`n  'node-pty@1.2.0-beta.15': patches/node-pty@1.2.0-beta.15.patch`n"
[System.IO.File]::WriteAllText((Join-Path $staging 'pnpm-workspace.yaml'), $stagingWsYaml, [System.Text.UTF8Encoding]::new($false))

# --- 3. 生产依赖（独立目录 hoisted 安装 = 真文件无 symlink）---
Write-Host '==> 安装生产依赖（hoisted）'
foreach ($f in 'package.json', 'pnpm-lock.yaml', '.npmrc') {
  Copy-Item (Join-Path $root $f) $install
}
# pnpm-workspace.yaml 必须就地生成，不能照抄仓库根的：
#   1) packages 留空——否则这个临时目录会被并入主 workspace，pnpm 会去动主仓库的 node_modules；
#   2) patchedDependencies 必须与根 lockfile 里的记录一致——frozen 安装会校验它，缺了就 LOCKFILE_CONFIG_MISMATCH。
$installWsYaml = "packages: []`npatchedDependencies:`n  'node-pty@1.2.0-beta.15': patches/node-pty@1.2.0-beta.15.patch`n"
[System.IO.File]::WriteAllText((Join-Path $install 'pnpm-workspace.yaml'), $installWsYaml, [System.Text.UTF8Encoding]::new($false))
if (Test-Path (Join-Path $root 'patches')) { Copy-Item (Join-Path $root 'patches') (Join-Path $install 'patches') -Recurse }
Set-Location $install
# --package-import-method=copy：pnpm 默认从 content-addressable store 硬链接（store 与本仓库同盘时必然硬链接）。
# 硬链接文件（link count > 1）在部分受控环境（沙箱 / 安全软件）下无法删除，会让 staging 无法清理、
# 下次打包直接失败。用真拷贝（link count = 1）换取可回收的 staging，代价是组装时多占一份磁盘。
# --ignore-scripts：koffi 的 install 脚本（cnoke 编译）会 spawn 带管道 stdio 的子进程，
# 在受限环境（沙箱）下直接 EPERM 让整个 install 失败；而 koffi 的预编译二进制随平台子包
# @koromix/koffi-win32-x64 分发，运行时并不需要该脚本产物。
Invoke-Native pnpm @('install', '--prod', '--frozen-lockfile', '--node-linker=hoisted', '--package-import-method=copy', '--ignore-scripts')
# electron 本体由 electron-builder 提供，剔除（约 200MB）
foreach ($e in 'node_modules\electron', 'node_modules\@electron') {
  $p = Join-Path $install $e
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
Move-Item (Join-Path $install 'node_modules') (Join-Path $staging 'node_modules')

# --- 3.4 把各包的 peerDependencies 归并进 dependencies ---
# electron-builder 的依赖收集器只沿 dependencies / optionalDependencies 递归（peerDependencies 一概不走），
# 而 dsh 各包大量把兄弟插件声明成 peer（如 dsh-app-boot → cordis-plugin-group）：这些包明明已落盘，
# 却会被当作无用依赖整批剔除，打包能成功、启动却 ERR_MODULE_NOT_FOUND。
# hoisted 布局本来就是扁平闭包，peer 已实装，把声明搬进 dependencies 只是让收集器看得见。
$nmDir = Join-Path $staging 'node_modules'
$mergePeers = {
  param([string]$pkgDir)
  $pj = Join-Path $pkgDir 'package.json'
  if (-not (Test-Path $pj)) { return 0 }
  try { $o = Get-Content $pj -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return 0 }
  if (-not $o.peerDependencies) { return 0 }
  # 注意：$null 经 @() 包装会变成含空串的单元素数组，必须显式剔除空名，否则 Add-Member 直接报错
  $peerNames = @($o.peerDependencies.PSObject.Properties.Name) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if (@($peerNames).Count -eq 0) { return 0 }
  $depNames = @($o.dependencies.PSObject.Properties.Name) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $added = 0
  foreach ($n in $peerNames) {
    if ($depNames -contains $n) { continue }
    if (-not $o.dependencies) { $o | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
    $o.dependencies | Add-Member -NotePropertyName $n -NotePropertyValue $o.peerDependencies.$n -Force
    $added++
  }
  if ($added -gt 0) { [System.IO.File]::WriteAllText($pj, ($o | ConvertTo-Json -Depth 12), [System.Text.UTF8Encoding]::new($false)) }
  return $added
}
$peerPatched = 0
$peerMoved = 0
foreach ($dir in (Get-ChildItem $nmDir -Directory -ErrorAction SilentlyContinue)) {
  if ($dir.Name.StartsWith('.')) { continue }
  $targets = if ($dir.Name.StartsWith('@')) { Get-ChildItem $dir.FullName -Directory -ErrorAction SilentlyContinue } else { @($dir) }
  foreach ($t in $targets) {
    $n = & $mergePeers $t.FullName
    if ($n -gt 0) { $peerPatched++; $peerMoved += $n }
  }
}
Write-Host "peer 依赖归并：$peerPatched 个包、$peerMoved 条声明"

# --- 3.5 staging 的 package.json 显式声明全部落盘包 ---
# electron-builder 的依赖收集器只从 package.json 的 dependencies 出发解析依赖树（对 pnpm 会执行
# `pnpm list`），凡是「已落盘但没被声明」的包一律当作无用依赖剔除——hoisted 安装里大量传递依赖
# 正属于此类，会被整批裁掉，打包体积看着变小、运行期却 ERR_MODULE_NOT_FOUND。
# 这里把 node_modules 下每个顶层包按实际版本写进 dependencies，让收集器看到完整闭包。
$deps = [ordered]@{}
$readVersion = {
  param([string]$pkgDir)
  $pj = Join-Path $pkgDir 'package.json'
  if (-not (Test-Path $pj)) { return $null }
  try { return (Get-Content $pj -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { return $null }
}
foreach ($dir in (Get-ChildItem $nmDir -Directory -ErrorAction SilentlyContinue)) {
  if ($dir.Name.StartsWith('.')) { continue }
  if ($dir.Name.StartsWith('@')) {
    foreach ($sub in (Get-ChildItem $dir.FullName -Directory -ErrorAction SilentlyContinue)) {
      $v = & $readVersion $sub.FullName
      if ($v) { $deps["$($dir.Name)/$($sub.Name)"] = $v }
    }
  } else {
    $v = & $readVersion $dir.FullName
    if ($v) { $deps[$dir.Name] = $v }
  }
}
$stagingPkg = Get-Content (Join-Path $staging 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$stagingPkg | Add-Member -NotePropertyName dependencies -NotePropertyValue $deps -Force
$stagingPkgJson = $stagingPkg | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $staging 'package.json'), $stagingPkgJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "staging package.json 声明 $($deps.Count) 个依赖"

$sizeMB = [math]::Round(((Get-ChildItem $staging -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
Write-Host "staging 组装完成：${sizeMB} MB"

# --- 4. electron-builder ---
Write-Host '==> electron-builder 打包'
# 先清掉上一次的产物，让「产物只由本次 staging 决定」：
#   1) dist 根下的 exe/blockmap —— 否则 SHA256SUMS.txt 会把早就换掉的旧 exe 也列进去
#      （portable 版已不再构建，上一次那份若留着就会被误当成本次产物）；
#   2) dist\*-unpacked —— 输出目录先清空再打包，不去猜打包器会不会清理 appOutDir。
#
# 注意（免得下次误判）：产物里的文件**不等于** staging 的文件清单，别把差异当成残留——
# electron-builder 的 pnpm 依赖收集器会按依赖图裁剪（staging 的 node_modules\.pnpm、.bin
# 那几千个文件不会进产物），也会**重新嵌套**：例如 @aws-sdk/token-providers 在 staging 里
# 只有顶层一份，产物里还会多出一份 credential-provider-sso\node_modules\ 下的同版本副本。
foreach ($stale in @(Get-ChildItem $dist -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.exe' -or $_.Extension -eq '.blockmap' })) {
  Remove-Item $stale.FullName -Force
}
foreach ($unpacked in @(Get-ChildItem $dist -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*-unpacked' })) {
  Remove-Item $unpacked.FullName -Recurse -Force
}
Set-Location $root
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
# --publish never：CI=true（或 CI 环境）会让 electron-builder 隐式尝试发布 GitHub Release，
# nsis 目标带 blockmap 时必然撞上 "GitHub Personal Access Token is not set" 而整包失败。
Invoke-Native (Join-Path $root 'node_modules\.bin\electron-builder.cmd') @('--config', (Join-Path $root 'packaging\electron-builder.yml'), '--publish', 'never')

$exes = @(Get-ChildItem $dist -Filter *.exe)
if ($exes.Count -eq 0) { throw 'dist/ 下没有 exe 产物' }
Write-Host ''
$lines = @()
foreach ($e in $exes) {
  $hash = (Get-FileHash $e.FullName -Algorithm SHA256).Hash.ToLower()
  Write-Host "打包完成 ✅ $($e.Name)（$([math]::Round($e.Length / 1MB)) MB）"
  Write-Host "  SHA256: $hash"
  $lines += "$hash  $($e.Name)"
}
# 清单里同时记下免解包直跑目录的位置：win-unpacked 与安装版是同一份内容，
# 但省掉安装、启动也比「解包到 %TEMP%」快得多（~2.3 秒）。
# 注意别用 package.json 的 name 猜 exe 名：那是 dsh-pet，
# 打包产物的名字来自 electron-builder 的 productName（DSH-PET-AGENT）——直接看盘。
$unpacked = Join-Path $dist 'win-unpacked'
$unpackedExe = @(Get-ChildItem $unpacked -Filter *.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch '^(elevate|Uninstall)' } | Select-Object -First 1)
if ($unpackedExe.Count -gt 0) {
  $lines += "# fast-launch (unpacked, no temp extraction): dist\win-unpacked\$($unpackedExe[0].Name)"
}
Set-Content -Encoding UTF8 (Join-Path $dist 'SHA256SUMS.txt') $lines
Write-Host ''
Write-Host "产物：$($exes.Count) 个安装版 exe + dist\win-unpacked\（免解包直跑）"

# --- 5. 可选：清中间产物 ---
if ($Clean) {
  Write-Host ''
  Write-Host '==> 清理中间产物（-Clean）'
  foreach ($d in $staging, $install) {
    if (-not (Test-Path $d)) { continue }
    $mb = [math]::Round(((Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue |
      Measure-Object Length -Sum).Sum / 1MB))
    Remove-Item $d -Recurse -Force
    Write-Host "  已删 $d（${mb} MB）"
  }
  Write-Host '  需要时重跑本脚本即可重建（pnpm build + hoisted 安装）。'
}
