@echo off
setlocal
chcp 65001 >nul
set "ORIGEM=%~dp0"
set "TRAB=%SystemDrive%\ClienteAcessos-build"
echo ==============================================
echo   Cliente Acessos - gerando o instalador (.exe)
echo   (alternativa ao GitHub Actions; precisa de internet)
echo ==============================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [1/3] Instalando o Node.js automaticamente... aguarde.
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  )
  set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar o Node.js automaticamente.
  echo Instale o Node.js LTS em https://nodejs.org e execute este arquivo de novo.
  pause & exit /b 1
)
echo Node.js OK:
node -v

echo.
echo Copiando o projeto para %TRAB% (pasta curta, fora do OneDrive)...
robocopy "%ORIGEM%." "%TRAB%" /E /XD node_modules dist data .git .chaves atualizacoes /NFL /NDL /NJH /NJS /NP >nul
cd /d "%TRAB%"

echo.
echo [2/3] Instalando dependencias...
call npm install || (echo Falha no npm install & pause & exit /b 1)

echo.
echo [3/3] Gerando o instalador...
call npm run dist || (echo Falha ao gerar o instalador & pause & exit /b 1)

echo.
robocopy "%TRAB%\dist" "%ORIGEM%dist" *.exe /NFL /NDL /NJH /NJS /NP >nul
echo Pronto! O instalador esta na pasta "dist" (ao lado deste arquivo).
explorer "%ORIGEM%dist"
pause
