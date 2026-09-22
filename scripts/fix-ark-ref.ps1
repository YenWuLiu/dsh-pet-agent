<#
.SYNOPSIS
    Normalize any video into a spec that Volcengine Ark Seedance "reference video /
    input video" upload validation will accept.

.DESCRIPTION
    The console error "upload video resolution not supported" is almost always one of:
      - short edge below 480p (e.g. 640x360)
      - long edge above 1080p (e.g. 4K)
      - resolution not on a standard rung, or odd width/height (e.g. 560x752)
      - codec is HEVC/H.265, which the web uploader often cannot decode (2nd suspect)

    For each input this script probes once with ffprobe, computes a compliant target
    spec, and re-encodes with ffmpeg:
      - keeps the original aspect ratio, only scales to the nearest standard rung
        (480p / 720p / 1080p)
      - extreme ratios (<0.45 or >2.35) are letterboxed with black bars instead of
        cropped, so no picture is lost
      - always lands on H.264 High / yuv420p / even dimensions / faststart
      - audio becomes AAC 48 kHz stereo; no audio stays no audio
      - anything longer than -MaxSeconds is trimmed

.PARAMETER Path
    One or more video files, or directories containing videos (scanned recursively).

.PARAMETER Quality
    auto (default) | 480p | 720p | 1080p
    auto = smallest rung that clears the floor: 1080p only if the short edge is
    already >= 1080, 720p if >= 720, otherwise 720p as the safe fallback.

.PARAMETER OutDir
    Output directory. Defaults to .\ark-out\ next to each source file.

.PARAMETER MaxSeconds
    Duration cap, default 15 seconds. Use 0 for no cap.

.PARAMETER Force
    Re-encode even when the source already looks compliant.

.PARAMETER DryRun
    Print the analysis and the ffmpeg command that would run, without encoding.

.PARAMETER Open
    Open the output folder in Explorer when finished.

.EXAMPLE
    .\fix-ark-ref.ps1 "C:\Users\me\Downloads\clip.mov"

.EXAMPLE
    .\fix-ark-ref.ps1 "$env:USERPROFILE\Downloads" -Quality 1080p -Open

.EXAMPLE
    .\fix-ark-ref.ps1 .\raw -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Path,

    [ValidateSet('auto', '480p', '720p', '1080p')]
    [string]$Quality = 'auto',

    [string]$OutDir,

    [ValidateRange(0, 600)]
    [int]$MaxSeconds = 15,

    [switch]$Force,
    [switch]$DryRun,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ---------------------------------------------------------------- rungs
# Land / Port are [width, height]; every value is even, which yuv420p requires.
$Ladder = @(
    [pscustomobject]@{ Name = '480p';  Short = 480;  Land = @(854, 480);   Port = @(480, 854) }
    [pscustomobject]@{ Name = '720p';  Short = 720;  Land = @(1280, 720);  Port = @(720, 1280) }
    [pscustomobject]@{ Name = '1080p'; Short = 1080; Land = @(1920, 1080); Port = @(1080, 1920) }
)

$MinShort = 480         # hard floor for the short edge
$MaxLong  = 1920        # hard ceiling for the long edge
$LooseLo  = 0.45        # narrower than this -> letterbox
$LooseHi  = 2.35        # wider than this   -> letterbox
$MinSecs  = 2           # shorter than this is basically unusable; warn only
$VideoExt = @('.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.3gp')

# ---------------------------------------------------------------- tool lookup
function Resolve-Tool {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "Cannot find $Name on PATH. Install it with: winget install Gyan.FFmpeg"
}

$ffprobe = Resolve-Tool 'ffprobe'
$ffmpeg  = Resolve-Tool 'ffmpeg'

# ---------------------------------------------------------------- helpers
function Get-ObjProp {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $null }
    $p = $Obj.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-Rotation {
    param($Stream)
    $sd = Get-ObjProp $Stream 'side_data_list'
    if ($null -eq $sd) { return 0 }
    foreach ($s in @($sd)) {
        $r = Get-ObjProp $s 'rotation'
        if ($null -ne $r -and [string]$r -ne '') {
            $val = [double]$r
            if ([math]::Abs($val) -gt 0.01) { return $val }
        }
    }
    return 0
}

