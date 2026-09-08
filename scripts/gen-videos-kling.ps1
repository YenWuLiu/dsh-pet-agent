#Requires -Version 5.1
<#
.SYNOPSIS
  走可灵官方 OpenAPI 批量生成 12 条桌宠动画（图生视频，姿势图锚定）。

.DESCRIPTION
  链路：姿势图 base64 + 动作提示词 → POST /v1/videos/image2video（JWT HS256 鉴权）
  → 轮询任务 → 下载 mp4 到 assets-custom/raw/<动画名>.mp4 → convert-assets.ps1 抠像。
  密钥读取顺序：进程环境变量 → 注册表 HKCU/HKLM（setx 持久化后在这里）。
  动作表与姿势锚点与 gen-videos.ps1 保持一致（12 动画制）。

.EXAMPLE
  .\scripts\gen-videos-kling.ps1 -Only 待机呼吸休闲
  .\scripts\gen-videos-kling.ps1                # 全量 12 条
#>
[CmdletBinding()]
param(
  [string]$Only = '',
  # 可灵模型与档位：kling-v2-1（质量好）/ kling-v1-6（便宜快）；std=标准 pro=高品质
  [string]$Model = 'kling-v2-1',
  [string]$Mode = 'std',
  [string]$Duration = '5',
  [int]$TimeoutMin = 15,
  [string]$ApiBase = 'https://api-beijing.klingai.com'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $root 'assets-custom\raw'
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null

# ---- 密钥：进程 env → HKCU → HKLM ----
$script:AK = $env:KLING_ACCESS_KEY
$script:SK = $env:KLING_SECRET_KEY
if (-not $script:AK) {
  $e = Get-ItemProperty 'HKCU:\Environment' -ErrorAction SilentlyContinue
  if ($e) { $script:AK = $e.KLING_ACCESS_KEY; $script:SK = $e.KLING_SECRET_KEY }
}
if (-not $script:AK) {
  $e = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -ErrorAction SilentlyContinue
  if ($e) { $script:AK = $e.KLING_ACCESS_KEY; $script:SK = $e.KLING_SECRET_KEY }
}
if (-not $script:AK -or -not $script:SK) {
  Write-Error '找不到 KLING_ACCESS_KEY / KLING_SECRET_KEY。请用 setx 持久化后重开终端。'
}

# ---- 鉴权：可灵新控制台是单一 API Key（AK=SK 同值 → 直接 Bearer）；AK/SK 不同（老版）→ JWT HS256 ----
function New-KlingToken {
  if ($script:AK -eq $script:SK) { return $script:AK }
  $enc = [System.Text.Encoding]::UTF8
  $b64url = { param([byte[]]$b) [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
  $header = &$b64url ($enc.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $payload = @{ iss = $script:AK; exp = $now + 1800; nbf = $now - 5 } | ConvertTo-Json -Compress
  $payloadB64 = &$b64url ($enc.GetBytes($payload))
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 (,$enc.GetBytes($script:SK))
  $sig = &$b64url ($hmac.ComputeHash($enc.GetBytes("$header.$payloadB64")))
  return "$header.$payloadB64.$sig"
}

# ---- HTTP 层：可灵网关对 PowerShell Invoke-* 会 405（WAF 拦截），必须走 curl.exe ----
function Invoke-KlingApi([string]$method, [string]$path, [string]$jsonBody) {
  $token = New-KlingToken
  $tmp = $null
  try {
    $curlArgs = @('-s', '-X', $method, "$ApiBase$path", '-H', "Authorization: Bearer $token", '-H', 'Content-Type: application/json', '--max-time', '120')
    if ($jsonBody) {
      $tmp = Join-Path $env:TEMP ('kling-' + [guid]::NewGuid().ToString('N') + '.json')
      [System.IO.File]::WriteAllText($tmp, $jsonBody, (New-Object System.Text.UTF8Encoding($false)))
      $curlArgs += @('--data-binary', "@$tmp")
    }
    $out = & curl.exe @curlArgs
    return ($out | ConvertFrom-Json)
  } finally {
    if ($tmp) { Remove-Item $tmp -ErrorAction SilentlyContinue }
  }
}

# ---- 动画表（与 gen-videos.ps1 一致；姿势锚 → assets-custom/refs/） ----
$actions = [ordered]@{
  '待机呼吸休闲'         = '保持站姿原地轻轻呼吸起伏，鲸鱼尾巴缓慢左右摇摆，偶尔眨眼，首尾姿势完全一致，动作轻柔缓慢，无缝循环感'
  '东张西望'             = '从站姿开始，先慢慢转头向左看再向右看，然后原地转半圈，结束时面向画面右侧站立，全程面向镜头，不要背对镜头，结束姿势与开头左右镜像对称'
  '被鼠标拖拽悬空反馈'   = '保持被无形之手拎起的状态，双脚离地悬空，四肢自然下垂轻轻晃动，>< 表情无奈'
  '悠闲散步'             = '开头2秒站立不动，然后原地慢悠悠走路踏步，裙摆和尾巴随步伐轻摆，结尾2秒站立不动回到开头姿势'
  '点击回应-开心摇尾'    = '从站姿开始，开心地摇起鲸鱼尾巴，眼睛亮闪闪，轻轻跳一下，结束时回到与开头完全一致的站姿'
  '点击回应-生气跺脚'    = '从站姿开始，鼓起腮帮子假装生气，原地跺两下脚，然后哼一声把头扭向一边，结束时回到与开头完全一致的站姿'
  '点击回应-惊吓跌倒'    = '从站姿开始，突然被吓到后仰跌倒坐地，尾鳍翘起，愣住两秒，然后爬起身回到站姿，结束时与开头姿势一致，不要烟雾灰尘特效'
  '坐姿抱膝'             = '保持Q版二头身大头小身体比例不变，从坐姿抱膝开始，轻轻前后摇晃身体发呆，尾巴轻摆，然后慢慢站起来，结束时回到Q版二头身站姿，白色围裙始终穿在身上'
  '趴地熟睡'             = '保持Q版二头身比例和蓝紫色大眼睛不变，趴在地上闭眼熟睡，鼻尖鼻涕泡一大一小地起伏，尾巴偶尔轻摆，全程趴姿不起身'
  '跪坐干饭'             = '保持Q版二头身比例和蓝紫色大眼睛不变，跪坐着端起饭碗拿筷子开心地扒饭吃，腮帮子鼓鼓地咀嚼，饭碗全程端在手里'
  '挂右边缘'             = '保持Q版二头身比例，从站姿开始，爬向画面右侧，双手攀住画面右边缘悬挂起来（攀住的是与背景同色的绿色窗框，会变透明不可见），双腿悬空晃动，然后跳下来回到站姿'
  '挂顶边'               = '保持Q版二头身比例，从站姿开始，原地起跳双手攀住画面顶部边缘悬挂（攀住的是与背景同色的绿色窗框，会变透明不可见），双腿晃荡尾巴摇摆，然后松手落地回到站姿'
}
$poseMap = @{
  '待机呼吸休闲'         = 'pose-1.png'
  '东张西望'             = 'pose-2.png'
  '悠闲散步'             = 'pose-2.png'
  '坐姿抱膝'             = 'pose-4.png'
  '趴地熟睡'             = 'pose-5.png'
  '跪坐干饭'             = 'pose-6.png'
  '挂右边缘'             = 'pose-7.png'
  '挂顶边'               = 'pose-8.png'
  '被鼠标拖拽悬空反馈'   = 'pose-9.png'
  '点击回应-惊吓跌倒'    = 'pose-10.png'
  '点击回应-开心摇尾'    = 'pose-11.png'
  '点击回应-生气跺脚'    = 'pose-12.png'
}

$scene = '保持画面构图和角色形象完全不变，始终保持Q版二头身大头小身体比例，纯绿色背景始终不变，没有阴影，固定机位，镜头完全不动'
$negative = '阴影，地面阴影，投影，烟雾，雾气，灰尘，粒子特效，渐变背景，背景杂物，镜头移动，推拉升降，变焦，多余肢体，变形，模糊，文字，字幕，水印，绿色衣服，绿色头发，角色出画，裁切，长腿，正常比例，成人比例，九头身'

function Invoke-KlingI2V([string]$name, [string]$action) {
  $poseFile = Join-Path $root ('assets-custom\refs\' + $poseMap[$name])
  if (-not (Test-Path $poseFile)) { throw "姿势图缺失：$poseFile" }
  $imgB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($poseFile))
  $prompt = "$scene。$action。只表演这一个动作，不做其他动作。"
  $body = @{
    model_name      = $Model
    mode            = $Mode
    duration        = $Duration
    image           = $imgB64
    prompt          = $prompt
    negative_prompt = $negative
    cfg_scale       = 0.5
  } | ConvertTo-Json -Compress

  $resp = Invoke-KlingApi 'POST' '/v1/videos/image2video' $body
  if ($resp.code -ne 0) { throw "创建任务失败：$($resp | ConvertTo-Json -Compress)" }
  $taskId = $resp.data.task_id
  Write-Host "  任务 $taskId 已提交"

  $deadline = (Get-Date).AddMinutes($TimeoutMin)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    $q = Invoke-KlingApi 'GET' "/v1/videos/image2video/$taskId" ''
    if ($q.code -ne 0) { throw "查询失败：$($q | ConvertTo-Json -Compress)" }
    $status = $q.data.task_status
    if ($status -eq 'failed') { throw "任务失败：$($q.data.task_status_msg)" }
    if ($status -eq 'succeed') {
      $url = $q.data.task_result.videos[0].url
      $dest = Join-Path $rawDir ($name + '.mp4')
      & curl.exe -sL -o $dest $url --max-time 300
      return $dest
    }
  }
  throw "超时（${TimeoutMin}min）"
}

$todo = @($actions.GetEnumerator())
if ($Only) { $todo = @($todo | Where-Object { $_.Key -eq $Only }) }
if (-not $todo.Count) { Write-Error "动画名不存在：$Only" }

$i = 0; $fail = 0
foreach ($kv in $todo) {
  $i++
  $dest = Join-Path $rawDir ($kv.Key + '.mp4')
  if (Test-Path $dest) { Write-Host "[$i/$($todo.Count)] 跳过（已存在）：$($kv.Key)"; continue }
  Write-Host "[$i/$($todo.Count)] 生成：$($kv.Key)（$Model/$Mode/${Duration}s）"
  try {
    $out = Invoke-KlingI2V $kv.Key $kv.Value
    Write-Host "    -> $out（$([math]::Round((Get-Item $out).Length/1MB, 1)) MB）"
  } catch {
    $fail++
    Write-Warning "生成失败：$($kv.Key)：$($_.Exception.Message)"
  }
}
Write-Host ""
Write-Host "完成：$($todo.Count - $fail) 成功 / $fail 失败"
if ($fail) { exit 1 }
