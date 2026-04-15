@echo off
cd /d "%~dp0"
python -m pip install -r route-optimizer\requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] pip install failed. Check Python is installed and on PATH.
    pause
    exit /b 1
)
echo.
echo [OK] Install complete.
echo     Run server: cd route-optimizer ^& python app.py
pause
