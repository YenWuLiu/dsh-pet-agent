# Standalone pet smoke: boot from npm packages only, chat with pwsh, then Electron screenshot.
$ErrorActionPreference = 'Continue'
$app = 'D:\dsh\dsh-pet-standalone'
Set-Location $app

# Phase 1: no-electron — kernel boot + agent chat
$env:DSH_PET_NO_ELECTRON = '1'
$proc = Start-Process -FilePath 'node' -ArgumentList '--import','tsx/esm','src/bin.ts' -PassThru -NoNewWindow -RedirectStandardError "$env:TEMP\standalone-stderr.log"
Write-Host "standalone pid: $($proc.Id)"
$ready = $false
foreach ($i in 1..60) {
  Start-Sleep -Seconds 2
  try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:7340/dsh-pet-7340/config/meta' -TimeoutSec 3; $ready = $true; break } catch {}
}
if (-not $ready) {
  Write-Host "BOOT TIMEOUT. stderr:"; Get-Content "$env:TEMP\standalone-stderr.log" -Tail 25
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; exit 1
}
$taskText = -join (0x7528,0x20,0x70,0x77,0x73,0x68,0x20,0x67E5,0x4E00,0x4E0B,0x5F53,0x524D,0x5185,0x5B58,0x5360,0x7528,0xFF0C,0x4E00,0x53E5,0x8BDD,0x544A,0x8BC9,0x6211).ForEach([char])
Write-Host "task: $taskText"
$body = @{ text = $taskText } | ConvertTo-Json
$chat = Invoke-RestMethod -Uri 'http://127.0.0.1:7340/dsh-pet-7340/chat?pet=main' -Method Post -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 180
Write-Host "chat ok=$($chat.ok)  reply: $($chat.reply)"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Phase 2: electron desktop screenshot
Remove-Item Env:\DSH_PET_NO_ELECTRON
$env:DSH_PET_SMOKE_OUT = 'D:\dsh\dsh-pet-standalone\desktop-smoke.png'
$env:DSH_PET_SMOKE_AFTER_MS = '10000'
Remove-Item $env:DSH_PET_SMOKE_OUT -Force -ErrorAction SilentlyContinue
$proc2 = Start-Process -FilePath 'node' -ArgumentList '--import','tsx/esm','src/bin.ts' -PassThru -NoNewWindow -RedirectStandardError "$env:TEMP\standalone-stderr2.log"
foreach ($i in 1..40) { Start-Sleep -Seconds 2; if (Test-Path $env:DSH_PET_SMOKE_OUT) { break }; if ($proc2.HasExited) { break } }
Write-Host "desktop smoke png: $(Test-Path $env:DSH_PET_SMOKE_OUT)"
Get-Content "$env:TEMP\standalone-stderr2.log" -Tail 6
Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
Get-Process | Where-Object ProcessName -match 'electron' | Stop-Process -Force -ErrorAction SilentlyContinue
