@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm --onefile --windowed --name FM27_Adjoint app.py
if errorlevel 1 goto :error
echo Executable disponible dans dist\FM27_Adjoint.exe
pause
exit /b 0
:error
echo Construction impossible. Consulte le message ci-dessus.
pause
exit /b 1
