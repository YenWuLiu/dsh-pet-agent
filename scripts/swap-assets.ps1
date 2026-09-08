#Requires -Version 5.1
<#
.SYNOPSIS
  素材换血：把内置素材（assets/webm、fonts、pic）移出仓库备份，安装 assets-custom/ 里的自制素材。

.DESCRIPTION
  步骤：
  1. 运行 check-assets.ps1 验收（未通过则中止，除非 -Force）；
  2. 内置 assets/webm、assets/fonts、assets/pic 与 assets/config.jsonc
     移到仓库外的备份目录（默认 ..\assets-backup-<时间戳>，不删除原数据）；
  3. 安装自制素材：webm/*.webm → assets/webm/；fonts 下第一个 .ttf →
     assets/fonts/上首软糖体.ttf（文件名被渲染端硬编码，必须保持）；
     pic/*.png → assets/pic/；config.min.jsonc → assets/config.jsonc；
  4. 更新 assets/README.md 为「本项目素材为自制」声明（顺带移除上游署名义务）。
  完成后重启 pnpm start 生效。

.EXAMPLE
  .\scripts\swap-assets.ps1
  .\scripts\swap-assets.ps1 -BackupDir 'D:\backup\dsh-pet-assets'
#>
[CmdletBinding()]
param(
  [string]$BackupDir = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$custom = Join-Path $root 'assets-custom'

# --- 1. 验收 ---
& (Join-Path $PSScriptRoot 'check-assets.ps1')
if ($LASTEXITCODE -ne 0 -and -not $Force) {
  Write-Error "素材验收未通过，已中止。确认要强行换血请加 -Force。"
}

if (-not $BackupDir) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $BackupDir = Join-Path (Split-Path -Parent $root) "assets-backup-$stamp"
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Host "备份目录：$BackupDir"

# --- 2. 内置素材移出仓库 ---
foreach ($sub in 'webm', 'fonts', 'pic', 'config.jsonc', 'README.md') {
  $src = Join-Path $assets $sub
  if (Test-Path $src) {
    Move-Item $src (Join-Path $BackupDir $sub)
    Write-Host "已移出：assets\$sub"
  }
}

# --- 3. 安装自制素材 ---
New-Item -ItemType Directory -Force -Path (Join-Path $assets 'webm'), (Join-Path $assets 'fonts'), (Join-Path $assets 'pic') | Out-Null

Copy-Item (Join-Path $custom 'webm\*.webm') (Join-Path $assets 'webm')
Write-Host "已安装 webm：$((Get-ChildItem (Join-Path $assets 'webm') -Filter *.webm).Count) 个"

$ttf = Get-ChildItem (Join-Path $custom 'fonts') -Filter *.ttf | Select-Object -First 1
if ($ttf) {
  # 渲染端硬编码文件名「上首软糖体.ttf」（runtime/electron-helper/renderer.js），保持原名免改代码
  Copy-Item $ttf.FullName (Join-Path $assets 'fonts\上首软糖体.ttf')
  Write-Host "已安装字体：$($ttf.Name) -> assets\fonts\上首软糖体.ttf"
}

Copy-Item (Join-Path $custom 'pic\*.png') (Join-Path $assets 'pic')
Write-Host "已安装图标：$((Get-ChildItem (Join-Path $assets 'pic') -Filter *.png).Count) 个"

Copy-Item (Join-Path $custom 'config.min.jsonc') (Join-Path $assets 'config.jsonc')
Write-Host '已切换精简配置：assets\config.jsonc'

# --- 4. 素材声明 ---
@'
# assets/ 素材说明

本目录素材为项目作者**自制**（AI 生成 + ffmpeg 绿幕抠像管线，见
`assets-custom/prompts/AI动画提示词模板.md` 与 `scripts/convert-assets.ps1`），
不含上游 dsh-pet 项目的素材，不适用其「禁止商用」限制。
素材与代码一样按仓库根目录 LICENSE（MIT）处理，除非作者另行声明。
'@ | Set-Content -Encoding UTF8 (Join-Path $assets 'README.md')
Write-Host '已重写 assets\README.md 素材声明'

Write-Host ''
Write-Host '换血完成 ✅ 重启 pnpm start 后生效。'
Write-Host "内置素材备份在 $BackupDir（确认新素材没问题后可自行删除）"
