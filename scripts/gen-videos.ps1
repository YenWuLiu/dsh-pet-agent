#Requires -Version 5.1
<#
.SYNOPSIS
  驱动本地 ComfyUI 批量生成桌宠绿幕动画原片（Wan 2.1 T2V / I2V 双模式）。

.DESCRIPTION
  T2V 模式（默认）：UNETLoader→CLIPTextEncode×2→EmptyHunyuanLatentVideo→KSampler
  →VAEDecode→CreateVideo→SaveVideo；角色描述（-Character）逐字锁进每条提示词。
  I2V 模式（-I2V -RefImage）：LoadImage→CLIPVisionEncode→WanImageToVideo 锁首帧，
  形象以参考图为准，提示词只写动作+背景约束（-Character 变为可选的补充描述）。
  产物统一下载到 assets-custom/raw/<动画名>.mp4，交给 convert-assets.ps1 抠像。

.EXAMPLE
  .\scripts\gen-videos.ps1 -Character 'Q版……' -Only 待机呼吸休闲 -Frames 33
  .\scripts\gen-videos.ps1 -I2V -RefImage .\assets-custom\ref.png -Only 待机呼吸休闲
#>
[CmdletBinding()]
param(
  # 角色设定（T2V 必填；I2V 可选——作为形象补充约束）
  [string]$Character = '',
  # 图生视频模式：形象/构图由 -RefImage 首帧锁定
  [switch]$I2V,
  # I2V 参考图路径（默认站姿锚点 ref-stand.png；poseMap 命中的动画用对应姿势图）
  [string]$RefImage = '',
  # 只生成这一个动画（调试用）；空 = 全量
  [string]$Only = '',
  # 帧数（16fps：81帧≈5s 标准；33帧≈2s 快速验证）
  [int]$Frames = 81,
  # 基础种子：每条动画 = BaseSeed + 序号；<0 = 每条随机
  [long]$BaseSeed = 20240501,
  [string]$Server = 'http://127.0.0.1:8188',
  # 单条生成超时（分钟）；14B I2V 在 8GB 显存上建议 ≥60
  [int]$TimeoutMin = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $root 'assets-custom\raw'
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null

if (-not $I2V -and -not $Character) { Write-Error 'T2V 模式必须传 -Character' }
if (-not $RefImage) { $RefImage = Join-Path $root 'assets-custom\ref-stand.png' }
if ($I2V -and -not (Test-Path $RefImage)) { Write-Error "I2V 参考图不存在：$RefImage" }

# I2V 逐动画姿势锚点：命中即用对应姿势图（assets-custom/refs/，由 make-pose-refs.py 产出）
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

# ---- ComfyUI 图片上传（/upload/image API，沙箱友好；按文件名去重缓存）----
$script:uploaded = @{}
function Send-ComfyImage([string]$localPath) {
  $name = [System.IO.Path]::GetFileName($localPath)
  if ($script:uploaded.ContainsKey($name)) { return $name }
  $boundary = '----dshpet' + [guid]::NewGuid().ToString('N')
  $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $localPath).Path)
  $ms = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.StreamWriter($ms, [System.Text.Encoding]::ASCII)
  $w.Write("--$boundary`r`nContent-Disposition: form-data; name=`"overwrite`"`r`n`r`n1`r`n")
  $w.Write("--$boundary`r`nContent-Disposition: form-data; name=`"image`"; filename=`"$name`"`r`nContent-Type: image/png`r`n`r`n")
  $w.Flush()
  $ms.Write($fileBytes, 0, $fileBytes.Length)
  $w.Write("`r`n--$boundary--`r`n")
  $w.Flush()
  $null = Invoke-RestMethod -Uri "$Server/upload/image" -Method Post -Body $ms.ToArray() -ContentType "multipart/form-data; boundary=$boundary" -TimeoutSec 60
  $ms.Dispose()
  $script:uploaded[$name] = $true
  Write-Host "  参考图已上传：$name"
  return $name
}

