@echo off
echo =========================================
echo  Camera Streaming Service - Quick Start
echo =========================================
echo.

echo Installing dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo Generating SSL certificates...
python generate_ssl.py
if %errorlevel% neq 0 (
    echo Warning: Failed to generate SSL certificates
    echo Will start in HTTP mode
)

echo.
echo Starting Camera Streaming Service...
echo.
echo HTTPS: https://localhost:8443
echo HTTP:  http://localhost:8000
echo Admin: Username: admin, Password: admin123
echo.
echo Note: You may see a security warning for self-signed certificates
echo Click "Advanced" then "Proceed to localhost (unsafe)" to continue
echo.

python main.py

pause
