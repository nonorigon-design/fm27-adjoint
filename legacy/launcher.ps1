$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$host.UI.RawUI.WindowTitle = 'FM27 Adjoint - Installation et lancement'
$installRoot = Join-Path $env:LOCALAPPDATA 'FM27_Adjoint'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
$log = Join-Path $installRoot 'installation.log'
Start-Transcript -Path $log -Append | Out-Null
function Test-Runtime($exe, $code) {
    $ErrorActionPreference = 'Continue'
    & $exe -c $code 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}
function Find-Python {
    $candidates = @()
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        try {
            $resolved = & $py.Source -3 -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0) { $candidates += $resolved }
        } catch {}
    }
    $candidates += @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python*\python.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python -and $python.Source -notlike '*WindowsApps*') { $candidates += $python.Source }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            if (Test-Runtime $candidate 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3,11)') { return $candidate }
        }
    }
    return $null
}
try {
    Write-Host "`nFM27 ADJOINT - Installation automatique`n" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'app.py'))) {
        throw 'Extrais tout le ZIP avant de lancer DEMARRER.bat.'
    }
    Write-Host '[1/4] Verification de Python...'
    $python = Find-Python
    if (-not $python) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw 'Le Gestionnaire d applications Windows (winget) manque. Installe ou mets a jour App Installer depuis le Microsoft Store, puis relance. Alternative : installe Python 3.11+ avec Tcl/Tk depuis python.org.'
        }
        Write-Host 'Installation de Python pour ton compte Windows. Patiente...'
        & $winget.Source install --id Python.Python.3.13 --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        $python = Find-Python
        if (-not $python) { throw 'Python non disponible apres installation. Redemarre Windows puis relance. Consulte installation.log si le probleme persiste.' }
    }
    Write-Host '[2/4] Preparation de l environnement...'
    $venv = Join-Path $installRoot 'runtime'
    $runtime = Join-Path $venv 'Scripts\python.exe'
    $valid = $false
    if (Test-Path -LiteralPath $runtime) {
        $valid = Test-Runtime $runtime 'import tkinter, pip'
    }
    if (-not $valid) {
        & $python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Creation de l environnement impossible.' }
    }
    Write-Host '[3/4] Installation des composants manquants...'
    if (-not (Test-Runtime $runtime 'import PIL; from PIL import ImageGrab, ImageTk; assert 11 <= int(PIL.__version__.split(".")[0]) < 13')) {
        & $runtime -m pip install --disable-pip-version-check --index-url https://pypi.org/simple -r (Join-Path $PSScriptRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Telechargement des dependances impossible. Verifie Internet puis relance.' }
    }
    Write-Host '[4/4] Creation du raccourci et ouverture...'
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop 'FM27 Adjoint.lnk'))
        $shortcut.TargetPath = Join-Path $PSScriptRoot 'DEMARRER.bat'
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Description = 'Lancer FM27 Adjoint'
        $shortcut.Save()
    } catch { Write-Host 'Raccourci indisponible. DEMARRER.bat reste utilisable.' }
    Stop-Transcript | Out-Null
    & $runtime (Join-Path $PSScriptRoot 'updater.py') $installRoot
    if ($LASTEXITCODE -ne 0) { throw 'L application a rencontre une erreur. Copie le message affiche.' }
    exit 0
} catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Journal : $log"
    try { Stop-Transcript | Out-Null } catch {}
    Read-Host 'Appuie sur Entree pour fermer'
    exit 1
}