# ============ 动画名 → 动作描述（12 条，对应动作姿势表 12 姿势；与 CHECKLIST 一致） ============
# 连贯性总则（桌宠场景，单次播放动画播完回 idle，首尾必须接得上）：
#   所有动画「从参考图姿势开始，结束时回到与开头完全一致的姿势」；
#   例外：东张西望（结束时朝向相反——引擎靠它翻面）、悠闲散步（首尾 2 秒站立段由引擎平移窗口）。
$actions = [ordered]@{
  # idle（循环）：首尾帧必须一致
  '待机呼吸休闲'         = '保持站姿原地轻轻呼吸起伏，鲸鱼尾巴缓慢左右摇摆，偶尔眨眼，首尾姿势完全一致，动作轻柔缓慢，无缝循环感'
  # turn（播完翻面）：朝向必须左右镜像翻转（面向另一侧镜头，不是背对！），末段易崩——措辞克制
  '东张西望'             = '从站姿开始，先慢慢转头向左看再向右看，然后原地转半圈，结束时面向画面右侧站立，全程面向镜头，不要背对镜头，结束姿势与开头左右镜像对称'
  # drag：被无形之手拎起
  '被鼠标拖拽悬空反馈'   = '保持被无形之手拎起的状态，双脚离地悬空，四肢自然下垂轻轻晃动，>< 表情无奈'
  # clicks ×3
  '点击回应-开心摇尾'    = '从站姿开始，开心地摇起鲸鱼尾巴，眼睛亮闪闪，轻轻跳一下，结束时回到与开头完全一致的站姿'
  '点击回应-生气跺脚'    = '从站姿开始，鼓起腮帮子假装生气，原地跺两下脚，然后哼一声把头扭向一边，结束时回到与开头完全一致的站姿'
  '点击回应-惊吓跌倒'    = '从站姿开始，突然被吓到后仰跌倒坐地，尾鳍翘起，愣住两秒，然后爬起身回到站姿，结束时与开头姿势一致，不要烟雾灰尘特效'
  # move（首尾静止段，位移由引擎完成）
  '悠闲散步'             = '开头2秒站立不动，然后原地慢悠悠走路踏步，裙摆和尾巴随步伐轻摆，结尾2秒站立不动回到开头姿势'
  # 小动作分类池 ×5
  '坐姿抱膝'             = '保持Q版二头身大头小身体比例不变，从坐姿抱膝开始，轻轻前后摇晃身体发呆，尾巴轻摆，然后慢慢站起来，结束时回到Q版二头身站姿，白色围裙始终穿在身上'
  '趴地熟睡'             = '保持Q版二头身比例和蓝紫色大眼睛不变，趴在地上闭眼熟睡，鼻尖鼻涕泡一大一小地起伏，尾巴偶尔轻摆，全程趴姿不起身'
  '跪坐干饭'             = '保持Q版二头身比例和蓝紫色大眼睛不变，跪坐着端起饭碗拿筷子开心地扒饭吃，腮帮子鼓鼓地咀嚼，饭碗全程端在手里'
  '挂右边缘'             = '保持Q版二头身比例，从站姿开始，爬向画面右侧，双手攀住画面右边缘悬挂起来（攀住的是与背景同色的绿色窗框，会变透明不可见），双腿悬空晃动，然后跳下来回到站姿'
  '挂顶边'               = '保持Q版二头身比例，从站姿开始，原地起跳双手攀住画面顶部边缘悬挂（攀住的是与背景同色的绿色窗框，会变透明不可见），双腿晃荡尾巴摇摆，然后松手落地回到站姿'
}

# 画面固定段：纯绿幕、无阴影、固定机位
$sceneT2V = '全身入镜，角色居中，面向画面左侧，角色身高约占画面高度的百分之六十，四周留有充足的绿色背景空间，纯绿色背景，背景无任何杂物和渐变，没有阴影，没有地面阴影，均匀光照，固定机位，镜头完全不动'
$sceneI2V = '保持画面构图和角色形象完全不变，始终保持Q版二头身大头小身体比例，纯绿色背景始终不变，没有阴影，固定机位，镜头完全不动'
$negative = '阴影，地面阴影，投影，烟雾，雾气，灰尘，粒子特效，渐变背景，背景杂物，镜头移动，推拉升降，变焦，多余肢体，变形，模糊，文字，字幕，水印，绿色衣服，绿色头发，角色出画，裁切，长腿，正常比例，成人比例，九头身'

