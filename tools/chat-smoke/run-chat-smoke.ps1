# Chat-panel smoke driver: mock pet host -> Electron helper -> verdict + screenshot.
#
# Usage (repo root):  & .\tools\chat-smoke\run-chat-smoke.ps1
#
# Needs an interactive desktop session: Electron cannot start its renderer when
# child-process creation is restricted (no piped stdio / no interactive window
# station), in which case the verdict file never appears and the log shows the
# platform_channel FATAL. For a headless check of the same panel logic, run
# `node tools/chat-smoke/panel-test.mjs` instead — it needs neither Electron nor
# a desktop session.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$mockLog = Join-Path $outDir 'mock.log'
$hostLog = Join-Path $outDir 'electron.log'
$hostErr = Join-Path $outDir 'electron.err.log'
$shot = Join-Path $outDir 'chat-panel.png'
$verdict = Join-Path $outDir 'chat-panel.chat.json'
$port = 7399

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "electron.exe not found: $electron" }

# Clean slate: stale results would be indistinguishable from a fresh run
Remove-Item -Force -ErrorAction SilentlyContinue $mockLog, $hostLog, $hostErr, $shot, $verdict

$mock = Start-Process -FilePath 'node' -ArgumentList (Join-Path $PSScriptRoot 'mock-host.mjs') `
  -PassThru -WindowStyle Hidden -RedirectStandardOutput $mockLog -RedirectStandardError (Join-Path $outDir 'mock.err.log') `
  -WorkingDirectory $PSScriptRoot
Start-Sleep -Milliseconds 1200
Write-Host "[smoke] mock host pid=$($mock.Id)"

$env:DSH_PET_SMOKE = '1'
$env:DSH_PET_SMOKE_OUT = $shot
$env:DSH_PET_SMOKE_AFTER_MS = '9000'
$env:DSH_PET_CHAT_SMOKE = '1'
$env:DSH_PET_CONFIG_URL = "http://127.0.0.1:$port/dsh-pet-7340/config"
$env:DSH_PET_PETS = '[{"id":"main","size":462}]'
$env:DSH_PET_SCALE = '1'

$udd = [System.IO.Path]::Combine($outDir, 'user-data')
New-Item -ItemType Directory -Force -Path $udd | Out-Null

try {
  $helper = Join-Path $root 'runtime\electron-helper'
  $proc = Start-Process -FilePath $electron `
    -ArgumentList @($helper, "--user-data-dir=$udd", '--no-sandbox', '--single-process', '--disable-gpu') `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $hostLog -RedirectStandardError $hostErr `
    -WorkingDirectory $root
  Write-Host "[smoke] electron pid=$($proc.Id); waiting for the verdict file (<=45s)..."
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-Path $verdict)) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
  }
  Write-Host "[smoke] electron hasExited=$($proc.HasExited)"
} finally {
  # Electron spawns helpers; kill the whole family so no orphan pet window survives
  Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron } | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "`n================ verdict ================"
if (Test-Path $verdict) { Get-Content $verdict } else { Write-Warning "no verdict file at $verdict" }

Write-Host "`n================ mock host ================"
if (Test-Path $mockLog) { Get-Content $mockLog }

Write-Host "`n================ electron errors ================"
if (Test-Path $hostErr) { Get-Content $hostErr | Select-Object -First 15 }

Write-Host "`n================ smoke log lines ================"
if (Test-Path $hostLog) { Get-Content $hostLog | Where-Object { $_ -match 'smoke' } | Select-Object -First 20 }

Write-Host "`n================ screenshot ================"
if (Test-Path $shot) { Get-Item $shot | Select-Object FullName, Length | Format-List } else { Write-Warning "no screenshot at $shot" }
