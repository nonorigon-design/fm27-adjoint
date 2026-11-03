$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    Write-Host "FM27 Adjoint - Reparation et IA locale gratuite" -ForegroundColor Cyan
    Write-Host "Cette installation telecharge Ollama et un modele visuel de plusieurs Go."
    Write-Host "Elle conserve ton historique et ta cle Gemini. Ferme l'ancien adjoint avant de continuer."
    $root = Join-Path $env:LOCALAPPDATA 'FM27_Adjoint'
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
    if (-not $ollama) {
        $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
        if (Test-Path -LiteralPath $candidate) { $ollama = $candidate }
    }
    if (-not $ollama) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) { throw 'Installe le Gestionnaire d applications Microsoft (winget) depuis le Store, puis relance.' }
        & $winget.Source install --id Ollama.Ollama --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
        if (Test-Path -LiteralPath $candidate) { $ollama = $candidate }
        if (-not $ollama) { throw 'Ollama non trouve. Redemarre Windows et relance ce fichier.' }
    }
    $ready = $false
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; $ready=$true } catch {}
    if (-not $ready) {
        Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'ollama-server.log') -RedirectStandardError (Join-Path $root 'ollama-server-error.log') | Out-Null
        for ($i=0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 500
            try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; $ready=$true; break } catch {}
        }
    }
    if (-not $ready) { throw 'Ollama ne repond pas sur le port local 11434.' }
    Write-Host 'Telechargement du modele visuel. Patiente, cela peut prendre plusieurs minutes...'
    & $ollama pull qwen3-vl:4b
    if ($LASTEXITCODE -ne 0) { throw 'Le telechargement du modele a echoue. Relance pour reprendre.' }
    @{provider='Ollama local'; model='qwen3-vl:4b'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'preferences.json') -Encoding UTF8
    $stage = Join-Path $env:TEMP ('fm27-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $stage | Out-Null
    $zip = Join-Path $stage 'application.zip'
    Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/nonorigon-design/fm27-adjoint/archive/refs/heads/main.zip?t=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $stage
    $dest = Join-Path $root 'programme'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $stage 'fm27-adjoint-main\*') -Destination $dest -Recurse -Force
    Remove-Item -LiteralPath $stage -Recurse -Force
    Write-Host 'Installation terminee. Utilise ensuite FM27 Adjoint sur le Bureau.' -ForegroundColor Green
    & (Join-Path $dest 'launcher.ps1')
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Appuie sur Entree pour fermer'
    exit 1
}
