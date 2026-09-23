#Requires -Version 5.1
<#
.SYNOPSIS
  获取出片管线依赖的 ffmpeg.exe —— 这个二进制不进版本管理，新克隆的仓库要跑一次本脚本。

.DESCRIPTION
  scripts/normalize-webm.py、scripts/check-assets.ps1、scripts/check-anchor.py 都要调 ffmpeg：
  先找 PATH，找不到就回落 tools\ffmpeg.exe。而 .gitignore 忽略了 tools/*.exe
  （单文件 100~212 MB，不适合进仓库），所以**不跑本脚本，出片管线会直接失败**。

  管线需要的能力（装完自动体检，缺一不可）：
    * libvpx-vp9 编码器          —— 出 VP9-Alpha 成品
    * qtrle / hevc / prores 解码器 —— 读各种手扣 MOV 母版

  ---- 下载源（默认走国内可达的镜像，实测数据见下）----
  默认 URL 是 BtbN 的 FFmpeg-Builds GitHub 发布，经 gh-proxy.com 代理。本机实测：

      gh-proxy.com + BtbN 发布   13,815 KB/s   ← 默认，约 15 秒
      ghfast.top   + BtbN 发布    4,906 KB/s
      github.com 直连               185 KB/s   ← 约 10 分钟
      gyan.dev 官方                  55 KB/s   ← 约 34 分钟

  第三方代理意味着**你信任它转发的二进制**。脚本装完会打印版本与 sha256，介意的话用
  -Url 指向官方源，或自己下好再用 -FromFile 安装：

      .\scripts\get-ffmpeg.ps1 -Url 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
      .\scripts\get-ffmpeg.ps1 -FromFile "$env:USERPROFILE\Downloads\ffmpeg.zip"

  版本差异不影响验收：check-assets.ps1 查的是「640×360 / 真 alpha / 锚点契约」，不是字节
  相等。仓库里已提交的 38 条 webm 是用 full 9.0.1 出的；换版本重跑，容器字节必然不同
  （VP9 容器本身非确定性，同版本同输入两次转换哈希也不一样），解码后像素才一致。

.EXAMPLE
  .\scripts\get-ffmpeg.ps1                    # 装到 tools\ffmpeg.exe
  .\scripts\get-ffmpeg.ps1 -Check             # 只体检现有安装，不下载
  .\scripts\get-ffmpeg.ps1 -Force             # 已有也重下
  .\scripts\get-ffmpeg.ps1 -FromFile <本地zip> # 用已经下好的包安装
#>
[CmdletBinding()]
param(
  [string]$Url = 'https://gh-proxy.com/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  [string]$FromFile = '',
  [string]$OutDir = '',
  [switch]$Check,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'tools' }
$target = Join-Path $OutDir 'ffmpeg.exe'

# --- 体检：能不能跑 + 管线要的能力在不在 ---
function Test-Ffmpeg([string]$exe) {
  if (-not (Test-Path $exe)) { return $null }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $ver = (& $exe -hide_banner -version 2>&1 | Select-Object -First 1)
    $enc = (& $exe -hide_banner -encoders 2>&1)
    $dec = (& $exe -hide_banner -decoders 2>&1)
  } finally { $ErrorActionPreference = $prev }
  if (-not $ver) { return $null }
  return [pscustomobject]@{
    Version = ([string]$ver).Trim()
    Vp9     = [bool]($enc | Select-String 'libvpx-vp9')
    Qtrle   = [bool]($dec | Select-String '\bqtrle\b')
    Hevc    = [bool]($dec | Select-String '\bhevc\b')
    Prores  = [bool]($dec | Select-String '\bprores\b')
  }
}

function Test-Ok($info) {
  return ($info -and $info.Vp9 -and $info.Qtrle -and $info.Hevc -and $info.Prores)
}

function Show-Report($info, [string]$path) {
  Write-Host "  位置  : $path"
  Write-Host "  大小  : $([math]::Round((Get-Item $path).Length / 1MB, 1)) MB"
  Write-Host "  sha256: $((Get-FileHash $path -Algorithm SHA256).Hash.ToLower())"
  Write-Host "  版本  : $($info.Version)"
  Write-Host '  能力  :'
  foreach ($k in 'Vp9', 'Qtrle', 'Hevc', 'Prores') {
    $label = @{ Vp9 = 'libvpx-vp9 编码器（出片）'; Qtrle = 'qtrle 解码器（读 qtrle MOV 母版）'
                Hevc = 'hevc 解码器（读 HEVC MOV 母版）'; Prores = 'prores 解码器（读 ProRes 母版）' }[$k]
    Write-Host ("    {0} {1}" -f $(if ($info.$k) { '[有]' } else { '[缺]' }), $label)
  }
}

# --- -Check：只体检 ---
if ($Check) {
  Write-Host '==> 体检 tools\ffmpeg.exe'
  $info = Test-Ffmpeg $target
  if (-not $info) {
    Write-Host "  [缺] $target 不存在或跑不起来。"
    Write-Host '       跑 .\scripts\get-ffmpeg.ps1 装上。'
    exit 1
  }
  Show-Report $info $target
  Write-Host ''
  if (-not (Test-Ok $info)) {
    Write-Host '  [警告] 能力不全，出片管线可能失败。加 -Force 重下。'
    exit 1
  }
  Write-Host '  体检通过。'
  exit 0
}

# --- 已有且没 -Force：直接体检收工 ---
if ((Test-Path $target) -and -not $Force -and -not $FromFile) {
  $info = Test-Ffmpeg $target
  if (Test-Ok $info) {
    Write-Host '==> tools\ffmpeg.exe 已存在且能力齐全，无需下载'
    Show-Report $info $target
    Write-Host ''
    Write-Host '  想强制重下加 -Force。'
    exit 0
  }
  Write-Host '==> 已有的 tools\ffmpeg.exe 能力不全，将重新安装'
}

# --- 准备压缩包：本地文件 or 下载 ---
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-pet-ffmpeg-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null

try {
  if ($FromFile) {
    if (-not (Test-Path $FromFile)) { throw "-FromFile 指向的文件不存在：$FromFile" }
    $ext = [System.IO.Path]::GetExtension($FromFile).ToLower()
    $archive = Join-Path $tmp "ffmpeg$ext"
    Copy-Item $FromFile $archive -Force
    Write-Host '==> 使用本地压缩包'
    Write-Host "  来源: $FromFile（$([math]::Round((Get-Item $archive).Length / 1MB, 1)) MB）"
  } else {
    $ext = [System.IO.Path]::GetExtension(($Url -split '\?')[0]).ToLower()
    $archive = Join-Path $tmp "ffmpeg$ext"
    Write-Host '==> 下载 ffmpeg'
    Write-Host "  URL : $Url"
    # 用 curl.exe 而不是 Invoke-WebRequest / WebClient：
    #   * PS 5.1 的 IWR 会把整个响应缓冲进内存再落盘，大文件既无进度又卡在 0 字节；
    #   * WebClient 走 WinINET 系统代理栈，实测在本机 7 分钟 0 字节（curl 同 URL 正常）。
    # curl.exe 是 Windows 10 1803+ 自带的组件。
    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
    if (-not $curl) { $curl = (Get-Command curl -ErrorAction SilentlyContinue).Source }
    if ($curl) {
      # 续传重试：本机实测这些源都会**中途断流**（gh-proxy 下到 54% 停住不动），
      # 所以必须 -C - 断点续传 + 循环重试，否则大包永远下不完。
      $prev = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        for ($try = 1; $try -le 5; $try++) {
          & $curl -L --fail -C - --progress-bar -o $archive $Url
          if ($LASTEXITCODE -eq 0) { break }
          if ($try -lt 5) {
            Write-Host "  第 $try 次中断（exit $LASTEXITCODE），3 秒后续传重试…"
            Start-Sleep -Seconds 3
          }
        }
      } finally { $ErrorActionPreference = $prev }
      if ($LASTEXITCODE -ne 0) {
        throw "curl 下载失败（exit $LASTEXITCODE，已续传重试 5 次）。`n      换个源：-Url，或自己下好再用 -FromFile。"
      }
    } else {
      Write-Host '  （没有 curl.exe，退回 WebClient —— 可能很慢且无进度）'
      $wc = New-Object System.Net.WebClient
      $prev = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try { $wc.DownloadFile($Url, $archive) } finally { $wc.Dispose(); $ErrorActionPreference = $prev }
    }
    if (-not (Test-Path $archive)) { throw '下载失败：没有产出文件' }
    Write-Host "  已下载 $([math]::Round((Get-Item $archive).Length / 1MB, 1)) MB"
  }

  if ($ext -ne '.zip' -and $ext -ne '.7z') {
    throw "只认 .zip / .7z，收到：$ext"
  }

  # --- 解包 ---
  Write-Host '==> 解包'
  $ex = Join-Path $tmp 'x'
  if ($ext -eq '.zip') {
    Expand-Archive -Path $archive -DestinationPath $ex -Force
  } else {
    $sevenZip = @(
      (Get-Command 7z -ErrorAction SilentlyContinue).Source,
      (Get-Command 7za -ErrorAction SilentlyContinue).Source,
      'C:\Program Files\7-Zip\7z.exe'
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $sevenZip) {
      throw "解 .7z 需要 7-Zip（7z.exe），PATH 和 C:\Program Files\7-Zip 都没找到。"
    }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $sevenZip x $archive "-o$ex" -y | Out-Null } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { throw "7z 解包失败（exit $LASTEXITCODE）" }
  }

  $found = Get-ChildItem $ex -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
  if (-not $found) { throw '解包后找不到 ffmpeg.exe（源包结构变了？）' }

  # --- 落盘 ---
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  Copy-Item $found.FullName $target -Force
  Write-Host "==> 已安装到 $target"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# --- 装完体检 ---
$info = Test-Ffmpeg $target
if (-not $info) { throw "装好了但跑不起来：$target" }
Write-Host ''
Show-Report $info $target
Write-Host ''
if (-not (Test-Ok $info)) {
  Write-Host '  [警告] 能力不全 —— 这个源包可能不含 libvpx。换 -Url 或 -FromFile 重试。'
  exit 1
}
Write-Host '  完成。出片管线现在可以跑了：.\scripts\check-assets.ps1'
