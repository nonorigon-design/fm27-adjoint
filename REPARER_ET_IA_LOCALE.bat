@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $file=Join-Path $env:TEMP ('fm27-repair-'+[guid]::NewGuid()+'.ps1'); Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/nonorigon-design/fm27-adjoint/main/repair-local.ps1?t='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $file; & $file; exit $LASTEXITCODE } catch { Write-Host $_.Exception.Message -ForegroundColor Red; Read-Host 'Appuie sur Entree'; exit 1 }"
if errorlevel 1 pause
