@echo off
cd /d "%~dp0"
echo.
echo ==========================================
echo  DEMAC Corporation - Expo para Samsung
echo ==========================================
echo.
if not exist node_modules (
  echo Instalando dependencias primero...
  call npm install
  if errorlevel 1 (
    echo La instalacion no termino correctamente.
    pause
    exit /b 1
  )
)
echo.
echo Iniciando Expo. Escanea el codigo QR con Expo Go.
call npx expo start --tunnel
pause