function Get-Fps {
    param($Stream)
    foreach ($key in @('avg_frame_rate', 'r_frame_rate')) {
        $raw = [string](Get-ObjProp $Stream $key)
        if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq '0/0') { continue }
        $parts = $raw -split '/'
        if ($parts.Count -eq 2) {
            $den = [double]$parts[1]
            if ($den -ne 0) { return [double]$parts[0] / $den }
        }
        elseif ($parts.Count -eq 1 -and [double]$parts[0] -gt 0) {
            return [double]$parts[0]
        }
    }
    return 0
}

function Test-Even {
    param([int]$N)
    return ($N % 2 -eq 0)
}

function Get-Probe {
    param([string]$File)
    $raw = & $ffprobe -v quiet -print_format json -show_streams -show_format -- $File 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($raw -join ''))) {
        throw "ffprobe could not read this file - damaged or not a video container: $File"
    }
    return (($raw -join "`n") | ConvertFrom-Json)
}

# ---------------------------------------------------------------- analysis
function Get-Analysis {
    param([string]$File, [string]$Preferred)

    $probe   = Get-Probe $File
    $streams = @($probe.streams)

    $v = $streams | Where-Object { (Get-ObjProp $_ 'codec_type') -eq 'video' } | Select-Object -First 1
    if (-not $v) { throw "No video stream in this file: $File" }
    $a = $streams | Where-Object { (Get-ObjProp $_ 'codec_type') -eq 'audio' } | Select-Object -First 1

    # Rotation: phone portrait clips carry a display matrix, and the probed width /
    # height are the unrotated ones. Swap so we reason about displayed geometry.
    $rotation = Get-Rotation $v
    $rawW = [int](Get-ObjProp $v 'width')
    $rawH = [int](Get-ObjProp $v 'height')
    $w = $rawW; $h = $rawH
    if ([math]::Abs($rotation) % 180 -eq 90) { $w = $rawH; $h = $rawW }

    $short    = [math]::Min($w, $h)
    $long     = [math]::Max($w, $h)
    $portrait = ($h -gt $w)
    $ar       = [math]::Round($w / [double]$h, 4)

    $fps  = Get-Fps $v
    $dur  = 0.0
    $dstr = [string](Get-ObjProp $probe.format 'duration')
    if (-not [string]::IsNullOrWhiteSpace($dstr)) { $dur = [double]$dstr }
    if ($dur -le 0) {
        $vds = [string](Get-ObjProp $v 'duration')
        if (-not [string]::IsNullOrWhiteSpace($vds)) { $dur = [double]$vds }
    }

    $vcodec   = [string](Get-ObjProp $v 'codec_name')
    $pixfmt   = [string](Get-ObjProp $v 'pix_fmt')
    $vprof    = [string](Get-ObjProp $v 'profile')
    $transfer = [string](Get-ObjProp $v 'color_transfer')
    $acodec   = if ($a) { [string](Get-ObjProp $a 'codec_name') } else { '' }
    $asr      = if ($a) { [int](Get-ObjProp $a 'sample_rate') } else { 0 }
    $ach      = if ($a) { [int](Get-ObjProp $a 'channels') } else { 0 }

    $sizeMB = [math]::Round((Get-Item -LiteralPath $File).Length / 1MB, 2)

    # --- pick target rung
    $target = $null
    if ($Preferred -ne 'auto') {
        $target = $Ladder | Where-Object { $_.Name -eq $Preferred } | Select-Object -First 1
    }
    elseif ($short -ge 1080) { $target = $Ladder[2] }
    else                     { $target = $Ladder[1] }   # too small or mid -> 720p fallback
    $tw = if ($portrait) { $target.Port[0] } else { $target.Land[0] }
    $th = if ($portrait) { $target.Port[1] } else { $target.Land[1] }

    # --- extreme ratio -> letterbox, never crop
    $fitW = $tw
    $fitH = $th
    if ($ar -lt $LooseLo) {
        $fitW = [int][math]::Floor($tw * $ar)
    }
    elseif ($ar -gt $LooseHi) {
        $fitH = [int][math]::Floor($th / $ar)
    }
    $padded = (($fitW -ne $tw) -or ($fitH -ne $th))

    # force_original_aspect_ratio=decrease + force_divisible_by=2 guarantees the
    # fitted box is even, so the pad stage can center it without odd offsets.
    $needsScale = -not (($w -eq $tw) -and ($h -eq $th))
    if ($padded) {
        $filter = "scale=${fitW}:${fitH}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p"
    }
    elseif ($needsScale) {
        $filter = "scale=${tw}:${th}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p"
    }
    else {
        $filter = "format=yuv420p"
    }

    # --- frame rate: snap to 30 or 24 so 29.97 / 59.94 style values do not survive
    $outFps = if ($fps -ge 27) { 30 } elseif ($fps -gt 0) { 24 } else { 30 }

    # --- duration
    $trimSecs = 0.0
    if ($MaxSeconds -gt 0 -and $dur -gt $MaxSeconds) { $trimSecs = [double]$MaxSeconds }

    # --- compliance verdict
    $reasons = New-Object System.Collections.Generic.List[string]
    if ($short -lt $MinShort)                        { $reasons.Add("short edge $short < $MinShort") }
    if ($long -gt $MaxLong)                          { $reasons.Add("long edge $long > $MaxLong") }
    if (-not (Test-Even $w) -or -not (Test-Even $h)) { $reasons.Add("odd dimension ($w x $h)") }
    if ($needsScale)                                 { $reasons.Add("not a standard rung ($w x $h)") }
    if ($vcodec -notin @('h264', 'hevc'))            { $reasons.Add("codec $vcodec unsupported") }
    if ($vcodec -eq 'hevc')                          { $reasons.Add("HEVC decodes poorly in browsers, prefer H.264") }
    if ($pixfmt -ne 'yuv420p')                       { $reasons.Add("pixel format $pixfmt -> yuv420p") }
    if ($transfer -in @('smpte2084', 'arib-std-b67')) { $reasons.Add("HDR ($transfer) -> SDR") }
    if ($a -and ($acodec -ne 'aac' -or $asr -ne 48000 -or $ach -ne 2)) {
        $reasons.Add("audio $acodec $asr Hz $ach ch -> AAC 48k stereo")
    }
    if ($trimSecs -gt 0) { $reasons.Add("duration $([math]::Round($dur, 2))s > ${MaxSeconds}s, needs trim") }

    $compliant = ($reasons.Count -eq 0)
    $warn = New-Object System.Collections.Generic.List[string]
    if ($dur -gt 0 -and $dur -lt $MinSecs) {
        $warn.Add("duration is only $([math]::Round($dur, 2))s, below ${MinSecs}s - may be rejected anyway")
    }

    # --- ffmpeg argv
    $outName = "$([System.IO.Path]::GetFileNameWithoutExtension($File))_ark_$($target.Name).mp4"
    $destDir = if ($OutDir) { $OutDir } else { Join-Path ([System.IO.Path]::GetDirectoryName((Resolve-Path -LiteralPath $File).Path)) 'ark-out' }
    $dest = Join-Path $destDir $outName

    $ff = New-Object System.Collections.Generic.List[string]
    $ff.Add('-y'); $ff.Add('-hide_banner'); $ff.Add('-nostdin'); $ff.Add('-loglevel'); $ff.Add('error')
    if ($trimSecs -gt 0) { $ff.Add('-t'); $ff.Add([string]$trimSecs) }
    $ff.Add('-i'); $ff.Add((Resolve-Path -LiteralPath $File).Path)
    $ff.Add('-map'); $ff.Add('0:v:0')
    if ($a) { $ff.Add('-map'); $ff.Add('0:a:0?') }
    $ff.Add('-vf'); $ff.Add($filter)
    $ff.Add('-c:v'); $ff.Add('libx264')
    $ff.Add('-profile:v'); $ff.Add('high')
    $ff.Add('-level'); $ff.Add('4.2')
    $ff.Add('-preset'); $ff.Add('medium')
    $ff.Add('-crf'); $ff.Add('18')
    $ff.Add('-pix_fmt'); $ff.Add('yuv420p')
    $ff.Add('-r'); $ff.Add([string]$outFps)
    if ($a) {
        $ff.Add('-c:a'); $ff.Add('aac')
        $ff.Add('-b:a'); $ff.Add('192k')
        $ff.Add('-ar'); $ff.Add('48000')
        $ff.Add('-ac'); $ff.Add('2')
    }
    else {
        $ff.Add('-an')
    }
    $ff.Add('-movflags'); $ff.Add('+faststart')
    $ff.Add($dest)

    return [pscustomobject]@{
        File        = $File
        SrcW        = $w
        SrcH        = $h
        Rotation    = $rotation
        Short       = $short
        Long        = $long
        AR          = $ar
        Portrait    = $portrait
        Fps         = [math]::Round($fps, 2)
        OutFps      = $outFps
        Duration    = [math]::Round($dur, 2)
        TrimTo      = $trimSecs
        VCodec      = $vcodec
        VProfile    = $vprof
        PixFmt      = $pixfmt
        Transfer    = $transfer
        ACodec      = $acodec
        ASampleRate = $asr
        AChannels   = $ach
        HasAudio    = [bool]$a
        SizeMB      = $sizeMB
        Target      = $target.Name
        TargetW     = $tw
        TargetH     = $th
        Padded      = $padded
        Filter      = $filter
        Compliant   = $compliant
        Reasons     = $reasons.ToArray()
        Warnings    = $warn.ToArray()
        Dest        = $dest
        FFArgs      = $ff.ToArray()
    }
}

