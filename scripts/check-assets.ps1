#Requires -Version 5.1
<#
.SYNOPSIS
  校验自制素材齐备度与规格：配置引用的每个动画都要有对应 webm，且是 640×360 带 alpha。

.DESCRIPTION
  1. 读取配置（默认 assets-custom/config.min.jsonc，swap 后用 -Config 指向 assets/config.jsonc），
     收集 animations 段引用的全部动画名；
  2. 逐一检查 assets-custom/webm/<名>.webm 存在；有 ffprobe 时进一步核对
     分辨率 640×360、像素格式含 alpha（yuva420p）；
  3. 检查 fonts/ 有 ttf、pic/ 的 8 个 PNG 齐备。
  全部通过 exit 0，否则 exit 1 并列出缺口。

.EXAMPLE
  .\scripts\check-assets.ps1
  .\scripts\check-assets.ps1 -Config assets\config.jsonc -WebmDir assets\webm
#>
[CmdletBinding()]
param(
  [string]$Config = '',
  [string]$WebmDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $root 'assets-custom\config.min.jsonc' }
if (-not $WebmDir) { $WebmDir = Join-Path $root 'assets-custom\webm' }
$picDir = Join-Path $root 'assets-custom\pic'
$fontDir = Join-Path $root 'assets-custom\fonts'

function Strip-Jsonc([string]$src) {
  $s = $src -replace '/\*[\s\S]*?\*/', ''
  return ($s -replace '(?m)(^|[^\\:])//.*$', '$1').Trim()
}

# --- 1. 收集配置引用的动画名 ---
if (-not (Test-Path $Config)) { Write-Error "配置不存在：$Config" }
$cfg = Strip-Jsonc (Get-Content $Config -Raw -Encoding UTF8) | ConvertFrom-Json
$a = $cfg.animations
if (-not $a) { Write-Error "配置缺少 animations 段：$Config" }

$names = [System.Collections.Generic.List[string]]::new()
foreach ($pool in @($a.idle) + @($a.turn) + @($a.drag) + @($a.clicks)) {
  if ($pool) { $names.Add([string]$pool) }
}
foreach ($m in @($a.moves.actions)) { if ($m.name) { $names.Add([string]$m.name) } }
foreach ($c in @($a.categories)) { foreach ($x in @($c.actions)) { if ($x) { $names.Add([string]$x) } } }
foreach ($prop in $a.events.PSObject.Properties) {
  foreach ($x in @($prop.Value)) { if ($x) { $names.Add([string]$x) } }
}
$names = $names | Sort-Object -Unique
Write-Host "配置共引用 $($names.Count) 个动画"

# --- 2. 检查 webm ---
# 探测工具：ffmpeg（PATH 或仓库 tools\ffmpeg.exe）。
# 注意：VP9-Alpha 的 alpha 存在 WebM 的 BlockAdditional 侧数据里，ffprobe/ffmpeg -i
# 都只报基础流 yuv420p——判定 alpha 必须实际解码一帧看角点像素（用 libvpx 解码器）。
$ffmpegPath = $null
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegCmd) { $ffmpegPath = $ffmpegCmd.Source }
elseif (Test-Path (Join-Path $root 'tools\ffmpeg.exe')) { $ffmpegPath = Join-Path $root 'tools\ffmpeg.exe' }
$canProbe = [bool]$ffmpegPath
if (-not $canProbe) { Write-Host '（无 ffmpeg，跳过规格检查，只核对存在性）' }

function Probe-Video([string]$p) {
  # 分辨率：ffmpeg -i 的信息走 stderr 且必然 exit 1（没给输出文件）；
  # PS5.1 在 ErrorActionPreference=Stop 下任何 stderr 都抛 NativeCommandError——局部降级
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $errFile = Join-Path $env:TEMP ('dsh-pet-probe-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    & $ffmpegPath -hide_banner -i $p 2>$errFile | Out-Null
    $stderr = [System.IO.File]::ReadAllText($errFile)
  } finally {
    Remove-Item $errFile -ErrorAction SilentlyContinue
    $ErrorActionPreference = $prev
  }
  $m = [regex]::Match($stderr, 'Video:.*?(\d{2,5})x(\d{2,5})', 'IgnoreCase')
  if (-not $m.Success) { return $null }
  $info = @{ w = [int]$m.Groups[1].Value; h = [int]$m.Groups[2].Value; alpha = $false }
  # alpha：强制 libvpx 解码首帧成 PNG，看角点 alpha 是否 < 128
  $tmp = Join-Path $env:TEMP ('dsh-pet-probe-' + [guid]::NewGuid().ToString('N') + '.png')
  try {
    & $ffmpegPath -hide_banner -loglevel error -y -c:v libvpx-vp9 -i $p -frames:v 1 -update 1 $tmp
    if (Test-Path $tmp) {
      Add-Type -AssemblyName System.Drawing
      $bmp = [System.Drawing.Bitmap]::FromFile($tmp)
      try {
        $info.alpha = ($bmp.GetPixel(5, 5).A -lt 128)
      } finally {
        $bmp.Dispose()
      }
    }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
  return $info
}

$missing = @(); $badSpec = @()
foreach ($n in $names) {
  $p = Join-Path $WebmDir ($n + '.webm')
  if (-not (Test-Path $p)) { $missing += $n; continue }
  if ($canProbe) {
    $info = Probe-Video $p
    if (-not $info) { $badSpec += "$n（无法解析视频流）"; continue }
    if ($info.w -ne 640 -or $info.h -ne 360) { $badSpec += "$n（$($info.w)x$($info.h)，应为 640x360）" }
    if (-not $info.alpha) { $badSpec += "$n（解码后角点不透明：无 alpha 通道）" }
  }
}

# --- 3. 字体与图标 ---
$ttf = Get-ChildItem $fontDir -Filter *.ttf -ErrorAction SilentlyContinue
$fontMissing = ($ttf.Count -eq 0)
$picNames = 'cursor-grab', 'cursor-grabbing', 'notify-done', 'notify-error',
  'notify-truncated', 'notify-approval', 'notify-question', 'notify-test'
$picMissing = @($picNames | Where-Object { -not (Test-Path (Join-Path $picDir "$_.png")) })

# --- 报告 ---
Write-Host ""
if ($missing.Count) { Write-Host "缺 webm（$($missing.Count)）："; $missing | ForEach-Object { Write-Host "  - $_" } }
if ($badSpec.Count) { Write-Host "规格不符（$($badSpec.Count)）："; $badSpec | ForEach-Object { Write-Host "  - $_" } }
if ($fontMissing) { Write-Host "缺字体：assets-custom\fonts\ 下没有 .ttf" }
if ($picMissing.Count) { Write-Host "缺图标（$($picMissing.Count)）："; $picMissing | ForEach-Object { Write-Host "  - $_.png" } }

$ok = -not $missing.Count -and -not $badSpec.Count -and -not $fontMissing -and -not $picMissing.Count
Write-Host ""
if ($ok) {
  Write-Host '全部通过 ✅ 可以运行 swap：.\scripts\swap-assets.ps1'
  exit 0
} else {
  Write-Host '还有缺口 ❌（对照 assets-custom/CHECKLIST.md 补齐）'
  exit 1
}
