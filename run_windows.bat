@echo off
REM Statement Ledger launcher for Windows.
REM First run: creates a local virtual environment and installs dependencies.
REM Every run after that: just starts the app.

cd /d "%~dp0"

if not exist venv (
    echo Setting up (first run only) - this can take a minute...
    py -3 -m venv venv
    if errorlevel 1 (
        echo.
        echo Could not find Python. Install Python 3.10+ from python.org
        echo and make sure to check "Add python.exe to PATH" during setup.
        pause
        exit /b 1
    )
    call venv\Scripts\activate.bat
    python -m pip install --upgrade pip >nul
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

python app.py
if errorlevel 1 pause
