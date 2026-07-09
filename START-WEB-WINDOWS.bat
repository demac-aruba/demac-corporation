@echo off
cd /d "%~dp0"
echo.
echo ==========================================
echo  DEMAC Corporation - Instalacion y Web
echo ==========================================
echo.
echo Instalando dependencias desde npmjs.org...
call npm install
if errorlevel 1 (
  echo.
  echo La instalacion no termino correctamente.
  echo Copia el mensaje de error y envialo para revisarlo.
  pause
  exit /b 1
)
echo.
echo Abriendo la aplicacion web...
call npm run web
pause