# ---------------------------------------------------------------- expand inputs
$files = New-Object System.Collections.Generic.List[string]
foreach ($p in $Path) {
    if (Test-Path -LiteralPath $p -PathType Container) {
        Get-ChildItem -LiteralPath $p -File -Recurse |
            Where-Object { $VideoExt -contains $_.Extension.ToLowerInvariant() } |
            ForEach-Object { $files.Add($_.FullName) }
    }
    elseif (Test-Path -LiteralPath $p -PathType Leaf) {
        $files.Add((Resolve-Path -LiteralPath $p).Path)
    }
    else {
        Write-Warning "Path does not exist, skipping: $p"
    }
}
$files = @($files | Select-Object -Unique)
if ($files.Count -eq 0) { throw "No video files found (supported: $($VideoExt -join ', '))" }

# ---------------------------------------------------------------- main loop
$capText = if ($MaxSeconds -gt 0) { "${MaxSeconds}s" } else { 'none' }
Write-Host ""
Write-Host "ffmpeg : $ffmpeg"
Write-Host "inputs : $($files.Count) file(s)   quality: $Quality   duration cap: $capText"
Write-Host ("-" * 100)

$results = New-Object System.Collections.Generic.List[object]

foreach ($f in $files) {
    Write-Host ""
    Write-Host "[$([System.IO.Path]::GetFileName($f))]" -ForegroundColor Cyan
    try {
        $info = Get-Analysis -File $f -Preferred $Quality
    }
    catch {
        Write-Host "  !! analysis failed: $($_.Exception.Message)" -ForegroundColor Red
        $results.Add([pscustomobject]@{ File = $f; Status = 'FAILED'; Detail = $_.Exception.Message; Dest = '' })
        continue
    }

    $rotNote = if ([math]::Abs($info.Rotation) -gt 0.01) { " (display matrix $($info.Rotation) deg)" } else { '' }
    Write-Host ("  src : {0}x{1}{2} / {3} {4} / {5} / {6}fps -> {7}fps / {8}s / {9}MB" -f `
        $info.SrcW, $info.SrcH, $rotNote, $info.VCodec, $info.PixFmt, $info.ACodec,
        $info.Fps, $info.OutFps, $info.Duration, $info.SizeMB)

    $padNote = if ($info.Padded) { '  (extreme ratio, letterboxed)' } else { '' }
    $audNote = if ($info.HasAudio) { ' / AAC 48k stereo' } else { ' / no audio' }
    Write-Host ("  out : {0}  {1}x{2}{3}  H.264 High / yuv420p{4}" -f `
        $info.Target, $info.TargetW, $info.TargetH, $padNote, $audNote)

    foreach ($wn in $info.Warnings) { Write-Host "  ~ $wn" -ForegroundColor Yellow }

    $needWork = $Force -or (-not $info.Compliant)
    if (-not $needWork) {
        Write-Host "  = already compliant, skipped (use -Force to re-encode anyway)" -ForegroundColor Green
        $results.Add([pscustomobject]@{ File = $f; Status = 'SKIPPED'; Detail = 'already compliant'; Dest = '' })
        continue
    }

    if (-not $info.Compliant) {
        Write-Host "  fixes needed:" -ForegroundColor Yellow
        foreach ($r in $info.Reasons) { Write-Host "    - $r" }
    }

    if ($DryRun) {
        Write-Host "  (dry-run) ffmpeg $($info.FFArgs -join ' ')" -ForegroundColor DarkGray
        $results.Add([pscustomobject]@{ File = $f; Status = 'DRYRUN'; Detail = ($info.Reasons -join '; '); Dest = $info.Dest })
        continue
    }

    $destDir = [System.IO.Path]::GetDirectoryName($info.Dest)
    if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $ffmpeg @($info.FFArgs)
    $code = $LASTEXITCODE
    $sw.Stop()

    if ($code -ne 0 -or -not (Test-Path -LiteralPath $info.Dest)) {
        Write-Host "  !! ffmpeg failed (exit $code)" -ForegroundColor Red
        $results.Add([pscustomobject]@{ File = $f; Status = 'FAILED'; Detail = "ffmpeg exit $code"; Dest = '' })
        continue
    }

    # verify the artifact actually satisfies every rule we claimed
    $verify = Get-Probe $info.Dest
    $vv = @($verify.streams) | Where-Object { (Get-ObjProp $_ 'codec_type') -eq 'video' } | Select-Object -First 1
    $vw = [int](Get-ObjProp $vv 'width')
    $vh = [int](Get-ObjProp $vv 'height')
    $outMB = [math]::Round((Get-Item -LiteralPath $info.Dest).Length / 1MB, 2)
    $vShort = [math]::Min($vw, $vh)
    $vLong  = [math]::Max($vw, $vh)
    $ok = ($vShort -ge $MinShort) -and ($vLong -le $MaxLong) -and (Test-Even $vw) -and (Test-Even $vh) -and
          ((Get-ObjProp $vv 'codec_name') -eq 'h264') -and ((Get-ObjProp $vv 'pix_fmt') -eq 'yuv420p')

    $tag   = if ($ok) { 'OK' } else { 'CHECK' }
    $color = if ($ok) { 'Green' } else { 'Yellow' }
    $vdur  = [math]::Round([double](Get-ObjProp $verify.format 'duration'), 2)
    Write-Host ("  -> {0}  {1}x{2} / {3}s / {4}MB  ({5:N1}s)  {6}" -f `
        $info.Dest, $vw, $vh, $vdur, $outMB, $sw.Elapsed.TotalSeconds, $tag) -ForegroundColor $color

    $results.Add([pscustomobject]@{
        File = $f; Status = $tag; Detail = ($info.Reasons -join '; '); Dest = $info.Dest
        OutW = $vw; OutH = $vh; OutMB = $outMB
    })
}

# ---------------------------------------------------------------- summary
Write-Host ""
Write-Host ("=" * 100)
Write-Host "summary" -ForegroundColor Cyan

$done = @($results | Where-Object { $_.Status -in @('OK', 'CHECK') })
$skip = @($results | Where-Object { $_.Status -eq 'SKIPPED' })
$bad  = @($results | Where-Object { $_.Status -eq 'FAILED' })
$dry  = @($results | Where-Object { $_.Status -eq 'DRYRUN' })

foreach ($r in $done) { Write-Host ("  [{0}] {1}" -f $r.Status, $r.Dest) }
foreach ($r in $skip) { Write-Host "  [skip] $($r.File)" -ForegroundColor Green }
foreach ($r in $dry)  { Write-Host "  [dry ] $($r.File)" -ForegroundColor DarkGray }
foreach ($r in $bad)  { Write-Host "  [FAIL] $($r.File)  -- $($r.Detail)" -ForegroundColor Red }

Write-Host ""
Write-Host ("  encoded $($done.Count) / skipped $($skip.Count) / dry-run $($dry.Count) / failed $($bad.Count)")
Write-Host ""
Write-Host "  next: upload the mp4 into Ark 'reference content' - it becomes @video1, then"
Write-Host "        prompt with 'reference the motion and camera move in @video1, generate ...'"
Write-Host "  still rejected? triage by keyword: duration -> lower -MaxSeconds; size -> raise -crf;"
Write-Host "        container -> only mp4/mov; reference count -> images+videos usually <= 4 total."
Write-Host ""

if ($Open -and $done.Count -gt 0) {
    $firstDir = [System.IO.Path]::GetDirectoryName($done[0].Dest)
    Start-Process explorer.exe -ArgumentList "`"$firstDir`""
}

if ($bad.Count -gt 0) { exit 1 }
exit 0
