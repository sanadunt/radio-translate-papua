@echo off
rem Radio Translate Papua: klik dua kali untuk menjalankan.
rem Pertama kali: memasang uv (pengelola Python), lalu Python 3.12 dan semua
rem dependency otomatis sesuai uv.lock. Paket AI ikut dipasang bila ada folder
rem model (models\ atau whisper-*) di folder ini, atau bila RADIO_AI=1.
setlocal
title Radio Translate Papua - jangan tutup jendela ini selama aplikasi dipakai
cd /d "%~dp0"

where uv >nul 2>nul
if not errorlevel 1 goto have_uv
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
where uv >nul 2>nul
if not errorlevel 1 goto have_uv
echo Memasang uv, pengelola Python, sekali saja...
powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
where uv >nul 2>nul
if errorlevel 1 (
  echo Gagal memasang uv. Cek koneksi internet, lalu coba lagi.
  pause
  exit /b 1
)

:have_uv
set "EXTRAS="
if exist "models\" set "EXTRAS=--extra ai"
dir /b /ad "whisper-*" >nul 2>nul && set "EXTRAS=--extra ai"
if "%RADIO_AI%"=="1" set "EXTRAS=--extra ai"
if "%RADIO_AI%"=="0" set "EXTRAS="

uv run --locked %EXTRAS% python radio_launcher.py %*
if errorlevel 1 pause