function New-T2VWorkflow([string]$positive, [long]$seed, [int]$frames, [string]$prefix) {
  return @{
    '1'  = @{ class_type = 'UNETLoader'; inputs = @{ unet_name = 'wan2.1_t2v_1.3B_fp16.safetensors'; weight_dtype = 'default' } }
    '2'  = @{ class_type = 'CLIPLoader'; inputs = @{ clip_name = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'; type = 'wan' } }
    '3'  = @{ class_type = 'VAELoader'; inputs = @{ vae_name = 'wan_2.1_vae.safetensors' } }
    '4'  = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('2', 0); text = $positive } }
    '5'  = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('2', 0); text = $negative } }
    '6'  = @{ class_type = 'EmptyHunyuanLatentVideo'; inputs = @{ width = 848; height = 480; length = $frames; batch_size = 1 } }
    '7'  = @{ class_type = 'KSampler'; inputs = @{ model = @('1', 0); positive = @('4', 0); negative = @('5', 0); latent_image = @('6', 0); seed = $seed; steps = 30; cfg = 6.0; sampler_name = 'uni_pc'; scheduler = 'simple'; denoise = 1.0 } }
    '8'  = @{ class_type = 'VAEDecode'; inputs = @{ samples = @('7', 0); vae = @('3', 0) } }
    '9'  = @{ class_type = 'CreateVideo'; inputs = @{ images = @('8', 0); fps = 16 } }
    '10' = @{ class_type = 'SaveVideo'; inputs = @{ video = @('9', 0); filename_prefix = $prefix; format = 'mp4'; codec = 'h264' } }
  }
}

function New-I2VWorkflow([string]$positive, [long]$seed, [int]$frames, [string]$prefix, [string]$refName) {
  return @{
    '1'  = @{ class_type = 'UNETLoader'; inputs = @{ unet_name = 'wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors'; weight_dtype = 'default' } }
    '2'  = @{ class_type = 'CLIPLoader'; inputs = @{ clip_name = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'; type = 'wan' } }
    '3'  = @{ class_type = 'VAELoader'; inputs = @{ vae_name = 'wan_2.1_vae.safetensors' } }
    '4'  = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('2', 0); text = $positive } }
    '5'  = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('2', 0); text = $negative } }
    '11' = @{ class_type = 'LoadImage'; inputs = @{ image = $refName } }
    '12' = @{ class_type = 'CLIPVisionLoader'; inputs = @{ clip_name = 'clip_vision_h.safetensors' } }
    '13' = @{ class_type = 'CLIPVisionEncode'; inputs = @{ clip_vision = @('12', 0); image = @('11', 0); crop = 'center' } }
    '14' = @{ class_type = 'WanImageToVideo'; inputs = @{ positive = @('4', 0); negative = @('5', 0); vae = @('3', 0); width = 848; height = 480; length = $frames; batch_size = 1; clip_vision_output = @('13', 0); start_image = @('11', 0) } }
    '15' = @{ class_type = 'ModelSamplingSD3'; inputs = @{ model = @('1', 0); shift = 8.0 } }
    # 官方 i2v 配方：steps 25 / cfg 6.0 / uni_pc / simple / shift 8（cfg 降到 5 会在第 2 帧就发散，实测）
    '7'  = @{ class_type = 'KSampler'; inputs = @{ model = @('15', 0); positive = @('14', 0); negative = @('14', 1); latent_image = @('14', 2); seed = $seed; steps = 25; cfg = 6.0; sampler_name = 'uni_pc'; scheduler = 'simple'; denoise = 1.0 } }
    '8'  = @{ class_type = 'VAEDecode'; inputs = @{ samples = @('7', 0); vae = @('3', 0) } }
    '9'  = @{ class_type = 'CreateVideo'; inputs = @{ images = @('8', 0); fps = 16 } }
    '10' = @{ class_type = 'SaveVideo'; inputs = @{ video = @('9', 0); filename_prefix = $prefix; format = 'mp4'; codec = 'h264' } }
  }
}

