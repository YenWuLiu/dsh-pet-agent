#Requires -Version 5.1
<#
.SYNOPSIS
  获取出片管线依赖的 ffmpeg.exe —— 这个二进制不进版本管理，新克隆的仓库要跑一次本脚本。

.DESCRIPTION
  scripts/normalize-webm.py、scripts/check-assets.ps1、scripts/check-anchor.py 都要调 ffmpeg：
  先找 PATH，找不到就回落 tools\ffmpeg.exe。而 .gitignore 忽略了 tools/*.exe
  （单文件 100~212 MB，不适合进仓库），所以**不跑本脚本，出片管线会直接失败**。

  管线需要的能力（装完自动体检，缺一不可）：
    * libvpx-vp9 编码器      —— 出 VP9-Alpha 成品
    * qtrle / hevc / prores 解码器 —— 读各种手扣 MOV 母版

  默认下载 gyan.dev 的 release **essentials** 构建：.zip 格式（Windows 自带解压，不需要 7-Zip），
  109 MB。官方库清单里 essentials 含 libvpx，且「所有变体都包含全部内置组件」——
  本管线要的三类解码器都是内置的，够用。full 版多出的 vulkan / whisper / libplacebo 等
  本管线一个都不用，且只提供 .7z（169 MB，需 7-Zip）。

  版本差异说明：仓库里已提交的 38 条 webm 是用 **full 9.0.1** 出的。换版本不影响验收
  —— check-assets.ps1 查的是「640×360 / 真 alpha / 锚点契约」，不是字节相等。
  但要清楚：重跑出的 webm 容器字节**必然**不同（VP9 容器本身非确定性，同版本同输入
  两次转换哈希也不一样），解码后像素才是一致的。

.EXAMPLE
  .\scripts\get-ffmpeg.ps1                    # 装到 tools\ffmpeg.exe
  .\scripts\get-ffmpeg.ps1 -Check             # 只体检现有安装，不下载
  .\scripts\get-ffmpeg.ps1 -Force             # 已有也重下
  .\scripts\get-ffmpeg.ps1 -Url 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z'
#>
[CmdletBinding()]
param(
  [string]$Url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
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
    Write-Host '       跑 .\scripts\get-ffmpeg.ps1 装上（约 109 MB 下载）。'
    exit 1
  }
  Show-Report $info $target
  if (-not ($info.Vp9 -and $info.Qtrle -and $info.Hevc -and $info.Prores)) {
    Write-Host ''
    Write-Host '  [警告] 能力不全，出片管线可能失败。加 -Force 重下。'
    exit 1
  }
  Write-Host ''
  Write-Host '  体检通过。'
  exit 0
}

# --- 已有且没 -Force：直接体检收工 ---
if ((Test-Path $target) -and -not $Force) {
  $info = Test-Ffmpeg $target
  if ($info -and $info.Vp9 -and $info.Qtrle -and $info.Hevc -and $info.Prores) {
    Write-Host '==> tools\ffmpeg.exe 已存在且能力齐全，无需下载'
    Show-Report $info $target
    Write-Host ''
    Write-Host '  想强制重下加 -Force。'
    exit 0
  }
  Write-Host '==> 已有的 tools\ffmpeg.exe 能力不全，将重新下载'
}

# --- 下载 ---
$ext = [System.IO.Path]::GetExtension($Url).ToLower()
if ($ext -ne '.zip' -and $ext -ne '.7z') {
  throw "只认 .zip / .7z，收到：$ext（$Url）"
}

Write-Host '==> 下载 ffmpeg'
Write-Host "  URL : $Url"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-pet-ffmpeg-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
$archive = Join-Path $tmp "ffmpeg$ext"

try {
  # 用 WebClient 而不是 Invoke-WebRequest：PS 5.1 的 IWR 会把**整个响应缓冲进内存**
  # 再落盘 —— 109 MB 的包既看不到进度、又长时间停在 0 字节（实测卡死过一次）。
  # WebClient.DownloadFile 是流式写盘：想看进度就盯着 $archive 的体积增长。
  Write-Host '  （约 109 MB，视网络可能要几分钟；下面这行返回时就是下完了）'
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'dsh-pet-agent-get-ffmpeg')
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $wc.DownloadFile($Url, $archive) } finally {
    $wc.Dispose()
    $ErrorActionPreference = $prev
  }
  if (-not (Test-Path $archive)) { throw '下载失败：没有产出文件' }
  Write-Host "  已下载 $([math]::Round((Get-Item $archive).Length / 1MB, 1)) MB"

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
      throw "解 .7z 需要 7-Zip（7z.exe），PATH 和 C:\Program Files\7-Zip 都没找到。`n      改用默认的 .zip 源，或先装 7-Zip。"
    }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $sevenZip x $archive "-o$ex" -y | Out-Null } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { throw "7z 解包失败（exit $LASTEXITCODE）" }
  }

  $found = Get-ChildItem $ex -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
  if (-not $found) { throw "解包后找不到 ffmpeg.exe（源包结构变了？）" }

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
if (-not ($info.Vp9 -and $info.Qtrle -and $info.Hevc -and $info.Prores)) {
  Write-Host '  [警告] 能力不全 —— 这个源包可能不含 libvpx。换 -Url 重试。'
  exit 1
}
Write-Host '  完成。出片管线现在可以跑了：.\scripts\check-assets.ps1'
