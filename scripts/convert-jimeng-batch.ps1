# 即梦批量转码：assets-custom/raw-staging/*.mp4 → assets-custom/webm/<同名>.webm（暂存区）
# 双抠像引擎（-Engine）：
#   flood  = scripts/key-video.py（边界洪水填充；白底/浅底/复杂边缘更稳，需 scipy）
#   keyer  = tools/mp4-keyer.py（色度键+软边+去边；纯绿/白/黑纯色背景片首选，效果最接近剪映手感）
# 暂存区素材经 对齐(adjust-webm)/焊接(weld-seams)/验收(check-seams) 后再复制进 assets/webm/ 上线
# 用法：
#   .\scripts\convert-jimeng-batch.ps1                 # 全量转 staging 里所有 mp4
#   .\scripts\convert-jimeng-batch.ps1 -Only 小动作-玩毛线球,待机-歪头好奇   # 只转这几条
#   .\scripts\convert-jimeng-batch.ps1 -Force          # 覆盖已存在的 webm 重转
#   .\scripts\convert-jimeng-batch.ps1 -Clean          # 转完后清空 staging（默认保留）
# 说明：白底片走 key-video.py 默认参数（thresh 36 / erode 2 / anchor frame0 —— 首帧角色高
#       → 270px、脚底 → FEET_Y=330、水平中心 → x=320，即引擎锚点契约；绿幕它也认，
#       但绿幕片已由用户自抠，本脚本只管白底），
#       输出 640×360 VP9-Alpha 透明 webm，规格与现有素材一致。
#       转完务必跑 scripts/check-assets.ps1（含 check-anchor.py：逐片比对首帧角色高/脚底线/中心）。
[CmdletBinding()]
param(
  [string]$Staging = '',
  [string]$OutDir = '',
  [string[]]$Only = @(),
  [switch]$Force,
  [switch]$Clean,
  # 强制输出帧率（即梦/Kimi 片统一 24fps；key-video 自动探测对 4.1s 等时长会误判成 60fps）
  [int]$Fps = 24,
  # 抠像引擎：flood=洪水填充（白底稳）/ keyer=色度键（纯绿/纯色片首选）
  [ValidateSet('flood', 'keyer')]
  [string]$Engine = 'flood'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Staging) { $Staging = Join-Path $root 'assets-custom\raw-staging' }
if (-not $OutDir)  { $OutDir = Join-Path $root 'assets-custom\webm' }

# key-video.py 依赖 scipy+numpy+PIL：优先 PATH 里的 python，缺 scipy 时回退到 ComfyUI 自带环境
$py = $null
$cands = @()
$pathPy = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($pathPy) { $cands += $pathPy }
$cands += 'E:\ComfyUI\installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe'
$cands += 'E:\ComfyUI\installs\ComfyUI\standalone-env\python.exe'
foreach ($c in $cands) {
  if (-not $c -or -not (Test-Path $c)) { continue }
  & $c -c "import importlib.util as u; raise SystemExit(0 if u.find_spec('scipy') and u.find_spec('numpy') and u.find_spec('PIL') else 1)" 2>$null
  if ($LASTEXITCODE -eq 0) { $py = $c; break }
}
if (-not $py -and $Engine -eq 'flood') { throw '找不到带 scipy/numpy/PIL 的 Python（key-video.py 依赖）。请安装 scipy 或确认 ComfyUI 环境存在。' }
if (-not $py) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
Write-Host "使用 Python: $py"

if (-not (Test-Path $Staging)) { throw "找不到 staging 目录：$Staging" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$files = Get-ChildItem $Staging -Filter '*.mp4' | Sort-Object Name
if ($Only.Count -gt 0) {
  $want = $Only | ForEach-Object { $_.Trim() }
  $files = $files | Where-Object { $want -contains $_.BaseName }
}
if ($files.Count -eq 0) {
  Write-Host "没有可转的 mp4（$Staging 内 $(if ($Only.Count) { '匹配 -Only 的 ' } else { '' })文件为空）。"
  exit 0
}

Write-Host "== 待转 $($files.Count) 条 =="
$ok = 0; $skip = 0; $fail = 0
foreach ($f in $files) {
  $dst = Join-Path $OutDir ($f.BaseName + '.webm')
  if ((Test-Path $dst) -and -not $Force) {
    if ((Get-Item $dst).LastWriteTime -ge $f.LastWriteTime) {
      Write-Host "==> 跳过（已存在且比源新）：$($f.Name)"; $skip++; continue
    }
  }
  Write-Host "==> $($f.Name) → $($f.BaseName).webm（$Engine）"
  if ($Engine -eq 'keyer') {
    & $py (Join-Path $root 'tools\mp4-keyer.py') $f.FullName $dst --fps $Fps --strength 40 --shadow 30 --feather 2 --shrink 1 --despill 60
  } else {
    & $py (Join-Path $root 'scripts\key-video.py') $f.FullName $dst --fps $Fps
  }
  if ($LASTEXITCODE -eq 0 -and (Test-Path $dst)) { $ok++ } else { $fail++; Write-Warning "转码失败：$($f.Name)" }
}

Write-Host ''
Write-Host "完成：成功 $ok / 跳过 $skip / 失败 $fail"
if ($fail -gt 0) { Write-Host '有失败项，请查看上方告警。' ; exit 1 }
if ($Clean) {
  Remove-Item $Staging\*.mp4 -ErrorAction SilentlyContinue
  Write-Host "已清空 $Staging"
}