function Invoke-ComfyGenerate([string]$name, [string]$action, [long]$seed, [int]$frames) {
  if ($I2V) {
    $extra = if ($Character) { "$Character。" } else { '' }
    $positive = "$extra$sceneI2V。$action。只表演这一个动作，不做其他动作。"
    # 逐动画姿势锚点：poseMap 命中用姿势图，否则用 -RefImage（默认站姿 ref-stand.png）
    $refPath = $RefImage
    if ($poseMap.ContainsKey($name)) {
      $candidate = Join-Path $root ('assets-custom\refs\' + $poseMap[$name])
      if (Test-Path $candidate) { $refPath = $candidate }
    }
    $refName = Send-ComfyImage $refPath
    $wf = New-I2VWorkflow $positive $seed $frames "dsh-pet/i2v_$seed" $refName
  } else {
    $positive = "$Character。$sceneT2V。$action。只表演这一个动作，不做其他动作。"
    $wf = New-T2VWorkflow $positive $seed $frames "dsh-pet/t2v_$seed"
  }
  $body = @{ prompt = $wf } | ConvertTo-Json -Depth 10 -Compress
  # PS5.1 的 Invoke-RestMethod 默认按 Latin-1 发 body，中文会全变 ??——必须显式 UTF-8 字节
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $resp = Invoke-RestMethod -Uri "$Server/prompt" -Method Post -Body $bodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30
  $pid_ = $resp.prompt_id
  if (-not $pid_) { throw "ComfyUI 未返回 prompt_id：$($resp | ConvertTo-Json -Compress)" }

  $deadline = (Get-Date).AddMinutes($TimeoutMin)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    $h = Invoke-RestMethod -Uri "$Server/history/$pid_" -TimeoutSec 15
    $entry = $h.$pid_
    if (-not $entry) { continue }
    if ($entry.status.status_str -eq 'error') {
      $msgs = ($entry.status.messages | ConvertTo-Json -Compress -Depth 6)
      throw "ComfyUI 执行出错：$msgs"
    }
    if ($entry.status.completed -or $entry.status.status_str -eq 'success') {
      $outs = $entry.outputs.'10'
      $files = @()
      foreach ($prop in $outs.PSObject.Properties) {
        foreach ($v in @($prop.Value)) { if ($v.filename) { $files += $v } }
      }
      if (-not $files.Count) { throw "完成但无输出文件：" + ($outs | ConvertTo-Json -Compress -Depth 5) }
      $f = $files[0]
      $url = "$Server/view?filename=$([uri]::EscapeDataString($f.filename))&subfolder=$([uri]::EscapeDataString($f.subfolder))&type=$($f.type)"
      $dest = Join-Path $rawDir ($name + '.mp4')
      Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 120
      return $dest
    }
  }
  throw "超时（${TimeoutMin}min 未完成）"
}

# ================= 主循环 =================
$todo = @($actions.GetEnumerator())
if ($Only) { $todo = @($todo | Where-Object { $_.Key -eq $Only }) }
if (-not $todo.Count) { Write-Error "动画名不存在：$Only（对照 assets-custom/CHECKLIST.md）" }

$i = 0; $fail = 0
foreach ($kv in $todo) {
  $i++
  if ($BaseSeed -ge 0) { $seed = $BaseSeed + $i } else { $seed = Get-Random }
  $dest = Join-Path $rawDir ($kv.Key + '.mp4')
  if (Test-Path $dest) { Write-Host "[$i/$($todo.Count)] 跳过（已存在）：$($kv.Key)"; continue }
  if ($I2V) { $mode = 'I2V' } else { $mode = 'T2V' }
  Write-Host "[$i/$($todo.Count)] 生成：$($kv.Key)（seed=$seed, ${Frames}帧, $mode）"
  try {
    $out = Invoke-ComfyGenerate $kv.Key $kv.Value $seed $Frames
    Write-Host "    -> $out（$([math]::Round((Get-Item $out).Length/1MB, 1)) MB）"
  } catch {
    $fail++
    Write-Warning "生成失败：$($kv.Key)：$($_.Exception.Message)"
  }
}
Write-Host ""
Write-Host "完成：$($todo.Count - $fail) 成功 / $fail 失败"
if ($fail) { exit 1 }
