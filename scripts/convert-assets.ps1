#Requires -Version 5.1
<#
.SYNOPSIS
  把 assets-custom/raw/ 下的绿幕视频批量转成桌宠可用的 640×360 VP9-Alpha 透明 webm。

.DESCRIPTION
  管线：colorkey 抠绿 →（可选）角色整体缩放居中 → 等比缩放+透明补边到 640×360
  → 编码 VP9-Alpha（yuva420p）。
  - 输入：assets-custom/raw/<动画名>.mp4（也支持 .mov/.mkv/.webm）
  - 输出：assets-custom/webm/<动画名>.webm
  需要 ffmpeg ≥ 7（VP9 alpha 编码是 ffmpeg 7.0 才加进 libvpx-vp9 的），
  脚本按「PATH → 仓库 tools\ffmpeg.exe」顺序自动发现。
  老版本 ffmpeg 可加 -Vp8 开关退到 VP8-Alpha（Chrome/Electron 同样能解码）。

.EXAMPLE
  .\scripts\convert-assets.ps1
  .\scripts\convert-assets.ps1 -Only 待机呼吸休闲 -CharScale 0.7
  .\scripts\convert-assets.ps1 -KeyColor 0x00B140 -Similarity 0.2
#>
[CmdletBinding()]
param(
  # 只转换这一个动画（raw 下的文件主名，不含扩展名）
  [string]$Only = '',
  # 抠像颜色：green（#00FF00）/ blue（#0000FF）/ 0xRRGGBB / auto（逐文件取首帧 (5,5) 像素实际颜色，推荐）
  [string]$KeyColor = 'auto',
  # colorkey 相似度（0~1，越大抠得越狠；绿边残留就调大，角色破洞/变透明就调小）
  # 实测 Wan 绿幕配白围裙角色：0.15 干净不透；0.30 会把浅色角色抠穿
  [double]$Similarity = 0.15,
  # colorkey 边缘柔化（0~1，去绿边锯齿）
  [double]$Blend = 0.05,
  # 输出码率（VP9 透明视频建议 800k~1.5M）
  [string]$Bitrate = '1M',
  # 角色整体缩放（AI 把角色画得太大时用，如 0.7 = 缩到七成再居中；1 = 不缩）
  [double]$CharScale = 1.0,
  # 用 VP8-Alpha 代替 VP9-Alpha（老 ffmpeg 兜底）
  [switch]$Vp8
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $root 'assets-custom\raw'
$outDir = Join-Path $root 'assets-custom\webm'

# --- 依赖检查：PATH 优先，其次仓库自带 tools/ffmpeg.exe ---
$script:FFMPEG = $null
$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($cmd) { $script:FFMPEG = $cmd.Source }
elseif (Test-Path (Join-Path $root 'tools\ffmpeg.exe')) { $script:FFMPEG = Join-Path $root 'tools\ffmpeg.exe' }
else {
  Write-Error @"
未找到 ffmpeg。任选其一：
  1) winget install ffmpeg（装完重开终端）
  2) 把 ffmpeg.exe 放进 tools\ 目录
VP9-Alpha 需要 ffmpeg ≥ 7，老版本用 -Vp8 开关。
"@
}
$ffver = (& $script:FFMPEG -version 2>&1 | Select-Object -First 1) -replace 'ffmpeg version ', ''
Write-Host "ffmpeg: $ffver"

# --- 抠像颜色 ---
$autoKey = ($KeyColor -ieq 'auto')
if (-not $autoKey) {
  $key = switch -Regex ($KeyColor) {
    '^(?i)green$' { '0x00FF00'; break }
    '^(?i)blue$'  { '0x0000FF'; break }
    '^0x[0-9A-Fa-f]{6}$' { $KeyColor; break }
    default { throw "KeyColor 只支持 green / blue / 0xRRGGBB / auto，收到：$KeyColor" }
  }
}

# AI 生成的「绿幕」几乎不会是纯绿——抽首帧 PNG，读 (5,5) 像素 RGB 作为实际抠像色
# （注：ComfyUI 产的 mp4 直接喂 crop 滤镜会触发尺寸重初始化 bug，走整帧 PNG 最稳）
function Get-BackgroundColor([string]$video) {
  $tmp = Join-Path $env:TEMP ('dsh-pet-key-' + [guid]::NewGuid().ToString('N') + '.png')
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $script:FFMPEG -hide_banner -loglevel error -y -i $video -frames:v 1 -update 1 $tmp
    if (-not (Test-Path $tmp)) { throw '抽帧失败' }
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile($tmp)
    try {
      $px = $bmp.GetPixel(5, 5)
      return ('0x{0:X2}{1:X2}{2:X2}' -f $px.R, $px.G, $px.B)
    } finally {
      $bmp.Dispose()
    }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    $ErrorActionPreference = $prev
  }
}

# --- 滤镜链模板（__KEY__/__CS__ 逐文件替换）---
# format=rgba → 抠绿出 alpha → 角色缩放居中（透明补边回原尺寸）→ 等比缩到 640×360 内 → 透明补边
$vfTemplate = (
  'format=rgba,' +
  'colorkey=__KEY__:' + $Similarity + ':' + $Blend + ',' +
  'scale=trunc(iw*__CS__/2)*2:trunc(ih*__CS__/2)*2:flags=lanczos,' +
  'pad=iw/__CS__:ih/__CS__:(ow-iw)/2:(oh-ih)/2:color=0x00000000,' +
  'scale=640:360:force_original_aspect_ratio=decrease:flags=lanczos,' +
  'pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
)

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$inputs = @(Get-ChildItem $rawDir -File | Where-Object { $_.Extension -in '.mp4', '.mov', '.mkv', '.webm' })
if ($Only) { $inputs = @($inputs | Where-Object { $_.BaseName -eq $Only }) }
if (-not $inputs.Count) {
  Write-Host "没有找到待转换视频（assets-custom/raw/*.mp4）" + $(if ($Only) { "：$Only" })
  exit 0
}

$fail = 0
foreach ($f in $inputs) {
  $out = Join-Path $outDir ($f.BaseName + '.webm')
  if ($autoKey) {
    $keyThis = Get-BackgroundColor $f.FullName
    Write-Host "==> $($f.Name)（取样背景色 $keyThis，角色缩放 $CharScale）-> webm\$($f.BaseName).webm"
  } else {
    $keyThis = $key
    Write-Host "==> $($f.Name) -> webm\$($f.BaseName).webm"
  }
  $vfThis = $vfTemplate -replace '__KEY__', $keyThis -replace '__CS__', "$CharScale"
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Vp8) {
      & $script:FFMPEG -hide_banner -loglevel error -y -i $f.FullName -vf $vfThis -an `
        -c:v libvpx -pix_fmt yuva420p -auto-alt-ref 0 -b:v $Bitrate -deadline good -cpu-used 2 $out
    } else {
      & $script:FFMPEG -hide_banner -loglevel error -y -i $f.FullName -vf $vfThis -an `
        -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v $Bitrate -deadline good -cpu-used 2 -row-mt 1 $out
    }
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) {
    $fail++
    Write-Warning "转换失败：$($f.Name)（若提示 alpha/pix_fmt 相关错误，说明 ffmpeg 太旧，加 -Vp8 重试）"
  }
}
Write-Host ""
Write-Host "完成：$($inputs.Count - $fail) 成功 / $fail 失败。产物在 assets-custom\webm\"
Write-Host "下一步：.\scripts\check-assets.ps1 校验齐备度与规格"
if ($fail -gt 0) { exit 1 } else { exit 0 }
